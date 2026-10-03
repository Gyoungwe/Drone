import { Type } from "typebox";
import type {
	CatalogPackage,
	CatalogPackageType,
	CatalogSearchResult,
	ConfiguredPackageInfo,
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

/** Host API contract for pi.dev community package discovery and management. */
export const PackagesContract = defineDomain("packages", {
	methods: {
		searchCatalog: {
			// Keep the legacy query/type/page call shape, including omitted optional
			// values used by the catalog store.
			args: SearchCatalogArgsSchema,
			result: Type.Unsafe<CatalogSearchResult>(CatalogSearchResultSchema),
		},
		installPackage: {
			args: Type.Tuple([Type.String({ minLength: 1 })]),
			result: Type.Void(),
		},
		removePackage: {
			args: Type.Tuple([
				Type.String({ minLength: 1 }),
				Type.Union([Type.Literal("user"), Type.Literal("project")]),
			]),
			result: Type.Void(),
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
	removePackage: [source: string, scope: "user" | "project"];
	listConfiguredPackages: [];
};

/** Keep the shared domain types discoverable alongside the contract. */
export type { CatalogPackage, CatalogPackageType, CatalogSearchResult, ConfiguredPackageInfo };
