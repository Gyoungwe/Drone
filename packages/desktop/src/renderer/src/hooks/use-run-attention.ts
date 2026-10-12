import { attentionTitle, localResourceHref, writtenPath } from "@drone/shared";
import { useEffect, useRef } from "react";
import { getPi } from "../api";
import { useSessionsStore } from "../stores/sessions";
import { useTranscriptStore } from "../stores/transcript";
import { useUiStore } from "../stores/ui";

/** 角标图：红底白字圆点（Windows 任务栏 overlay icon 用）。jsdom / 无 canvas 时返回 null。 */
function badgeDataUrl(count: number): string | null {
	try {
		const c = document.createElement("canvas");
		c.width = c.height = 32;
		const g = c.getContext("2d");
		if (!g) return null;
		g.fillStyle = "#d6352c";
		g.beginPath();
		g.arc(16, 16, 16, 0, Math.PI * 2);
		g.fill();
		g.fillStyle = "#fff";
		g.font = "bold 20px system-ui, sans-serif";
		g.textAlign = "center";
		g.textBaseline = "middle";
		g.fillText(count > 9 ? "9+" : String(count), 16, 17);
		return c.toDataURL("image/png");
	} catch {
		return null;
	}
}

/** AwaitingInput（P14）：待答数 → 窗口标题 `(n)` 前缀 + dock / 任务栏角标；回答后清零。 */
export function useAttentionBadge(pendingAsks: number): void {
	const permissions = useTranscriptStore((s) =>
		Object.values(s.bySession).reduce((n, e) => n + e.pendingPermissions.length, 0),
	);
	const count = pendingAsks + permissions;
	useEffect(() => {
		document.title = attentionTitle(document.title, count);
		void getPi()
			.setAttentionBadge(count, count > 0 ? badgeDataUrl(count) : null)
			.catch(() => {});
	}, [count]);
}

/** Streaming（P14）：当前会话写 / 编辑文件成功后，右栏自动打开该文件预览（重复写入靠 nonce 触发刷新）。 */
export function useAutoPreviewWrites(): void {
	const paths = useRef(new Map<string, string>());
	useEffect(
		() =>
			getPi().onEvent(({ sessionId, event }) => {
				const ev = event as {
					type: string;
					toolCallId?: string;
					toolName?: string;
					args?: unknown;
					isError?: boolean;
				};
				if (ev.type === "tool_execution_start" && ev.toolCallId && ev.toolName) {
					const p = writtenPath(ev.toolName, ev.args);
					if (p) paths.current.set(ev.toolCallId, p);
					return;
				}
				if (ev.type !== "tool_execution_end" || !ev.toolCallId) return;
				const path = paths.current.get(ev.toolCallId);
				paths.current.delete(ev.toolCallId);
				const sessions = useSessionsStore.getState();
				if (!path || ev.isError || sessionId !== sessions.activeSessionId) return;
				useUiStore.getState().openResourcePreview({
					href: localResourceHref(path) ?? path,
					label: path.split(/[\\/]/).pop(),
					cwd: sessions.cwd ?? undefined,
				});
			}),
		[],
	);
}
