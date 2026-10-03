# Compute runner

`runner.py` is deployed as a versioned resource and invoked with Python 3.8+
or newer. Every invocation reads one JSON request from stdin and writes one
JSON response to stdout:

```json
{"protocolVersion":1,"requestId":"...","command":"status","jobId":"..."}
```

The supported commands are `version`, `capabilities`, `prepare`, `start`,
`status`, `logs`, `cancel`, and `collect`. A run is persisted below
`$DRONE_REMOTE_ROOT/runs/<jobId>`; direct workers are detached into their own
process group and keep running when the request or SSH session exits.

Production execution only accepts a workflow registered by the host (or the
built-in fixed nf-core/rnaseq revision). The fixture switch is intentionally
explicit: tests must set `DRONE_RUNNER_FIXTURE=1` and provide a real executable
argv through `DRONE_RUNNER_FIXTURE_ARGV` as JSON. There is no shell command
field and the production runner never fabricates successful output.
