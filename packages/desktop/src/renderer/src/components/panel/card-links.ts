import type { KnowledgeFlowCardLink } from "@drone/shared";
import { getPi } from "../../api";
import { useUiStore } from "../../stores/ui";
import { reportKnowledgeError } from "../knowledge/hooks";

/** 回执卡 / 里程碑证据里的动作链接色调 */
export const CARD_TONE_CLASS = {
	ok: "text-green-500",
	error: "text-red-500",
	warn: "text-warn",
	muted: "text-ink-dim",
} as const;
export type CardTone = keyof typeof CARD_TONE_CLASS;

/** 状态记号 → 色调（渲染端兜底；生产端给了 tone 时以生产端为准） */
export function toneForStatus(status: string | null | undefined): CardTone {
	const value = String(status || "");
	if (
		[
			"found",
			"verified",
			"saved",
			"reused",
			"both-verified",
			"applied",
			"written",
			"archived",
			"ready",
		].includes(value)
	)
		return "ok";
	if (
		[
			"failed",
			"identity-mismatch",
			"missing",
			"blocked",
			"cancelled",
			"not-found",
			"error",
			"rejected",
		].includes(value)
	)
		return "error";
	if (["unknown", "unavailable", "pending"].includes(value)) return "muted";
	return "warn";
}

/**
 * 执行一条通用动作链接（挂钩 3 / 4）：
 * external = 系统浏览器；resource = 宿主 openResourceExternal（自定义协议白名单）；
 * path = 变更页签的资源预览；note = 交给调用方（Vault 笔记查看器需要绑定版本）。
 */
export function followCardLink(
	link: KnowledgeFlowCardLink,
	{ cwd, label, onNote }: { cwd?: string | null; label?: string; onNote?: (path: string) => void },
): void {
	if (link.kind === "external") void getPi().openExternal(link.target).catch(reportKnowledgeError);
	else if (link.kind === "resource")
		void getPi()
			.openResourceExternal(link.target, cwd || undefined)
			.catch(reportKnowledgeError);
	else if (link.kind === "note") onNote?.(link.target);
	else useUiStore.getState().openResourcePreview({ href: link.target, label, cwd: cwd || undefined });
}
