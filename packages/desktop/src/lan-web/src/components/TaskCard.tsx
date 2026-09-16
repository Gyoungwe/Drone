import { TASK_STATE_LABELS, type TaskView } from "@drone/shared";
import { t } from "../i18n";
import { CheckIcon, ChevronRightIcon, CircleIcon } from "./icons";

/** LAN 只读任务工作台：与桌面 TaskWorkbenchCard 共用同一份 taskView 投影，不发起任何 /task-action。
 *  路径/哈希等产物细节留在桌面端；这里只显示目标、状态、验收进度与待处理数量。 */
export function TaskCard({ view }: { view: TaskView }) {
	return (
		<details className="todo-bar drawer-details task-card" data-testid="lan-task-workbench" open>
			<summary>
				<div className="todo-top">
					{t("task.title")}
					<span className="cnt">{t("task.readonly")}</span>
					<ChevronRightIcon size={13} className="meta-caret" />
				</div>
			</summary>
			<div className="todo-items">
				<div className="task-note">{t("task.disclaimer")}</div>
				{view.selectionRequired && <div className="task-note">{t("task.selection")}</div>}
				{view.tasks.map((task) => {
					const done = task.milestones.filter((m) => m.state === "completed").length;
					const pending = task.actions.filter((a) => a.state === "pending").length;
					return (
						<div key={task.id} className="task-row" data-task-id={task.id}>
							<div className="task-head">
								<span className="task-goal">
									{task.id === view.activeTaskId ? "● " : ""}
									{task.goal}
								</span>
								<span className="task-state">{TASK_STATE_LABELS[task.state]}</span>
							</div>
							<div className="task-meta">
								{t("task.stage", {
									stage: task.stage,
									calls: task.budget.calls,
									total: view.limits.totalCalls,
								})}
								{task.milestones.length > 0 &&
									` · ${t("task.milestones", { done, total: task.milestones.length })}`}
								{pending > 0 && ` · ${t("task.pendingActions", { count: pending })}`}
								{task.milestones.length > 0 && !task.planApproved && ` · ${t("task.proposed")}`}
							</div>
							{task.milestones.map((m) => (
								<div key={m.id} className={`todo-item ${m.state === "completed" ? "done" : "todo"}`}>
									<span className="t-ic">
										{m.state === "completed" ? <CheckIcon size={12} /> : <CircleIcon size={12} />}
									</span>
									<span>{m.title}</span>
								</div>
							))}
						</div>
					);
				})}
			</div>
		</details>
	);
}
