#!/usr/bin/env python3
"""Identity-bound cleanup checks; Slurm stubs are unit evidence only."""

import importlib.util
import itertools
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "packages/backend/resources/compute-runner/runner.py"


class CleanupTest(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("drone_runner_under_test", RUNNER)
        self.runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.runner)
        temporary = tempfile.TemporaryDirectory(prefix="drone-cleanup-test-")
        self.addCleanup(temporary.cleanup)
        environment = patch.dict(os.environ, DRONE_REMOTE_ROOT=temporary.name,
                                 DRONE_RUNNER_SCHEDULER="direct")
        environment.start()
        self.addCleanup(environment.stop)

    def process(self):
        process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"],
                                   start_new_session=True)
        waiter = threading.Thread(target=process.wait)
        waiter.start()

        def stop():
            if process.poll() is None:
                process.kill()
            waiter.join(timeout=5)
            self.assertFalse(waiter.is_alive())

        self.addCleanup(stop)
        return process

    def direct(self, job_id="direct-job"):
        spec = {"jobId": job_id, "workflow": {"name": "fixture"}}
        self.runner.prepare({"payload": {"spec": spec}}, job_id)
        directory = self.runner.run_dir(job_id)
        worker, child = self.process(), self.process()
        record = {"jobId": job_id, "scheduler": "direct", "pid": worker.pid,
                  "processStartMarker": self.runner.process_start_marker(worker.pid)}
        self.runner.atomic_json(directory / "submission.json", record)
        self.runner.atomic_json(directory / "child.json", {
            "pid": child.pid, "startMarker": self.runner.process_start_marker(child.pid)})
        self.runner.write_status(directory, "running", **record)
        return directory, worker, child

    def test_direct_running_confirms_disappearance(self):
        _, worker, child = self.direct()
        result = self.runner.cancel("direct-job")
        self.assertEqual(result["cleanup"]["state"], "confirmed")
        self.assertEqual(result["state"], "cancelled")
        self.assertIsNotNone(worker.poll())
        self.assertIsNotNone(child.poll())

    def test_already_exited_preserves_terminal_outcome(self):
        directory, worker, child = self.direct()
        for process in (worker, child):
            process.terminate()
            process.wait(timeout=5)
        self.runner.write_status(directory, "succeeded")
        result = self.runner.cancel("direct-job")
        self.assertEqual(result["cleanup"]["state"], "confirmed")
        self.assertEqual(result["state"], "succeeded")

    def test_reused_pids_are_not_signalled_even_for_terminal_job(self):
        directory, worker, child = self.direct()
        submission = self.runner.read_json(directory / "submission.json")
        submission["processStartMarker"] = "previous-creation-marker"
        self.runner.atomic_json(directory / "submission.json", submission)
        self.runner.atomic_json(directory / "child.json", {
            "pid": child.pid, "startMarker": "previous-creation-marker"})
        self.runner.write_status(directory, "failed")
        result = self.runner.cancel("direct-job")
        self.assertIsNone(worker.poll())
        self.assertIsNone(child.poll())
        self.assertEqual(result["cleanup"]["state"], "confirmed")
        self.assertEqual(result["state"], "failed")

    def test_cancel_b_leaves_a_alive(self):
        _, worker_a, child_a = self.direct("job-a")
        _, worker_b, child_b = self.direct("job-b")
        result = self.runner.cancel("job-b")
        self.assertIsNone(worker_a.poll())
        self.assertIsNone(child_a.poll())
        self.assertEqual(result["cleanup"]["state"], "confirmed")
        self.assertIsNotNone(worker_b.poll())
        self.assertIsNotNone(child_b.poll())

    def slurm(self):
        job_id = "slurm-job"
        self.runner.prepare({"payload": {"spec": {
            "jobId": job_id, "workflow": {"name": "fixture"}}}}, job_id)
        directory = self.runner.run_dir(job_id)
        record = {"jobId": job_id, "scheduler": "slurm", "schedulerJobId": "731"}
        self.runner.atomic_json(directory / "submission.json", record)
        self.runner.write_status(directory, "running", **record)
        return directory

    def test_slurm_confirmed_only_after_accounting(self):
        job_id = "slurm-job"
        directory = self.slurm()

        def command(argv, **kwargs):
            self.assertNotEqual(self.runner.read_json(directory / "status.json")["state"], "cancelled")
            self.assertIn("731", argv)
            output = "731|CANCELLED\n" if argv[0] == "sacct" else ""
            return subprocess.CompletedProcess(argv, 0, output.encode(), b"")

        result = self.runner.cancel(job_id, command_runner=command)
        self.assertEqual(result["cleanup"]["state"], "confirmed")
        self.assertEqual(result["state"], "cancelled")

    def test_slurm_uncertain_and_failed_outcomes(self):
        cases = [("empty", "", "", 0, 0, "unknown"),
                 ("running", "731|RUNNING", "731|RUNNING", 0, 0, "unknown"),
                 ("rejected", "", "", 1, 0, "failed"),
                 ("controller-error", "", "", 0, 1, "unknown"),
                 ("wrong-id", "732|CANCELLED", "", 0, 0, "unknown"),
                 ("queue-still-running", "731|CANCELLED", "731|RUNNING", 0, 0, "unknown")]
        for name, accounting, queue, scancel_code, query_code, expected in cases:
            with self.subTest(name=name):
                directory = self.slurm()
                commands = []

                def command(argv, **kwargs):
                    self.assertNotEqual(self.runner.read_json(directory / "status.json")["state"], "cancelled")
                    self.assertIn("731", argv)
                    commands.append(argv[0])
                    output = accounting if argv[0] == "sacct" else queue if argv[0] == "squeue" else ""
                    code = scancel_code if argv[0] == "scancel" else query_code
                    return subprocess.CompletedProcess(argv, code, output.encode(), b"")

                with patch.object(self.runner.time, "monotonic", side_effect=itertools.count(0, 0.5)):
                    result = self.runner.cancel("slurm-job", command_runner=command)
                self.assertEqual(result["cleanup"]["state"], expected)
                self.assertEqual(result["state"], "running")
                if name in ("empty", "running"):
                    self.assertGreaterEqual(commands.count("sacct"), 2)

    def test_capabilities_advertise_evidence(self):
        with patch.object(self.runner.shutil, "which", return_value=None):
            self.assertEqual(self.runner.capabilities()["cleanupEvidence"], 1)

    def test_cancel_unknown_cleanup_preserves_failure_written_during_cleanup(self):
        directory = self.slurm()
        finished_at = "2026-11-19T00:00:00Z"

        def cleanup(submission, command_runner):
            self.runner.write_status(directory, "failed", exitCode=-15, finishedAt=finished_at)
            return "unknown"

        with patch.object(self.runner, "cleanup_slurm", side_effect=cleanup):
            result = self.runner.cancel("slurm-job")
        self.assertEqual(result["state"], "failed")
        self.assertEqual(result["exitCode"], -15)
        self.assertEqual(result["finishedAt"], finished_at)
        self.assertEqual(result["cleanup"]["state"], "unknown")
        self.assertEqual(self.runner.read_json(directory / "status.json"), result)

    def test_cancel_confirmed_cleanup_preserves_failure_written_during_cleanup(self):
        directory = self.slurm()
        finished_at = "2026-11-19T00:00:00Z"

        def cleanup(submission, command_runner):
            self.runner.write_status(directory, "failed", exitCode=-15, finishedAt=finished_at)
            return "confirmed"

        with patch.object(self.runner, "cleanup_slurm", side_effect=cleanup):
            result = self.runner.cancel("slurm-job")
        self.assertEqual(result["state"], "failed")
        self.assertEqual(result["exitCode"], -15)
        self.assertEqual(result["finishedAt"], finished_at)
        self.assertEqual(result["cleanup"]["state"], "confirmed")
        self.assertEqual(self.runner.read_json(directory / "status.json"), result)

    def test_cancel_confirmed_cleanup_cancels_nonterminal_job(self):
        directory = self.slurm()
        with patch.object(self.runner, "cleanup_slurm", return_value="confirmed"):
            result = self.runner.cancel("slurm-job")
        self.assertEqual(result["state"], "cancelled")
        self.assertEqual(result["cleanup"]["state"], "confirmed")
        self.assertIn("finishedAt", result)
        self.assertNotIn("exitCode", result)
        self.assertEqual(self.runner.read_json(directory / "status.json"), result)

    def test_cancel_records_request_before_cleanup(self):
        directory = self.slurm()
        requested_at = "2026-11-19T00:00:00Z"

        def cleanup(submission, command_runner):
            self.assertEqual(self.runner.read_json(directory / "cancel-requested.json"), {
                "jobId": "slurm-job", "requestedAt": requested_at})
            return "confirmed"

        with patch.object(self.runner, "utc_now", return_value=requested_at), \
                patch.object(self.runner, "cleanup_slurm", side_effect=cleanup):
            self.runner.cancel("slurm-job")

    def worker_status(self, exit_code, cancel_requested):
        job_id = "worker-job"
        self.runner.prepare({"payload": {"spec": {
            "jobId": job_id, "workflow": {"name": "fixture"}}}}, job_id)
        directory = self.runner.run_dir(job_id)
        self.runner.atomic_json(directory / "argv.json", {
            "argv": [sys.executable, "-c", "import sys; sys.exit(%d)" % exit_code]})
        if cancel_requested:
            self.runner.atomic_json(directory / "cancel-requested.json", {
                "jobId": job_id, "requestedAt": self.runner.utc_now()})
        self.assertEqual(self.runner.worker(directory), exit_code)
        result = self.runner.read_json(directory / "status.json")
        self.assertEqual(result["exitCode"], exit_code)
        self.assertIn("finishedAt", result)
        return result

    def test_worker_nonzero_exit_with_cancel_request_is_cancelled(self):
        result = self.worker_status(7, cancel_requested=True)
        self.assertEqual(result["state"], "cancelled")

    def test_worker_nonzero_exit_without_cancel_request_is_failed(self):
        result = self.worker_status(7, cancel_requested=False)
        self.assertEqual(result["state"], "failed")

    def test_worker_zero_exit_with_cancel_request_is_succeeded(self):
        result = self.worker_status(0, cancel_requested=True)
        self.assertEqual(result["state"], "succeeded")

    def test_cancel_rejects_status_without_state(self):
        job_id = "missing-state"
        self.runner.prepare({"payload": {"spec": {
            "jobId": job_id, "workflow": {"name": "fixture"}}}}, job_id)
        directory = self.runner.run_dir(job_id)
        self.runner.atomic_json(directory / "status.json", {"jobId": job_id})
        with self.assertRaises(self.runner.RunnerError) as error:
            self.runner.cancel(job_id)
        self.assertEqual(error.exception.code, "corrupt-status")


if __name__ == "__main__":
    unittest.main(verbosity=2)
