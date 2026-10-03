#!/bin/sh
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI is required for the opt-in SSH/Slurm fixture" >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is unavailable; start it before running this fixture" >&2
  exit 2
fi
exec docker compose -f "$HERE/docker-compose.yml" up --build --abort-on-container-exit "$@"
