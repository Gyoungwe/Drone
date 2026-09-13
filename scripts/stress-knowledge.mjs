import { createSpecialistBudget, decideSpecialistRun } from "../.pi/lib/knowledge/orchestration-policy.mjs";

const turns = Number(process.argv[2] || 50);
const budget = createSpecialistBudget({ maxRunsPerTurn: 4, maxRunsPerSession: 20, maxToolOperations: 80 });
let runs = 0;
let skips = 0;
for (let turn = 0; turn < turns; turn++) {
	budget.begin();
	const role = turn % 2 ? "evidence" : "navigator";
	const sourcePaths = role === "evidence" ? ["Library/Papers/synthetic.md"] : [];
	const decision = decideSpecialistRun({ role, task: `synthetic-topic-${turn % 5}`, sourcePaths });
	if (decision.decision === "run" && budget.reserve(`${turn}:${role}`)) {
		budget.commit(`${turn}:${role}`, budget.snapshot.turn);
		runs++;
	} else skips++;
}
const metrics = { provider: "deterministic-fake-policy", turns, runs, skips, budget: budget.snapshot };
const invariant = runs <= 20 && budget.snapshot.reservations === 0 && budget.snapshot.toolOperations <= 80;
console.log(JSON.stringify({ ...metrics, invariant }, null, 2));
if (!invariant) process.exitCode = 1;
