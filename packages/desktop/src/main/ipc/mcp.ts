import type { BackendServices, SessionServicePort } from "@drone/backend";
import { IpcChannels, McpContract } from "@drone/shared";
import { shell } from "electron";
import { bindContract, type ContractImplementation } from "./bind-contract";

/** MCP configuration/status IPC. Contract validation protects renderer input and output shapes. */
export function registerMcpIpc(backend: SessionServicePort, services?: Pick<BackendServices, "mcp">): void {
	const legacy = backend as SessionServicePort & {
		setMcpServerEnabled?: BackendServices["mcp"]["setServerEnabled"];
	};
	const mcp =
		services?.mcp ??
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
