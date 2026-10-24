import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { PluginSandboxSession } from "../src/plugin-sandbox";

const supportsNetworkPermissions = process.allowedNodeEnvironmentFlags.has("--allow-net");
const packageRoot = process.env.DRONE_PUBLIC_PLUGIN_PACKAGE_DIR;

it.skipIf(!packageRoot)(
	supportsNetworkPermissions
		? "loads and invokes a published extension through the process sandbox"
		: "refuses a published extension when the runtime cannot enforce network isolation",
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
			if (!supportsNetworkPermissions) {
				await expect(session.start()).rejects.toThrow("has no network permission enforcement (--allow-net)");
				return;
			}
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
