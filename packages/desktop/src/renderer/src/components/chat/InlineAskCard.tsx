import {
	type AskRequest,
	type AskResponse,
	answerSummary,
	buildInlineResponse,
	emptyDrafts,
	type InlineDrafts,
	missingRequired,
	pickByNumber,
} from "@drone/shared";
import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { useTranscriptStore } from "../../stores/transcript";

/** 等待时长（每秒刷新）。 */
function useWaited(since: number): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	return Math.max(0, now - since);
}

/**
 * 对话流内联问询卡（P9）：多题分页、数字键选项、推荐项标记、自行输入、跳过、缺答提示、等待计时。
 * 回答后在流里留一行「你回复了「…」」。
 */
export function InlineAskCard({
	request,
	receivedAt,
	onRespond,
}: {
	request: AskRequest;
	receivedAt: number;
	onRespond: (requestId: string, response: AskResponse) => Promise<void>;
}) {
	const t = useT();
	const [drafts, setDrafts] = useState<InlineDrafts>(() => emptyDrafts(request));
	const [page, setPage] = useState(0);
	const [missing, setMissing] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const ref = useRef<HTMLDivElement>(null);
	const waited = useWaited(receivedAt);
	const question = request.questions[page];
	const draft = question ? drafts[question.id] : undefined;
	const last = page >= request.questions.length - 1;

	const update = (patch: Partial<InlineDrafts[string]>) => {
		if (!question) return;
		setDrafts((d) => ({
			...d,
			[question.id]: { ...(d[question.id] ?? { values: [], custom: "", skipped: false }), ...patch },
		}));
		setMissing((m) => m.filter((id) => id !== question.id));
	};

	const submit = async () => {
		const lacking = missingRequired(request, drafts);
		if (lacking.length) {
			setMissing(lacking.map((q) => q.id));
			setPage(request.questions.findIndex((q) => q.id === lacking[0]?.id));
			return;
		}
		const response = buildInlineResponse(request, drafts);
		setBusy(true);
		setError("");
		try {
			await onRespond(request.id, response);
			useTranscriptStore
				.getState()
				.appendAskReceipt(
					request.sessionId,
					answerSummary(request, response) || t("ask.inline.skippedAll"),
					Date.now() - receivedAt,
				);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};
	const next = () => (last ? void submit() : setPage((p) => p + 1));

	// 数字键：焦点不在输入框时选第 n 个选项
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!question || busy) return;
			const target = e.target as HTMLElement | null;
			if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable))
				return;
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			const digit = Number(e.key);
			if (digit >= 1 && digit <= 9 && question.type !== "text") {
				e.preventDefault();
				setDrafts((d) => {
					const cur = d[question.id] ?? { values: [], custom: "", skipped: false };
					return {
						...d,
						[question.id]: { ...cur, values: pickByNumber(question, cur.values, digit), skipped: false },
					};
				});
				setMissing((m) => m.filter((id) => id !== question.id));
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [question, busy]);

	if (!question || !draft) return null;
	const recommended = question.recommendation?.value;
	return (
		<div ref={ref} className="inline-ask" data-testid="inline-ask" aria-busy={busy}>
			<div className="inline-ask-head">
				<span className="inline-ask-title">{request.title || t("ask.inline.title")}</span>
				{request.questions.length > 1 && (
					<span className="inline-ask-page">
						{page + 1}/{request.questions.length}
					</span>
				)}
				<span className="inline-ask-wait">
					{t("ask.inline.waiting", { seconds: Math.floor(waited / 1000) })}
				</span>
			</div>
			<div className="inline-ask-prompt">
				{question.prompt || question.label}
				{question.required && <span className="inline-ask-required">*</span>}
			</div>
			{question.type !== "text" && (
				<div className="inline-ask-options">
					{question.options.map((option, i) => {
						const on = draft.values.includes(option.value);
						return (
							<button
								key={option.value}
								type="button"
								aria-pressed={on}
								className="inline-ask-option"
								onClick={() =>
									update({
										values:
											question.type === "multi"
												? on
													? draft.values.filter((v) => v !== option.value)
													: [...draft.values, option.value]
												: [option.value],
										skipped: false,
									})
								}
							>
								<kbd>{i + 1}</kbd>
								<span className="inline-ask-option-label">{option.label}</span>
								{(option.recommended || option.value === recommended) && (
									<span className="inline-ask-rec">{t("ask.inline.recommended")}</span>
								)}
								{option.description && <span className="inline-ask-option-desc">{option.description}</span>}
							</button>
						);
					})}
				</div>
			)}
			{question.allowCustomText !== false && (
				<input
					className="inline-ask-custom"
					placeholder={t(
						question.type === "text" ? "ask.inline.answerPlaceholder" : "ask.inline.customPlaceholder",
					)}
					value={draft.custom}
					onChange={(e) => update({ custom: e.target.value, skipped: false })}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.nativeEvent.isComposing) {
							e.preventDefault();
							next();
						}
					}}
				/>
			)}
			{missing.includes(question.id) && (
				<p className="inline-ask-missing" role="alert">
					{t("ask.inline.missing")}
				</p>
			)}
			{error && (
				<p className="inline-ask-missing" role="alert">
					{error}
				</p>
			)}
			<div className="inline-ask-actions">
				{page > 0 && (
					<button type="button" onClick={() => setPage((p) => p - 1)}>
						{t("ask.inline.prev")}
					</button>
				)}
				<span className="flex-1" />
				{!question.required && (
					<button
						type="button"
						onClick={() => {
							update({ values: [], custom: "", skipped: true });
							next();
						}}
					>
						{t("ask.inline.skip")}
					</button>
				)}
				<button type="button" className="strong" disabled={busy} onClick={next}>
					{last ? t("ask.inline.submit") : t("ask.inline.next")}
				</button>
			</div>
		</div>
	);
}
