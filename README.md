<p align="center">
  <img src="docs/icon.svg" alt="Drone logo" width="128">
</p>
<h1 align="center">Drone</h1>
<p align="center">
  An autonomous research workbench on your desktop. Approve a task once — scope, write directories and acceptance criteria — and Drone runs it to delivery instead of interrupting you at every step. Built on the <a href="https://www.npmjs.com/package/@earendil-works/pi-coding-agent">Pi coding agent</a>, the same engine as the Pi CLI.
</p>
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Gyoungwe/Drone?style=flat-square" alt="License"></a>
  <a href="https://github.com/Gyoungwe/Drone/releases"><img src="https://img.shields.io/github/v/release/Gyoungwe/Drone?style=flat-square" alt="Release"></a>
  <a href="https://github.com/Gyoungwe/Drone/releases"><img src="https://img.shields.io/github/downloads/Gyoungwe/Drone/total?style=flat-square" alt="Downloads"></a>
  <a href="https://github.com/Gyoungwe/Drone/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Gyoungwe/Drone/ci.yml?style=flat-square" alt="CI"></a>
  <a href="https://github.com/Gyoungwe/Drone"><img src="https://img.shields.io/github/stars/Gyoungwe/Drone?style=flat-square" alt="Stars"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.19-339933?logo=nodedotjs&style=flat-square" alt="Node >=22.19">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square" alt="macOS | Windows | Linux">
</p>
<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">简体中文</a>
</p>

---

## Demo

![drone welcome page with the whale maid desk pet](docs/assets/img/drone_pet.png)

![UI plugins settings — the whale maid desk pet ships built in](docs/assets/img/drone_ui_plugins.png)

**Chat**

![Chat page demo](docs/assets/img/demo-chat.gif)

**Custom background & dark theme**

![Chat with custom background image in dark theme](docs/assets/img/chat_img_bg_show_img.png)

**Settings — providers & models**

![Settings page demo](docs/assets/img/demo-settings.gif)

## Why Drone?

Most agent GUIs ask you to approve every write, every command and every stage. Drone asks **once**.

A task starts with bounded read-only discovery, then presents a single authorization card: the goal, a plain-language scope summary, the exact write directories and immutable acceptance criteria. One click — **确认一次，执行到交付** — approves the acceptance contract and the execution budget, and the task runs to delivery.

- **One authorization per task** — consent is bound to an immutable contract hash over the task id, goal, scope, directory list and acceptance milestones. Change the contract and consent is revoked; it never transfers to another task, session or branch.
- **Scoped, not unlimited** — approved writes apply only under the canonical directories you saw on the card. Explicit deny rules, credentials, permission/trust/model configuration, private keys, VCS internals, symlink escape and hard-linked targets all keep their gates. It is not a fullAccess switch.
- **Progress you can audit** — stages advance on observed progress only: successful results of host-allowed, distinct calls. Status spam and failed checks do not count. Recovery is capped at 3 host-triggered turns inside a fixed 192-call ceiling.
- **Structured task workbench** — model-proposed milestones with dependencies, acceptance satisfied only by host file readback, scoped human review or read-only Zotero identity. The durable ledger survives restarts without replaying unknown side effects.

See [docs/task-authorization.md](docs/task-authorization.md) for the full boundary list.

## Built on Pi

Drone embeds the official Pi SDK (`@earendil-works/pi-coding-agent`) in the Electron main process. It is **not a fork and not a reimplementation** — it runs the same engine as the Pi CLI and inherits Pi's native strengths:

- **Extensibility** — TypeScript extensions, skills, and prompt templates installed for the Pi CLI work here too, including project-local ones (with a trust prompt before loading). Adapt Pi to your workflows, no forking required.
- **Shared configuration** — same `~/.pi/agent/` directory as the CLI: sessions, auth, and model settings carry over. Start a session in the terminal, continue it in the GUI.
- **Providers** — subscriptions (Claude Pro/Max, ChatGPT Plus/Pro Codex, GitHub Copilot, logged in via an in-app OAuth flow) and API keys for Anthropic, OpenAI, Gemini, DeepSeek, Bedrock, and more; custom providers and base-URL overrides for relay gateways.

And for those who prefer a GUI over a TUI:

- Highly customizable UI — swap tool-call cards, drop in desk-pet overlays (two whale-maid pets ship built in), or extend the settings panel via UI plugins
- Visual permission gates — approve or deny each tool call from a dock, backed by a per-tool rule engine
- Draggable multi-session tabs (plus an optional session rail), per-session composer drafts, follow-up queue with undo
- Built-in subagents — a scout plus your own agent definitions, parallel task fan-outs, and run cards you can click to inspect the sub-session read-only. Natural language such as “scout the repo” / “侦察一下代码库” starts Scout; the composer shows “子代理 x1” while it runs and “Scout 已完成” when it finishes
- Context evaporation (on by default) — stale tool outputs age into compact stubs, keeping long sessions within budget
- Unified error system — in-chat error cards with one-click retry, an auto-retry status line, and a crash-proof renderer
- Solid session workspace — fork any message, recall your own message back into the composer, todo panel, per-turn diff sidebar, slash-command menu and @-file completion
- Streaming markdown rendering, image previews, message copy
- Agent-initiated image display — a built-in `show_image` tool lets the agent deliberately show you images inline (single or grouped), without turning every tool result into noise
- Custom background image with adjustable overlay dimming, light/dark/system themes
- LAN observer — watch a session read-only from a phone or tablet browser via QR code

## Download

Prebuilt installers are published on the [Releases](https://github.com/Gyoungwe/Drone/releases) page.

| Platform | Download |
| --- | --- |
| macOS (Apple Silicon) | `drone-mac-arm64.dmg` |
| macOS (Intel) | `drone-mac-x64.dmg` |
| Windows | `drone-windows-x64.exe` (installer) or `drone-windows-x64.zip` |
| Linux (x64) | `drone-linux-x64.AppImage` or `drone-linux-x64.deb` |

> Linux packages are unsigned. Make the AppImage executable (`chmod +x drone-linux-x64.AppImage`) before running.
>
> The AppImage needs FUSE 2 (`libfuse2`). If `./drone-linux-x64.AppImage` fails with a FUSE error, either install fuse2 (`sudo apt install libfuse2` on Debian/Ubuntu) or run without FUSE: `APPIMAGE_EXTRACT_AND_RUN=1 ./drone-linux-x64.AppImage`.
>
> The `.deb` package needs `libsecret-1-0` for credential storage (`sudo apt install libsecret-1-0`).
>
> Builds are ad-hoc signed (no Developer ID certificate). On macOS, the first launch after a download may show **"Apple cannot verify Drone is free from malware"** — that's Gatekeeper blocking an un-notarized app. To open it:
>
> 1. **System Settings → Privacy & Security** → scroll to the bottom → click **Open Anyway** next to the Drone entry, then confirm with your password or Touch ID (recommended).
>
>    ![macOS Open Anyway](docs/assets/img/drone_mac_permission.png)
>
> 2. Or in Terminal: `xattr -cr "/Applications/Drone.app"`.
>
> Updates are checked in-app. On Windows they download and install there too (click download, then restart). On macOS the ad-hoc signed build cannot self-install, so the app jumps to the Releases page — and a freshly downloaded version will hit Gatekeeper once again. On Windows, click "More info" → "Run anyway" when SmartScreen appears.

## Configuration

API keys are never stored in this repo or written into the app bundle. `~/.pi/agent/models.json` references environment variables (e.g. `$AI_OPS_API_KEY`) and keys stay in your shell environment. If you already use the Pi CLI, your existing setup just works.

Built-in DeepSeek models use catalog display names such as **V4 Flash**, not the API id `deepseek-chat`. If the model picker is empty, open Settings → Models and add a provider key.

## Development

Prerequisites: **Node.js >= 22.19**.

```bash
npm install
npm run dev
```

npm workspaces monorepo, three packages: `packages/shared` (IPC contracts), `packages/backend` (the only place that imports the Pi SDK), `packages/desktop` (Electron + React 19 + Tailwind 4 + Zustand). Common commands: `npm run typecheck` / `test` / `lint` / `build` / `dist`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. If you are in China and the Electron binary download stalls, set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` first.

## Disclaimer

Drone is a community project. It is **not** built by or affiliated with the Pi team (earendil-works).

## License

[MIT](LICENSE)

## Research workbench distribution

Drone bundles the native knowledge service and research workflow across projects, plus a first-party presentation fallback. Model credentials, optional external search/MCP adapters, private Vaults and locally installed scientific software remain user setup. See [distribution capability boundaries](docs/distribution-parity.md) and [model-assisted Wiki review](docs/wiki-model-review.md). A main-branch push updates source; a version-tagged Release is needed for updated installers.

### Third-party research skill packs

Installers bundle three commit-pinned upstream skill packs, unmodified and with their license files: [Nature Skills](https://github.com/Yuan1z0825/nature-skills) (Apache-2.0), a license-filtered subset of [Scientific Agent Skills](https://github.com/K-Dense-AI/scientific-agent-skills) (MIT) and [Academic Research Skills](https://github.com/Imbad0202/academic-research-skills) © Cheng-I Wu, licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Drone itself is MIT-licensed and distributed free of charge; the Academic Research Skills pack may only be used for noncommercial purposes and is not covered by Drone's MIT license. Details: [docs/research-skill-packs.md](docs/research-skill-packs.md).
