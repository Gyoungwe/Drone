import { createTaskAuthorization } from "@drone/tasks/ask-authorization";
import { createTaskWorkbench, WORKBENCH_ENTRY } from "@drone/tasks/workbench";
import { expect, it, vi } from "vitest";
import { AskGate } from "../src/session/ask-gate";
import { makeUiContext } from "../src/session/ui-context";

function fixture(compute) {
	const journal = createTaskWorkbench({ requireAuthorization: true });
	journal.attach("session-a");
	journal.begin("Create a bounded report");
	journal.plan({
		summary: "Create report only",
		writeRoots: [],
		...(compute ? { compute } : {}),
		milestones: [
			{ id: "report", title: "Report", dependsOn: [], acceptance: { kind: "file", path: "report.md" } },
		],
	});
	const input = () => ({
		taskId: journal.snapshot().id,
		revision: journal.view().revision,
		action: "authorize-task",
	});
	return { journal, input, ask: createTaskAuthorization(journal) };
}

function persistedFixture(binding = null) {
	const entries = [];
	const journal = createTaskWorkbench({
		requireAuthorization: true,
		persist: (data) => entries.push({ customType: WORKBENCH_ENTRY, data }),
	});
	journal.attach("session-a");
	journal.begin("Create a bounded report", [], binding);
	journal.plan({
		summary: "Create report only",
		writeRoots: [],
		milestones: [
			{ id: "report", title: "Report", dependsOn: [], acceptance: { kind: "file", path: "report.md" } },
		],
	});
	const input = () => ({
		taskId: journal.snapshot().id,
		revision: journal.view().revision,
		action: "authorize-task",
	});
	return { journal, entries, input, ask: createTaskAuthorization(journal) };
}

it("shows the approved compute host and budget in the ask_user contract", async () => {
	const f = fixture({
		hosts: ["slurm-a"],
		remoteRead: ["/data/in"],
		remoteWrite: ["/data/out"],
		workflows: ["rnaseq"],
		budget: { maxCoreHours: 10, maxWalltimeMinutes: 60, maxConcurrentJobs: 2, maxDiskGb: 20 },
	});
	const selected = vi.fn(async () => "暂不授权");
	await f.ask(f.input(), { ui: { select: selected } });
	expect(selected).toHaveBeenCalledWith(
		expect.stringContaining("slurm-a"),
		expect.any(Array),
		expect.any(Object),
	);
	expect(selected.mock.calls[0][0]).toContain("60");
});
it("opens the real ask_user gate, displays the contract, and grants only the selected approval", async () => {
	const f = fixture(),
		requests = [];
	const gate = new AskGate((request) => requests.push(request));
	gate.bindSession("session-a");
	const ctx = {
		ui: makeUiContext(
			{
				confirm: async () => {
					throw new Error("must not use permission dock");
				},
			},
			gate,
		),
	};
	const result = f.ask(f.input(), ctx);
	await vi.waitFor(() => expect(requests).toHaveLength(1));
	const req = requests[0];
	expect(req.title).toContain("ask_user");
	expect(req.questions[0].prompt).toContain("report.md");
	expect(f.journal.authorization()).toBeFalsy();
	gate.respond(req.id, { kind: "answer", answers: { value: { values: ["同意本次请求"] } } });
	expect(await result).toBe(true);
	expect(f.journal.authorization()).toBeTruthy();
	gate.dispose();
});
it.each([undefined, "暂不授权", "yes", "Custom approval"])("%s never grants consent", async (selected) => {
	const f = fixture();
	const revision = f.journal.view().revision;
	expect(await f.ask(f.input(), { ui: { select: async () => selected } })).toBe(false);
	expect(f.journal.authorization()).toBeFalsy();
	expect(f.journal.view().revision).toBe(revision);
});
it("rejects a task revision changed while the form is open", async () => {
	const f = fixture();
	await expect(
		f.ask(f.input(), {
			ui: {
				select: async () => {
					f.journal.command({ ...f.input(), action: "cancel" });
					return "同意本次请求";
				},
			},
		}),
	).rejects.toThrow("changed");
	expect(f.journal.authorization()).toBeFalsy();
});
it("does not approve a changed binding or a cancelled signal", async () => {
	const f = fixture();
	let binding = "one";
	const ask = createTaskAuthorization(f.journal, async () => binding);
	await expect(
		ask(f.input(), {
			ui: {
				select: async () => {
					binding = "two";
					return "同意本次请求";
				},
			},
		}),
	).rejects.toThrow("binding changed");
	const controller = new AbortController();
	expect(
		await f.ask(
			f.input(),
			{
				ui: {
					select: async () => {
						controller.abort();
						return "同意本次请求";
					},
				},
			},
			controller.signal,
		),
	).toBe(false);
	expect(f.journal.authorization()).toBeFalsy();
});
it("authorization handoffs use ask_user and do not mint directory permissions", async () => {
	const f = fixture();
	const action = f.journal.wait({
		kind: "authorization",
		title: "Confirm task scope",
		reason: "Needs a user decision",
	});
	const input = { ...f.input(), action: "ask-authorization", actionId: action.id };
	expect(await f.ask(input, { ui: { select: async () => "同意本次请求" } })).toBe(true);
	expect(f.journal.snapshot().actions[0].state).toBe("acknowledged");
	expect(f.journal.authorization()).toBeFalsy();
});
it("deduplicates simultaneous requests for the same revision", async () => {
	const f = fixture();
	let resolve;
	const select = vi.fn(
		() =>
			new Promise((r) => {
				resolve = r;
			}),
	);
	const input = f.input(),
		ctx = { ui: { select } };
	const a = f.ask(input, ctx),
		b = f.ask(input, ctx);
	await vi.waitFor(() => expect(select).toHaveBeenCalledOnce());
	resolve("同意本次请求");
	expect(await a).toBe(true);
	expect(await b).toBe(true);
});

it("does not reopen the task authorization dialog after consent exists", async () => {
	const f = fixture();
	const select = vi.fn(async () => "同意本次请求");
	const ctx = { ui: { select } };
	expect(await f.ask(f.input(), ctx)).toBe(true);
	expect(select).toHaveBeenCalledOnce();
	// A replayed authorize-task command is idempotent and must not look like a
	// second authorization request to the user.
	expect(await f.ask(f.input(), ctx)).toBe(true);
	expect(select).toHaveBeenCalledOnce();
});

it("reopens authorization when the persisted contract no longer matches consent", async () => {
	const original = persistedFixture();
	const select = vi.fn(async () => "同意本次请求");
	expect(await original.ask(original.input(), { ui: { select } })).toBe(true);

	const replay = structuredClone(original.entries);
	replay.at(-1).data.tasks[0].authorizationSummary = "A different scope";
	const changed = createTaskWorkbench({ requireAuthorization: true });
	changed.attach("session-a", replay);
	const changedAsk = createTaskAuthorization(changed);
	const changedInput = {
		taskId: changed.snapshot().id,
		revision: changed.view().revision,
		action: "authorize-task",
	};
	const replaySelect = vi.fn(async () => "暂不授权");
	expect(await changedAsk(changedInput, { ui: { select: replaySelect } })).toBe(false);
	expect(replaySelect).toHaveBeenCalledOnce();
});

it("reopens authorization when the live knowledge binding changed", async () => {
	let binding = "vault-a";
	const f = persistedFixture(binding);
	const select = vi.fn(async () => "同意本次请求");
	const ask = createTaskAuthorization(f.journal, async () => binding);
	expect(await ask(f.input(), { ui: { select } })).toBe(true);

	binding = "vault-b";
	const replaySelect = vi.fn(async () => "暂不授权");
	expect(await ask(f.input(), { ui: { select: replaySelect } })).toBe(false);
	expect(replaySelect).toHaveBeenCalledOnce();
});
