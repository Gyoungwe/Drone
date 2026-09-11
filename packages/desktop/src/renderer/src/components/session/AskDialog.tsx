import type { AskAnswer, AskRequest, AskResponse } from "@percho/shared";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../../i18n";
import { Button } from "../ui/Button";

type Drafts = Record<string, AskAnswer>;

export function AskDialog({ requests, onRespond }: { requests: AskRequest[]; onRespond: (requestId: string, response: AskResponse) => Promise<void> | void }) {
	const t = useT();
	const request = requests[0];
	const [drafts, setDrafts] = useState<Drafts>({});
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => { setDrafts({}); setError(null); setSending(false); }, [request?.id]);
	const answered = useMemo(() => request?.questions.filter((q) => {
		const answer = drafts[q.id];
		return Boolean(answer?.values?.length || answer?.customText?.trim());
	}).length ?? 0, [drafts, request]);
	const canSubmit = useMemo(() => request?.questions.every((q) => {
		if (!q.required) return true;
		const answer = drafts[q.id];
		return Boolean(answer?.values?.length || answer?.customText?.trim());
	}) ?? false, [drafts, request]);
	if (!request) return null;

	const toggle = (questionId: string, value: string, multi: boolean) => setDrafts((current) => {
		const prev = current[questionId] ?? {};
		const values = prev.values ?? [];
		const next = multi ? (values.includes(value) ? values.filter((item) => item !== value) : [...values, value]) : [value];
		return { ...current, [questionId]: { ...prev, values: next, ...(multi ? {} : { customText: undefined }) } };
	});
	const setCustom = (questionId: string, customText: string, multi: boolean) => setDrafts((current) => ({
		...current,
		[questionId]: { ...(current[questionId] ?? {}), customText, ...(multi || !customText.trim() ? {} : { values: [] }) },
	}));
	const respond = async (response: AskResponse) => {
		setSending(true); setError(null);
		try { await onRespond(request.id, response); }
		catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setSending(false); }
	};

	return (
		<div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/25 p-6" role="dialog" aria-modal aria-label={request.title ?? t("ask.title")}>
			<div className="flex max-h-[82vh] w-[min(680px,92vw)] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-dialog">
				<div className="border-b border-border px-5 py-4">
					<div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">{t("ask.eyebrow")}</div>
					<h3 className="mt-1 text-base font-semibold text-ink">{request.title ?? t("ask.title")}</h3>
					<p className="mt-1 text-[12px] text-ink-dim">{t("ask.progress", { answered, total: request.questions.length })}</p>
				</div>
				<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
					{request.questions.map((question, questionIndex) => {
						const draft = drafts[question.id] ?? {};
						const selected = draft.values ?? [];
						const multi = question.type === "multi";
						const textOnly = question.type === "text";
						return (
							<section key={question.id} className="space-y-2.5">
								<div className="flex items-start gap-2">
									<span className="mt-0.5 rounded-md bg-hover px-1.5 py-0.5 text-[10px] font-medium text-ink-faint">{question.label || `Q${questionIndex + 1}`}</span>
									<div className="min-w-0 flex-1">
										<p className="text-[13px] font-medium leading-relaxed text-ink">{question.prompt}</p>
										{!textOnly && <p className="mt-0.5 text-[10px] text-ink-faint">{multi ? t("ask.multiHint") : t("ask.singleHint")}{question.required ? ` · ${t("ask.required")}` : ""}</p>}
									</div>
								</div>
								<div className="grid gap-1.5 pl-8">
									{!textOnly && question.options.map((option) => {
										const active = selected.includes(option.value);
										return (
											<button key={option.value} type="button" onClick={() => toggle(question.id, option.value, multi)} className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${active ? "border-accent bg-accent/8" : "border-border bg-surface hover:bg-hover"}`}>
												<div className="flex items-center gap-2">
													<span className={`flex h-4 w-4 shrink-0 items-center justify-center ${multi ? "rounded" : "rounded-full"} border ${active ? "border-accent bg-accent text-white" : "border-border"}`}>{active ? "✓" : ""}</span>
													<span className="text-[12px] font-medium text-ink-2">{option.label}</span>
													{option.recommended && <span className="rounded-full bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium text-warn">{t("ask.recommended")}</span>}
												</div>
												{option.description && <p className="mt-1 pl-6 text-[11px] leading-relaxed text-ink-dim">{option.description}</p>}
												{option.preview && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-hover p-2 text-[10px] leading-relaxed text-ink-2">{option.preview}</pre>}
											</button>
										);
									})}
									<input value={draft.customText ?? ""} onChange={(event) => setCustom(question.id, event.target.value, multi)} placeholder={t("ask.customPlaceholder")} className="mt-0.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-accent" />
								</div>
							</section>
						);
					})}
				</div>
				<div className="border-t border-border px-5 py-3">
					{error && <p className="mb-2 text-[11px] text-err">{error}</p>}
					<div className="flex items-center justify-between gap-3">
						<span className="text-[10px] text-ink-faint">{requests.length > 1 ? t("ask.queued", { count: requests.length - 1 }) : t("ask.footerHint")}</span>
						<div className="flex gap-2">
							<Button disabled={sending} onClick={() => void respond({ kind: "cancel" })}>{t("common.cancel")}</Button>
							<Button variant="primary" disabled={sending || !canSubmit} onClick={() => void respond({ kind: "answer", mode: "submit", answers: drafts })}>{sending ? t("ask.submitting") : t("ask.submit")}</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
