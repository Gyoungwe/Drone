// Host adapter for the typed source archive runtime. Network, workspace,
// institutional-session and knowledge-note effects are injected here; source
// identity, OA fallback, path/content gates and manifest semantics are owned by
// @drone/research/source-archive.

import { loadWorkspaceConfig } from "../extensions/workspace-config.mjs";
import {
	buildProxiedUrl,
	institutionalFetch,
	isElectronAvailable,
	loadInstitutionalConfig,
} from "./institutional-access.mjs";
import { publishSourceNote } from "./obsidian-workbench.mjs";
import { runRuntimeExclusive } from "./runtime-bridge.mjs";
import { archiveSource as archiveTyped, sourceStatus as statusTyped } from "./source-archive-core.mjs";

const ports = {
	workspace: loadWorkspaceConfig,
	publishSourceNote,
	exclusive: (key, work) => runRuntimeExclusive("source-archive", key, work),
	loadInstitutionalConfig,
	isElectronAvailable,
	institutionalFetch,
	buildProxiedUrl,
};

export const archiveSource = (options = {}) => archiveTyped(options, ports);
export const sourceStatus = (options = {}) => statusTyped(options, ports);
export default { archiveSource, sourceStatus };
