import type {
	AskRequest,
	AskResolved,
	PermissionRequest,
	PermissionResolved,
	PiApi,
	SessionEventEnvelope,
	TrustRequest,
} from "@drone/shared";
import { channelOf, PermissionsContract, SessionsContract } from "@drone/shared";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	exposed: new Map<string, PiApi>(),
	listeners: new Map<string, (event: unknown, payload: unknown) => void>(),
	invoke: vi.fn(async () => undefined),
	removeListener: vi.fn(),
}));
vi.mock("electron", () => ({
	contextBridge: { exposeInMainWorld: (name: string, value: PiApi) => mocks.exposed.set(name, value) },
	ipcRenderer: {
		invoke: mocks.invoke,
		on: (channel: string, listener: (event: unknown, payload: unknown) => void) =>
			mocks.listeners.set(channel, listener),
		removeListener: mocks.removeListener,
		send: vi.fn(),
		sendSync: vi.fn(),
	},
	webUtils: { getPathForFile: () => "" },
}));

async function loadPi() {
	await import("./index");
	const api = mocks.exposed.get("pi");
	if (!api) throw new Error("Preload did not expose window.pi");
	return api;
}

it.each([
	{
		channel: channelOf(SessionsContract, "event"),
		method: "onEvent",
		payload: {
			sessionId: "session-a",
			event: { type: "extension_notification", severity: "warning", message: "Official extension warning" },
		} satisfies SessionEventEnvelope,
	},
	{
		channel: channelOf(PermissionsContract, "askRequest"),
		method: "onAskRequest",
		payload: {
			id: "ask-1",
			sessionId: "session-a",
			toolCallId: "tool-1",
			questions: [],
		} satisfies AskRequest,
	},
	{
		channel: channelOf(PermissionsContract, "askResolved"),
		method: "onAskResolved",
		payload: { sessionId: "session-a", requestId: "ask-1" } satisfies AskResolved,
	},
	{
		channel: channelOf(PermissionsContract, "permissionRequest"),
		method: "onPermissionRequest",
		payload: {
			id: "permission-1",
			sessionId: "session-a",
			title: "Tool approval",
			message: "Approve this tool call",
			kind: "other",
		} satisfies PermissionRequest,
	},
	{
		channel: channelOf(PermissionsContract, "permissionResolved"),
		method: "onPermissionResolved",
		payload: {
			sessionId: "session-a",
			requestId: "permission-1",
			answered: false,
		} satisfies PermissionResolved,
	},
	{
		channel: channelOf(PermissionsContract, "trustRequest"),
		method: "onTrustRequest",
		payload: { id: "trust-1", cwd: "/tmp/project", options: [{ key: "deny" }] } satisfies TrustRequest,
	},
] as const)(
	"$method forwards $channel and removes its own listener",
	async ({ channel, method, payload }) => {
		const api = await loadPi();
		const received: unknown[] = [];
		const off = api[method]((value: unknown) => received.push(value));
		const listener = mocks.listeners.get(channel);
		if (!listener) throw new Error(`Missing IPC listener: ${channel}`);
		listener({}, payload);
		expect(received).toEqual([payload]);
		off();
		expect(mocks.removeListener).toHaveBeenCalledWith(channel, listener);
	},
);

it("invokes the permissions audit with the existing optional limit", async () => {
	const api = await loadPi();
	await api.getPermissionAuditTail();
	await api.getPermissionAuditTail(25);
	const channel = channelOf(PermissionsContract, "auditTail");
	expect(mocks.invoke.mock.calls).toEqual([[channel], [channel, 25]]);
});
