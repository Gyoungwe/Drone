import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { TaskHostLoader } from "@gyoungwe/plugin-api/tasks";
import { expect, it } from "vitest";
import { createBackend } from "../src/create-backend";

const run = promisify(execFile);
const tarball = process.env.DRONE_CORE_TARBALL;

it.skipIf(!tarball)(
	"installed pi-core host loader preserves backend workbench invocation and subscriptions",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-packed-core-host-"));
		try {
			await run(
				"npm",
				[
					"install",
					"--prefix",
					root,
					"--ignore-scripts",
					"--omit=peer",
					"--no-audit",
					"--no-fund",
					await realpath(tarball!),
				],
				{ maxBuffer: 8 * 1024 * 1024 },
			);
			const packageRoot = join(root, "node_modules/@gyoungwe/pi-core");
			const manifest = JSON.parse(await readFile(join(packageRoot, "plugin.manifest.json"), "utf8"));
			expect(manifest.capabilities).toContain("tasks");
			const { taskHostLoader } = (await import(
				/* @vite-ignore */ pathToFileURL(join(packageRoot, manifest.entrypoints.host)).href
			)) as { taskHostLoader: TaskHostLoader };
			const services = createBackend({
				projectTrust: false,
				permissionGates: false,
				taskHostLoader,
				workbench: {
					status: () => ({ state: "idle" }),
					plan: (input) => ({ items: input.items }),
					persist: () => {
						throw new Error("state grant revoked");
					},
				},
			});
			try {
				expect(services.taskHost.workbench).toBe(services.workbench.client);
				await expect(services.workbench.client.invoke("status", {})).resolves.toEqual({ state: "idle" });
				await expect(
					services.workbench.client.invoke("plan", { items: ["read", "verify"] }),
				).resolves.toEqual({ items: ["read", "verify"] });
				await expect(services.workbench.client.invoke("persist", {})).rejects.toThrow("state grant revoked");
				const changed: unknown[] = [];
				const unsubscribe = services.workbench.client.subscribe((event) => changed.push(event));
				services.runtime.events.emit("drone:workbench/changed/v1", { revision: 3 });
				unsubscribe();
				services.runtime.events.emit("drone:workbench/changed/v1", { revision: 4 });
				expect(changed).toEqual([{ type: "changed", revision: 3 }]);
			} finally {
				services.dispose();
			}
			const unavailable = createBackend({ projectTrust: false, permissionGates: false, taskHostLoader });
			try {
				await expect(unavailable.workbench.client.invoke("status", {})).rejects.toThrow(
					"Workbench operation unavailable",
				);
			} finally {
				unavailable.dispose();
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
	60_000,
);
