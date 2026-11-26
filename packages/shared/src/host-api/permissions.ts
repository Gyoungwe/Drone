import { Type } from "typebox";
import type { AskRequest, AskResolved, AskResponse } from "../ask";
import type {
	PermissionAuditTailEntry,
	PermissionProbeInput,
	PermissionProbeResult,
	PermissionSettingsSaveInput,
	PermissionSettingsSaveResult,
	PermissionSettingsSnapshot,
} from "../permission-settings";
import type {
	ChannelWatchConfigInfo,
	ContextManagerConfigInfo,
	ContextManagerMode,
	PermissionAnswer,
	PermissionConfigInfo,
	PermissionMode,
	PermissionRequest,
	PermissionResolved,
	TrustAnswer,
	TrustRequest,
} from "../session";
import { defineDomain } from "./define";

const PermissionSettingsSnapshotSchema = Type.Unsafe<PermissionSettingsSnapshot>({ type: "object" });
const PermissionSettingsSaveInputSchema = Type.Unsafe<PermissionSettingsSaveInput>({
	type: "object",
	properties: {
		settings: { type: "object" },
		expectedMtimeMs: { anyOf: [{ type: "number" }, { type: "null" }] },
		force: { type: "boolean" },
	},
	required: ["settings", "expectedMtimeMs"],
});
const PermissionProbeInputSchema = Type.Unsafe<PermissionProbeInput>({
	type: "object",
	properties: {
		tool: { type: "string", minLength: 1 },
		input: { type: "object" },
		settings: { type: "object" },
	},
	required: ["tool", "input"],
});
const PermissionSettingsSaveResultSchema = Type.Unsafe<PermissionSettingsSaveResult>({ type: "object" });
const PermissionProbeResultSchema = Type.Unsafe<PermissionProbeResult>({ type: "object" });
const PermissionAuditTailEntrySchema = Type.Unsafe<PermissionAuditTailEntry>({ type: "object" });
const AskResponseSchema = Type.Unsafe<AskResponse>({ type: "object" });
const PermissionAnswerSchema = Type.Union([
	Type.Literal("allow"),
	Type.Literal("deny"),
	Type.Literal("allowAlways"),
	Type.Literal("allowDir"),
	Type.Literal("allowRun"),
]);
const PermissionModeSchema = Type.Union([
	Type.Literal("default"),
	Type.Literal("strict"),
	Type.Literal("fullAccess"),
]);
const ContextManagerModeSchema = Type.Union([Type.Literal("evaporation"), Type.Literal("off")]);
const PermissionConfigSchema = Type.Unsafe<PermissionConfigInfo>({ type: "object" });
const ContextManagerConfigSchema = Type.Unsafe<ContextManagerConfigInfo>({ type: "object" });
const ChannelWatchConfigSchema = Type.Unsafe<ChannelWatchConfigInfo>({ type: "object" });

/** Permissions settings host API; all methods remain desktop-only. */
export const PermissionsContract = defineDomain("permissions", {
	methods: {
		load: {
			args: Type.Tuple([]),
			result: PermissionSettingsSnapshotSchema,
		},
		save: {
			args: Type.Tuple([PermissionSettingsSaveInputSchema]),
			result: PermissionSettingsSaveResultSchema,
		},
		reset: {
			args: Type.Tuple([]),
			result: PermissionSettingsSnapshotSchema,
		},
		probe: {
			args: Type.Tuple([PermissionProbeInputSchema]),
			result: PermissionProbeResultSchema,
		},
		auditTail: {
			// TypeBox optional tuple items still produce minItems: 1 in v1.3;
			// express the zero/one argument forms explicitly for IPC callers.
			args: Type.Union([Type.Tuple([]), Type.Tuple([Type.Integer({ minimum: 1 })])]),
			result: Type.Array(PermissionAuditTailEntrySchema),
		},
		respondAsk: {
			args: Type.Tuple([Type.String({ minLength: 1 }), AskResponseSchema]),
			result: Type.Boolean(),
		},
		respondPermission: {
			args: Type.Tuple([Type.String({ minLength: 1 }), PermissionAnswerSchema]),
			result: Type.Void(),
		},
		getConfig: { args: Type.Tuple([]), result: PermissionConfigSchema },
		getMode: { args: Type.Tuple([Type.String({ minLength: 1 })]), result: PermissionModeSchema },
		setMode: {
			args: Type.Tuple([Type.String({ minLength: 1 }), PermissionModeSchema]),
			result: Type.Void(),
		},
		contextManagerGetConfig: { args: Type.Tuple([]), result: ContextManagerConfigSchema },
		contextManagerSetMode: { args: Type.Tuple([ContextManagerModeSchema]), result: Type.Void() },
		channelWatchGetConfig: { args: Type.Tuple([]), result: ChannelWatchConfigSchema },
		channelWatchSetEnabled: { args: Type.Tuple([Type.Boolean()]), result: Type.Void() },
		respondTrust: {
			args: Type.Tuple([Type.String({ minLength: 1 }), Type.Integer()]),
			result: Type.Void(),
		},
		openLocation: { args: Type.Tuple([]), result: Type.Void() },
	},
	events: {
		askRequest: Type.Unsafe<AskRequest>({ type: "object" }),
		askResolved: Type.Unsafe<AskResolved>({ type: "object" }),
		permissionRequest: Type.Unsafe<PermissionRequest>({ type: "object" }),
		permissionResolved: Type.Unsafe<PermissionResolved>({ type: "object" }),
		trustRequest: Type.Unsafe<TrustRequest>({ type: "object" }),
	},
});

export interface PermissionsApi {
	respondAsk(requestId: string, response: AskResponse): Promise<boolean>;
	onAskRequest(cb: (req: AskRequest) => void): () => void;
	onAskResolved(cb: (result: AskResolved) => void): () => void;
	respondPermission(requestId: string, answer: PermissionAnswer): Promise<void>;
	/** 读取权限门控配置（enabled=false = 手改 permissions.json 的隐藏逃生舱态，chip 禁用提示用） */
	getPermissionConfig(): Promise<PermissionConfigInfo>;
	/** 设置 → 权限：读取规则文件快照（路径 / 原文 / 默认合并视图 / mtime） */
	getPermissionSettings(): Promise<PermissionSettingsSnapshot>;
	/** 设置 → 权限：保存（后端二次校验 + mtime 冲突检查；conflict 时不写盘，带回磁盘现状） */
	savePermissionSettings(input: PermissionSettingsSaveInput): Promise<PermissionSettingsSaveResult>;
	/** 设置 → 权限：恢复默认（enabled 保留文件原值） */
	resetPermissionSettings(): Promise<PermissionSettingsSnapshot>;
	/** 设置 → 权限：试算一条工具调用会命中哪条规则（可传未保存草稿；只跑规则链） */
	probePermission(input: PermissionProbeInput): Promise<PermissionProbeResult>;
	/** 设置 → 权限：审计日志尾部（最新在前，默认 20 条） */
	getPermissionAuditTail(limit?: number): Promise<PermissionAuditTailEntry[]>;
	/** 设置 → 权限：在文件管理器中定位 permissions.json（不存在则打开所在目录） */
	openPermissionSettingsLocation(): Promise<void>;
	/** 读取会话权限模式（default 缺省；关 tab 重开后端已归零，renderer 对齐真值用） */
	getPermissionMode(sessionId: string): Promise<PermissionMode>;
	/** 设置会话权限模式（内存态即时生效、不落盘、重启归零） */
	setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void>;
	/** 读取上下文管理模式（evaporation / off 二态派生） */
	getContextManagerConfig(): Promise<ContextManagerConfigInfo>;
	/** 设置上下文管理模式（写后 ≤2s 生效，无需重开会话） */
	setContextManagerMode(mode: ContextManagerMode): Promise<void>;
	/** 读取 channel-watch 频道唤醒开关状态 */
	getChannelWatchConfig(): Promise<ChannelWatchConfigInfo>;
	/** 设置 channel-watch 开关（下一 session_start 生效：目录 init/watcher/工具注册全部跟随） */
	setChannelWatchEnabled(enabled: boolean): Promise<void>;
	/** 应答项目信任请求（optionIndex 为 TrustRequest.options 下标） */
	respondTrust(requestId: string, answer: TrustAnswer): Promise<void>;
	onPermissionRequest(cb: (req: PermissionRequest) => void): () => void;
	onPermissionResolved(cb: (result: PermissionResolved) => void): () => void;
	/** 订阅项目信任请求；返回取消函数 */
	onTrustRequest(cb: (req: TrustRequest) => void): () => void;
}
