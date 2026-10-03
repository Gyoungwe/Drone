#!/usr/bin/env python3
"""Offline lifecycle checks for the bundled runner.

The tests use a real executable fixture, never a mocked success response.  A
Docker/Slurm integration test is provided separately and is skipped when the
Docker daemon is unavailable.
"""

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "packages/backend/resources/compute-runner/runner.py"
FIXTURE = ROOT / "scripts/compute-fixtures/fixture_job.py"


class RunnerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="drone-runner-test-")
        self.env = os.environ.copy()
        self.env["DRONE_REMOTE_ROOT"] = self.tmp.name
        self.env["DRONE_RUNNER_SCHEDULER"] = "direct"
        self.env["DRONE_RUNNER_FIXTURE"] = "1"
        self.env["DRONE_RUNNER_FIXTURE_ARGV"] = json.dumps([sys.executable, str(FIXTURE)])

    def tearDown(self):
        self.tmp.cleanup()

    def call(self, command, job_id=None, payload=None, request_id=None):
        request = {"protocolVersion": 1, "requestId": request_id or command, "command": command}
        if job_id:
            request["jobId"] = job_id
        if payload is not None:
            request["payload"] = payload
        result = subprocess.run([sys.executable, str(RUNNER), command], input=(json.dumps(request) + "\n").encode(),
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.env, check=True)
        self.assertEqual(result.stderr, b"")
        response = json.loads(result.stdout.decode())
        self.assertEqual(response["requestId"], request["requestId"])
        return response

    def spec(self, job_id):
        return {"jobId": job_id, "hostAlias": "fixture", "workflow": {"name": "fixture", "version": "1"},
                "resources": {"cpus": 1, "wallTimeSeconds": 30}}

    def test_protocol_and_lifecycle(self):
        version = self.call("version")
        self.assertEqual(version["payload"]["protocolVersion"], 1)
        prepared = self.call("prepare", "job-1", {"spec": self.spec("job-1")})
        self.assertTrue(prepared["payload"]["prepared"])
        first = self.call("start", "job-1")
        second = self.call("start", "job-1")
        self.assertEqual(first["payload"]["pid"], second["payload"]["pid"])
        time.sleep(0.4)
        status = self.call("status", "job-1")["payload"]
        self.assertEqual(status["state"], "succeeded")
        logs = self.call("logs", "job-1")["payload"]
        self.assertLessEqual(len(json.dumps(logs).encode()), 1024 * 1024 + 10000)
        collected = self.call("collect", "job-1")["payload"]["manifest"]
        self.assertEqual(collected["entries"][0]["sha256"].__len__(), 64)

    def test_cancel_terminates_real_process(self):
        self.env["DRONE_RUNNER_FIXTURE_ARGV"] = json.dumps([sys.executable, str(FIXTURE), "--sleep", "30"])
        self.call("prepare", "job-2", {"spec": self.spec("job-2")})
        self.call("start", "job-2")
        cancelled = self.call("cancel", "job-2")["payload"]
        self.assertEqual(cancelled["state"], "cancelled")

    def test_production_does_not_run_fixture_by_default(self):
        self.env.pop("DRONE_RUNNER_FIXTURE", None)
        self.env.pop("DRONE_RUNNER_FIXTURE_ARGV", None)
        self.call("prepare", "job-3", {"spec": self.spec("job-3")})
        response = self.call("start", "job-3")
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "workflow-not-registered")

    def test_lock_without_submission_is_unknown_and_never_replayed(self):
        self.call("prepare", "job-4", {"spec": self.spec("job-4")})
        (Path(self.tmp.name) / "runs" / "job-4" / "submit.lock").mkdir()
        response = self.call("start", "job-4")
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "submission-unknown")


if __name__ == "__main__":
    unittest.main(verbosity=2)
