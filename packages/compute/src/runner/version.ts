import type { RunnerCapabilities, RunnerVersion } from "../types";

export function negotiateRunnerVersion(
	local: readonly RunnerVersion[],
	remote: RunnerCapabilities,
): RunnerVersion | undefined {
	const accepted = new Set(
		[remote.runnerVersion, remote.version, ...(remote.compatibleVersions ?? [])].filter(
			(value): value is string => Boolean(value),
		),
	);
	return [...local]
		.filter(
			(candidate) =>
				candidate.protocolVersion === remote.protocolVersion && accepted.has(candidate.runnerVersion),
		)
		.sort((a, b) => compareVersions(b.runnerVersion, a.runnerVersion))[0];
}

function compareVersions(left: string, right: string): number {
	const parse = (value: string) => value.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : 0));
	const a = parse(left);
	const b = parse(right);
	for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
		const diff = (a[i] ?? 0) - (b[i] ?? 0);
		if (diff) return diff;
	}
	return left.localeCompare(right);
}
