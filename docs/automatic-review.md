# Default automatic review

Routine current-project write/edit calls now use the existing canonical-path task guard rather than repeating whole-tool approvals. Explicit write/edit configuration, pattern rules, denies, sensitive/credential files, out-of-project paths, temporary-zone restrictions and existing full-access semantics are preserved. Strict tool confirmation is available in the composer. Ordinary test commands keep their existing allow policy; git push/npm publish and common Windows deletion commands require confirmation under defaults. This is not a complete shell sandbox.

Knowledge review is application-wide, default `automatic`, configured in the knowledge panel. `strict` retains the old mandatory publication workflow. `DRONE_REVIEW_MODE=strict` enforces strict behavior for deployments/tests. An unreadable or malformed policy fails to strict. Model tools cannot change this setting.

Automatic publication still uses the host seal and validator. Only named evidence-quality errors become visible reminders; unknown failures, binding/scope/ticket errors, interruption, protocol/tool budgets and setup authorization remain blocking. Automatic mode does not materialize extra search/read receipts or retry stale-index checks. The UI says **已保存** or **有提醒**, never scientific verification. The underlying `released` status remains for transport compatibility.

Wiki candidates continue to require actual source read receipts, path/binding/size checks and exact hashes. New pages and pages matching an archived applied hash may be saved automatically. Unknown/human-edited pages remain **待确认**. All writes retain managed-block protection, source rechecks, exact before/after history and `scientificallyVerified=false`; automatic saves explicitly have `humanReviewed=false`. No model-review request is added. The latest ten applied entries appear in the knowledge panel; undo requires a user confirmation and refuses to replace intervening changes.

Knowledge review and tool confirmation are separate settings: changing one does not silently weaken the other. This change does not raise spending limits, authorize remote embeddings, publish externally or modify Zotero.
