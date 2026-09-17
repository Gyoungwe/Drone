const text = (value, max = 180) =>
	String(value || "")
		.replace(/\s+/g, " ")
		.slice(0, max);
/** Host observations, not a model estimate or scientific certification. */
export function remainingExplanation(task) {
	const milestones = task.milestones || [],
		remaining = milestones.filter((m) => m.state !== "completed");
	const lines = [
		milestones.length
			? `已验收 ${milestones.length - remaining.length}/${milestones.length} 项；剩余 ${remaining.length} 项。进度按交付项验收计算，不按调用次数计算。`
			: "尚未约定可验收的交付项，暂不计算完成百分比；下一步先明确交付物和完成标准。",
	];
	for (const m of remaining) {
		const deps = (m.dependsOn || [])
			.map((id) => milestones.find((x) => x.id === id))
			.filter((x) => x && x.state !== "completed");
		const action = (task.actions || []).find((a) => a.milestoneId === m.id && a.state === "pending");
		const recorded = (task.operations || []).some(
			(o) => o.artifact?.path === m.acceptance.path && !o.artifact?.intentOnly && o.state !== "started",
		);
		let reason, next;
		if (deps.length) {
			reason = `前置项尚未验收：${deps.map((d) => text(d.title, 70)).join("、")}`;
			next = "先完成前置项，再核对本项";
		} else if (action) {
			reason = `等待你处理：${text(action.title)}；${text(action.reason)}`;
			next =
				action.kind === "authorization"
					? "通过 ask_user 确认此次新增范围"
					: action.kind === "file" || action.kind === "download"
						? "提交已有文件路径，由程序核对，不重复下载"
						: "完成所列人工审阅后再明确确认";
		} else if (m.acceptance.kind === "wiki_review") {
			reason = "尚未记录有效的 Wiki 审阅通过结果";
			next = "在原 Wiki 审阅入口核对候选与差异，不能用普通任务确认代替";
		} else if (m.acceptance.kind === "human_review") {
			reason = "尚未记录所需人工审阅";
			next = "说明具体审阅内容，实际审阅后再确认；Agent 不代替人工证明";
		} else if (recorded) {
			reason = "已有产物记录，但本项验收尚未通过";
			next = "先核对实际路径、文件版本和完成标准，不要重复生成";
		} else if (m.evidence?.code === "ENOENT") {
			reason = "最近一次验收在约定路径未找到文件，不代表其他位置没有产物";
			next = `先核对约定路径 ${text(m.acceptance.path, 140)} 与实际保存位置，再决定是否补做`;
		} else {
			reason = "尚无通过验收的记录；不能据此断言文件不存在或工作未做";
			next = `先核对${text(m.acceptance.path || m.acceptance.doi || "现有结果", 140)}，确实缺少时再在已授权范围内补齐`;
		}
		lines.push(`• ${text(m.title)}\n  原因：${reason}\n  下一步：${next}。`);
	}
	if ((task.operations || []).some((o) => ["started", "unknown"].includes(o.state)))
		lines.push("有操作结果不确定：先只读核对实际结果，不能直接重试写入。");
	for (const a of (task.actions || []).filter(
		(a) => a.state === "pending" && !remaining.some((m) => m.id === a.milestoneId),
	))
		lines.push(`需要你：${text(a.title)}；${text(a.reason)}。`);
	if (milestones.length && !remaining.length)
		lines.push("记录中的交付项均已验收；如仍有待处理事项，以其实际状态为准，不自动扩大任务范围。");
	return lines.join("\n").slice(0, 10000);
}
