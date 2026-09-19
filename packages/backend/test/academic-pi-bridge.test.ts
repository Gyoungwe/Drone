import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RESEARCH_SKILL_SOURCES } from "@drone/shared";
import {
	AgentSession,
	formatSkillsForPrompt,
	loadSkills,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { makeCapabilityExtension } from "../src/capabilities/extension";
import { CapabilityResourceLoader, SkillVisibility } from "../src/capabilities/resource-loader";
import { CapabilityRuntime } from "../src/capabilities/runtime";

type Handler = (event: any, ctx: any) => any;

const packs = fileURLToPath(new URL("../../desktop/resources/research-skills/", import.meta.url));
const root = resolve(packs, "academic");
const installed = existsSync(resolve(root, ".drone-pack.json"));
// These integration tests load the authorized, hash-checked, UNMODIFIED upstream wrapper.
// Ordinary CI without an explicitly authorized ARS installation skips this suite, not the router tests.
describe.skipIf(!installed)("ARS Pi bridge with the pinned real upstream wrapper", () => {
	const allSkills = () =>
		loadSkills({
			cwd: process.cwd(),
			includeDefaults: false,
			skillPaths: RESEARCH_SKILL_SOURCES.flatMap((s) =>
				s.skills.filter((k) => k.bundled || s.id === "academic").map((k) => resolve(packs, s.id, k.path)),
			),
		}).skills;
	async function fixture(manager = SessionManager.inMemory(process.cwd()), shadow = false) {
		const skills = allSkills().map((s) =>
			shadow && s.name === "academic-paper" ? { ...s, filePath: resolve("unrelated-user-skill.md") } : s,
		);
		const visibility = new SkillVisibility();
		const loader = new CapabilityResourceLoader(
			{ getSkills: () => ({ skills, diagnostics: [] }) } as any,
			visibility,
		);
		const runtime = new CapabilityRuntime(visibility);
		let active: string[] = [];
		const tools = ["read", "bash", "write", "edit", "capability_load", "research_read_knowledge"];
		runtime.bind({
			resourceLoader: loader,
			sessionManager: manager,
			getAllTools: () => tools.map((name) => ({ name })),
			getActiveToolNames: () => active,
			setActiveToolsByName: (names: string[]) => {
				active = names.filter((n) => tools.includes(n));
			},
		} as any);
		const handlers = new Map<string, Handler[]>(),
			commands = new Map<string, any>(),
			messages: string[] = [];
		let idle = true;
		const ctx = { sessionManager: manager, ui: { notify: () => {} }, isIdle: () => idle };
		const pi: any = {
			on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
			registerCommand: (name: string, c: any) => commands.set(name, c),
			appendEntry: (type: string, data: unknown) => manager.appendCustomEntry(type, data),
			sendMessage: (m: any) => messages.push(m.content),
			getActiveTools: () => active,
			getAllTools: () => tools.map((name) => ({ name, description: name })),
			getCommands: () => [...commands.keys()].map((name) => ({ name, source: "extension" })),
			exec: async () => ({ code: 1, stdout: "", stderr: "" }),
		};
		await (makeCapabilityExtension(runtime, root) as any)(pi);
		const emit = async (name: string, event: any) => {
			let result: any;
			for (const fn of handlers.get(name) ?? []) result = (await fn(event, ctx)) ?? result;
			return result;
		};
		await emit("session_start", {});
		return {
			runtime,
			manager,
			messages,
			commands,
			loader,
			setIdle(value: boolean) {
				idle = value;
			},
			async command(name: string) {
				await commands.get(name).handler("", ctx);
			},
			async input(text: string, streaming = false) {
				const result = await emit("input", { text, streamingBehavior: streaming ? "followUp" : undefined });
				return { result, text: result?.action === "transform" ? result.text : text };
			},
			async start(text: string) {
				const input = await this.input(text);
				if (input.result?.action === "handled") return "";
				const expanded = (AgentSession.prototype as any)._expandSkillCommand.call(
					{
						resourceLoader: loader,
						_extensionRunner: {
							emitError: (e: any) => {
								throw new Error(e.error);
							},
						},
					},
					input.text,
				);
				const base = `Base\n${formatSkillsForPrompt(loader.getSkills().skills)}`;
				const changed = await emit("before_agent_start", { prompt: expanded, systemPrompt: base });
				const before = runtime.state().visibleSkills;
				await emit("message_start", {
					message: { role: "user", content: [{ type: "text", text: expanded }] },
				});
				expect(runtime.state().visibleSkills).toEqual(before);
				return changed?.systemPrompt ?? base;
			},
			emit,
		};
	}
	it("keeps inactive ARS absent and has no false daily-feed fallback", async () => {
		const f = await fixture();
		const prompt = await f.start("academic pipeline");
		expect(f.runtime.state().visibleSkills).not.toContain("academic-pipeline");
		expect(f.runtime.state().visibleSkills).not.toContain("nature-literature-pipeline");
		expect(prompt).not.toContain("Academic Research Skills compatibility for Pi");
	});
	it("adapts ars-plan on the same turn without adding other workflow owners", async () => {
		const f = await fixture();
		const prompt = await f.start("/ars-plan 写论文");
		expect(
			f.runtime
				.state()
				.visibleSkills.filter((n) => ["academic-paper", "nature-writing", "scientific-writing"].includes(n)),
		).toEqual(["academic-paper"]);
		expect(prompt).toContain("Academic Research Skills compatibility for Pi");
		expect(f.runtime.state().activeTools).not.toContain("bash");
	});
	it("does not parse future stages out of ars-full's generated command text", async () => {
		const f = await fixture();
		await f.start("/ars-full");
		expect(
			f.runtime
				.state()
				.visibleSkills.filter((n) =>
					["academic-paper", "academic-paper-reviewer", "academic-pipeline", "deep-research"].includes(n),
				),
		).toEqual(["academic-pipeline"]);
	});
	it("reviewer never activates the prefix-matched writing workflow", async () => {
		const f = await fixture();
		await f.start("/ars-reviewer");
		expect(f.runtime.state().visibleSkills).toEqual(["academic-paper-reviewer"]);
	});
	it("start selects ARS only on relevant turns and stop retracts it for continuation", async () => {
		const f = await fixture();
		await f.command("ars-pi-start");
		let prompt = await f.start("你好");
		expect(prompt).not.toContain("Academic Research Skills compatibility for Pi");
		prompt = await f.start("论文写作");
		expect(prompt).toContain("<name>academic-paper</name>");
		await f.command("ars-pi-stop");
		prompt = await f.start("继续");
		expect(f.runtime.state().visibleSkills).not.toContain("academic-paper");
		expect(prompt).not.toContain("Academic Research Skills compatibility for Pi");
	});
	it("restores ARS mode and task selection in a reopened session", async () => {
		const first = await fixture();
		await first.start("/ars-plan topic");
		const next = await fixture(first.manager);
		const prompt = await next.start("继续");
		expect(prompt).toContain("<name>academic-paper</name>");
	});
	it("follows a branch's stop state without reviving old forced skills", async () => {
		const f = await fixture();
		await f.start("/ars-plan topic");
		f.manager.appendCustomEntry("ars-pi-state", { active: false });
		await f.emit("session_tree", {});
		await f.start("继续");
		expect(f.runtime.state().visibleSkills).not.toContain("academic-paper");
	});
	it("rejects streaming workflow/mode switches rather than promising a rebuilt prompt", async () => {
		const f = await fixture();
		f.setIdle(false);
		expect((await f.input("/ars-full", true)).result.action).toBe("handled");
		await f.command("ars-pi-start");
		expect(f.messages.join(" ")).toMatch(/idle/);
		f.setIdle(true);
		await f.start("论文写作");
		expect(f.runtime.state().visibleSkills).not.toContain("academic-paper");
	});
	it("refuses names shadowed by a user skill without overwriting it", async () => {
		const f = await fixture(undefined, true);
		expect((await f.input("/ars-plan topic")).result.action).toBe("handled");
		expect(f.messages.join(" ")).toMatch(/shadowed/);
	});
	it("keeps scoped policy adaptations separate from upstream content", async () => {
		const f = await fixture();
		const prompt = await f.start("systematic review");
		expect(prompt).toContain("Compatibility override for literature-review");
		expect(prompt).toContain("does not authorize extra deliverables");
	});
	it("exposes the upstream doctor without activating ARS", async () => {
		const f = await fixture();
		await f.command("ars-pi-doctor");
		expect(f.messages.join(" ")).toContain("Claude hooks: unavailable in Pi");
		expect(await f.start("你好")).not.toContain("Academic Research Skills compatibility for Pi");
	});
});
