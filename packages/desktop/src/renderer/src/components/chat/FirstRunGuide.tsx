import { exampleTaskForDirection } from "@drone/shared";
import { useState } from "react";
import { useI18nStore, useT } from "../../i18n";
import { useExampleTaskStore } from "../../stores/example-tasks";
import { useSettingsStore } from "../../stores/settings";

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

/** 首次打开空白会话时的轻量入门；任何入口被点击后不再打扰用户。 */
export function FirstRunGuide() {
	const t = useT();
	const language = useI18nStore((state) => state.language);
	const [visible, setVisible] = useState(() => !wasDismissed());
	if (!visible) return null;

	const choose = (action: () => void) => {
		dismiss();
		setVisible(false);
		action();
	};
	const example = exampleTaskForDirection("evidence");

	return (
		<section
			className="w-full max-w-[620px] rounded-xl border border-border bg-surface/90 p-3"
			data-testid="first-run-guide"
		>
			<header className="flex items-start justify-between gap-3">
				<div>
					<h2 className="text-[13px] font-semibold text-ink">{t("firstRun.title")}</h2>
					<p className="mt-1 text-[11px] leading-relaxed text-ink-dim">{t("firstRun.subtitle")}</p>
				</div>
				<button
					type="button"
					className="shrink-0 text-[11px] text-ink-faint hover:text-ink"
					onClick={() => choose(() => undefined)}
				>
					{t("firstRun.dismiss")}
				</button>
			</header>
			<div className="mt-3 grid gap-2 sm:grid-cols-3">
				<GuideAction
					title={t("firstRun.knowledge.title")}
					description={t("firstRun.knowledge.description")}
					button={t("firstRun.open")}
					onClick={() => choose(() => useSettingsStore.getState().openWith("knowledge"))}
					dataTestId="first-run-knowledge"
				/>
				<GuideAction
					title={t("firstRun.zotero.title")}
					description={t("firstRun.zotero.description")}
					button={t("firstRun.open")}
					onClick={() => choose(() => useSettingsStore.getState().openWith("zotero"))}
					dataTestId="first-run-zotero"
				/>
				<GuideAction
					title={t("firstRun.compute.title")}
					description={t("firstRun.compute.description")}
					button={t("firstRun.open")}
					onClick={() => choose(() => useSettingsStore.getState().openWith("compute"))}
					dataTestId="first-run-compute"
				/>
			</div>
			{example && (
				<button
					type="button"
					className="mt-3 flex w-full items-center justify-between gap-3 rounded-lg border border-accent/25 bg-accent/5 px-3 py-2 text-left hover:border-accent/45"
					onClick={() => choose(() => useExampleTaskStore.getState().open(example.id))}
					data-testid="first-run-example"
				>
					<span className="min-w-0">
						<strong className="block text-[12px] text-ink">{t("firstRun.example.title")}</strong>
						<span className="mt-0.5 block truncate text-[11px] text-ink-dim">{example.title[language]}</span>
					</span>
					<span className="shrink-0 text-[11px] font-medium text-accent">
						{t("firstRun.example.button")} →
					</span>
				</button>
			)}
		</section>
	);
}

function GuideAction({
	title,
	description,
	button,
	onClick,
	dataTestId,
}: {
	title: string;
	description: string;
	button: string;
	onClick: () => void;
	dataTestId: string;
}) {
	return (
		<div className="rounded-lg border border-border px-2.5 py-2" data-testid={dataTestId}>
			<strong className="block text-[12px] text-ink">{title}</strong>
			<p className="mt-1 min-h-8 text-[11px] leading-relaxed text-ink-faint">{description}</p>
			<button
				type="button"
				className="mt-2 text-[11px] font-medium text-accent hover:underline"
				onClick={onClick}
			>
				{button} →
			</button>
		</div>
	);
}
