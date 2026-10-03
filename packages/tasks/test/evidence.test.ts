import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEvidenceRecovery, type EvidenceInspector, type EvidenceSnapshot } from "../src/evidence";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function fixture(text = "one\ntwo\nthree") {
	const cwd = await mkdtemp(join(tmpdir(), "drone-task-evidence-"));
	directories.push(cwd);
	await writeFile(join(cwd, "data.txt"), text);
	return cwd;
}

const inspectTaskFile: EvidenceInspector = async (cwd, path, expected = {}) => {
	const sha256 = createHash("sha256")
		.update(await readFile(join(cwd, path)))
		.digest("hex");
	if (expected.sha256 && expected.sha256 !== sha256) throw new Error("file-version-changed");
	return { path, sha256 };
};

describe("task evidence recovery", () => {
	it("restores only an evicted host-observed window and rechecks current permission and version", async () => {
		const cwd = await fixture();
		const authorize = vi.fn(async () => {});
		const inspect = vi.fn(inspectTaskFile);
		const recovery = createEvidenceRecovery({ authorize, inspectTaskFile: inspect });
		recovery.attach("scope", "task");
		await recovery.capture(
			{ toolCallId: "read", input: { path: "data.txt", offset: 2, limit: 1 } },
			cwd,
			"binding",
		);
		await expect(
			recovery.restore({ receiptId: "read", path: "data.txt" }, cwd, () => "binding"),
		).rejects.toThrow("recovery-unavailable");
		recovery.evict(["read"]);
		const result = await recovery.restore({ receiptId: "read", path: "data.txt" }, cwd, () => "binding");
		expect(result).toMatchObject({
			status: "restored",
			text: "two",
			scientificallyVerified: false,
			remaining: 1,
		});
		expect(authorize).toHaveBeenCalledWith(cwd, "data.txt");
		expect(inspect).toHaveBeenCalledTimes(3);
		expect(inspect.mock.calls[1]?.[2]).toEqual({ sha256: result.sha256 });
		expect(inspect.mock.calls[2]?.[2]).toEqual({ sha256: result.sha256 });
	});

	it("persists only bounded locators and continues the two-restores budget after reattach", async () => {
		const cwd = await fixture("PRIVATE_BODY");
		const entries: { customType: string; data: EvidenceSnapshot }[] = [];
		const options = {
			authorize: async () => {},
			inspectTaskFile,
			persist: (data: EvidenceSnapshot) =>
				entries.push({ customType: "drone-task-evidence-v1", data: structuredClone(data) }),
		};
		const recovery = createEvidenceRecovery(options);
		recovery.attach("scope", "task");
		for (let index = 0; index < 9; index++)
			await recovery.capture({ toolCallId: `read-${index}`, input: { path: "data.txt" } }, cwd, null);
		expect(entries.at(-1)?.data.records).toHaveLength(8);
		expect(JSON.stringify(entries)).not.toContain("PRIVATE_BODY");
		recovery.evict(["read-8"]);
		await recovery.restore({ receiptId: "read-8", path: "data.txt" }, cwd, () => null);
		const restored = createEvidenceRecovery(options);
		restored.attach("scope", "task", entries);
		restored.evict(["read-8"]);
		expect(
			(await restored.restore({ receiptId: "read-8", path: "data.txt" }, cwd, () => null)).remaining,
		).toBe(0);
		restored.evict(["read-8"]);
		await expect(
			restored.restore({ receiptId: "read-8", path: "data.txt" }, cwd, () => null),
		).rejects.toThrow("recovery-unavailable");
		const unrelated = createEvidenceRecovery(options);
		unrelated.attach("other", "task", entries);
		await expect(
			unrelated.restore({ receiptId: "read-8", path: "data.txt" }, cwd, () => null),
		).rejects.toThrow("recovery-unavailable");
	});

	it("fails closed on binding, permission and file-version changes without spending a recovery", async () => {
		const cwd = await fixture();
		const authorize = vi.fn(async () => {});
		const recovery = createEvidenceRecovery({ authorize, inspectTaskFile });
		recovery.attach("scope", "task");
		await recovery.capture({ toolCallId: "read", input: { path: "data.txt" } }, cwd, "binding");
		recovery.evict(["read"]);
		await expect(
			recovery.restore({ receiptId: "read", path: "data.txt" }, cwd, () => "changed"),
		).rejects.toThrow("recovery-binding-changed");
		expect(authorize).not.toHaveBeenCalled();
		authorize.mockRejectedValueOnce(new Error("permission-denied"));
		await expect(
			recovery.restore({ receiptId: "read", path: "data.txt" }, cwd, () => "binding"),
		).rejects.toThrow("permission-denied");
		await writeFile(join(cwd, "data.txt"), "changed bytes");
		await expect(
			recovery.restore({ receiptId: "read", path: "data.txt" }, cwd, () => "binding"),
		).rejects.toThrow("file-version-changed");
		await writeFile(join(cwd, "data.txt"), "one\ntwo\nthree");
		expect(
			(await recovery.restore({ receiptId: "read", path: "data.txt" }, cwd, () => "binding")).remaining,
		).toBe(1);
	});

	it("bounds line and byte recovery while excluding files rejected by the host inspector", async () => {
		const cwd = await fixture("x".repeat(20000));
		const inspect = vi.fn(inspectTaskFile);
		const recovery = createEvidenceRecovery({ authorize: async () => {}, inspectTaskFile: inspect });
		recovery.attach("scope", "task");
		inspect.mockRejectedValueOnce(new Error("file-scope"));
		await recovery.capture({ toolCallId: "private", input: { path: ".env" } }, cwd, null);
		recovery.evict(["private"]);
		await expect(recovery.restore({ receiptId: "private", path: ".env" }, cwd, () => null)).rejects.toThrow(
			"recovery-unavailable",
		);
		await recovery.capture(
			{ toolCallId: "read", input: { path: "data.txt", offset: -5, limit: 500 } },
			cwd,
			null,
		);
		recovery.evict(["read"]);
		const result = await recovery.restore({ receiptId: "read", path: "data.txt" }, cwd, () => null);
		expect(result).toMatchObject({ offset: 1, limit: 120 });
		expect(result.text).toHaveLength(16000);
	});

	it("rejects a version change during the read before returning a body", async () => {
		const cwd = await fixture();
		let inspections = 0;
		const inspect: EvidenceInspector = async (...args) => {
			const identity = await inspectTaskFile(...args);
			if (++inspections === 2) await writeFile(join(cwd, "data.txt"), "changed while reading");
			return identity;
		};
		const recovery = createEvidenceRecovery({ authorize: async () => {}, inspectTaskFile: inspect });
		recovery.attach("scope", "task");
		await recovery.capture({ toolCallId: "read", input: { path: "data.txt" } }, cwd, null);
		recovery.evict(["read"]);
		await expect(recovery.restore({ receiptId: "read", path: "data.txt" }, cwd, () => null)).rejects.toThrow(
			"file-version-changed",
		);
		await writeFile(join(cwd, "data.txt"), "one\ntwo\nthree");
		expect((await recovery.restore({ receiptId: "read", path: "data.txt" }, cwd, () => null)).remaining).toBe(
			1,
		);
	});
});
