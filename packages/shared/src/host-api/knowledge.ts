import { type Static, Type } from "typebox";
import type { KnowledgeUiEvent } from "../knowledge";
import type { ZoteroLocalWriteStatus, ZoteroStatus } from "../zotero";
import { defineDomain } from "./define";

/**
 * Neutral domain routing.
 *
 * The host coordinates three domain groups and keeps one channel per group.
 * Everything inside a group — the operation names beyond the allowlist, their
 * schemas and their validation — belongs to the plugin that owns the domain.
 * Adding a domain operation is therefore one entry in the host's route table,
 * not a new method, schema, IPC channel or generated projection.
 *
 * The envelope stays opaque on purpose: restating a domain schema here would
 * make the host a second owner of it and let the two copies drift.
 */
export const KNOWLEDGE_ROUTE_DOMAINS = ["knowledge", "daily", "zotero"] as const;

export type KnowledgeRouteDomain = (typeof KNOWLEDGE_ROUTE_DOMAINS)[number];

/**
 * One routed call: the operation name inside the domain plus its opaque payload.
 * The domain itself is carried by the channel, so a mistyped operation can
 * never reach another group's implementation.
 */
export const KnowledgeRouteInput = Type.Object(
	{
		operation: Type.String({ minLength: 1, maxLength: 128 }),
		input: Type.Optional(Type.Unknown()),
	},
	{ additionalProperties: false },
);

export type KnowledgeRouteInput = Static<typeof KnowledgeRouteInput>;

/** The routed knowledge group: notes, graph, reviews, semantic, topics, cloud. */
export const KnowledgeContract = defineDomain("knowledge", {
	methods: {
		invoke: {
			args: Type.Tuple([KnowledgeRouteInput]),
			result: Type.Unknown(),
		},
	},
	events: {
		event: Type.Unsafe<KnowledgeUiEvent>({ type: "object" }),
	},
});

/** The routed daily-discovery group. */
export const DailyContract = defineDomain("daily", {
	methods: {
		invoke: {
			args: Type.Tuple([KnowledgeRouteInput]),
			result: Type.Unknown(),
		},
	},
});

/** The routed Zotero group: local write authorization and status. */
export const ZoteroContract = defineDomain("zotero", {
	methods: {
		invoke: {
			args: Type.Tuple([KnowledgeRouteInput]),
			result: Type.Unknown(),
		},
	},
});

export interface KnowledgeHostApi {
	invokeKnowledge(route: KnowledgeRouteInput): Promise<unknown>;
	invokeDaily(route: KnowledgeRouteInput): Promise<unknown>;
	invokeZotero(route: KnowledgeRouteInput): Promise<unknown>;
	/** 知识事件订阅：宿主向所有窗口广播失效与评审打开通知 */
	onKnowledgeEvent(cb: (event: KnowledgeUiEvent) => void): () => void;
	/** Zotero 连接状态（宿主自己的技能设置面板用；插件走 invokeZotero 路由） */
	getZoteroStatus(): Promise<ZoteroStatus>;
	/** Zotero 本地写入授权状态（宿主自己的技能设置面板用） */
	getZoteroLocalWrite(): Promise<ZoteroLocalWriteStatus>;
}
