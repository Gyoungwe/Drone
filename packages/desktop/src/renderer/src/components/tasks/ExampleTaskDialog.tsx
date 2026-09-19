import {
	activeExampleTaskMilestones,
	composeExampleTaskPrompt,
	type ExampleTask,
	type ExampleTaskInput,
	exampleTask,
	exampleTaskCommand,
	exampleTaskDefaults,
	missingExampleTaskInputs,
	WORKFLOW_DIRECTIONS,
	workflowStage,
} from "@drone/shared";
import { useEffect, useState } from "react";
import { getPi } from "../../api";
import { useSessionReadOnly } from "../../hooks/use-session-state";
import { useI18nStore, useT } from "../../i18n";
import { COMPOSER_FOCUS_EVENT, NEW_SESSION_DRAFT_KEY, useDraftStore } from "../../stores/drafts";
import { useExampleTaskStore } from "../../stores/example-tasks";
import { isDraftSessionId, useSessionsStore } from "../../stores/sessions";
import { pushToast } from "../../stores/toasts";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";
import { ensureActiveSession } from "../composer/use-composer-send";
import { Button } from "../ui/Button";

const INPUT_CLASS =
	"w-full rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-border-strong";

/** 对话框需要知道的会话事实（由 ExampleTaskDialog 从 store 读出；表单本身不订阅 store，便于按 props 测试） */
export interface ExampleTaskSessionContext {
	activeSessionId: string | null;
	/** 无会话/草稿会话时能否新建：有项目目录才行 */
	hasCwd: boolean;
	/** 只读会话（子代理产物检视）：不能发起也不能插入 */
	readOnly: boolean;
	/** 压缩进行中：SDK 拒绝 prompt，提前拦截 */
	compacting: boolean;
}

/**
 * 示例任务对话框：表单（必填校验、路径选择器）+ 只读里程碑预览 + 将遇到的确认。
 * 「发起」= 组装一条结构化首条消息并走与输入框相同的发送路径（ensureActiveSession + prompt）；
 * 不预先创建任务、不写文件、不自动执行——task_plan 与授权卡仍是唯一入口。
 */
export function ExampleTaskDialog() {
	const openId = useExampleTaskStore((s) => s.openId);
	const close = useExampleTaskStore((s) => s.close);
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const hasCwd = useSessionsStore((s) => Boolean(s.cwd));
	const readOnly = useSessionReadOnly();
	const compacting = useTranscriptStore((s) => selectTranscript(s, activeSessionId).compacting);
	const task = openId ? exampleTask(openId) : undefined;
	if (!task) return null;
	return (
		<ExampleTaskForm
			key={task.id}
			task={task}
			session={{ activeSessionId, hasCwd, readOnly, compacting }}
			onClose={close}
		/>
	);
}

export function ExampleTaskForm({
	task,
	session,
	onClose: close,
}: {
	task: ExampleTask;
	session: ExampleTaskSessionContext;
	onClose: () => void;
}) {
	const t = useT();
	const language = useI18nStore((s) => s.language);
	const { activeSessionId, hasCwd, readOnly, compacting } = session;
	const [values, setValues] = useState<Record<string, string>>(() => exampleTaskDefaults(task));
	const [showErrors, setShowErrors] = useState(false);
	const [sending, setSending] = useState(false);
	const [copied, setCopied] = useState(false);

	const needsNewSession = !activeSessionId || isDraftSessionId(activeSessionId);
	const missing = missingExampleTaskInputs(task, values);
	const prompt = composeExampleTaskPrompt(task, values, language);
	const direction = WORKFLOW_DIRECTIONS.find((d) => d.id === task.direction);
	const stages = task.stages.map((id) => workflowStage(id)?.label[language] ?? id);
	const milestones = activeExampleTaskMilestones(task, values);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") close();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [close]);

	const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

	const pick = async (input: ExampleTaskInput, kind: "file" | "directory") => {
		const picked = await getPi().pickPath(kind, values[input.key] || undefined);
		if (picked) setValue(input.key, picked);
	};

	const validate = (): boolean => {
		if (missing.length === 0) return true;
		setShowErrors(true);
		return false;
	};

	const launch = async () => {
		if (!validate() || sending) return;
		if (readOnly) {
			pushToast("warning", "examples.readOnly");
			return;
		}
		if (compacting) {
			pushToast("warning", "examples.compacting");
			return;
		}
		setSending(true);
		try {
			const sessionId = await ensureActiveSession();
			if (!sessionId) {
				pushToast("warning", "examples.noSession");
				return;
			}
			await getPi().prompt(sessionId, prompt);
			close();
		} catch (err) {
			pushToast("error", "examples.sendFailed", err instanceof Error ? err.message : String(err));
		} finally {
			setSending(false);
		}
	};

	const insert = () => {
		if (!validate()) return;
		const key = activeSessionId ?? NEW_SESSION_DRAFT_KEY;
		useDraftStore.getState().updateDraft(key, (draft) => ({ ...draft, text: prompt, slashCommand: null }));
		close();
		window.dispatchEvent(new Event(COMPOSER_FOCUS_EVENT));
	};

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(prompt);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// 剪贴板不可用时静默：消息仍可通过「插入到输入框」取得
		}
	};

	const launchLabel = sending
		? t("examples.launching")
		: needsNewSession
			? t("examples.launchNew")
			: t("examples.launch");
	const launchDisabled = sending || readOnly || (needsNewSession && !hasCwd);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20"
			role="dialog"
			aria-modal
			aria-labelledby="example-task-title"
			data-testid="example-task-dialog"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) close();
			}}
		>
			<div className="flex max-h-[85vh] w-[560px] flex-col rounded-xl border border-border bg-surface shadow-dialog">
				<header className="px-5 pt-4 pb-3">
					<p className="text-[11px] font-medium text-ink-faint">
						{t("examples.eyebrow")} · {direction?.label[language]}
					</p>
					<h3 id="example-task-title" className="mt-0.5 text-sm font-semibold text-ink">
						{task.title[language]}
					</h3>
					<p className="mt-1 text-[12px] leading-relaxed text-ink-2">{task.goal[language]}</p>
					<p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
						<span>
							{t("examples.stages")}：{stages.join(" → ")}
						</span>
						<span className="font-mono">/{exampleTaskCommand(task)}</span>
					</p>
				</header>

				<div className="min-h-0 flex-1 overflow-y-auto border-t border-border px-5 py-3">
					<section>
						<h4 className="text-[12px] font-medium text-ink">{t("examples.inputs")}</h4>
						<div className="mt-1.5 flex flex-col gap-2">
							{task.inputs.map((input) => {
								const invalid = showErrors && missing.includes(input.key);
								const id = `example-input-${input.key}`;
								return (
									<div key={input.key} data-testid="example-task-input" data-invalid={invalid || undefined}>
										<label htmlFor={id} className="mb-0.5 block text-[11px] text-ink-dim">
											{input.label[language]}
											{input.required ? (
												<span className="ml-1 text-red-500" title={t("examples.required")}>
													*
												</span>
											) : (
												<span className="ml-1 text-ink-faint">· {t("examples.optional")}</span>
											)}
										</label>
										{input.kind === "select" ? (
											<select
												id={id}
												className={INPUT_CLASS}
												value={values[input.key] ?? ""}
												onChange={(event) => setValue(input.key, event.target.value)}
											>
												{input.options?.map((option) => (
													<option key={option.value} value={option.value}>
														{option.label[language]}
													</option>
												))}
											</select>
										) : (
											<div className="flex items-center gap-1.5">
												<input
													id={id}
													type="text"
													className={`${INPUT_CLASS} ${invalid ? "border-red-500" : ""}`}
													value={values[input.key] ?? ""}
													placeholder={input.placeholder?.[language]}
													spellCheck={false}
													onChange={(event) => setValue(input.key, event.target.value)}
												/>
												{input.kind === "path" && input.pathKind !== "directory" && (
													<Button size="sm" className="shrink-0" onClick={() => void pick(input, "file")}>
														{t("examples.pickFile")}
													</Button>
												)}
												{input.kind === "path" && input.pathKind !== "file" && (
													<Button
														size="sm"
														className="shrink-0"
														onClick={() => void pick(input, "directory")}
													>
														{t("examples.pickFolder")}
													</Button>
												)}
											</div>
										)}
										{invalid && <p className="mt-0.5 text-[11px] text-red-500">{t("examples.missing")}</p>}
									</div>
								);
							})}
						</div>
					</section>

					<section className="mt-4">
						<h4 className="text-[12px] font-medium text-ink">{t("examples.milestones")}</h4>
						<ol className="mt-1.5 flex flex-col gap-1">
							{milestones.map((milestone, index) => (
								<li
									key={milestone.title.en}
									className="flex items-start gap-2 text-[12px] text-ink-2"
									data-testid="example-task-milestone"
								>
									<span className="w-4 shrink-0 tabular-nums text-ink-faint">{index + 1}.</span>
									<span className="min-w-0 flex-1">
										{milestone.title[language]}
										{milestone.acceptance.hint && (
											<span className="ml-1 font-mono text-[11px] text-ink-faint">
												→ {milestone.acceptance.hint}
											</span>
										)}
									</span>
									<span className="shrink-0 rounded-md bg-hover px-1.5 py-0.5 font-mono text-[11px] text-ink-dim">
										{milestone.acceptance.kind}
									</span>
								</li>
							))}
						</ol>
					</section>

					<section className="mt-4">
						<h4 className="text-[12px] font-medium text-ink">{t("examples.confirmations")}</h4>
						<ul className="mt-1.5 flex flex-col gap-1 text-[12px] text-ink-2">
							{task.authorizations.map((authorization) => (
								<li key={authorization} className="flex items-start gap-2">
									<span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
									<span>{t(`examples.auth.${authorization}`)}</span>
								</li>
							))}
						</ul>
					</section>

					<section className="mt-4 text-[12px] text-ink-2">
						<p>
							<span className="text-ink-faint">{t("examples.artifacts")}：</span>
							{task.artifacts.map((artifact) => artifact[language]).join(" · ")}
						</p>
						{task.contractNotes && (
							<p className="mt-1">
								<span className="text-ink-faint">{t("examples.boundary")}：</span>
								{task.contractNotes[language]}
							</p>
						)}
					</section>
					<p className="mt-4 text-[11px] leading-relaxed text-ink-faint">{t("examples.disclaimer")}</p>
				</div>

				<footer className="flex items-center gap-2 border-t border-border px-5 py-3">
					<Button size="sm" onClick={() => void copy()}>
						{copied ? t("examples.copied") : t("examples.copy")}
					</Button>
					<span className="flex-1" />
					<Button size="sm" onClick={close}>
						{t("common.cancel")}
					</Button>
					<Button size="sm" onClick={insert} disabled={readOnly}>
						{t("examples.insert")}
					</Button>
					<Button
						size="sm"
						variant="primary"
						data-testid="example-task-launch"
						disabled={launchDisabled}
						title={readOnly ? t("examples.readOnly") : undefined}
						onClick={() => void launch()}
					>
						{launchLabel}
					</Button>
				</footer>
			</div>
		</div>
	);
}
