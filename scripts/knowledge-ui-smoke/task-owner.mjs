import { createEventBus } from "@earendil-works/pi-coding-agent";
import { taskHostLoader } from "@gyoungwe/pi-core/host";

/** Synthetic UI fixture: all task rules and recovery still execute in the installed owner. */
export async function createTaskFixture(cwd, { persist = () => {} } = {}) {
	const owner = taskHostLoader.load(),
		native = await owner.createNativeSession();
	const events = createEventBus(),
		hooks = new Map(),
		tools = [];
	events.on("drone:task-read-check", (request) => {
		request.claim();
		request.resolve(request.path.startsWith(`${cwd}/`));
	});
	const pi = {
		events,
		on(name, handler) {
			hooks.set(name, [...(hooks.get(name) || []), handler]);
		},
		registerTool: (tool) => tools.push(tool),
		registerCommand() {},
		getAllTools: () => tools,
		getCommands: () => [],
		sendMessage() {},
		appendEntry: (_type, data) => persist(data),
	};
	await native.extension(pi);
	let registry;
	const unsubscribe = events.on("drone:task-runtime/v1", (payload) => {
		registry = payload.registry;
	});
	events.emit("drone:task-runtime/request/v1", { version: 1 });
	unsubscribe();
	const ctx = { cwd, sessionManager: { getSessionId: () => "isolated-ui", getBranch: () => [] } };
	for (const handler of hooks.get("session_start") || []) await handler({}, ctx);
	return { journal: registry.journal, dispose: () => owner.dispose() };
}
