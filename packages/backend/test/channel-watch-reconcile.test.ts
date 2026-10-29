import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const hints = vi.hoisted(() => ({ emit: (_name: string) => {}, fail: (_error: Error) => {} }));
vi.mock("node:fs", async (original) => ({
	...(await original<typeof import("node:fs")>()),
	watch: vi.fn((_root, _options, callback) => {
		hints.emit = (name) => callback("rename", name);
		const watcher = Object.assign(new EventEmitter(), { close() {} });
		hints.fail = (error) => watcher.emit("error", error);
		return watcher;
	}),
}));

import { ChannelWatcher } from "../src/tools/channel-watch/watcher";

const roots: string[] = [];
const watchers: ChannelWatcher[] = [];
afterEach(async () => {
	for (const watcher of watchers.splice(0)) watcher.stop();
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(pollIntervalMs: number) {
	const root = await mkdtemp(join(tmpdir(), "cw-reconcile-"));
	roots.push(root);
	await mkdir(join(root, "topic"));
	const events: string[] = [];
	const watcher = new ChannelWatcher({
		channelRoot: root,
		debounceMs: 20,
		pollIntervalMs,
		onEvent: (event) => events.push(event.relPath),
	});
	watchers.push(watcher);
	expect(await watcher.start()).toBe("watch");
	return { root, events, watcher };
}

it("reconciles a native directory-only event to the actual changed files", async () => {
	const { root, events } = await fixture(60_000);
	await writeFile(join(root, "topic/MESSAGES.md"), "synthetic message");
	hints.emit("topic");
	await vi.waitFor(() => expect(events).toEqual(["topic/MESSAGES.md"]));
});

it("recovers missing native events while retaining watch mode and delivers a change once", async () => {
	const { root, events, watcher } = await fixture(25);
	await writeFile(join(root, "topic/MESSAGES.md"), "synthetic message");
	await vi.waitFor(() => expect(events).toEqual(["topic/MESSAGES.md"]));
	hints.emit("topic");
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(events).toEqual(["topic/MESSAGES.md"]);
	expect(watcher.mode).toBe("watch");
	watcher.stop();
	hints.fail(new Error("late native error after close"));
	expect(watcher.mode).toBe("idle");
	await writeFile(join(root, "topic/MESSAGES.md"), "after stop");
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(events).toHaveLength(1);
});

it("keeps nested channel paths observable and ignores symlinks and hidden entries", async () => {
	const { root, events } = await fixture(25);
	await mkdir(join(root, "topic/sub"));
	await writeFile(join(root, "topic/sub/notes.md"), "nested synthetic note");
	await writeFile(join(root, "topic/.DS_Store"), "noise");
	const outside = await mkdtemp(join(tmpdir(), "cw-outside-"));
	roots.push(outside);
	await writeFile(join(outside, "private.md"), "outside synthetic note");
	await symlink(outside, join(root, "topic/linked"));
	hints.emit("topic");
	await vi.waitFor(() => expect(events).toEqual(["topic/sub/notes.md"]));
});

it("does not restart a watcher stopped while its initial filesystem snapshot is pending", async () => {
	const root = await mkdtemp(join(tmpdir(), "cw-start-stop-"));
	roots.push(root);
	await mkdir(join(root, "topic"));
	const events: string[] = [];
	const watcher = new ChannelWatcher({
		channelRoot: root,
		pollIntervalMs: 25,
		debounceMs: 20,
		onEvent: (event) => events.push(event.relPath),
	});
	watchers.push(watcher);
	const start = watcher.start();
	watcher.stop();
	expect(await start).toBe("idle");
	await writeFile(join(root, "topic/MESSAGES.md"), "after stop");
	hints.emit("topic");
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(events).toEqual([]);
});
