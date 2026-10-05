import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const root = process.env.DRONE_REPO || process.cwd();
const desktop = process.env.DRONE_DESKTOP_DIR || `${root}/packages/desktop`;
const out = process.env.DRONE_SIM_OUT || "/tmp/drone-v19-sim/out";
const port = Number(process.env.DRONE_CDP_PORT || 9225);
const userData = process.env.DRONE_USER_DATA || "/tmp/drone-v19-sim/userData-disabled";
mkdirSync(out, { recursive: true });

async function waitForCdp(timeoutMs = 60_000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json`);
			const pages = await response.json();
			if (pages.some((item) => item.type === "page")) return true;
		} catch {}
		await delay(500);
	}
	return false;
}

const env = {
	...process.env,
	PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR || "/tmp/drone-v19-sim/agent-dev",
	DRONE_KNOWLEDGE_DIR: process.env.DRONE_KNOWLEDGE_DIR || "/tmp/drone-v19-sim/vault",
	DRONE_HARNESS_DISABLE: "familyPrompt,guard",
	DRONE_CDP_PORT: String(port),
};
const app = spawn(
	"npx",
	["electron-vite", "dev", `--remote-debugging-port=${port}`, "--", `--user-data-dir=${userData}`],
	{
		cwd: desktop,
		env,
		stdio: "inherit",
	},
);
let child;
let result;
try {
	const ready = await waitForCdp();
	if (!ready) throw new Error("disabled harness restart did not expose a CDP page");
	child = spawn(process.execPath, [`${root}/scripts/sim-v19/p4.mjs`], {
		cwd: root,
		env: {
			...env,
			DRONE_P4_DISABLED: "1",
			DRONE_P4_ROUNDS: "5",
			DRONE_SIM_OUT: `${out}/p4-disabled`,
			DRONE_TRACE_ROOT: process.env.DRONE_TRACE_ROOT || `${env.PI_CODING_AGENT_DIR}/sessions`,
		},
		stdio: "inherit",
	});
	const exitCode = await new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
	});
	const reportPath = `${out}/p4-disabled/p4.json`;
	let scenario = null;
	try {
		scenario = JSON.parse(readFileSync(reportPath, "utf8"));
	} catch {}
	const semanticOk = Boolean(
		scenario?.steps?.find((step) => step.name === "long-session-settled-rounds")?.ok &&
			scenario?.steps?.find((step) => step.name === "trace-harness-unit-distribution")?.ok,
	);
	result = {
		ok: Boolean(exitCode === 0 && semanticOk),
		executed: Boolean(ready && exitCode === 0 && scenario),
		ready,
		exitCode,
		disabled: env.DRONE_HARNESS_DISABLE,
		requestedRounds: 5,
		out: `${out}/p4-disabled`,
		scenario,
	};
} catch (error) {
	result = {
		ok: false,
		error: String(error?.stack || error),
		disabled: env.DRONE_HARNESS_DISABLE,
		requestedRounds: 5,
	};
} finally {
	if (child && child.exitCode === null) child.kill("SIGTERM");
	if (app.exitCode === null) app.kill("SIGTERM");
}
console.log(JSON.stringify(result));
if (!result.ok) process.exitCode = 1;
