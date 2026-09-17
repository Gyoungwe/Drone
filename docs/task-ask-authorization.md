# Task workbench authorizations through ask_user

The workbench remains a real progress sidebar. Its header button toggles the mounted sidebar; the button now exposes its expanded state, target and tooltip. Pending authorization entries open a request directly rather than relying on a possibly unmounted chat card. Completed milestones use the journal's `completed` state.

`task_plan` and authorization-type `task_wait` automatically open the same native AskGate/AskDialog used by `ask_user` (via the extension UI select adapter). No extra model call is made. Sidebar buttons request an interview; they do not grant consent immediately. Plan approval, stage budget confirmation and outcome declarations also use this path. A scope handoff acknowledgement is not permission to run arbitrary commands or overwrite Wiki. Desktop and LAN transcripts hide task status messages; progress stays in the desktop sidebar.

Questions display the task goal, scope, directories and deliverables in plain language. The host binds the question to the task ID and revision internally; only the exact explicit approval option grants that revision. Cancel, close, custom text, elaboration, aborted requests, changed scope, changed binding or stale revision do not grant consent. Duplicate requests for the same contract share one question. Existing per-tool, spending and Wiki protections remain in force.
