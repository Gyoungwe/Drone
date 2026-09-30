// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("./gen-plugin-api.mjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const desktopRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(
	readFileSync(
		fileURLToPath(new URL("../src/renderer/src/plugins/host-api.manifest.json", import.meta.url)),
		"utf8",
	),
) as {
	namespaces: Record<string, Array<{ name: string; hostValue: string; envType: string; pluginType: string }>>;
};
const projections = [
	{
		kind: "host",
		path: fileURLToPath(new URL("../src/renderer/src/plugins/host-api.ts", import.meta.url)),
		value: (entry: { name: string; hostValue: string }) => `${entry.name}: ${entry.hostValue}`,
	},
	{
		kind: "env",
		path: fileURLToPath(new URL("../src/renderer/src/plugins/env.d.ts", import.meta.url)),
		value: (entry: { name: string; envType: string }) => `${entry.name}: ${entry.envType}`,
	},
	{
		kind: "drone",
		path: fileURLToPath(new URL("../resources/ui-plugins/drone-ui.d.ts", import.meta.url)),
		value: (entry: { name: string; pluginType: string }) =>
			`${entry.name}: ${entry.pluginType.split("\n")[0]}`,
	},
] as const;

function generatedBlock(source: string, namespace: string): string {
	const start = `// <drone:generated namespace="${namespace}">`;
	const end = `// </drone:generated namespace="${namespace}">`;
	const from = source.indexOf(start);
	const to = source.indexOf(end, from + start.length);
	expect(from).toBeGreaterThanOrEqual(0);
	expect(to).toBeGreaterThan(from);
	return source.slice(from, to);
}

describe("plugin API projections", () => {
	it("are reproducible from the manifest", () => {
		const output = execFileSync(process.execPath, [scriptPath, "--check"], {
			cwd: repoRoot,
			encoding: "utf8",
		});
		expect(output).toContain("up to date");
	});

	it("project every manifest entry into each marked public namespace", () => {
		for (const projection of projections) {
			const source = readFileSync(projection.path, "utf8");
			for (const [namespace, entries] of Object.entries(manifest.namespaces)) {
				const block = generatedBlock(source, namespace);
				for (const entry of entries) expect(block).toContain(projection.value(entry));
			}
			if (projection.kind === "drone") {
				const topLevel = generatedBlock(source, "topLevel");
				for (const entries of Object.values(manifest.namespaces)) {
					for (const entry of entries) expect(topLevel).toContain(`export const ${entry.name}:`);
				}
			}
		}

		const shim = readFileSync(`${desktopRoot}/src/main/ui-plugins/plugin-api-shim.generated.ts`, "utf8");
		for (const entries of Object.values(manifest.namespaces)) {
			for (const entry of entries) expect(shim).toContain(entry.name);
		}
	});
});
