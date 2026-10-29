/** Explicit migration through the actual installed source. Synthetic legacy records have unknown provenance. */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { packedKnowledgeAvailable, withPackedKnowledgeOwner } from "./fixtures/packed-knowledge-owner.mjs";

const type = "drone-knowledge-recovery-v1";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
it.skipIf(!packedKnowledgeAvailable)(
	"runs the explicit recovery migration with actual per-operation approval, scope, durable readback, consumed flags and cancellation",
	async () =>
		withPackedKnowledgeOwner(
			async ({
				session,
				createSession,
				workspace,
				vault,
				source,
				backend,
				faux,
				approvals,
				modelSteps,
				setApprove,
			}) => {
				const ownType = `plugin-record:${encodeURIComponent(source.pluginId)}:${type}`;
				const ownRows = (target) =>
					target.sessionManager
						.getBranch()
						.filter((entry) => entry.type === "custom" && entry.customType === ownType);
				const migrate = (target) => backend.command(target.sessionId, "knowledge-migrate-recovery");
				expect(source.recordAdoptions).toEqual({
					[type]: { legacyType: type, fromVersions: ["0.2.0", "0.2.1"], removeBeforeVersion: "0.4.0" },
				});
				await expect(migrate(session)).rejects.toThrow("durable session storage");
				expect(ownRows(session)).toEqual([]);
				faux.setResponses([fauxAssistantMessage("Hello from a synthetic offline session.")]);
				await session.prompt("Hello");
				const data = {
					scope: `${session.sessionId}:${resolve(workspace)}`,
					records: [
						{
							id: "legacy-consumed-window",
							sessionId: session.sessionId,
							taskId: null,
							path: "Library/Methods/orchid.md",
							hash: "a".repeat(64),
							startLine: 1,
							maxChars: 5000,
							vaultId: sha256(vault).slice(0, 24),
							bindingRevision: 1,
							evicted: true,
							used: true,
						},
					],
				};
				session.sessionManager.appendCustomEntry(type, {
					scope: data.scope,
					records: [{ ...data.records[0], hash: "not-a-hash" }],
				});
				await expect(migrate(session)).rejects.toThrow("Invalid knowledge recovery checkpoint");
				expect(ownRows(session)).toEqual([]);
				session.sessionManager.appendCustomEntry(type, {
					...data,
					scope: "another-session:/different-workspace",
				});
				await expect(migrate(session)).rejects.toThrow("does not match");
				expect(ownRows(session)).toEqual([]);
				session.sessionManager.appendCustomEntry(type, {
					...data,
					records: [{ ...data.records[0], bindingRevision: 2 }],
				});
				await expect(migrate(session)).rejects.toThrow("does not match");
				expect(ownRows(session)).toEqual([]);
				const candidateId = session.sessionManager.appendCustomEntry(type, {
					...data,
					approved: true,
					roots: ["/unapproved"],
					publicationProof: { status: "released" },
					records: [
						{ ...data.records[0], approved: true, grants: ["/unapproved"], liveProof: { id: "copied" } },
					],
				});
				const receipt = await migrate(session);
				expect(receipt).toEqual({ kind: "command" });
				const imported = ownRows(session).at(-1);
				expect(imported.data).toEqual({
					scope: data.scope,
					records: [{ ...data.records[0], evicted: false }],
				});
				expect(JSON.stringify(imported)).not.toMatch(/approved|grants|roots|Proof|unapproved/);
				expect(session.sessionManager.getBranch().some((entry) => entry.id === candidateId)).toBe(true);
				const notice = session.messages
					.filter((message) => message.role === "custom" && message.customType.startsWith("plugin-notice:"))
					.at(-1);
				expect(JSON.parse(notice.content)).toMatchObject({
					state: "adopted",
					records: 1,
					creator: "unknown",
					packageVersion: "unknown",
					currentReadProof: false,
				});
				expect(approvals).toContain("capability:session.records.adoption.inspect");
				expect(approvals).toContain("capability:session.records.adoption.commit");
				const previous = approvals.filter((operation) =>
					operation?.startsWith("capability:session.records.adoption"),
				).length;
				await migrate(session);
				expect(ownRows(session)).toHaveLength(1);
				expect(
					approvals.filter((operation) => operation?.startsWith("capability:session.records.adoption"))
						.length,
				).toBe(previous);
				expect(modelSteps).toHaveLength(0);
				faux.setResponses([
					fauxAssistantMessage(
						fauxToolCall("research_restore_evidence", { receipt_id: data.records[0].id }),
						{ stopReason: "toolUse" },
					),
					fauxAssistantMessage("The historical window was not restored."),
				]);
				await session.prompt("Restore the stored knowledge evidence window");
				const restored = session.messages.findLast(
					(message) => message.role === "toolResult" && message.toolName === "research_restore_evidence",
				);
				expect(restored.isError).toBe(true);
				expect(JSON.stringify(restored.content)).toContain("evidence-recovery-unavailable");
				const malformedOwn = await createSession();
				faux.setResponses([fauxAssistantMessage("A separate synthetic checkpoint check.")]);
				await malformedOwn.prompt("Hello");
				malformedOwn.sessionManager.appendCustomEntry(ownType, {
					scope: `${malformedOwn.sessionId}:${resolve(workspace)}`,
					records: "malformed",
				});
				await expect(migrate(malformedOwn)).rejects.toThrow("Invalid knowledge recovery checkpoint");
				await expect(
					backend.command(
						malformedOwn.sessionId,
						"knowledge-migrate-recovery",
						'{"scope":"another-session"}',
					),
				).rejects.toThrow("accepts no scope");
				const second = await createSession();
				faux.setResponses([fauxAssistantMessage("A separate synthetic session.")]);
				await second.prompt("Hello");
				const secondData = {
					scope: `${second.sessionId}:${resolve(workspace)}`,
					records: [{ ...data.records[0], id: "second-window", sessionId: second.sessionId, used: false }],
				};
				second.sessionManager.appendCustomEntry(type, secondData);
				const entered = deferred(),
					release = deferred();
				setApprove((operation) => {
					if (operation === "capability:session.records.adoption.commit") {
						entered.resolve();
						return release.promise;
					}
					return true;
				});
				const pending = migrate(second);
				const cancelled = expect(pending).rejects.toThrow();
				await entered.promise;
				await backend.abort(second.sessionId);
				release.resolve(true);
				await cancelled;
				expect(ownRows(second)).toEqual([]);
				expect(ownRows(session)).toHaveLength(1);
				expect(
					second.messages.some(
						(message) =>
							message.role === "custom" &&
							message.customType.startsWith("plugin-notice:") &&
							message.content.includes('"state":"adopted"'),
					),
				).toBe(false);
			},
		),
	120000,
);
