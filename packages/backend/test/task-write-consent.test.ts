import { link, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { makePermissionGateExtension } from "../src/permissions/extension";
import { taskWriteAllowed } from "../src/permissions/task-consent";

const dirs: string[] = [];
afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function fixture() {
	const dir = await mkdtemp(join(tmpdir(), "task-write-"));
	dirs.push(dir);
	return realpath(dir);
}
it("allows ordinary new and existing files only under the approved canonical directory", async () => {
	const root = await fixture();
	await writeFile(join(root, "report.csv"), "x");
	expect(await taskWriteAllowed([root], join(root, "report.csv"))).toBe(true);
	expect(await taskWriteAllowed([root], join(root, "new", "result.csv"))).toBe(true);
	expect(await taskWriteAllowed([root], resolve(root, "..", "outside.csv"))).toBe(false);
	expect(await taskWriteAllowed([root], root)).toBe(false);
	expect(await taskWriteAllowed(undefined, join(root, "a"))).toBe(false);
});
it.each([
	".env",
	"auth.json",
	"permissions.json",
	".git/config",
	".ssh/key",
	".pi/agent/models.json",
	"private.pem",
	".mcp.json",
])("does not cover sensitive path %s", async (name) => {
	const root = await fixture();
	expect(await taskWriteAllowed([root], join(root, name))).toBe(false);
});
it("rejects symlink escape, including a not-yet-created target", async () => {
	const root = await fixture(),
		outside = await fixture();
	await symlink(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
	expect(await taskWriteAllowed([root], join(root, "escape", "new.csv"))).toBe(false);
});
it.each(["default", "deny", "pattern-ask", "outside"])(
	"task grant respects %s permission handling",
	async (mode) => {
		const root = await fixture(),
			agent = await fixture(),
			outside = await fixture();
		if (mode === "deny" || mode === "pattern-ask")
			await writeFile(
				join(agent, "permissions.json"),
				JSON.stringify({ rules: { write: mode === "deny" ? "deny" : { "*": "ask" } } }),
			);
		const hooks: Record<string, (...args: any[]) => any> = {};
		const confirm = vi.fn(async () => false);
		const pi: any = {
			on: (n: string, fn: any) => {
				hooks[n] = fn;
			},
			events: {
				on: vi.fn(),
				emit: async (n: string, request: any) => {
					if (n === "drone:task-write-consent") request.respond({ writeRoots: [root] });
				},
			},
		};
		const extension = makePermissionGateExtension(agent, { projectRoot: root, confirm });
		await extension.factory(pi);
		const result = await hooks.tool_call(
			{
				type: "tool_call",
				toolName: "write",
				toolCallId: "w",
				input: { path: join(mode === "outside" ? outside : root, "result.csv"), content: "x" },
			},
			{ cwd: root, sessionManager: { getSessionId: () => "s" } },
		);
		if (mode === "default") {
			expect(result).toBeUndefined();
			expect(confirm).not.toHaveBeenCalled();
		} else if (mode === "deny") {
			expect(result).toMatchObject({ block: true });
			expect(confirm).not.toHaveBeenCalled();
		} else {
			expect(result).toMatchObject({ block: true });
			expect(confirm).toHaveBeenCalledOnce();
		}
	},
);

it("does not automatically approve overwriting an externally hard-linked file", async () => {
	const root = await fixture(),
		external = await fixture();
	const source = join(external, "protected.txt");
	await writeFile(source, "fixture");
	const target = join(root, "innocent.txt");
	await link(source, target);
	expect(await taskWriteAllowed([root], target)).toBe(false);
});
