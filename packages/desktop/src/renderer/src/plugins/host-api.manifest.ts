/**
 * Single source for the public UI-plugin host API names.
 *
 * The generator in `packages/desktop/scripts/gen-plugin-api.mjs` projects this
 * manifest into the main-process shim. The renderer implementation and the
 * distributed declaration file remain ordinary TypeScript so they keep their
 * precise local types; the generator checks that every manifest name is
 * present in both projections.
 */
export const PLUGIN_HOST_API_MANIFEST = {
	version: 1,
	namespaces: {
		components: ["Button", "Dropdown", "Tooltip", "Markdown", "ImagePreview"],
		helpers: ["summarizeArgs", "displayToolName", "openResourceExternal", "openExternal"],
		hooks: ["useT", "useContextUsage", "useLanguage"],
		stores: [
			"useTranscriptStore",
			"useSessionsStore",
			"useUiStore",
			"useProjectsStore",
			"useSettingsStore",
			"useUiPreferencesStore",
			"useKnowledgeStore",
		],
		i18n: ["registerMessages"],
	},
} as const;

export type PluginHostApiManifest = typeof PLUGIN_HOST_API_MANIFEST;
