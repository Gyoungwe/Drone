import { exampleTaskForDirection } from "@drone/shared";
import { useEffect, useState } from "react";
import { getPi } from "../../api";
import { useI18nStore, useT } from "../../i18n";
import { useExampleTaskStore } from "../../stores/example-tasks";
import { useProjectsStore } from "../../stores/projects";
import { useSettingsStore } from "../../stores/settings";
import { type FirstRunStatus, firstRunComplete, probeFirstRunStatus } from "./first-run-status";

const STORAGE_KEY = "drone.first-run-guide.dismissed.v1";

function wasDismissed(): boolean {
	try {
		return typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

function dismiss(): void {
	try {
		localStorage.setItem(STORAGE_KEY, "1");
	} catch {
		// The guide remains available when browser storage is unavailable.
	}
}

/** Two-stage introduction. Opening settings does not mark setup as complete. */
export function FirstRunGuide() {
	const t = useT();
	const language = useI18nStore((state) => state.language);
	const [visible, setVisible] = useState(() => !wasDismissed());
	const [phase, setPhase] = useState<"start" | "setup">("start");
	const cwd = useProjectsStore((state) => state.selectedCwd);
	const [status, setStatus] = useState<FirstRunStatus | null>(null);
	useEffect(() => {
		if (!visible || typeof window === "undefined" || !window.pi) return;
		let live = true;
		void probeFirstRunStatus(getPi(), cwd).then((next) => {
			if (live) setStatus(next);
		});
		return () => {
			live = false;
		};
	}, [visible, cwd]);
	if (!visible || firstRunComplete(status)) return null;

	const choose = (action: () => void) => {
		dismiss();
		setVisible(false);
		action();
	};
	const example = exampleTaskForDirection("evidence");

	if (phase === "start") {
		return (
			<section className="first-run-guide w-full max-w-[620px] px-1 py-2" data-testid="first-run-guide">
				<header className="flex items-start justify-between gap-3">
					<div>
						<h2 className="text-[13px] font-semibold text-ink">{t("firstRun.startTitle")}</h2>
						<p className="mt-1 text-xs leading-relaxed text-ink-dim">{t("firstRun.startSubtitle")}</p>
					</div>
					<button
						type="button"
						className="shrink-0 text-[11px] text-ink-faint hover:text-ink"
						onClick={() => choose(() => undefined)}
					>
						{t("firstRun.dismiss")}
					</button>
				</header>
				<div className="mt-3 grid gap-2 sm:grid-cols-2">
					{example ? (
						<button
							type="button"
							className="first-run-card rounded-2xl bg-hover px-4 py-3 text-left transition-colors hover:bg-[var(--highlight)]"
							onClick={() => choose(() => useExampleTaskStore.getState().open(example.id))}
							data-testid="first-run-example"
						>
							<strong className="block text-[12px] text-ink">{t("firstRun.example.title")}</strong>
							<span className="mt-1 block truncate text-xs text-ink-dim">{example.title[language]}</span>
							<span className="mt-2 block text-xs font-medium text-ink-2">
								{t("firstRun.example.button")} →
							</span>
						</button>
					) : null}
					<button
						type="button"
						className="first-run-card rounded-2xl bg-hover px-4 py-3 text-left transition-colors hover:bg-[var(--highlight)]"
						onClick={() => setPhase("setup")}
						data-testid="first-run-setup"
					>
						<strong className="block text-[12px] text-ink">{t("firstRun.setup.title")}</strong>
						<span className="mt-1 block text-xs leading-relaxed text-ink-dim">
							{t("firstRun.setup.description")}
						</span>
					</button>
				</div>
			</section>
		);
	}

	return (
		<section
			className="first-run-guide w-full max-w-[620px] rounded-xl border border-border bg-surface/90 p-3"
			data-testid="first-run-guide"
		>
			<header className="flex items-start justify-between gap-3">
				<div>
					<h2 className="text-[13px] font-semibold text-ink">{t("firstRun.setup.title")}</h2>
					<p className="mt-1 text-xs leading-relaxed text-ink-dim">{t("firstRun.setup.subtitle")}</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<button
						type="button"
						className="text-[11px] text-ink-faint hover:text-ink"
						onClick={() => setPhase("start")}
					>
						{t("firstRun.back")}
					</button>
					<button
						type="button"
						className="text-[11px] text-ink-faint hover:text-ink"
						onClick={() => choose(() => undefined)}
					>
						{t("firstRun.dismiss")}
					</button>
				</div>
			</header>
			<div className="mt-3 grid gap-2 sm:grid-cols-3">
				<GuideAction
					title={t("firstRun.knowledge.title")}
					description={t("firstRun.knowledge.description")}
					button={t("firstRun.open")}
					onClick={() => useSettingsStore.getState().openWith("knowledge")}
					dataTestId="first-run-knowledge"
					done={status?.knowledge ?? false}
					doneLabel={t("firstRun.configured")}
				/>
				<GuideAction
					title={t("firstRun.zotero.title")}
					description={t("firstRun.zotero.description")}
					button={t("firstRun.open")}
					onClick={() => useSettingsStore.getState().openWith("zotero")}
					dataTestId="first-run-zotero"
					done={status?.zotero ?? false}
					doneLabel={t("firstRun.configured")}
				/>
				<GuideAction
					title={t("firstRun.compute.title")}
					description={t("firstRun.compute.description")}
					button={t("firstRun.open")}
					onClick={() => useSettingsStore.getState().openWith("compute")}
					dataTestId="first-run-compute"
					done={status?.compute ?? false}
					doneLabel={t("firstRun.configured")}
				/>
			</div>
		</section>
	);
}

function GuideAction({
	title,
	description,
	button,
	onClick,
	dataTestId,
	done = false,
	doneLabel,
}: {
	title: string;
	description: string;
	button: string;
	onClick: () => void;
	dataTestId: string;
	done?: boolean;
	doneLabel?: string;
}) {
	return (
		<div
			className={`first-run-card rounded-lg border px-3 py-2 ${done ? "border-ok/40 bg-ok/5" : "border-border"}`}
			data-testid={dataTestId}
			data-done={done ? "true" : undefined}
		>
			<strong className="flex items-center justify-between gap-2 text-[12px] text-ink">
				{title}
				{done ? (
					<span className="rounded-full bg-ok/12 px-2 py-0.5 text-xs font-medium text-ok">{doneLabel}</span>
				) : null}
			</strong>
			<p className="mt-1 min-h-8 text-[11px] leading-relaxed text-ink-faint">{description}</p>
			<button type="button" className="mt-2 text-xs font-medium text-link hover:underline" onClick={onClick}>
				{button} →
			</button>
		</div>
	);
}
