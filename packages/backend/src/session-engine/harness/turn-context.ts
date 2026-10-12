import { TURN_CONTEXT_CUSTOM_TYPE, type TurnMeta, turnContextNote } from "@drone/shared";
import { createLogger } from "../../log";
import type { InlineExtension } from "../sdk";

const log = createLogger("turn-context");

export interface TurnContextOptions {
	now?: () => Date;
	timeZone?: () => string | undefined;
	getMode?: () => string | undefined;
	/** 每轮开始记录元数据（mode / model / effort / context），落进会话 trace */
	recordMeta?: (sessionId: string, meta: TurnMeta) => void;
}

/**
 * P16：每次 LLM 调用前在末尾追加一条隐藏的 custom 消息（剩余 token + 今天日期）。
 * 放在消息尾部而不是系统提示里，避免每轮改系统提示打掉前缀缓存。
 */
export function makeTurnContextExtension(options: TurnContextOptions = {}): InlineExtension {
	return {
		name: "turn-context",
		factory: (pi) => {
			pi.on("before_agent_start", (_event, ctx) => {
				try {
					const sessionId = ctx.sessionManager.getSessionId();
					const usage = ctx.getContextUsage();
					options.recordMeta?.(sessionId, {
						mode: options.getMode?.(),
						provider: ctx.model?.provider,
						model: ctx.model?.id,
						effort: pi.getThinkingLevel?.(),
						contextTokens: usage?.tokens ?? null,
						contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow ?? null,
					});
				} catch (error) {
					log.warn("turn meta failed", { error: String(error) });
				}
				return undefined;
			});
			pi.on("context", (event, ctx) => {
				try {
					const usage = ctx.getContextUsage();
					const content = turnContextNote({
						usedTokens: usage?.tokens ?? null,
						contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow ?? null,
						now: options.now?.() ?? new Date(),
						timeZone: options.timeZone?.(),
					});
					const messages = event.messages.filter(
						(m) => !(m.role === "custom" && m.customType === TURN_CONTEXT_CUSTOM_TYPE),
					);
					return {
						messages: [
							...messages,
							{
								role: "custom" as const,
								customType: TURN_CONTEXT_CUSTOM_TYPE,
								display: false,
								content,
								details: undefined,
								timestamp: Date.now(),
							},
						],
					};
				} catch (error) {
					log.warn("turn context failed", { error: String(error) });
					return undefined;
				}
			});
		},
	};
}
