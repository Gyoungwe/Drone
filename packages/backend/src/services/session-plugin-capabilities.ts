import type { PluginRecordAdoptions } from "@gyoungwe/plugin-api/runtime";
import { agentSlotCapabilityHandlers } from "../plugins/agent-slot-capabilities";
import { modelCapabilityHandlers } from "../plugins/model-capabilities";
import { sessionAdoptionCapabilityHandlers } from "../plugins/session-adoption-capabilities";
import {
	sessionCapabilityHandlers,
	sessionDecisionCapabilityHandlers,
} from "../plugins/session-capabilities";
import { sessionRecordCapabilityHandlers } from "../plugins/session-record-capabilities";
import type { SessionRecordStore } from "../session-engine/session-records";
import type { SessionHost } from "./session-host";

type PluginSessionCapabilityHost = Pick<
	SessionHost,
	"pluginSessions" | "decisions" | "getModelRuntime" | "modelSettings"
>;

export function createPluginSessionCapabilities(
	host: PluginSessionCapabilityHost,
	pluginSessionRecords: SessionRecordStore,
	recordAdoptions?: PluginRecordAdoptions,
) {
	return {
		...sessionCapabilityHandlers(host.pluginSessions),
		...sessionDecisionCapabilityHandlers(host.pluginSessions, host.decisions),
		...sessionRecordCapabilityHandlers(host.pluginSessions, pluginSessionRecords),
		...sessionAdoptionCapabilityHandlers(host.pluginSessions, pluginSessionRecords, recordAdoptions),
		...modelCapabilityHandlers({
			registry: host.pluginSessions,
			getRuntime: () => host.getModelRuntime(),
			getProfileModel: (name) => host.modelSettings.getSubagentModel(name),
			getProfileThinking: (name) => host.modelSettings.getSubagentThinking(name),
		}),
		...agentSlotCapabilityHandlers(),
	};
}
