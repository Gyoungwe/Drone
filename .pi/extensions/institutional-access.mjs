import {
	isElectronAvailable,
	loadInstitutionalConfig,
	openInstitutionalLoginWindow,
	openInstitutionalUrlInWindow,
} from "../lib/institutional-access.mjs";
import { registerTool } from "../lib/tool-manifest.mjs";

export default function institutionalAccess(pi) {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;

	registerTool(pi, {
		name: "research_institutional_login",
		label: "Institutional login",
		drone: {
			capabilities: ["research"],
			journal: false,
			subagent: "exclude",
			activity: { text: "正在打开机构登录窗口…", phase: "auth" },
		},
		description:
			"Open the institutional login window (persistent partition persist:drone-institutional) for the user to log in via EZproxy / Shibboleth / CARSI / OpenAthens / WebVPN. After the user logs in, the host auto-detects the EZproxy template from the navigated URL and saves it to ~/.pi/agent/institutional.json (no manual template needed). Use when research_archive_source returns institutional_auth_required or when the user has institutional access. The login persists across restarts.",
		parameters: {
			type: "object",
			properties: {
				url: {
					type: "string",
					description:
						"Optional publisher or DOI URL to open directly in the institutional window (e.g. https://doi.org/10.1038/nature12373 or https://www.nature.com/articles/...)",
				},
				reason: {
					type: "string",
					description: "Optional reason shown to the user (e.g. which paper needs institutional access)",
				},
			},
		},
		async execute(_id, params, _signal, _update, _ctx) {
			if (!isElectronAvailable()) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									status: "electron_unavailable",
									message:
										"Institutional login requires Drone desktop (Electron). CLI mode cannot open a login window.",
								},
								null,
								2,
							),
						},
					],
					details: { status: "electron_unavailable" },
				};
			}

			const targetUrl = params.url || "https://www.nature.com/";
			let opened;
			try {
				if (params.url) {
					// Try to open the specific URL (will be proxied if template exists)
					opened = await openInstitutionalUrlInWindow(targetUrl);
				} else {
					opened = await openInstitutionalLoginWindow();
				}
			} catch (err) {
				return {
					content: [{ type: "text", text: `Failed to open institutional login window: ${err.message}` }],
					details: { status: "failed", error: err.message },
				};
			}

			const cfg = await loadInstitutionalConfig();
			const result = {
				status: "login_window_opened",
				opened_url: opened.url,
				requested_url: params.url || null,
				reason: params.reason || null,
				config: {
					ezproxy_template: cfg.ezproxyTemplate ? "set" : "not_set",
					ezproxy_template_value: cfg.ezproxyTemplate || null,
					institution: cfg.institutionName || null,
					auto_download: cfg.autoDownloadEnabled,
					per_task_limit: cfg.perTaskLimit,
					last_login_at: cfg.lastLoginAt || null,
				},
				instructions:
					"The institutional browser window is now open. Please complete your institutional login (library / EZproxy / Shibboleth / CARSI / OpenAthens / WebVPN). The host will auto-detect the EZproxy template from the URL (e.g. .../login?url=%s) and save it automatically. After logging in, you can close the window or leave it open, then retry the paper download with research_archive_source. The login persists across restarts in partition persist:drone-institutional.",
				next_steps: [
					"1. In the opened window, log in via your institution (if EZproxy, you will see a login?url=... URL; it will be saved as template automatically)",
					"2. Once logged in, navigate to the publisher if needed to verify access",
					"3. Return to the chat and call research_archive_source again for the DOI",
				],
			};

			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				details: result,
			};
		},
	});

	registerTool(pi, {
		name: "research_institutional_status",
		label: "Institutional status",
		drone: {
			readOnly: true,
			capabilities: ["research"],
		},
		description:
			"Show institutional access status (config + session cookies + whether logged in). No login window.",
		parameters: { type: "object", properties: {} },
		async execute() {
			const cfg = await loadInstitutionalConfig();
			const electronAvailable = isElectronAvailable();
			let cookiesCount = 0;
			if (electronAvailable) {
				try {
					const { getInstitutionalSession } = await import("../lib/institutional-access.mjs");
					const sess = getInstitutionalSession();
					if (sess) {
						const cookies = await sess.cookies.get({});
						cookiesCount = cookies.length;
					}
				} catch {}
			}
			const status = {
				config: cfg,
				session: {
					cookiesCount,
					hasSessionCookies: cookiesCount > 0,
					partition: "persist:drone-institutional",
					lastAccessAt: cfg.lastLoginAt,
				},
				loggedIn: cookiesCount > 0 || Boolean(cfg.lastLoginAt),
				electronAvailable,
			};
			return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }], details: status };
		},
	});
}
