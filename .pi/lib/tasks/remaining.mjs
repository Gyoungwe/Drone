import { acceptanceVerifier, effectiveAcceptance } from "./acceptance.mjs";

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
			? `已验收 ${milestones.length - remaining.length}/${milestones.length} 项；剩余 ${remaining.length} 项。`
			: "还没约定要交付什么，暂不计算完成百分比；先说清楚想要什么结果、做到什么程度算完成。",
	];
	for (const m of remaining) {
		const acceptance = effectiveAcceptance(m);
		const deps = (m.dependsOn || [])
			.map((id) => milestones.find((x) => x.id === id))
			.filter((x) => x && x.state !== "completed");
		const action = (task.actions || []).find((a) => a.milestoneId === m.id && a.state === "pending");
		const recorded = (task.operations || []).some(
			(o) => o.artifact?.path === acceptance.path && !o.artifact?.intentOnly && o.state !== "started",
		);
		let reason, next;
		if (deps.length) {
			reason = `前置项尚未验收：${deps.map((d) => text(d.title, 70)).join("、")}`;
			next = "先把前面这几项做完，这一项自然会跟上";
		} else if (action) {
			reason = `等待你处理：${text(action.title)}；${text(action.reason)}`;
			next =
				action.kind === "authorization"
					? "在弹出的确认框里点同意"
					: action.kind === "rebind"
						? "在弹出的确认框里决定是否换成新的文献"
						: action.kind === "file" || action.kind === "download"
							? "把已有文件的路径填进来，程序会核对，不用重新下载"
							: "亲自看过之后回来确认一下";
		} else if (acceptanceVerifier(m.acceptance.kind)?.pending) {
			// 扩展登记的验收种类自带未完成说明（挂钩 2）；传入含运行期绑定身份的有效验收
			const hint = acceptanceVerifier(m.acceptance.kind).pending({ ...m, acceptance }) || {};
			reason = hint.reason || `这一项要等 ${m.acceptance.kind} 核对通过`;
			next = hint.next || "先核对已有结果，再决定是否继续";
		} else if (m.acceptance.kind === "human_review") {
			reason = "这一项约定要你亲自看过才算数，目前还没有";
			next = "内容准备好后请过目一遍，看完确认即可";
		} else if (recorded) {
			reason = "已有产物记录，但和约定的标准还没对上";
			next = "先看看已生成的文件对不对（位置、版本、内容），别急着重新生成";
		} else if (m.evidence?.code === "ENOENT") {
			reason = "在约定的位置没找到文件——也可能是存到别处了";
			next = `看一下 ${text(acceptance.path, 140)} 和实际保存的位置是不是同一个，确实没有再补做`;
		} else {
			reason = "这一项还没确认完成；不能据此断言文件不存在或工作未做";
			next = `先看看${text(acceptance.path || acceptance.doi || "现有结果", 140)}，确实缺了再补`;
		}
		lines.push(`• ${text(m.title)}\n  原因：${reason}\n  下一步：${next}。`);
	}
	if ((task.operations || []).some((o) => ["started", "unknown"].includes(o.state)))
		lines.push("有操作上次没等到结果：先核对它实际做没做成，别直接重来一遍。");
	for (const a of (task.actions || []).filter(
		(a) => a.state === "pending" && !remaining.some((m) => m.id === a.milestoneId),
	))
		lines.push(`需要你：${text(a.title)}；${text(a.reason)}。`);
	// 写入回执带回了身份，但每个同类里程碑都已点名别的文献：不改契约，提示走改绑
	// （同类里程碑都已验收时，这些只是额外的写入，不需要提示）
	for (const u of (task.unboundIdentities || [])
		.filter((u) => remaining.some((m) => m.acceptance.kind === u.kind))
		.slice(-4))
		lines.push(
			`已记录但未对应到任何交付项：${text(u.doi || u.kind, 140)}。若计划里写的文献有误，用 task_wait kind=rebind（milestoneId + doi + reason）请用户确认更换。`,
		);
	if (milestones.length && !remaining.length) {
		lines.push("约定的交付都已确认完成。还想做别的，直接说就行。");
		// 命令/外部操作没有可读回的产物，宿主只有它们的返回记录；如实标注，不据此否决交付
		const returned = (task.operations || []).filter((o) => o.state === "returned").length;
		const failed = (task.operations || []).filter((o) => o.state === "failed").length;
		if (returned)
			lines.push(`其中 ${returned} 步命令/外部操作只有返回记录、没有独立核对；交付以验收过的文件为准。`);
		if (failed) lines.push(`过程中有 ${failed} 步操作出过错；交付以最终验收过的文件为准。`);
	}
	return lines.join("\n").slice(0, 10000);
}
