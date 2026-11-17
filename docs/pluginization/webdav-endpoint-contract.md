# WebDAV endpoint configuration and runtime allowlist contract

Status: proposal for manager review, 2026-11-17; no implementation or release approval.
Scope: W2f in Drone and W2e in drone-plugins. The approved option A adds the endpoint's exact
host:port at runtime only for `@gyoungwe/pi-knowledge` and its `webdav` credential slot while
`DRONE_WEBDAV_ENDPOINT` is set. Settings must show the endpoint actually used.
Approval categories, credential storage, and UI wording remain decisions below. B8 stays deferred.

## 1. Current behavior

Citations without a repository prefix are relative to Drone at `e6499cb99c67df0746b646569878cbac8f87f5b3`.
`drone-plugins:` citations are relative to that separate repository, inspected locally at
`5e5d69ea4ed9ccad3358ca0ccbde11eb15d9c73c`; they are not claims about its remote head.

| Surface | Observed behavior and evidence |
| --- | --- |
| Legacy host endpoint | `packages/backend/src/knowledge/webdav.ts:24` defines `http://10.126.126.1:8080`; its constructor at `packages/backend/src/knowledge/webdav.ts:65` selects injected endpoint, then `process.env.DRONE_WEBDAV_ENDPOINT`, then that default. Status exposes the transport endpoint at `packages/backend/src/knowledge/webdav.ts:110`. |
| Legacy validation | `packages/backend/src/services/webdav-transport.ts:155` parses the endpoint, permits HTTP(S) roots without userinfo/query/fragment, and stores `url.origin` at `packages/backend/src/services/webdav-transport.ts:173`. This transport does not configure the managed plugin. |
| Managed plugin endpoint | `drone-plugins:packages/pi-knowledge/src/desktop/cloud.ts:52` defines the same default; `endpointOrigin` at `drone-plugins:packages/pi-knowledge/src/desktop/cloud.ts:73` validates an HTTP(S) root. `CloudService` accepts an optional endpoint at `drone-plugins:packages/pi-knowledge/src/desktop/cloud.ts:113`, but its managed caller supplies none at `drone-plugins:packages/pi-knowledge/src/desktop/cloud-runtime.ts:38`. Separately, HTTP requests hard-code `${DEFAULT_WEBDAV_ENDPOINT}/${input.path}` at `drone-plugins:packages/pi-knowledge/src/desktop/cloud-capabilities.ts:81`. Changing only CloudService would leave requests on the old endpoint. |
| Source manifest | `drone-plugins:packages/pi-knowledge/plugin.manifest.json:13` declares `webdav`, `hosts: ["10.126.126.1:8080"]`, `Authorization`, empty fields, and `http-basic-digest`; `drone-plugins:packages/pi-knowledge/plugin.manifest.json:87` declares that host in `permissions.network`. |
| Vendored snapshot differs | `vendor/plugins/pi-knowledge/plugin.manifest.json:10` has no credentials declaration; `vendor/plugins/pi-knowledge/plugin.manifest.json:77` contains only `configured-services`. `vendor/plugins/pi-knowledge/dist/index.d.ts:3` identifies the package; `vendor/plugins/pi-knowledge/dist/desktop/runtime.d.ts:2` declares the runtime factory, without endpoint configuration. The inspected vendored declarations contain no cloud endpoint contract. Do not present this snapshot as the W2 cloud artifact; D7 gates integration. |
| Manifest decoding | `packages/desktop/src/main/ui-plugins/network-declaration.ts:58` removes `configured-services` from actual network hosts. Slot hosts must be a subset of declared network hosts at `packages/desktop/src/main/ui-plugins/network-declaration.ts:26`. `PluginRuntimeSource` carries these separate declarations at `packages/backend/src/plugins/plugin-source.ts:34`. |
| Network refusal | `declaredTarget` at `packages/backend/src/plugins/network-capabilities.ts:24` compares literal entries against `URL.host`; `target` rejects an undeclared host before transport at `packages/backend/src/plugins/network-capabilities.ts:90`. A custom endpoint fails even if its password is configured. |
| Credential refusal and attachment | `credentialSlot` at `packages/backend/src/plugins/plugin-credentials.ts:97` checks the requested slot and its exact hosts before secret access. `credentialHeader` at `packages/backend/src/plugins/plugin-credentials.ts:112` uses that check and refuses literal-header attachment for HTTP authentication slots. `authenticatedRequest` at `packages/backend/src/plugins/http-transport.ts:21` uses the same slot check, then resolves the password only inside the sender at `packages/backend/src/plugins/http-transport.ts:29`. A host admitted by networking alone cannot receive the slot credential. |
| Current composition and secrets | `packages/backend/src/plugins/source-capabilities.ts:23` supplies source network hosts and binds header/authentication callbacks to that source. `packages/backend/src/plugins/credential-override.ts:30` selects a nonempty password environment override only for pi-knowledge's `webdav` HTTP authentication slot; it reads no endpoint. `packages/backend/src/plugins/host-kept-credentials.ts:4` recognizes only the exact pi-research Zotero slot. |
| Persistence identity | `packages/backend/src/plugins/plugin-credentials.ts:35` hashes slot hosts/header/fields/authentication into the saved credential key. Mutating hosts before store lookup would change which saved password is found. Settings resolves and saves against the declared definition at `packages/desktop/src/main/ipc/plugin-credentials.ts:37` and `packages/desktop/src/main/ipc/plugin-credentials.ts:55`. |

The public runtime already provides schema-checked named capability calls, rather than environment access
(`packages/plugin-api/src/runtime.ts:44`). Its factory and per-operation contexts are separate
(`packages/plugin-api/src/runtime.ts:96`, `packages/plugin-api/src/runtime.ts:107`). The recent agent-slot
addition uses a small module and runtime re-export (`packages/plugin-api/src/runtime-agent-slot.ts:15`,
`packages/plugin-api/src/runtime.ts:1`); use that additive pattern. API 1.3 remains a private candidate
as described in `packages/plugin-api/README.md`.

## 2. Config channel

| Option | Consequences | Recommendation |
| --- | --- | --- |
| A: read-only `config.endpoint` capability | Reuses the existing broker, caller binding, JSON schemas, cancellation, and restricted-worker protocol. Re-read on each operation; endpoint changes do not require capturing a factory snapshot. | Recommend, subject to D1. |
| B: optional `endpointConfiguration` field on `PluginRuntimeFactoryContext` | Additive and non-secret, but requires factory/worker serialization changes, duplicates operation-time metadata, and becomes stale when the host environment changes. | Do not select for this per-call contract. |

Proposed exact addition in `packages/plugin-api/src/runtime-config.ts`, re-exported from `./runtime`:

```ts
import type { PluginRuntimeCapabilities } from "./runtime.js";

export interface PluginEndpointConfigurationInput {
  readonly slot: string;
}

export type PluginEndpointConfigurationResult =
  | {
      readonly state: "ready";
      readonly endpoint: string;
      readonly source: "default" | "env";
    }
  | {
      readonly state: "invalid";
      readonly endpoint: null;
      readonly source: "env";
      readonly reason: "invalid_endpoint";
    };

export async function readPluginEndpointConfiguration(
  capabilities: PluginRuntimeCapabilities,
  input: PluginEndpointConfigurationInput,
  signal?: AbortSignal,
): Promise<PluginEndpointConfigurationResult> {
  return (await capabilities.call(
    "config.endpoint", input, signal,
  )) as PluginEndpointConfigurationResult;
}
```

This addition does not add a context member or permit arbitrary environment reads.
Call: `readPluginEndpointConfiguration(call.capabilities, { slot: "webdav" }, call.signal)`.
The host accepts exactly `{ slot: string }` (1–64 characters, no extra properties), resolves plugin identity
from the bound source, and registers this handler only for the eligible source/slot defined in section 3.
An unknown slot is refused with fixed code `EPLUGINENDPOINTSLOT`; callers cannot submit a plugin ID,
endpoint, host, password, or environment-variable name. Results use closed host-validated JSON schemas,
HTTP(S) endpoint length at most 4096, and the exact union above. No credential metadata is folded into
this result; credential status keeps its existing port.

Proposed handler: `effect: "read"`, normal invocation authority, no bootstrap access and no new approval
category pending D3. It performs no IO. A host without the capability yields existing unavailable handling;
the adopted managed plugin reports `host_unsupported` and performs no cloud network request. Do not catch
all configuration failures and silently use the compiled default. No new Electron IPC method is required.

In W2e, `cloud-runtime.ts` reads configuration once per operation before constructing the client, and
passes the same validated endpoint to both `new CloudService({ http, endpoint })` and
`createCloudHttp(capabilities, signal, endpoint)`. `cloud-capabilities.ts` builds every URL from that
argument. `cloud.ts` retains `endpointOrigin` at its input boundary and the compiled default for its
existing non-managed consumers; managed calls always supply the host value. Preserve username, folder,
note-path validation, manual operations, and readback semantics. Do not give the worker `process.env`.
Extend the plugin's closed status/result schemas for `invalid_endpoint` and `endpoint_changed`;
map only the host's fixed `EPLUGINENDPOINTCHANGED` code to the latter, without exposing raw diagnostics.

## 3. Runtime allowlist

### One resolver and explicit consumers

Propose the pure `resolvePluginEndpointPolicy(source, rawEndpoint)` in
`packages/backend/src/plugins/endpoint-policy.ts`. The composition boundary passes only
`process.env.DRONE_WEBDAV_ENDPOINT`, read afresh for source capability execution. No module singleton,
manifest rewrite, persisted endpoint, or environment forwarding to a worker is introduced.
Its default is the reviewed literal `http://10.126.126.1:8080`; do not infer a scheme or port from
manifest hosts, or import the legacy domain service to obtain it.

The function returns configuration plus effective network hosts, effective credential hosts by slot,
and an optional runtime grant containing `{ endpoint, hostPort, slot: "webdav" }`. Only it computes
the unions. `sourceCapabilityHandlers` supplies that policy to `config.endpoint`, `network.*`, and
credential host checks. Settings uses the same resolver, never its own environment parser.
Keep the discovered `PluginRuntimeSource` and its original slot definitions immutable; `sameSource`
continues to describe installed bytes/declarations rather than a transient environment value.

Eligibility requires the installed package identity `source.pluginId === "@gyoungwe/pi-knowledge"`
(not manifest ID `drone-pi-knowledge`), an actual declared `webdav` slot with
`authentication: "http-basic-digest"`, `header: "Authorization"`, `fields: []`, and the reviewed
default host declared in both original lists. A package lacking that declaration gains nothing;
in particular the current vendored snapshot must not receive a synthetic slot. Retain existing
package discovery/trust and activation checks; a caller-supplied identity cannot activate this rule.

For an eligible source, let `N` be its declared `networkHosts`, `C(s)` its declared slot hosts,
and `H` the single canonical host:port from a valid environment value:

| Input/source | Effective `NetworkDeclaration.hosts` | Effective credential destination hosts |
| --- | --- | --- |
| Env absent | `N` | `C(s)` for every slot |
| Env valid, eligible pi-knowledge | deduplicated `N ∪ {H}` | `C(webdav) ∪ {H}`; every other `C(s)` unchanged |
| Env invalid, eligible pi-knowledge | `N`, with no runtime grant | Original sets; reject WebDAV execution before secret lookup or network IO |
| Any other plugin or ineligible declaration | Its original `N` | Its original `C(s)`; no endpoint capability/runtime grant |

Concretely, replace the direct `hosts: source.networkHosts` binding in `source-capabilities.ts` with
the resolved set, and let `credentialSlot` check the policy's destination set before returning the
**original** slot. Both `credentialHeader` and `authenticatedRequest` consume that check. Never pass
an expanded slot into `PluginCredentialStore.get/resolve/save/clear`; D2 governs storage identity.
No `networkReads` entry is added: POST remains a write and PROPFIND remains Depth 0.

The additional runtime entry is admitted only when the actual URL's normalized origin equals the
selected endpoint AND the request names `credential: "webdav"` with the existing HTTP auth metadata.
Requests without a slot or with another slot cannot use the added permission. Existing manifest
permissions continue to work independently; this origin constraint applies to the runtime addition.
Credential destination checking enforces the same constraint before password resolution.

### Parsing and failures (proposed policy, D4/D5)

- Absent means `undefined`. A present empty or whitespace-only value is invalid, not unset.
- Require an absolute `http://` or `https://` root with an explicit decimal port in `1..65535`.
  Never prepend a scheme, invent a port, probe alternatives, or accept a wildcard/subdomain pattern.
  Reject surrounding/interior whitespace, controls, backslashes, userinfo (including an empty `@`),
  an empty port, query/fragment delimiters even if empty, and raw non-root paths before URL normalization.
- Permit no slash or one terminal `/`; emit the normalized origin without a trailing slash.
  Reject `/dav`, `//`, dot segments and encoded path segments; do not strip a supplied path and
  accidentally authorize a broader origin. Folder and note paths are appended by existing plugin code.
- Use standard URL hostname normalization (case, IDNA, IP serialization), without DNS lookups or aliases.
  Require bracketed IPv6, e.g. `https://[2001:db8::1]:8443/`; reject unbracketed IPv6 and zone identifiers.
  Preserve brackets in the host:port key. The explicit port is stored as its canonical decimal integer.
- Explicit default ports are valid: `https://dav.example:443/` grants only `dav.example:443`.
  WHATWG URL serialization removes that port from `URL.host`/`origin`; retain the parsed explicit
  host:port alongside the origin. For the added entry compare `url.origin === grant.endpoint`, rather
  than treating a portless `URL.host` as an all-ports host or changing the legacy manifest matcher.
  An equivalent request URL omitting `:443` denotes the same HTTPS socket; `http://dav.example`,
  `https://dav.example:8443`, aliases, and subdomains do not match. No cross-scheme runtime grant exists.
- On invalid input, return only `{ state: "invalid", endpoint: null, source: "env",
  reason: "invalid_endpoint" }`; WebDAV operations fail with `invalid_endpoint`, with no default fallback.
  Settings shows the approved invalid-configuration message and disables probe/initialize/sync.
  Other plugin capabilities remain usable. Never echo the raw value, URL-parser exception, userinfo,
  headers, or password into errors, IPC, approval details, or logs.
- Re-evaluate before authorization details and execution. If the environment changes during approval,
  reject with fixed code `EPLUGINENDPOINTCHANGED` before sending, and require a fresh operation/approval;
  do not reuse approval for a new destination. Clearing/changing the env revokes the old extra host on
  the next request, including requests from retained worker/client closures. The transport sender
  rechecks after asynchronous secret resolution and before every Basic/Digest attempt, with no await
  between its final policy check and invoking fetch. A changed/cleared value prevents challenge replay.
  An HTTP request already sent cannot be recalled; document that limit. Normal deployment changes the launch environment and
  restarts Drone; no UI setter or watcher is proposed.

The confinement argument is local: the only set-union branch requires the exact source identity and
declared slot; its only added element is `H`; the credential map changes only key `webdav`; both gates
check the same origin; all other sources return their unmodified policy. Unit and real-worker tests
must exercise each premise. Preserve reserved Authorization headers, challenge scoping, bounded responses,
and redirect refusal (`packages/backend/src/plugins/http-transport.ts:37`,
`packages/backend/src/plugins/http-transport.ts:69`, `packages/backend/src/plugins/http-transport.ts:97`).

## 4. Settings display

`connector:webdav` belongs to Knowledge settings, not a new connections drawer
(`packages/desktop/src/renderer/src/components/workbench/SkillsConnectionsView.tsx:345`). The managed
panel is mounted in `drone-plugins:packages/pi-knowledge/ui/NativeKnowledgePreferences.tsx:188`;
`drone-plugins:packages/pi-knowledge/ui/NativeKnowledgeCloud.tsx:32` currently shows credential status
but no endpoint. Its `cloudStatus` contract also lacks endpoint metadata
(`drone-plugins:packages/pi-knowledge/src/desktop/cloud-contract.ts:11`).

Propose a read-only row under the cloud title: `Effective endpoint: https://dav.example:8443`, followed
by its endpoint source (`default`/`env`), distinct from password source. Render the validated full
origin, selectable and wrapping, without an editor or automatic probe. On invalid configuration show
the fixed message below and no purported effective URL. On unsupported hosts retain unavailable status.
Render the HTTP warning only when the effective endpoint is HTTP, removing the current hard-coded
default URL from that warning. A valid endpoint must remain visible even when no password is configured.

Also project optional endpoint configuration on the WebDAV entry returned by existing
`listPluginCredentials`; show the same row in Settings → UI plugins → Plugin credentials, and show
the effective host union under its existing allowed-host label. Add a closed optional result field to
`packages/shared/src/host-api/plugin-credentials.ts`, not secret-bearing `values` or save arguments.
Keep the original slot for save/clear. Reuse the existing IPC/preload method; verify its typed
passthrough. The plugin panel uses its own `cloudStatus` operation over the existing runtime bridge.

All proposed new/replacement text is pending D6. These keys must be present in both host dictionaries
`packages/desktop/src/renderer/src/i18n/zh.ts` and `packages/desktop/src/renderer/src/i18n/en.ts`;
the plugin-owned equivalent keys live in `packages/pi-knowledge/ui/native-cloud-copy.ts`.

| Proposed key under `settings.uiPlugins` / plugin equivalent | zh (verbatim) | en (verbatim) |
| --- | --- | --- |
| `webdavEffectiveEndpoint` / `effectiveEndpoint` | 生效地址 | Effective endpoint |
| `webdavEndpointDefault` / `endpointDefault` | 使用默认地址。 | Using the default endpoint. |
| `webdavEndpointEnv` / `endpointEnv` | 地址来自环境变量 DRONE_WEBDAV_ENDPOINT。 | Endpoint from environment variable DRONE_WEBDAV_ENDPOINT. |
| `webdavEndpointInvalid` / `reasons.invalid_endpoint` | DRONE_WEBDAV_ENDPOINT 无效；云端操作已停用。请设置带明确端口、无凭据和路径参数的 HTTP(S) 根地址，然后重启 Drone。 | DRONE_WEBDAV_ENDPOINT is invalid; cloud operations are disabled. Set an HTTP(S) root URL with an explicit port and no credentials or path parameters, then restart Drone. |
| `webdavEndpointChanged` / `reasons.endpoint_changed` | WebDAV 地址已变化；请刷新状态后重试。 | The WebDAV endpoint changed. Refresh status and try again. |
| `webdavEndpointUnsupported` / `reasons.host_unsupported` | 此 Drone 版本尚不支持 WebDAV 地址配置；请更新 Drone。 | This Drone version does not support WebDAV endpoint configuration yet; update Drone. |
| `webdavEndpointHttpWarning` / `httpWarning` | 当前地址使用未加密的 HTTP；请仅在可信网络中使用。 | The current endpoint uses unencrypted HTTP; use it only on a trusted network. |

## 5. Test plan

All tests below are planned, NOT_RUN by this docs ticket. Write and observe each failing behavior
before implementing that slice; use synthetic temporary state only, with no personal credentials.

| Layer | Required failing-first cases |
| --- | --- |
| Drone pure resolver | Unset → compiled default config and declared default host only; valid env → one additional host for the eligible package/slot, duplicate default deduplicated; input declarations remain unchanged. Other plugin with a `webdav` slot, another slot in pi-knowledge, absent slot, different auth mode, and the old vendored manifest gain nothing. |
| Parsing | HTTP/HTTPS, trailing slash, DNS case, IPv4, bracketed IPv6, explicit `:80`/`:443`, and non-default ports; reject missing scheme/port, empty/whitespace, wildcard, port 0/65536, userinfo, queries/fragments, paths/dot segments/encoded paths/backslashes, unbracketed/scoped IPv6. Assert fixed diagnostics, never raw input. |
| Broker and credentials | Valid override passes both gates only for `webdav`; different port, scheme, host alias/subdomain, no credential, or another slot is refused before secret lookup/fetch. Another plugin requesting that exact host without declaring it remains refused, even after pi-knowledge succeeds. Reserved Authorization and credential-free raw requests cannot bypass the broker. |
| Identity and lifetime | Saved password remains selectable under the approved D2 policy when endpoint env toggles; env password precedence and Zotero rules remain unchanged. Set A → B → unset/invalid in one host lifetime; old closures cannot reach A after revocation. Change during write approval sends nothing and reports changed endpoint. Change during asynchronous password lookup or after the initial challenge prevents authenticated replay. Redirect to another host/port sends no credentials there. |
| API and display | Packed API exports/types work without Node/Electron/Pi imports. Extra config input fields and wrong plugin/slot are rejected. Settings and cloudStatus show identical effective endpoint/source for default/env/invalid/no-password; no network on opening either panel. Both languages, long origins/IPv6, conditional HTTP warning, unsupported host, disabled/re-enabled owner, and stale UI replies are covered. |
| Disclosure | Invalid endpoint containing synthetic userinfo, transport errors, auth challenge/error bodies, and blocked calls never put passwords, Authorization/challenge material, or raw invalid env into capability errors/results, worker IPC, credential-list IPC, approval details, logs, or rendered text. Assert absence without printing the forbidden material. |
| drone-plugins | Mock capability tests first show both CloudService.endpoint and all GET/PROPFIND/MKCOL/PUT URLs use the returned endpoint; changes between operations update both. Invalid/unsupported config sends no request; `cloudStatus` remains read-only and returns safe endpoint metadata. Existing sync/readback and missing-password behavior remain intact. |

For actual packed acceptance, add `packed-knowledge-webdav-endpoint-sdk.test.mjs` and a focused
`packed-knowledge-webdav-endpoint-fixture.mjs`; reuse the existing fixture where possible without
growing its 383-line SDK test. Install the manager-selected real pi-knowledge tarball, discover its
manifest, and start the real coordinator, restricted worker and actual SDK session. With env unset,
retain the existing default-endpoint IO seam regression; with env set to a loopback DAV server's
explicit port, send directly to that server and assert the pre-transport origin and both gates.
Do not rewrite the selected endpoint to make a failed declaration pass. The old fixture rewrites only
the compiled default (`packages/backend/test/packed-knowledge-webdav-fixture.mjs:138`) and alone cannot
prove the new contract. Add a denied second plugin and second port, Digest/Basic exchanges, denied write,
approved synthetic write/readback, env removal, invalid input, UI/native shared owner, and shutdown.
No account writes or deletion are authorized here. Missing tarball/runtime/port permission means NOT_RUN
or BLOCKED, never a final PASS. A real installed-app Settings check is still required for UI completion.

## 6. Implementation split

Manager ticket proposals, in dependency order; none is authorization to edit these files in T98.
Keep every source/test file ≤400 lines and every new function ≤60; split first rather than grow
an existing over-limit file. Use new focused tests instead of enlarging the 393-line HTTP transport test.
Keep generated artifacts separate from source commits. The manager owns commits and the index entry.

1. **W2f-core — API member, host resolver and both destination gates.** Depends on D1–D5 and D7's
   reviewed W2 slot definition. Drone files: new `packages/plugin-api/src/runtime-config.ts` and
   `packages/plugin-api/test/runtime-config.test.mjs`; `packages/plugin-api/src/runtime.ts`,
   `packages/plugin-api/README.md`; new backend `src/plugins/endpoint-policy.ts`,
   `endpoint-policy.test.ts`, `endpoint-config-capabilities.ts`, `endpoint-config-capabilities.test.ts`,
   `network-endpoint.test.ts`, `credential-endpoint.test.ts`; existing backend
   `src/plugins/{source-capabilities,network-capabilities,plugin-credentials,http-transport}.ts`;
   `docs/architecture-v2.md` and `docs/INDEX.md` to register the new boundary/modules.
   Keep policy state out of `PluginRuntimeSource`; keep store format and `credential-override.ts`
   unchanged if D2 selects the recommendation. Checks from Drone root:
   `npm run test -w @gyoungwe/plugin-api`;
   `./node_modules/.bin/vitest run --config packages/backend/vitest.config.ts --project unit packages/backend/src/plugins/endpoint-policy.test.ts packages/backend/src/plugins/endpoint-config-capabilities.test.ts packages/backend/src/plugins/network-endpoint.test.ts packages/backend/src/plugins/credential-endpoint.test.ts`;
   then the full host gate below. W2f-core can establish unit behavior before W2e exists; do not claim integration.
2. **W2f-freeze — freeze the additive API candidate for both repositories.** Depends on accepted
   W2f-core and manager commits. Files: identical new `vendor/gyoungwe-plugin-api-1.3.0-<hash8>.tgz`
   in Drone and drone-plugins; drone-plugins root `package.json` and `package-lock.json` only for the
   private development candidate. Select the suffix from the actual frozen candidate; record both
   commits and byte hash. Do not alter published plugin dependency rules or hand-edit dist.
   Existing policy requires committed identical artifacts and matching integrity
   (`scripts/plugin-api-dependency-policy.mjs:26`). Checks: build/pack with
   `npm run build -w @gyoungwe/plugin-api` and `npm pack --workspace @gyoungwe/plugin-api --ignore-scripts --pack-destination /tmp`;
   after the manager installs the local candidate offline and commits both artifacts,
   `npm run check:plugin-api` from Drone and `node --test scripts/plugin-api-dependency-policy.test.mjs`.
3. **W2e — plugin endpoint adoption and Knowledge settings.** Depends on W2f-freeze, D6 approved
   wording, and D7 coherent source selection. In drone-plugins, touch
   `packages/pi-knowledge/src/desktop/{cloud,cloud-capabilities,cloud-runtime,cloud-contract}.ts`,
   new `src/desktop/cloud-endpoint.test.ts` and `cloud-runtime-endpoint.test.ts`,
   `ui/NativeKnowledgeCloud.tsx`, `ui/native-cloud-copy.ts`,
   new `ui/NativeKnowledgeCloudEndpoint.test.tsx`, and package `README.md`; update package/manifest
   version together only under the manager's candidate-version policy. Keep manifest default hosts
   literal; do not bake the env host into the package. Rebuild dist/declarations/bundles/build manifests
   via package scripts in a separate generated-artifact commit. Checks from drone-plugins root:
   `npm run test -w @gyoungwe/pi-knowledge -- src/desktop/cloud-endpoint.test.ts src/desktop/cloud-runtime-endpoint.test.ts ui/NativeKnowledgeCloudEndpoint.test.tsx`;
   `npm run build -w @gyoungwe/pi-knowledge`; `npm run build:check -w @gyoungwe/pi-knowledge`;
   `npm run typecheck -w @gyoungwe/pi-knowledge`; `npm run smoke -w @gyoungwe/pi-knowledge`; `npm run check`.
4. **W2f-settings — host credential Settings projection.** Depends on W2f-core and D6, including
   a manager-owned structural prerequisite that reduces `i18n/zh.ts` and `i18n/en.ts` to ≤400 lines
   before touching them: they currently have 1894/1976 lines. Do not silently grow them or change baselines;
   the manager must scope that separate split before dispatch. Files: `packages/shared/src/host-api/plugin-credentials.ts`,
   `packages/desktop/src/main/ipc/plugin-credentials.ts`,
   `packages/desktop/src/renderer/src/components/settings/PluginCredentialsSection.tsx`, new adjacent
   `WebDavEndpointStatus.tsx` and `WebDavEndpointStatus.test.tsx`, both post-split host dictionaries,
   and new `packages/desktop/src/main/ipc/plugin-credentials-endpoint.test.ts`.
   Add no IPC channel or secret getter. Checks: `npm run test -w @drone/desktop -- src/main/ipc/plugin-credentials-endpoint.test.ts src/renderer/src/components/settings/WebDavEndpointStatus.test.tsx`;
   then the full host gate. Do not mark the UI complete from component tests.
5. **Manager relock and real integration.** Depends on W2e, W2f-settings and committed matching API
   artifacts. Drone files: `plugins.lock.json`, regenerated plugin staging/vendor artifacts and build
   manifests, the two new packed endpoint test/fixture files from section 5,
   `docs/pluginization/packed-knowledge-runtime-acceptance.md` and `docs/INDEX.md`.
   The manager selects the committed plugin source and verifies tarball sha256 with no dev-source override.
   Run the existing default test and new endpoint test against the same real tarball:
   `DRONE_KNOWLEDGE_TARBALL="$W2E_TARBALL" ./node_modules/.bin/vitest run --config packages/backend/vitest.config.ts packages/backend/test/packed-knowledge-webdav-sdk.test.mjs packages/backend/test/packed-knowledge-webdav-endpoint-sdk.test.mjs`.
   `W2E_TARBALL` must identify the manager's verified local packed artifact, not a source directory.
   Run the full host gate, then the real installed-app Settings/session checks and record exact evidence.

Full host gate for the implementation tickets:
`npm run lint && npm run typecheck && npm test && npm run build && npm run check:arch`.
These are future acceptance commands, not T98 results. Manager dispatch must explicitly authorize
artifact/lock mutations and any needed dependency preparation; T98 runs no downloads or installs.

## 7. Decisions needed

The option A widening is already approved; the following details are recommendations awaiting review.
Do not infer approval from this document or implement a blocked choice.

1. **Channel:** A, read-only `config.endpoint` plus exported types/helper; B, optional factory context
   field. Recommend A for per-operation freshness and existing broker validation. W2f-core and W2e wait.
2. **Credential storage identity:** A, retain the original declared slot key and apply runtime host
   policy separately; B, bind stored credentials to each endpoint, requiring explicit re-entry and a
   separately specified storage transition. Recommend A: no migration, retained saved/env selection,
   matching the approved runtime allowance. No new credential persistence decision is enacted here.
   W2f credential work, Settings projection and packed saved-password acceptance wait.
3. **Approval categories:** A, use existing read policy for config/status and existing `network.write`
   allowance/approval behavior; B, design a separate endpoint-change approval/category in a new ticket.
   Recommend A; selecting an endpoint grants neither a write allowance nor approval for cloud writes.
   Do not assign/create a new category here. W2f approval binding and integration assertions wait.
4. **Explicit ports/normalization:** A, require explicit env ports, including valid explicit default
   ports handled through an origin sidecar as specified above; B, permit omitted standard ports only
   after a revised, explicitly approved normalization contract. Recommend A to avoid inferring any env
   authority. W2f parsing/matching and W2e examples wait; never loosen to wildcard or path allowance.
5. **Malformed values:** A, reject the WebDAV configuration, disable cloud operations, and display
   `invalid_endpoint`; B, ignore the malformed override and visibly show default plus a warning.
   Recommend A to avoid connecting with a password to an unintended default destination. W2f/W2e
   error behavior waits. Neither option may display/log the raw malformed value.
6. **Settings placement and wording:** A, both existing Knowledge settings and credential Settings,
   with the exact bilingual table and conditional HTTP warning; B, Knowledge settings only with
   manager-approved revised copy/scope. Recommend A. Approve every zh/en entry verbatim or provide
   replacements; approve a separately scoped host dictionary split before W2f-settings. No split is
   performed or authorized by T98. W2e UI, W2f-settings, and final UI acceptance wait.
7. **Artifact baseline:** A, select a reviewed W2 cloud-capable plugin commit/tarball, using the
   inspected source snapshot only as evidence; B, wait for a different coherent manager freeze.
   Recommend A with recorded source/API hashes and real-tarball tests. Do not infer that the old
   vendored snapshot already supports W2. Candidate freeze/adoption/relock integration waits for the
   manager's exact cohort. Publishing, legacy cloud deletion, and account operations remain outside scope.
