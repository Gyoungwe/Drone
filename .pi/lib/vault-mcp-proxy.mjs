import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { McpClient } from "../../vendor/pi-web-ui/dist/server/mcp-bridge.js";
import {
	callVaultTool,
	VAULT_READ_TOOLS,
	VAULT_WRITE_TOOLS,
} from "../../vendor/pi-web-ui/dist/server/vault-policy.js";

// The CLI adapter uses the same policy implementation as the desktop bridge.
const [server, configPath, vault] = process.argv.slice(2);
const client = new McpClient("vault-upstream", { command: process.execPath, args: [server, vault] });
const lines = createInterface({ input: process.stdin });
let started;
lines.on("line", async (line) => {
	let request;
	try {
		request = JSON.parse(line);
		if (request.id === undefined) return;
		let result;
		if (request.method === "initialize") {
			started ??= client.start();
			await started;
			result = {
				protocolVersion: "2025-03-26",
				capabilities: { tools: {} },
				serverInfo: { name: "research-vault-policy", version: "1.0.0" },
			};
		} else if (request.method === "tools/list") {
			await started;
			result = {
				tools: client
					.getTools()
					.filter((tool) => VAULT_READ_TOOLS.has(tool.name) || VAULT_WRITE_TOOLS.has(tool.name)),
			};
		} else if (request.method === "tools/call") {
			const config = JSON.parse(await readFile(configPath, "utf8"));
			const bound = config.obsidianVault && resolve(config.obsidianVault) === resolve(vault);
			const value = await callVaultTool(
				bound ? vault : undefined,
				config.vaultWritePolicy || "managed-block-only",
				request.params.name,
				request.params.arguments || {},
				(name, args) => client.call(name, args),
			);
			result = {
				content: [
					{ type: "text", text: typeof value?.content === "string" ? value.content : JSON.stringify(value) },
				],
			};
		} else if (request.method === "ping") result = {};
		else throw new Error("Unsupported MCP method");
		process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
	} catch (error) {
		if (request?.id !== undefined)
			process.stdout.write(
				JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: error.message } }) +
					"\n",
			);
	}
});
lines.on("close", () => {
	client.close();
	process.exit(0);
});
process.on("SIGTERM", () => {
	client.close();
	process.exit(0);
});
