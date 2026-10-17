import { useT } from "../../i18n";
import { Composer } from "../composer/Composer";
import { ProjectBranchPicker } from "../projects/ProjectBranchPicker";
import { HomeCards } from "./HomeCards";

/** 空态（U8）：问候语 + 一句介绍（Wordmark 移到「关于」） + 居中输入框 + 项目/分支选择（对标 opencode 新会话页） */
export function EmptyState() {
	const t = useT();
	const hour = new Date().getHours();
	const greeting = hour < 5 || hour >= 18 ? "evening" : hour < 12 ? "morning" : "afternoon";

	return (
		<div className="flex h-full min-h-0 flex-col items-center justify-start gap-8 overflow-y-auto px-8 py-10 pb-[8vh]">
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
