/**
 * Jev permission point (paper §IV-A): "should this tool call run?" answered deny / ask, or `null` for no
 * opinion, which leaves Claude Code's own permission flow in charge. The rules encode AGENTS.md red lines
 * that were previously kept by discipline alone. Pure: repository lookup and file existence come in
 * through `env` so tests need no filesystem.
 */
import path from "node:path";
import { decision } from "./decision.mjs";

const SEVERITY = { ask: 1, deny: 2 };

const SECRET_PATHS = [
	[/(?:^|\/)\.env(?:\.(?!example$)[\w.-]+)?$/, "secret-env"],
	[/(?:^|\/)\.ssh(?:\/|$)/, "secret-ssh"],
	[/\/\.pi\/agent[\w-]*\/auth\.json$/, "secret-pi-auth"],
	[/(?:^|\/)plugin-credentials\.json$/, "secret-plugin-credentials"],
];

const BASH_RULES = [
	[/\bnpm\s+(?:publish|unpublish|version|deprecate|dist-tag)\b/, "deny", "no-npm-release"],
	[/\bgh\s+release\s+(?:create|upload|edit|delete)\b/, "deny", "no-gh-release"],
	[/\bgit\s+tag\s+(?!-l\b|--list\b|-n\b)[\w-]/, "deny", "no-git-tag"],
	[/\bgit\s+push\b[^|;&]*(?:--tags\b|refs\/tags\/)/, "deny", "no-push-tags"],
	[/\bgit\s+push\b[^|;&]*\s(?:\S+:)?(?:refs\/heads\/)?main(?=\s|$)/, "deny", "no-push-main"],
	[/\b(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/, "deny", "no-pipe-to-shell"],
	[/\bgit\s+add\b[^|;&]*\s(?:-f|--force)(?=\s|$)/, "deny", "no-force-add"],
	[/\bgit\s+add\b[^|;&]*\s(?:\.\/)?results(?:\/|\s|$)/, "deny", "no-results"],
	[/(?:^|[;&|]\s*)(?:env|printenv)\s*(?:$|[;&|])/, "deny", "no-env-dump"],
	[/\b(?:echo|printf)\b[^|;&]*\$\{?[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)/, "deny", "no-print-secret"],
	[/\bprintenv\s+[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)/, "deny", "no-print-secret"],
	[/--no-verify\b/, "ask", "no-verify-needs-reason"],
];

/** Throwaway places a recursive delete may clear without asking, besides the repositories themselves. */
const DISPOSABLE = [/^\/(?:private\/)?tmp\//, /^\/(?:private\/)?var\/folders\//, /\/Drone-worktrees\/[^/]+/];

/** Only for files that do not exist yet. */
const NEW_FILE_RULES = [
	[/^drone:packages\/[^/]+\/src\/.+\.(?:mjs|d\.mts)$/, "deny", "no-src-mjs"],
	[/^drone:packages\/(?:inquiry|discovery|research|extensions)\//, "ask", "frozen-package"],
];

const WRITE_RULES = [
	[/^drone(?:-plugins)?:scripts\/fixtures\/[\w-]*baseline[\w-]*\.json$/, "ask", "ratchet-baseline"],
	[/^drone:plugins\.lock\.json$/, "ask", "plugin-relock"],
	[/^drone:\.claude\/(?:settings[\w.]*\.json|hooks\/|jev\/)/, "ask", "harness-self"],
];

const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"]);
const TOKEN_SPLIT = /[\s'"`=<>|;&()]+/;

function strongest(found) {
	return found.reduce(
		(best, next) => (best === null || SEVERITY[next.answer] > SEVERITY[best.answer] ? next : best),
		null,
	);
}

function matching(rules, text) {
	return rules
		.filter(([pattern]) => pattern.test(text))
		.map(([, answer, rule]) => decision("permission", answer, rule));
}

export function secretRule(file) {
	return SECRET_PATHS.find(([pattern]) => pattern.test(file))?.[1] ?? null;
}

/** One shell word as an absolute path; null when the shell would expand it first or the directory is unknown. */
function wordPath(word, cwd, home) {
	if (cwd === null || word === "-" || /[$`*?{]/.test(word)) return null;
	const expanded = word.replace(/^~(?=\/|$)/, home).replace(/^["']|["']$/g, "");
	return path.resolve(cwd, expanded);
}

/**
 * Paths each `rm -r` in the command would delete, resolved against the directory any earlier `cd` moved to.
 * Redirections such as `2>/dev/null` are not targets. A target that cannot be resolved comes back as null.
 */
export function recursiveDeleteTargets(command, cwd, home) {
	const targets = [];
	let dir = cwd;
	for (const segment of command.split(/[;&|\n]+/)) {
		const words = segment
			.trim()
			.split(/\s+/)
			.filter((w) => w !== "" && !/[<>]/.test(w));
		const at = words[0] === "sudo" ? 1 : 0;
		if (words[at] === "cd") dir = words.length > at + 1 ? wordPath(words[at + 1], dir, home) : home;
		const recursive = words.some((w) => /^-\w*[rR]/.test(w) || w === "--recursive");
		if (words[at] !== "rm" || !recursive) continue;
		const operands = words.slice(at + 1).filter((w) => !w.startsWith("-"));
		targets.push(...operands.map((w) => wordPath(w, dir, home)));
	}
	return targets;
}

/** Recursive deletes pass inside a repository or a throwaway place and ask anywhere else. */
function deleteDecision(command, cwd, env) {
	const outside = recursiveDeleteTargets(command, cwd, env.home).some(
		(target) =>
			target === null || (env.locate(target).repo === null && !DISPOSABLE.some((p) => p.test(target))),
	);
	return outside ? decision("permission", "ask", "rm-outside-repos") : null;
}

function bashDecision(command, cwd, env) {
	const found = matching(BASH_RULES, command);
	const deletion = deleteDecision(command, cwd, env);
	if (deletion !== null) found.push(deletion);
	for (const token of command.split(TOKEN_SPLIT)) {
		const rule = secretRule(token);
		if (rule !== null) found.push(decision("permission", "deny", rule));
	}
	return strongest(found);
}

function fileDecision(tool, file, env) {
	const secret = secretRule(file);
	if (secret !== null) return decision("permission", "deny", secret);
	if (tool === "Read") return null;
	const { repo, key } = env.locate(file);
	if (repo === null)
		return DISPOSABLE.some((p) => p.test(file)) ? null : decision("permission", "ask", "outside-repos");
	const rules = env.exists(file) ? WRITE_RULES : [...NEW_FILE_RULES, ...WRITE_RULES];
	return strongest(matching(rules, key));
}

/** `input` is the PreToolUse hook payload; `env` is `{ locate, exists, home }`. */
export function decidePermission(input, env) {
	const { tool_name: tool, tool_input: args } = input;
	if (tool === "Bash") return bashDecision(String(args.command ?? ""), String(input.cwd ?? "/"), env);
	if (!FILE_TOOLS.has(tool)) return null;
	const file = args.file_path ?? args.notebook_path;
	return typeof file === "string" ? fileDecision(tool, file, env) : null;
}
