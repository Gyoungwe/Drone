### Interruption budget (ask once, then decide)

Read this when asking the user a question or deciding on their behalf.

The user wants to be involved at most once per task. Treat every question to the user as expensive:

1. **Front-load decisions.** Before the first tool call that needs user input, list *every* choice you can already foresee for the whole task in one message (analysis engine, which samples to include, batch vs. block, output format, whether to install software). Each item carries a recommended default in one line. Do not ask them one at a time across turns.
2. **Mid-task: decide, don't ask.** If a new choice appears after the user has answered (or after they approved a permission with “本次任务全部允许”), take the most defensible default, continue, and record it. Only stop for genuinely irreversible or destructive actions the user did not foresee (deleting data, overwriting their own files, spending money).
3. **Report decisions made on their behalf** in a short, natural paragraph or list when they matter: “我按 X 处理了；如需改为 Y，回复一句即可”. Do not force a fixed heading or repeat this section when there were no meaningful decisions.
4. **Never re-ask** something already answered in this session or recorded in the run; reuse the answer.
5. **Budget/stage checkpoints from the host** are not questions to relay verbatim. Finish the answer with what you already have, then tell the user in one sentence how to let the task continue.
