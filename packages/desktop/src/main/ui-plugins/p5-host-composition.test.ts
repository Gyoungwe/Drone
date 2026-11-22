import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { P5ActiveFactOwner, PluginSessionCallerContext } from "@drone/backend";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDesktopP5Authority } from "./p5-host-composition";

const HASH = "a".repeat(64);
const fixture = { directory: "" };

function context(overrides: Partial<PluginSessionCallerContext> = {}): PluginSessionCallerContext {
	return {
		identity: { kind: "application" },
		sessionIdentity: { kind: "application" },
		scope: { kind: "session", workspaceId: "workspace-1", workspaceDirectory: "/w", sessionId: "session-1" },
		readOnly: false,
		projectTrusted: true,
		signal: new AbortController().signal,
		...overrides,
	} as unknown as PluginSessionCallerContext;
}

function attachment(overrides: Partial<P5ActiveFactOwner> = {}): P5ActiveFactOwner {
	return {
		workspaceId: "workspace-1",
		sessionId: "session-1",
		callerSourceHash: HASH,
		providerSourceHash: HASH,
		owner: { deliver: async () => ({ cursor: "c" }) },
		signal: new AbortController().signal,
		...overrides,
	} as unknown as P5ActiveFactOwner;
}

beforeEach(async () => {
	fixture.directory = await mkdtemp(join(tmpdir(), "drone-p5-desktop-"));
});
afterEach(async () => {
	await rm(fixture.directory, { recursive: true, force: true });
});

it("authorizes a live, trusted, writable session", async () => {
	const authority = createDesktopP5Authority({
		getPluginCallerContext: () => context(),
	});
	await expect(authority.authorize(attachment())).resolves.toBe(true);
});

it("denies a session that no longer exists", async () => {
	const authority = createDesktopP5Authority({
		getPluginCallerContext: () => undefined,
	});
	await expect(authority.authorize(attachment())).resolves.toBe(false);
});

it("denies a read-only session", async () => {
	const authority = createDesktopP5Authority({
		getPluginCallerContext: () => context({ readOnly: true }),
	});
	await expect(authority.authorize(attachment())).resolves.toBe(false);
});

it("denies a session whose project is no longer trusted", async () => {
	const authority = createDesktopP5Authority({
		getPluginCallerContext: () => context({ projectTrusted: false }),
	});
	await expect(authority.authorize(attachment())).resolves.toBe(false);
});

it("denies an aborted attachment even when the session is still open", async () => {
	const authority = createDesktopP5Authority({
		getPluginCallerContext: () => context(),
	});
	const aborted = new AbortController();
	aborted.abort(new Error("binding stopped"));
	await expect(authority.authorize(attachment({ signal: aborted.signal }))).resolves.toBe(false);
});

it("denies a session whose own context was aborted", async () => {
	const aborted = new AbortController();
	aborted.abort(new Error("session closed"));
	const authority = createDesktopP5Authority({
		getPluginCallerContext: () => context({ signal: aborted.signal }),
	});
	await expect(authority.authorize(attachment())).resolves.toBe(false);
});

it("re-reads the session for every batch rather than latching the answer", async () => {
	const getPluginCallerContext = vi.fn<() => PluginSessionCallerContext | undefined>(() => context());
	const authority = createDesktopP5Authority({ getPluginCallerContext });
	await expect(authority.authorize(attachment())).resolves.toBe(true);
	getPluginCallerContext.mockReturnValue(undefined);
	await expect(authority.authorize(attachment())).resolves.toBe(false);
	expect(getPluginCallerContext).toHaveBeenCalledTimes(2);
});
