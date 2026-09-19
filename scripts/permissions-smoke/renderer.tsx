// Isolated fixture: the real PermissionsPanel + store against a fake window.pi. Nothing touches ~/.pi.

import type {
	PermissionProbeInput,
	PermissionProbeResult,
	PermissionRuleAction,
	PermissionSettings,
	PermissionSettingsSaveInput,
	PermissionSettingsSaveResult,
	PermissionSettingsSnapshot,
} from "@drone/shared";
import { createRoot } from "react-dom/client";
import { PermissionsPanel } from "../../packages/desktop/src/renderer/src/components/settings/PermissionsPanel";
import { useI18nStore } from "../../packages/desktop/src/renderer/src/i18n";
import { usePermissionSettingsStore } from "../../packages/desktop/src/renderer/src/stores/permissions";

const DEFAULTS: PermissionSettings = {
	enabled: true,
	autoApproveProjectEdits: true,
	outside: { read: "allow", write: "ask", temporary: "allow" },
	rules: {
		"*": "allow",
		bash: {
			"*": "allow",
			"sudo *": "ask",
			"git push*": "ask",
			"rm -rf *": "ask",
			"*permissions.json*": "ask",
			"*workspaces.json*": "ask",
			"*auth.json*": "ask",
			"*trust.json*": "ask",
		},
		edit: "ask",
		write: "ask",
	},
};

let disk: PermissionSettings = JSON.parse(JSON.stringify(DEFAULTS));
let mtime = 1000;
const fixture = {
	saved: [] as PermissionSettings[],
	conflictOnce: false,
	enabled: true,
};
(window as any).__fixture = fixture;

function snapshot(): PermissionSettingsSnapshot {
	return {
		path: "/fixture/.pi/agent/permissions.json",
		auditPath: "/fixture/.pi/agent/permission-audit.jsonl",
		exists: true,
		raw: JSON.stringify(disk),
		parseError: null,
		effective: { ...JSON.parse(JSON.stringify(disk)), enabled: fixture.enabled },
		defaults: JSON.parse(JSON.stringify(DEFAULTS)),
		mtimeMs: mtime,
	};
}

function glob(pattern: string, text: string): boolean {
	const source = pattern
		.split("")
		.map((ch) => (ch === "*" ? ".*" : ch === "?" ? "." : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
		.join("");
	return new RegExp(`^${source}$`).test(text);
}

/** Fixture-only rule walk: last match wins per segment, strictest segment wins. Real chain logic is unit-tested in backend. */
function probe(input: PermissionProbeInput): PermissionProbeResult {
	const settings = input.settings ?? disk;
	const command = String(input.input.command ?? "");
	const table = settings.rules.bash;
	const rank: Record<PermissionRuleAction, number> = { allow: 0, ask: 1, deny: 2 };
	const segments = [command, ...command.split(/\s*(?:&&|\|\||;|\|)\s*/).filter(Boolean)];
	let best: { candidate: string; action: PermissionRuleAction; pattern: string | null } = {
		candidate: command,
		action: "allow",
		pattern: null,
	};
	const steps = segments.map((candidate) => {
		let action: PermissionRuleAction = settings.rules["*"] ?? "ask";
		let pattern: string | null = null;
		if (typeof table === "object" && table) {
			for (const [p, a] of Object.entries(table)) {
				if (glob(p, candidate)) {
					action = a;
					pattern = p;
				}
			}
		} else if (typeof table === "string") action = table;
		const step = { candidate, action, pattern };
		if (rank[action] > rank[best.action]) best = step;
		return step;
	});
	return {
		tool: "bash",
		matchText: command,
		action: best.action,
		pattern: best.pattern,
		segment: best.candidate,
		steps,
		boundaryApplied: false,
	};
}

(window as any).pi = {
	getPermissionSettings: async () => snapshot(),
	savePermissionSettings: async (
		input: PermissionSettingsSaveInput,
	): Promise<PermissionSettingsSaveResult> => {
		if (fixture.conflictOnce && !input.force) {
			fixture.conflictOnce = false;
			mtime += 1;
			return { ok: false, reason: "conflict", snapshot: snapshot() };
		}
		disk = JSON.parse(JSON.stringify(input.settings));
		mtime += 1;
		fixture.saved.push(disk);
		return { ok: true, snapshot: snapshot() };
	},
	resetPermissionSettings: async () => {
		disk = JSON.parse(JSON.stringify(DEFAULTS));
		mtime += 1;
		fixture.saved.push(disk);
		return snapshot();
	},
	probePermission: async (input: PermissionProbeInput) => probe(input),
	getPermissionAuditTail: async () => [
		{
			t: "2026-09-19T10:00:00.000Z",
			tool: "bash",
			action: "ask",
			text: "git push origin main",
			cwd: "/fixture",
		},
	],
	openPermissionSettingsLocation: async () => {
		(window as any).__opened = true;
	},
};

function Fixture() {
	return (
		<div className="mx-auto max-w-[760px] space-y-3 p-5">
			<p className="text-[11px] text-ink-faint">DRONE / PERMISSIONS · 隔离界面测试，不写用户文件</p>
			<div className="flex gap-2">
				<button type="button" id="lang" onClick={() => useI18nStore.getState().setLanguage("en")}>
					English
				</button>
				<button
					type="button"
					id="reload"
					onClick={() => {
						usePermissionSettingsStore.setState({ snapshot: null, draft: null, baseline: null });
						void usePermissionSettingsStore.getState().load();
					}}
				>
					Reload
				</button>
			</div>
			<div className="rounded-xl border border-border bg-surface p-4">
				<PermissionsPanel />
			</div>
		</div>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(<Fixture />);
