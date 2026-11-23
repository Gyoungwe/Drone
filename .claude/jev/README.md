# Jev harness

These are Claude Code hooks that turn AGENTS.md red lines and the token budget into deterministic
decision points. Every point answers `{point, answer, rule, confidence}` and appends that answer to
`.claude/jev-state/decisions.jsonl`, which git ignores. The entry is `hook.mjs`, registered in
`.claude/settings.json`.

| Point | Event | Answers |
|---|---|---|
| permission | PreToolUse | `deny` / `ask` / no opinion. See `permission-policy.mjs`: release, tag, push to main, secret paths, new `src/*.mjs`, frozen packages, baselines, relock and the harness itself |
| output | PreToolUse → `jev-run.mjs` | Squeezable check commands (`command-route.mjs`) run through the ladder: `full` / `short` / `long` / `hide` |
| context | PostToolUse, SessionStart | Rules bound to the touched path (`context-rules.mjs`): short on Read, long with the PITFALLS pointer on Edit/Write; each rule shows once per level and is shown again after compaction |
| skills | UserPromptSubmit | Names the UI and animation skills only when the prompt is about UI |

## Output ladder

- `full`: the output is at most 80 lines, or `JEV_RAW=1 <command>` forced it, which also skips routing entirely.
- `short`: the check passed. The view is one line with the summary and the chunk id.
- `long`: the check failed. The view keeps only failing test names, assertion and compiler error lines; it
  has no stacks and no surrounding context.
- `hide`: the same command in the same directory returned the same output and exit code as last time.

The full output always stays in `.claude/jev-state/chunks/<id>.log`. To read it back:

```sh
node .claude/jev/jev-run.mjs --show <id> --grep '<regex>'
```

## Rules of the harness

- The harness fails open. A hook error never blocks a tool call; it is reported as a `systemMessage`.
- Edits under `.claude/jev/`, `.claude/hooks/` and `.claude/settings*.json` ask first (`harness-self`).
- Paths are keyed by repository (`drone:` or `drone-plugins:`), not by worktree, so the rules hold in
  every worktree and in the sibling plugin checkout.
- Tests are in `jev.test.mjs` and run under `npm run test:arch`.
