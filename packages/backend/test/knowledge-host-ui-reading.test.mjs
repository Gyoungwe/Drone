import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { closeKnowledgeServices } from "@gyoungwe/pi-knowledge/host";
import { build } from "esbuild";
import { expect, it, vi } from "vitest";
import { configureBackendKnowledgeWorker, KnowledgeUiService } from "../src/knowledge/ui";
import { defaultKnowledgeCompatibility, defaultKnowledgeRuntimeSetup } from "./knowledge-compat-fixture";

it("keeps the UI service free of the package compatibility import", async () => {
	const uiSource = await readFile(new URL("../src/knowledge/ui.ts", import.meta.url), "utf8");
	const compatibilitySource = await readFile(
		new URL("./knowledge-compat-fixture.ts", import.meta.url),
		"utf8",
	);
	expect(uiSource).not.toContain("@gyoungwe/pi-knowledge/host");
	expect(compatibilitySource).toContain('from "@gyoungwe/pi-knowledge/host"');
});

it("reads a project-owned note through the backend after setup in an independently bundled extension", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-host-note-")));
	const cwd = join(root, "project");
	const vault = join(root, "vault");
	const bundle = join(root, "obsidian.mjs");
	await build({
		entryPoints: [createRequire(import.meta.url).resolve("@drone/extensions/obsidian-workbench")],
		outfile: bundle,
		bundle: true,
		platform: "node",
		format: "esm",
		logLevel: "silent",
	});
	const {
		configureObsidian,
		depositKnowledge,
		closeKnowledgeServices: closeExtensionServices,
	} = await import(/* @vite-ignore */ pathToFileURL(bundle).href);
	const ui = new KnowledgeUiService(undefined, { compatibility: defaultKnowledgeCompatibility });
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "knowledge"));
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	try {
		configureBackendKnowledgeWorker(defaultKnowledgeRuntimeSetup);
		await mkdir(cwd);
		const setup = await configureObsidian({ cwd, vault, project: "reading-test" });
		const saved = await depositKnowledge({
			cwd,
			project: "reading-test",
			type: "method",
			title: "GUI read-back",
			markdown: "A draft observation with unresolved scientific review.",
			status: "draft",
		});
		const page = await ui.read({
			cwd,
			path: "Library/Methods/gui-read-back.md",
			revision: setup.bindingRevision,
		});
		expect(page.text).toBe(await readFile(saved.note, "utf8"));
		expect(page.text).toContain('status: "draft"');
		expect(page.hash).toMatch(/^[a-f0-9]{64}$/);
	} finally {
		ui.dispose();
		await closeKnowledgeServices();
		await closeExtensionServices();
		vi.unstubAllEnvs();
		await rm(root, { recursive: true, force: true });
	}
});
