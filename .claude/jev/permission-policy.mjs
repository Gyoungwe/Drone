/**
 * Jev permission point (paper §IV-A): "should this tool call run?" answered deny / ask, or `null` for no
 * opinion, which leaves Claude Code's own permission flow in charge. The rules encode AGENTS.md red lines
 * that were previously kept by discipline alone. Pure: repository lookup and file existence come in
 * through `env` so tests need no filesystem.
 */
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
	[/\bgit\s+push\b[^|;&]*\s(?:-f|--force|--force-with-lease)(?:=\S+)?(?=\s|$)/, "ask", "force-push"],
	[/\bgit\s+reset\b[^|;&]*--hard\b/, "ask", "reset-hard"],
	[/\bgit\s+clean\s+-\w*f/, "ask", "git-clean"],
	[/\bgit\s+branch\b[^|;&]*\s-D\b/, "ask", "branch-delete"],
	[/\brm\s+-\w*r/, "ask", "rm-recursive"],
];

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

function bashDecision(command) {
	const found = matching(BASH_RULES, command);
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
	if (repo === null) return decision("permission", "ask", "outside-repos");
	const rules = env.exists(file) ? WRITE_RULES : [...NEW_FILE_RULES, ...WRITE_RULES];
	return strongest(matching(rules, key));
}

/** `input` is the PreToolUse hook payload; `env` is `{ locate, exists }`. */
export function decidePermission(input, env) {
	const { tool_name: tool, tool_input: args } = input;
	if (tool === "Bash") return bashDecision(String(args.command ?? ""));
	if (!FILE_TOOLS.has(tool)) return null;
	const file = args.file_path ?? args.notebook_path;
	return typeof file === "string" ? fileDecision(tool, file, env) : null;
}
