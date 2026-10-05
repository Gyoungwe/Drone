import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackend } from "@drone/backend";
import { evaluateMetacognitivePublication } from "@drone/knowledge";
import { IpcChannels } from "@drone/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: any[]) => unknown>(),
	removeHandler: vi.fn(),
	window: { isDestroyed: () => false },
	fromWebContents: vi.fn(),
}));

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: any[]) => unknown) => mocks.handlers.set(channel, handler),
		removeHandler: mocks.removeHandler,
	},
	BrowserWindow: { fromWebContents: mocks.fromWebContents },
}));

import { registerDecisionsIpc } from "./decisions";
import { registerInquiryIpc } from "./inquiry";

describe("desktop project-scoped inquiry IPC", () => {
	beforeEach(() => {
		mocks.handlers.clear();
		mocks.removeHandler.mockClear();
		mocks.fromWebContents.mockReturnValue(mocks.window);
	});

	it("uses the real session workspace for decisions, artifacts, revoke and confirmation", async () => {
		const root = await mkdtemp(
			join(process.platform === "darwin" ? "/tmp" : tmpdir(), "drone-desktop-inquiry-ipc-"),
		);
		const workspace = join(root, "workspace");
		const agentDir = join(root, "agent");
		await mkdir(workspace);
		await mkdir(agentDir);
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const backend = createBackend({
			defaultCwd: workspace,
			userDataDir: join(root, "userData"),
			projectsDir: join(root, "userData", "inquiry-projects"),
			legacyInquiryDir: join(root, "userData", "inquiry"),
			projectTrust: false,
			permissionGates: false,
			lazyCapabilities: false,
			tools: [],
		});
		const frame = {};
		const event = { sender: { mainFrame: frame }, senderFrame: frame };
		const unbindDecisions = registerDecisionsIpc(backend);
		const unbindInquiry = registerInquiryIpc(backend);
		try {
			const session = await backend.sessions.createSession({ cwd: workspace });
			await backend.inquiry.recordTaskTerminal({
				id: "task-terminal-1",
				taskId: "task-1",
				runId: "run-1",
				status: "succeeded",
				projectId: workspace,
				artifacts: [{ path: "runs/run-1/report.md", bytes: 1, sha256: "a".repeat(64) }],
			});
			await backend.inquiry.recordDecision({
				id: "dispatch-1",
				kind: "subagent-dispatch",
				summary: "Dispatch reviewer",
				basis: ["run:run-1"],
				projectId: workspace,
			});
			await backend.inquiry.drainEvents();
			let alias = `${workspace.replace(/^\/tmp\//, "/private/tmp/")}/`;
			if (process.platform !== "darwin") {
				alias = join(root, "workspace-alias");
				await symlink(workspace, alias, process.platform === "win32" ? "junction" : "dir");
			}
			const list = (await mocks.handlers.get(IpcChannels.DecisionsList)!(event, alias)) as Array<{
				id: string;
				projectId: string;
			}>;
			expect(list).toHaveLength(1);
			expect(list[0]?.projectId).toBe(
				await import("@drone/backend").then(({ canonicalProjectId }) => canonicalProjectId(workspace)),
			);
			const artifacts = (await mocks.handlers.get(IpcChannels.InquiryArtifacts)!(event, alias)) as unknown[];
			expect(artifacts).toHaveLength(1);
			const decisionId = (list[0] as { id: string }).id;
			const revoked = (await mocks.handlers.get(IpcChannels.DecisionsRevoke)!(
				event,
				decisionId,
				"Review dispatch",
			)) as { status: string };
			expect(revoked.status).toBe("revoked");
			const pending = await backend.inquiry.readOnlySnapshot(alias);
			expect(pending?.artifacts[0]?.status).toBe("pending-review");
			const blocked = evaluateMetacognitivePublication("See [[runs/run-1/report.md]]", {
				artifacts: [{ path: "runs/run-1/report.md", status: "pending-review" }],
			});
			expect(blocked.failures).toEqual(
				expect.arrayContaining([expect.objectContaining({ code: "artifact-pending-review" })]),
			);
			await mocks.handlers.get(IpcChannels.DecisionsConfirm)!(event, decisionId, "Human checked report");
			expect((await backend.inquiry.readOnlySnapshot(alias))?.artifacts[0]?.status).toBe("valid");
			await backend.sessions.closeSession(session.sessionId);
		} finally {
			unbindDecisions();
			unbindInquiry();
			backend.dispose();
			if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
			await rm(root, { recursive: true, force: true });
		}
	});
});
