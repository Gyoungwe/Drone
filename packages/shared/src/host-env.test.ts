import { describe, expect, it } from "vitest";
import {
	countNpmPackages,
	countPipPackages,
	formatBytes,
	hostProbeCommands,
	npmPackagesCommand,
	osLabel,
	parseVersion,
	usagePercent,
} from "./host-env";

describe("host env (P10)", () => {
	it("parses tool versions", () => {
		expect(parseVersion("v22.11.0")).toBe("22.11.0");
		expect(parseVersion("Python 3.12.4")).toBe("3.12.4");
		expect(parseVersion("git version 2.45.1.windows.1")).toBe("2.45.1.windows.1");
		expect(parseVersion("R version 4.4.1 (2024-06-14)")).toBe("4.4.1");
		expect(parseVersion("command not found")).toBeNull();
	});
	it("counts packages", () => {
		expect(countPipPackages('[{"name":"a"},{"name":"b"}]')).toBe(2);
		expect(countPipPackages("oops")).toBeNull();
		expect(countNpmPackages('{"dependencies":{"a":{},"b":{},"c":{}}}')).toBe(3);
		expect(countNpmPackages("{}")).toBe(0);
	});
	it("uses Windows command names", () => {
		expect(hostProbeCommands("win32").find((c) => c.id === "python")?.command).toBe("python");
		expect(hostProbeCommands("darwin").find((c) => c.id === "python")?.command).toBe("python3");
		expect(npmPackagesCommand("win32").command).toBe("npm.cmd");
	});
	it("formats", () => {
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(16 * 1024 ** 3)).toBe("16 GB");
		expect(usagePercent(100, 25)).toBe(75);
		expect(usagePercent(0, 0)).toBe(0);
		expect(osLabel("darwin", "24.0.0")).toBe("macOS (Darwin 24.0.0)");
		expect(osLabel("win32", "10.0.22631", "Windows 11 Pro")).toBe("Windows (Windows 11 Pro)");
	});
});
