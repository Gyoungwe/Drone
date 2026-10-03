import { Type } from "typebox";
import type {
	CustomProviderInput,
	CustomProviderUpdateInput,
	ListProvidersOptions,
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
		listSubagents: { args: Type.Tuple([]), result: Type.Array(SubagentInfoSchema) },
		startProviderLogin: {
			args: Type.Tuple([StringId, StringId]),
			result: Type.Unsafe<LoginResult>(LoginResultSchema),
		},
		cancelProviderLogin: { args: Type.Tuple([StringId]), result: Type.Void() },
		respondProviderLogin: { args: Type.Tuple([StringId, StringId, Type.String()]), result: Type.Void() },
	},
});

export type SettingsSchemaTypes = {
	listProviders: [options?: ListProvidersOptions];
	saveApiKey: [providerId: string, key: string];
	removeCredential: [providerId: string];
	addCustomProvider: [input: CustomProviderInput];
	updateCustomProvider: [input: CustomProviderUpdateInput];
	setProviderBaseUrl: [providerId: string, baseUrl: string, apiKey?: string];
	setSubagentThinking: [agent: string, level: SubagentThinkingLevel | null];
};
export type { LoginResult, ModelPrefs, ProviderInfo, ProviderTestResult, SubagentInfo };
