import type { AskQuestion, AskRequest, AskResponse } from "@drone/shared";
import { registerTaskRuntime } from "@drone/tasks/runtime";
import type { DroneHostPort, HostCapabilities } from "@gyoungwe/plugin-api";
import { registerDroneCommands } from "./drone-commands";
import { type AskUserToolDeps, makeAskUserTool } from "./tools/ask-user";
import { makeDeliverFilesTool } from "./tools/deliver-files";
import { makeMemorySaveTool } from "./tools/memory-save";
import { makeStatusTool } from "./tools/status";
import { makeTodoTool } from "./tools/todo";

/** The deliberately small host seam used by pi-core. */
export type PiCoreHostPort = Pick<DroneHostPort, "host" | "capabilities" | "requestAuthorization">;

export interface PiCoreContext {
	readonly cwd?: string;
	readonly signal?: AbortSignal;
	readonly ui?: {
		select?: (
			title: string,
			options: string[],
			settings?: { signal?: AbortSignal },
		) => Promise<string | undefined>;
		input?: (
			title: string,
			placeholder?: string,
			settings?: { signal?: AbortSignal },
		) => Promise<string | undefined>;
		confirm?: (title: string, message?: string, settings?: { signal?: AbortSignal }) => Promise<boolean>;
	};
}

export interface PiCoreRegistrationOptions {
	/** Desktop injects its existing ask gate through this callback. */
	ask?: AskUserToolDeps["ask"];
	/** Optional host contract for capability checks and task authorization. */
	host?: PiCoreHostPort;
}

const DEFAULT_HOST_VERSION = "1.1.0";

/** Build a native-Pi host adapter without importing Desktop or backend code. */
export function createNativePiHostPort(
	ctx: PiCoreContext,
	hostVersion = DEFAULT_HOST_VERSION,
): PiCoreHostPort {
	const capabilities = (): HostCapabilities => ({
		host: "native-pi",
		hostVersion,
		pluginApiVersion: 1,
		piApiVersion: 1,
		capabilities: ["requestAuthorization"],
	});
	return {
		host: "native-pi",
		capabilities,
		requestAuthorization: async (input) => {
			const granted = ctx.ui?.confirm
				? await ctx.ui.confirm(
						input.action,
						input.reason || input.scope || "This action requires your authorization.",
						{ signal: ctx.signal },
					)
				: false;
			return {
				granted,
				decidedAt: new Date().toISOString(),
				...(granted ? {} : { reason: "User declined or native Pi UI is unavailable." }),
			};
		},
	};
}

function summarizeQuestion(question: AskQuestion): string {
	const options = question.options.map((option) => option.label).join(" / ");
	return options ? `${question.prompt}\n${options}` : question.prompt;
}

/** Native Pi fallback for the structured ask_user tool. */
async function askWithNativeUi(
	request: Omit<AskRequest, "id" | "sessionId">,
	signal: AbortSignal | undefined,
	ctx: PiCoreContext | undefined,
): Promise<AskResponse> {
	if (!ctx?.ui?.select && !ctx?.ui?.input) return { kind: "cancel" };
	const answers: Record<string, { values: string[] }> = {};
	for (const question of request.questions) {
		if (signal?.aborted) return { kind: "cancel" };
		if (question.type === "text") {
			const value = await ctx.ui?.input?.(question.prompt, "Type your answer", { signal });
			if (value?.trim()) answers[question.id] = { values: [value.trim()] };
			continue;
		}
		const selected = await ctx.ui?.select?.(
			`${question.label || question.id}\n\n${summarizeQuestion(question)}`,
			question.options.map((option) => option.label),
			{ signal },
		);
		if (selected) {
			const option = question.options.find((candidate) => candidate.label === selected);
			if (option) answers[question.id] = { values: [option.value] };
		}
	}
	return { kind: "answer", mode: "submit", answers };
}

/**
 * Register the portable core tools and task runtime on a Pi extension host.
 * Existing Desktop hosts can pass `ask`; native Pi hosts use `ctx.ui`.
 */
export function registerPiCore(pi: any, options: PiCoreRegistrationOptions = {}) {
	if (options.host) {
		const capabilities = options.host.capabilities();
		if (!capabilities.capabilities.includes("requestAuthorization"))
			throw new Error("pi-core host must provide requestAuthorization");
	}
	let activeContext: PiCoreContext | undefined;
	const rememberContext = (_event: unknown, context: PiCoreContext) => {
		activeContext = context;
	};
	pi.on?.("session_start", rememberContext);
	pi.on?.("session_tree", rememberContext);
	pi.on?.("session_shutdown", () => {
		activeContext = undefined;
	});

	registerTaskRuntime(pi);
	registerDroneCommands(pi, {
		hostKind: options.host?.host === "drone-desktop" ? "drone-desktop" : "native-pi",
	});
	const ask =
		options.ask ||
		((request, signal, context) =>
			askWithNativeUi(request, signal, (context as PiCoreContext | undefined) || activeContext));
	pi.registerTool(makeAskUserTool({ ask }));
	pi.registerTool(makeStatusTool());
	pi.registerTool(makeTodoTool());
	pi.registerTool(makeDeliverFilesTool());
	pi.registerTool(makeMemorySaveTool() as any);
	return {
		host: options.host,
		tools: ["ask_user", "set_status", "todo", "deliver_files", "memory_save"],
	};
}

export {
	buildDoctorReport,
	buildExampleReport,
	DRONE_COMMAND_SCHEMA_VERSION,
	PI_CORE_PACKAGE_VERSION,
	PI_HOST_RANGE,
	registerDroneCommands,
} from "./drone-commands";
export { forgetMemory, memoryIndexPrompt, writeMemory } from "./memory";
export { makeAskUserTool } from "./tools/ask-user";
export { deliverFilesParams, makeDeliverFilesTool } from "./tools/deliver-files";
export { MEMORY_SAVE_TOOL, makeMemorySaveTool } from "./tools/memory-save";
export { makeStatusTool } from "./tools/status";
export { formatTodoList, makeTodoTool, normalizeTodos } from "./tools/todo";

export default registerPiCore;
