import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildSshArgs, makeSshTool, resolveSshKeyPath } from "../src/tools/ssh";

const cwd = process.cwd();
const keyPath = join(homedir(), ".ssh", "id_ed25519");

describe("ssh tool", () => {
	it("builds argv without a shell and keeps the command as one trailing argument", () => {
		const command = "printf '%s' '$HOME && echo no-shell'";
		const built = buildSshArgs({
			host: "build.example",
			username: "agent",
			port: 2222,
			command,
			keyPath,
		});
		expect(built.keyPath).toBe(keyPath);
		expect(built.args).toContain("IdentitiesOnly=yes");
		expect(built.args.at(-1)).toBe(command);
		expect(built.args).not.toContain("&&");
	});

	it("rejects option-like hosts and key paths outside ~/.ssh", () => {
		expect(() => buildSshArgs({ host: "-oProxyCommand=whoami", command: "true" })).toThrow("invalid host");
		expect(() => buildSshArgs({ host: "agent@build.example", command: "true" })).toThrow("invalid host");
		expect(() => resolveSshKeyPath(join(cwd, "secret.pem"))).toThrow("under ~/.ssh");
	});

	it("asks exactly once and never runs when the user denies", async () => {
		const confirm = vi.fn().mockResolvedValue(false);
		const run = vi.fn();
		const tool = makeSshTool({ confirm, run });
		await expect(
			tool.execute("call-1", { host: "build.example", command: "uname -a" }, undefined, undefined, {
				cwd,
			} as never),
		).rejects.toThrow("user approval required");
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(confirm.mock.calls[0]?.[0]).toContain("build.example :: uname -a");
		expect(run).not.toHaveBeenCalled();
	});

	it("fails closed when no approval bridge is provided", async () => {
		const run = vi.fn();
		const tool = makeSshTool({ run });
		await expect(
			tool.execute("call-no-bridge", { host: "build.example", command: "true" }, undefined, undefined, {
				cwd,
			} as never),
		).rejects.toThrow("user approval required");
		expect(run).not.toHaveBeenCalled();
	});

	it("runs only after approval and reports bounded execution details", async () => {
		const run = vi.fn().mockResolvedValue({
			stdout: "Linux\n",
			stderr: "",
			exitCode: 0,
			timedOut: false,
			truncated: false,
		});
		const confirm = vi.fn().mockResolvedValue(true);
		const tool = makeSshTool({ confirm, run });
		const result = await tool.execute(
			"call-2",
			{ host: "build.example", command: "uname -a", timeout: 5000 },
			undefined,
			undefined,
			{ cwd } as never,
		);
		expect(run).toHaveBeenCalledOnce();
		expect(run.mock.calls[0]?.[0].at(-1)).toBe("uname -a");
		expect(confirm).toHaveBeenCalledWith(
			expect.stringContaining("build.example :: uname -a"),
			expect.any(String),
		);
		expect(result.details).toMatchObject({ destination: "build.example", exitCode: 0, timedOut: false });
		expect(result.content[0]).toMatchObject({ type: "text" });
	});
});
