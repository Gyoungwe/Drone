/**
 * 逐工具权限规则引擎 barrel：实现拆在本目录四模块，入口 = permissions/index.ts（原 permission-rules.ts）。
 * - bash-chain.ts  bash 命令链解析（切段/替换提取/包装剥壳/候选收集）
 * - pattern.ts     规则求值 + 通配匹配 + 模式键建议（含 PermissionAction/Rule/Rules/Outside 类型）
 * - config.ts      permissions.json 读写 + 默认配置（含 PermissionConfig 类型；序列化/校验供设置页）
 * - settings.ts    设置 → 权限 面板后端：快照 / 原子保存 / 恢复默认 / 试算 / 审计尾部
 * - tmp-zone.ts    系统临时区判定 + rm 目标提取（地理分区豁免，纯函数）
 */

export { type PermissionAuditEntry, PermissionAuditLog, permissionAuditPath } from "./audit";
export {
	collectBashCandidates,
	extractShellExecArg,
	extractSubstitutions,
	splitShellSegments,
} from "./bash-chain";
export {
	createPermissionConfigLoader,
	DEFAULT_PERMISSION_CONFIG,
	loadPermissionConfig,
	mergeWithDefaults,
	type PermissionConfig,
	parseConfig,
	permissionConfigPath,
	type SerializedPermissionConfig,
	serializeConfig,
	validateConfig,
} from "./config";
export {
	evaluateBashCommand,
	evaluateRules,
	evaluateSegment,
	matchPattern,
	matchTextFor,
	type PermissionAction,
	type PermissionOutside,
	type PermissionRule,
	type PermissionRules,
	patternMatchesToolCall,
	suggestPattern,
} from "./pattern";
export {
	probePermission,
	readPermissionAuditTail,
	readPermissionSettings,
	resetPermissionSettings,
	writePermissionSettings,
} from "./settings";
export { isRmSegment, isTemporaryPath, rmSegmentExempt, temporaryRoots } from "./tmp-zone";
