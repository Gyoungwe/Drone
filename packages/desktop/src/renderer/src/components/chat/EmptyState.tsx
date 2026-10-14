import { useEffect } from "react";
import { useT } from "../../i18n";
import { useProjectsStore } from "../../stores/projects";
import { Composer } from "../composer/Composer";
import { ProjectBranchPicker } from "../projects/ProjectBranchPicker";
import { HomeCards } from "./HomeCards";

/** 空态（U8）：问候语 + 一句介绍（Wordmark 移到「关于」） + 居中输入框 + 项目/分支选择（对标 opencode 新会话页） */
export function EmptyState() {
	const t = useT();
	const load = useProjectsStore((s) => s.load);
	const hour = new Date().getHours();
	const greeting = hour < 5 || hour >= 18 ? "evening" : hour < 12 ? "morning" : "afternoon";

	useEffect(() => {
		void load();
	}, [load]);

	return (
		<div className="empty-state flex h-full flex-col items-center justify-center gap-8 px-8 pb-[8vh]">
			<div className="text-center" data-testid="home-greeting">
				<h1 className="font-serif-sc text-[28px] text-ink">{t(`home.greeting.${greeting}`)}</h1>
				<p className="mt-2 text-[13px] text-ink-faint">{t("home.intro")}</p>
			</div>
			<HomeCards />
			<Composer centered />
			<ProjectBranchPicker />
		</div>
	);
}
