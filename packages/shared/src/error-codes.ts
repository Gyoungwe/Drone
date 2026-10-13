import type { UiError, UiErrorAction } from "./errors";

/**
 * 统一错误码表（P8）：码 → 图标 / 动作 / 是否可「继续」。
 * 「继续」= 会话级重做：发一条普通用户消息「继续」，由模型根据会话记录重做被中断的那一步。
 * CONTEXT_EXCEEDED 是唯一不给「继续」的码（继续只会再次超限），引导压缩或新任务。
 */
export type ErrorCode =
	| "TURN_FAILED"
	| "AUTH"
	| "RATE_LIMIT"
	| "CONTEXT_EXCEEDED"
	| "NETWORK"
	| "MODEL_TIMEOUT"
	| "STREAM_GUARD"
	| "SEND_FAILED"
	| "SEND_READ_ONLY";

export type ErrorIcon = "warning" | "key" | "clock" | "network" | "shield" | "context" | "lock";

export interface ErrorCodeSpec {
	icon: ErrorIcon;
	/** 一轮运行失败（进对话流琥珀卡）；false = 发送前被拒（输入框上方提示条） */
	turnLevel: boolean;
	continuable: boolean;
	actions: UiErrorAction[];
}

export const ERROR_CODES: Record<ErrorCode, ErrorCodeSpec> = {
	TURN_FAILED: { icon: "warning", turnLevel: true, continuable: true, actions: ["continue", "copyDetail"] },
	AUTH: {
		icon: "key",
		turnLevel: true,
		continuable: true,
		actions: ["openSettings", "continue", "copyDetail"],
	},
	RATE_LIMIT: { icon: "clock", turnLevel: true, continuable: true, actions: ["continue", "copyDetail"] },
	CONTEXT_EXCEEDED: {
		icon: "context",
		turnLevel: true,
		continuable: false,
		actions: ["compact", "copyDetail"],
	},
	NETWORK: { icon: "network", turnLevel: true, continuable: true, actions: ["continue", "copyDetail"] },
	MODEL_TIMEOUT: { icon: "clock", turnLevel: true, continuable: true, actions: ["continue", "copyDetail"] },
	STREAM_GUARD: { icon: "shield", turnLevel: true, continuable: true, actions: ["continue", "copyDetail"] },
	SEND_FAILED: { icon: "warning", turnLevel: false, continuable: false, actions: ["retry", "copyDetail"] },
	SEND_READ_ONLY: { icon: "lock", turnLevel: false, continuable: false, actions: ["copyDetail"] },
};

const TITLE_TO_CODE: Record<string, ErrorCode> = {
	"error.title.llmAuth": "AUTH",
	"error.title.llmRateLimit": "RATE_LIMIT",
	"error.title.llmOverflow": "CONTEXT_EXCEEDED",
	"error.title.llmNetwork": "NETWORK",
	"error.title.llmGeneric": "TURN_FAILED",
	"error.title.modelTimeout": "MODEL_TIMEOUT",
	"error.title.streamGuard": "STREAM_GUARD",
	"error.title.sendFailed": "SEND_FAILED",
	"error.title.sendReadOnly": "SEND_READ_ONLY",
};

export function isErrorCode(value: unknown): value is ErrorCode {
	return typeof value === "string" && value in ERROR_CODES;
}

/** 码优先；旧卡（历史回放无 code）按 titleKey 反查；都不认识按 TURN_FAILED。 */
export function errorCodeOf(error: Pick<UiError, "code" | "titleKey">): ErrorCode {
	if (isErrorCode(error.code)) return error.code;
	return TITLE_TO_CODE[error.titleKey] ?? "TURN_FAILED";
}

export function errorCodeForTitle(titleKey: string): ErrorCode {
	return TITLE_TO_CODE[titleKey] ?? "TURN_FAILED";
}

/** 卡片实际展示的动作：码表动作；有 detail 才保留复制；旧数据里的 retry 在可继续码上并为 continue。 */
export function errorCardActions(error: UiError): UiErrorAction[] {
	const spec = ERROR_CODES[errorCodeOf(error)];
	return spec.actions.filter((a) => a !== "copyDetail" || !!error.detail);
}

/** @deprecated H3：渲染层改用 i18n 的 error.continueMessage；保留给旧调用方。 */
export const CONTINUE_MESSAGE = "继续";

/** H3：「继续」的结构化续跑上下文——中断前本轮已跑过的工具步数与最后（未完成/失败）的工具。 */
export interface ContinuePoint {
	/** 1-based：从第 N 步继续 */
	step: number;
	tool: string;
}

/**
 * 从错误卡之前的转录里找续跑点：自最后一条 user 消息起累计工具步数，取最后一个 running/error 的工具；
 * 全部完成则返回 undefined（只做会话级「继续」）。
 */
export function findContinuePoint(
	messages: ReadonlyArray<{ kind: string; tools?: ReadonlyArray<{ name: string; state: string }> }>,
	beforeIndex = messages.length,
): ContinuePoint | undefined {
	const tools: Array<{ name: string; state: string }> = [];
	for (let i = Math.min(beforeIndex, messages.length) - 1; i >= 0; i--) {
		const m = messages[i];
		if (!m || m.kind === "user") break;
		if (m.tools?.length) tools.unshift(...m.tools);
	}
	for (let i = tools.length - 1; i >= 0; i--) {
		const tool = tools[i];
		if (tool && tool.state !== "done") return { step: i + 1, tool: tool.name };
	}
	return undefined;
}
