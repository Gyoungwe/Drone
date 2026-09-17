import { expect, it, vi } from "vitest";
import { createTaskAuthorization } from "../../../.pi/lib/tasks/ask-authorization.mjs";
import { createTaskWorkbench } from "../../../.pi/lib/tasks/workbench.mjs";
import { AskGate } from "../src/session/ask-gate";
import { makeUiContext } from "../src/session/ui-context";

function fixture() {
	const journal = createTaskWorkbench({ requireAuthorization: true });
	journal.attach("session-a");
	journal.begin("Create a bounded report");
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
	return { journal, input, ask: createTaskAuthorization(journal) };
}
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
