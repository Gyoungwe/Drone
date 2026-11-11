import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { configureObsidian } from "@drone/extensions/internal/obsidian-workbench";
import { closeKnowledgeServices } from "@gyoungwe/pi-knowledge/host";
import { expect, it, vi } from "vitest";

const environment = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => environment.userData } }));

import { startBuiltinCore } from "./fixtures/builtin-core.mjs";
import { taskSdkExtensionPath } from "./fixtures/extension-paths.mjs";

it("real SDK delivers global navigation before model invocation in an unrelated project", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-knowledge-sdk-")));
	const a = join(root, "A"),
		b = join(root, "B");
	let host;
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	vi.stubEnv("PI_SUBAGENT_CHILD", undefined);
	try {
		await Promise.all([mkdir(a), mkdir(b)]);
		host = await startBuiltinCore({
			root,
			setUserData: (path) => {
				environment.userData = path;
			},
			backend: {
				webFetch: false,
				subagentPreferBuiltin: false,
				harness: { recall: false },
				lazyCapabilities: false,
				desktopIntegration: {
					additionalExtensionPaths: [taskSdkExtensionPath("obsidian-workbench.mjs")],
					additionalSkillPaths: [resolve("../../.pi/skills/research-vault/SKILL.md")],
				},
			},
		});
		vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "app"));
		const bound = await configureObsidian({ cwd: a, vault: join(root, "Vault"), project: "project-a" });
		const runtime = host.service.modelRuntime;
		const noNetwork = vi.spyOn(runtime, "streamSimple").mockImplementation(() => {
			throw new Error("Network not allowed");
		});
		const { session, errors } = host.attach(
			await host.service.createSession({
				cwd: b,
				provider: host.faux.provider.id,
				modelId: host.faux.getModel().id,
			}),
		);
		const resourceLoader = session.resourceLoader;
		expect(resourceLoader.getExtensions().errors).toEqual([]);
		const model = vi.spyOn(session.agent, "prompt").mockResolvedValue(undefined);
		const events = [];
		session.subscribe((event) => events.push(event));
		await session.prompt("/task-status");
		expect(model).not.toHaveBeenCalled();
		const coreNotice = `plugin-notice:${encodeURIComponent(host.core.source.pluginId)}`;
		const status = events.find(
			(event) =>
				event.type === "message_end" &&
				event.message.customType === coreNotice &&
				event.message.details?.taskView,
		);
		expect(status?.message).toMatchObject({ role: "custom", display: true });
		expect(status.message.content).toContain("还没有任务记录");
		expect(
			session.messages.some((message) => message.customType === coreNotice && message.details?.taskView),
		).toBe(true);
		await session.prompt("请先了解当前知识库，再解释研究流程。", { expandPromptTemplates: false });
		expect(model).toHaveBeenCalledOnce();
		const payload = JSON.stringify(model.mock.calls[0][0]);
		expect(payload).toContain("drone-knowledge-navigation");
		expect(payload).toContain("drone-task-context");
		expect(payload).toContain("Wiki/Index.md");
		// Navigation embeds JSON inside a custom message; decode it before comparing paths.
		const navigation = model.mock.calls[0][0].find(
			(message) => message.customType === "drone-knowledge-navigation",
		);
		expect(navigation).toBeDefined();
		const content = navigation.content;
		expect(JSON.parse(content.slice(content.indexOf("\n") + 1)).binding.vault).toBe(bound.vault);
		expect(payload).not.toContain('"ticket"');
		expect(session.getActiveToolNames()).toContain("research_search_knowledge");
		expect(errors).toEqual([]);
		expect(noNetwork).not.toHaveBeenCalled();
	} finally {
		await closeKnowledgeServices();
		await host?.close();
	}
});
