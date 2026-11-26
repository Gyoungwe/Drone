import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Static, type TSchema, Type } from "typebox";
import { Check } from "typebox/value";

const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
type Usage = Partial<Record<"input" | "output" | "cacheRead" | "cacheWrite" | "reasoning", number>>;
export const nullable = <Schema extends TSchema>(schema: Schema) => Type.Union([schema, Type.Null()]);

export function checked<Schema extends TSchema>(schema: Schema, value: unknown, label: string): Static<Schema> {
	if (!Check(schema, value)) throw new Error(`Invalid ${label}`);
	return value;
}

export async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8"));
}

export function sha256(value: string | Buffer) {
	return createHash("sha256").update(value).digest("hex");
}

export function tokensFor(samples: (Usage | null)[]) {
	const fields = ["input", "output", "cacheRead", "cacheWrite", "reasoning"] as const;
	const reportedFields = fields.filter((field) => samples.some((sample) => sample?.[field] !== undefined));
	const sum = (field: keyof Usage) => samples.reduce<number | null>((total, sample) => {
		const value = sample?.[field];
		return total === null || value === undefined ? null : checked(count, total + value, "token total");
	}, 0);
	const cumulativeInput = sum("input"), cumulativeOutput = sum("output"), cacheWrite = sum("cacheWrite");
	const billedTotal = cumulativeInput === null || cumulativeOutput === null || cacheWrite === null
		? null : checked(count, cumulativeInput + cumulativeOutput + cacheWrite, "billed token total");
	return { firstTurnInput: samples[0]?.input ?? null, cumulativeInput, cumulativeOutput,
		cacheRead: sum("cacheRead"), cacheWrite, reasoning: sum("reasoning"), billedTotal,
		usageReported: reportedFields.length > 0, reportedFields,
		unknownUsageSteps: samples.filter((sample) => !sample || !fields.some((field) => sample[field] !== undefined)).length };
}

export async function saveReport(out: string, report: object) {
	await mkdir(dirname(out), { recursive: true });
	const staging = await mkdtemp(join(dirname(out), ".baseline-"));
	try {
		const temp = join(staging, "report.json");
		const body = `${JSON.stringify(report, null, 2)}\n`;
		await writeFile(temp, body, { mode: 0o600 });
		if (await readFile(temp, "utf8") !== body) throw new Error("Baseline report read-back mismatch");
		await link(temp, out);
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}
