import type { BackendServices, SessionServicePort } from "@drone/backend";
import { IpcChannels, McpContract } from "@drone/shared";
import { shell } from "electron";
import { bindContract, type ContractImplementation } from "./bind-contract";

/** MCP configuration/status IPC. Contract validation protects renderer input and output shapes. */
export function registerMcpIpc(
	backendOrServices: BackendServices | SessionServicePort,
	services?: Pick<BackendServices, "mcp">,
): void {
	const backend = "sessions" in backendOrServices ? backendOrServices.sessions : backendOrServices;
	const hostServices = services ?? ("sessions" in backendOrServices ? backendOrServices : undefined);
	const legacy = backend as SessionServicePort & {
		setMcpServerEnabled?: BackendServices["mcp"]["setServerEnabled"];
	};
	const mcp =
		hostServices?.mcp ??
		("mcp" in backend ? (backend as SessionServicePort & Pick<BackendServices, "mcp">).mcp : undefined);
	if (!mcp) throw new Error("MCP service is required by the desktop host");
	const implementation: ContractImplementation<typeof McpContract> = {
		getStatus: (...args) => mcp.getStatus(args[0]),
		getConfig: (...args) => mcp.getConfig(args[0]),
		setServerEnabled: (...args) =>
			typeof mcp.setServerEnabled === "function"
				? mcp.setServerEnabled(args[0], args[1], args[2])
				: (legacy.setMcpServerEnabled?.(args[0], args[1], args[2]) ??
					Promise.reject(new Error("MCP toggle service unavailable"))),
		addPreset: (id) => {
			if (typeof mcp.addPreset !== "function")
				return Promise.reject(new Error("MCP preset service unavailable"));
			return mcp.addPreset(id);
		},
		openConfig: async (...args) => {
			const config = await mcp.getConfig(args[0]);
			await shell.openPath(config.path);
		},
	};
	bindContract(McpContract, implementation, {
		channelForMethod: (_contract, method) =>
			({
				getStatus: IpcChannels.McpGetStatus,
				getConfig: IpcChannels.McpGetConfig,
				setServerEnabled: IpcChannels.McpSetServerEnabled,
				openConfig: IpcChannels.McpOpenConfig,
				addPreset: IpcChannels.McpAddPreset,
			})[method as keyof typeof McpContract.methods],
	});
}
