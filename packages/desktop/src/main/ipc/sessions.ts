import type { PiBackend } from "@percho/backend";
import { SESSION_INVOKE_METHODS } from "@percho/shared";
import { registerInvokers } from "./register-invokers";

/**
 * 会话域：Session* 通道（生命周期/提示/导出/fork/撤回）+ 模型列表 + 项目文件/信任。
 * 全部为 1:1 透传 `backend[method]`（同名），由 registerInvokers 按 SESSION_INVOKE_METHODS
 * 统一注册；通道名与 preload 共用 INVOKE_ROUTES 事实源。
 */
export function registerSessionsIpc(backend: PiBackend): void {
	registerInvokers(backend, SESSION_INVOKE_METHODS);
}
