import { describe, expect, it } from "vitest";
import { type HostEnvDeps, probeHostEnvironment } from "./host-env";

function deps(platform: string, outputs: Record<string, string | null>): HostEnvDeps & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		platform,
		exec: async (command, args) => {
			const key = `${command} ${args.join(" ")}`;
			calls.push(key);
			for (const [k, v] of Object.entries(outputs)) if (key.startsWith(k)) return v;
			return null;
		},
		os: {
			release: () => "10.0.22631",
			arch: () => "x64",
			hostname: () => "lab",
			cpus: () => Array.from({ length: 8 }, () => ({ model: " Intel i7 ", speed: 1, times: {} as never })),
			totalmem: () => 32 * 1024 ** 3,
			freemem: () => 8 * 1024 ** 3,
			loadavg: () => [4, 0, 0],
			version: () => "Windows 11 Pro",
		},
		diskPath: "C:\\",
		statfs: async () => ({ blocks: 1000, bsize: 4096, bavail: 250 }),
		now: () => new Date("2026-10-13T00:00:00Z"),
	};
}

describe("probeHostEnvironment (P10)", () => {
	it("probes on Windows with mocked exec", async () => {
		const d = deps("win32", {
			"node --version": "v22.11.0",
			"python --version": "Python 3.12.4",
			"python -m pip list": '[{"name":"numpy"},{"name":"pandas"}]',
			"npm.cmd ls -g": '{"dependencies":{"pnpm":{}}}',
		});
		const env = await probeHostEnvironment(d);
		expect(env.os).toBe("Windows (Windows 11 Pro)");
		expect(env.cpu).toEqual({ model: "Intel i7", cores: 8, loadPercent: null });
		expect(env.tools.find((t) => t.id === "python")?.version).toBe("3.12.4");
		expect(env.tools.find((t) => t.id === "git")?.version).toBeNull();
		expect(env.pythonPackages).toBe(2);
		expect(env.npmPackages).toBe(1);
		expect(env.disk).toEqual({ path: "C:\\", totalBytes: 4096000, freeBytes: 1024000 });
		expect(d.calls.some((c) => c.startsWith("python3"))).toBe(false);
	});
	it("tolerates missing tools and disk errors on Linux", async () => {
		const d = deps("linux", {});
		d.statfs = async () => {
			throw new Error("ENOENT");
		};
		d.exec = async () => {
			throw new Error("spawn ENOENT");
		};
		const env = await probeHostEnvironment(d);
		expect(env.cpu.loadPercent).toBe(50);
		expect(env.disk).toBeNull();
		expect(env.pythonPackages).toBeNull();
		expect(env.tools.every((t) => t.version === null)).toBe(true);
	});
});
