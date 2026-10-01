/**
 * Render a bounded, host-observed explanation of the work that remains in a
 * task. This policy deliberately describes missing confirmation and next
 * checks; it never infers that a file is absent or grants permission to retry
 * an operation.
 *
 * The acceptance registry belongs to the host/extension runtime. Callers can
 * provide its two small read-only hooks so this package remains independent of
 * the `.pi` runtime while still rendering extension-specific pending hints.
 */

export interface RemainingAcceptance {
	kind?: unknown;
	path?: unknown;
	[key: string]: unknown;
}

export interface RemainingMilestone {
	id?: unknown;
	title?: unknown;
	state?: unknown;
	dependsOn?: unknown;
	acceptance?: RemainingAcceptance;
	evidence?: { code?: unknown; [key: string]: unknown };
	bound?: { fields?: unknown; [key: string]: unknown };
	[key: string]: unknown;
}

export interface RemainingTaskOperation {
	state?: unknown;
	artifact?: { path?: unknown; intentOnly?: unknown; [key: string]: unknown };
	[key: string]: unknown;
}

export interface RemainingTaskAction {
	milestoneId?: unknown;
	kind?: unknown;
	title?: unknown;
	reason?: unknown;
	state?: unknown;
	[key: string]: unknown;
}

export interface RemainingTask {
	milestones?: RemainingMilestone[];
	actions?: RemainingTaskAction[];
	operations?: RemainingTaskOperation[];
	unboundIdentities?: RemainingAcceptance[];
	[key: string]: unknown;
}

export interface RemainingVerifier {
	pending?:
		| ((milestone: RemainingMilestone) => { reason?: unknown; next?: unknown } | null | undefined)
		| null;
}

export interface RemainingExplanationOptions {
	/** Resolve runtime-bound identity fields without changing the approved plan. */
	effectiveAcceptance?: (milestone: RemainingMilestone) => RemainingAcceptance;
	/** Look up an extension verifier by acceptance kind. */
	acceptanceVerifier?: (kind: unknown) => RemainingVerifier | null | undefined;
}

const text = (value: unknown, max = 180): string =>
	String(value || "")
		.replace(/\s+/g, " ")
		.slice(0, max);

/** Default effective acceptance resolver for core and unbound extension milestones. */
export function effectiveRemainingAcceptance(milestone: RemainingMilestone): RemainingAcceptance {
	const acceptance = milestone?.acceptance || {};
	const bound = milestone?.bound?.fields;
	return bound && typeof bound === "object" && !Array.isArray(bound)
		? { ...acceptance, ...(bound as Record<string, unknown>) }
		: { ...acceptance };
}

/**
 * Explain outstanding task milestones using only host observations.
 *
 * `effectiveAcceptance` and `acceptanceVerifier` are optional because the
 * package must also work for the two core acceptance kinds without loading the
 * extension registry. The `.pi` implementation can pass its registry hooks to
 * preserve extension-specific wording.
 */
export function remainingExplanation(
	task: RemainingTask | null | undefined,
	options: RemainingExplanationOptions = {},
): string {
	const milestones = task?.milestones || [];
	const remaining = milestones.filter((milestone) => milestone.state !== "completed");
	const resolveAcceptance = options.effectiveAcceptance || effectiveRemainingAcceptance;
	const verifierFor = options.acceptanceVerifier || (() => null);
	const lines = [
		milestones.length
			? `已验收 ${milestones.length - remaining.length}/${milestones.length} 项；剩余 ${remaining.length} 项。`
			: "还没约定要交付什么，暂不计算完成百分比；先说清楚想要什么结果、做到什么程度算完成。",
	];
	for (const milestone of remaining) {
		const acceptance = resolveAcceptance(milestone);
		const deps = (Array.isArray(milestone.dependsOn) ? milestone.dependsOn : [])
			.map((id) => milestones.find((candidate) => candidate.id === id))
			.filter((candidate): candidate is RemainingMilestone =>
				Boolean(candidate && candidate.state !== "completed"),
			);
		const action = (task?.actions || []).find(
			(candidate) => candidate.milestoneId === milestone.id && candidate.state === "pending",
		);
		const recorded = (task?.operations || []).some(
			(operation) =>
				operation.artifact?.path === acceptance.path &&
				!operation.artifact?.intentOnly &&
				operation.state !== "started",
		);
		let reason: string;
		let next: string;
		if (deps.length) {
			reason = `前置项尚未验收：${deps.map((dependency) => text(dependency.title, 70)).join("、")}`;
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
		} else {
			const verifier = verifierFor(milestone.acceptance?.kind);
			if (verifier?.pending) {
				const hint = verifier.pending({ ...milestone, acceptance }) || {};
				reason = text(hint.reason) || `这一项要等 ${text(milestone.acceptance?.kind)} 核对通过`;
				next = text(hint.next) || "先核对已有结果，再决定是否继续";
			} else if (milestone.acceptance?.kind === "human_review") {
				reason = "这一项约定要你亲自看过才算数，目前还没有";
				next = "内容准备好后请过目一遍，看完确认即可";
			} else if (recorded) {
				reason = "已有产物记录，但和约定的标准还没对上";
				next = "先看看已生成的文件对不对（位置、版本、内容），别急着重新生成";
			} else if (milestone.evidence?.code === "ENOENT") {
				reason = "在约定的位置没找到文件——也可能是存到别处了";
				next = `看一下 ${text(acceptance.path, 140)} 和实际保存的位置是不是同一个，确实没有再补做`;
			} else {
				reason = "这一项还没确认完成；不能据此断言文件不存在或工作未做";
				next = `先看看${text(acceptance.path || acceptance.doi || "现有结果", 140)}，确实缺了再补`;
			}
		}
		lines.push(`• ${text(milestone.title)}\n  原因：${reason}\n  下一步：${next}。`);
	}
	if ((task?.operations || []).some((operation) => ["started", "unknown"].includes(String(operation.state))))
		lines.push("有操作上次没等到结果：先核对它实际做没做成，别直接重来一遍。");
	for (const action of (task?.actions || []).filter(
		(candidate) =>
			candidate.state === "pending" && !remaining.some((milestone) => milestone.id === candidate.milestoneId),
	))
		lines.push(`需要你：${text(action.title)}；${text(action.reason)}。`);
	for (const identity of (task?.unboundIdentities || [])
		.filter((candidate) => remaining.some((milestone) => milestone.acceptance?.kind === candidate.kind))
		.slice(-4))
		lines.push(
			`已记录但未对应到任何交付项：${text(identity.doi || identity.kind, 140)}。若计划里写的文献有误，用 task_wait kind=rebind（milestoneId + doi + reason）请用户确认更换。`,
		);
	if (milestones.length && !remaining.length) {
		lines.push("约定的交付都已确认完成。还想做别的，直接说就行。");
		const returned = (task?.operations || []).filter((operation) => operation.state === "returned").length;
		const failed = (task?.operations || []).filter((operation) => operation.state === "failed").length;
		if (returned)
			lines.push(`其中 ${returned} 步命令/外部操作只有返回记录、没有独立核对；交付以验收过的文件为准。`);
		if (failed) lines.push(`过程中有 ${failed} 步操作出过错；交付以最终验收过的文件为准。`);
	}
	return lines.join("\n").slice(0, 10000);
}
