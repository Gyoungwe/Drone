#!/usr/bin/env python3
"""Drone's small, dependency-free remote compute runner.

The runner is deliberately a one-request process.  A caller starts
``python3 runner.py <command>`` and supplies one JSON request on stdin.  The
same entry point is used over a local transport and over an SSH stdio channel.
Long-lived direct jobs are owned by the internal ``--worker`` process, so the
request process can exit without taking the job with it.

Only argv produced by the registered workflow table (or an explicitly opted-in
test fixture) is executed.  There is no shell command field in the protocol.
"""

from __future__ import print_function

import base64
import binascii
import errno
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path


PROTOCOL_VERSION = 1
RUNNER_VERSION = "1.0.0"
MAX_LOG_BYTES = 1024 * 1024
MAX_COLLECT_BYTES = 500 * 1024 * 1024
JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,128}$")
SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")


class RunnerError(Exception):
    def __init__(self, code, message, retryable=False):
        super(RunnerError, self).__init__(message)
        self.code = code
        self.retryable = retryable


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def jsonable(value):
    return value if value is not None else None


def atomic_json(path, value, mode=0o600):
    """Write JSON beside the destination and atomically replace it."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".%s." % path.name, dir=str(path.parent))
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, str(path))
    finally:
        try:
            os.unlink(temporary)
        except OSError:
            pass


def read_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError, TypeError):
        return default


def append_jsonl(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n")
        handle.flush()
        try:
            os.fsync(handle.fileno())
        except OSError:
            pass


def root_dir():
    value = os.environ.get("DRONE_REMOTE_ROOT") or os.environ.get("DRONE_RUN_ROOT")
    if value:
        root = Path(value).expanduser()
    else:
        root = Path.home() / ".drone"
    if not root.is_absolute():
        root = Path.cwd() / root
    return root


def runs_dir():
    path = root_dir() / "runs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def validate_job_id(job_id):
    if not isinstance(job_id, str) or not JOB_ID_RE.match(job_id):
        raise RunnerError("invalid-job-id", "jobId must be a bounded identifier")
    return job_id


def run_dir(job_id):
    validate_job_id(job_id)
    result = runs_dir() / job_id
    # A user-controlled root must still not permit a run directory escape.
    if result.parent != runs_dir():
        raise RunnerError("invalid-run-root", "run directory is outside the runner root")
    return result


def acquire_lock(path):
    try:
        os.mkdir(str(path), 0o700)
        return True
    except OSError as error:
        if error.errno == errno.EEXIST:
            return False
        raise


def bounded_positive(value, name, maximum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        raise RunnerError("invalid-resource", "%s must be positive" % name)
    if maximum is not None and value > maximum:
        raise RunnerError("resource-limit", "%s exceeds the host limit" % name)
    return value


def safe_relative_path(value, label="path"):
    if not isinstance(value, str) or not value or "\x00" in value:
        raise RunnerError("invalid-path", "%s is invalid" % label)
    candidate = Path(value)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise RunnerError("invalid-path", "%s must not be absolute or traverse a parent" % label)
    return value


def path_under_roots(value, roots):
    if not roots or not isinstance(value, str) or not value.startswith("/"):
        return True
    normalized = value.rstrip("/") or "/"
    for root in roots:
        if not isinstance(root, str):
            continue
        candidate = root.rstrip("/") or "/"
        if normalized == candidate or normalized.startswith(candidate + "/"):
            return True
    return False


def validate_spec(spec):
    if not isinstance(spec, dict):
        raise RunnerError("invalid-spec", "payload.spec must be an object")
    job_id = validate_job_id(spec.get("jobId"))
    workflow = spec.get("workflow")
    if not isinstance(workflow, dict):
        raise RunnerError("invalid-workflow", "spec.workflow must be an object")
    # The runner-facing JobSpec also permits a compiled B1 WorkflowSpec,
    # which has no display name.  It remains unregistered in production unless
    # the host supplies a registry entry; explicit fixtures may use it.
    name = workflow.get("name") or workflow.get("id") or ("compiled" if "version" in workflow else None)
    if not isinstance(name, str) or not name or len(name) > 200:
        raise RunnerError("invalid-workflow", "workflow name is required")
    resources = spec.get("resources") or {}
    if not isinstance(resources, dict):
        raise RunnerError("invalid-resource", "resources must be an object")
    cpu_limit = os.cpu_count() or 1
    bounded_positive(resources.get("cpus", 1), "cpus", max(cpu_limit, 1) * 64)
    bounded_positive(resources.get("wallTimeSeconds", 86400), "wallTimeSeconds", 7 * 86400)
    if "memoryBytes" in resources:
        bounded_positive(resources["memoryBytes"], "memoryBytes", 1024 * 1024 * 1024 * 1024)
    for key in ("remoteRead", "remoteWrite"):
        paths = spec.get(key, [])
        if not isinstance(paths, list):
            raise RunnerError("invalid-path", "%s must be an array" % key)
        for item in paths:
            if not isinstance(item, str) or not item or "\x00" in item or ".." in Path(item).parts:
                raise RunnerError("invalid-path", "%s contains an invalid path" % key)
    outputs = spec.get("outputs", [])
    if outputs is not None and not isinstance(outputs, list):
        raise RunnerError("invalid-output", "outputs must be an array")
    for output in outputs or []:
        path = output.get("path") if isinstance(output, dict) else output
        safe_relative_path(path, "output")
    return job_id


def scheduler_kind():
    requested = os.environ.get("DRONE_RUNNER_SCHEDULER", "").strip().lower()
    if requested in ("direct", "slurm"):
        return requested
    if all(shutil.which(command) for command in ("sbatch", "squeue", "sacct", "scancel")):
        return "slurm"
    return "direct"


def command_output(argv, timeout=5):
    try:
        result = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return result.stdout.decode("utf-8", "replace").strip()


def capabilities():
    scheduler = scheduler_kind()
    nextflow = shutil.which("nextflow")
    nf_version = command_output([nextflow, "-version"], 5) if nextflow else None
    container = None
    for candidate in ("docker", "podman", "apptainer", "singularity"):
        if shutil.which(candidate):
            container = candidate
            break
    features = ["direct"]
    if scheduler == "slurm":
        features.append("slurm")
    features.extend(["bounded-logs", "checksummed-collect"])
    return {
        "runnerVersion": RUNNER_VERSION,
        "version": RUNNER_VERSION,
        "protocolVersion": PROTOCOL_VERSION,
        "compatibleVersions": [RUNNER_VERSION],
        "scheduler": scheduler,
        "containerRuntime": container,
        "nextflowVersion": nf_version or None,
        "cpuCount": os.cpu_count() or 1,
        "diskQuotaBytes": disk_quota(root_dir()),
        "maxCollectBytes": MAX_COLLECT_BYTES,
        "loginNodeOnly": scheduler == "slurm",
        "maxConcurrentJobs": int(os.environ.get("DRONE_MAX_CONCURRENT_JOBS", "4")),
        "features": features,
        "fixture": os.environ.get("DRONE_RUNNER_FIXTURE") == "1",
    }


def disk_quota(path):
    try:
        return int(shutil.disk_usage(str(path)).free)
    except OSError:
        return None


def load_fixture_argv():
    """Fixture execution is impossible unless an explicit test switch is set."""
    if os.environ.get("DRONE_RUNNER_FIXTURE") != "1":
        return None
    raw = os.environ.get("DRONE_RUNNER_FIXTURE_ARGV")
    if not raw:
        return None
    try:
        argv = json.loads(raw)
    except ValueError:
        raise RunnerError("invalid-fixture", "DRONE_RUNNER_FIXTURE_ARGV must be a JSON argv array")
    if not isinstance(argv, list) or not argv or any(not isinstance(value, str) or not value for value in argv):
        raise RunnerError("invalid-fixture", "fixture argv must contain non-empty strings")
    return argv


def registered_argv(spec, directory):
    fixture = load_fixture_argv()
    if fixture:
        return fixture, "fixture"
    registry_path = os.environ.get("DRONE_RUNNER_WORKFLOW_REGISTRY")
    registry = read_json(registry_path, {}) if registry_path else {}
    workflow = spec["workflow"]
    name = workflow.get("name") or workflow.get("id") or ("compiled" if "version" in workflow else None)
    if isinstance(registry, dict) and name in registry:
        argv = registry[name]
        if not isinstance(argv, list) or not argv or any(not isinstance(value, str) for value in argv):
            raise RunnerError("invalid-workflow", "registered workflow must contain a fixed argv array")
        return argv, "registered"
    # The official nf-core pipeline is the only built-in production workflow.
    # Its revision is fixed; user input is passed through a bounded parameter
    # file generated by the host, never interpolated into a shell command.
    if name == "nf-core/rnaseq":
        revision = workflow.get("revision") or workflow.get("version") or "3.18.0"
        if revision != "3.18.0":
            raise RunnerError("invalid-workflow", "nf-core/rnaseq is pinned to the official 3.18.0 revision")
        profile = workflow.get("profile") or "test"
        if not isinstance(profile, str) or not re.match(r"^[A-Za-z0-9_.-]+$", profile):
            raise RunnerError("invalid-workflow", "nf-core/rnaseq profile is invalid")
        argv = ["nextflow", "run", "nf-core/rnaseq", "-r", revision, "-profile", profile]
        # Workflow parameters are data, not command text.  Only the official
        # nf-core parameter names are admitted and each value is passed as a
        # separate argv element, so whitespace cannot create another command.
        parameters = workflow.get("parameters") if isinstance(workflow.get("parameters"), dict) else {}
        for key, flag in (("input", "--input"), ("outdir", "--outdir"), ("genome", "--genome"),
                          ("strandedness", "--strandedness")):
            value = parameters.get(key)
            if value is None:
                continue
            if not isinstance(value, str) or not value or "\x00" in value or value.startswith("-") or ".." in Path(value).parts:
                raise RunnerError("invalid-workflow", "nf-core/rnaseq parameter %s is unsafe" % key)
            if key == "outdir" and not path_under_roots(value, spec.get("remoteWrite", [])):
                raise RunnerError("out-of-bounds-write", "nf-core/rnaseq outdir is outside remoteWrite roots")
            argv.extend([flag, value])
        if not any(item == "--outdir" for item in argv):
            argv.extend(["--outdir", str(Path(directory) / "outputs")])
        return argv, "production"
    raise RunnerError("workflow-not-registered", "workflow has no registered executable")


def status_path(directory):
    return Path(directory) / "status.json"


def write_status(directory, state, **fields):
    value = read_json(status_path(directory), {})
    value.update(fields)
    value["state"] = state
    value["updatedAt"] = utc_now()
    atomic_json(status_path(directory), value)
    append_jsonl(Path(directory) / "events.jsonl", {"at": value["updatedAt"], "state": state, **fields})
    return value


def process_start_marker(pid):
    """Return Linux's monotonic process start tick when available."""
    try:
        fields = Path("/proc/%d/stat" % int(pid)).read_text(encoding="ascii").split()
        return fields[21]
    except (OSError, IndexError, ValueError):
        # macOS/BSD do not expose /proc. ``ps lstart`` still lets us reject a
        # reused PID after a reconnect.
        value = command_output(["ps", "-o", "lstart=", "-p", str(int(pid))], 2)
        return value or None


def process_matches(pid, marker):
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    if marker is None:
        return True
    return process_start_marker(pid) == marker


def prepare(request, job_id):
    spec = request.get("payload", {}).get("spec") if isinstance(request.get("payload"), dict) else None
    if spec is None:
        raise RunnerError("invalid-spec", "prepare payload must contain spec")
    validate_spec(spec)
    directory = run_dir(job_id)
    directory.mkdir(parents=True, exist_ok=True)
    prior_spec = read_json(directory / "spec.json")
    if prior_spec is not None and prior_spec != spec:
        raise RunnerError("job-conflict", "jobId already refers to a different immutable specification")
    atomic_json(directory / "request.json", request)
    atomic_json(directory / "spec.json", spec)
    manifest = {
        "version": 1,
        "jobId": job_id,
        "scheduler": scheduler_kind(),
        "createdAt": utc_now(),
        "outputsDir": "outputs",
        "maxCollectBytes": MAX_COLLECT_BYTES,
    }
    atomic_json(directory / "manifest.json", manifest)
    (directory / "outputs").mkdir(exist_ok=True)
    for name in ("events.jsonl", "stdout.log", "stderr.log"):
        (directory / name).touch(exist_ok=True)
    if not status_path(directory).exists():
        write_status(directory, "prepared", jobId=job_id)
    return {"jobId": job_id, "prepared": True, "directory": str(directory), "state": "prepared"}


def ensure_prepared(job_id):
    directory = run_dir(job_id)
    if not (directory / "spec.json").exists() or not (directory / "manifest.json").exists():
        raise RunnerError("not-prepared", "job must be prepared before start")
    return directory


def start(request, job_id):
    directory = ensure_prepared(job_id)
    spec = read_json(directory / "spec.json")
    validate_spec(spec)
    lock = directory / "submit.lock"
    if not acquire_lock(lock):
        existing = read_json(directory / "submission.json")
        if existing:
            return {"alreadySubmitted": True, **existing}
        if scheduler_kind() == "slurm":
            recovered = recover_slurm_submission(directory, spec)
            if recovered:
                atomic_json(directory / "submission.json", recovered)
                return {"alreadySubmitted": True, **recovered}
        raise RunnerError("submission-unknown", "submission lock exists without a durable remote id", True)
    try:
        existing = read_json(directory / "submission.json")
        if existing:
            return {"alreadySubmitted": True, **existing}
        argv, execution_mode = registered_argv(spec, directory)
        atomic_json(directory / "argv.json", {"argv": argv, "executionMode": execution_mode})
        scheduler = scheduler_kind()
        if scheduler == "slurm":
            result = start_slurm(directory, spec, argv, execution_mode)
        else:
            result = start_direct(directory, spec, argv, execution_mode)
        atomic_json(directory / "submission.json", result)
        return result
    finally:
        # The directory is the durable lock.  Keep it to make retries
        # idempotent; a lock without submission.json is intentionally unknown.
        pass


def worker_command(directory):
    return [sys.executable, str(Path(__file__).resolve()), "--worker", str(Path(directory).resolve())]


def start_direct(directory, spec, argv, execution_mode):
    worker = subprocess.Popen(worker_command(directory), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)
    marker = process_start_marker(worker.pid)
    started = utc_now()
    result = {"jobId": spec["jobId"], "pid": worker.pid, "processStartedAt": started,
              "processStartMarker": marker, "executionMode": execution_mode, "scheduler": "direct"}
    write_status(directory, "queued", jobId=spec["jobId"], pid=worker.pid, processStartedAt=started,
                 processStartMarker=marker, executionMode=execution_mode)
    return result


def slurm_script(directory):
    path = Path(directory) / "slurm-job.sh"
    # All values are generated by the runner itself and shell-quoted.  The
    # script only invokes the runner worker and has no user-provided command.
    import shlex
    text = "#!/bin/sh\nexec %s\n" % " ".join(shlex.quote(item) for item in worker_command(directory))
    path.write_text(text, encoding="utf-8")
    os.chmod(str(path), 0o700)
    return path


def start_slurm(directory, spec, argv, execution_mode):
    resources = spec.get("resources") or {}
    cpus = int(resources.get("cpus", 1))
    memory = int(resources.get("memoryBytes", 0))
    wall = int(resources.get("wallTimeSeconds", 86400))
    name = "drone-%s" % spec["jobId"]
    args = ["sbatch", "--parsable", "--job-name=%s" % name, "--comment=%s" % spec["jobId"],
            "--cpus-per-task=%d" % cpus, "--time=%d" % max(1, int((wall + 59) / 60))]
    if memory:
        args.append("--mem=%d" % max(1, int((memory + 1024 * 1024 - 1) / (1024 * 1024))))
    partition = spec.get("partition")
    if partition:
        if not SAFE_NAME_RE.match(partition):
            raise RunnerError("invalid-resource", "partition is invalid")
        args.append("--partition=%s" % partition)
    args.append(str(slurm_script(directory)))
    try:
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RunnerError("scheduler-unavailable", "sbatch could not be invoked: %s" % error, True)
    if result.returncode != 0:
        raise RunnerError("scheduler-submit-failed", result.stderr.decode("utf-8", "replace").strip() or "sbatch failed", True)
    text = result.stdout.decode("utf-8", "replace").strip().splitlines()[0] if result.stdout else ""
    scheduler_id = text.split(";")[0].strip()
    if not scheduler_id or not re.match(r"^[0-9]+(?:_[0-9]+)?$", scheduler_id):
        raise RunnerError("scheduler-submit-unknown", "sbatch did not return a valid job id", True)
    started = utc_now()
    result = {"jobId": spec["jobId"], "schedulerJobId": scheduler_id, "remoteId": scheduler_id,
              "processStartedAt": started, "executionMode": execution_mode, "scheduler": "slurm"}
    write_status(directory, "queued", jobId=spec["jobId"], schedulerJobId=scheduler_id, remoteId=scheduler_id,
                 processStartedAt=started, executionMode=execution_mode)
    return result


def recover_slurm_submission(directory, spec):
    """Reconcile an sbatch response lost with the SSH connection.

    ``--name`` and ``--comment`` are both used because Slurm deployments vary
    in which accounting fields are retained.  An absent result remains
    unknown; the runner never submits a second job automatically.
    """
    name = "drone-%s" % spec["jobId"]
    for args in (
        ["sacct", "-n", "-X", "--name=%s" % name, "--format=JobIDRaw,State"],
        ["squeue", "-h", "--name=%s" % name, "-o", "%A %T"],
    ):
        text = command_output(args, 10)
        for line in text.splitlines():
            parts = line.strip().split()
            if not parts:
                continue
            candidate = parts[0].split(".")[0]
            if re.match(r"^[0-9]+(?:_[0-9]+)?$", candidate):
                return {"jobId": spec["jobId"], "schedulerJobId": candidate, "remoteId": candidate,
                        "processStartedAt": utc_now(), "executionMode": "production", "scheduler": "slurm"}
    return None


def worker(directory):
    directory = Path(directory)
    spec = read_json(directory / "spec.json")
    argv_record = read_json(directory / "argv.json")
    if not spec or not isinstance(argv_record, dict):
        return 2
    argv = argv_record.get("argv")
    if not isinstance(argv, list) or not argv or any(not isinstance(value, str) for value in argv):
        return 2
    # The worker owns the whole process group created by the request process.
    # No shell is involved and argv is the value persisted at submission time.
    started = utc_now()
    write_status(directory, "running", startedAt=started, executionMode=argv_record.get("executionMode"))
    env = os.environ.copy()
    env.update({"DRONE_JOB_ID": spec["jobId"], "DRONE_RUN_DIR": str(directory),
                "DRONE_REMOTE_ROOT": str(root_dir())})
    stdout_path = directory / "stdout.log"
    stderr_path = directory / "stderr.log"
    process = None
    try:
        with open(stdout_path, "ab") as stdout, open(stderr_path, "ab") as stderr:
            process = subprocess.Popen(argv, cwd=str(directory / "outputs"), env=env,
                                       stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                       # Keep the worker alive to persist the
                                       # timeout result while the executable
                                       # receives a complete process-group kill.
                                       start_new_session=True, close_fds=True)
            atomic_json(directory / "child.json", {"pid": process.pid, "startedAt": utc_now(),
                                                     "startMarker": process_start_marker(process.pid)})
            timeout = int((spec.get("resources") or {}).get("wallTimeSeconds", 86400))
            try:
                exit_code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                terminate_process_group(process.pid)
                exit_code = 124
                write_status(directory, "failed", exitCode=exit_code, message="wall-time budget exceeded",
                             finishedAt=utc_now())
                return exit_code
    except OSError as error:
        write_status(directory, "failed", exitCode=127, message="failed to execute registered workflow: %s" % error,
                     finishedAt=utc_now())
        return 127
    state = "succeeded" if exit_code == 0 else "failed"
    write_status(directory, state, exitCode=exit_code, finishedAt=utc_now())
    return exit_code


def terminate_process_group(pid):
    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
    except OSError:
        return
    deadline = time.time() + 5
    while time.time() < deadline:
        try:
            os.killpg(os.getpgid(pid), 0)
            time.sleep(0.1)
        except OSError:
            return
    try:
        os.killpg(os.getpgid(pid), signal.SIGKILL)
    except OSError:
        pass


def slurm_state(directory, value):
    status = read_json(status_path(directory), {})
    scheduler_id = status.get("schedulerJobId")
    if not scheduler_id:
        return status
    queue = command_output(["squeue", "-h", "-j", str(scheduler_id), "-o", "%T"], 10)
    if queue:
        state = queue.splitlines()[0].strip().upper()
        mapped = {"PENDING": "queued", "CONFIGURING": "queued", "RUNNING": "running",
                  "COMPLETING": "running", "SUSPENDED": "running"}.get(state)
        if mapped:
            return write_status(directory, mapped, schedulerState=state)
    accounting = command_output(["sacct", "-n", "-X", "-j", str(scheduler_id), "--format=State,ExitCode"], 10)
    if not accounting:
        return write_status(directory, "unknown", message="scheduler state is unavailable")
    row = accounting.splitlines()[0].strip()
    state_word = row.split()[0].upper() if row else ""
    if state_word.startswith("COMPLETED"):
        return write_status(directory, "succeeded", exitCode=0, finishedAt=status.get("finishedAt") or utc_now())
    if state_word.startswith(("CANCELLED", "TIMEOUT")):
        return write_status(directory, "cancelled" if state_word.startswith("CANCELLED") else "failed",
                            message=state_word, finishedAt=status.get("finishedAt") or utc_now())
    if state_word.startswith(("FAILED", "NODE_FAIL", "OUT_OF_MEMORY")):
        return write_status(directory, "failed", message=state_word, finishedAt=status.get("finishedAt") or utc_now())
    return write_status(directory, "unknown", message="unrecognized scheduler state %s" % state_word)


def status(job_id):
    directory = ensure_prepared(job_id)
    value = read_json(status_path(directory), None)
    if not isinstance(value, dict):
        raise RunnerError("corrupt-status", "status.json is missing or invalid")
    if value.get("schedulerJobId") and scheduler_kind() == "slurm":
        return slurm_state(directory, value)
    if value.get("state") in ("queued", "running"):
        pid = value.get("pid")
        if isinstance(pid, int) and process_matches(pid, value.get("processStartMarker")):
            value["state"] = "running"
            return value
        # A missing worker with no terminal status is an unknown outcome.  Do
        # not infer success from process disappearance.
        return write_status(directory, "unknown", message="worker process is no longer present")
    return value


def decode_cursor(cursor):
    if not cursor:
        return {"events": 0, "stdout": 0, "stderr": 0}
    try:
        value = json.loads(base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8"))
        if isinstance(value, dict):
            return {name: max(0, int(value.get(name, 0))) for name in ("events", "stdout", "stderr")}
    except (ValueError, TypeError, binascii.Error, UnicodeError):
        pass
    try:
        return {"events": max(0, int(cursor)), "stdout": 0, "stderr": 0}
    except ValueError:
        raise RunnerError("invalid-cursor", "logs cursor is invalid")


def encode_cursor(value):
    return base64.urlsafe_b64encode(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")).decode("ascii")


def read_increment(path, offset, budget):
    try:
        size = os.path.getsize(path)
    except OSError:
        return b"", offset, False
    if offset > size:
        offset = 0
    read_size = min(max(0, size - offset), budget)
    try:
        with open(path, "rb") as handle:
            handle.seek(offset)
            data = handle.read(read_size)
    except OSError:
        return b"", offset, False
    return data, offset + len(data), offset + len(data) < size


def logs(job_id, payload):
    directory = ensure_prepared(job_id)
    cursor = decode_cursor((payload or {}).get("cursor") if isinstance(payload, dict) else None)
    entries = []
    next_cursor = dict(cursor)
    remaining = MAX_LOG_BYTES
    any_truncated = False
    for stream, filename in (("events", "events.jsonl"), ("stdout", "stdout.log"), ("stderr", "stderr.log")):
        if remaining <= 0:
            break
        data, offset, truncated = read_increment(directory / filename, cursor[stream], remaining)
        any_truncated = any_truncated or truncated
        next_cursor[stream] = offset
        remaining -= len(data)
        for line in data.splitlines():
            text = line.decode("utf-8", "replace")
            at = utc_now()
            if stream == "events":
                parsed = read_json_line(text)
                if isinstance(parsed, dict):
                    at = parsed.get("at") or at
                    text = json.dumps(parsed, sort_keys=True, separators=(",", ":"))
            stream_name = "event" if stream == "events" else stream
            entries.append({"timestamp": at, "stream": stream_name, "type": stream_name,
                            "at": int(time.time() * 1000), "text": text})
    next_value = encode_cursor(next_cursor)
    # ``entries`` is the runner protocol spelling; ``events``/``cursor`` are
    # retained as a small compatibility projection for the host adapter.
    return {"jobId": job_id, "cursor": next_value, "nextCursor": next_value,
            "entries": entries, "events": entries, "truncated": any_truncated}


def read_json_line(text):
    try:
        return json.loads(text)
    except ValueError:
        return None


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def collect(job_id, payload):
    directory = ensure_prepared(job_id)
    output_root = directory / "outputs"
    max_bytes = MAX_COLLECT_BYTES
    requested = (payload or {}).get("maxBytes") if isinstance(payload, dict) else None
    if requested is not None:
        if isinstance(requested, bool) or not isinstance(requested, int) or requested <= 0:
            raise RunnerError("invalid-collect-limit", "maxBytes must be positive")
        max_bytes = min(max_bytes, requested)
    wanted = None
    expected = (payload or {}).get("manifest") if isinstance(payload, dict) else None
    if isinstance(expected, list):
        wanted = set()
        for item in expected:
            path = item.get("path") if isinstance(item, dict) else item
            wanted.add(safe_relative_path(path, "manifest path"))
    entries = []
    total = 0
    if output_root.is_symlink():
        raise RunnerError("symlink-output", "collect refuses a symlink outputs directory")
    if output_root.exists():
        for base, dirs, files in os.walk(str(output_root), followlinks=False):
            for directory_name in list(dirs):
                if (Path(base) / directory_name).is_symlink():
                    raise RunnerError("symlink-output", "collect refuses symlink output directory %s" % directory_name)
            dirs[:] = sorted(dirs)
            files[:] = sorted(files)
            for name in files:
                absolute = Path(base) / name
                relative = absolute.relative_to(output_root).as_posix()
                safe_relative_path(relative, "output path")
                if wanted is not None and relative not in wanted:
                    continue
                if absolute.is_symlink() or not absolute.is_file():
                    raise RunnerError("symlink-output", "collect refuses symlink or non-file output %s" % relative)
                size = absolute.stat().st_size
                total += size
                if total > max_bytes:
                    raise RunnerError("collect-limit", "output manifest exceeds the collection limit")
                entries.append({"path": relative, "bytes": size, "size": size, "sha256": sha256_file(absolute), "symlink": False})
    if wanted is not None:
        observed = {entry["path"] for entry in entries}
        missing = sorted(wanted - observed)
        if missing:
            raise RunnerError("missing-output", "expected output is missing: %s" % ", ".join(missing))
    manifest = {"version": 1, "entries": entries, "totalBytes": total, "maxBytes": max_bytes}
    atomic_json(directory / "collected-manifest.json", manifest)
    return {"jobId": job_id, "manifest": manifest}


def cancel(job_id):
    directory = ensure_prepared(job_id)
    value = read_json(status_path(directory), {})
    if value.get("state") in ("succeeded", "failed", "cancelled"):
        return value
    scheduler_id = value.get("schedulerJobId")
    if scheduler_id:
        try:
            result = subprocess.run(["scancel", str(scheduler_id)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise RunnerError("cancel-unknown", "scancel could not be invoked: %s" % error, True)
        if result.returncode != 0:
            raise RunnerError("cancel-failed", result.stderr.decode("utf-8", "replace").strip() or "scancel failed", True)
    elif isinstance(value.get("pid"), int) and process_matches(value["pid"], value.get("processStartMarker")):
        child = read_json(directory / "child.json", {})
        if isinstance(child, dict) and isinstance(child.get("pid"), int) and process_matches(child["pid"], child.get("startMarker")):
            terminate_process_group(child["pid"])
        terminate_process_group(value["pid"])
    else:
        raise RunnerError("cancel-unknown", "worker process is not present", True)
    return write_status(directory, "cancelled", finishedAt=utc_now(), message="cancelled by request")


def dispatch(request):
    if not isinstance(request, dict):
        raise RunnerError("invalid-message", "runner request must be an object")
    if request.get("protocolVersion") != PROTOCOL_VERSION:
        raise RunnerError("protocol-mismatch", "unsupported runner protocol version")
    request_id = request.get("requestId")
    if not isinstance(request_id, str) or not request_id:
        raise RunnerError("invalid-message", "requestId must be non-empty")
    command = request.get("command")
    if command not in ("version", "capabilities", "prepare", "start", "status", "logs", "cancel", "collect"):
        raise RunnerError("unsupported-command", "unsupported runner command")
    if command == "version":
        return {"runnerVersion": RUNNER_VERSION, "version": RUNNER_VERSION, "protocolVersion": PROTOCOL_VERSION,
                "compatibleVersions": [RUNNER_VERSION]}
    if command == "capabilities":
        return capabilities()
    job_id = request.get("jobId")
    if command == "prepare":
        payload = request.get("payload") if isinstance(request.get("payload"), dict) else {}
        spec = payload.get("spec")
        job_id = validate_spec(spec) if isinstance(spec, dict) else job_id
    job_id = validate_job_id(job_id)
    if command == "prepare":
        return prepare(request, job_id)
    if command == "start":
        return start(request, job_id)
    if command == "status":
        return status(job_id)
    if command == "logs":
        return logs(job_id, request.get("payload"))
    if command == "cancel":
        return cancel(job_id)
    if command == "collect":
        return collect(job_id, request.get("payload"))
    raise RunnerError("unsupported-command", "unsupported runner command")


def protocol_main(command_hint=None):
    raw = sys.stdin.read()
    try:
        request = json.loads(raw)
        if command_hint and isinstance(request, dict) and request.get("command") != command_hint:
            raise RunnerError("invalid-message", "command argument does not match request command")
        payload = dispatch(request)
        response = {"protocolVersion": PROTOCOL_VERSION, "requestId": request.get("requestId"), "ok": True, "payload": payload}
    except RunnerError as error:
        response = {"protocolVersion": PROTOCOL_VERSION, "requestId": request.get("requestId") if isinstance(locals().get("request"), dict) else None,
                    "ok": False, "error": {"code": error.code, "message": str(error), "retryable": error.retryable}}
    except Exception as error:
        response = {"protocolVersion": PROTOCOL_VERSION, "requestId": request.get("requestId") if isinstance(locals().get("request"), dict) else None,
                    "ok": False, "error": {"code": "runner-internal", "message": str(error), "retryable": False}}
    sys.stdout.write(json.dumps(response, sort_keys=True, separators=(",", ":")) + "\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--worker":
        sys.exit(worker(sys.argv[2]))
    # The command-line hint is only a routing guard; the protocol remains the
    # source of truth and all data still arrives through stdin JSON.
    sys.exit(protocol_main(sys.argv[1] if len(sys.argv) >= 2 and not sys.argv[1].startswith("-") else None))
