import { useEffect } from "react";
import { useT } from "../../i18n";
import { PluginEntryHost, usePluginEntries } from "../../plugins/PluginRegions";
import { UI_REGIONS } from "../../plugins/slots";
import { useUiStore } from "../../stores/ui";
import { Composer } from "../composer/Composer";
import { ProjectBranchPicker } from "../projects/ProjectBranchPicker";
import { HomeCards } from "./HomeCards";

/** 空态（U8）：问候语 + 一句介绍（Wordmark 移到「关于」） + 居中输入框 + 项目/分支选择（对标 opencode 新会话页） */
export function EmptyState() {
	const t = useT();
	const homeSections = usePluginEntries(UI_REGIONS.HomeSection);
	useEffect(() => {
		useUiStore.getState().setPanelOpen(false);
	}, []);
	const hour = new Date().getHours();
	const greeting = hour < 5 || hour >= 18 ? "evening" : hour < 12 ? "morning" : "afternoon";

	return (
		<div className="flex h-full min-h-0 flex-col items-center overflow-y-auto px-8 py-10">
			{/* my-auto centres the whole group vertically and still scrolls when the window is short. */}
			<div className="my-auto flex w-full flex-col items-center gap-8 pb-[4vh]">
				<div className="text-center" data-testid="home-greeting">
					<h1 className="font-serif-sc text-[28px] text-ink">{t(`home.greeting.${greeting}`)}</h1>
					<p className="mt-2 text-[13px] text-ink-faint">{t("home.intro")}</p>
				</div>
				{/* The project picker belongs to the composer, so it sits directly under it. */}
				<div className="flex w-full flex-col items-center gap-2">
					<Composer centered />
					<ProjectBranchPicker />
				</div>
				<HomeCards />
				{homeSections.map((entry) => (
					<div key={entry.id} className="w-full" data-plugin={entry.pluginName}>
						<PluginEntryHost entry={entry} />
					</div>
				))}
			</div>
		</div>
	);
}
