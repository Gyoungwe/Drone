import { Type } from "typebox";
import type {
	UiPluginContribution,
	UiPluginInfo,
	UiPluginManifest,
	UiPluginsConfig,
	UiPluginsEventPayload,
} from "../ui-plugins";
import { defineDomain } from "./define";
import { PackageLifecycleReceiptSchema } from "./packages";

const UiPluginAnchorSchema = Type.Union([
	Type.Literal("top-left"),
	Type.Literal("top-center"),
	Type.Literal("top-right"),
	Type.Literal("center-left"),
	Type.Literal("center"),
	Type.Literal("center-right"),
	Type.Literal("bottom-left"),
	Type.Literal("bottom-center"),
	Type.Literal("bottom-right"),
]);

const UiPluginContributionSchema = Type.Object(
	{
		id: Type.String({ minLength: 1 }),
		region: Type.String({ minLength: 1 }),
		export: Type.String({ minLength: 1 }),
		anchor: Type.Optional(UiPluginAnchorSchema),
		title: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const UiPluginManifestSchema = Type.Object(
	{
		name: Type.String({ minLength: 1 }),
		droneUi: Type.Union([Type.Literal(1), Type.Literal(2)]),
		main: Type.String({ minLength: 1 }),
		slots: Type.Optional(Type.Record(Type.String(), Type.String())),
		contributions: Type.Optional(Type.Array(UiPluginContributionSchema)),
		headless: Type.Optional(Type.Boolean()),
		version: Type.Optional(Type.String()),
		displayName: Type.Optional(Type.String()),
		description: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const UiPluginInfoSchema = Type.Object(
	{
		name: Type.String({ minLength: 1 }),
		packageName: Type.Optional(Type.String({ minLength: 1 })),
		displayName: Type.Optional(Type.String()),
		description: Type.Optional(Type.String()),
		version: Type.Optional(Type.String()),
		droneUi: Type.Optional(Type.Integer({ minimum: 1 })),
		slots: Type.Record(Type.String(), Type.String()),
		contributions: Type.Array(UiPluginContributionSchema),
		headless: Type.Optional(Type.Boolean()),
		enabled: Type.Boolean(),
		trusted: Type.Boolean(),
		invalidReason: Type.Optional(Type.String()),
		buildError: Type.Optional(Type.String()),
		built: Type.Boolean(),
		builtin: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);

const UiPluginsConfigSchema = Type.Object(
	{
		enabled: Type.Boolean(),
		plugins: Type.Record(
			Type.String(),
			Type.Object(
				{
					enabled: Type.Boolean(),
					trusted: Type.Boolean(),
				},
				{ additionalProperties: false },
			),
		),
		assignments: Type.Record(Type.String(), Type.String()),
		installations: Type.Optional(
			Type.Record(
				Type.String(),
				Type.Object(
					{ root: Type.String({ minLength: 1 }), hash: Type.String({ minLength: 1 }) },
					{
						additionalProperties: false,
					},
				),
			),
		),
	},
	{ additionalProperties: false },
);

const UiPluginsEventSchema = Type.Union([
	Type.Object(
		{ kind: Type.Literal("changed"), name: Type.String({ minLength: 1 }) },
		{ additionalProperties: false },
	),
	Type.Object(
		{
			kind: Type.Literal("config"),
			receipt: Type.Optional(PackageLifecycleReceiptSchema),
			reloadUi: Type.Optional(Type.Literal(false)),
		},
		{ additionalProperties: false },
	),
]);

/** Host API contract for UI plugin discovery, configuration, and hot reload. */
export const UiPluginsContract = defineDomain("uiPlugins", {
	methods: {
		getConfig: {
			args: Type.Tuple([]),
			result: Type.Unsafe<UiPluginsConfig>(UiPluginsConfigSchema),
		},
		setEnabled: {
			args: Type.Tuple([Type.Boolean()]),
			result: Type.Void(),
		},
		list: {
			args: Type.Tuple([]),
			result: Type.Array(Type.Unsafe<UiPluginInfo>(UiPluginInfoSchema)),
		},
		readCode: {
			args: Type.Tuple([Type.String({ minLength: 1 })]),
			result: Type.Union([
				Type.Object(
					{
						manifest: Type.Unsafe<UiPluginManifest>(UiPluginManifestSchema),
						code: Type.String(),
						runtimeBinding: Type.Optional(Type.String({ minLength: 1 })),
					},
					{ additionalProperties: false },
				),
				Type.Object({ error: Type.String() }, { additionalProperties: false }),
			]),
		},
		setPluginEnabled: {
			args: Type.Tuple([Type.String({ minLength: 1 }), Type.Boolean()]),
			result: Type.Void(),
		},
		assignSlot: {
			args: Type.Tuple([Type.String({ minLength: 1 }), Type.Union([Type.String(), Type.Null()])]),
			result: Type.Void(),
		},
		rebuild: {
			args: Type.Tuple([Type.String({ minLength: 1 })]),
			result: Type.Union([
				Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false }),
				Type.Object({ ok: Type.Literal(false), error: Type.String() }, { additionalProperties: false }),
			]),
		},
		openDir: {
			// TypeBox optional tuple items still produce minItems=1; model the
			// no-argument and named-plugin forms explicitly.
			args: Type.Union([Type.Tuple([]), Type.Tuple([Type.String({ minLength: 1 })])]),
			result: Type.Void(),
		},
	},
	events: {
		event: Type.Unsafe<UiPluginsEventPayload>(UiPluginsEventSchema),
	},
});

export interface UiPluginsApi {
	/** 读 UI 插件全局配置（总开关/启用信任表/槽位指派） */
	uiPluginsGetConfig(): Promise<UiPluginsConfig>;
	/** 设 UI 插件全局总开关 */
	uiPluginsSetEnabled(enabled: boolean): Promise<void>;
	/** 列 UI 插件（含 enabled/trusted/buildError/invalidReason） */
	uiPluginsList(): Promise<UiPluginInfo[]>;
	/** 读插件构建产物（name 必须是扫描到的合法插件名，禁路径）；{ manifest, code } 或 { error } */
	uiPluginsReadCode(
		name: string,
	): Promise<{ manifest: UiPluginManifest; code: string; runtimeBinding?: string } | { error: string }>;
	/** 启用/停用单个插件（启用=信任，同步落盘） */
	uiPluginsSetPluginEnabled(name: string, enabled: boolean): Promise<void>;
	/** 槽位指派（pluginName=null 取消指派） */
	uiPluginsAssignSlot(slot: string, pluginName: string | null): Promise<void>;
	/** 重新构建插件（构建失败返回错误信息，旧产物保留） */
	uiPluginsRebuild(name: string): Promise<{ ok: true } | { ok: false; error: string }>;
	/** 打开插件目录（不传 name 开根目录；shell.openPath） */
	uiPluginsOpenDir(name?: string): Promise<void>;
	/** 订阅 UI 插件事件（changed/config）；返回取消函数 */
	onUiPluginsEvent(cb: (payload: UiPluginsEventPayload) => void): () => void;
}

export type UiPluginsSchemaTypes = {
	getConfig: [];
	setEnabled: [enabled: boolean];
	list: [];
	readCode: [name: string];
	setPluginEnabled: [name: string, enabled: boolean];
	assignSlot: [slot: string, pluginName: string | null];
	rebuild: [name: string];
	openDir: [name?: string];
};

export type { UiPluginContribution, UiPluginInfo, UiPluginManifest, UiPluginsConfig };
