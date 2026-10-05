import type { BackendServices, InquiryServicePort } from "@drone/backend";
import { InquiryContract, IpcChannels } from "@drone/shared";
import { BrowserWindow } from "electron";
import { bindContract, type ContractImplementation } from "./bind-contract";

function requireMainFrame(event: unknown): void {
	const invokeEvent = event as {
		sender?: Electron.WebContents;
		senderFrame?: Electron.WebFrameMain | null;
	};
	if (
		!invokeEvent.sender ||
		!BrowserWindow.fromWebContents(invokeEvent.sender) ||
		invokeEvent.senderFrame !== invokeEvent.sender.mainFrame
	)
		throw new Error("Inquiry UI requests require the application main frame");
}

function uiError(code: string, detail: string) {
	return {
		code,
		severity: "error" as const,
		source: "app" as const,
		titleKey: "error.title.inquiry",
		detail: detail.slice(0, 4096),
		actions: ["copyDetail" as const],
		timestamp: Date.now(),
	};
}

/** Bind the renderer-facing B5 artifact provenance projection. */
export function registerInquiryIpc(
	backendOrInquiry: BackendServices | InquiryServicePort,
	sendEvent: (channel: string, payload: unknown) => void = () => {},
): () => void {
	const inquiry = "inquiry" in backendOrInquiry ? backendOrInquiry.inquiry : backendOrInquiry;
	const implementation: ContractImplementation<typeof InquiryContract> = {
		listArtifacts: async () => [...(await inquiry.listArtifacts())],
		artifactProvenance: async (artifactId) => {
			const result = await inquiry.artifactProvenance(artifactId);
			return result ?? uiError("artifact_not_found", `Artifact not found: ${artifactId}`);
		},
		rerunArtifact: async (artifactId) => {
			try {
				return await inquiry.rerunArtifact(artifactId);
			} catch (error) {
				return uiError("artifact_rerun_failed", error instanceof Error ? error.message : String(error));
			}
		},
	};
	const unbind = bindContract(InquiryContract, implementation, {
		channelForMethod: (_contract, method) =>
			({
				listArtifacts: IpcChannels.InquiryArtifacts,
				artifactProvenance: IpcChannels.InquiryArtifactProvenance,
				rerunArtifact: IpcChannels.InquiryRerunArtifact,
			})[method as keyof typeof InquiryContract.methods],
		beforeInvoke: (event) => requireMainFrame(event),
	});
	const unsubscribe =
		typeof inquiry.onRerunUpdated === "function"
			? inquiry.onRerunUpdated((result) => sendEvent(IpcChannels.InquiryRerunUpdatedEvent, result))
			: () => {};
	return () => {
		unbind();
		unsubscribe();
	};
}
