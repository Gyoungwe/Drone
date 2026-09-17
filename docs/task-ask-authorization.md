# Task workbench authorizations through ask_user

The workbench remains a real progress sidebar. Its header button toggles the mounted sidebar; the button now exposes its expanded state, target and tooltip. Pending authorization entries open a request directly rather than relying on a possibly unmounted chat card. Completed milestones use the journal's `completed` state.

`task_plan` and authorization-type `task_wait` automatically open the same native AskGate/AskDialog used by `ask_user` (via the extension UI select adapter). No extra model call is made. Card buttons only request an interview; they no longer grant consent immediately. Plan approval, stage budget confirmation and outcome declarations also use this path. A scope handoff acknowledgement is not permission to run arbitrary commands or overwrite Wiki.

Questions display task ID/revision, scope, directories, deliverables and existing budget. Only the exact explicit approval option can grant the displayed revision. Cancel, close, custom text, elaboration, aborted requests, changed scope, changed binding or stale revision do not grant consent. Duplicate requests for the same contract share one question. Existing per-tool, spending and Wiki protections remain in force.
