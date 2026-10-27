import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureObsidian } from "@drone/extensions/internal/obsidian-workbench";
import { fauxToolCall as call, fauxProvider, fauxAssistantMessage as reply } from "@earendil-works/pi-ai";
import { getCurrentSystemPrompt } from "@earendil-works/pi-ai/utils/transcript";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	closeKnowledgeServices,
	flowFor,
	getKnowledgeService,
	listWikiProposals,
	registerKnowledgeSpecialistHost,
} from "@gyoungwe/pi-knowledge/host";
import { afterEach, expect, it, vi } from "vitest";
import { makeKnowledgeSpecialistBridge } from "../src/knowledge/specialist-bridge";
import { taskSdkExtensionPath } from "./fixtures/task-plugin.mjs";

let root, session;
afterEach(async () => {
	session?.dispose();
	session = undefined;
	await closeKnowledgeServices();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	if (root) await rm(root, { recursive: true, force: true });
});
const tool = (name, args) => reply([call(name, args)], { stopReason: "toolUse" });
it.each(["reviewed", "malformed-review", "unsupported-review", "source-changed"])(
	"real SDK research delivery %s preserves the evidence gate and specialist stages",
	async (mode) => {
		root = await realpath(await mkdtemp(join(tmpdir(), "drone-specialists-sdk-")));
		const cwd = join(root, "project"),
			vault = join(root, "Vault"),
			agentDir = join(root, "agent");
		await mkdir(cwd);
		await mkdir(agentDir);
		vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "app"));
		vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
		vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
		vi.stubEnv("PI_SUBAGENT_CHILD", undefined);
		await configureObsidian({ cwd, vault, project: "project-a" });
		const write = async (path, text) => {
			await mkdir(join(vault, path, ".."), { recursive: true });
			await writeFile(join(vault, path), text);
		};
		const source = "Library/Papers/a.md",
			second = "Library/Papers/b.md";
		await write("Wiki/Index.md", "# Wiki\n[[Wiki/topic]]\n");
		await write("Wiki/topic.md", "# Topic\n[[Library/Papers/a]]\n");
		await write(
			source,
			"# Evidence A\nAuthor observation under limited experimental conditions.\n10.1038/fixturea\nzotero:ABCDEFGH",
		);
		await write(
			second,
			"# Evidence B\nAlternative method; not directly comparable.\n10.1038/fixtureb\nzotero:IJKLMNOP",
		);
		vi.stubGlobal("fetch", async (url) => {
			expect(String(url)).toMatch(/^http:\/\/127\.0\.0\.1:23119\/api\/users\/0\/items\//);
			return {
				ok: true,
				json: async () =>
					String(url).endsWith("/children")
						? []
						: {
								data: { DOI: String(url).includes("ABCDEFGH") ? "10.1038/fixturea" : "10.1038/fixtureb" },
							},
			};
		});
		const service = await getKnowledgeService();
		await service.request("reconcile");
		let run;
		const skill = join(root, "show-me/SKILL.md");
		await mkdir(join(root, "show-me"));
		await writeFile(
			skill,
			"---\nname: show-me\ndescription: Fixture presentation skill\n---\n# Show Me\nUse static HTML and source links; disclose uncertainty.\n",
		);
		// These ambient files must never enter specialist requests.
		await writeFile(join(cwd, "AGENTS.md"), "AMBIENT_PROJECT_SECRET");
		const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
		const runtime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: null,
			modelsStorePath: join(agentDir, "cache.json"),
			allowModelNetwork: false,
			refreshOnCreate: false,
		});
		const faux = fauxProvider({ provider: "specialist-fixture" });
		runtime.registerNativeProvider(faux.provider);
		vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			noExtensions: true,
			additionalExtensionPaths: [
				taskSdkExtensionPath("obsidian-workbench.mjs"),
				taskSdkExtensionPath("workspace-config.mjs"),
				taskSdkExtensionPath("research-loop.mjs"),
				taskSdkExtensionPath("source-archive.mjs"),
			],
			additionalSkillPaths: [skill],
			extensionFactories: [
				makeKnowledgeSpecialistBridge({
					getRuntime: async () => runtime,
					getModelPreference: async () => undefined,
					registerKnowledgeSpecialistHost,
				}),
			],
		});
		await loader.reload();
		expect(loader.getExtensions().errors).toEqual([]);
		({ session } = await createAgentSession({
			cwd,
			agentDir,
			modelRuntime: runtime,
			model: faux.getModel(),
			resourceLoader: loader,
			settingsManager,
			sessionManager: SessionManager.inMemory(cwd),
		}));
		const errors = [];
		await session.bindExtensions({ onError: (e) => errors.push(e) });
		let summaryReviews = 0;
		const counts = {},
			childRequests = [],
			parentRequests = [];
		const long =
			"The studies investigate different designs. Findings require the original sources, version checks, and explicit scope. The current notes do not establish a universal performance ordering. ".repeat(
				2,
			);
		const router = async (context) => {
			if (getCurrentSystemPrompt(context.messages || []).startsWith("You are research-summary-reviewer.")) {
				summaryReviews++;
				expect(JSON.stringify(context)).not.toContain("PARENT_HISTORY_SECRET");
				expect(JSON.stringify(context)).not.toContain("AMBIENT_PROJECT_SECRET");
				if (mode === "malformed-review") return reply("No structured assessment");
				if (mode === "source-changed") await writeFile(join(vault, source), "Changed while reviewing");
				const packet = JSON.parse(
					context.messages.find((message) => message.role === "user").content[0].text,
				);
				const references = packet.claims.flatMap((claim) =>
					claim.sources.map((source) => ({
						path: source.path,
						sha256: source.hash,
						readReceiptId: source.read_receipt_id,
						startLine: source.start_line,
						endLine: source.end_line,
					})),
				);
				return tool("submit_summary_review", {
					packetSha256: packet.packetSha256,
					bodySha256: packet.bodySha256,
					provider: "model-spoof",
					model: "model-spoof",
					blocks: packet.blocks.map((block) => ({
						blockId: block.blockId,
						role: "claim",
						assessment: mode === "unsupported-review" ? "unknown" : "supported",
						claimIds: packet.claims.map((claim) => claim.id),
						evidence: references,
						reason: "Synthetic scope-preserving model assessment; not scientific verification.",
					})),
					memoryClaims: packet.memoryClaims.map((claim) => ({
						bindingId: claim.bindingId,
						memoryClaimSha256: claim.memoryClaimSha256,
						assessment: mode === "unsupported-review" ? "unknown" : "supported",
						evidence: references.filter((reference) => reference.path === claim.sourcePath),
						reason: "Exact synthetic source scope retained.",
					})),
				});
			}
			const role = getCurrentSystemPrompt(context.messages || []).match(
				/^You are knowledge-(navigator|evidence-curator|wiki-editor|explainer),/,
			)?.[1];
			const n = counts[role || "parent"] || 0;
			counts[role || "parent"] = n + 1;
			if (role) {
				childRequests.push(JSON.parse(JSON.stringify(context)));
				expect(JSON.stringify(context)).not.toContain("AMBIENT_PROJECT_SECRET");
				expect(JSON.stringify(context)).not.toContain("PARENT_HISTORY_SECRET");
				const submitted = {
					summary: "Unverified, source-scoped handoff.",
					source_paths: [source, second],
					cautions: ["Underlying original papers still require verification."],
				};
				if (role === "navigator")
					return [
						tool("knowledge_read", { path: "Wiki/topic.md" }),
						tool("knowledge_search", { query: "Evidence" }),
						reply([call("knowledge_read", { path: source }), call("knowledge_read", { path: second })], {
							stopReason: "toolUse",
						}),
						tool("knowledge_submit", submitted),
					][n];
				if (role === "wiki-editor")
					return tool("knowledge_submit", {
						...submitted,
						title: "Topic",
						markdown: `## Current understanding\n${long}`,
					});
				if (role === "explainer")
					return tool("knowledge_submit", {
						...submitted,
						title: "Evidence comparison",
						html: "<!doctype html><html><body><h1>Comparison</h1><details><summary>Methods</summary>Different methods; not locally tested.</details></body></html>",
					});
				return tool("knowledge_submit", submitted);
			}
			parentRequests.push(JSON.parse(JSON.stringify(context)));
			if (n === 7) {
				// File watcher debounce is real; only fixtures skip provider latency. Wait for queued writes, not a weaker publication rule.
				await new Promise((resolve) => setTimeout(resolve, 220));
				await vi.waitFor(async () => expect((await service.request("status")).pendingChanges).toBe(0));
			}
			const finalDraft = `Checked final reply with bounded sources. [[Library/Papers/a]] [[Library/Papers/b]]\nDeliverables: [[Library/Explainers/topic]] [[Projects/project-a/Runs/topic-${run?.split("/").at(-1)}]]`;
			const started = session.messages.find(
				(message) =>
					message.role === "toolResult" && message.toolName === "research_loop" && message.details?.run_dir,
			);
			if (started) run = started.details.run_dir;
			const completed = session.messages.findLast(
				(message) =>
					message.role === "toolResult" &&
					message.toolName === "research_loop" &&
					message.details?.evidence_gate?.answerable,
			);
			return [
				tool("research_loop", {
					action: "start",
					query: "Compare the two bounded fixture observations",
					result_slug: "topic",
				}),
				tool("research_read_knowledge", { path: "Wiki/topic.md" }),
				tool("research_search_knowledge", { query: "Evidence" }),
				reply(
					[
						call("research_read_knowledge", { path: source }),
						call("research_read_knowledge", { path: second }),
					],
					{ stopReason: "toolUse" },
				),
				reply(
					[
						call("research_verify_literature", {
							doi: "10.1038/fixturea",
							zotero_key: "ABCDEFGH",
							note_path: source,
						}),
						call("research_verify_literature", {
							doi: "10.1038/fixtureb",
							zotero_key: "IJKLMNOP",
							note_path: second,
						}),
					],
					{ stopReason: "toolUse" },
				),
				tool("research_loop", {
					action: "complete",
					run_dir: run,
					claim_bindings: [
						{
							claim: "Author observation under limited experimental conditions.",
							relationship: "direct",
							limitations: "Synthetic note observation only; original papers not read.",
							sources: [
								{
									path: source,
									start_line: 2,
									end_line: 2,
									quote: "Author observation under limited experimental conditions.",
								},
							],
						},
						{
							claim: "Alternative method; not directly comparable.",
							relationship: "direct",
							limitations: "Synthetic note observation only; original papers not read.",
							sources: [
								{
									path: second,
									start_line: 2,
									end_line: 2,
									quote: "Alternative method; not directly comparable.",
								},
							],
						},
					],
				}),
				tool("research_summarize_run", {
					run_dir: run,
					result_slug: "topic",
					summary_markdown: `# Evidence comparison\n\n${long}`,
					claims: completed?.details.evidence_gate.claim_bindings.map((claim) => ({
						bindingId: claim.id,
						claim: claim.claim,
						subject: "synthetic source note",
						predicate: "reports a bounded observation",
						sourcePath: claim.sources[0].path,
						sourceHash: claim.sources[0].hash,
						relation: "observation",
					})),
				}),
				tool("research_search_knowledge", { query: "Evidence" }),
				tool("research_check_answer", { draft: finalDraft }),
				reply(finalDraft),
			][n];
		};
		faux.setResponses(Array.from({ length: 20 }, () => router));
		session.agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "PARENT_HISTORY_SECRET" }], timestamp: 1 },
		];
		await session.prompt("比较并介绍这两篇论文，使用 Show Me 讲解，然后保存研究摘要。", {
			expandPromptTemplates: false,
		});
		expect(errors).toEqual([]);
		expect(summaryReviews).toBe(1);
		const summarized = session.messages.find(
			(message) => message.role === "toolResult" && message.toolName === "research_summarize_run",
		);
		if (mode !== "reviewed") {
			expect(summarized.isError).toBe(true);
			expect(summarized.details?.delivery_receipt).toBeUndefined();
			await expect(readFile(join(run, "SUMMARY.md"))).rejects.toMatchObject({ code: "ENOENT" });
			expect(counts.explainer).toBeUndefined();
			expect(counts["wiki-editor"]).toBeUndefined();
			return;
		}
		expect(summarized.isError).toBe(false);
		expect(summarized.details.delivery_receipt.semanticAssessment).toMatchObject({
			status: "model-assessed",
			provider: faux.provider.id,
			model: faux.getModel().id,
		});
		expect(summarized.details.delivery_receipt.scientificallyVerified).toBe(false);
		expect(summarized.details.claims).toHaveLength(2);
		const receipt = summarized.details.delivery_receipt;
		const metadata = JSON.parse(await readFile(join(run, "metadata.json"), "utf8"));
		// Later search receipts may advance the run revision after delivery committed.
		expect(metadata.revision).toBeGreaterThanOrEqual(receipt.committedRevision);
		expect(metadata.delivery_receipt.id).toBe(receipt.id);
		for (const copy of receipt.copies) {
			expect(
				createHash("sha256")
					.update(await readFile(copy.path))
					.digest("hex"),
			).toBe(copy.artifactSha256);
		}
		expect(receipt.copies.map((copy) => copy.role)).toEqual(["run", "latest", "history", "vault"]);
		expect(Object.keys(counts).sort()).toEqual([
			"evidence-curator",
			"explainer",
			"navigator",
			"parent",
			"wiki-editor",
		]);
		expect(counts.navigator).toBe(4);
		expect(counts["evidence-curator"]).toBe(1);
		expect(counts.explainer).toBe(1);
		expect(counts["wiki-editor"]).toBe(1);
		expect(JSON.stringify(parentRequests[0])).toContain("Unverified specialist handoff");
		expect(JSON.stringify(parentRequests[0])).not.toContain("knowledge_submit");
		expect(JSON.stringify(parentRequests)).not.toContain("<!doctype html>");
		const final = session.messages.filter((m) => m.role === "assistant").at(-1);
		const preflight = session.messages.find(
			(m) => m.role === "toolResult" && m.toolName === "research_check_answer",
		);
		expect(preflight.details.ok).toBe(true);
		expect(final.knowledgePublication.deliveries).toHaveLength(2);
		expect(final.knowledgePublication.status).toBe("released");
		expect(JSON.stringify(final)).toContain("Checked final reply");
		expect(JSON.stringify(final)).toContain("待审核");
		const proposals = await listWikiProposals(service, "project-a");
		expect(proposals.items).toHaveLength(1);
		expect(await readFile(join(vault, "Library/Explainers/topic.md"), "utf8")).toContain("展示层");
		const rows = flowFor(session.sessionId).specialists;
		expect(rows).toHaveLength(4);
		expect(rows.every((r) => r.status === "completed")).toBe(true);
		expect(JSON.stringify(rows)).not.toContain("PARENT_HISTORY_SECRET");
	},
	30000,
);
