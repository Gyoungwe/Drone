import { CAPABILITY_CATALOG, type CapabilityId } from "./capabilities";
import { WORKFLOW_DIRECTIONS, workflowStage } from "./workflow-catalog";

export const TURN_ROUTE_CUSTOM_TYPE = "drone-turn-route";

export type TurnIntake = "new-topic" | "continuation" | "task-command" | "read-only" | "status";
export type TurnLanding = "workflow" | "host-gate" | "ordinary" | "library";

/** Language-neutral record of one user turn. The sentences are rendered later. */
export interface TurnRouteHost {
	reason: string | null;
	state: string | null;
	stageCalls: number;
	calls: number;
	progressCount: number;
	stageStartProgress: number;
	stageLimited: boolean;
	hasProgress: boolean;
	pendingReview: boolean;
	reviewLinked: boolean;
	deferredReviews: number;
	releasedStage: boolean;
}

export interface TurnRoute {
	utterance: string;
	intake: TurnIntake;
	capabilities: string[];
	topics: string[];
	direction: string | null;
	stage: string | null;
	contract: string | null;
	primary: string | null;
	reason: string | null;
	unavailableStage: string | null;
	comparison: boolean;
	academic: boolean;
	keptCheckpoint: boolean;
	deferPhrase: boolean;
	visiblePrimary: boolean;
	landing: TurnLanding;
	host: TurnRouteHost | null;
}

export interface TurnRouteLines {
	summary: string;
	lines: string[];
}

const INTAKES = new Set<TurnIntake>(["new-topic", "continuation", "task-command", "read-only", "status"]);
const LANDINGS = new Set<TurnLanding>(["workflow", "host-gate", "ordinary", "library"]);

/** Same phrase the host uses to drop an unlinked review. Status questions do not match. */
export function isDeferReviewPhrase(text: string): boolean {
	return /^(?:继续(?:做完|吧|执行|处理|完成|上一任务)?|接着(?:做|处理)?|continue|resume)[\s,.!？，。！?]*$/i.test(
		text.trim(),
	);
}

function text(value: unknown, max: number): string | null {
	if (typeof value !== "string") return null;
	const flat = value.replace(/\s+/g, " ").trim();
	if (!flat || flat.length > max) return null;
	return flat;
}

function optionalText(value: unknown, max: number): string | null {
	if (value == null) return null;
	return text(value, max);
}

function stringList(value: unknown, max: number): string[] | null {
	if (!Array.isArray(value) || value.length > 8) return null;
	const out: string[] = [];
	for (const item of value) {
		const cleaned = text(item, max);
		if (!cleaned) return null;
		out.push(cleaned);
	}
	return out;
}

function hostOf(value: unknown): TurnRouteHost | null | undefined {
	if (value == null) return null;
	if (!value || typeof value !== "object") return undefined;
	const host = value as TurnRouteHost;
	if (
		(host.reason != null && typeof host.reason !== "string") ||
		(host.state != null && typeof host.state !== "string") ||
		typeof host.stageCalls !== "number" ||
		typeof host.calls !== "number" ||
		typeof host.progressCount !== "number" ||
		typeof host.stageStartProgress !== "number" ||
		typeof host.stageLimited !== "boolean" ||
		typeof host.hasProgress !== "boolean" ||
		typeof host.pendingReview !== "boolean" ||
		typeof host.reviewLinked !== "boolean" ||
		typeof host.deferredReviews !== "number" ||
		typeof host.releasedStage !== "boolean"
	)
		return undefined;
	return {
		reason: optionalText(host.reason, 80),
		state: optionalText(host.state, 40),
		stageCalls: host.stageCalls,
		calls: host.calls,
		progressCount: host.progressCount,
		stageStartProgress: host.stageStartProgress,
		stageLimited: host.stageLimited,
		hasProgress: host.hasProgress,
		pendingReview: host.pendingReview,
		reviewLinked: host.reviewLinked,
		deferredReviews: host.deferredReviews,
		releasedStage: host.releasedStage,
	};
}

export function decodeTurnRoute(value: unknown): TurnRoute | undefined {
	if (!value || typeof value !== "object") return;
	const route = value as TurnRoute;
	const utterance = text(route.utterance, 180);
	const capabilities = stringList(route.capabilities, 40);
	const topics = stringList(route.topics, 40);
	const host = hostOf(route.host);
	if (
		!utterance ||
		!INTAKES.has(route.intake) ||
		!capabilities ||
		!topics ||
		!LANDINGS.has(route.landing) ||
		host === undefined ||
		typeof route.comparison !== "boolean" ||
		typeof route.academic !== "boolean" ||
		typeof route.keptCheckpoint !== "boolean" ||
		typeof route.deferPhrase !== "boolean" ||
		typeof route.visiblePrimary !== "boolean"
	)
		return;
	return {
		utterance,
		intake: route.intake,
		capabilities,
		topics,
		direction: optionalText(route.direction, 40),
		stage: optionalText(route.stage, 40),
		contract: optionalText(route.contract, 400),
		primary: optionalText(route.primary, 80),
		reason: optionalText(route.reason, 80),
		unavailableStage: optionalText(route.unavailableStage, 40),
		comparison: route.comparison,
		academic: route.academic,
		keptCheckpoint: route.keptCheckpoint,
		deferPhrase: route.deferPhrase,
		visiblePrimary: route.visiblePrimary,
		landing: route.landing,
		host,
	};
}

export function turnRouteDisplay(raw: unknown): { id: string; timestamp: number; route: TurnRoute } | null {
	if (!raw || typeof raw !== "object") return null;
	const message = raw as {
		role?: unknown;
		customType?: unknown;
		display?: unknown;
		content?: unknown;
		timestamp?: unknown;
		details?: { reportId?: unknown; route?: unknown };
	};
	if (
		message.role !== "custom" ||
		message.customType !== TURN_ROUTE_CUSTOM_TYPE ||
		message.display !== true ||
		typeof message.content !== "string" ||
		message.content.length > 200 ||
		typeof message.details?.reportId !== "string" ||
		!/^[a-zA-Z0-9-]{1,100}$/.test(message.details.reportId)
	)
		return null;
	const route = decodeTurnRoute(message.details.route);
	if (!route) return null;
	return {
		id: `turn-route-${message.details.reportId}`,
		timestamp: typeof message.timestamp === "number" ? message.timestamp : Date.now(),
		route,
	};
}

function capabilityLabel(id: string, lang: "zh" | "en"): string {
	return CAPABILITY_CATALOG.find((item) => item.id === (id as CapabilityId))?.label[lang] ?? id;
}

function directionLabel(id: string | null, lang: "zh" | "en"): string | null {
	if (!id) return null;
	return WORKFLOW_DIRECTIONS.find((item) => item.id === id)?.label[lang] ?? id;
}

function stageLabel(id: string | null, lang: "zh" | "en"): string | null {
	if (!id) return null;
	return workflowStage(id)?.label[lang] ?? id;
}

function contractLine(route: TurnRoute, lang: "zh" | "en"): string | null {
	if (route.stage === "search" || route.contract?.includes("search hit is not a source read"))
		return lang === "zh"
			? "约定：搜到一条文献不算已经读过原文。"
			: "Contract: a search hit is not a source read.";
	if (!route.contract) return null;
	return lang === "zh" ? `约定：${route.contract}` : `Contract: ${route.contract}`;
}

function intakeLine(route: TurnRoute, lang: "zh" | "en"): string {
	const said = `「${route.utterance}」`;
	if (lang === "en") {
		if (route.intake === "task-command")
			return `${said} is a task command, so this turn does not pick a new workflow.`;
		if (route.intake === "read-only")
			return `${said} is read-only reuse of literature already on hand. No new task contract is opened.`;
		if (route.intake === "status")
			return `${said} asks for status. The checkpoint stays, and this is not a new topic.`;
		if (route.intake === "continuation")
			return route.keptCheckpoint
				? `${said} continues the task already underway and keeps its checkpoint.`
				: `${said} is a continuation.`;
		return `${said} is a new topic.`;
	}
	if (route.intake === "task-command") return `${said}是任务指令，这一轮不另选工作流。`;
	if (route.intake === "read-only") return `${said}是只读复用已有文献，不开新的任务契约。`;
	if (route.intake === "status") return `${said}是在问进度。检查点留着，这不是新话题。`;
	if (route.intake === "continuation")
		return route.keptCheckpoint ? `${said}接着做还没结束的任务，沿用检查点。` : `${said}是接续。`;
	return `${said}是新话题。`;
}

function skillLine(route: TurnRoute, lang: "zh" | "en"): string {
	const stage = stageLabel(route.stage, lang);
	const direction = directionLabel(route.direction, lang);
	if (route.comparison)
		return lang === "zh"
			? "这几个技能只是拿来对照，没有单独的主技能。"
			: "These skills are comparison references. There is no single owner.";
	if (!route.primary) {
		if (route.unavailableStage) {
			const name = stageLabel(route.unavailableStage, lang) ?? route.unavailableStage;
			return lang === "zh"
				? `阶段「${name}」在当前模式下没有已安装的主技能。`
				: `Stage “${name}” has no installed owner in the current mode.`;
		}
		return lang === "zh" ? "这一轮没有选中主技能。" : "This turn did not select a primary skill.";
	}
	const where = [direction, stage].filter(Boolean).join(lang === "zh" ? " / " : " / ");
	if (route.reason === "explicit-command")
		return lang === "zh"
			? `主技能是 ${route.primary}，因为这句话点名了它。${where ? `位置：${where}。` : ""}`
			: `Primary skill is ${route.primary} because the message named it. ${where ? `Place: ${where}.` : ""}`;
	if (route.reason === "named-in-task")
		return lang === "zh"
			? `主技能是 ${route.primary}，因为它写在这件任务里。${where ? `位置：${where}。` : ""}`
			: `Primary skill is ${route.primary} because the task names it. ${where ? `Place: ${where}.` : ""}`;
	if (route.reason?.startsWith("topic:") && stage)
		return lang === "zh"
			? `主技能是 ${route.primary}。话题落在${stage}，它是这个阶段里第一个已安装的候选。`
			: `Primary skill is ${route.primary}. The topic landed on ${stage}, and it is the first installed candidate for that stage.`;
	return lang === "zh"
		? `主技能是 ${route.primary}。${route.reason ? `原因：${route.reason}。` : ""}${where ? `位置：${where}。` : ""}`
		: `Primary skill is ${route.primary}. ${route.reason ? `Reason: ${route.reason}. ` : ""}${where ? `Place: ${where}.` : ""}`;
}

function landingLine(route: TurnRoute, lang: "zh" | "en"): string {
	if (route.landing === "library")
		return lang === "zh"
			? "回答停在只读文献复用，不会去执行下载或写入。"
			: "The reply stays in read-only literature reuse. It does not download or write.";
	if (route.landing === "workflow" && route.primary && route.visiblePrimary)
		return lang === "zh"
			? `回答会按 ${route.primary} 来写：这句话被写进本轮系统提示。这还不是已经去执行了该技能。`
			: `The reply follows ${route.primary}: that sentence is written into this turn's system prompt. The skill has not been executed yet.`;
	if (route.landing === "workflow" && route.primary)
		return lang === "zh"
			? `选中了 ${route.primary}，但它当前不可见，所以没有写进系统提示。`
			: `${route.primary} was selected, but it is not visible, so it was not written into the system prompt.`;
	if (route.landing === "ordinary")
		return lang === "zh"
			? "没有进入研究工作流，按普通对话回答。"
			: "No research workflow was entered. This is an ordinary reply.";
	return lang === "zh" ? "这一轮停在宿主门上。" : "This turn stops at a host gate.";
}

function hostLines(route: TurnRoute, lang: "zh" | "en"): string[] {
	const host = route.host;
	if (!host) return [];
	const lines: string[] = [];
	if (lang === "en") {
		if (host.deferredReviews > 0) {
			lines.push(
				`This phrase cleared ${host.deferredReviews} review card${host.deferredReviews === 1 ? "" : "s"} without checking a deliverable off.`,
			);
			lines.push(
				host.releasedStage
					? "This stage already had new progress, so its step count was released."
					: "This stage had no new progress, so the step limit stayed.",
			);
		} else if (host.pendingReview && route.deferPhrase) {
			lines.push(
				host.reviewLinked
					? "This phrase drops the review without marking the deliverable complete."
					: "This phrase drops the review. It is not tied to a deliverable, so it cannot be marked complete.",
			);
			lines.push(
				host.hasProgress && host.stageLimited
					? "This stage already had new progress, so the step count will be released."
					: host.stageLimited
						? "This stage had no new progress, so the step limit stays."
						: "The stage step count is not at its limit.",
			);
		} else if (host.pendingReview) {
			lines.push("A review is still waiting. This is not “continue”, so the stage quota stays.");
		} else if (host.stageLimited && host.reason === "stage-budget") {
			lines.push("The host is stopped at this stage's step limit.");
		}
		if (host.reason)
			lines.push(
				`Host record: reason ${host.reason}, this stage ${host.stageCalls} calls, progress ${host.progressCount} from ${host.stageStartProgress}.`,
			);
		return lines;
	}
	if (host.deferredReviews > 0) {
		lines.push(`这句话放下了 ${host.deferredReviews} 张审阅，没有把交付勾成完成。`);
		lines.push(
			host.releasedStage ? "这一段已经有进展，阶段步数已放开。" : "这一段没有新进展，阶段步数没有放开。",
		);
	} else if (host.pendingReview && route.deferPhrase) {
		lines.push(
			host.reviewLinked
				? "这句话会放下这张审阅，不会把交付勾成完成。"
				: "这句话会放下这张对不上具体交付的审阅，不会替你勾完成。",
		);
		lines.push(
			host.hasProgress && host.stageLimited
				? "这一段已经有进展，阶段步数会放开。"
				: host.stageLimited
					? "这一段没有新进展，阶段步数不会放开。"
					: "阶段步数还没到上限。",
		);
	} else if (host.pendingReview) {
		lines.push("审阅还挂着。这句不是「继续」，阶段配额不会放开。");
	} else if (host.stageLimited && host.reason === "stage-budget") {
		lines.push("宿主停在这一段的步数上限。");
	}
	if (host.reason)
		lines.push(
			`宿主记录：原因 ${host.reason}，这一段 ${host.stageCalls} 步，进展 ${host.progressCount}，起点 ${host.stageStartProgress}。`,
		);
	return lines;
}

function summaryOf(route: TurnRoute, lang: "zh" | "en"): string {
	const stage = stageLabel(route.stage, lang);
	if (lang === "en") {
		if (route.landing === "host-gate") {
			if (route.deferPhrase && (route.host?.pendingReview || route.host?.deferredReviews))
				return "Continues the checkpoint. The review is set aside, and the stage limit follows the progress.";
			if (route.host?.pendingReview)
				return "Checkpoint kept. The review is still waiting, so the stage quota stays.";
			return route.host?.reason
				? `Stopped at the host gate (${route.host.reason}).`
				: "Stopped at the host gate.";
		}
		if (route.landing === "workflow" && route.primary)
			return stage ? `Enters ${stage} via ${route.primary}.` : `Follows ${route.primary}.`;
		if (route.landing === "library") return "Read-only literature reuse.";
		return "Ordinary reply. No research workflow.";
	}
	if (route.landing === "host-gate") {
		if (route.deferPhrase && (route.host?.pendingReview || route.host?.deferredReviews))
			return "沿用检查点。审阅先放下，阶段步数看这一段有没有进展。";
		if (route.host?.pendingReview) return "沿用检查点。审阅还在，阶段配额不放开。";
		return route.host?.reason ? `停在宿主门（${route.host.reason}）。` : "停在宿主门。";
	}
	if (route.landing === "workflow" && route.primary)
		return stage ? `进入${stage}，主技能 ${route.primary}。` : `按 ${route.primary} 回答。`;
	if (route.landing === "library") return "只读复用已有文献。";
	return "普通对话，没有进入研究工作流。";
}

/** Sentences for this turn only. A different route produces a different explanation. */
export function turnRouteLines(route: TurnRoute, lang: "zh" | "en" = "zh"): TurnRouteLines {
	const caps = route.capabilities.map((id) => capabilityLabel(id, lang));
	const direction = directionLabel(route.direction, lang);
	const stage = stageLabel(route.stage, lang);
	const place =
		direction || stage
			? lang === "zh"
				? `方向：${direction ?? "没有方向"}。阶段：${stage ?? "没有阶段"}。`
				: `Direction: ${direction ?? "none"}. Stage: ${stage ?? "none"}.`
			: lang === "zh"
				? "没有落到具体的研究方向或阶段。"
				: "No research direction or stage was selected.";
	const lines = [
		intakeLine(route, lang),
		caps.length
			? lang === "zh"
				? `打开的能力：${caps.join("、")}。`
				: `Capabilities opened: ${caps.join(", ")}.`
			: lang === "zh"
				? "没有新打开的能力。"
				: "No extra capability was opened.",
		place,
		contractLine(route, lang),
		route.academic
			? lang === "zh"
				? "学术模式开着，检索阶段会把 deep-research 放在候选最前。"
				: "Academic mode is on, so deep-research is the first search candidate."
			: null,
		route.topics.length
			? lang === "zh"
				? `识别到的话题：${route.topics.join("、")}。`
				: `Topics: ${route.topics.join(", ")}.`
			: null,
		skillLine(route, lang),
		...hostLines(route, lang),
		landingLine(route, lang),
	].filter((line): line is string => Boolean(line));
	return { summary: summaryOf(route, lang), lines };
}

export type TurnRouteStepStatus = "ok" | "active" | "warn" | "blocked" | "skip";
export type TurnRouteStepKey = "request" | "capabilities" | "skill" | "stage" | "tools" | "result";
export interface TurnRouteStep {
	key: TurnRouteStepKey;
	/** Short label shown on the roadmap node (one or two words). */
	label: string;
	/** Compact value under the label, already truncated. */
	value: string;
	status: TurnRouteStepStatus;
	/** Full explanation shown on hover / click. */
	detail: string;
}

function clip(text: string, max = 18): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Structured roadmap of one turn: request → capabilities → primary skill → stage → tools → result.
 * Each step carries a short label, a status colour and the full sentence as detail, so the card can
 * stay one line by default and reveal the explanation only on demand.
 */
export function turnRouteSteps(route: TurnRoute, lang: "zh" | "en" = "zh"): TurnRouteStep[] {
	const zh = lang === "zh";
	const caps = route.capabilities.map((id) => capabilityLabel(id, lang));
	const stage = stageLabel(route.stage, lang);
	const direction = directionLabel(route.direction, lang);
	const host = route.host;
	const intake: Record<TurnIntake, string> = zh
		? {
				"new-topic": "新话题",
				continuation: "接续",
				"task-command": "任务指令",
				"read-only": "只读",
				status: "问进度",
			}
		: {
				"new-topic": "New topic",
				continuation: "Continue",
				"task-command": "Task cmd",
				"read-only": "Read-only",
				status: "Status",
			};
	const skillStatus: TurnRouteStepStatus = route.primary
		? route.visiblePrimary || route.landing !== "workflow"
			? "ok"
			: "warn"
		: route.unavailableStage
			? "warn"
			: route.comparison
				? "ok"
				: "skip";
	const gate = route.landing === "host-gate";
	const toolsStatus: TurnRouteStepStatus = !host
		? "skip"
		: gate && (host.pendingReview || host.stageLimited)
			? "blocked"
			: host.calls > 0
				? "active"
				: "skip";
	const resultStatus: TurnRouteStepStatus = gate
		? "blocked"
		: route.landing === "workflow" && !route.visiblePrimary
			? "warn"
			: "ok";
	const resultValue: Record<TurnLanding, string> = zh
		? { workflow: "按技能回答", "host-gate": "宿主门", ordinary: "普通回答", library: "只读复用" }
		: { workflow: "Skill reply", "host-gate": "Host gate", ordinary: "Ordinary", library: "Read-only" };
	return [
		{
			key: "request",
			label: zh ? "请求" : "Request",
			value: intake[route.intake],
			status: "ok",
			detail: intakeLine(route, lang),
		},
		{
			key: "capabilities",
			label: zh ? "能力" : "Capabilities",
			value: caps.length ? clip(caps.join(zh ? "、" : ", ")) : zh ? "无" : "none",
			status: caps.length ? "ok" : "skip",
			detail: caps.length
				? zh
					? `打开的能力：${caps.join("、")}。${route.topics.length ? ` 话题：${route.topics.join("、")}。` : ""}`
					: `Capabilities opened: ${caps.join(", ")}.${route.topics.length ? ` Topics: ${route.topics.join(", ")}.` : ""}`
				: zh
					? "没有新打开的能力。"
					: "No extra capability was opened.",
		},
		{
			key: "skill",
			label: zh ? "主技能" : "Skill",
			value: route.primary
				? clip(route.primary)
				: route.comparison
					? zh
						? "对照"
						: "compare"
					: zh
						? "无"
						: "none",
			status: skillStatus,
			detail: skillLine(route, lang),
		},
		{
			key: "stage",
			label: zh ? "阶段" : "Stage",
			value: stage ? clip(stage) : direction ? clip(direction) : zh ? "无" : "none",
			status: stage || direction ? (route.unavailableStage ? "warn" : "ok") : "skip",
			detail: [
				direction || stage
					? zh
						? `方向：${direction ?? "没有方向"}。阶段：${stage ?? "没有阶段"}。`
						: `Direction: ${direction ?? "none"}. Stage: ${stage ?? "none"}.`
					: zh
						? "没有落到具体的研究方向或阶段。"
						: "No research direction or stage was selected.",
				contractLine(route, lang),
			]
				.filter(Boolean)
				.join(" "),
		},
		{
			key: "tools",
			label: zh ? "工具" : "Tools",
			value: host
				? zh
					? `${host.stageCalls}/${host.calls} 步`
					: `${host.stageCalls}/${host.calls} calls`
				: "—",
			status: toolsStatus,
			detail: host
				? hostLines(route, lang).join(" ") ||
					(zh
						? `本段 ${host.stageCalls} 步，共 ${host.calls} 步。`
						: `${host.stageCalls} calls this stage, ${host.calls} total.`)
				: zh
					? "这一轮没有宿主执行记录。"
					: "No host execution record for this turn.",
		},
		{
			key: "result",
			label: zh ? "结果" : "Result",
			value: resultValue[route.landing],
			status: resultStatus,
			detail: landingLine(route, lang),
		},
	];
}
