/** Installed canonical owner only; no host task engine or copied planning rules. */
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { taskHostLoader } from "@gyoungwe/pi-core/host";
import { createDroneRuntime } from "../../src/runtime";

export const createInstalledTaskRuntime = createDroneRuntime;
export const taskSdkExtensionPath = (name) =>
	join(resolve(import.meta.dirname, "../../../.."), ".pi", "extensions", name);
export const installedTaskPluginPath = () => createRequire(import.meta.url).resolve("@gyoungwe/pi-core");

export async function registerTaskRuntime(pi) {
	const host = taskHostLoader.load();
	const native = await host.createNativeSession();
	await native.extension(pi);
	let registry;
	const unsubscribe = pi.events.on("drone:task-runtime/v1", (payload) => {
		registry = payload.registry;
	});
	pi.events.emit("drone:task-runtime/request/v1", { version: 1 });
	unsubscribe();
	return registry.journal;
}

/** Unit integration helper still invokes the installed native adapter and its event service. */
export async function createTaskWorkbench({ pi, persist = () => {} } = {}) {
	const tools = [];
	const target = pi || {
		events: createEventBus(),
		on() {},
		registerCommand() {},
		registerTool: (tool) => tools.push(tool),
		getAllTools: () => tools,
		getCommands: () => [],
		sendMessage() {},
	};
	return registerTaskRuntime({
		...target,
		appendEntry: (_type, data) => persist(data),
	});
}
export const WORKBENCH_ENTRY = "drone-task-workbench-v2";
