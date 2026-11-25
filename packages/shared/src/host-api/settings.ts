import { Type } from "typebox";
import type {
	CustomProviderInput,
	CustomProviderUpdateInput,
	ListProvidersOptions,
	LoginEventPayload,
	LoginResult,
	ModelPrefs,
	ProviderInfo,
	ProviderTestResult,
	SubagentInfo,
	SubagentThinkingLevel,
} from "../settings";
import { defineDomain } from "./define";

const StringId = Type.String({ minLength: 1 });
const ProviderOptions = Type.Object(
	{ forceNetwork: Type.Optional(Type.Boolean()) },
	{ additionalProperties: false },
);
const ProviderModel = Type.Object(
	{
		id: StringId,
		name: StringId,
		reasoning: Type.Optional(Type.Boolean()),
		contextWindow: Type.Optional(Type.Number({ minimum: 0 })),
		maxTokens: Type.Optional(Type.Number({ minimum: 0 })),
		imageInput: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);
const ProviderInfoSchema = Type.Object(
	{
		id: StringId,
		name: Type.String(),
		custom: Type.Boolean(),
		overridesBuiltin: Type.Optional(Type.Boolean()),
		configured: Type.Boolean(),
		authSource: Type.Optional(Type.String()),
		authLabel: Type.Optional(Type.String()),
		oauth: Type.Optional(
			Type.Object(
				{ loginLabel: Type.Optional(Type.String()), isSubscription: Type.Optional(Type.Boolean()) },
				{ additionalProperties: false },
			),
		),
		apiKeyLogin: Type.Optional(Type.Boolean()),
		baseUrl: Type.Optional(Type.String()),
		api: Type.Optional(Type.String()),
		customModels: Type.Optional(
			Type.Array(
				Type.Object(
					{
						id: StringId,
						name: Type.Optional(Type.String()),
						reasoning: Type.Optional(Type.Boolean()),
						contextWindow: Type.Optional(Type.Number({ minimum: 0 })),
						maxTokens: Type.Optional(Type.Number({ minimum: 0 })),
						imageInput: Type.Optional(Type.Boolean()),
					},
					{ additionalProperties: false },
				),
			),
		),
		models: Type.Array(ProviderModel),
	},
	{ additionalProperties: false },
);
const ModelPrefsSchema = Type.Object(
	{
		hiddenModels: Type.Record(Type.String(), Type.Array(Type.String())),
		subagentModels: Type.Record(Type.String(), Type.String()),
		subagentThinking: Type.Record(
			Type.String(),
			Type.Union([
				Type.Literal("off"),
				Type.Literal("minimal"),
				Type.Literal("low"),
				Type.Literal("medium"),
				Type.Literal("high"),
				Type.Literal("xhigh"),
				Type.Literal("max"),
			]),
		),
		backgroundReviewerModel: Type.Boolean(),
	},
	{ additionalProperties: false },
);
const CustomModel = Type.Object(
	{
		id: StringId,
		name: Type.Optional(Type.String()),
		reasoning: Type.Optional(Type.Boolean()),
		contextWindow: Type.Optional(Type.Number({ minimum: 0 })),
		maxTokens: Type.Optional(Type.Number({ minimum: 0 })),
		imageInput: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);
const CustomProvider = Type.Object(
	{
		id: StringId,
		name: Type.Optional(Type.String()),
		baseUrl: Type.String({ minLength: 1 }),
		api: Type.String({ minLength: 1 }),
		models: Type.Array(CustomModel),
		apiKey: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);
const SubagentInfoSchema = Type.Object(
	{
		name: StringId,
		description: Type.String(),
		source: Type.Union([Type.Literal("builtin"), Type.Literal("user")]),
	},
	{ additionalProperties: false },
);
const LoginResultSchema = Type.Object(
	{ ok: Type.Boolean(), cancelled: Type.Optional(Type.Boolean()), error: Type.Optional(Type.String()) },
	{ additionalProperties: false },
);
const ProviderTestResultSchema = Type.Object(
	{ ok: Type.Boolean(), error: Type.Optional(Type.String()), modelId: Type.Optional(Type.String()) },
	{ additionalProperties: false },
);

/** Provider, model preference, and interactive login host API. */
export const SettingsContract = defineDomain("settings", {
	methods: {
		listProviders: {
			args: Type.Union([Type.Tuple([]), Type.Tuple([ProviderOptions])]),
			result: Type.Array(ProviderInfoSchema),
		},
		saveApiKey: { args: Type.Tuple([StringId, Type.String()]), result: Type.Void() },
		removeCredential: { args: Type.Tuple([StringId]), result: Type.Void() },
		addCustomProvider: { args: Type.Tuple([CustomProvider]), result: Type.Void() },
		updateCustomProvider: { args: Type.Tuple([CustomProvider]), result: Type.Void() },
		removeCustomProvider: { args: Type.Tuple([StringId]), result: Type.Void() },
		setProviderBaseUrl: {
			args: Type.Union([
				Type.Tuple([StringId, Type.String()]),
				Type.Tuple([StringId, Type.String(), Type.String()]),
			]),
			result: Type.Void(),
		},
		testProvider: {
			args: Type.Union([Type.Tuple([StringId]), Type.Tuple([StringId, StringId])]),
			result: Type.Unsafe<ProviderTestResult>(ProviderTestResultSchema),
		},
		getModelPrefs: { args: Type.Tuple([]), result: Type.Unsafe<ModelPrefs>(ModelPrefsSchema) },
		setModelHidden: {
			args: Type.Tuple([StringId, StringId, Type.Boolean()]),
			result: Type.Unsafe<ModelPrefs>(ModelPrefsSchema),
		},
		setModelsHidden: {
			args: Type.Tuple([StringId, Type.Array(StringId), Type.Boolean()]),
			result: Type.Unsafe<ModelPrefs>(ModelPrefsSchema),
		},
		setSubagentModel: {
			args: Type.Tuple([StringId, Type.Union([Type.String(), Type.Null()])]),
			result: Type.Unsafe<ModelPrefs>(ModelPrefsSchema),
		},
		setSubagentThinking: {
			args: Type.Tuple([StringId, Type.Union([Type.String(), Type.Null()])]),
			result: Type.Unsafe<ModelPrefs>(ModelPrefsSchema),
		},
		setBackgroundReviewerModel: {
			args: Type.Tuple([Type.Boolean()]),
			result: Type.Unsafe<ModelPrefs>(ModelPrefsSchema),
		},
		listSubagents: { args: Type.Tuple([]), result: Type.Array(SubagentInfoSchema) },
		startProviderLogin: {
			args: Type.Tuple([StringId, StringId]),
			result: Type.Unsafe<LoginResult>(LoginResultSchema),
		},
		cancelProviderLogin: { args: Type.Tuple([StringId]), result: Type.Void() },
		respondProviderLogin: { args: Type.Tuple([StringId, StringId, Type.String()]), result: Type.Void() },
	},
	events: { loginEvent: Type.Unsafe<LoginEventPayload>({ type: "object" }) },
});

export interface SettingsApi {
	/** 列出 provider（默认只走内置目录+本地缓存；forceNetwork 时联网拉最新模型目录） */
	listProviders(options?: ListProvidersOptions): Promise<ProviderInfo[]>;
	saveApiKey(providerId: string, key: string): Promise<void>;
	removeCredential(providerId: string): Promise<void>;
	addCustomProvider(input: CustomProviderInput): Promise<void>;
	/** 更新自定义 provider（ID 不可改；apiKey 留空保持不变） */
	updateCustomProvider(input: CustomProviderUpdateInput): Promise<void>;
	removeCustomProvider(providerId: string): Promise<void>;
	/** 内置 provider 的可选 baseUrl 覆写（pi 官方语义：不写 models，共享官方模型列表）；baseUrl 空串 = 清除覆写回官方 */
	setProviderBaseUrl(providerId: string, baseUrl: string, apiKey?: string): Promise<void>;
	testProvider(providerId: string, modelId?: string): Promise<ProviderTestResult>;
	/** 读取用户级模型可见性与子代理模型偏好 */
	getModelPrefs(): Promise<ModelPrefs>;
	/** 设置模型在选择器中的可见性；隐藏不影响已经选中的会话运行 */
	setModelHidden(provider: string, modelId: string, hidden: boolean): Promise<ModelPrefs>;
	/** 批量设置一组模型可见性（一键全隐藏/全显示某 provider 的全部模型）；一次写盘 */
	setModelsHidden(provider: string, modelIds: string[], hidden: boolean): Promise<ModelPrefs>;
	/** 为子代理指定 provider/model；null = 继承父会话模型 */
	setSubagentModel(agent: string, modelRef: string | null): Promise<ModelPrefs>;
	/** 为子代理指定 thinking；null = 跟随父会话 thinking。 */
	setSubagentThinking(agent: string, level: SubagentThinkingLevel | null): Promise<ModelPrefs>;
	/** 开关后台模型审稿；关闭时后台审稿只运行纯规则检查。 */
	setBackgroundReviewerModel(enabled: boolean): Promise<ModelPrefs>;
	/** 列内置与用户级 subagent 定义（不读项目级定义） */
	listSubagents(): Promise<SubagentInfo[]>;
	/** 启动 provider 交互登录（OAuth 浏览器/设备码流 · api_key 提示/选择流）；事件经 onProviderLoginEvent 推送，promise 在流程结束时 resolve（取消不算错误） */
	startProviderLogin(loginId: string, providerId: string): Promise<LoginResult>;
	/** 取消进行中的登录流程（未知 loginId 静默忽略） */
	cancelProviderLogin(loginId: string): Promise<void>;
	/** 应答登录过程中的输入/选择提示（promptId 已被外部取消时静默忽略） */
	respondProviderLogin(loginId: string, promptId: string, value: string): Promise<void>;
	/** 订阅登录流程事件（event/prompt/prompt-cancel，按 loginId 归属）；返回取消函数 */
	onProviderLoginEvent(cb: (payload: LoginEventPayload) => void): () => void;
}

export type SettingsSchemaTypes = {
	listProviders: [options?: ListProvidersOptions];
	saveApiKey: [providerId: string, key: string];
	removeCredential: [providerId: string];
	addCustomProvider: [input: CustomProviderInput];
	updateCustomProvider: [input: CustomProviderUpdateInput];
	setProviderBaseUrl: [providerId: string, baseUrl: string, apiKey?: string];
	setSubagentThinking: [agent: string, level: SubagentThinkingLevel | null];
	setBackgroundReviewerModel: [enabled: boolean];
};
export type { LoginResult, ModelPrefs, ProviderInfo, ProviderTestResult, SubagentInfo };
