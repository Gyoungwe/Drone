import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { DiscoveryHostLoader } from "@gyoungwe/plugin-api";
import { expect, it, vi } from "vitest";
import { createDiscoveryService } from "./service";

const tarball = process.env.DRONE_DISCOVERY_PLUGIN_TARBALL;
const apiTarball = process.env.DRONE_PLUGIN_API_TARBALL;
const enabled = process.env.DRONE_DISCOVERY_REAL_CONTAINER === "1";
const exec = promisify(execFile);

it.skipIf(!enabled || !tarball)(
	"verifies real owned-container cleanup for normal exit, failed exit, close, timeout and dispose",
	async () => {
		if (!apiTarball) throw new Error("Real container acceptance requires the matching API tarball");
		const root = await mkdtemp(join(tmpdir(), "discovery-real-cleanup-"));
		const engine = async (...args: string[]) => (await exec("docker", args)).stdout.trim();
		try {
			const version = await engine("version", "--format", "{{.Server.Version}}");
			// An absent image fails this acceptance; no installation or implicit pull is authorized here.
			const cachedImage = (
				await engine("image", "ls", "--no-trunc", "--format", "{{.ID}} {{.Repository}}:{{.Tag}}")
			)
				.split("\n")
				.find((line) => line.endsWith(" python:3.12-slim"));
			expect(cachedImage, "the authorized cached python:3.12-slim image must already exist").toBeDefined();
			const imageId = await engine("image", "inspect", cachedImage!.split(" ")[0]!, "--format", "{{.Id}}");
			const prefix = join(root, "installed");
			await exec("npm", [
				"install",
				"--prefix",
				prefix,
				"--omit=peer",
				"--ignore-scripts",
				"--no-audit",
				"--no-fund",
				tarball as string,
				apiTarball,
			]);
			const { discoveryHostLoader } = (await import(
				/* @vite-ignore */ pathToFileURL(join(prefix, "node_modules/@gyoungwe/pi-discovery/dist/host.mjs"))
					.href
			)) as { discoveryHostLoader: DiscoveryHostLoader };
			const owned = async () => {
				const names = (
					await engine(
						"container",
						"ls",
						"--all",
						"--filter",
						"label=drone.discovery.execution",
						"--format",
						"{{.Names}}",
					)
				)
					.split("\n")
					.filter(Boolean);
				const result: string[] = [];
				for (const name of names) {
					const sources = await engine(
						"inspect",
						"--type",
						"container",
						"--format",
						"{{range .Mounts}}{{println .Source}}{{end}}",
						name,
					);
					if (
						sources
							.split("\n")
							.some((path) => path.startsWith(`${root}/runs/`) || path.startsWith(`/private${root}/runs/`))
					)
						result.push(name);
				}
				return result;
			};
			const { service } = createDiscoveryService(
				{
					projectId: "synthetic-cleanup",
					projectRoot: root,
					authorize: async () => {},
					container: { runtime: "docker", pythonImage: imageId },
				},
				discoveryHostLoader,
			);
			const results: Record<string, string> = {};
			try {
				for (const id of ["success", "failed", "close", "timeout", "dispose"]) {
					await service.createKernelSession({
						sessionId: id,
						runDirectory: `runs/${id}`,
						language: "python",
						dataClassification: "public",
						executionTimeoutMs: id === "timeout" ? 2000 : 60_000,
					});
					const code =
						id === "success"
							? 'print("[summary] discovery-cleanup")'
							: id === "failed"
								? "raise SystemExit(7)"
								: "import time; time.sleep(30)";
					const pending = service.executeKernel(id, code);
					if (["close", "timeout", "dispose"].includes(id))
						await vi.waitFor(
							async () => {
								expect((await owned()).length).toBe(1);
							},
							{ timeout: 10_000, interval: 50 },
						);
					if (id === "close") await service.closeKernelSession(id);
					if (id === "dispose") await service.dispose();
					const execution = await pending;
					expect(execution.status, JSON.stringify(execution)).toBe(id === "success" ? "succeeded" : "failed");
					if (id === "timeout") expect(execution.blockedReason).toBe("timeout");
					if (id === "close" || id === "dispose") expect(execution.blockedReason).toBe("cancelled");
					if (id === "close") expect((await service.getKernelSession(id))?.status).toBe("closed");
					expect(await owned()).toEqual([]);
					results[id] = `${execution.status}; responsive daemon readback shows no owned container`;
				}
				console.log(
					`DISCOVERY_REAL_CONTAINER=${JSON.stringify({
						status: "PASS",
						scope:
							"installed canonical package via legacy host adapter; managed SDK/UI requires separate acceptance",
						engine: version,
						packageSha256: createHash("sha256")
							.update(await readFile(tarball as string))
							.digest("hex"),
						apiSha256: createHash("sha256")
							.update(await readFile(apiTarball))
							.digest("hex"),
						image: { source: "python:3.12-slim (already installed; pull=never)", id: imageId },
						data: "synthetic temporary workspace only",
						results,
						formalGui: "NOT_RUN",
					})}`,
				);
			} finally {
				await service.dispose();
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
	90_000,
);
