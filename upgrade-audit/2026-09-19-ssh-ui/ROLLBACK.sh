#!/usr/bin/env sh
set -eu
if [ "$#" -ne 2 ]; then
  echo "usage: ROLLBACK.sh <modified-copy> <baseline-copy>" >&2
  exit 2
fi
cp -- "$2" "$1"
printf '%s\n' "rollback restored $1 from $2"
