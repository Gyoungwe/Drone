import { Type } from "typebox";
import type {
	CatalogPackage,
	CatalogPackageType,
	CatalogSearchResult,
	ConfiguredPackageInfo,
	PackageLifecycleReceipt,
} from "../packages";
import { defineDomain } from "./define";

const CatalogPackageTypeSchema = Type.Union([
	Type.Literal(""),
	Type.Literal("extension"),
	Type.Literal("skill"),
	Type.Literal("prompt"),
	Type.Literal("theme"),
]);

const CatalogPackageSchema = Type.Object(
	{
		name: Type.String({ minLength: 1 }),
		description: Type.String(),
		author: Type.String(),
		types: Type.Array(Type.String()),
		downloads: Type.Number({ minimum: 0 }),
		updatedAt: Type.Number(),
		installSource: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);

const CatalogSearchResultSchema = Type.Object(
	{
		packages: Type.Array(CatalogPackageSchema),
		total: Type.Integer({ minimum: 0 }),
		page: Type.Integer({ minimum: 1 }),
		pageSize: Type.Integer({ minimum: 1 }),
	},
	{ additionalProperties: false },
);

const SearchCatalogArgsSchema = Type.Union([
	Type.Tuple([Type.String()]),
	Type.Tuple([Type.String(), Type.Union([CatalogPackageTypeSchema, Type.Undefined()])]),
	Type.Tuple([
		Type.String(),
		Type.Union([CatalogPackageTypeSchema, Type.Undefined()]),
		Type.Union([Type.Integer({ minimum: 1 }), Type.Undefined()]),
	]),
]);

const ConfiguredPackageInfoSchema = Type.Object(
	{
		source: Type.String({ minLength: 1 }),
		scope: Type.Union([Type.Literal("user"), Type.Literal("project")]),
	},
	{ additionalProperties: false },
);

const PackageLifecycleEventSchema = Type.Object(
	{
		type: Type.Union([
			Type.Literal("staged"),
			Type.Literal("verified"),
			Type.Literal("enabled"),
			Type.Literal("disabled"),
			Type.Literal("drained"),
			Type.Literal("reloaded"),
			Type.Literal("reload_deferred"),
			Type.Literal("rolled_back"),
			Type.Literal("failed"),
		]),
		at: Type.Number({ minimum: 0 }),
		sessionId: Type.Optional(Type.String({ minLength: 1 })),
		detail: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const PackageLifecycleErrorSchema = Type.Object(
	{
		code: Type.Union([
			Type.Literal("invalid-source"),
			Type.Literal("builtin"),
			Type.Literal("not-installed"),
			Type.Literal("unavailable"),
			Type.Literal("operation-failed"),
		]),
		message: Type.String({ minLength: 1 }),
		retryable: Type.Boolean(),
	},
	{ additionalProperties: false },
);

const PackageLifecycleReceiptSchema = Type.Object(
	{
		operation: Type.Union([Type.Literal("install"), Type.Literal("update"), Type.Literal("remove")]),
		packageName: Type.String({ minLength: 1 }),
		source: Type.String({ minLength: 1 }),
		scope: Type.Union([Type.Literal("user"), Type.Literal("project")]),
		status: Type.Union([Type.Literal("succeeded"), Type.Literal("failed")]),
		effect: Type.Union([
			Type.Literal("current-session"),
			Type.Literal("next-session"),
			Type.Literal("app-restart"),
		]),
		version: Type.Optional(Type.String({ minLength: 1 })),
		previousVersion: Type.Optional(Type.String({ minLength: 1 })),
		events: Type.Array(PackageLifecycleEventSchema),
		error: Type.Optional(PackageLifecycleErrorSchema),
		reloadedSessionIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
		deferredSessionIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
	},
	{ additionalProperties: false },
);

/** Host API contract for pi.dev community package discovery and management. */
export const PackagesContract = defineDomain("packages", {
	methods: {
		searchCatalog: {
			// Keep the legacy query/type/page call shape, including omitted optional
			// values used by the catalog store.
			args: SearchCatalogArgsSchema,
			result: Type.Unsafe<CatalogSearchResult>(CatalogSearchResultSchema),
		},
		/** Latest published npm version per package name (null when unknown/offline). */
		latestPackageVersions: {
			args: Type.Tuple([Type.Array(Type.String({ minLength: 1 }), { maxItems: 50 })]),
			result: Type.Record(Type.String(), Type.Union([Type.String(), Type.Null()])),
		},
		installPackage: {
			args: Type.Tuple([Type.String({ minLength: 1 })]),
			result: Type.Unsafe<PackageLifecycleReceipt>(PackageLifecycleReceiptSchema),
		},
		updatePackage: {
			args: Type.Tuple([Type.String({ minLength: 1 })]),
			result: Type.Unsafe<PackageLifecycleReceipt>(PackageLifecycleReceiptSchema),
		},
		removePackage: {
			args: Type.Tuple([
				Type.String({ minLength: 1 }),
				Type.Union([Type.Literal("user"), Type.Literal("project")]),
			]),
			result: Type.Unsafe<PackageLifecycleReceipt>(PackageLifecycleReceiptSchema),
		},
		listConfiguredPackages: {
			args: Type.Tuple([]),
			result: Type.Array(Type.Unsafe<ConfiguredPackageInfo>(ConfiguredPackageInfoSchema)),
		},
	},
});

/** Schema-derived package types retained for adapters that need explicit signatures. */
export type PackagesSchemaTypes = {
	searchCatalog: [query: string, type?: CatalogPackageType | "", page?: number];
	installPackage: [name: string];
	updatePackage: [name: string];
	removePackage: [source: string, scope: "user" | "project"];
	listConfiguredPackages: [];
};

/** Keep the shared domain types discoverable alongside the contract. */
export type { CatalogPackage, CatalogPackageType, CatalogSearchResult, ConfiguredPackageInfo };
