import type { PiBackend } from "@drone/backend";
import { INVOKE_ROUTES } from "@drone/shared";
import { ipcMain } from "electron";

/**
 * 批量注册「1:1 透传 `backend[method](...args)`」的 invoke 处理器。
 *
 * 仅用于渲染端方法名与 backend 方法名同名、且 handler 无额外校验/改写的纯透传通道
 * （如 sessions 域）。通道名从 INVOKE_ROUTES 取，与 preload 共用同一事实源——
 * 三跳里的两跳（channel 声明、透传 handler）由此收敛。
 */
export function registerInvokers(
	backend: PiBackend,
	methods: readonly (keyof typeof INVOKE_ROUTES & keyof PiBackend)[],
): void {
	for (const method of methods) {
		const channel = INVOKE_ROUTES[method];
		const fn = backend[method] as (...args: unknown[]) => unknown;
		ipcMain.handle(channel, (_event, ...args: unknown[]) => fn.apply(backend, args));
	}
}
