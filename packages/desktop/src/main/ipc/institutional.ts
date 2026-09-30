import { InstitutionalContract, IpcChannels } from "@drone/shared";
import { BrowserWindow } from "electron";
import * as institutional from "../institutional-access";
import { bindContract, type ContractImplementation } from "./bind-contract";

function assertMainFrame(event: unknown, _contract: unknown, method: string): void {
	const invokeEvent = event as { sender?: Electron.WebContents; senderFrame?: Electron.WebFrameMain | null };
	if (
		!invokeEvent.sender ||
		!BrowserWindow.fromWebContents(invokeEvent.sender) ||
		invokeEvent.senderFrame !== invokeEvent.sender.mainFrame
	) {
		throw new Error(`Institutional ${method} requires main frame`);
	}
}

export function registerInstitutionalIpc(): void {
	const implementation: ContractImplementation<typeof InstitutionalContract> = {
		getStatus: () => institutional.getStatus(),
		saveConfig: (input) => institutional.saveConfig(input),
		openLogin: (...args) => institutional.openInstitutionalLogin(args[0]),
		openUrl: (url) => institutional.openInstitutionalUrl(url),
		clear: () => institutional.clear(),
		testAccess: (url) => institutional.testAccess(url),
	};
	bindContract(InstitutionalContract, implementation, {
		channelForMethod: (_contract, method) =>
			({
				getStatus: IpcChannels.InstitutionalGetStatus,
				saveConfig: IpcChannels.InstitutionalSaveConfig,
				openLogin: IpcChannels.InstitutionalOpenLogin,
				openUrl: IpcChannels.InstitutionalOpenUrl,
				clear: IpcChannels.InstitutionalClear,
				testAccess: IpcChannels.InstitutionalTestAccess,
			})[method as keyof typeof InstitutionalContract.methods],
		beforeInvoke: (event, _contract, method) => {
			if (method !== "getStatus") assertMainFrame(event, _contract, method);
		},
	});
}
