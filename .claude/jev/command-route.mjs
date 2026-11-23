/**
 * Decides which Bash commands go through the output ladder. Only whole commands made of check runs
 * (tests, lint, typecheck, build, check scripts) joined by `&&`, optionally after `cd`, qualify: a pipe,
 * redirect, substitution or a flag that rewrites files keeps the command untouched. `JEV_RAW=1 <command>`
 * is the explicit opt-out.
 */
const UNSAFE = /[|;<>`]|\$\(|(?<!&)&(?!&)/;
const MUTATING = /\s(?:--(?:update|write|fix|apply|unsafe|write-lock)\b|-u(?=\s|$))/;
const CD = /^cd\s+\S+$/;
const CHECKS = [
	/^npm\s+(?:test|t)(?:\s|$)/,
	/^npm\s+run\s+(?:lint|typecheck|build|test|check)[\w:-]*(?:\s|$)/,
	/^npx\s+(?:vitest|tsc|biome)(?:\s|$)/,
	/^node\s+--test(?:\s|$)/,
	/^node\s+scripts\/check-[\w-]+\.mjs(?:\s|$)/,
];

const isCheck = (segment) => CHECKS.some((pattern) => pattern.test(segment));

export function squeezable(command) {
	const trimmed = command.trim();
	if (trimmed === "" || trimmed.startsWith("JEV_RAW=")) return false;
	if (UNSAFE.test(trimmed) || MUTATING.test(` ${trimmed}`)) return false;
	const segments = trimmed.split(/\s*&&\s*/);
	return segments.some(isCheck) && segments.every((segment) => CD.test(segment) || isCheck(segment));
}

export function shellQuote(text) {
	return `'${text.replaceAll("'", `'\\''`)}'`;
}

export function routeCommand(command, runner) {
	return `node ${shellQuote(runner)} -- ${shellQuote(command)}`;
}
