import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeKnowledgeServices } from "../../../.pi/lib/knowledge/service.mjs";
import * as ui from "../../../.pi/lib/knowledge/ui-service.mjs";
import { configureObsidian } from "../../../.pi/lib/obsidian-workbench.mjs";

let root, bindingRevision;
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "percho-knowledge-upgrade-ui-")));
	await mkdir(join(root, "project"));
	vi.stubEnv("PERCHO_KNOWLEDGE_DIR", join(root, "app"));
	const configured = await configureObsidian({
		cwd: join(root, "project"),
		vault: join(root, "vault"),
		project: "fixture",
	});
	bindingRevision = configured.bindingRevision;
});
afterEach(async () => {
	await closeKnowledgeServices();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});

describe("semantic/topic human UI adapters", () => {
	it("requires an explicit binding revision for writes and tests", async () => {
		await expect(ui.saveKnowledgeSemanticSettings({ config: {} })).rejects.toThrow("revisions are required");
		await expect(ui.testKnowledgeSemanticProvider({ config: {} })).rejects.toThrow("required");
	});

	it("requires a real project cwd before indexing or topic listing", async () => {
		await expect(ui.indexKnowledgeSemantic({ bindingRevision: 1, requestId: "fixture" })).rejects.toThrow(
			"cwd",
		);
		await expect(ui.getKnowledgeTopics({ bindingRevision: 1 })).rejects.toThrow("cwd");
	});

	it("rejects a stale binding before reaching the topic core", async () => {
		await expect(ui.getKnowledgeTopics({ cwd: join(root, "project"), bindingRevision: 0 })).rejects.toThrow(
			"binding changed",
		);
	});

	it("disabled semantic config makes no embedding request", async () => {
		const fetch = vi.fn(async () => {
			throw new Error("network must not be called");
		});
		vi.stubGlobal("fetch", fetch);
		const config = {
			enabled: false,
			provider: "ollama",
			baseUrl: "http://127.0.0.1:11434",
			model: "fixture-embedding",
			credentialEnv: "",
			remoteConsent: false,
		};
		const status = await ui.knowledgeSemanticStatus({ cwd: join(root, "project"), bindingRevision });
		await ui.saveKnowledgeSemanticSettings({
			config,
			bindingRevision,
			expectedSettingsRevision: status.settings.revision,
		});
		const tested = await ui.testKnowledgeSemanticProvider({ config, bindingRevision });
		expect(tested).toMatchObject({ ok: true, provider: "none", dimension: 0 });
		expect(fetch).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});
});
