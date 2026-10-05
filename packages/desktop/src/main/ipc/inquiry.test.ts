import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	fromWebContents: vi.fn(),
}));

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(channel, handler),
		removeHandler: vi.fn(),
	},
	BrowserWindow: { fromWebContents: mocks.fromWebContents },
}));

import { IpcChannels } from "@drone/shared";
import { registerInquiryIpc } from "./inquiry";

describe("registerInquiryIpc", () => {
	beforeEach(() => {
		mocks.handlers.clear();
		mocks.fromWebContents.mockReturnValue({});
	});

	it("validates artifact ids before dispatch and returns a structured UiError", async () => {
		const service = {
			listArtifacts: vi.fn(async () => []),
			artifactProvenance: vi.fn(async () => undefined),
			rerunArtifact: vi.fn(),
		};
		registerInquiryIpc(service as never);
		const frame = {};
		const event = { sender: { mainFrame: frame }, senderFrame: frame };
		const invalid = await mocks.handlers.get(IpcChannels.InquiryArtifactProvenance)!(event, "\u0000bad");
		expect(invalid).toMatchObject({
			code: "invalid_arguments",
			severity: "error",
			source: "app",
			actions: ["copyDetail"],
		});
		expect(service.artifactProvenance).not.toHaveBeenCalled();
	});

	it("returns a structured not-found UiError for a valid unknown id", async () => {
		const service = {
			listArtifacts: vi.fn(async () => []),
			artifactProvenance: vi.fn(async () => undefined),
			rerunArtifact: vi.fn(),
		};
		registerInquiryIpc(service as never);
		const frame = {};
		const result = await mocks.handlers.get(IpcChannels.InquiryArtifactProvenance)!(
			{ sender: { mainFrame: frame }, senderFrame: frame },
			"artifact-1",
		);
		expect(result).toMatchObject({ code: "artifact_not_found", severity: "error", source: "app" });
	});

	it("returns a submitted rerun receipt without waiting for completion", async () => {
		const service = {
			listArtifacts: vi.fn(async () => []),
			artifactProvenance: vi.fn(async () => undefined),
			rerunArtifact: vi.fn(async () => ({
				status: "submitted" as const,
				jobId: "job-1",
				previousArtifactId: "artifact-1",
				previousSha256: "a".repeat(64),
			})),
		};
		registerInquiryIpc(service as never);
		const frame = {};
		const result = await mocks.handlers.get(IpcChannels.InquiryRerunArtifact)!(
			{ sender: { mainFrame: frame }, senderFrame: frame },
			"artifact-1",
		);
		expect(result).toMatchObject({ status: "submitted", jobId: "job-1" });
	});
});
