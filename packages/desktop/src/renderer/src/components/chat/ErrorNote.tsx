import { ERROR_CODES, errorCardActions, errorCodeOf, findContinuePoint, type UiError } from "@drone/shared";
import { useMemo, useRef, useState } from "react";
import { getPi } from "../../api";
import { type MessageKey, useT } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { useTranscriptStore } from "../../stores/transcript";
import { ChevronRightIcon, CopyIcon, ErrorCircleIcon, GearIcon, RefreshIcon } from "../icons";

/**
 * 会话内错误条（error-system 画板 ①②③）：无边框悬浮卡片 + severity 一枚 glyph + 幽灵动作。
 * v2 语言：rounded-xl bg-surface shadow-soft（QueueBar/面板卡片同款），默认折叠。
 *
 * 动作行：
 * - retry：只读恢复未完成回答，不重发原问题或进入 followUp 队列；
 * - compact：/compact 压缩（只 llmOverflow 类出现）；
 * - openSettings：打开设置面板（只凭证类出现）；
 * - copyDetail：复制原始报错（有 detail 时恒有）。
 */
export function ErrorNote({
	sessionId,
	cardId,
	error,
}: {
	sessionId: string | null;
	cardId: string;
	error: UiError;
}) {
	const t = useT();
	const [copied, setCopied] = useState(false);
	const [recovering, setRecovering] = useState(false);
	const [recoveryError, setRecoveryError] = useState("");
	const recoveryLock = useRef(false);
	const active = useTranscriptStore((s) => (sessionId ? s.bySession[sessionId]?.agentActive : false));

	// 本卡之前最后一条 user 消息（重试用）——按 cardId 定位卡索引，向前找
	const lastUser = useTranscriptStore((s) => {
		if (!sessionId) return undefined;
		const entry = s.bySession[sessionId];
		const messages = entry?.messages ?? [];
		const idx = messages.findLastIndex((m) => m.kind === "error" && m.id === cardId);
		if (idx < 0) return undefined;
		for (let i = idx - 1; i >= 0; i--) {
			const m = messages[i];
			if (m?.kind === "user") return m;
		}
		return undefined;
	});

	const retry = async () => {
		if (!sessionId || !lastUser || active || recoveryLock.current) return;
		recoveryLock.current = true;
		setRecovering(true);
		setRecoveryError("");
		try {
			await getPi().retry(sessionId, cardId, lastUser.timestamp);
			// 重发受理：切回该会话（若在看别的会话）
			useSessionsStore.getState().switchSession(sessionId);
		} catch (e) {
			setRecoveryError(e instanceof Error ? e.message : String(e));
		} finally {
			recoveryLock.current = false;
			setRecovering(false);
		}
	};

	// 「继续」：会话级重做 = 发一条普通用户消息（P8），回复后卡片定格为「已恢复运行」
	const [continued, setContinued] = useState(false);
	const sendContinue = async () => {
		if (!sessionId || active || recoveryLock.current) return;
		recoveryLock.current = true;
		setRecovering(true);
		setRecoveryError("");
		try {
			// H3：文案走 i18n；有中断工具时附上「从第 N 步、工具 X 继续」作为结构化上下文
			const messages = useTranscriptStore.getState().bySession[sessionId]?.messages ?? [];
			const cardIndex = messages.findLastIndex((m) => m.kind === "error" && m.id === cardId);
			const point = findContinuePoint(messages, cardIndex < 0 ? messages.length : cardIndex);
			const text = point
				? `${t("error.continueMessage")}\n${t("error.continueFrom", { step: point.step, tool: point.tool })}`
				: t("error.continueMessage");
			await getPi().prompt(sessionId, text);
			setContinued(true);
			useSessionsStore.getState().switchSession(sessionId);
		} catch (e) {
			setRecoveryError(e instanceof Error ? e.message : String(e));
		} finally {
			recoveryLock.current = false;
			setRecovering(false);
		}
	};

	const copyDetail = async () => {
		if (!error.detail) return;
		try {
			await navigator.clipboard.writeText(error.detail);
			setCopied(true);
			setTimeout(() => setCopied(false), 1800);
		} catch {
			// 剪贴板不可用（权限/非安全上下文）：静默
		}
	};

	const meta = `${t(`error.meta.${error.source}`)} · ${formatTime(error.timestamp)}`;
	const severityClass =
		error.severity === "warning" ? "text-warn" : error.severity === "info" ? "text-info" : "text-err";

	const code = errorCodeOf(error);
	const spec = ERROR_CODES[code];
	const actions = useMemo(() => {
		const list = [];
		for (const action of spec.turnLevel ? errorCardActions(error) : error.actions) {
			if (action === "continue") {
				list.push({ action, label: t("error.action.continue") });
				continue;
			}
			if (action === "retry") list.push({ action, label: t("error.action.retry") });
			else if (action === "compact") list.push({ action, label: t("error.action.compact") });
			else if (action === "openSettings") list.push({ action, label: t("error.action.openSettings") });
			else if (action === "copyDetail") list.push({ action, label: t("error.action.copyDetail") });
		}
		return list;
	}, [error, spec.turnLevel, t]);

	if (spec.turnLevel) {
		const others = actions.filter((a) => a.action !== "continue");
		const canContinue = spec.continuable && actions.some((a) => a.action === "continue");
		return (
			<div className="error-card" data-error-code={code} data-continued={continued || undefined}>
				<div className="error-card-row">
					<span className="error-card-icon" aria-hidden>
						<ErrorCircleIcon />
					</span>
					<div className="error-card-text">
						<div className="error-card-title">
							{continued ? t("error.card.resumed") : t(error.titleKey as MessageKey, error.titleParams)}
						</div>
						{!continued && (
							<div className="error-card-sub">
								{canContinue
									? t("error.card.continueHint")
									: error.hintKey
										? t(error.hintKey as MessageKey)
										: t("error.card.noContinue")}
							</div>
						)}
					</div>
					{canContinue && !continued && (
						<button
							type="button"
							className="error-card-continue"
							disabled={!!active || recovering}
							onClick={() => void sendContinue()}
						>
							{t("error.action.continue")}
						</button>
					)}
				</div>
				{recoveryError && <p role="alert">{recoveryError}</p>}
				{(error.detail || others.length > 0) && (
					<details className="error-card-details">
						<summary>
							<span className="error-note-meta">{meta}</span>
						</summary>
						{error.detail && <pre className="error-note-detail">{error.detail}</pre>}
						<div className="error-note-actions">
							{others.map(({ action, label }) => (
								<button
									key={action}
									type="button"
									className="error-note-act"
									onClick={() => {
										if (action === "compact" && sessionId) void getPi().compact(sessionId);
										else if (action === "openSettings") useSettingsStore.getState().openWith();
										else if (action === "copyDetail") void copyDetail();
										else if (action === "retry") void retry();
									}}
								>
									{action === "openSettings" ? <GearIcon /> : action === "copyDetail" ? <CopyIcon /> : null}
									{label}
								</button>
							))}
							{error.detail && (
								<span className={`error-note-copied${copied ? " on" : ""}`}>{t("error.copied")}</span>
							)}
						</div>
					</details>
				)}
			</div>
		);
	}

	return (
		<details className="error-note drawer-details">
			<summary>
				<span className={`error-note-sev ${severityClass}`}>
					<ErrorCircleIcon />
				</span>
				<span className="error-note-title truncate">
					{t(error.titleKey as MessageKey, error.titleParams)}
				</span>
				<span className="error-note-meta">{meta}</span>
				<span className="error-note-chev">
					<ChevronRightIcon />
				</span>
			</summary>
			{recoveryError && <p role="alert">{recoveryError}</p>}
			<div className="error-note-body">
				{error.detail && <pre className="error-note-detail">{error.detail}</pre>}
				{error.hintKey && <p className="error-note-hint">{t(error.hintKey as MessageKey)}</p>}
				<div className="error-note-actions">
					{actions.map(({ action, label }) => (
						<button
							key={action}
							type="button"
							className={`error-note-act${action === "retry" ? " strong" : ""}`}
							disabled={action === "retry" && (!!active || recovering || !lastUser)}
							onClick={() => {
								if (action === "retry") void retry();
								else if (action === "compact" && sessionId) void getPi().compact(sessionId);
								else if (action === "openSettings") useSettingsStore.getState().openWith();
								else if (action === "copyDetail") void copyDetail();
							}}
						>
							{action === "retry" ? (
								<RefreshIcon />
							) : action === "openSettings" ? (
								<GearIcon />
							) : action === "copyDetail" ? (
								<CopyIcon />
							) : null}
							{label}
						</button>
					))}
					{error.detail && (
						<span className={`error-note-copied${copied ? " on" : ""}`}>{t("error.copied")}</span>
					)}
				</div>
			</div>
		</details>
	);
}

function formatTime(timestamp: number): string {
	try {
		return new Date(timestamp).toLocaleTimeString(undefined, {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
	} catch {
		return "";
	}
}
