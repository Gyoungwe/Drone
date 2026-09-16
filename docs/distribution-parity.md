# Release capability parity — 2026-09-12

## What a push does and does not do

A source commit pushed to this fork is available to source users after they obtain that commit, install dependencies and rebuild. A normal main-branch push runs CI; `.github/workflows/release.yml` creates installers only on a `v*` tag push. Downloading an older Release asset does not acquire unbuilt source changes.

The first-party release manifest is `.pi/lib/workbench-manifest.json`. Desktop startup in both source and packaged modes uses it to load the same extensions and skills in every project, not only when working in the Drone repository. Packaging now includes the source archive, research loop, workspace summary and related research extensions previously available only through project settings. The package smoke checks unique workbench tool registrations and the required core paths against copied release resources, with empty agent data and ambient extensions/skills disabled.

Built-in skills are `research-vault`, `research-workflow`, `research-show-me` and `zotero-literature`, alongside existing desktop collaboration/UI skills. `research-show-me` is new first-party content, not a copy of a third-party user's installation. The user's `show-me` takes priority when present; the fallback identity is retained when absent. Original-paper reading, commands and actual local performance are never invented just because a presentation skill exists.

## Capability classes

| Class | Distributed? | New-user setup |
|---|---|---|
| Knowledge service, global Vault binding UI, index, source records, review and publication controls | Yes, native code/resources | Choose/create own Vault and trust relevant projects |
| Topic accumulation, controlled Wiki candidate generation, explainer archiving, stage timeline and SDK usage UI | Yes | Configure a model and use current built-in workflow |
| Four isolated knowledge specialists and user-triggered Wiki model reviewer | Yes | Configure credentials/model; explicit access and review consent apply |
| Third-party show-me and the rest of the owner's installed skill catalog | No | Install desired skills separately; built-in presentation fallback is available |
| External search and arbitrary MCP services | Optional extras, not authenticated by packaging | Install/connect adapters and supply own API keys/endpoints |
| Literature subscriptions, browser login, personal source files, user Vault and session history | No | User's own authorized data and access |
| R/Python environments and scientific command-line executables | Not cloned from the developer's machine | Install per-task prerequisites and verify versions locally |

Optional tested adapter versions are recorded in the manifest, not silently installed into the application or granted credentials: pi-web-access 0.28.0 and pi-mcp-adapter 2.32.1. Different models, access plans and local executables can change what tasks are achievable; shipping the code cannot give another user the owner's credentials or exactly the same results.

The fork's configured update feed and release-page link target `Gyoungwe/Drone`, rather than the upstream `Jaxton07/drone`. Copyright/creator attribution remains unchanged. Release `v0.6.0` is now published from the verified tag; the macOS updater remains manual for adhoc-signed builds.

## Data boundaries

Release resources are code and named first-party skill directories, not the user's home folders or Vault. `.gitignore` explicitly excludes runtime workspace binding, browser downloads, generated `results/` and conversation exports. Do not package auth.json, provider credentials, MCP login data, downloaded copyrighted papers or a private Vault to obtain capability parity.

## Validation and release caveat

Use `node scripts/check-knowledge-package.mjs`, also under the actual Electron Node runtime, to test copied package resources in an unrelated project with no ambient user skills. The test proves native resource availability and scoped indexing, not external service connectivity or successful installation on every OS. SDK model-review tests are offline with a scripted provider.

The repository lint gate was cleaned without disabling rules. Before v0.6.0, local lint/typecheck/build and 1,102 tests passed; remote GitHub CI repeated npm ci, lint, typecheck, tests and build successfully. A real arm64 DMG was mounted/copied/launched with isolated HOME/userData/agentDir/knowledgeDir, and the final GitHub Release workflow built both macOS architectures plus Windows, verified required assets, and published v0.6.0. Linux x64 AppImage/deb packaging is added to the same Release matrix for subsequent tagged releases.
