import {
	type DroneRuntime,
	type HarnessUnit,
	type McpStatus,
	resolveHarnessUnits,
	type SessionEvent,
} from "@drone/shared";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { InlineExtension, ModelRuntime, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { makeCapabilityExtension } from "../capabilities/extension";
import type { CapabilityRuntime } from "../capabilities/runtime";
import { makeKnowledgeSpecialistBridge } from "../knowledge/specialist-bridge";
import { createLogger } from "../log";
import {
	makePermissionGateExtension,
	type PermissionConfirm,
	type PermissionModeRef,
} from "../permissions/extension";
import type { PermissionGate } from "../permissions/gate";
import type { AskGate } from "../session/ask-gate";
import type { SessionTraces } from "../session/traces";
import { bindAcceptanceVerifierEvents } from "../tasks/acceptance";
import { makeAskUserTool } from "../tools/ask-user";
import { makeBioDatabaseTool } from "../tools/bio/databases";
import { makeBioExtension } from "../tools/bio/extension";
import { makeBioEnvironmentTool } from "../tools/bio/tool";
import { makeCapabilityLoadTool } from "../tools/capability-load";
import { makeChannelWatchExtension } from "../tools/channel-watch";
import { makeEvapExtension, reportEvapBatch } from "../tools/context-evaporation";
import { bindToolManifestEvents } from "../tools/manifest";
import { makeShowImageTool } from "../tools/show-image";
import { makeSshHostsTool, makeSshTool, type SshHostEntry } from "../tools/ssh";
import { makeStatusTool } from "../tools/status";
import { makeSubagentTool } from "../tools/subagent";
import { makeTodoTool } from "../tools/todo";
import { makeTodoReminderExtension } from "../tools/todo-reminder";
import { makeWebFetchTool } from "../tools/webfetch";
import { makeHarnessContextExtension } from "./harness/context";
import { makeHarnessDeliveryExtension } from "./harness/delivery";
import { makeHarnessGuardExtension } from "./harness/guards";
import { makeHarnessRecallTool } from "./harness/recall";

const log = createLogger("session-harness");
const warnedHarnessUnits = new Set<string>();

function resolveSessionHarnessUnits(deps: SessionExtensionDependencies) {
	const resolved = resolveHarnessUnits(deps, process.env.DRONE_HARNESS_DISABLE);
	const unknown = resolved.ignored.filter((name) => !warnedHarnessUnits.has(name));
	if (unknown.length > 0) {
		for (const name of unknown) warnedHarnessUnits.add(name);
		log.warn("ignored unknown harness units", { units: unknown });
	}
	return resolved.units;
}

type LiveChildControl = {
	steer: (message: string, mode?: "steer" | "followUp") => Promise<void>;
	reply: (requestId: string, message: string) => boolean;
};

export interface SessionExtensionDependencies {
	/** Host-owned runtime shared with first-party .pi extensions through a versioned event. */
	runtime: DroneRuntime;
	permissionGates?: boolean;
	permissionExtension?: boolean;
	/** Host-owned bounded prompt/checkpoint contract; enabled by default. */
	harnessContext?: boolean;
	harness?: Partial<Record<HarnessUnit, boolean>>;
	subagentPreferBuiltin?: boolean;
	webFetch?: boolean | { allowRanges?: string[] };
	tools?: string[];
	customTools?: ToolDefinition[];
	desktopIntegration?: {
		academicPiRoot?: string;
		additionalExtensionPaths?: string[];
		additionalPromptTemplatePaths?: string[];
	};
	getModelRuntime: () => Promise<ModelRuntime>;
	getSubagentModel: (agentName: string) => Promise<string | undefined>;
	getSubagentThinking?: (agentName: string) => Promise<ModelThinkingLevel | undefined>;
	traces: SessionTraces;
	onEvent: (sessionId: string, event: SessionEvent) => void;
	registerLiveChild?: (sessionId: string, control: LiveChildControl) => () => void;
	setMcpStatus: (cwd: string, status: McpStatus) => void;
	/** 已登记的远程主机（设置 › 高级 › SSH 主机）；缺省则 ssh 只认 ~/.ssh/config 与直接主机名 */
	listSshHosts?: () => Promise<SshHostEntry[]>;
	/** Successful agent-made decisions emitted by first-party task/literature extensions. */
	onDecision?: (sessionId: string, event: unknown) => void;
}

/** Build host-owned tools once per session. This module is the only place where
 * the lifecycle layer knows how the built-in Drone tools are wired together. */
export function buildSessionCustomTools(
	deps: SessionExtensionDependencies,
	gate: PermissionGate,
	askGate: Pick<AskGate, "ask">,
	capabilities?: CapabilityRuntime,
): ToolDefinition[] {
	const harness = resolveSessionHarnessUnits(deps);
	const tools = [...(deps.customTools ?? [])];
	if (deps.webFetch !== false)
		tools.push(makeWebFetchTool(typeof deps.webFetch === "object" ? deps.webFetch : undefined));
	tools.push(makeAskUserTool({ ask: (request, signal) => askGate.ask(request, signal) }));
	if (capabilities) tools.push(makeCapabilityLoadTool(capabilities));
	tools.push(makeShowImageTool());
	tools.push(
		makeSshTool({
			confirm: (title, message) => gate.confirm(title, message, { kind: "command" }),
			...(deps.listSshHosts ? { hosts: deps.listSshHosts } : {}),
		}) as ToolDefinition,
	);
	if (deps.listSshHosts) tools.push(makeSshHostsTool(deps.listSshHosts));
	tools.push(
		makeBioEnvironmentTool({
			confirm: (title, message) => gate.confirm(title, message, { kind: "command" }),
			...(deps.listSshHosts ? { hosts: deps.listSshHosts } : {}),
		}) as ToolDefinition,
	);
	tools.push(makeBioDatabaseTool() as ToolDefinition);
	tools.push(makeStatusTool());
	tools.push(makeTodoTool());
	if (harness.recall) {
		tools.push(
			makeHarnessRecallTool({
				recordUnit: (sessionId, unit, action) =>
					deps.traces.recordCustom(sessionId, "harness_unit", { unit, action }),
			}),
		);
	}
	if (deps.subagentPreferBuiltin !== false) {
		tools.push(
			makeSubagentTool({
				getModelRuntime: deps.getModelRuntime,
				getSubagentModel: deps.getSubagentModel,
				gate,
				traces: deps.traces,
				onEvent: deps.onEvent,
				registerLiveChild: deps.registerLiveChild,
			}),
		);
	}
	return tools;
}

/** Build the inline extensions attached to a project session. */
export function buildSessionExtensionFactories(
	deps: SessionExtensionDependencies,
	cwd: string,
	confirm: PermissionConfirm | undefined,
	modeRef?: PermissionModeRef,
	capability?: CapabilityRuntime,
): InlineExtension[] {
	const harness = resolveSessionHarnessUnits(deps);
	const factories: InlineExtension[] = [];
	if (capability)
		factories.push(makeCapabilityExtension(capability, deps.desktopIntegration?.academicPiRoot));
	factories.push((pi) => {
		// Dynamic .pi extensions load before inline factories. They subscribe to this
		// versioned event during initialization and receive the same host-owned runtime
		// without a process-global Symbol bridge.
		// Their tool declarations use the same request/replay handshake, so the
		// backend collector sees registrations emitted before this factory ran.
		bindToolManifestEvents(pi.events);
		bindAcceptanceVerifierEvents(pi.events, deps.runtime);
		const announceRuntime = () => pi.events.emit("drone:runtime/v1", { version: 1, runtime: deps.runtime });
		pi.events.on("drone:runtime/request/v1", announceRuntime);
		announceRuntime();
		pi.events.on("pi-mcp-adapter/status/v1", (payload) => {
			if (!payload || typeof payload !== "object") return;
			deps.setMcpStatus(cwd, payload as McpStatus);
		});
		pi.events.on("drone:decision-record/v1", (payload) => {
			deps.onDecision?.(cwd, payload);
		});
	});
	if (deps.permissionGates !== false && deps.permissionExtension !== false) {
		factories.push(
			makePermissionGateExtension(getAgentDir(), {
				projectRoot: cwd,
				confirm,
				getMode: () => modeRef?.current ?? "default",
			}),
		);
	}
	if (deps.subagentPreferBuiltin !== false)
		factories.push(
			makeKnowledgeSpecialistBridge({
				getRuntime: deps.getModelRuntime,
				getModelPreference: deps.getSubagentModel,
				getThinkingPreference: deps.getSubagentThinking,
			}),
		);
	if (harness.context)
		factories.push(
			makeHarnessContextExtension({
				familyPrompt: harness.familyPrompt,
				reportStatus: (sessionId, status) => deps.traces.recordCustom(sessionId, "harness_contract", status),
				report: (sessionId, checkpoint) =>
					deps.traces.recordCustom(sessionId, "harness_checkpoint", checkpoint),
				recordUnit: (sessionId, unit, action, details) =>
					deps.traces.recordCustom(sessionId, "harness_unit", { unit, action, ...details }),
			}),
		);
	if (harness.guard || harness.delivery) {
		const report = (sessionId: string, kind: string, data: unknown) =>
			deps.traces.recordCustom(sessionId, kind, data);
		const recordUnit = (sessionId: string, unit: HarnessUnit, action: string) =>
			deps.traces.recordCustom(sessionId, "harness_unit", { unit, action });
		if (harness.guard) factories.push(makeHarnessGuardExtension({ report, recordUnit }));
		if (harness.delivery)
			factories.push(
				makeHarnessDeliveryExtension({
					report,
					recordUnit,
					review: (sessionId, snapshot) => {
						deps.runtime.knowledge.reviewer?.schedule({
							sessionId,
							snapshot,
							trigger: "milestone-complete",
						});
					},
				}),
			);
	}
	factories.push(
		makeEvapExtension({
			agentDir: getAgentDir(),
			reporter: (sessionId, batch) => {
				reportEvapBatch(sessionId, batch);
				deps.traces.recordCustom(sessionId, "evap_batch", batch);
			},
		}),
	);
	factories.push(makeChannelWatchExtension({ agentDir: getAgentDir(), cwd }));
	factories.push(makeTodoReminderExtension());
	factories.push(makeBioExtension());
	return factories;
}

export function makeCapabilitySessionExtension(
	capabilities: CapabilityRuntime,
	academicRoot?: string,
): InlineExtension {
	return makeCapabilityExtension(capabilities, academicRoot);
}

export { getAgentDir };
