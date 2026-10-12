/** P14 AwaitingInput 角标：macOS / Linux 用 dock 计数，Windows 用任务栏 overlay icon + 闪烁。 */
export interface BadgeWindow {
	setOverlayIcon(image: unknown, description: string): void;
	flashFrame(flag: boolean): void;
	isFocused(): boolean;
}

export interface BadgeHost {
	platform: string;
	setBadgeCount(count: number): boolean | void;
	window: BadgeWindow | null;
	imageFromDataUrl(url: string): unknown;
}

export function applyAttentionBadge(host: BadgeHost, count: number, overlayDataUrl: string | null): void {
	const n = Math.max(0, Math.floor(count));
	if (host.platform === "win32") {
		const win = host.window;
		if (!win) return;
		win.setOverlayIcon(
			n > 0 && overlayDataUrl ? host.imageFromDataUrl(overlayDataUrl) : null,
			n > 0 ? `${n}` : "",
		);
		win.flashFrame(n > 0 && !win.isFocused());
		return;
	}
	host.setBadgeCount(n);
}
