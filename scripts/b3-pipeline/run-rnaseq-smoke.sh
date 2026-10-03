#!/bin/sh
set -eu

# This is an opt-in real nf-core execution. It exits before submitting when
# Nextflow or runtime container digests are unavailable, so an unverified run
# can never be reported as reproducible. The nf-core test profile supplies its
# own small data; no result is implied by this script until it completes.

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUTDIR=${DRONE_RNASEQ_OUTDIR:-"$PWD/rnaseq-test-results"}
SAMPLESHEET=${DRONE_RNASEQ_SAMPLESHEET:-}
DIGESTS=${DRONE_RNASEQ_CONTAINER_DIGESTS:-}

case "$OUTDIR" in
  /*) ;;
  *) echo "DRONE_RNASEQ_OUTDIR must be absolute" >&2; exit 2 ;;
esac
case "$OUTDIR" in
  *..*) echo "DRONE_RNASEQ_OUTDIR contains an unsafe path" >&2; exit 2 ;;
esac
command -v nextflow >/dev/null 2>&1 || { echo "nextflow is required for the real B3 smoke" >&2; exit 2; }
[ -n "$DIGESTS" ] || { echo "set DRONE_RNASEQ_CONTAINER_DIGESTS to JSON sha256 digests captured from OCI manifests" >&2; exit 2; }
python3 - "$DIGESTS" <<'PY'
import json, re, sys
try:
    value = json.loads(sys.argv[1])
except Exception as error:
    raise SystemExit("invalid DRONE_RNASEQ_CONTAINER_DIGESTS JSON: %s" % error)
if not isinstance(value, dict) or not value or any(not isinstance(v, str) or not re.match(r"^sha256:[0-9a-f]{64}$", v, re.I) for v in value.values()):
    raise SystemExit("container digest map must contain only resolved sha256 digests")
PY

mkdir -p "$OUTDIR"
set -- nextflow run nf-core/rnaseq -r 3.18.0 -profile test \
  --outdir "$OUTDIR" \
  -with-report "$OUTDIR/execution-report.html" \
  -with-trace "$OUTDIR/execution-trace.txt" \
  -with-timeline "$OUTDIR/execution-timeline.html" \
  -with-dag "$OUTDIR/execution-dag.html"
if [ -n "$SAMPLESHEET" ]; then
  case "$SAMPLESHEET" in /*) ;; *) echo "DRONE_RNASEQ_SAMPLESHEET must be absolute" >&2; exit 2 ;; esac
  set -- "$@" --input "$SAMPLESHEET"
fi

status=succeeded
if ! "$@"; then status=failed; fi
python3 - "$OUTDIR" "$status" "$DIGESTS" "$@" <<'PY'
import json, pathlib, sys
outdir, status, digests, *argv = sys.argv[1:]
pathlib.Path(outdir, "provenance.json").write_text(json.dumps({
    "schemaVersion": 1,
    "pipeline": "nf-core/rnaseq",
    "revision": "3.18.0",
    "commit": "b96a75361a4f1d49aa969a2b1c68e3e607de06e8",
    "profile": "test",
    "argv": argv,
    "containerDigests": json.loads(digests),
    "executionStatus": status,
    "scientificallyVerified": False,
}, sort_keys=True, indent=2) + "\n", encoding="utf-8")
PY
[ "$status" = succeeded ]
