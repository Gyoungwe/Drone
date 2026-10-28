/** Published 1.x callers use the same installed source loop, with actual SDK transport only in the host. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { runKnowledgeSpecialist } from "../src/knowledge/specialist-runner";
import { packedKnowledgeAvailable, withPackedKnowledgeOwner } from "./fixtures/packed-knowledge-owner.mjs";

it.skipIf(!packedKnowledgeAvailable)(
	"borrows the installed canonical source loop for real model/read/usage and cancels before a second model step",
	async () =>
		withPackedKnowledgeOwner(async ({ prefix, session, backend, faux, vault, sourcePath }) => {
			const installed = await import(
				pathToFileURL(join(prefix, "node_modules/@gyoungwe/pi-knowledge/dist/host.mjs")).href
			);
			const port = installed.knowledgeHostLoader.load().runSpecialistModelLoop;
			expect(port).toBe(installed.runCanonicalKnowledgeSpecialist);
			const entry = backend.registry.get(session.sessionId);
			const deps = {
				runModelLoop: port,
				getRuntime: () => backend.getModelRuntime(),
				getModelPreference: async () => undefined,
			};
			const answer = {
				summary: "Only the actually assigned note supports condition A.",
				source_paths: [sourcePath],
				cautions: ["Not scientific verification."],
			};
			const usage = [];
			const readTool = {
				name: "knowledge_read",
				description: "Read the bounded assigned synthetic note",
				parameters: {
					type: "object",
					properties: { path: { type: "string" } },
					required: ["path"],
					additionalProperties: false,
				},
				async execute(input, signal) {
					signal.throwIfAborted();
					expect(input.path).toBe(sourcePath);
					return { text: await readFile(join(vault, sourcePath), "utf8") };
				},
			};
			const request = {
				role: "evidence",
				task: "Compare only the assigned note",
				packet: JSON.stringify({ source_paths: [sourcePath] }),
				parentModel: session.model,
				parentThinkingLevel: session.thinkingLevel,
				capabilities: [readTool],
				async check() {
					expect(backend.registry.get(session.sessionId)).toBe(entry);
					backend.getPluginCallerContext(session.sessionId).signal.throwIfAborted();
				},
				onUsage: (value) => usage.push(value),
				progress() {},
			};
			let privateContext;
			faux.setResponses([
				fauxAssistantMessage(
					[
						{
							type: "thinking",
							thinking: "PRIVATE_LEGACY_CANONICAL_LOOP",
							thinkingSignature: "actual-legacy-signature",
						},
						fauxToolCall("knowledge_read", { path: sourcePath }),
					],
					{ stopReason: "toolUse" },
				),
				(context) => {
					privateContext = structuredClone(context.messages);
					return fauxAssistantMessage(fauxToolCall("knowledge_submit", answer), { stopReason: "toolUse" });
				},
			]);
			const result = await runKnowledgeSpecialist(deps, request);
			expect(result.data).toEqual(answer);
			expect(usage).toHaveLength(2);
			expect(usage.every((value) => value.reported && value.reportedFields.includes("inputTokens"))).toBe(
				true,
			);
			expect(JSON.stringify(privateContext)).toContain("actual-legacy-signature");
			expect(JSON.stringify(result)).not.toContain("PRIVATE_LEGACY_CANONICAL_LOOP");
			expect(JSON.stringify(session.messages)).not.toContain("PRIVATE_LEGACY_CANONICAL_LOOP");
			const controller = new AbortController();
			let nextModel = 0;
			faux.setResponses([
				fauxAssistantMessage(fauxToolCall("knowledge_read", { path: sourcePath }), { stopReason: "toolUse" }),
				() => {
					nextModel++;
					return fauxAssistantMessage(fauxToolCall("knowledge_submit", answer), { stopReason: "toolUse" });
				},
			]);
			await expect(
				runKnowledgeSpecialist(deps, {
					...request,
					signal: controller.signal,
					capabilities: [
						{
							...readTool,
							async execute(input, signal) {
								const value = await readTool.execute(input, signal);
								controller.abort(new Error("Actual assigned read revoked"));
								return value;
							},
						},
					],
				}),
			).rejects.toThrow("Actual assigned read revoked");
			expect(nextModel).toBe(0);
			await expect(runKnowledgeSpecialist({ ...deps, runModelLoop: undefined }, request)).rejects.toThrow(
				"0.3 specialist loop capability",
			);
		}),
	120000,
);
