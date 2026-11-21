import type { PluginRuntimeSource } from "@drone/backend";

export type InstalledP5Optins = NonNullable<PluginRuntimeSource["p5"]>;

const literals = {
	bytes: "staged-output",
	exportBundle: "request",
	batch: "request",
	rerun: "request",
	critic: "request",
	delivery: "request",
} as const satisfies Required<InstalledP5Optins>;

export interface InstalledP5Declaration {
	/** Eligibility declarations only; output grants and approvals come from the host. */
	readonly p5?: InstalledP5Optins;
}

export function p5Optins(value: unknown): InstalledP5Declaration {
	if (value === undefined) return {};
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error("drone.p5 must be an object");
	for (const [key, literal] of Object.entries(value)) {
		if (!Object.hasOwn(literals, key)) throw new Error(`drone.p5 has unknown key ${key}`);
		const expected = literals[key as keyof InstalledP5Optins];
		if (literal !== expected) throw new Error(`drone.p5.${key} must be ${expected} when declared`);
	}
	return { p5: Object.freeze({ ...value }) as InstalledP5Optins };
}
