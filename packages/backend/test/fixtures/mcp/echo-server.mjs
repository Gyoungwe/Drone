// Minimal stdio MCP server used by the bundled pi-mcp-adapter SDK test (newline-delimited JSON-RPC).
import { createInterface } from "node:readline";

const tools = [
	{
		name: "echo",
		description: "Echo the given text back.",
		inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
	},
];

function send(message) {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

createInterface({ input: process.stdin }).on("line", (line) => {
	let request;
	try {
		request = JSON.parse(line);
	} catch {
		return;
	}
	if (request.id === undefined) return;
	switch (request.method) {
		case "initialize":
			send({
				id: request.id,
				result: {
					protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
					capabilities: { tools: {} },
					serverInfo: { name: "drone-echo-fixture", version: "1.0.0" },
				},
			});
			return;
		case "tools/list":
			send({ id: request.id, result: { tools } });
			return;
		case "tools/call":
			send({
				id: request.id,
				result: { content: [{ type: "text", text: `echo:${request.params?.arguments?.text ?? ""}` }] },
			});
			return;
		case "ping":
			send({ id: request.id, result: {} });
			return;
		default:
			send({ id: request.id, error: { code: -32601, message: `Unknown method ${request.method}` } });
	}
});
