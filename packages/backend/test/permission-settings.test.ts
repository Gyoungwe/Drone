import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_PERMISSION_CONFIG,
	loadPermissionConfig,
	mergeWithDefaults,
	type PermissionConfig,
	parseConfig,
	probePermission,
	readPermissionAuditTail,
	readPermissionSettings,
	resetPermissionSettings,
	serializeConfig,
	validateConfig,
	writePermissionSettings,
} from "../src/permissions";

function makeAgentDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-perm-settings-"));
	mkdirSync(dir, { recursive: true });
	return dir;
}

function clone(config: PermissionConfig): PermissionConfig {
	return JSON.parse(JSON.stringify(config)) as PermissionConfig;
}

describe("parseConfig · autoApproveProjectEdits", () => {
	it("reads the explicit boolean from the file and it survives a merge that lists edit/write rules", () => {
		expect(parseConfig({ autoApproveProjectEdits: false }).autoApproveProjectEdits).toBe(false);
		expect(parseConfig({ autoApproveProjectEdits: true }).autoApproveProjectEdits).toBe(true);
		expect(parseConfig({ autoApproveProjectEdits: "yes" }).autoApproveProjectEdits).toBeUndefined();
		// 显式 true + 文件里有 edit/write 规则：显式优先（推导会得到 false）
		const merged = mergeWithDefaults(
			parseConfig({ autoApproveProjectEdits: true, rules: { edit: "ask", write: "ask" } }),
		);
		expect(merged.autoApproveProjectEdits).toBe(true);
	});

	it("falls back to derivation when the file has no explicit boolean", () => {
		expect(mergeWithDefaults(parseConfig({ rules: { edit: "ask" } })).autoApproveProjectEdits).toBe(false);
		expect(mergeWithDefaults(parseConfig({ rules: { read: "deny" } })).autoApproveProjectEdits).toBe(true);
	});
});

describe("serializeConfig", () => {
	it("writes only user-visible fields, keeps rule order and omits enabled unless asked to preserve it", () => {
		const config = clone(DEFAULT_PERMISSION_CONFIG);
		const out = serializeConfig(config);
		expect(Object.keys(out)).toEqual(["autoApproveProjectEdits", "outside", "rules"]);
		expect(Object.keys(out.rules)).toEqual(Object.keys(DEFAULT_PERMISSION_CONFIG.rules));
		expect(Object.keys(out.rules.bash as object)).toEqual(
			Object.keys(DEFAULT_PERMISSION_CONFIG.rules.bash as object),
		);
		const preserved = serializeConfig(config, { enabled: false });
		expect(Object.keys(preserved)[0]).toBe("enabled");
		expect(preserved.enabled).toBe(false);
	});

	it("round-trips through parseConfig + mergeWithDefaults without drift", () => {
		const config = clone(DEFAULT_PERMISSION_CONFIG);
		config.outside.read = "ask";
		(config.rules.bash as Record<string, string>)["docker *"] = "ask";
		const back = mergeWithDefaults(
			parseConfig(JSON.parse(JSON.stringify(serializeConfig(config, { enabled: true })))),
		);
		expect(back).toEqual(config);
	});
});

describe("validateConfig", () => {
	it("accepts the defaults", () => {
		expect(validateConfig(clone(DEFAULT_PERMISSION_CONFIG))).toEqual([]);
	});

	it("rejects relaxing or dropping a self-protection pattern", () => {
		const relaxed = clone(DEFAULT_PERMISSION_CONFIG);
		(relaxed.rules.bash as Record<string, string>)["*permissions.json*"] = "allow";
		expect(validateConfig(relaxed).map((i) => i.code)).toContain("self-protection");
		const dropped = clone(DEFAULT_PERMISSION_CONFIG);
		delete (dropped.rules.bash as Record<string, string>)["*trust.json*"];
		expect(validateConfig(dropped).some((i) => i.path === "rules.bash.*trust.json*")).toBe(true);
		// deny 是收紧，合法
		const tightened = clone(DEFAULT_PERMISSION_CONFIG);
		(tightened.rules.bash as Record<string, string>)["*auth.json*"] = "deny";
		expect(validateConfig(tightened)).toEqual([]);
	});

	it("rejects a self-protection pattern that a later allow wildcard would override", () => {
		const config = clone(DEFAULT_PERMISSION_CONFIG);
		const bash = config.rules.bash as Record<string, "allow" | "ask" | "deny">;
		const reordered: Record<string, "allow" | "ask" | "deny"> = {};
		for (const [pattern, action] of Object.entries(bash)) if (pattern !== "*") reordered[pattern] = action;
		reordered["*"] = "allow"; // 通配挪到表尾 → 自保护形同虚设
		config.rules.bash = reordered;
		const issues = validateConfig(config);
		expect(issues.filter((i) => i.code === "self-protection")).toHaveLength(4);
	});

	it("rejects bash as a plain action, illegal actions and numeric keys", () => {
		const plain = clone(DEFAULT_PERMISSION_CONFIG);
		plain.rules.bash = "allow";
		expect(validateConfig(plain).map((i) => i.code)).toContain("self-protection");
		const illegal = clone(DEFAULT_PERMISSION_CONFIG);
		(illegal.rules as Record<string, unknown>).read = "maybe";
		(illegal.outside as Record<string, unknown>).write = "yolo";
		const codes = validateConfig(illegal);
		expect(
			codes
				.filter((i) => i.code === "action")
				.map((i) => i.path)
				.sort(),
		).toEqual(["outside.write", "rules.read"]);
		const numeric = clone(DEFAULT_PERMISSION_CONFIG);
		(numeric.rules.bash as Record<string, string>)["123"] = "ask";
		(numeric.rules as Record<string, unknown>)["42"] = "allow";
		expect(
			validateConfig(numeric)
				.filter((i) => i.code === "numeric-key")
				.map((i) => i.path)
				.sort(),
		).toEqual(["rules.42", "rules.bash.123"]);
	});
});

describe("readPermissionSettings / writePermissionSettings", () => {
	it("reports a missing file as defaults and creates it on save; the loader picks the change up", () => {
		const dir = makeAgentDir();
		const snapshot = readPermissionSettings(dir);
		expect(snapshot.exists).toBe(false);
		expect(snapshot.mtimeMs).toBeNull();
		expect(snapshot.effective).toEqual(DEFAULT_PERMISSION_CONFIG);
		expect(snapshot.defaults).toEqual(DEFAULT_PERMISSION_CONFIG);

		const settings = clone(snapshot.effective);
		settings.outside.write = "deny";
		settings.autoApproveProjectEdits = false;
		const result = writePermissionSettings(dir, { settings, expectedMtimeMs: null });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.snapshot.exists).toBe(true);
		expect(result.snapshot.effective.outside.write).toBe("deny");
		expect(result.snapshot.effective.autoApproveProjectEdits).toBe(false);
		const written = JSON.parse(readFileSync(join(dir, "permissions.json"), "utf-8"));
		expect("enabled" in written).toBe(false);
		expect(loadPermissionConfig(dir).outside.write).toBe("deny");
		expect(loadPermissionConfig(dir).autoApproveProjectEdits).toBe(false);
	});

	it("preserves enabled=false from the file, keeps a .bak and refuses invalid input", () => {
		const dir = makeAgentDir();
		const path = join(dir, "permissions.json");
		writeFileSync(path, JSON.stringify({ enabled: false, rules: { read: "deny" } }));
		const snapshot = readPermissionSettings(dir);
		expect(snapshot.effective.enabled).toBe(false);
		expect(snapshot.effective.rules.read).toBe("deny");

		const invalid = clone(snapshot.effective);
		(invalid.rules.bash as Record<string, string>)["*workspaces.json*"] = "allow";
		const rejected = writePermissionSettings(dir, { settings: invalid, expectedMtimeMs: snapshot.mtimeMs });
		expect(rejected.ok).toBe(false);
		if (rejected.ok || rejected.reason !== "invalid") throw new Error("expected invalid");
		expect(rejected.issues[0].code).toBe("self-protection");
		expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ enabled: false, rules: { read: "deny" } });

		const valid = clone(snapshot.effective);
		valid.rules.read = "allow";
		const saved = writePermissionSettings(dir, { settings: valid, expectedMtimeMs: snapshot.mtimeMs });
		expect(saved.ok).toBe(true);
		const written = JSON.parse(readFileSync(path, "utf-8"));
		expect(written.enabled).toBe(false);
		expect(written.rules.read).toBe("allow");
		expect(existsSync(`${path}.bak`)).toBe(true);
		expect(JSON.parse(readFileSync(`${path}.bak`, "utf-8"))).toEqual({
			enabled: false,
			rules: { read: "deny" },
		});
		expect(existsSync(`${path}.${process.pid}.tmp`)).toBe(false);
	});

	it("detects an external modification via mtime and only overwrites when forced", () => {
		const dir = makeAgentDir();
		const path = join(dir, "permissions.json");
		writeFileSync(path, JSON.stringify({ outside: { read: "ask" } }));
		const snapshot = readPermissionSettings(dir);
		// 外部改动：内容 + mtime 都变
		writeFileSync(path, JSON.stringify({ outside: { read: "deny" } }));
		const future = new Date(Date.now() + 5000);
		utimesSync(path, future, future);
		const settings = clone(snapshot.effective);
		settings.outside.temporary = "ask";
		const conflict = writePermissionSettings(dir, { settings, expectedMtimeMs: snapshot.mtimeMs });
		expect(conflict.ok).toBe(false);
		if (conflict.ok || conflict.reason !== "conflict") throw new Error("expected conflict");
		expect(conflict.snapshot.effective.outside.read).toBe("deny");
		expect(loadPermissionConfig(dir).outside.temporary).toBe("allow");
		const forced = writePermissionSettings(dir, { settings, expectedMtimeMs: snapshot.mtimeMs, force: true });
		expect(forced.ok).toBe(true);
		expect(loadPermissionConfig(dir).outside.temporary).toBe("ask");
		expect(statSync(path).mtimeMs).not.toBe(snapshot.mtimeMs);
	});

	it("surfaces a parse error instead of failing and reset restores the defaults while keeping enabled", () => {
		const dir = makeAgentDir();
		const path = join(dir, "permissions.json");
		writeFileSync(path, "{broken");
		const snapshot = readPermissionSettings(dir);
		expect(snapshot.parseError).toBeTruthy();
		expect(snapshot.effective).toEqual(DEFAULT_PERMISSION_CONFIG);

		writeFileSync(path, JSON.stringify({ enabled: false, outside: { write: "deny" } }));
		const restored = resetPermissionSettings(dir);
		expect(restored.effective.outside.write).toBe("ask");
		expect(restored.effective.enabled).toBe(false);
		expect(JSON.parse(readFileSync(path, "utf-8")).enabled).toBe(false);
	});
});

describe("probePermission", () => {
	it("explains a bash command chain: strictest segment, matched pattern and per-candidate steps", () => {
		const dir = makeAgentDir();
		const result = probePermission(dir, {
			tool: "bash",
			input: { command: "git status && git push --force origin main" },
		});
		expect(result.action).toBe("ask");
		expect(result.segment).toBe("git push --force origin main");
		// 后命中生效：git push* 与 git push --force* 都命中，最后一条 git push --force* 胜出
		expect(result.pattern).toBe("git push --force*");
		expect(result.steps.map((s) => s.candidate)).toContain("git status");
		expect(result.steps.find((s) => s.candidate === "git status")?.action).toBe("allow");
		expect(result.boundaryApplied).toBe(false);
	});

	it("evaluates an unsaved draft instead of the file when settings are supplied", () => {
		const dir = makeAgentDir();
		const draft = clone(DEFAULT_PERMISSION_CONFIG);
		(draft.rules.bash as Record<string, string>)["git status*"] = "deny";
		const fromDraft = probePermission(dir, {
			tool: "bash",
			input: { command: "git status" },
			settings: draft,
		});
		expect(fromDraft.action).toBe("deny");
		expect(fromDraft.pattern).toBe("git status*");
		const fromDisk = probePermission(dir, { tool: "bash", input: { command: "git status" } });
		expect(fromDisk.action).toBe("allow");
		expect(fromDisk.pattern).toBe("*");
	});

	it("handles path tools and unknown tools through the same rule chain", () => {
		const dir = makeAgentDir();
		expect(probePermission(dir, { tool: "edit", input: { path: "/tmp/x.ts" } }).action).toBe("ask");
		const custom = probePermission(dir, { tool: "my_tool", input: {} });
		expect(custom.action).toBe("allow");
		expect(custom.matchText).toBeNull();
		expect(custom.steps).toHaveLength(1);
	});
});

describe("readPermissionAuditTail", () => {
	it("returns the newest entries first, skips broken lines and caps at the limit", () => {
		const dir = makeAgentDir();
		const path = join(dir, "permission-audit.jsonl");
		const lines = Array.from({ length: 25 }, (_, i) =>
			JSON.stringify({
				t: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
				tool: "bash",
				action: "ask",
				text: `cmd ${i}`,
			}),
		);
		lines.splice(22, 0, "{not json");
		writeFileSync(path, `${lines.join("\n")}\n`);
		const tail = readPermissionAuditTail(dir, 20);
		expect(tail).toHaveLength(20);
		expect(tail[0].text).toBe("cmd 24");
		expect(tail[19].text).toBe("cmd 5");
		expect(readPermissionAuditTail(makeAgentDir())).toEqual([]);
	});
});
