import type { PiBackend } from "@drone/backend";
import { SUBAGENT_INVOKE_METHODS } from "@drone/shared";
import { registerInvokers } from "./register-invokers";

/**
 * 子智能体面板（会话内专属派发）：可用列表 / 派发 / 中止 / 本会话运行，四条通道全部 1:1 透传
 * `backend[method]`（校验、排队、结果入会话都在 backend 的 SubagentPanelService）。
 */
export function registerSubagentsIpc(backend: PiBackend): void {
	registerInvokers(backend, SUBAGENT_INVOKE_METHODS);
}
