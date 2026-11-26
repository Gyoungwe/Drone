import { useEffect } from "react";
import { useT } from "../../i18n";
import { useSettingsStore } from "../../stores/settings";

export function SessionPackageVersionsCard({ sessionId }: { sessionId: string | null }) {
	const t = useT();
	const refresh = useSettingsStore((state) => state.refreshSessionResources);
	const packages = useSettingsStore((state) =>
		state.packageVersions?.sessionId === sessionId ? state.packageVersions?.packages : undefined,
	);
	useEffect(() => {
		if (sessionId) void refresh(sessionId);
	}, [sessionId, refresh]);
	if (!packages?.length) return null;
	return (
		<section className="panel-card" aria-label={t("skillsConnections.sessionPackages")}>
			<h3 className="text-[12px] font-medium text-ink">{t("skillsConnections.sessionPackages")}</h3>
			<ul className="mt-2 space-y-2">
				{packages.map(({ packageName, scope, currentVersion, nextSessionVersion }) => (
					<li
						key={`${scope}:${packageName}`}
						data-package-name={packageName}
						className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]"
					>
						<span className="break-all font-medium text-ink">{packageName}</span>
						{currentVersion && (
							<span className="text-ink-faint">
								{t("skillsConnections.currentSessionVersion", { version: currentVersion })}
							</span>
						)}
						{nextSessionVersion !== undefined && (
							<span className="text-warn">
								{nextSessionVersion === null
									? t("skillsConnections.removedNextSession")
									: t("skillsConnections.nextSessionVersion", { version: nextSessionVersion })}
							</span>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}
