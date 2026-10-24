#!/usr/bin/env node
/** Live, credential-free acceptance. Only public research queries leave the temporary home. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packageName = "pi-web-access";
const versions = ["0.43.0", "0.44.0"];
const endpoint = "https://mcp.exa.ai/mcp?tools=web_search_exa";
const query = "site:pubmed.ncbi.nlm.nih.gov CRISPR Cas9 genome editing";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

async function worker(root, phase, mode) {
	const prefix = join(root, "prefix");
	const cwd = join(root, "project");
	const agentDir = join(root, "agent");
	const pi = await import(
		pathToFileURL(join(prefix, "node_modules/@earendil-works/pi-coding-agent/dist/index.js"))
	);
	assert.equal(
		json(join(prefix, "node_modules/@earendil-works/pi-coding-agent/package.json")).version,
		"1.1.0",
	);
	const statuses = [];
	const settingsManager = pi.SettingsManager.inMemory();
	const extension = join(
		prefix,
		"node_modules",
		mode === "mcp" ? "pi-mcp-adapter/index.ts" : `${packageName}/dist`,
	);
	const loader = new pi.DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		additionalExtensionPaths: mode === "absent" ? [] : [extension],
		extensionFactories: [
			(api) => api.events.on("pi-mcp-adapter/status/v1", (status) => statuses.push(status)),
		],
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const modelRuntime = await pi.ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(agentDir, "models-cache.json"),
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const { session } = await pi.createAgentSession({
		cwd,
		agentDir,
		modelRuntime,
		resourceLoader: loader,
		settingsManager,
		sessionManager: pi.SessionManager.inMemory(cwd),
		noTools: "builtin",
	});
	try {
		await session.bindExtensions({});
		const names = session.getAllTools().map((tool) => tool.name);
		const receipt = {
			phase,
			mode,
			sdk: "1.1.0",
			sessionStarted: true,
			modelInvoked: false,
			nodeVersion: process.version,
			tools: names,
			loaderErrors: [],
		};
		if (mode === "absent") {
			assert(!names.includes("fetch_content"));
			receipt.extensionAbsent = true;
		} else if (mode === "extension") {
			assert(names.includes("fetch_content"));
			const license = readFileSync(join(prefix, "node_modules/pi-web-access/LICENSE"), "utf8");
			assert.match(license, /^MIT License/);
			receipt.licenseSha256 = hash(license);
			const tool = session.agent.state.tools.find((entry) => entry.name === "web_search");
			assert(tool, "web_search not active");
			const result = await tool.execute(`research-${phase}`, {
				query,
				provider: "exa",
				numResults: 2,
				workflow: "none",
				includeContent: false,
			});
			const text = JSON.stringify(result.content);
			assert(!result.isError, text);
			assert.match(text, /https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+/g);
			assert.equal(result.details.successfulQueries, 1);
			assert(result.structuredContent.queries[0].results.length > 0);
			receipt.publicSearch = {
				sourceUrls: result.structuredContent.queries[0].results.map((item) => item.url),
				status: "PASS",
				query,
				sha256: hash(text),
				bytes: Buffer.byteLength(text),
			};
			const fetchTool = session.agent.state.tools.find((entry) => entry.name === "fetch_content");
			const invalid = await fetchTool.execute(`rejected-${phase}`, {
				url: "data:text/plain,invalid",
				mode: "raw",
			});
			assert(invalid.isError, "unsupported URL must not report success");
			receipt.invalidUrlError = { observed: true, sha256: hash(JSON.stringify(invalid.content)) };
		} else {
			const tool = session.agent.state.tools.find((entry) => entry.name === "mcp");
			assert(tool, "MCP proxy missing");
			const result = await tool.execute(`mcp-${phase}`, {
				server: "exa",
				tool: "web_search_exa",
				args: {
					query,
					numResults: 2,
					objective:
						"Find PubMed research papers on CRISPR Cas9 genome editing; return paper titles and PubMed URLs, excluding commercial pages.",
				},
			});
			const text = JSON.stringify(result.content);
			if (phase === "disabled") {
				assert.match(text, /disabled|not found|unknown/i);
				receipt.disabledCallRefused = true;
			} else {
				assert(!result.isError, text);
				assert.match(text, /https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+/g);
				receipt.remoteSearch = { status: "PASS", query, sha256: hash(text), bytes: Buffer.byteLength(text) };
			}
			receipt.diagnostics = statuses.map((status) => ({
				totalTools: status.totalTools,
				servers: status.servers.map(({ name, status: state, toolCount }) => ({
					name,
					status: state,
					toolCount,
				})),
			}));
			if (phase === "disabled")
				assert(
					receipt.diagnostics.some((s) =>
						s.servers.some((x) => x.name === "exa" && x.status === "disabled" && x.toolCount === 0),
					),
				);
		}
		writeJson(join(root, `${mode}-${phase}.json`), receipt);
	} finally {
		session.dispose();
	}
}

if (process.argv[2] === "--worker") {
	await worker(process.argv[3], process.argv[4], process.argv[5]);
} else {
	const outIndex = process.argv.indexOf("--out");
	assert(
		outIndex > 0 && process.argv[outIndex + 1],
		"Usage: node scripts/check-scientific-external.mjs --out <receipt.json>",
	);
	const out = resolve(process.argv[outIndex + 1]);
	const root = realpathSync(mkdtempSync(join(tmpdir(), "drone-scientific-external-")));
	for (const name of ["home", "project", "agent"]) mkdirSync(join(root, name));
	// Never forward provider tokens, npm auth, browser configuration or real Pi paths.
	const env = {
		PATH: process.env.PATH,
		HOME: join(root, "home"),
		PI_CODING_AGENT_DIR: join(root, "agent"),
		npm_config_userconfig: "/dev/null",
		npm_config_registry: "https://registry.npmjs.org",
	};
	const run = (command, args) =>
		execFileSync(command, args, {
			cwd: join(root, "project"),
			env,
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
			timeout: 600_000,
		});
	const npm = (args) => run("npm", args);
	const install = (specs) =>
		npm([
			"install",
			"--prefix",
			join(root, "prefix"),
			"--ignore-scripts",
			"--save-exact",
			"--no-audit",
			"--no-fund",
			...specs,
		]);
	const probe = (phase, mode) => {
		run(process.execPath, [import.meta.filename, "--worker", root, phase, mode]);
		return json(join(root, `${mode}-${phase}.json`));
	};
	try {
		const metadata = versions.map((version) =>
			JSON.parse(
				npm([
					"view",
					`${packageName}@${version}`,
					"name",
					"version",
					"license",
					"repository",
					"dist",
					"--json",
				]),
			),
		);
		const family = [
			"chord",
			"pi-agent-core",
			"pi-ai",
			"pi-codemode",
			"pi-coding-agent",
			"pi-mcp",
			"pi-telemetry",
			"pi-tui",
		].map((name) => `@earendil-works/${name}@1.1.0`);
		install([...family, `${packageName}@${versions[0]}`, "pi-mcp-adapter@5.1.0"]);
		writeJson(join(root, "agent/web-search.json"), {
			toolActivation: "eager",
			fetchRouting: { providers: ["http"], allowRemoteHostedProviders: false },
			fetch: { allowedModes: ["raw"], defaultMode: "raw" },
		});
		const lifecycle = [];
		const collect = (phase) => {
			const manifest = json(join(root, "prefix/node_modules", packageName, "package.json"));
			assert.equal(manifest.license, "MIT");
			const lock = json(join(root, "prefix/package-lock.json")).packages[`node_modules/${packageName}`];
			assert.equal(lock.integrity, metadata.find((m) => m.version === manifest.version).dist.integrity);
			lifecycle.push({ version: manifest.version, integrity: lock.integrity, ...probe(phase, "extension") });
		};
		collect("install");
		install([`${packageName}@${versions[1]}`]);
		collect("upgrade");
		lifecycle.push(probe("disabled", "absent"));
		collect("enabled");
		install([`${packageName}@${versions[0]}`]);
		collect("rollback");
		npm([
			"uninstall",
			"--prefix",
			join(root, "prefix"),
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			packageName,
		]);
		assert(!existsSync(join(root, "prefix/node_modules", packageName)));
		lifecycle.push(probe("uninstall", "absent"));
		const mcp = [];
		for (const phase of ["enabled", "disabled", "restored"]) {
			writeJson(join(root, "agent/mcp.json"), {
				mcpServers: { exa: { url: endpoint, enabled: phase !== "disabled", timeout: 60 } },
			});
			mcp.push(probe(phase, "mcp"));
		}
		writeJson(out, {
			date: new Date().toISOString(),
			status: "PASS",
			scope: "credential-free real SDK sessions; no GUI or user-account acceptance claim",
			reproduce: "node scripts/check-scientific-external.mjs --out /tmp/scientific-external.json",
			isolation: {
				temporaryHome: true,
				temporaryProject: true,
				temporaryAgent: true,
				inheritedCredentials: false,
				installScripts: false,
				productionStateChanged: false,
				remoteMutations: 0,
			},
			thirdParty: {
				source: "https://github.com/nicobailon/pi-web-access",
				licenseSource: "https://github.com/nicobailon/pi-web-access/blob/main/LICENSE",
				metadata,
				lifecycle,
			},
			mcp: {
				endpoint,
				source: "https://exa.ai/docs/get-started/exa-mcp",
				auth: "none",
				adapter: "pi-mcp-adapter@5.1.0",
				calls: mcp,
			},
			remaining: [
				"Drone GUI permission/install/diagnostic presentation for this exact third-party package",
				"Authenticated user-owned MCP service",
				"Protocols.io OAuth write/readback/delete/readback",
			],
		});
		console.log(
			JSON.stringify({ status: "PASS", out, extensionPhases: lifecycle.length, mcpPhases: mcp.length }),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
