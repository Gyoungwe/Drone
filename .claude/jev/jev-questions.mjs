/**
 * Every question the harness asks Jev, in one place to audit and edit. Each question asks one judgment a
 * person could make at a glance; the decisions built on the answers live in code (script-inspect.mjs,
 * task-route.mjs), so thresholds stay visible and testable.
 */

/** Permission point, script contents (paper §IV-A): state is `{ command, script_path, script }`. */
export const SCRIPT_QUESTIONS = {
	changes_outside_repo: {
		type: "noul",
		instructions: "Does `script` create, change or delete files outside the repository it runs in?",
		criteria: {
			true: "Writes to the home directory, another repository, a system path or an absolute path outside the repository",
			false: "Only touches paths inside the repository, the OS temp directory, or nothing at all",
		},
	},
	deletes_files: {
		type: "noul",
		instructions: "Does `script` delete files or directories?",
	},
	sends_network_data: {
		type: "noul",
		instructions: "Does `script` send data to a remote network service?",
		criteria: {
			true: "HTTP requests to non-local hosts, uploads, git push, package publishing",
			false: "Only local work, or requests to localhost; downloading pinned packages is not sending data",
		},
	},
	reads_credentials: {
		type: "noul",
		instructions:
			"Does `script` read credentials such as API keys, tokens, auth.json, .env files or SSH keys?",
	},
	publishes_release: {
		type: "noul",
		instructions: "Does `script` publish a package, push a git tag or create a release?",
	},
	rewrites_git_history: {
		type: "noul",
		instructions: "Does `script` rewrite or discard git history or uncommitted work?",
		criteria: {
			true: "Force push, reset --hard, rebase, commit --amend, filter-branch, branch -D, checkout or restore over local changes, clean -f",
			false: "Only reads git state, or adds new commits, branches or plain pushes",
		},
	},
};

/**
 * Lesson library (lesson-judge.mjs): one Noul per candidate lesson, the lesson written into the question
 * so each question is answered on its own. Intake state is `{ new_lesson: { cause, evidence } }`; a query
 * state is `{ failure }`, the failing output or the problem the model describes.
 */
export const LESSON_QUESTIONS = {
	sameLesson: (lesson) => ({
		type: "noul",
		instructions: `Does \`new_lesson\` describe the same failure, with the same cause, as this known lesson? Known lesson cause: "${lesson.cause}" Evidence: "${lesson.evidence}"`,
		criteria: {
			true: "Both name the same error and the same underlying cause, even in different words",
			false: "A different error, or the same error message produced by a different cause",
		},
	}),
	explainsFailure: (lesson) => ({
		type: "noul",
		instructions: `Is the problem in \`failure\` caused by this known cause: "${lesson.cause}"?`,
		criteria: {
			true: "The failure shows the error this cause produces, in the situation the cause describes",
			false: "The failure is a different error, or the same tool failing for another reason",
		},
	}),
};

/** Task point at UserPromptSubmit: state is `{ prompt }`. Code maps the kind to skills and rules. */
export const TASK_QUESTIONS = {
	task_kind: {
		type: "choice",
		instructions: "What kind of work does the user ask for in `prompt`?",
		criteria: {
			plugin_change:
				"Change code in the drone-plugins repository or a managed plugin package (pi-core, pi-knowledge, pi-inquiry and similar)",
			host_plugin_wiring:
				"Change how the Drone host locks, loads, stages or wires plugins, or work that spans both repositories",
			slimming: "Remove old code paths, merge packages, or split large files without changing behavior",
			ui: "Change the desktop renderer interface, styles, components or animations",
			host_other: "Any other code change in the Drone host repository",
			no_code:
				"A question, plan, status check, review of results or conversation with no code change asked for",
		},
	},
};
