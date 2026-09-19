import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type {
	PermissionAuditTailEntry,
	PermissionProbeInput,
	PermissionProbeResult,
	PermissionProbeStep,
	PermissionSettings,
	PermissionSettingsSaveInput,
	PermissionSettingsSaveResult,
	PermissionSettingsSnapshot,
} from "@drone/shared";
import { createLogger } from "../log";
import { permissionAuditPath } from "./audit";
import { collectBashCandidates } from "./bash-chain";
import {
	DEFAULT_PERMISSION_CONFIG,
	mergeWithDefaults,
	type PermissionConfig,
	parseConfig,
	permissionConfigPath,
	serializeConfig,
	validateConfig,
} from "./config";
import {
	evaluateBashCommand,
	evaluateRules,
	evaluateSegment,
	matchPattern,
	matchTextFor,
	type PermissionRules,
} from "./pattern";

const log = createLogger("permission-settings");

/**
 * 设置 → 权限 面板的后端：读 / 校验 / 原子写 permissions.json、规则试算、审计尾部。
 * 写盘只经这里；createPermissionConfigLoader 按 mtime+size 在下一次 tool_call 前重读，
 * 所以保存即生效。`enabled` 永远保留文件原值（D7：只能手改文件）。
 */

interface DiskState {
	raw: string | null;
	parsed: Partial<PermissionConfig>;
	parseError: string | null;
	mtimeMs: number | null;
}

function readDisk(path: string): DiskState {
	if (!existsSync(path)) return { raw: null, parsed: {}, parseError: null, mtimeMs: null };
	const raw = readFileSync(path, "utf-8");
	const mtimeMs = statSync(path).mtimeMs;
	try {
		return { raw, parsed: parseConfig(JSON.parse(raw)), parseError: null, mtimeMs };
	} catch (err) {
		return { raw, parsed: {}, parseError: err instanceof Error ? err.message : String(err), mtimeMs };
	}
}

function clone(config: PermissionConfig): PermissionSettings {
	return JSON.parse(JSON.stringify(config)) as PermissionSettings;
}

export function readPermissionSettings(agentDir: string): PermissionSettingsSnapshot {
	const path = permissionConfigPath(agentDir);
	const disk = readDisk(path);
	return {
		path,
		auditPath: permissionAuditPath(agentDir),
		exists: disk.raw !== null,
		raw: disk.raw,
		parseError: disk.parseError,
		effective: clone(mergeWithDefaults(disk.parsed)),
		defaults: clone(DEFAULT_PERMISSION_CONFIG),
		mtimeMs: disk.mtimeMs,
	};
}

function writeAtomically(path: string, content: string): void {
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	if (existsSync(path)) {
		try {
			copyFileSync(path, `${path}.bak`);
		} catch (err) {
			log.warn("permissions.json.bak 备份失败（继续写入）", err);
		}
	}
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, content, "utf-8");
	renameSync(tmp, path);
}

/**
 * 保存设置页表单：校验 → mtime 冲突检查 → 保留 enabled → tmp+rename 写入（旧文件留 .bak）。
 * mtime 不一致且未 force 时不写盘，把磁盘现状带回给页面选择「重新加载 / 覆盖」。
 */
export function writePermissionSettings(
	agentDir: string,
	input: PermissionSettingsSaveInput,
): PermissionSettingsSaveResult {
	const settings = input.settings as PermissionConfig;
	const issues = validateConfig(settings);
	if (issues.length > 0) return { ok: false, reason: "invalid", issues };
	const path = permissionConfigPath(agentDir);
	const disk = readDisk(path);
	if (!input.force && disk.mtimeMs !== input.expectedMtimeMs) {
		return { ok: false, reason: "conflict", snapshot: readPermissionSettings(agentDir) };
	}
	const enabled = disk.parsed.enabled;
	const json = serializeConfig(settings, enabled === undefined ? undefined : { enabled });
	writeAtomically(path, `${JSON.stringify(json, null, 2)}\n`);
	log.info("permissions.json 已保存", path);
	return { ok: true, snapshot: readPermissionSettings(agentDir) };
}

/** 恢复默认：写入 DEFAULT_PERMISSION_CONFIG 的用户可见字段（enabled 保留文件原值） */
export function resetPermissionSettings(agentDir: string): PermissionSettingsSnapshot {
	const result = writePermissionSettings(agentDir, {
		settings: clone(DEFAULT_PERMISSION_CONFIG),
		expectedMtimeMs: null,
		force: true,
	});
	if (!result.ok) throw new Error("默认配置未通过校验（不应发生）");
	return result.snapshot;
}

/** 单段命中：按键序遍历，最后命中的模式生效（与 evaluateSingle 同构，只多返回模式） */
function decideSegment(
	rules: PermissionRules,
	tool: string,
	text: string | null,
): PermissionProbeStep["pattern"] {
	const rule = rules[tool];
	if (typeof rule !== "object" || rule === null || text === null) return null;
	let hit: string | null = null;
	for (const [pattern, action] of Object.entries(rule)) {
		if ((action === "allow" || action === "ask" || action === "deny") && matchPattern(pattern, text))
			hit = pattern;
	}
	return hit;
}

/**
 * 规则试算：与 permission-gate 同一套求值（bash 命令链取最严段，其余单段），
 * 额外返回每段命中的模式。只跑规则链，不模拟工作区边界/临时区/项目内自动放行（依赖会话 cwd）。
 */
export function probePermission(agentDir: string, input: PermissionProbeInput): PermissionProbeResult {
	const config = input.settings
		? (input.settings as PermissionConfig)
		: mergeWithDefaults(readDisk(permissionConfigPath(agentDir)).parsed);
	const rules = config.rules;
	const tool = input.tool.trim();
	const matchText = matchTextFor(tool, input.input ?? {});
	if (tool === "bash" && matchText) {
		const { action, segment } = evaluateBashCommand(rules, matchText, "ask");
		const steps: PermissionProbeStep[] = collectBashCandidates(matchText).map((candidate) => ({
			candidate,
			action: evaluateSegment(rules, "bash", candidate, "ask"),
			pattern: decideSegment(rules, "bash", candidate),
		}));
		return {
			tool,
			matchText,
			action,
			pattern: decideSegment(rules, "bash", segment),
			segment,
			steps,
			boundaryApplied: false,
		};
	}
	const action = evaluateRules(rules, tool, matchText, "ask");
	return {
		tool,
		matchText,
		action,
		pattern: decideSegment(rules, tool, matchText),
		segment: null,
		steps: [{ candidate: matchText ?? tool, action, pattern: decideSegment(rules, tool, matchText) }],
		boundaryApplied: false,
	};
}

/** 审计日志尾部（默认 20 条，最新在前）；文件不存在返回空数组，坏行跳过 */
export function readPermissionAuditTail(agentDir: string, limit = 20): PermissionAuditTailEntry[] {
	const path = permissionAuditPath(agentDir);
	if (!existsSync(path)) return [];
	const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
	const entries: PermissionAuditTailEntry[] = [];
	for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
		const line = lines[i];
		if (!line) continue;
		try {
			const entry = JSON.parse(line) as PermissionAuditTailEntry;
			if (entry && typeof entry.t === "string" && typeof entry.tool === "string") entries.push(entry);
		} catch {
			// 半行/坏行跳过
		}
	}
	return entries;
}
