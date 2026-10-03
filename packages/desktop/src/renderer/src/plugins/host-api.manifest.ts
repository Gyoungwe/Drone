/**
 * Single source for the public UI-plugin host API.
 *
 * The JSON manifest is consumed by the generator and imported here so the
 * renderer and all generated projections use the same names and signatures.
 * Keep implementation details (imports and comments) in the projection files;
 * only the marked namespace blocks are generated.
 */
import manifest from "./host-api.manifest.json";

/** Runtime compatibility view: callers only need the public names and version. */
export const PLUGIN_HOST_API_MANIFEST = {
	version: manifest.version as 1,
	namespaces: {
		components: manifest.namespaces.components.map(({ name }) => name),
		helpers: manifest.namespaces.helpers.map(({ name }) => name),
		hooks: manifest.namespaces.hooks.map(({ name }) => name),
		stores: manifest.namespaces.stores.map(({ name }) => name),
		i18n: manifest.namespaces.i18n.map(({ name }) => name),
	},
} as const;

export type PluginHostApiManifest = typeof PLUGIN_HOST_API_MANIFEST;
