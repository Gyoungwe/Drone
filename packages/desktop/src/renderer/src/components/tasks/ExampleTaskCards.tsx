import { EXAMPLE_TASKS } from "@drone/shared";
import { useI18nStore, useT } from "../../i18n";
import { useExampleTaskStore } from "../../stores/example-tasks";

/**
 * 「任务」页签空态：六张方向示例卡（一方向一例）。点击只打开示例对话框，
 * 不创建任务、不写文件；真正的任务由模型调用 task_plan 并经授权卡批准后才存在。
 */
export function ExampleTaskCards() {
	const t = useT();
	const language = useI18nStore((s) => s.language);
	const open = useExampleTaskStore((s) => s.open);
	return (
		<section className="panel-card" data-testid="example-task-cards">
			<header className="flex items-center gap-2">
				<span className="text-[12px] font-medium text-ink">{t("examples.emptyTitle")}</span>
			</header>
			<p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{t("examples.emptyHint")}</p>
			<ul className="mt-2 flex flex-col gap-1.5">
				{EXAMPLE_TASKS.map((task) => (
					<li key={task.id}>
						<button
							type="button"
							data-testid="example-task-card"
							data-example-task={task.id}
							className="flex w-full items-start gap-2.5 rounded-lg border border-border px-2.5 py-2 text-left transition-colors hover:border-border-strong hover:bg-hover"
							onClick={() => open(task.id)}
						>
							<span className="mt-[1px] shrink-0 rounded-md bg-hover px-1.5 py-0.5 text-[11px] font-medium text-ink-dim">
								{t(`examples.tag.${task.direction}`)}
							</span>
							<span className="min-w-0 flex-1">
								<span className="block truncate text-[13px] font-medium text-ink">
									{task.title[language]}
								</span>
								<span className="mt-0.5 line-clamp-2 block text-[11px] leading-relaxed text-ink-faint">
									{task.goal[language]}
								</span>
							</span>
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}
