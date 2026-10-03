#!/bin/sh
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "SKIP: Docker daemon is unavailable" >&2
  exit 0
fi
trap 'docker compose -f "$HERE/compute-fixtures/docker-compose.yml" down -v' EXIT
docker compose -f "$HERE/compute-fixtures/docker-compose.yml" up -d --build
docker compose -f "$HERE/compute-fixtures/docker-compose.yml" exec -T compute squeue -h
docker compose -f "$HERE/compute-fixtures/docker-compose.yml" exec -T compute sbatch --wrap='printf fixture'
# Exercise the runner over the container's real Python process.  The command
# is intentionally sent through stdin JSON, just as the SSH transport does;
# the fixture executable is explicitly injected for this integration test.
root=/tmp/drone-docker-runner
common='{"protocolVersion":1,"requestId":"docker","command":"'
docker compose -f "$HERE/compute-fixtures/docker-compose.yml" exec -T \
  -e DRONE_REMOTE_ROOT="$root" -e DRONE_RUNNER_SCHEDULER=slurm \
  compute python3 /opt/drone/runner/runner.py capabilities <<EOF
${common}capabilities"}
EOF
