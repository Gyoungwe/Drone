import type { PromptReceipt } from "@drone/shared";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { ToolManifest } from "../tools/manifest";

/**
 * Explicit allow-list: resuming an answer must never replay an import, shell command or Vault write.
 * 名单来自工具清单（挂钩 1）：只有在 registerTool 时声明 `drone.recoverySafe: true` 的工具才会被重放。
 */
export function recoveryReadTools(
	session: Partial<Pick<AgentSession, "getAllTools" | "getToolDefinition">>,
	names: readonly string[],
): Set<string> {
	const manifest = new ToolManifest(session);
	return new Set(names.filter((name) => manifest.recoverySafe(name)));
}
export class SessionRecovery {
	private readonly requests = new Map<string, Promise<PromptReceipt>>();
	private readonly active = new Set<string>();
	isRecovering(sessionId: string): boolean {
		return this.active.has(sessionId);
	}
	retry(session: AgentSession, requestId: string, expectedUserTimestamp?: number): Promise<PromptReceipt> {
		if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(requestId))
			return Promise.reject(new Error("Invalid recovery request id"));
		const key = `${session.sessionId}:${requestId}`;
		const previous = this.requests.get(key);
		if (previous) return previous;
		if (this.active.has(session.sessionId) || !session.isIdle || session.pendingMessageCount > 0)
			return Promise.reject(
				new Error("Wait for the active task and queued messages; recovery never adds a follow-up"),
			);
		const messages = session.messages;
		const last = messages.filter((m) => m.role === "assistant").at(-1);
		const user = messages.filter((m) => m.role === "user").at(-1);
		if (
			!last ||
			!user ||
			!["error", "aborted"].includes(last.stopReason) ||
			messages.lastIndexOf(last) < messages.lastIndexOf(user)
		)
			return Promise.reject(new Error("No unfinished answer to recover"));
		if (expectedUserTimestamp !== undefined && user.timestamp !== expectedUserTimestamp)
			return Promise.reject(
				new Error("This error belongs to an older question; recover the latest task instead"),
			);
		this.active.add(session.sessionId);
		const originalTools = session.getActiveToolNames();
		const recoverySafe = recoveryReadTools(session, originalTools);
		const receipt: PromptReceipt = { kind: "agent" };
		const pending = new Promise<PromptReceipt>((resolve, reject) => {
			let accepted = false;
			const unsubscribe = session.subscribe((event) => {
				if (event.type === "agent_start") {
					accepted = true;
					resolve(receipt);
				}
			});
			const finish = () => {
				unsubscribe();
				try {
					session.setActiveToolsByName(originalTools);
				} finally {
					this.active.delete(session.sessionId);
				}
			};
			try {
				session.setActiveToolsByName(originalTools.filter((name) => recoverySafe.has(name)));
				const checkpoint = messages
					.slice(messages.lastIndexOf(user))
					.filter((m) => m.role === "toolResult" && !m.isError);
				void session
					.sendCustomMessage(
						{
							customType: "research-recovery",
							display: true,
							content:
								"恢复上一任务未完成的回答（只读）。沿用已完成的工具结果与现有证据，先检查是否只剩最终答复；不要重做已成功的步骤，不要重复导入、下载或写入。必要时只重新核对已变化或失效的来源。历史阅读不能称为本轮新读；证据不足时明确说明，不绕过发布检查。",
							details: {
								version: 1,
								requestId,
								originalUserTimestamp: user.timestamp,
								failedAssistantTimestamp: last.timestamp,
								checkpoint: "completed-tool-results",
								completedToolResults: checkpoint.length,
								mode: "read-only-recovery",
								scientificallyVerified: false,
							},
						},
						{ triggerTurn: true },
					)
					.then(
						async () => {
							await session.waitForIdle();
							resolve(receipt);
						},
						(error) => {
							if (!accepted) reject(error);
						},
					)
					.finally(finish)
					.catch(() => {});
			} catch (error) {
				finish();
				reject(error);
			}
		});
		this.requests.set(key, pending);
		void pending.catch(() => this.requests.delete(key));
		if (this.requests.size > 256) {
			const oldest = this.requests.keys().next().value;
			if (oldest) this.requests.delete(oldest);
		}
		return pending;
	}
	forget(sessionId: string) {
		for (const key of this.requests.keys()) if (key.startsWith(`${sessionId}:`)) this.requests.delete(key);
	}
}
