# Specialist orchestration reliability

Knowledge specialists use a deterministic policy and bounded budget ledger. Each request receives a public decision (`run`, `skip`, `wait`, or `ask-user`) and reason code. Reservations happen before asynchronous skill loading; cancellation, turn replacement, queue deadlines, and provider failure release reservations. Session totals are capped independently from per-turn token, cost, tool-operation and run totals. A request is deduplicated only when its bounded task, summary and source fingerprints match; one role is otherwise limited to one call per turn.

The scheduler never invents token or cost telemetry. `usage.reported` is false when a provider omits usage, and zero-valued fields in that case are placeholders for compatibility rather than estimates. Elapsed time is wall-clock observation only.

Provider calls are intentionally not retried by the specialist coordinator; permission and credential failures therefore cannot fan out into repeated requests.

The Vitest orchestration/stress suites and `scripts/stress-knowledge.mjs` use synthetic fixtures and fake providers. Their 20/50-turn replay demonstrates bounded counters, cancellation recovery, and deterministic decisions; it is not a live-model benchmark and makes no claim about provider quality, latency, or billing.

Integration APIs: `decideSpecialistRun()` and `createSpecialistBudget()` are pure local policy helpers; `specialists.budget()` exposes a bounded snapshot for Run Inspector surfaces; existing `noteKnowledgeSpecialist()` receives decision, reason code, budget, elapsed time, and provider-reported usage fields.

When a session budget reaches its limit, “continue” cannot silently extend it. The recovery action is to start a new session or have a human change the bounded specialist settings; model prompts have no budget-escalation capability. `specialists.decisionHistory()` exposes the bounded per-turn decision list for transcript integration.
