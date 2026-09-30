/**
 * Single source for the public UI-plugin host API.
 *
 * The JSON manifest is consumed by the generator and imported here so the
 * renderer and all generated projections use the same names and signatures.
 * Keep implementation details (imports and comments) in the projection files;
 * only the marked namespace blocks are generated.
 */
import manifest from "./host-api.manifest.json";

export const PLUGIN_HOST_API_MANIFEST = {
	version: manifest.version as 1,
	namespaces: manifest.namespaces,
} as const;

export type PluginHostApiManifest = typeof PLUGIN_HOST_API_MANIFEST;
