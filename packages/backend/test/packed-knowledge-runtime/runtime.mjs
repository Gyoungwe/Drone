import { agentSlotCapabilityHandlers } from "../../src/plugins/agent-slot-capabilities";
import { PluginRuntimeBridge } from "../../src/plugins/coordinator";
import { fileCapabilityHandlers, PluginFileCapabilities } from "../../src/plugins/file-capabilities";
import { modelCapabilityHandlers } from "../../src/plugins/model-capabilities";
import { createProcessPluginRuntime } from "../../src/plugins/process-runtime";
import { PluginResourceManager } from "../../src/plugins/resource-capabilities";
import { getPluginSessionCaller } from "../../src/plugins/session-caller";
import { sessionCapabilityHandlers } from "../../src/plugins/session-capabilities";
import { sessionRecordCapabilityHandlers } from "../../src/plugins/session-record-capabilities";
import { canonicalProjectId } from "../../src/project-id";
import { acquireNativeSubagentSlot } from "../../src/tools/subagent/slots";

export async function createRuntime(ctx) {
	ctx.disabledSources = new Set();
	ctx.bridge = new PluginRuntimeBridge({
		source: (name) => ctx.sources.get(name),
		sources: () =>
			[...ctx.sources].map(([name, source]) => ({
				name,
				source,
				state: ctx.disabledSources.has(name) ? "disabled" : "enabled",
			})),
		enabled: (name) => !ctx.disabledSources.has(name),
		factory: (value) => createProcessPluginRuntime({ ...value, runtimeDirectory: ctx.runtimeDirectory }),
		approve: async (_owner, value, operation) => {
			ctx.approvals.push({ pluginId: value.pluginId, operation: operation ?? null });
			return !(
				(ctx.denyStateWrite && operation === "setReviewPolicy") ||
				(ctx.denyReviewWrites && ["applyReview", "undoReview"].includes(operation)) ||
				(ctx.denyModelGeneration && operation === "capability:model.generate")
			);
		},
		getSessionContext: (id) => getPluginSessionCaller(ctx.sessions, id),
		capabilities: (value) => (request) => createCapabilities(ctx, value, request),
	});
	ctx.stage = "runtime-activation";
	ctx.window = { id: 1, isDestroyed: () => false };
	ctx.binding = await ctx.bridge.bind("knowledge-artifact", ctx.window);
	ctx.application = ctx.bridge.selectSession(ctx.window, null);
}

function createFiles(ctx) {
	return PluginFileCapabilities.create(
		[
			{
				handle: "state",
				path: ctx.state,
				kind: "state",
				scope: { kind: "application" },
				...(ctx.grantStateWrite
					? { stateWrite: { registry: ctx.storage, storageId: "packed-plugin-state" } }
					: {}),
			},
			{
				handle: "vault",
				path: ctx.vault,
				kind: "files",
				scope: { kind: "application" },
				...(ctx.grantFileWrite ? { fileWrite: true } : {}),
			},
			{
				handle: "workspace",
				path: ctx.workspace,
				kind: "files",
				scope: { kind: "workspace", workspaceId: canonicalProjectId(ctx.workspace) },
			},
		],
		ctx.cache,
	);
}

async function createCapabilities(ctx, value, { pluginId, applicationId, signal, events }) {
	if (value === ctx.controls) return { resources: [], handlers: {} };
	const files = await createFiles(ctx);
	const resources = new PluginResourceManager({
		pluginId,
		applicationId,
		packageRoot: ctx.packageRoot,
		entries: ctx.source.resources,
		runtimeDirectory: ctx.runtimeDirectory,
		files,
		signal,
		events,
		leaseDirectory: ctx.leases,
	});
	const handlers = createHandlers(ctx, value, files, resources);
	return {
		handlers,
		resources: [
			{ kind: "state", handle: "state", access: ctx.grantStateWrite ? "read-write" : "read" },
			{ kind: "files", handle: "vault", access: ctx.grantFileWrite ? "read-write" : "read" },
		],
		resourcesLifecycle: { dispose: () => resources.disposeResources() },
		dispose: async () => {
			await resources.disposeResources();
			await files.drain();
		},
		finalRelease: async () => {
			resources.releaseReservations();
			files.releaseReservations();
		},
	};
}

async function acquireAgentSlot(ctx, cwd, signal) {
	const release = await acquireNativeSubagentSlot(cwd, signal);
	const trackedRelease = () => {
		release();
		ctx.agentSlots.delete(trackedRelease);
	};
	ctx.agentSlots.add(trackedRelease);
	return trackedRelease;
}

function createHandlers(ctx, value, files, resources) {
	return Object.fromEntries(
		Object.entries({
			...fileCapabilityHandlers(files),
			...resources.handlers(),
			...sessionCapabilityHandlers(ctx.sessions),
			...sessionRecordCapabilityHandlers(ctx.sessions, ctx.records),
			...(value.requestsModel
				? agentSlotCapabilityHandlers({ acquire: (cwd, signal) => acquireAgentSlot(ctx, cwd, signal) })
				: {}),
			...(value.requestsModel
				? modelCapabilityHandlers({
						registry: ctx.sessions,
						getRuntime: async () => ctx.modelRuntime,
						getProfileModel: async () => undefined,
						getProfileThinking: async () => undefined,
					})
				: {}),
		}).map(([name, handler]) => [
			name,
			{
				...handler,
				execute: (input, context) => {
					ctx.capabilityScopes.push({ name, scope: context.scope, bootstrap: context.bootstrap });
					if (name === "state.writeJson" && input.path.includes("/reviewed/") && ctx.failNextReviewRecord) {
						ctx.failNextReviewRecord = false;
						throw new Error("Acceptance record persistence failure");
					}
					return handler.execute(input, context);
				},
			},
		]),
	);
}
