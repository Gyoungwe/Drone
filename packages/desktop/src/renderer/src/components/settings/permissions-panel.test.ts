import type { PermissionProbeResult, PermissionSettings, PermissionSettingsSnapshot } from "@drone/shared";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({ getPi: () => ({ probePermission: vi.fn() }) }));
vi.mock("../../i18n", () => ({
	useT: () => (key: string, params?: Record<string, string | number>) =>
		params ? `${key}:${Object.values(params).join(",")}` : key,
}));
vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

import { PermissionsEditor, type PermissionsEditorProps, ProbeSummary } from "./PermissionsPanel";
import { appendRow, draftFromSettings } from "./permissions-model";

const SETTINGS: PermissionSettings = {
	enabled: true,
	autoApproveProjectEdits: true,
	outside: { read: "allow", write: "ask", temporary: "allow" },
	rules: {
		"*": "allow",
		bash: {
			"*": "allow",
			"sudo *": "ask",
			"git push*": "ask",
			"*permissions.json*": "ask",
			"*workspaces.json*": "ask",
			"*auth.json*": "ask",
			"*trust.json*": "ask",
		},
		edit: "ask",
		write: "ask",
	},
};

function snapshot(overrides: Partial<PermissionSettingsSnapshot> = {}): PermissionSettingsSnapshot {
	return {
		path: "/home/u/.pi/agent/permissions.json",
		auditPath: "/home/u/.pi/agent/permission-audit.jsonl",
		exists: true,
		raw: "{}",
		parseError: null,
		effective: SETTINGS,
		defaults: SETTINGS,
		mtimeMs: 1,
		...overrides,
	};
}

/** 保存按钮是否 disabled（属性顺序无关） */
function saveDisabled(html: string): boolean {
	const tag = html.match(/<button[^>]*data-testid="permissions-save"[^>]*>/)?.[0];
	if (!tag) throw new Error("save button missing");
	return tag.includes('disabled=""');
}

function render(overrides: Partial<PermissionsEditorProps> = {}): string {
	const snap = overrides.snapshot ?? snapshot();
	const props: PermissionsEditorProps = {
		snapshot: snap,
		draft: draftFromSettings(snap.effective),
		dirty: false,
		saving: false,
		error: null,
		conflict: null,
		serverIssues: [],
		savedAt: null,
		audit: [],
		auditLoaded: false,
		onChange: () => {},
		onDiscard: () => {},
		onSave: () => {},
		onReload: () => {},
		onReset: () => {},
		onLoadAudit: () => {},
		onOpenLocation: () => {},
		probe: () => Promise.reject(new Error("not in test")),
		...overrides,
	};
	return renderToStaticMarkup(createElement(PermissionsEditor, props));
}

it("renders the three sections, the file path and the bash table with locked self-protection rows at the end", () => {
	const html = render();
	expect(html).toContain('data-testid="permissions-boundary"');
	expect(html).toContain('data-testid="permissions-rules"');
	expect(html).toContain('data-testid="permissions-advanced"');
	expect(html).toContain("/home/u/.pi/agent/permissions.json");
	expect(html).toContain('data-testid="outside-read" data-action="allow"');
	expect(html).toContain('data-testid="outside-write" data-action="ask"');
	expect(html).toContain('data-testid="rule-fallback" data-action="allow"');
	expect(html).toContain('data-testid="rule-edit" data-action="ask"');
	const rows = html.match(/data-testid="pattern-row"[^>]*>/g) ?? [];
	expect(rows).toHaveLength(7);
	expect(rows.slice(0, 3).every((row) => !row.includes("data-locked"))).toBe(true);
	expect(rows.slice(3).every((row) => row.includes('data-locked="true"'))).toBe(true);
	// 锁定行没有 allow 选项，也没有删除按钮
	const lockedSelects = html.split('data-locked="true"').slice(1);
	for (const chunk of lockedSelects) {
		const select = chunk.slice(0, chunk.indexOf("</select>"));
		expect(select).not.toContain('value="allow"');
	}
	expect(html.match(/aria-label="settings.permissions.removeRow"/g)).toHaveLength(3);
	expect(html).not.toContain('data-testid="permissions-disabled-banner"');
	// 只有 bash 有试算
	expect(html.match(/data-testid="permissions-probe"/g)).toHaveLength(1);
});

it("save stays disabled until the draft is dirty and valid; issues disable it again and are listed", () => {
	const clean = render();
	expect(saveDisabled(clean)).toBe(true);
	const dirty = render({ dirty: true });
	expect(saveDisabled(dirty)).toBe(false);
	expect(dirty).toContain('data-state="dirty"');

	const draft = draftFromSettings(SETTINGS);
	const bash = draft.tools.find((t) => t.tool === "bash");
	if (bash?.kind !== "patterns") throw new Error("bash table missing");
	const invalid = {
		...draft,
		tools: draft.tools.map((t) =>
			t.tool === "bash" ? { ...t, kind: "patterns" as const, rows: appendRow(bash.rows, "", "ask") } : t,
		),
	};
	const html = render({ dirty: true, draft: invalid });
	expect(saveDisabled(html)).toBe(true);
	expect(html).toContain('data-state="invalid"');
	expect(html).toContain("settings.permissions.issue.empty-pattern");
	expect(html).toContain('aria-invalid="true"');
});

it("shows the enabled=false banner, the parse error and the conflict choice", () => {
	const off = render({ snapshot: snapshot({ effective: { ...SETTINGS, enabled: false } }) });
	expect(off).toContain('data-testid="permissions-disabled-banner"');
	const broken = render({ snapshot: snapshot({ parseError: "Unexpected token" }) });
	expect(broken).toContain("settings.permissions.parseError:Unexpected token");
	const conflict = render({ dirty: true, conflict: snapshot() });
	expect(conflict).toContain('data-testid="permissions-conflict"');
	expect(conflict).toContain("settings.permissions.conflictReload");
	expect(conflict).toContain("settings.permissions.conflictOverwrite");
	expect(saveDisabled(conflict)).toBe(true);
});

it("renders a probe hit with its row number, or the fallback wording when no pattern matched", () => {
	const draft = draftFromSettings(SETTINGS);
	const bash = draft.tools.find((t) => t.tool === "bash");
	if (bash?.kind !== "patterns") throw new Error("bash table missing");
	const hit: PermissionProbeResult = {
		tool: "bash",
		matchText: "git status && git push --force origin main",
		action: "ask",
		pattern: "git push*",
		segment: "git push --force origin main",
		steps: [],
		boundaryApplied: false,
	};
	const html = renderToStaticMarkup(createElement(ProbeSummary, { rows: bash.rows, result: hit }));
	expect(html).toContain("settings.permissions.probeHit:3,git push*,ask");
	expect(html).toContain("settings.permissions.probeSegment:git push --force origin main");
	const fallback: PermissionProbeResult = {
		...hit,
		pattern: null,
		segment: null,
		matchText: "x",
		action: "allow",
	};
	expect(renderToStaticMarkup(createElement(ProbeSummary, { rows: bash.rows, result: fallback }))).toContain(
		"settings.permissions.probeFallback:allow",
	);
});
