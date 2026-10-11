#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec "$ROOT/node_modules/.bin/vite-node" "$ROOT/scripts/rnaseq-local-demo.ts" "$@"
