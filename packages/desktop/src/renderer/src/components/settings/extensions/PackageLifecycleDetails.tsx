import type { PackageLifecycleReceipt } from "@drone/shared";
import { useT } from "../../../i18n";

const effectLabels = {
	"current-session": "effectiveCurrent",
	"next-session": "effectiveNext",
	"app-restart": "effectiveRestart",
} as const;

export function PackageLifecycleDetails({
	receipt,
	context = "settings.extensions",
}: {
	receipt: PackageLifecycleReceipt | undefined;
	context?: "settings.extensions" | "skillsConnections";
}) {
	const t = useT();
	if (!receipt) return null;
	const failed = receipt.status === "failed";
	return (
		<div className="mt-1 text-[11px]">
			<p className={failed ? "text-err" : "text-ok"}>
				{t(failed ? "settings.extensions.lifecycleFailed" : `${context}.${effectLabels[receipt.effect]}`)}
			</p>
			{receipt.events.length > 0 && (
				<details className="mt-1 text-ink-faint">
					<summary className="cursor-pointer">{t("settings.extensions.lifecycleDetails")}</summary>
					<ol className="ml-4 list-decimal">
						{receipt.events.map(({ type, at }) => (
							<li key={`${type}:${at}`}>{t(`settings.extensions.lifecycleStages.${type}`)}</li>
						))}
					</ol>
					{failed && receipt.error && <p>{t(`settings.extensions.lifecycleErrors.${receipt.error.code}`)}</p>}
				</details>
			)}
		</div>
	);
}

export function PackageOperationProgress({ label }: { label: string }) {
	return (
		<div className="mt-2 flex items-center gap-2" role="progressbar" aria-label={label}>
			<div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-hover">
				<div className="h-full w-1/2 animate-pulse rounded-full bg-accent" />
			</div>
			<span className="text-[10px] text-ink-faint">{label}</span>
		</div>
	);
}
