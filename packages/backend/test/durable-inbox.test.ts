import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	DurableInbox,
	forgetInbox,
	IMPLICIT_DEDUP_WINDOW_MS,
	inboxFor,
	inboxPath,
	observeInbox,
} from "../src/session/durable-inbox";

const dirs: string[] = [];
const file = () => {
	const dir = mkdtempSync(join(tmpdir(), "drone-inbox-"));
	dirs.push(dir);
	return join(dir, "s.jsonl");
};
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("durable inbox", () => {
	it("persists queued messages and restores them in a new process", () => {
		const path = inboxPath(file());
		const inbox = new DurableInbox(path, () => 1);
		expect(inbox.accept("第一条", "r1")).toBe(true);
		expect(inbox.accept("第二条", "r2")).toBe(true);
		// simulated crash: a fresh instance reads the file
		const reopened = new DurableInbox(path);
		expect(reopened.pending().map((i) => i.requestId)).toEqual(["r1", "r2"]);
		expect(reopened.drain().map((i) => i.text)).toEqual(["第一条", "第二条"]);
		expect(new DurableInbox(path).pending()).toEqual([]);
	});

	it("dedupes by explicit requestId, including after delivery", () => {
		const inbox = new DurableInbox(inboxPath(file()));
		expect(inbox.accept("a", "r1")).toBe(true);
		expect(inbox.accept("a", "r1")).toBe(false);
		inbox.sync([]);
		expect(inbox.pending()).toEqual([]);
		expect(inbox.accept("a", "r1")).toBe(false);
		expect(inbox.accept("a", "r2")).toBe(true);
	});

	it("dedupes implicit resubmits only within a short window", () => {
		let clock = 0;
		const inbox = new DurableInbox(inboxPath(file()), () => clock);
		expect(inbox.accept("继续")).toBe(true);
		expect(inbox.accept("继续")).toBe(false);
		clock = IMPLICIT_DEDUP_WINDOW_MS + 1;
		expect(inbox.accept("继续")).toBe(true);
	});

	it("queue_update snapshots mark delivered messages (multiset aware)", () => {
		const sessionFile = file();
		forgetInbox(sessionFile);
		const inbox = inboxFor(sessionFile);
		inbox.accept("x", "1");
		inbox.accept("x", "2");
		inbox.accept("y", "3");
		observeInbox(sessionFile, { type: "queue_update", steering: [], followUp: ["x", "y"] });
		expect(inbox.pending().map((i) => i.requestId)).toEqual(["2", "3"]);
		observeInbox(sessionFile, { type: "message_end" });
		expect(inbox.pending()).toHaveLength(2);
		expect(JSON.parse(readFileSync(inboxPath(sessionFile), "utf8")).queued).toHaveLength(2);
	});

	it("treats a corrupt or foreign-version file as empty", () => {
		const path = inboxPath(file());
		writeFileSync(path, "{not json");
		expect(new DurableInbox(path).pending()).toEqual([]);
		writeFileSync(path, JSON.stringify({ version: 99, queued: [{ requestId: "a", text: "b", ts: 1 }] }));
		expect(new DurableInbox(path).pending()).toEqual([]);
	});
});
