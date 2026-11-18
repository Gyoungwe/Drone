// @vitest-environment node
import { mkdir, mkdtemp, realpath, rename, rm, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginResourceReservations } from "@gyoungwe/plugin-api/node/reservations";
import { expect, it, onTestFinished } from "vitest";
import { selectP5ResourceRoot } from "./p5-resource-roots";

async function fixture() {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "drone-p5-roots-")));
	onTestFinished(() => rm(directory, { recursive: true, force: true }));
	const root = join(directory, "selected");
	const other = join(directory, "other");
	await Promise.all([root, other].map((path) => mkdir(path)));
	const controller = new AbortController();
	const grants = [
		{ kind: "files", handle: "first", path: root },
		{ kind: "files", handle: "second", path: other },
	];
	const leaseDirectory = join(directory, "leases");
	const select = (candidates = grants, kind = "files", handle = "second") =>
		selectP5ResourceRoot(candidates, { kind, handle }, controller.signal, leaseDirectory);
	return { directory, root, other, controller, grants, leaseDirectory, select };
}

it("selects one exact kind and handle among multiple roots; missing or ambiguous matches fail", async () => {
	const f = await fixture();
	expect(f.select().root()).toBe(f.other);
	expect(() => f.select(f.grants, "state")).toThrow(/exactly one/);
	expect(() => f.select(f.grants, "files", "missing")).toThrow(/exactly one/);
	expect(() => f.select([])).toThrow(/exactly one/);
	expect(() => f.select(f.grants.map((grant) => ({ ...grant, handle: "second" })))).toThrow(/exactly one/);
});

it.each(["", "/nested"])("refuses an escaping root symlink with suffix '%s'", async (suffix) => {
	const f = await fixture();
	await mkdir(join(f.other, "nested"));
	const alias = join(f.root, "escape");
	await symlink(f.other, alias);
	expect(() => f.select([{ kind: "files", handle: "second", path: alias + suffix }])).toThrow(/symlink/);
});

it.each(["symlink", "directory"])("rejects a root replaced by a %s after selection", async (kind) => {
	const f = await fixture();
	const port = f.select();
	const lease = port.acquire();
	onTestFinished(() => lease.close(async () => undefined));
	await rename(f.other, join(f.directory, "moved"));
	if (kind === "symlink") await symlink(f.root, f.other);
	else await mkdir(f.other);
	expect(() => port.root()).toThrow(/changed/);
	expect(() => lease.root()).toThrow(/changed/);
	expect(() => port.acquire()).toThrow(/changed/);
});

it("refuses a replaced ancestor even when the root inode is unchanged", async () => {
	const f = await fixture();
	const nested = join(f.root, "nested");
	await mkdir(nested);
	const port = f.select([{ kind: "files", handle: "second", path: nested }]);
	const moved = join(f.directory, "moved");
	await rename(f.root, moved);
	await symlink(moved, f.root);
	expect(() => port.root()).toThrow(/changed/);
});

it("invalidates the port on selection switch or close", async () => {
	const f = await fixture();
	const port = f.select();
	const lease = port.acquire();
	onTestFinished(() => lease.close(async () => undefined));
	f.controller.abort(new Error("Selection revoked"));
	expect(() => port.root()).toThrow("Selection revoked");
	expect(() => lease.root()).toThrow("Selection revoked");
	expect(() => port.acquire()).toThrow("Selection revoked");
	expect(() => f.select()).toThrow("Selection revoked");
});

it("retains the shared state-writers lease on real cleanup failure and releases after success", async () => {
	const f = await fixture();
	const port = f.select();
	const lease = port.acquire();
	onTestFinished(() => lease.close(async () => undefined));
	const contender = new PluginResourceReservations(f.leaseDirectory);
	onTestFinished(() => contender.dispose());
	expect(() => contender.reserve("state-writers", [f.other])).toThrow(/already reserved/);
	const scratch = join(f.other, "scratch");
	await mkdir(scratch);
	const child = join(scratch, "child");
	await writeFile(child, "synthetic cleanup fixture");
	await expect(lease.close(() => rmdir(scratch))).rejects.toMatchObject({ code: "ENOTEMPTY" });
	expect(() => lease.root()).toThrow(/closed/);
	expect(() => port.acquire()).toThrow(/already reserved/);
	expect(() => contender.reserve("state-writers", [f.other])).toThrow(/already reserved/);
	await unlink(child);
	await lease.close(() => rmdir(scratch));
	contender.reserve("state-writers", [f.other]);
	contender.dispose();
	const next = port.acquire();
	onTestFinished(() => next.close(async () => undefined));
	expect(next.reservations).not.toBe(lease.reservations);
});

it("keeps independent root leases under distinct reservation owners", async () => {
	const f = await fixture();
	const writer = new PluginResourceReservations(f.leaseDirectory);
	onTestFinished(() => writer.dispose());
	writer.reserve("state-writers", [f.root]);
	expect(() => f.select(f.grants, "files", "first").acquire()).toThrow(/already reserved/);
	writer.dispose();
	const first = f.select(f.grants, "files", "first").acquire();
	const second = f.select().acquire();
	onTestFinished(() => second.close(async () => undefined));
	onTestFinished(() => first.close(async () => undefined));
	expect(first.reservations).not.toBe(second.reservations);
	await first.close(async () => undefined);
	second.reservations.assertReserved("state-writers", f.other);
});

it("coalesces overlapping close calls and holds the lease until cleanup settles", async () => {
	const f = await fixture();
	const port = f.select();
	const lease = port.acquire();
	onTestFinished(() => lease.close(async () => undefined));
	const calls = { count: 0 };
	const cleanup = async () => {
		calls.count++;
	};
	const closing = lease.close(cleanup);
	expect(lease.close(cleanup)).toBe(closing);
	expect(() => port.acquire()).toThrow(/already reserved/);
	await closing;
	expect(calls.count).toBe(1);
	const next = port.acquire();
	onTestFinished(() => next.close(async () => undefined));
});
