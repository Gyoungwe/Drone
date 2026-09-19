import type { PermissionSettings } from "@drone/shared";
import { describe, expect, it } from "vitest";
import {
	appendRow,
	draftFromSettings,
	draftToSettings,
	moveRow,
	removeRow,
	rowNumber,
	sameDraft,
	updateRow,
	validateDraft,
} from "./permissions-model";

const SELF = ["*permissions.json*", "*workspaces.json*", "*auth.json*", "*trust.json*"];

function settings(overrides: Partial<PermissionSettings> = {}): PermissionSettings {
	return {
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
		...overrides,
	};
}

describe("draftFromSettings / draftToSettings", () => {
	it("keeps rule order on a round trip and pins self-protection rows to the end of the bash table", () => {
		const draft = draftFromSettings(settings());
		const bash = draft.tools.find((t) => t.tool === "bash");
		if (bash?.kind !== "patterns") throw new Error("bash table missing");
		expect(bash.rows.map((r) => r.pattern)).toEqual(["*", "sudo *", "git push*", ...SELF]);
		expect(bash.rows.filter((r) => r.locked).map((r) => r.pattern)).toEqual(SELF);
		const out = draftToSettings(draft, true);
		expect(Object.keys(out.rules)).toEqual(["*", "bash", "edit", "write"]);
		expect(Object.keys(out.rules.bash as object)).toEqual(["*", "sudo *", "git push*", ...SELF]);
		expect(out).toEqual(settings());
	});

	it("normalises a plain bash action and a file that buried self-protection under a wildcard", () => {
		const plain = draftFromSettings(settings({ rules: { "*": "allow", bash: "ask" } }));
		const bash = plain.tools.find((t) => t.tool === "bash");
		if (bash?.kind !== "patterns") throw new Error("bash table missing");
		expect(bash.rows.map((r) => [r.pattern, r.action])).toEqual([
			["*", "ask"],
			...SELF.map((p) => [p, "ask"]),
		]);

		const buried = draftFromSettings(
			settings({ rules: { "*": "allow", bash: { "*permissions.json*": "deny", "*": "allow" } } }),
		);
		const table = buried.tools.find((t) => t.tool === "bash");
		if (table?.kind !== "patterns") throw new Error("bash table missing");
		// 通配回到前面、自保护回到表尾（deny 收紧值保留，缺失的三条补 ask）
		expect(table.rows.map((r) => r.pattern)).toEqual(["*", ...SELF]);
		expect(table.rows.find((r) => r.pattern === "*permissions.json*")?.action).toBe("deny");
		expect(validateDraft(buried)).toEqual([]);
	});

	it("never writes enabled from the draft's own state and reports dirtiness structurally", () => {
		const a = draftFromSettings(settings());
		const b = draftFromSettings(settings());
		expect(sameDraft(a, b)).toBe(true);
		const changed = { ...a, outside: { ...a.outside, write: "deny" as const } };
		expect(sameDraft(a, changed)).toBe(false);
		expect(draftToSettings(changed, false).enabled).toBe(false);
	});
});

describe("row editing", () => {
	it("moves rows but never across the locked tail, appends before it and refuses to remove locked rows", () => {
		const draft = draftFromSettings(settings());
		const bash = draft.tools.find((t) => t.tool === "bash");
		if (bash?.kind !== "patterns") throw new Error("bash table missing");
		const rows = bash.rows;
		expect(
			moveRow(rows, 1, 1)
				.map((r) => r.pattern)
				.slice(0, 3),
		).toEqual(["*", "git push*", "sudo *"]);
		// 最后一个普通行不能下移到锁定行之后
		expect(moveRow(rows, 2, 1)).toBe(rows);
		expect(moveRow(rows, 3, -1)).toBe(rows);
		const appended = appendRow(rows, "docker *", "deny");
		expect(appended.map((r) => r.pattern)).toEqual(["*", "sudo *", "git push*", "docker *", ...SELF]);
		const locked = rows.find((r) => r.locked);
		if (!locked) throw new Error("locked row missing");
		expect(removeRow(rows, locked.id)).toHaveLength(rows.length);
		expect(removeRow(rows, rows[1]?.id ?? "").map((r) => r.pattern)).toEqual(["*", "git push*", ...SELF]);
		// 锁定行：模式不可改，动作不可放松为 allow，但可收紧为 deny
		const relaxed = updateRow(rows, locked.id, { pattern: "x", action: "allow" });
		expect(relaxed.find((r) => r.id === locked.id)).toMatchObject({ pattern: locked.pattern, action: "ask" });
		expect(updateRow(rows, locked.id, { action: "deny" }).find((r) => r.id === locked.id)?.action).toBe(
			"deny",
		);
		expect(rowNumber(appended, "docker *")).toBe(4);
		expect(rowNumber(appended, null)).toBeNull();
	});
});

describe("validateDraft", () => {
	it("flags empty, numeric and duplicate patterns, and missing self-protection", () => {
		const draft = draftFromSettings(settings());
		const bash = draft.tools.find((t) => t.tool === "bash");
		if (bash?.kind !== "patterns") throw new Error("bash table missing");
		let rows = appendRow(bash.rows, "", "ask");
		rows = appendRow(rows, "123", "ask");
		rows = appendRow(rows, "sudo *", "deny");
		const invalid = {
			...draft,
			tools: draft.tools.map((t) => (t.tool === "bash" ? { ...t, kind: "patterns" as const, rows } : t)),
		};
		const codes = validateDraft(invalid)
			.map((i) => i.code)
			.sort();
		expect(codes).toEqual(["empty-pattern", "numeric-key", "shape"]);

		const missing = {
			...draft,
			tools: draft.tools.map((t) =>
				t.tool === "bash" ? { ...t, kind: "patterns" as const, rows: bash.rows.filter((r) => !r.locked) } : t,
			),
		};
		expect(validateDraft(missing).filter((i) => i.code === "self-protection")).toHaveLength(4);
		expect(validateDraft(draft)).toEqual([]);
	});
});
