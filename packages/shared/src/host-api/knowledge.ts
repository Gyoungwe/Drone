import { type Static, Type } from "typebox";
import type { KnowledgeUiEvent } from "../knowledge";
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
