/** Same-tar production knowledge workflow; all files and models are synthetic. */
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { packedKnowledgeAvailable, withPackedKnowledgeOwner } from "./fixtures/packed-knowledge-owner.mjs";

it.skipIf(!packedKnowledgeAvailable)(
	"installs one exact package and runs real prepare/read/search/delegate/check/publication with actual scoped worker and SQLite ownership",
	async () =>
		withPackedKnowledgeOwner(
			async ({
				root,
				state,
				source,
				sourcePath,
				answer,
				faux,
				backend,
				bootstrap,
				session,
				engine,
				approvals,
				modelSteps,
				calls,
				errors,
				deliveries,
				publicEvents,
				tarball,
				apiTarball,
				sha256,
			}) => {
				const tool = (name, input) =>
					fauxAssistantMessage(fauxToolCall(name, input), { stopReason: "toolUse" });
				const signed = {
					type: "thinking",
					thinking: "PRIVATE_PARENT_PROTOCOL",
					thinkingSignature: "actual-parent-signature",
				};
				let restoredProtocol;
				faux.setResponses([
					fauxAssistantMessage(
						[
							signed,
							{ type: "text", text: "PRIVATE_TOOL_PREFACE" },
							fauxToolCall("research_prepare_knowledge", { query: "Orchid condition A" }),
						],
						{ stopReason: "toolUse" },
					),
					(context) => {
						restoredProtocol = structuredClone(
							context.messages.find(
								(message) =>
									message.role === "assistant" && message.content.some((block) => block.type === "toolCall"),
							),
						);
						return tool("research_read_knowledge", { path: "Wiki/Orchid.md" });
					},
					tool("research_search_knowledge", { query: "Orchid" }),
					tool("research_read_knowledge", { path: sourcePath }),
					tool("research_delegate_knowledge", {
						role: "evidence",
						task: "Describe only assigned method scope",
						source_paths: [sourcePath],
					}),
					fauxAssistantMessage(
						[
							{
								type: "thinking",
								thinking: "PRIVATE_CHILD_THINKING",
								thinkingSignature: "actual-child-signature",
							},
							fauxToolCall("knowledge_read", { path: sourcePath }),
						],
						{ stopReason: "toolUse" },
					),
					tool("knowledge_submit", {
						summary: "The assigned note only supports condition A.",
						source_paths: [sourcePath],
						cautions: ["No other conditions were measured."],
					}),
					tool("research_check_answer", { draft: answer }),
					fauxAssistantMessage(answer),
				]);
				await session.prompt("知识库 Orchid 方法条件 A 说明，使用本地资料，并请证据整理员核对适用范围。");
				await session.waitForIdle();
				expect(errors).toEqual([]);
				expect(restoredProtocol.content[0]).toEqual(signed);
				expect(restoredProtocol.content.some((block) => block.text === "PRIVATE_TOOL_PREFACE")).toBe(true);
				expect(JSON.stringify(publicEvents)).not.toMatch(
					/PRIVATE_PARENT_PROTOCOL|PRIVATE_TOOL_PREFACE|PRIVATE_CHILD_THINKING/,
				);
				expect(JSON.stringify(session.messages)).not.toMatch(
					/PRIVATE_PARENT_PROTOCOL|PRIVATE_TOOL_PREFACE|PRIVATE_CHILD_THINKING/,
				);
				const results = session.messages.filter((message) => message.role === "toolResult");
				for (const name of [
					"research_prepare_knowledge",
					"research_read_knowledge",
					"research_search_knowledge",
					"research_delegate_knowledge",
					"research_check_answer",
				])
					expect(
						results.some((result) => result.toolName === name) &&
							results.filter((result) => result.toolName === name).every((result) => !result.isError),
						JSON.stringify(results),
					).toBe(true);
				expect(
					results.find((result) => result.toolName === "research_delegate_knowledge").details,
				).toMatchObject({ status: "completed", role: "evidence", usageReported: true });
				expect(modelSteps).toHaveLength(2);
				expect(
					modelSteps.every((step) => step.toolNames.join(",") === "knowledge_read,knowledge_submit"),
				).toBe(true);
				const final = deliveries.at(-1);
				expect(final.knowledgePublication).toMatchObject({
					status: "released",
					scientificallyVerified: false,
				});
				expect(final.content).toEqual([{ type: "text", text: answer }]);
				const persisted = session.sessionManager.getBranch();
				expect(
					persisted.findLast((entry) => entry.type === "message" && entry.message.role === "assistant")
						.message,
				).toEqual(final);
				expect(
					persisted.some(
						(entry) =>
							entry.type === "custom" &&
							entry.customType ===
								`plugin-record:${encodeURIComponent(source.pluginId)}:drone-knowledge-recovery-v1`,
					),
				).toBe(true);
				expect(JSON.parse(await readFile(join(state, "answer-metrics.json"), "utf8"))).toMatchObject({
					answered: 1,
					total: 1,
					rate: 1,
				});
				expect(publicEvents.some((event) => event.type === "message_update")).toBe(false);
				expect(
					publicEvents.findLast((event) => event.type === "message_end" && event.message.role === "assistant")
						.message.content,
				).toEqual(final.content);
				const polled = await backend.getSessionMessages(session.sessionId);
				expect(polled.at(-1).text).toContain(answer);
				expect(JSON.stringify(polled)).not.toMatch(
					/PRIVATE_PARENT_PROTOCOL|PRIVATE_TOOL_PREFACE|PRIVATE_CHILD_THINKING/,
				);
				const live = session.messages;
				const historical = live.filter((message) => {
					const origin = engine.historicalMessageOrigin(session, message);
					return origin && JSON.stringify(origin.message) === JSON.stringify(message);
				});
				const displayed = await bootstrap.delivery.snapshot(live, historical);
				expect(displayed.at(-1).content).toEqual(final.content);
				const copied = structuredClone(live.at(-1));
				expect(engine.historicalMessageOrigin(session, copied)).toBeUndefined();
				expect((await bootstrap.delivery.snapshot([copied], [])).at(-1).content).not.toEqual(final.content);
				await session.reload();
				expect(errors).toEqual([]);
				const restored = session.messages;
				const genuine = restored.filter((message) => {
					const origin = engine.historicalMessageOrigin(session, message);
					return origin && JSON.stringify(origin.message) === JSON.stringify(message);
				});
				expect((await bootstrap.delivery.snapshot(restored, genuine)).at(-1).content).toEqual(final.content);
				expect(
					bootstrap.delivery.projectEvent({ type: "message_end", message: copied }).message.content,
				).not.toEqual(final.content);
				const realJsonlExport = session.exportToJsonlForHost.bind(session);
				vi.spyOn(session, "exportToJsonlForHost").mockImplementation(() =>
					realJsonlExport(join(root, "checked.jsonl")),
				);
				const jsonlPath = await backend.exportSession(session.sessionId, "jsonl");
				const exported = await readFile(jsonlPath, "utf8");
				expect(exported).toContain(answer);
				expect(exported).not.toMatch(/PRIVATE_PARENT_PROTOCOL|PRIVATE_TOOL_PREFACE|PRIVATE_CHILD_THINKING/);
				await rm(jsonlPath);
				expect(approvals).toContain("capability:model.toolStep");
				expect(
					calls
						.filter((call) => call.name === "model.toolStep")
						.every((call) => call.session === session.sessionId),
				).toBe(true);
				console.log(
					JSON.stringify({
						scope: "same-tar knowledge publication candidate",
						packageSha256: sha256(await readFile(tarball)),
						apiSha256: sha256(await readFile(apiTarball)),
						modelSteps: modelSteps.length,
						tools: results.map((result) => ({ name: result.toolName, error: !!result.isError })),
						finalStatus: final.knowledgePublication.status,
						scientificVerification: false,
						fullP2: "INCOMPLETE: offline/full-tree history, service composition and formal installer remain",
					}),
				);
			},
		),
	120000,
);
