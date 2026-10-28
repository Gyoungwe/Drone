import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { packedKnowledgeAvailable, withPackedKnowledgeOwner } from "./fixtures/packed-knowledge-owner.mjs";

it.skipIf(!packedKnowledgeAvailable)(
	"closes a shared native knowledge owner after its first index reader closes",
	async () =>
		withPackedKnowledgeOwner(async ({ session, createSession, faux }) => {
			faux.setResponses([
				fauxAssistantMessage(fauxToolCall("research_prepare_knowledge", { query: "Orchid" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("No unchecked claims."),
			]);
			await session.prompt("Search the knowledge base Orchid");
			expect(
				session.messages.find((m) => m.role === "toolResult" && m.toolName === "research_prepare_knowledge")
					.isError,
			).toBe(false);
			for (let n = 0; n < 1; n++) {
				const other = await createSession();
				faux.setResponses([fauxAssistantMessage("Hello")]);
				await other.prompt("Hello");
			}
		}),
	120000,
);
