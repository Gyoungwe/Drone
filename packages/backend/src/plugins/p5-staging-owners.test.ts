import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StagedRefInput } from "@gyoungwe/plugin-api/p5-evidence";
import { expect, it, onTestFinished, vi } from "vitest";
import { P5ByteStaging } from "./p5-byte-staging";
import { createP5StagingOwners, type P5StagingAttachment } from "./p5-staging-owners";

function fixture() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "p5-staging-owners-")));
	const lifetimes = {
		binding: new AbortController(),
		selection: new AbortController(),
		session: new AbortController(),
	};
	const attachment: P5StagingAttachment = {
		identity: {},
		sessionIdentity: {},
		workspaceId: "workspace",
		sessionId: "session",
		callerSourceHash: "a".repeat(64),
		providerSourceHash: "b".repeat(64),
		signals: Object.values(lifetimes).map((lifetime) => lifetime.signal),
	};
	let issued = 0;
	const newId = vi.fn(() => `owner-${++issued}`);
	const owners = createP5StagingOwners(newId);
	const scope = { action: "import" };
	const staging = new P5ByteStaging(root, () => owners.ownerFor(attachment, scope.action));
	const open = () => staging.open({ requestId: "stage", path: "blob", bytes: 6 });
	const chunk = (ref: StagedRefInput, offset: number, bytes: string) =>
		staging.chunk({ ...ref, offset, base64: Buffer.from(bytes).toString("base64") }, 120);
	onTestFinished(() => {
		lifetimes.binding.abort();
		rmSync(root, { recursive: true });
	});
	return { lifetimes, attachment, newId, owners, scope, staging, open, chunk };
}

it("reuses one frozen owner from open through chunk, seal, read and cancel", () => {
	const { attachment, newId, owners, staging, open, chunk } = fixture();
	const owner = owners.ownerFor(attachment, "import");
	assert.ok(owner);
	expect(owners.ownerFor(attachment, "import")).toBe(owner);
	expect(Object.isFrozen(owner)).toBe(true);
	expect(owner).toMatchObject({
		callerId: "owner-1",
		action: "import",
		workspaceId: attachment.workspaceId,
		sessionId: attachment.sessionId,
		callerSourceHash: attachment.callerSourceHash,
		providerSourceHash: attachment.providerSourceHash,
	});
	const ref = open();
	chunk(ref, 0, "ab");
	chunk(ref, 2, "cd");
	chunk(ref, 4, "ef");
	const sealed = { ...ref, bytes: 6, sha256: createHash("sha256").update("abcdef").digest("hex") };
	expect(staging.seal(sealed)).toEqual(sealed);
	expect(staging.read(ref).toString()).toBe("abcdef");
	staging.cancel(ref);
	expect(newId).toHaveBeenCalledTimes(1);
});

it.each(["binding", "selection", "session"] as const)(
	"invalidates the staging ref on %s abort",
	(lifetime) => {
		const { lifetimes, attachment, newId, owners, open, chunk } = fixture();
		const ref = open();
		chunk(ref, 0, "ab");
		lifetimes[lifetime].abort();
		expect(() => chunk(ref, 2, "cd")).toThrow("SCOPE_CHANGED");
		expect(owners.ownerFor(attachment, "import")).toBeUndefined();
		expect(newId).toHaveBeenCalledTimes(1);
	},
);

it("releases the staging ref and issues a fresh owner for the same live action", () => {
	const { attachment, newId, owners, open, chunk } = fixture();
	const ref = open();
	const owner = owners.ownerFor(attachment, "import");
	assert.ok(owner);
	const otherAction = owners.ownerFor(attachment, "export");
	assert.ok(otherAction);
	owners.release(owner);
	expect(owner.signal.aborted).toBe(true);
	expect(() => chunk(ref, 0, "ab")).toThrow("SCOPE_CHANGED");
	const replacement = owners.ownerFor(attachment, "import");
	assert.ok(replacement);
	expect(replacement.callerId).not.toBe(owner.callerId);
	expect(replacement.signal).not.toBe(owner.signal);
	owners.release(owner);
	expect(owners.ownerFor(attachment, "import")).toBe(replacement);
	expect(owners.ownerFor(attachment, "export")).toBe(otherAction);
	expect(newId).toHaveBeenCalledTimes(3);
});

it("invalidates the old session's owners and staging ref when the live session identity changes", () => {
	const { attachment, owners, open, chunk } = fixture();
	const ref = open();
	const owner = owners.ownerFor(attachment, "import");
	assert.ok(owner);
	const otherAction = owners.ownerFor(attachment, "export");
	assert.ok(otherAction);
	const replacementAttachment = { ...attachment, sessionIdentity: {} };
	const replacement = owners.ownerFor(replacementAttachment, "import");
	assert.ok(replacement);
	expect(replacement.callerId).not.toBe(owner.callerId);
	expect(replacement.signal).not.toBe(owner.signal);
	expect(owner.signal.aborted).toBe(true);
	expect(otherAction.signal.aborted).toBe(true);
	expect(() => chunk(ref, 0, "ab")).toThrow("SCOPE_CHANGED");
	expect(owners.ownerFor(replacementAttachment, "import")).toBe(replacement);
});

it("rejects a different action's use of the staging ref under the same attachment", () => {
	const { attachment, owners, scope, open, chunk } = fixture();
	const ref = open();
	const owner = owners.ownerFor(attachment, "import");
	assert.ok(owner);
	scope.action = "export";
	const other = owners.ownerFor(attachment, scope.action);
	assert.ok(other);
	expect(other.callerId).not.toBe(owner.callerId);
	expect(other.signal).not.toBe(owner.signal);
	expect(owner.signal.aborted).toBe(false);
	expect(() => chunk(ref, 0, "ab")).toThrow("SCOPE_CHANGED");
});

it("rejects releasing another registry's owner while it is live", () => {
	const { attachment, owners } = fixture();
	const otherRegistry = createP5StagingOwners(() => "other-owner");
	const owner = otherRegistry.ownerFor(attachment, "import");
	assert.ok(owner);
	expect(() => owners.release(owner)).toThrow("Unknown P5 staging owner");
	expect(owner.signal.aborted).toBe(false);
	otherRegistry.release(owner);
	expect(() => owners.release(owner)).not.toThrow();
});
