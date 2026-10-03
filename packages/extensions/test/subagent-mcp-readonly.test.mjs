import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

test("packaged read-only MCP preserves resource paths and the tool allowlist", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "drone-readonly-mcp-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const outfile = join(root, "extensions/subagent-mcp-readonly.mjs");
	await build({
		entryPoints: [resolve(import.meta.dirname, "../src/subagent-mcp-readonly.ts")],
		outfile,
		bundle: true,
		format: "esm",
		platform: "node",
		logLevel: "silent",
	});
	const knowledgeDir = process.env.DRONE_KNOWLEDGE_DIR;
	delete process.env.DRONE_KNOWLEDGE_DIR;
	t.after(() => {
		if (knowledgeDir === undefined) delete process.env.DRONE_KNOWLEDGE_DIR;
		else process.env.DRONE_KNOWLEDGE_DIR = knowledgeDir;
	});
	const extension = await import(pathToFileURL(outfile));
	assert(
		new URL(extension.readonlyMcpAdapterUrl("")).pathname.endsWith(
			"/npm/node_modules/pi-mcp-adapter/index.ts",
		),
	);
	assert(
		decodeURIComponent(new URL(extension.readonlyMcpAdapterUrl(join(root, "资源 path"))).pathname).endsWith(
			"/资源 path/npm/node_modules/pi-mcp-adapter/index.ts",
		),
	);
	const cwd = join(root, "project");
	await mkdir(cwd);
	let configured;
	const pi = {};
	const loadAdapter = async () => ({
		createMcpAdapter: (options) => (host) => {
			assert.equal(host, pi);
			configured = options;
		},
	});
	await extension.makeSubagentReadonlyMcp(cwd, async () => {
		throw new Error("unconfigured projects must not load an optional adapter");
	})(pi);
	await writeFile(
		join(cwd, ".mcp.json"),
		JSON.stringify({
			mcpServers: {
				"research-obsidian": { command: "fixture", disabled: true, includeTools: ["write_note"] },
			},
		}),
	);
	await extension.makeSubagentReadonlyMcp(cwd, loadAdapter)(pi);
	const server = configured.config.mcpServers["research-obsidian"];
	assert.equal(server.command, "fixture");
	assert.equal(server.disabled, false);
	assert.deepEqual(server.includeTools, [...extension.OBSIDIAN_SUBAGENT_READ_TOOLS]);
	assert(!server.includeTools.includes("write_note"));
	assert.equal(configured.config.settings.scriptMode, false);
});
