import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fauxAssistantMessage, type fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	type createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, vi } from "vitest";
import { SessionService } from "../../src/session-service";
import type { SessionServicePort } from "../../src/session-service-port";

/** Reuse the real session port, including its task grants, with isolated offline state. */
export async function createPackedSessions(root: string) {
	const agentDir = join(root, "profile");
	await mkdir(agentDir, { recursive: true });
	vi.stubEnv("HOME", join(root, "home"));
	vi.stubEnv("USERPROFILE", join(root, "home"));
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "offline-auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const service = new SessionService({
		defaultCwd: join(root, "workspace"),
		userDataDir: join(root, "profile"),
		projectTrust: false,
	});
	service.modelRuntime = modelRuntime;
	return { service: service satisfies SessionServicePort, modelRuntime };
}

export async function loadPackedExtensions(
	options: Pick<
		NonNullable<ConstructorParameters<typeof DefaultResourceLoader>[0]>,
		"cwd" | "agentDir" | "additionalExtensionPaths" | "extensionFactoryForPath"
	>,
) {
	const settingsManager = SettingsManager.inMemory({ projectTrusted: true });
	const loader = new DefaultResourceLoader({
		...options,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
	});
	await loader.reload({ resolveProjectTrust: async () => true });
	expect(loader.getExtensions().errors).toEqual([]);
	return { loader, settingsManager };
}

export async function callPackedSdk(
	session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined,
	provider: ReturnType<typeof fauxProvider> | undefined,
	name: string,
	input: Record<string, unknown>,
) {
	if (!session || !provider) throw new Error("Actual SDK session and offline provider are required");
	provider.setResponses([
		fauxAssistantMessage(fauxToolCall(name, input)),
		fauxAssistantMessage("Protocol receipt verified"),
	]);
	await session.prompt("Use only the requested Inquiry operation on synthetic test data.");
	await session.waitForIdle();
	const receipt = session.messages.filter((message) => message.role === "toolResult").at(-1);
	if (!receipt) throw new Error("Actual SDK did not append a tool result");
	return receipt;
}
