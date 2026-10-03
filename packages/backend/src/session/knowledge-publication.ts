import { publicationFallbackNotice } from "@drone/knowledge/publication-policy";
import { type DroneRuntime, isUserAbortError, type SessionEvent, sanitizeProviderError } from "@drone/shared";
import type { RawMessage } from "./messages";

/**
 * 发布网关跨模块契约：投影逻辑住在运行时加载的 .pi 知识扩展（publication.mjs），
 * 它把 `projectEvent`/`projectSnapshot` 注入当前 DroneRuntime。后端事件管线
 *（pi-backend emitEvent / getSessionMessages / subagent runner）经本模块的稳定入口调用。
 *
 * 扩展与后端分属两套模块世界（bundled TS ↔ 运行时 .mjs）。runtime 由宿主通过版本化
 * `pi.events` 注入动态扩展，再经显式参数传回这里；把唯一的 untyped 边界收在 `bridge()` 一处，
 * 其余代码只见类型化入口。运行时缺失或投影器抛错时继续走失败关闭兜底。
 */
interface PublicationBridge {
	projectEvent?: (event: SessionEvent) => SessionEvent | null;
	projectSnapshot?: (messages: RawMessage[], persisted: RawMessage[]) => RawMessage[];
}
function bridge(runtime?: DroneRuntime): PublicationBridge | undefined {
	return runtime?.knowledge.publication as PublicationBridge | undefined;
}

const notice = `【知识库检查未通过】${publicationFallbackNotice}`;

/** 兜底封条：隐藏未审草稿，同时区分服务商错误、中断与发布检查故障。 */
function sealed(message: RawMessage): RawMessage {
	const error = typeof message.errorMessage === "string" ? sanitizeProviderError(message.errorMessage) : "";
	const interrupted =
		message.stopReason === "aborted" || (message.stopReason === "error" && isUserAbortError(error));
	const providerError = message.stopReason === "error" && !interrupted;
	return {
		role: "assistant",
		content: providerError
			? []
			: [{ type: "text", text: interrupted ? "本次请求已中断，未完成的回答没有发布。" : notice }],
		timestamp: message.timestamp,
		stopReason: message.stopReason,
		...(message.stopReason === "error" ? { errorMessage: error || "Model request failed" } : {}),
	};
}

/** 就地清空并覆盖（message_end：SDK 落盘用的是同一对象引用，必须原地改）。 */
function inplace(target: Record<string, unknown>, source: RawMessage): void {
	for (const name of Object.keys(target)) delete target[name];
	Object.assign(target, source);
}

/**
 * 兜底投影（bridge 缺失/异常时的失败关闭态）——按事件**形状**中和，不逐一枚举事件类型：
 * 流式增量整条丢弃；任何携带 assistant `message` 的事件把该消息封条化；携带 `messages[]` 的
 * 事件把其中 assistant 项封条化。如此即便扩展将来新增一种带草稿的事件类型，兜底仍失败关闭，
 * 不会随两侧枚举漂移而漏放（drift-safe）。
 */
function failClosedEvent(event: SessionEvent): SessionEvent | null {
	if (event.type === "message_update") return null;
	const withMessage = event as { type: string; message?: { role?: string } };
	if (withMessage.message?.role === "assistant") {
		const message = withMessage.message as unknown as RawMessage;
		// message_start：本就无内容，清空即可（不提前显示提示文案）
		if (event.type === "message_start") {
			return { ...event, message: { ...sealed(message), content: [] } } as unknown as SessionEvent;
		}
		// message_end：SDK 随后按引用落盘，必须原地封条化
		if (event.type === "message_end") {
			inplace(withMessage.message as Record<string, unknown>, sealed(message));
			return event;
		}
		return { ...event, message: sealed(message) } as unknown as SessionEvent;
	}
	const withMessages = event as { messages?: RawMessage[] };
	if (Array.isArray(withMessages.messages)) {
		return {
			...event,
			messages: withMessages.messages.map((m) => (m.role === "assistant" ? sealed(m) : m)),
		} as unknown as SessionEvent;
	}
	return event;
}

/** Shared delivery boundary: desktop, LAN and trace consumers all receive the same projected event. */
export function projectKnowledgeEvent(event: SessionEvent, runtime?: DroneRuntime): SessionEvent | null {
	if (!process.env.DRONE_KNOWLEDGE_DIR) return event;
	try {
		const fn = bridge(runtime)?.projectEvent;
		if (fn) return fn(event);
	} catch {
		/* Fail closed, never leak the draft. */
	}
	return failClosedEvent(event);
}

/** Live polling cannot reveal the assistant object while async validation is still pending. */
export function projectKnowledgeSnapshot(
	messages: RawMessage[],
	persisted: RawMessage[],
	runtime?: DroneRuntime,
): RawMessage[] {
	if (!process.env.DRONE_KNOWLEDGE_DIR) return messages;
	try {
		const fn = bridge(runtime)?.projectSnapshot;
		if (fn) return fn(messages, persisted);
	} catch {
		/* fail closed */
	}
	return messages.map((m) => (m.role === "assistant" ? sealed(m) : m));
}
