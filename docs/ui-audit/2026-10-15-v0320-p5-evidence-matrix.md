# v0.32.0 P5 desktop UI evidence matrix

This matrix separates source and test contracts (A) from release-environment screenshots (B) and real-device or real-data observations (C). The static A gate is `npm run check:ui-evidence`.

| Surface | A evidence in this checkout | B or C evidence still required |
| --- | --- | --- |
| Settings dialog | Dialog role, narrow viewport bounds, Tab/Shift+Tab, Escape and focus restoration | Four viewport screenshots in light, dark and reduced-motion modes |
| Knowledge graph | Bounded layout and large graph tests for 1000–10000 nodes | Screenshot and measured interaction in release Chromium |
| Subagent runs | 1000-row fixture, 100-row pages, filter reset and focused-run pagination | Screenshot of paging and focus retention at each target width |
| LAN observer | Removed from the product on 2026-10-16; no runtime or release evidence required | None; local desktop remains the supported observer surface |
| Motion and status | Desktop reduced-motion selectors and single live-region status contract | Browser-level reduced-motion screenshots |

The A gate does not promote UI state, fixture output or screenshots to QC, scientific verification or publication status. A controlled Chrome parity run on 2026-10-15 generated 168 PNGs across the 375/768/1024/1440 viewports, light/dark themes and reduced-motion variants; the ignored outputs and SHA-256 receipt are at `/tmp/drone-ui-parity-p5` and `/tmp/drone-ui-parity-p5.sha256`. A release archive may relocate that receipt, but the controlled B behavior is captured. LAN is no longer a release gate. C evidence remains scoped to the authorized scientific host and real data path.
