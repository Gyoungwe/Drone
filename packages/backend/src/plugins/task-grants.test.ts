import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RegisteredSession, SessionRegistry } from "../session/registry";
import type { PluginRuntimeSource } from "./coordinator";
import { resolveTaskWriteRoots, TaskGrantStore } from "./task-grants";

let work: string;
let project: string;
beforeEach(() => {
	work = realpathSync(mkdtempSync(join(tmpdir(), "task-grant-")));
	project = join(work, "home", "project");
	mkdirSync(join(project, "outputs"), { recursive: true });
	mkdirSync(join(project, "notes"), { recursive: true });
	writeFileSync(join(project, "file.txt"), "x");
	// os.homedir() reads USERPROFILE on Windows and HOME elsewhere.
	vi.stubEnv("HOME", join(work, "home"));
	vi.stubEnv("USERPROFILE", join(work, "home"));
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(work, { recursive: true, force: true });
});

const entryFor = (sessionId: string, cwd: string, extra: Partial<RegisteredSession> = {}, trusted = true) =>
	({
		session: {
			sessionId,
			isStreaming: false,
			sent: [] as unknown[],
			async sendCustomMessage(message: unknown, options: unknown) {
				this.sent.push({ message, options });
			},
			settingsManager: { isProjectTrusted: () => trusted },
		},
		unsubscribe: () => {},
		cwd,
		...extra,
	}) as unknown as RegisteredSession;

describe("resolveTaskWriteRoots", () => {
	it("returns canonical existing project directories without duplicates", () => {
		expect(resolveTaskWriteRoots(project, ["outputs", "./outputs", join(project, "notes")])).toEqual([
			join(project, "outputs"),
			join(project, "notes"),
		]);
	});
	it("refuses drive roots, the home directory and its parents, files and missing paths", () => {
		expect(() => resolveTaskWriteRoots(project, ["/"])).toThrow("not a drive");
		expect(() => resolveTaskWriteRoots(project, [join(work, "home")])).toThrow("not a drive");
		expect(() => resolveTaskWriteRoots(project, [work])).toThrow("not a drive");
		expect(() => resolveTaskWriteRoots(project, ["file.txt"])).toThrow("existing project directory");
		expect(() => resolveTaskWriteRoots(project, ["missing"])).toThrow();
		expect(() =>
			resolveTaskWriteRoots(
				project,
				Array.from({ length: 9 }, () => "outputs"),
			),
		).toThrow("at most");
	});
});

describe("TaskGrantStore", () => {
	const source: PluginRuntimeSource = { pluginId: "tasks", packageRoot: "/p", entrypoint: "/p/r.mjs" };
	it("binds a grant to the live entry and a current source", () => {
		const registry = new SessionRegistry();
		const store = new TaskGrantStore(registry);
		const entry = entryFor("s1", project);
		registry.add(entry);
		const grant = {
			source,
			taskId: "t",
			contractHash: "0".repeat(64),
			writeRoots: [project],
			maxCalls: 5,
			maxAutoResumes: 0,
		};
		store.issue(entry, grant);
		// No validator bound yet: nothing is current.
		expect(store.current(entry)).toBeUndefined();
		let current = true;
		store.bindSourceValidator(() => current);
		store.issue(entry, grant);
		expect(store.writeRoots("s1")).toEqual([project]);
		expect(store.release(entry, "other")).toBe(false);
		expect(store.release(entry, "t")).toBe(true);
		expect(store.current(entry)).toBeUndefined();

		store.issue(entry, grant);
		current = false;
		expect(store.writeRoots("s1")).toBeUndefined();
		current = true;
		// Once dropped for a changed source, the grant does not come back.
		expect(store.writeRoots("s1")).toBeUndefined();

		store.issue(entry, grant);
		registry.add(entryFor("s1", project));
		expect(store.current(entry)).toBeUndefined();
		const replaced = registry.get("s1")!;
		store.issue(replaced, grant);
		registry.revoke("s1");
		expect(store.writeRoots("s1")).toBeUndefined();
	});
});

describe("task grant allowances", () => {
	const tasks: PluginRuntimeSource = {
		pluginId: "tasks",
		packageRoot: "/t",
		entrypoint: "/t/r.mjs",
		contentHash: "t1",
	};
	const zotero: PluginRuntimeSource = {
		pluginId: "research",
		packageRoot: "/r",
		entrypoint: "/r/r.mjs",
		contentHash: "r1",
	};
	const setup = () => {
		const registry = new SessionRegistry();
		const store = new TaskGrantStore(registry);
		store.bindSourceValidator(() => true);
		const entry = entryFor("s1", project);
		registry.add(entry);
		store.issue(entry, {
			source: tasks,
			taskId: "t",
			contractHash: "0".repeat(64),
			writeRoots: [],
			maxCalls: 5,
			maxAutoResumes: 0,
			allowances: [
				{
					id: "z",
					role: "acceptance",
					member: "zotero_item",
					label: "Paper",
					consent: { slot: true },
					provider: { pluginId: "research", contentHash: "r1" },
				},
			],
		});
		return { store, entry };
	};
	it("admit exactly one write by exactly the provider source shown in the dialog", () => {
		const { store, entry } = setup();
		expect(store.allowancesFor(entry, zotero)).toEqual({
			taskId: "t",
			allowances: [
				{ id: "z", role: "acceptance", member: "zotero_item", consent: { slot: true }, used: false },
			],
		});
		// The requester and an upgraded provider hold nothing; an unknown id is not an allowance.
		expect(store.allowancesFor(entry, tasks)?.allowances).toEqual([]);
		expect(store.consumeAllowance(entry, { ...zotero, contentHash: "r2" }, "z")).toBe(false);
		expect(store.consumeAllowance(entry, zotero, "other")).toBe(false);
		expect(store.consumeAllowance(entry, zotero, "z")).toBe(true);
		expect(store.consumeAllowance(entry, zotero, "z")).toBe(false);
		expect(store.allowancesFor(entry, zotero)?.allowances[0]?.used).toBe(true);
	});
	it("amend replaces one allowance for the requesting task only, and the replacement is unused", () => {
		const { store, entry } = setup();
		expect(store.consumeAllowance(entry, zotero, "z")).toBe(true);
		expect(() => store.amend(entry, zotero, "t", "z", "Other", { doi: "x" })).toThrow("own plugin");
		expect(() => store.amend(entry, tasks, "other", "z", "Other", { doi: "x" })).toThrow("own plugin");
		store.amend(entry, tasks, "t", "z", "Other paper", { doi: "10.1/x" });
		expect(store.allowance(entry, "z")).toMatchObject({ label: "Other paper", consent: { doi: "10.1/x" } });
		expect(store.consumeAllowance(entry, zotero, "z")).toBe(true);
	});
});
