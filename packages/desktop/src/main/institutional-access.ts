import {
	buildProxiedUrl,
	clearInstitutionalSession,
	createLogger,
	getInstitutionalStatus,
	getPartitionName,
	institutionalFetch,
	isElectronAvailable,
	loadInstitutionalConfig,
	saveInstitutionalConfig,
	touchInstitutionalLogin,
} from "@drone/backend";
import { BrowserWindow, shell } from "electron";

const log = createLogger("institutional-main");

let loginWindow: BrowserWindow | null = null;

function getOrCreateLoginWindow(): BrowserWindow {
	if (loginWindow && !loginWindow.isDestroyed()) {
		loginWindow.focus();
		return loginWindow;
	}
	const partition = getPartitionName();
	const win = new BrowserWindow({
		width: 1220,
		height: 860,
		show: true,
		title: "机构访问登录 - Drone",
		webPreferences: {
			partition,
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
		},
		autoHideMenuBar: true,
	});
	loginWindow = win;
	win.on("closed", () => {
		loginWindow = null;
	});
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("http://") || url.startsWith("https://")) {
			return { action: "allow" };
		}
		void shell.openExternal(url);
		return { action: "deny" };
	});

	win.webContents.on("did-navigate", async (_event, url) => {
		log.info("institutional window navigated", { url: url.slice(0, 200) });
		try {
			await touchInstitutionalLogin(url);
		} catch {}
	});

	win.webContents.on("did-finish-load", async () => {
		try {
			const url = win.webContents.getURL();
			await touchInstitutionalLogin(url);
		} catch {}
	});

	return win;
}

export async function openInstitutionalLogin(url?: string): Promise<{ url: string }> {
	const cfg = await loadInstitutionalConfig();
	const target =
		url ||
		cfg.lastLoginUrl ||
		cfg.ezproxyTemplate?.replace("%s", "") ||
		"https://www.google.com/search?q=institutional+login";
	let initialUrl = target;
	if (initialUrl.includes("%s")) initialUrl = initialUrl.replace("%s", "https://www.nature.com/");
	try {
		new URL(initialUrl);
	} catch {
		initialUrl = "https://www.google.com/";
	}

	const win = getOrCreateLoginWindow();
	await win.loadURL(initialUrl);
	win.show();
	win.focus();
	return { url: initialUrl };
}

export async function openInstitutionalUrl(url: string): Promise<{ url: string }> {
	if (!url || typeof url !== "string") throw new Error("Invalid URL");
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error("Invalid URL");
	}
	if (!/^https?:$/.test(parsed.protocol)) throw new Error("Only http(s) URLs allowed");

	const cfg = await loadInstitutionalConfig();
	const proxied = cfg.ezproxyTemplate ? buildProxiedUrl(url, cfg.ezproxyTemplate) : null;
	const finalUrl = proxied || url;

	const win = getOrCreateLoginWindow();
	await win.loadURL(finalUrl);
	win.show();
	win.focus();
	return { url: finalUrl };
}

export async function getStatus() {
	return getInstitutionalStatus();
}

export async function saveConfig(input: {
	ezproxyTemplate?: string;
	openUrlResolver?: string;
	institutionName?: string;
	autoDownloadEnabled?: boolean;
	perTaskLimit?: number;
}) {
	return saveInstitutionalConfig(input as any);
}

export async function clear() {
	await clearInstitutionalSession();
	try {
		const { clearInstitutionalLogin } = await import("@drone/backend");
		await clearInstitutionalLogin();
	} catch {}
	return getInstitutionalStatus();
}

export async function testAccess(url: string) {
	if (!url) throw new Error("URL required");
	try {
		new URL(url);
	} catch {
		throw new Error("Invalid URL");
	}
	const cfg = await loadInstitutionalConfig();
	const proxied = cfg.ezproxyTemplate ? buildProxiedUrl(url, cfg.ezproxyTemplate) : null;

	if (!isElectronAvailable()) {
		return {
			url,
			proxiedUrl: proxied || undefined,
			status: 0,
			ok: false,
			error: "Electron session unavailable (not in desktop)",
			via: "institutional_session" as const,
		};
	}

	const candidates: Array<{ via: "ezproxy" | "institutional_session"; url: string }> = [];
	if (proxied) candidates.push({ via: "ezproxy", url: proxied });
	candidates.push({ via: "institutional_session", url });

	for (const cand of candidates) {
		try {
			const res = await institutionalFetch(cand.url, { timeoutMs: 15000 });
			return {
				url,
				proxiedUrl: proxied || undefined,
				status: res.status,
				ok: res.status >= 200 && res.status < 400,
				contentType: res.headers["content-type"],
				finalUrl: res.finalUrl,
				via: cand.via,
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (cand === candidates[candidates.length - 1]) {
				return {
					url,
					proxiedUrl: proxied || undefined,
					status: 0,
					ok: false,
					error: message,
					via: cand.via,
				};
			}
		}
	}
	return {
		url,
		proxiedUrl: proxied || undefined,
		status: 0,
		ok: false,
		error: "No candidate succeeded",
		via: "institutional_session" as const,
	};
}
