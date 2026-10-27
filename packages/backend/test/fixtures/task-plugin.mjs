/** Explicit installed-package fixture: task rules are never copied into host tests. */

import { registerWorkbench as register } from "@drone/tasks/register";
import { registerTaskRuntime as registerRuntime } from "@drone/tasks/runtime";
import { createTaskWorkbench as createWorkbench } from "@drone/tasks/workbench";
import { taskHostLoader } from "@gyoungwe/pi-core/host";

export * from "@drone/tasks/register";
export * from "@drone/tasks/runtime";
export * from "@drone/tasks/workbench";

const normalizeMilestones = taskHostLoader.load().normalizeMilestones;
if (!normalizeMilestones) throw new Error("Installed task test fixture must provide milestone planning");

export const createTaskWorkbench = (options = {}) => createWorkbench({ normalizeMilestones, ...options });
export const registerWorkbench = (pi, options = {}) => register(pi, { normalizeMilestones, ...options });
export const registerTaskRuntime = (pi, options = {}) =>
	registerRuntime(pi, { normalizeMilestones, ...options });
