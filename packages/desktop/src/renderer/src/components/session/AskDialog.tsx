import type { AskAnswer, AskRequest, AskResponse } from "@drone/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import { Button } from "../ui/Button";
import { confirmOptionIndex, isDangerAskOption, isSimpleConfirm, orderedAskOptions } from "./ask-simple";

type Drafts = Record<string, AskAnswer>;

const overlayClass = "fixed inset-0 z-[70] flex items-center justify-center bg-ink/25 p-6";
const sheetClass =
	"flex max-h-[82vh] w-[min(680px,92vw)] flex-col overflow-hidden rounded-2xl border border-border bg-surface text-ink shadow-dialog";

export function AskDialog({
	requests,
	onRespond,
}: {
	requests: AskRequest[];
	onRespond: (requestId: string, response: AskResponse) => Promise<void> | void;
}) {
	const t = useT();
	const request = requests[0];
	const dialogRef = useRef<HTMLDivElement>(null);
	const [drafts, setDrafts] = useState<Drafts>({});
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// request.id 变化必须清 sending：连续 ask 不会卸载对话框，否则会卡在「提交中…」
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset when the ask id changes, even though the effect only uses setters
	useEffect(() => {
		setDrafts({});
		setError(null);
		setSending(false);
	}, [request?.id]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: focus when the ask id changes
	useEffect(() => {
		if (!request) return;
		const node = dialogRef.current?.querySelector<HTMLElement>("input, button");
		node?.focus();
	}, [request?.id]);
	const answered = useMemo(
		() =>
			request?.questions.filter((q) => {
				const answer = drafts[q.id];
				return Boolean(answer?.values?.length || answer?.customText?.trim());
			}).length ?? 0,
		[drafts, request],
	);
	const canSubmit = useMemo(
		() =>
			request?.questions.every((q) => {
				if (!q.required) return true;
				const answer = drafts[q.id];
				return Boolean(answer?.values?.length || answer?.customText?.trim());
			}) ?? false,
		[drafts, request],
	);
	if (!request) return null;

	const respond = async (response: AskResponse) => {
		if (sending && response.kind !== "cancel") return;
		setSending(true);
		setError(null);
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				Promise.resolve(onRespond(request.id, response)),
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new Error(t("ask.timeout"))), 15_000);
				}),
			]);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (timer) clearTimeout(timer);
			setSending(false);
		}
	};

	const simple = isSimpleConfirm(request);
	const question = request.questions[0];
	if (simple && question) {
		const confirmValue = question.options[confirmOptionIndex(request)]?.value;
		return (
			<div
				ref={dialogRef}
				className={overlayClass}
				role="dialog"
				aria-modal
				aria-label={request.title ?? t("ask.title")}
				data-testid="ask-simple"
			>
				<div className={sheetClass}>
					<div className="border-b border-border px-5 py-4">
						<p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
							{t("ask.eyebrow")}
						</p>
						<h3 className="mt-1 text-base font-semibold text-ink">{request.title ?? t("ask.title")}</h3>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
						<p className="whitespace-pre-wrap break-words rounded-lg bg-hover px-3 py-2.5 text-[13px] leading-relaxed text-ink select-text">
							{question.prompt}
						</p>
						{error && <p className="mt-3 text-[11px] text-err">{error}</p>}
					</div>
					<div className="border-t border-border px-5 py-3">
						<div className="flex items-center justify-between gap-3">
							<span className="min-w-0 truncate text-[10px] text-ink-faint">
								{requests.length > 1 ? t("ask.queued", { count: requests.length - 1 }) : t("ask.footerHint")}
							</span>
							<div className="flex shrink-0 gap-2">
								{orderedAskOptions(request).map((option) => {
									const confirm = option.value === confirmValue;
									return (
										<Button
											key={option.value}
											variant={confirm ? "primary" : "ghost"}
											tone={!confirm && isDangerAskOption(option) ? "danger" : "default"}
											disabled={sending}
											onClick={() =>
												void respond({
													kind: "answer",
													mode: "submit",
													answers: { [question.id]: { values: [option.value] } },
												})
											}
										>
											{option.label}
										</Button>
									);
								})}
							</div>
						</div>
					</div>
				</div>
			</div>
		);
	}

	const toggle = (questionId: string, value: string, multi: boolean) =>
		setDrafts((current) => {
			const prev = current[questionId] ?? {};
			const values = prev.values ?? [];
			const next = multi
				? values.includes(value)
					? values.filter((item) => item !== value)
					: [...values, value]
				: [value];
			return {
				...current,
				[questionId]: { ...prev, values: next, ...(multi ? {} : { customText: undefined }) },
			};
		});
	const setCustom = (questionId: string, customText: string, multi: boolean) =>
		setDrafts((current) => ({
			...current,
			[questionId]: {
				...(current[questionId] ?? {}),
				customText,
				...(multi || !customText.trim() ? {} : { values: [] }),
			},
		}));

	return (
		<div
			ref={dialogRef}
			className={overlayClass}
			role="dialog"
			aria-modal
			aria-label={request.title ?? t("ask.title")}
			data-testid="ask-dialog"
		>
			<div className={sheetClass}>
				<div className="border-b border-border px-5 py-4">
					<div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
						{t("ask.eyebrow")}
					</div>
					<h3 className="mt-1 text-base font-semibold text-ink">{request.title ?? t("ask.title")}</h3>
					<p className="mt-1 text-[12px] text-ink-dim">
						{t("ask.progress", { answered, total: request.questions.length })}
					</p>
				</div>
				<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
					{request.questions.map((item, questionIndex) => {
						const draft = drafts[item.id] ?? {};
						const selected = draft.values ?? [];
						const multi = item.type === "multi";
						const textOnly = item.type === "text";
						return (
							<section key={item.id} className="space-y-2.5">
								<div className="flex items-start gap-2">
									<span className="mt-0.5 rounded-md bg-hover px-1.5 py-0.5 text-[10px] font-medium text-ink-faint">
										{item.label || `Q${questionIndex + 1}`}
									</span>
									<div className="min-w-0 flex-1">
										<p className="text-[13px] font-medium leading-relaxed text-ink">{item.prompt}</p>
										{!textOnly && (
											<p className="mt-0.5 text-[10px] text-ink-faint">
												{multi ? t("ask.multiHint") : t("ask.singleHint")}
												{item.required ? ` · ${t("ask.required")}` : ""}
											</p>
										)}
									</div>
								</div>
								<div className="grid gap-1.5 pl-8">
									{!textOnly &&
										item.options.map((option) => {
											const active = selected.includes(option.value);
											return (
												<button
													key={option.value}
													type="button"
													onClick={() => toggle(item.id, option.value, multi)}
													className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${active ? "border-accent bg-accent/8" : "border-border bg-surface hover:bg-hover"}`}
												>
													<div className="flex items-center gap-2">
														<span
															className={`flex h-4 w-4 shrink-0 items-center justify-center ${multi ? "rounded" : "rounded-full"} border ${active ? "border-accent bg-accent text-white" : "border-border"}`}
														>
															{active ? "✓" : ""}
														</span>
														<span className="text-[12px] font-medium text-ink-2">{option.label}</span>
														{option.recommended && (
															<span className="rounded-full bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium text-warn">
																{t("ask.recommended")}
															</span>
														)}
													</div>
													{option.description && (
														<p className="mt-1 pl-6 text-[11px] leading-relaxed text-ink-dim">
															{option.description}
														</p>
													)}
													{option.preview && (
														<pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-hover p-2 text-[10px] leading-relaxed text-ink-2">
															{option.preview}
														</pre>
													)}
												</button>
											);
										})}
									<input
										value={draft.customText ?? ""}
										onChange={(event) => setCustom(item.id, event.target.value, multi)}
										placeholder={t("ask.customPlaceholder")}
										className="mt-0.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
									/>
								</div>
							</section>
						);
					})}
				</div>
				<div className="border-t border-border px-5 py-3">
					{error && <p className="mb-2 text-[11px] text-err">{error}</p>}
					<div className="flex items-center justify-between gap-3">
						<span className="min-w-0 truncate text-[10px] text-ink-faint">
							{requests.length > 1 ? t("ask.queued", { count: requests.length - 1 }) : t("ask.footerHint")}
						</span>
						<div className="flex shrink-0 gap-2">
							<Button onClick={() => void respond({ kind: "cancel" })}>{t("common.cancel")}</Button>
							<Button
								variant="primary"
								disabled={sending || !canSubmit}
								onClick={() => void respond({ kind: "answer", mode: "submit", answers: drafts })}
							>
								{sending ? t("ask.submitting") : t("ask.submit")}
							</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
