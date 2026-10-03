#!/usr/bin/env python3
"""Small real executable used only by compute-runner integration tests.

It intentionally creates output files and can sleep/fail.  Production runner
invocations never enable this fixture; tests opt in with
DRONE_RUNNER_FIXTURE=1 and pass this executable's argv explicitly.
"""

import argparse
import json
import os
import pathlib
import sys
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="fixture-output.json")
    parser.add_argument("--sleep", type=float, default=0)
    parser.add_argument("--exit", type=int, default=0)
    args = parser.parse_args()
    if args.sleep:
        time.sleep(args.sleep)
    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"jobId": os.environ.get("DRONE_JOB_ID"), "fixture": True}) + "\n", encoding="utf-8")
    print("fixture job wrote %s" % output, flush=True)
    return args.exit


if __name__ == "__main__":
    sys.exit(main())
