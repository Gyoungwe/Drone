import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { turnRouteLines } from "@drone/shared";
import { describe, expect, it } from "vitest";
import { makeCapabilityExtension } from "../src/capabilities/extension";
import { CapabilityResourceLoader, SkillVisibility } from "../src/capabilities/resource-loader";
import { CapabilityRuntime } from "../src/capabilities/runtime";

function skill(name: string) {
	return {
		name,
		description: name,
		filePath: `/skills/${name}/SKILL.md`,
		baseDir: `/skills/${name}`,
		disableModelInvocation: false,
		sourceInfo: { source: "test", scope: "temporary" },
	};
}
function loader(names: string[]) {
	const skills = names.map(skill);
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime: { flagValues: new Map() } }),
		getSkills: () => ({ skills, diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getSystemPromptSource: () => undefined,
		getAppendSystemPrompt: () => [],
		getAppendSystemPromptSources: () => [],
		extendResources: () => undefined,
		reload: async () => undefined,
	} as any;
}
function session(names: string[], book?: unknown) {
	const tools = [
		{ name: "read", description: "read", parameters: {} },
		{ name: "ask_user", description: "ask", parameters: {} },
	];
	let active = tools.map((tool) => tool.name);
	const cwd = "/tmp/drone-route";
	return {
		resourceLoader: new CapabilityResourceLoader(loader(names), new SkillVisibility()),
		getAllTools: () => tools,
		getActiveToolNames: () => [...active],
		setActiveToolsByName: (next: string[]) => {
			active = next.filter((name) => tools.some((tool) => tool.name === name));
		},
		...(book
			? {
					sessionManager: {
						getSessionId: () => "s1",
						getCwd: () => cwd,
						appendCustomEntry: () => undefined,
						getBranch: () => [
							{
								type: "custom",
								customType: "drone-task-workbench-v2",
								data: {
									scope: createHash("sha256")
										.update(`s1\0${resolve(cwd)}`)
										.digest("hex"),
									activeTaskId: "t1",
									limits: { stageCalls: 48, totalCalls: 192 },
									tasks: [book],
								},
							},
						],
					},
				}
			: {}),
	};
}
function runtime(names: string[], book?: unknown) {
	const visibility = new SkillVisibility();
	const runtime = new CapabilityRuntime(visibility);
	const bound = session(names, book);
	bound.resourceLoader = new CapabilityResourceLoader(loader(names), visibility);
	runtime.bind(bound as any);
	return runtime;
}
const stuck = {
	id: "t1",
	planApproved: true,
	state: "waiting_user",
	reason: "stage-budget",
	capabilities: ["research"],
	progressCount: 46,
	stageStartProgress: 16,
	budget: { calls: 76, stageCalls: 48 },
	actions: [{ kind: "review", state: "pending", milestoneId: null }],
	milestones: [{ id: "left", state: "pending", acceptance: { kind: "file" } }],
};

describe("describeTurn", () => {
	it("selects the first installed search skill for a new paper query", () => {
		const routeRuntime = runtime(["nature-academic-search", "paper-lookup", "research-lookup"]);
		routeRuntime.prepareForPrompt("检索灰飞虱性别决定论文", false);
		const route = routeRuntime.describeTurn("检索灰飞虱性别决定论文");
		expect(route).toMatchObject({
			intake: "new-topic",
			stage: "search",
			direction: "evidence",
			primary: "nature-academic-search",
			reason: "topic:search",
			landing: "workflow",
			academic: false,
			visiblePrimary: true,
			host: null,
		});
		expect(route.capabilities).toContain("research");
		const onlyPaper = runtime(["paper-lookup"]);
		onlyPaper.prepareForPrompt("检索灰飞虱性别决定论文", false);
		expect(onlyPaper.describeTurn("检索灰飞虱性别决定论文").primary).toBe("paper-lookup");
		expect(turnRouteLines(route).lines.join("\n")).not.toBe(
			turnRouteLines(onlyPaper.describeTurn("检索灰飞虱性别决定论文")).lines.join("\n"),
		);
	});

	it("keeps the checkpoint and tells continue apart from a status question", () => {
		const routeRuntime = runtime(["nature-academic-search"], stuck);
		routeRuntime.prepareForPrompt("继续做完", false);
		const continued = routeRuntime.describeTurn("继续做完");
		expect(continued).toMatchObject({
			intake: "continuation",
			keptCheckpoint: true,
			deferPhrase: true,
			landing: "host-gate",
			primary: null,
		});
		expect(continued.host).toMatchObject({
			pendingReview: true,
			reviewLinked: false,
			stageLimited: true,
			hasProgress: true,
			reason: "stage-budget",
		});
		routeRuntime.prepareForPrompt("进度如何", false);
		const status = routeRuntime.describeTurn("进度如何");
		expect(status.deferPhrase).toBe(false);
		expect(status.intake).toBe("status");
		expect(status.host?.pendingReview).toBe(true);
		expect(turnRouteLines(continued).lines.join("\n")).toContain("阶段步数会放开");
		expect(turnRouteLines(status).lines.join("\n")).toContain("阶段配额不会放开");
	});

	it("writes a fresh explanation for each user turn", async () => {
		const routeRuntime = runtime(["nature-academic-search", "paper-lookup"]);
		const handlers = new Map<string, (event: any, ctx?: any) => unknown>();
		const sent: Array<{ customType?: string; details?: { route?: unknown } }> = [];
		await makeCapabilityExtension(routeRuntime)({
			on: (name: string, handler: (event: any, ctx?: any) => unknown) => handlers.set(name, handler),
			sendMessage: async (message: { customType?: string; details?: { route?: unknown } }) => {
				sent.push(message);
			},
		} as any);
		await handlers.get("input")?.({ type: "input", text: "检索灰飞虱性别决定论文", source: "interactive" });
		await handlers.get("before_agent_start")?.({ systemPrompt: "base" });
		await handlers.get("before_agent_start")?.({ systemPrompt: "base" });
		await handlers.get("input")?.({ type: "input", text: "你好", source: "interactive" });
		await handlers.get("before_agent_start")?.({ systemPrompt: "base" });
		expect(sent.map((message) => message.customType)).toEqual(["drone-turn-route", "drone-turn-route"]);
		const [search, hello] = sent.map((message) =>
			turnRouteLines(message.details?.route as any).lines.join("\n"),
		);
		expect(search).toContain("nature-academic-search");
		expect(search).toContain("文献发现");
		expect(hello).not.toContain("nature-academic-search");
		expect(hello).not.toBe(search);
	});
});
