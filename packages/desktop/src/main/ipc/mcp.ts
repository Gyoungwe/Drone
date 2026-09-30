import type { BackendServices, PiBackend } from "@drone/backend";
import { IpcChannels, McpContract } from "@drone/shared";
import { shell } from "electron";
import { bindContract, type ContractImplementation } from "./bind-contract";

/** MCP configuration/status IPC. Contract validation protects renderer input and output shapes. */
export function registerMcpIpc(backend: PiBackend, services?: Pick<BackendServices, "mcp">): void {
	const mcp = services?.mcp ?? backend.mcp;
	const implementation: ContractImplementation<typeof McpContract> = {
		getStatus: (...args) => mcp.getStatus(args[0]),
		getConfig: (...args) => mcp.getConfig(args[0]),
		// Keep the façade adapter here until session reload ownership moves into
		// the MCP service; this preserves /reload behavior after a toggle.
		setServerEnabled: (...args) => backend.setMcpServerEnabled(args[0], args[1], args[2]),
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
			})[method as keyof typeof McpContract.methods],
	});
}
