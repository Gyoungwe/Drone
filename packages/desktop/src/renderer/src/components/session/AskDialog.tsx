import type { AskAnswer, AskDecisionProposal, AskQuestion, AskRequest, AskResponse } from "@drone/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import { ActionSurface } from "../ui/ActionSurface";
import { Button } from "../ui/Button";
import { confirmOptionIndex, isDangerAskOption, isSimpleConfirm, orderedAskOptions } from "./ask-simple";
import { formatCardText } from "./format-card-text";

type Drafts = Record<string, AskAnswer>;

function Recommendation({ question, t }: { question: AskQuestion; t: ReturnType<typeof useT> }) {
	const recommendation = question.recommendation;
	if (!recommendation) return null;
	const label =
		question.options.find((option) => option.value === recommendation.value)?.label ?? recommendation.value;
	return (
		<div className="mt-3 rounded-xl border border-border bg-hover px-3 py-3" data-testid="ask-recommendation">
			<div className="flex flex-wrap items-center gap-2 text-xs">
				<span className="font-semibold text-ink-2">{t("ask.modelRecommendation")}</span>
				<span className="rounded-full bg-hover px-2 py-0.5 font-medium text-ink-2">{label}</span>
				{recommendation.confidence && (
					<span className="text-[11px] text-ink-faint">
						{t("ask.confidence", { value: recommendation.confidence })}
					</span>
				)}
			</div>
			<p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-ink-2">
				{formatCardText(recommendation.reason)}
			</p>
			{recommendation.basedOn?.length ? (
				<p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-ink-dim">
					{formatCardText(t("ask.basedOn", { value: recommendation.basedOn.join(" · ") }))}
				</p>
			) : null}
		</div>
	);
}

function ProposalProjection({ proposal, t }: { proposal: AskDecisionProposal; t: ReturnType<typeof useT> }) {
	const sections: Array<[string, string[] | undefined]> = [
		[t("ask.proposal.benefits"), proposal.benefits],
		[t("ask.proposal.costs"), proposal.costs],
		[t("ask.proposal.risks"), proposal.risks],
		[t("ask.proposal.resources"), proposal.resources],
	];
	return (
		<section
			className="space-y-2 rounded-xl border border-border bg-hover px-3 py-3"
			data-testid="decision-proposal"
		>
			<div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2">
				{t("ask.proposal.title")}
			</div>
			{proposal.recommendation && (
				<div className="text-[12px] text-ink-2">
					<span className="font-medium">
						{t("ask.proposal.recommendation", { value: proposal.recommendation.value })}
					</span>
					<span className="ml-2 text-ink-dim">{proposal.recommendation.reason}</span>
				</div>
			)}
			{proposal.reason && (
				<p className="text-[12px] text-ink-2">{t("ask.proposal.reason", { value: proposal.reason })}</p>
			)}
			{proposal.evidence?.length ? (
				<p className="text-xs text-ink-dim">
					{t("ask.proposal.evidence", { value: proposal.evidence.join(" · ") })}
				</p>
			) : null}
			{sections.map(([label, values]) =>
				values?.length ? (
					<div key={label} className="text-xs text-ink-dim">
						<span className="font-medium text-ink-2">{label}：</span>
						{values.join("；")}
					</div>
				) : null,
			)}
			{proposal.authorizationActions?.length ? (
				<div className="text-xs text-ink-dim">
					<span className="font-medium text-ink-2">{t("ask.proposal.authorization")}：</span>
					{proposal.authorizationActions
						.map(
							(action) =>
								`${action.label}${action.risk === "high" ? `（${t("ask.proposal.highRisk")}）` : ""}`,
						)
						.join("；")}
				</div>
			) : null}
		</section>
	);
}

export function AskDialog({
	requests,
	onRespond,
}: {
	requests: AskRequest[];
	onRespond: (requestId: string, response: AskResponse) => Promise<void> | void;
}) {
	const t = useT();
	const request = requests[0];
	const proposal = request?.proposal ?? request?.decisionProposal;
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
			<ActionSurface
				contentRef={dialogRef}
				ariaLabel={request.title ?? t("ask.title")}
				tone={request.kind === "authorization" ? "warn" : "accent"}
				height="fit"
				testId="ask-simple"
			>
				<div className="border-b border-border px-5 py-4">
					<p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
						{t("ask.eyebrow")}
					</p>
					<h3 className="mt-1 text-base font-semibold text-ink">{request.title ?? t("ask.title")}</h3>
					{(request.kind ?? request.purpose) && (
						<p className="mt-1 text-xs text-ink-dim">
							{request.kind === "authorization" ? t("ask.authorization") : t("ask.clarification")}
						</p>
					)}
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
					{proposal && <ProposalProjection proposal={proposal} t={t} />}
					<p className="whitespace-pre-wrap break-words rounded-lg bg-hover px-3 py-3 text-[13px] leading-relaxed text-ink select-text">
						{formatCardText(question.prompt)}
					</p>
					<Recommendation question={question} t={t} />
					{error && <p className="mt-3 text-xs text-err">{error}</p>}
				</div>
				<div className="border-t border-border px-5 py-3">
					<div className="flex items-center justify-between gap-3">
						<span className="min-w-0 truncate text-[11px] text-ink-faint">
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
			</ActionSurface>
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
		<ActionSurface
			contentRef={dialogRef}
			ariaLabel={request.title ?? t("ask.title")}
			tone={request.kind === "authorization" ? "warn" : "accent"}
			testId="ask-dialog"
		>
			<div className="border-b border-border px-5 py-4">
				<div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
					{t("ask.eyebrow")}
				</div>
				<h3 className="mt-1 text-base font-semibold text-ink">{request.title ?? t("ask.title")}</h3>
				{(request.kind ?? request.purpose) && (
					<p className="mt-1 text-xs text-ink-dim">
						{request.kind === "authorization" ? t("ask.authorization") : t("ask.clarification")}
					</p>
				)}
				<p className="mt-1 text-[12px] text-ink-dim">
					{t("ask.progress", { answered, total: request.questions.length })}
				</p>
			</div>
			<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
				{proposal && <ProposalProjection proposal={proposal} t={t} />}
				{request.questions.map((item, questionIndex) => {
					const draft = drafts[item.id] ?? {};
					const selected = draft.values ?? [];
					const multi = item.type === "multi";
					const textOnly = item.type === "text";
					return (
						<section
							key={item.id}
							className="space-y-3 rounded-xl border border-border bg-surface px-3 py-3 shadow-soft"
						>
							<div className="flex items-start gap-2">
								<span className="mt-0.5 rounded-md bg-hover px-2 py-0.5 text-[11px] font-medium text-ink-faint">
									{item.label || `Q${questionIndex + 1}`}
								</span>
								<div className="min-w-0 flex-1">
									<p className="whitespace-pre-wrap text-[13px] font-medium leading-relaxed text-ink">
										{formatCardText(item.prompt)}
									</p>
									{!textOnly && (
										<p className="mt-0.5 text-[11px] text-ink-faint">
											{multi ? t("ask.multiHint") : t("ask.singleHint")}
											{item.required ? ` · ${t("ask.required")}` : ""}
										</p>
									)}
								</div>
							</div>
							<Recommendation question={item} t={t} />
							<div className="grid gap-2">
								{!textOnly &&
									item.options.map((option) => {
										const active = selected.includes(option.value);
										return (
											<button
												key={option.value}
												type="button"
												onClick={() => toggle(item.id, option.value, multi)}
												className={`rounded-xl border px-3 py-3 text-left transition-colors ${active ? "border-ink-faint bg-[var(--highlight)]" : "border-border bg-surface hover:bg-hover"}`}
											>
												<div className="flex items-center gap-2">
													<span
														className={`flex h-4 w-4 shrink-0 items-center justify-center ${multi ? "rounded" : "rounded-full"} border ${active ? "border-ink bg-ink text-on-ink" : "border-border"}`}
													>
														{active ? "✓" : ""}
													</span>
													<span className="text-[12px] font-medium text-ink-2">{option.label}</span>
													{option.recommended && (
														<span className="rounded-full bg-warn/10 px-2 py-0.5 text-xs font-medium text-warn">
															{t("ask.recommended")}
														</span>
													)}
												</div>
												{option.description && (
													<p className="mt-1 pl-6 whitespace-pre-wrap text-xs leading-relaxed text-ink-dim">
														{formatCardText(option.description)}
													</p>
												)}
												{option.preview && (
													<pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-hover p-2 text-xs leading-relaxed text-ink-2">
														{option.preview}
													</pre>
												)}
											</button>
										);
									})}
								{(item.allowCustomText ?? true) && (
									<input
										value={draft.customText ?? ""}
										onChange={(event) => setCustom(item.id, event.target.value, multi)}
										placeholder={t("ask.customPlaceholder")}
										className="mt-0.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
									/>
								)}
							</div>
						</section>
					);
				})}
			</div>
			<div className="border-t border-border px-5 py-3">
				{error && <p className="mb-2 text-xs text-err">{error}</p>}
				<div className="flex items-center justify-between gap-3">
					<span className="min-w-0 truncate text-[11px] text-ink-faint">
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
		</ActionSurface>
	);
}
