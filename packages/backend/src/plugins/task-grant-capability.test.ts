import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginRuntimeContext } from "@gyoungwe/plugin-api/runtime";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { type RegisteredSession, SessionRegistry } from "../session/registry";
import { PluginRuntimeBridge, type PluginRuntimeSource } from "./coordinator";
import type { PluginCapabilityHandler } from "./runtime-capabilities";
import { getPluginSessionCaller } from "./session-caller";
import { taskGrantCapabilityHandlers, taskGrantDialog } from "./task-grant-capability";
import { TaskGrantStore } from "./task-grants";

/** A temporary project under a stubbed home, removed when the test ends. */
function tempProject(): string {
	const work = realpathSync(mkdtempSync(join(tmpdir(), "task-grant-")));
	const project = join(work, "home", "project");
	mkdirSync(join(project, "outputs"), { recursive: true });
	mkdirSync(join(project, "notes"), { recursive: true });
	writeFileSync(join(project, "file.txt"), "x");
	// os.homedir() reads USERPROFILE on Windows and HOME elsewhere.
	vi.stubEnv("HOME", join(work, "home"));
	vi.stubEnv("USERPROFILE", join(work, "home"));
	onTestFinished(() => {
		vi.unstubAllEnvs();
		rmSync(work, { recursive: true, force: true });
	});
	return project;
}

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
		unsubscribe: () => undefined,
		cwd,
		...extra,
	}) as unknown as RegisteredSession;

const source: PluginRuntimeSource = {
	pluginId: "tasks",
	packageRoot: "/tasks",
	entrypoint: "/tasks/runtime.mjs",
	requestsTaskGrant: true,
};
const owner = { id: 1, isDestroyed: () => false };
const nullSchema = { type: "null" };
const callSchema = {
	type: "object",
	properties: { name: { type: "string" }, input: {} },
	required: ["name"],
};
const handler = (approval?: "own" | "always"): PluginCapabilityHandler => ({
	effect: "write",
	...(approval ? { approval } : {}),
	inputSchema: nullSchema,
	resultSchema: nullSchema,
	execute: async () => null,
});
const call = async (input: unknown, context: PluginRuntimeContext) => {
	const { name, input: value } = input as { name: string; input?: unknown };
	return context.capabilities.call(name, value ?? null);
};
const request = (writeDirectories: string[]) => ({
	taskId: "task-1",
	contractHash: "a".repeat(64),
	goal: "Reproduce figure 2",
	writeDirectories,
	acceptance: ["figure saved"],
	maxCalls: 50,
	maxAutoResumes: 0,
});

async function harness(options: { readOnly?: boolean; child?: boolean; trusted?: boolean } = {}) {
	const project = tempProject();
	const registry = new SessionRegistry();
	const store = new TaskGrantStore(registry);
	const entry = entryFor(
		"s1",
		project,
		{
			...(options.readOnly ? { readOnly: true } : {}),
			...(options.child ? { nativeKind: "child" as const } : {}),
		},
		options.trusted ?? true,
	);
	registry.add(entry);
	let enabled = true;
	const approvals: { operation?: string; detail?: string }[] = [];
	let answer = true;
	let hook: (() => void) | undefined;
	const bridge = new PluginRuntimeBridge({
		source: () => (enabled ? source : undefined),
		sources: () => [{ name: "tasks", source, state: enabled ? "enabled" : "disabled" }],
		enabled: () => enabled,
		taskGrants: store,
		getSessionContext: (id) => getPluginSessionCaller(registry, id),
		approve: async (_owner, _source, operation, detail) => {
			if (operation) approvals.push({ operation, detail });
			hook?.();
			hook = undefined;
			return answer;
		},
		capabilities: () => ({
			resources: [],
			handlers: {
				...taskGrantCapabilityHandlers(store, registry, source),
				"plain.write": handler(),
				"own.write": handler("own"),
				"always.write": handler("always"),
			},
		}),
		factory: () => async () => ({
			operations: {
				read: { effect: "read", inputSchema: callSchema, resultSchema: {}, execute: call },
				write: { effect: "write", inputSchema: callSchema, resultSchema: {}, execute: call },
			},
			dispose: () => Promise.resolve(),
		}),
	});
	const token = (await bridge.bind("tasks", owner)) as string;
	const selection = bridge.selectSession(owner, "s1");
	let sequence = 0;
	const invoke = (operation: "read" | "write", name: string, input?: unknown) =>
		bridge.invoke(owner, token, operation, { name, input }, selection, `r${sequence++}`);
	const operations = () => approvals.splice(0).map((item) => item.operation);
	return {
		project,
		registry,
		store,
		entry,
		bridge,
		invoke,
		operations,
		approvals,
		disable: () => {
			enabled = false;
		},
		deny: () => {
			answer = false;
		},
		onApprove: (next: () => void) => {
			hook = next;
		},
	};
}

it("prompts for ordinary writes without a grant but never for own bookkeeping", async () => {
	const h = await harness();
	await h.invoke("write", "own.write");
	expect(h.operations()).toEqual(["write"]);
	await h.invoke("write", "plain.write");
	expect(h.operations()).toEqual(["write", "capability:plain.write"]);
	await h.bridge.close();
});

it("issues one host-rendered grant that covers the plugin's ordinary writes until released", async () => {
	const h = await harness();
	const grant = (await h.invoke("read", "task.grant.request", request(["outputs"]))) as {
		writeRoots: string[];
	};
	expect(grant.writeRoots).toEqual([join(h.project, "outputs")]);
	const [dialog] = h.approvals.splice(0);
	expect(dialog?.operation).toBe("capability:task.grant.request");
	expect(dialog?.detail).toContain("Reproduce figure 2");
	expect(dialog?.detail).toContain(join(h.project, "outputs"));
	expect(h.store.writeRoots("s1")).toEqual([join(h.project, "outputs")]);

	await h.invoke("write", "plain.write");
	expect(h.operations()).toEqual([]);
	await h.invoke("write", "always.write");
	expect(h.operations()).toEqual(["capability:always.write"]);
	expect(await h.invoke("read", "task.grant.current")).toMatchObject({ taskId: "task-1" });

	expect(await h.invoke("read", "task.grant.release", { taskId: "task-1" })).toEqual({ released: true });
	expect(h.operations()).toEqual([]);
	await h.invoke("write", "plain.write");
	expect(h.operations()).toEqual(["write", "capability:plain.write"]);
	await h.bridge.close();
});

it("does not issue a grant when the user declines", async () => {
	const h = await harness();
	h.deny();
	await expect(h.invoke("read", "task.grant.request", request(["outputs"]))).rejects.toThrow("denied");
	expect(h.store.writeRoots("s1")).toBeUndefined();
	await h.bridge.close();
});

it("drops the grant when the session closes or the source is no longer enabled", async () => {
	const closing = await harness();
	await closing.invoke("read", "task.grant.request", request(["outputs"]));
	closing.registry.revoke("s1");
	expect(closing.store.current(closing.entry)).toBeUndefined();
	await closing.bridge.close();

	const disabled = await harness();
	await disabled.invoke("read", "task.grant.request", request(["outputs"]));
	disabled.disable();
	expect(disabled.store.writeRoots("s1")).toBeUndefined();
	await disabled.bridge.close();
});

it("refuses read-only, child and untrusted sessions", async () => {
	for (const options of [{ readOnly: true }, { child: true }, { trusted: false }]) {
		const h = await harness(options);
		await expect(h.invoke("read", "task.grant.request", request(["outputs"]))).rejects.toThrow();
		expect(h.store.writeRoots("s1")).toBeUndefined();
		await h.bridge.close();
	}
});

it("refuses directories replaced while the dialog was open", async () => {
	const h = await harness();
	h.onApprove(() => {
		// The approved folder becomes a link to another folder before the grant is issued.
		renameSync(join(h.project, "outputs"), join(h.project, "approved"));
		mkdirSync(join(h.project, "elsewhere"));
		symlinkSync(join(h.project, "elsewhere"), join(h.project, "outputs"));
	});
	await expect(h.invoke("read", "task.grant.request", request(["outputs"]))).rejects.toThrow(
		"changed during authorization",
	);
	expect(h.store.writeRoots("s1")).toBeUndefined();
	await h.bridge.close();
});

describe("automatic continuation", () => {
	const source: PluginRuntimeSource = {
		pluginId: "tasks",
		packageRoot: "/t",
		entrypoint: "/t/r.mjs",
		contentHash: "h1",
	};
	const context = (entry: RegisteredSession) =>
		({
			pluginId: "tasks",
			scope: { kind: "session", sessionId: "s1", workspaceDirectory: entry.cwd, workspaceId: "w" },
			sessionIdentity: entry,
			signal: new AbortController().signal,
		}) as never;
	it("starts a hidden host follow-up only under this plugin's grant, for its task, within budget", async () => {
		const registry = new SessionRegistry();
		const store = new TaskGrantStore(registry);
		store.bindSourceValidator(() => true);
		const entry = entryFor("s1", tempProject());
		registry.add(entry);
		const handlers = taskGrantCapabilityHandlers(store, registry, source);
		const proceed = (taskId = "t") =>
			handlers["task.continue"].execute({ taskId, prompt: "continue" }, context(entry));
		await expect(proceed()).rejects.toThrow("current task authorization");
		const grant = {
			taskId: "t",
			contractHash: "0".repeat(64),
			writeRoots: [],
			maxCalls: 5,
			maxAutoResumes: 2,
		};
		store.issue(entry, { ...grant, source: { ...source, contentHash: "other" } });
		await expect(proceed()).rejects.toThrow("current task authorization");
		store.issue(entry, { ...grant, source });
		await expect(proceed("other")).rejects.toThrow("authorized task");
		expect(await proceed()).toMatchObject({ remaining: 1 });
		expect(await proceed()).toMatchObject({ remaining: 0 });
		await expect(proceed()).rejects.toThrow("used up");
		const sent = (entry.session as unknown as { sent: unknown[] }).sent;
		expect(sent).toHaveLength(2);
		expect(sent[0]).toMatchObject({
			message: {
				customType: "plugin-continue:tasks",
				display: false,
				content: "continue",
				details: { taskId: "t" },
			},
			options: { triggerTurn: true, deliverAs: "followUp" },
		});
		// A new authorization starts a fresh budget.
		store.issue(entry, { ...grant, source });
		expect(await proceed()).toMatchObject({ remaining: 1 });
	});
});

describe("taskGrantDialog", () => {
	it("states the directories, budget, acceptance and what still asks", () => {
		const text = taskGrantDialog(
			{
				taskId: "t",
				contractHash: "0".repeat(64),
				goal: "Goal",
				writeDirectories: [],
				acceptance: ["done"],
				maxCalls: 3,
				maxAutoResumes: 1,
			},
			[],
		);
		expect(text).toContain("Goal");
		expect(text).toContain("3");
		expect(text).toContain("done");
	});
});
