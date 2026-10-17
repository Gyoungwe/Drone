#!/bin/sh
set -eu

# This is an opt-in real nf-core execution. It exits before submitting when
# Nextflow or runtime container digests are unavailable, so an unverified run
# can never be reported as reproducible. Each invocation owns a fresh output
# directory and writes a receipt even when Nextflow fails. The nf-core test
# profile supplies its own small data; no result is implied by this script.

OUTDIR=${DRONE_RNASEQ_OUTDIR:-"$PWD/rnaseq-test-results"}
SAMPLESHEET=${DRONE_RNASEQ_SAMPLESHEET:-}
DIGESTS=${DRONE_RNASEQ_CONTAINER_DIGESTS:-}
ATTEMPT_ID=${DRONE_RNASEQ_ATTEMPT_ID:-"rnaseq-$(date -u +%Y%m%dT%H%M%SZ)-$$"}

case "$OUTDIR" in
  /*) ;;
  *) echo "DRONE_RNASEQ_OUTDIR must be absolute" >&2; exit 2 ;;
esac
case "$OUTDIR" in
  *..*) echo "DRONE_RNASEQ_OUTDIR contains an unsafe path" >&2; exit 2 ;;
esac
case "$ATTEMPT_ID" in
  [A-Za-z0-9][A-Za-z0-9._:-]*) ;;
  *) echo "DRONE_RNASEQ_ATTEMPT_ID contains unsafe characters" >&2; exit 2 ;;
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

if [ -L "$OUTDIR" ]; then
  echo "DRONE_RNASEQ_OUTDIR must not be a symlink" >&2
  exit 2
fi
if [ -e "$OUTDIR" ]; then
  [ -d "$OUTDIR" ] || { echo "DRONE_RNASEQ_OUTDIR must be a directory" >&2; exit 2; }
  if [ -n "$(ls -A "$OUTDIR" 2>/dev/null)" ]; then
    echo "DRONE_RNASEQ_OUTDIR must be empty; use a new directory for every attempt" >&2
    exit 2
  fi
else
  mkdir -p "$OUTDIR"
fi

STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
NEXTFLOW_VERSION=$(nextflow -version 2>&1 | head -1 || true)
[ -n "$NEXTFLOW_VERSION" ] || { echo "unable to probe Nextflow version" >&2; exit 2; }
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
exit_status=0
"$@" || {
  exit_status=$?
  status=failed
}
FINISHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
set +e
python3 - "$OUTDIR" "$status" "$exit_status" "$DIGESTS" "$ATTEMPT_ID" "$STARTED_AT" "$FINISHED_AT" "$NEXTFLOW_VERSION" "$SAMPLESHEET" "$@" <<'PY'
import hashlib
import json
import pathlib
import platform
import sys

outdir, status, exit_status, digests, attempt_id, started_at, finished_at, nextflow_version, samplesheet, *argv = sys.argv[1:]
root = pathlib.Path(outdir).resolve()

def digest(path: pathlib.Path) -> tuple[int, str]:
    hasher = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            size += len(chunk)
            hasher.update(chunk)
    return size, hasher.hexdigest()

files = []
for path in root.rglob("*"):
    if path.name == "provenance.json" or not path.is_file() or path.is_symlink():
        continue
    files.append(path.relative_to(root))
files.sort(key=lambda item: item.as_posix())
entries = []
for relative in files:
    size, sha256 = digest(root / relative)
    entries.append({"path": relative.as_posix(), "bytes": size, "sha256": sha256, "kind": "file"})

names = {path.name for path in files}
required = {
    "multiqc": any(path.name == "multiqc_report.html" for path in files),
    "trace": "execution-trace.txt" in names,
    "report": "execution-report.html" in names,
    "timeline": "execution-timeline.html" in names,
    "dag": "execution-dag.html" in names,
    "counts": any(path.name in {"salmon.merged.gene_counts.tsv", "gene_counts.tsv", "counts.tsv"} for path in files),
}
missing = sorted(name for name, present in required.items() if not present)
failure = None
if status == "succeeded" and missing:
    status = "failed"
    failure = {"code": "missing-required-artifacts", "missing": missing}
elif status != "succeeded":
    failure = {"code": "nextflow-failed", "exitCode": int(exit_status)}

input_entries = []
if samplesheet:
    source = pathlib.Path(samplesheet)
    if source.is_file() and not source.is_symlink():
        size, sha256 = digest(source)
        input_entries.append({"path": str(source), "bytes": size, "sha256": sha256, "kind": "input"})
    else:
        failure = failure or {"code": "input-not-readable", "path": str(source)}
        status = "failed"

receipt = {
    "schemaVersion": 2,
    "kind": "rnaseq-smoke-receipt",
    "attemptId": attempt_id,
    "pipeline": "nf-core/rnaseq",
    "revision": "3.18.0",
    "commit": "b96a75361a4f1d49aa969a2b1c68e3e607de06e8",
    "profile": "test",
    "argv": argv,
    "containerDigests": json.loads(digests),
    "nextflowVersion": nextflow_version,
    "environment": {"platform": platform.platform(), "python": platform.python_version()},
    "inputManifest": input_entries,
    "artifactManifest": entries,
    "requiredArtifacts": required,
    "executionStatus": status,
    "nextflowExitCode": int(exit_status),
    "failure": failure,
    "qcStatus": "pending",
    "reviewStatus": "pending",
    "scientificallyVerified": False,
    "startedAt": started_at,
    "finishedAt": finished_at,
}
(root / "provenance.json").write_text(json.dumps(receipt, sort_keys=True, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"attemptId": attempt_id, "executionStatus": status, "artifactCount": len(entries), "missing": missing}))
raise SystemExit(0 if status == "succeeded" else 1)
PY
record_status=$?
set -e
if [ "$record_status" -ne 0 ]; then
  echo "RNA-seq smoke did not produce a complete, reviewable artifact set; see $OUTDIR/provenance.json" >&2
  exit 1
fi
