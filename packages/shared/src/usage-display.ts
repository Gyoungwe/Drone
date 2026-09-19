/** Display adapter for SDK-reported usage. No tokenizer, price table, new accounting store or model call. */
export interface ReportedUsage {
	id: string;
	input: number;
	output: number;
	cacheRead: number | null;
	cacheWrite: number | null;
	reasoning?: number;
	cost: number | null;
	provider?: string;
	model?: string;
}
export interface UsageDisplayTotal {
	requests: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
	cacheRate: number | null;
	cacheComplete: boolean;
	cost: number | null;
}
const count = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
export function reportedUsage(raw: unknown): ReportedUsage | undefined {
	if (!raw || typeof raw !== "object") return;
	const message = raw as {
		usage?: {
			input?: unknown;
			output?: unknown;
			cacheRead?: unknown;
			cacheWrite?: unknown;
			reasoning?: unknown;
			cost?: { total?: unknown };
		};
		responseId?: string;
		timestamp?: number;
		provider?: string;
		model?: string;
		knowledgePublication?: { id?: string };
		content?: Array<{ type?: string; id?: string }>;
	};
	const u = message.usage;
	if (!u) return;
	const input = count(u.input);
	const output = count(u.output);
	if (input === null || output === null) return;
	const reasoning = count(u.reasoning);
	const toolId = Array.isArray(message.content)
		? message.content.find((b) => b.type === "toolCall")?.id
		: undefined;
	const id =
		message.responseId ||
		message.knowledgePublication?.id ||
		`${message.provider || ""}/${message.model || ""}:${message.timestamp ?? 0}:${toolId || ""}`;
	return {
		id,
		input,
		output,
		cacheRead: count(u.cacheRead),
		cacheWrite: count(u.cacheWrite),
		...(reasoning !== null ? { reasoning } : {}),
		cost: count(u.cost?.total),
		provider: message.provider,
		model: message.model,
	};
}
export function sumReportedUsage(items: readonly ReportedUsage[]): UsageDisplayTotal {
	const unique = [
		...new Map(
			items.map((item) => [`${item.provider ?? ""}\0${item.model ?? ""}\0${item.id}`, item]),
		).values(),
	];
	const sum = (key: "input" | "output" | "cacheRead" | "cacheWrite") =>
		unique.reduce((n, u) => n + (u[key] ?? 0), 0);
	const input = sum("input"),
		output = sum("output"),
		cacheRead = sum("cacheRead"),
		cacheWrite = sum("cacheWrite");
	const cacheComplete =
		unique.length > 0 && unique.every((u) => u.cacheRead !== null && u.cacheWrite !== null);
	const denominator = input + cacheRead + cacheWrite;
	return {
		requests: unique.length,
		input,
		output,
		cacheRead,
		cacheWrite,
		total: denominator + output,
		cacheComplete,
		cacheRate: cacheComplete && denominator > 0 ? cacheRead / denominator : null,
		cost:
			unique.length && unique.every((u) => u.cost !== null)
				? unique.reduce((n, u) => n + (u.cost ?? 0), 0)
				: null,
	};
}
export function deriveTurnUsage(
	messages: readonly { kind: string; usage?: ReportedUsage }[],
): UsageDisplayTotal[] {
	const turns: ReportedUsage[][] = [];
	let current: ReportedUsage[] | undefined;
	for (const message of messages) {
		if (message.kind === "user") {
			current = [];
			turns.push(current);
		} else if (message.usage && current) current.push(message.usage);
	}
	return turns.map(sumReportedUsage);
}
