import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { PluginSandboxSession } from "../src/plugin-sandbox";

const packageRoot = process.env.DRONE_PUBLIC_PLUGIN_PACKAGE_DIR;

it.skipIf(!packageRoot)(
	"loads and invokes a published third-party extension through the process sandbox",
	async () => {
		if (!packageRoot) throw new Error("DRONE_PUBLIC_PLUGIN_PACKAGE_DIR is required");
		const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
			pi?: { extensions?: string[] };
		};
		const relativeEntrypoint = packageJson.pi?.extensions?.[0];
		if (!relativeEntrypoint) throw new Error("published package does not declare a Pi extension");
		const entrypoint = join(packageRoot, relativeEntrypoint);
		expect(existsSync(entrypoint)).toBe(true);
		const session = new PluginSandboxSession({
			pluginId: "public-pi-connectors",
			entrypoint,
			packageRoot,
			cwd: packageRoot,
			timeoutMs: 15_000,
		});
		try {
			const ready = await session.start();
			expect(ready.pid).not.toBe(process.pid);
			expect(ready.tools.map((tool) => tool.name)).toEqual(["connector_list", "connector_get"]);
			const result = (await session.invoke("connector_list", "public-call-1", {})) as {
				content: Array<{ text: string }>;
			};
			expect(JSON.parse(result.content[0].text)).toMatchObject({ contractVersion: 1 });
		} finally {
			await session.close();
		}
	},
);
