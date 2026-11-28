// @vitest-environment node
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PluginRuntimeSource, StorageRegistry, sourceCapabilityHandlers } from "@drone/backend";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopRuntimeBridgeOptions } from "./runtime-bridge";

const desktop = vi.hoisted(() => ({
	bridgeOptions: undefined as DesktopRuntimeBridgeOptions | undefined,
	showMessageBox: vi.fn(),
	window: {},
	contents: { isDestroyed: vi.fn(() => false) },
}));
vi.mock("electron", () => ({
	app: { getPath: () => tmpdir() },
	BrowserWindow: { fromWebContents: () => desktop.window },
	dialog: { showMessageBox: desktop.showMessageBox },
	webContents: { fromId: () => desktop.contents },
}));
vi.mock("./runtime-bridge", () => ({
	DesktopRuntimeBridge: class {
		constructor(options: DesktopRuntimeBridgeOptions) {
			desktop.bridgeOptions = options;
		}
	},
}));

import { approveDesktopRuntime, createDesktopRuntime } from "./runtime-host";

const owner = { id: 1, isDestroyed: () => false };
const baseSource: PluginRuntimeSource = {
	pluginId: "@fixture/inquiry-rerun",
	packageRoot: tmpdir(),
	entrypoint: join(tmpdir(), "runtime.mjs"),
};
const provenance = {
	artifact: {
		id: "artifact-1",
		projectId: "/project",
		path: "results/out.csv",
		sha256: "a".repeat(64),
		runId: "source-job-1",
	},
	attempts: [{ parameters: { jobId: "source-job-1" } }],
	runProvenance: { workflow: "workflow-1" },
	reproducibility: "reproducible" as const,
};

function runtimeFor(inquiryRerun = true) {
	const host = {
		taskGrants: {},
		sessions: {},
		credentials: {},
		...(inquiryRerun
			? {
					inquiryRerun: {
						verifyRerun: async () => ({ originalJobId: "source-job-1", workflow: "workflow-1" }),
						rerunArtifact: async () => ({
							status: "submitted",
							jobId: "rerun-1",
							previousArtifactId: "artifact-1",
							previousSha256: "a".repeat(64),
						}),
					},
				}
			: {}),
	};
	const sessions = {
		getPluginCallerContext: () => undefined,
		getStorageRegistry: () => new StorageRegistry(),
		getPluginSessionCapabilities: () => ({}),
		getPluginSourceCapabilities: (source: PluginRuntimeSource) =>
			sourceCapabilityHandlers(host as never, source),
		getPluginHostEvents: () => undefined,
		getTaskGrants: () => ({ bindSourceValidator: vi.fn() }),
		getPluginWorkspaceCapabilities: () => ({}),
	};
	const manager = {
		builtinPackages: new Map(),
		runtimeSource: () => undefined,
		runtimeSources: () => [],
		classifyNativeSelection: () => undefined,
		isEnabled: () => true,
		isNativeSourceAvailable: () => false,
	};
	createDesktopRuntime(manager as never, tmpdir(), sessions as never, () => ({
		ownerId: owner.id,
		send: () => false,
		resolved: () => undefined,
	}));
	return async (source: PluginRuntimeSource) => {
		const options = desktop.bridgeOptions;
		if (!options?.capabilities) throw new Error("Desktop capability provider was not composed");
		const provider = options.capabilities(source, owner);
		if (typeof provider !== "function") throw new Error("Expected activation-scoped capabilities");
		return provider({
			pluginId: source.pluginId,
			applicationId: "app",
			signal: new AbortController().signal,
			events: { changed: () => undefined },
		});
	};
}

describe("desktop Inquiry rerun capability wiring", () => {
	afterEach(() => {
		desktop.bridgeOptions = undefined;
		desktop.showMessageBox.mockReset();
		desktop.contents.isDestroyed.mockReturnValue(false);
	});

	it("exposes inquiry.rerun only for its dedicated declaration and available port", async () => {
		const provider = runtimeFor();
		const enabled = await provider({ ...baseSource, requestsInquiryRerun: true });
		expect(enabled.handlers).toHaveProperty("inquiry.rerun");
		const ordinary = await provider(baseSource);
		expect(ordinary.handlers).not.toHaveProperty("inquiry.rerun");
		const p5 = await provider({ ...baseSource, p5: { rerun: "request" } });
		expect(p5.handlers).not.toHaveProperty("inquiry.rerun");
		const missingPort = await runtimeFor(false)({ ...baseSource, requestsInquiryRerun: true });
		expect(missingPort.handlers).not.toHaveProperty("inquiry.rerun");
	});

	it("shows the host-created approval detail in the desktop approval dialog", async () => {
		const provider = runtimeFor();
		const options = await provider({ ...baseSource, requestsInquiryRerun: true });
		const handler = options.handlers["inquiry.rerun"];
		if (!handler?.approvalDetail) throw new Error("Inquiry rerun approval formatter is unavailable");
		const detail = handler.approvalDetail(
			{
				artifactId: "artifact-1",
				projectId: "/project",
				provenance,
				originalJobId: "source-job-1",
				workflow: "workflow-1",
			},
			{
				pluginId: baseSource.pluginId,
				applicationId: "app",
				scope: { kind: "workspace", workspaceId: "/project", workspaceDirectory: "/project" },
			},
		);
		desktop.showMessageBox.mockResolvedValue({ response: 1 });
		expect(await approveDesktopRuntime(owner, baseSource, "capability:inquiry.rerun", detail)).toBe(true);
		expect(desktop.showMessageBox).toHaveBeenCalledWith(desktop.window, expect.objectContaining({ detail }));
		expect(detail).toContain("source-job-1");
		expect(detail).toContain("workflow-1");
	});
});
