import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	continuationHint,
	continuesTopic,
	currentProject,
	explainerTopicId,
	result,
	sessionIdentity,
} from "../src/extension-helpers";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("knowledge extension helpers", () => {
	it("returns a model-readable result envelope", () => {
		expect(result({ ok: true })).toEqual({
			content: [{ type: "text", text: '{\n  "ok": true\n}' }],
			details: { ok: true },
		});
	});
	it("resolves the workspace identity and falls back to cwd", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-knowledge-helpers-"));
		roots.push(root);
		await mkdir(join(root, ".pi"));
		await writeFile(
			join(root, ".pi/research-workspace.json"),
			JSON.stringify({ knowledgeProjectId: "demo" }),
		);
		expect(await currentProject(root)).toBe("demo");
		await rm(join(root, ".pi/research-workspace.json"));
		expect(await currentProject(root)).toMatch(/^drone-knowledge-helpers-[a-z0-9-]+$/);
	});
	it("normalizes topic identifiers and detects continuation hints", () => {
		expect(explainerTopicId("My Topic_20261001")).toBe("my-topic");
		expect(explainerTopicId("!!!")).toBe("research-topic");
		expect(continuationHint("请继续说明上一节")).toBe(true);
		expect(continuesTopic("what about validation?", { id: "validation", title: "Validation" })).toBe(true);
		expect(continuesTopic("new topic: deployment", { id: "validation" })).toBe(false);
	});
	it("prefers host session manager identity", () => {
		expect(sessionIdentity({ sessionManager: { getSessionId: () => "host" }, sessionId: "fallback" })).toBe(
			"host",
		);
		expect(sessionIdentity({ sessionId: "fallback" })).toBe("fallback");
	});
});
