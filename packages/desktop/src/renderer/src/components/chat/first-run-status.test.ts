import { expect, it, vi } from "vitest";
import { firstRunComplete, probeFirstRunStatus } from "./first-run-status";

const pi = (over: Record<string, unknown> = {}) =>
	({
		invokeKnowledge: async () => ({ binding: { revision: 2 } }),
		getZoteroStatus: async () => ({ enabled: true }),
		getZoteroWebApi: async () => ({ configured: true }),
		listHosts: async () => [{ id: "h" }],
		...over,
	}) as never;

it("detects each configured connection", async () => {
	const status = await probeFirstRunStatus(pi(), "/p");
	expect(status).toEqual({ knowledge: true, zotero: true, compute: true });
	expect(firstRunComplete(status)).toBe(true);
});

it.each([true, false])("uses Zotero enabled=%s without probing the Web API", async (enabled) => {
	const getZoteroWebApi = vi.fn(async () => ({ configured: true }));
	const status = await probeFirstRunStatus(
		pi({ getZoteroStatus: async () => ({ enabled }), getZoteroWebApi }),
		"/p",
	);
	expect(status.zotero).toBe(enabled);
	expect(getZoteroWebApi).not.toHaveBeenCalled();
});

it("knowledge needs a selected project and fails closed on IPC errors", async () => {
	const status = await probeFirstRunStatus(
		pi({
			listHosts: async () => {
				throw new Error("ipc");
			},
		}),
		null,
	);
	expect(status).toEqual({ knowledge: false, zotero: true, compute: false });
	expect(firstRunComplete(status)).toBe(false);
	expect(firstRunComplete(null)).toBe(false);
});
