# Generic structured model capability slice (2026-10-28)

This is a source/real-SDK slice, not formal packaged GUI acceptance or complete P2 migration.

- `model.selection` resolves the current live caller's actual provider/model/thinking and an explicitly configured named preference. Missing preferences/providers/auth fail before sending data; no provider fallback is invented.
- `model.generate` uses one independent SDK completion with only `structured_result`, schema-checks its return, never inherits the parent transcript, executes no model tools and returns no thinking. It works from an active parent native tool; foreground knowledge idle policy stays in the plugin.
- `session.inspect(null)` reports the authenticated caller's actual `agentActive` state. It does not claim synchronous SDK `isIdle` semantics.
- Only installed manifest `permissions.network: ["configured-services"]` grants model handlers. Main derives `requestsModel`; changing that installed source declaration revokes bindings. UI input cannot assert this permission.
- Each generation needs the existing write approval with provider/model/thinking, output-token bound and data/cost warning. The execution resolves the actual model again and rejects mismatches; default SDK zero cost with no usable price remains `null` (unknown).
- Capability caller identity, selection, trust, writable state and revocation are checked before/after asynchronous work. Cancellation reaches the actual provider signal. Ordinary SDK tools remain usable after rejection/cancellation.

## Observed checks

- Actual Pi 1.1.0 SDK: `plugin-model-capabilities-sdk.test.mjs`, 6/6 pass. Includes isolated model context, denied/forged/stale/application/untrusted selection, bad output/forbidden tool, selection changed in-flight, active-parent native tool and provider cancellation followed by a successful request. Log: `/tmp/model-owner-sdk.log`.
- Desktop installed-source/bridge/resource regressions: 72/72 pass, `/tmp/model-owner-source-tests.log`.
- Backend and Desktop typechecks pass (`/tmp/model-owner-{backend,desktop}-tsc.log`).
- Biome on 11 changed source/test files and `check:arch` pass (`/tmp/model-owner-{biome,arch}.log`).

## Boundary checks introduced

The checks are at plugin/network/session trust boundaries: authenticated live caller; trusted/writable selected session; configured profile/provider/auth; current model identity before/after awaits; request byte bound; plugin schema declaration; model stop reason/exact result tool; returned JSON argument schema; missing price/telemetry. The provider catch only sanitizes external error text and rethrows. None turns a failed request into success. No retry/config/cache/compatibility layer was added.

## Remaining

UI single-invocation cancellation transport, canonical Wiki model-review owner integration and its same-tarball/UI acceptance are still in progress. Published legacy UI 1.x named knowledge methods retain their real behavior. This slice does not remove `knowledge.specialist-runner`, close full native hooks/publication authority, or prove any formal macOS installer behavior. Root combined gates must run after integration.


## Invocation cancellation and real bridge identity follow-up

The first 6-test SDK slice used a direct broker caller. A production bridge check found that window-selection identity and SessionRegistry identity were different host facts. The bridge keeps the selection identity for approval routing, and now supplies a separate host-only `sessionIdentity` to capability handlers. It never crosses plugin JSON or worker transport. Actual SDK coverage now includes two windows selecting the same live session: deny routes to window 202, allow and model-cost approval route only to window 101; the model executes once.

The add-only UI `invoke(operation, input, signal?)` sends an optional request ID through existing invoke IPC and a separate cancel IPC. Active invocations belong to their binding, window and selection lease. Cancellation reaches the existing registry signal, pending approval's parent-window Electron dialog and actual provider request; it drains that invocation's cleanup. No process-global or cross-session ledger was added. Missing/completed IDs return false; foreign window/binding/selection is rejected. Existing two-argument UI and four-argument IPC are preserved.

Observed source checks: real SDK 8/8 with provider cancellation, stale selection rejection, restored successful generation and real coordinator-native bootstrap model calls (`/tmp/model-cancel-native-sdk-final.log`); coordinator 4/4 including sibling isolation, exact window/lease enforcement and blocked-approval late allow (`/tmp/model-cancel-coordinator.log`); Desktop/preload/renderer 46/46 (`/tmp/model-cancel-desktop-final.log`), plus IPC legacy/new request schema regression (`/tmp/model-cancel-ipc-final.log`). Backend/Desktop typechecks, plugin-api build and generated projections pass. These are mechanism/real-session checks, not formal installed-app GUI acceptance.

The new checks are live IPC authorization boundaries (window, binding, lease and duplicate active request ID); renderer pre-abort avoids dispatch; cancellation IPC failures remain explicit. Electron's installed `MessageBoxOptions.signal` closes the existing parent-window prompt. Promise settlement handling waits for both invocation and cancel transport and surfaces either failure instead of reporting success.
