/**
 * Runtime SDK gateway for the backend.
 *
 * A3 keeps Pi SDK value imports in the session-engine boundary. Domain
 * services consume these small re-exports instead of importing the SDK
 * directly, so the host can replace the session engine without reopening the
 * dependency boundary.
 */

export type { Context, Message, Model, ModelThinkingLevel, Tool } from "@earendil-works/pi-ai";
export { getSupportedThinkingLevels, validateToolArguments } from "@earendil-works/pi-ai";
export { builtinProviders } from "@earendil-works/pi-ai/providers/all";
export type {
	AgentSession,
	AgentSessionEvent,
	AgentToolResult,
	CreateAgentSessionOptions,
	CreateAgentSessionResult,
	DefaultProjectTrust,
	Extension,
	ExtensionContext,
	ExtensionUIContext,
	InlineExtension,
	LoadExtensionsResult,
	ModelRuntime,
	ProjectTrustStore,
	ProjectTrustUpdate,
	ResolvedCommand,
	ResourceLoader,
	SessionEntry,
	SlashCommandInfo,
	ToolCallEvent,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
export {
	createAgentSession,
	DefaultPackageManager,
	DefaultPackageManager as PackageManagerImpl,
	DefaultResourceLoader,
	DefaultResourceLoader as ResourceLoaderImpl,
	getAgentDir,
	hasTrustRequiringProjectResources,
	parseFrontmatter,
	parseSessionEntries,
	SessionManager,
	SettingsManager,
	Theme,
} from "@earendil-works/pi-coding-agent";
export { createAntigravityProvider } from "./antigravity/provider";
export {
	ANTIGRAVITY_API,
	ANTIGRAVITY_PROVIDER_ID,
	AntigravityError,
	safeAntigravityError,
} from "./antigravity/types";
