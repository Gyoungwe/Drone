/** Explicit installed-package fixture: task rules are never copied into host tests. */

import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { registerWorkbench as register } from "@drone/tasks/register";
import { registerTaskRuntime as registerRuntime } from "@drone/tasks/runtime";
import { createTaskWorkbench as createWorkbench } from "@drone/tasks/workbench";
import { taskHostLoader } from "@gyoungwe/pi-core/host";
import { createDroneRuntime } from "../../src/runtime";

export * from "@drone/tasks/register";
export * from "@drone/tasks/runtime";
export * from "@drone/tasks/workbench";

const normalizeMilestones = taskHostLoader.load().normalizeMilestones;
if (!normalizeMilestones) throw new Error("Installed task test fixture must provide milestone planning");

export const createTaskWorkbench = (options = {}) => createWorkbench({ normalizeMilestones, ...options });
export const registerWorkbench = (pi, options = {}) => register(pi, { normalizeMilestones, ...options });
export const registerTaskRuntime = (pi, options = {}) =>
	registerRuntime(pi, { normalizeMilestones, ...options });

/** Direct SessionService fixtures bypass createBackend, so bind the installed task host explicitly. */
export function createInstalledTaskRuntime() {
	const runtime = createDroneRuntime();
	const host = taskHostLoader.load();
	runtime.tasks.workbench = { version: host.contractVersion, normalizeMilestones: host.normalizeMilestones };
	return runtime;
}

/** Resolve legacy SDK extension fixtures independently of the test runner working directory. */
export const taskSdkExtensionPath = (name) =>
	join(resolve(import.meta.dirname, "../../../.."), ".pi", "extensions", name);

/** Task hooks are activated by the installed native package, never by knowledge resources. */
export const installedTaskPluginPath = () => createRequire(import.meta.url).resolve("@gyoungwe/pi-core");
