import { copyFile, rename, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { type HostFileAction, validateNewFileName } from "@drone/shared";
import { resolveResourcePath } from "./file-preview";

/** 依赖注入：单测用假实现，生产用 Electron（见 ipc/app.ts）。 */
/** Normalize Electron's empty-success / non-empty-error result for external open calls. */
export function ensureExternalOpenSucceeded(error: string | undefined): void {
	if (error) throw new Error(`无法使用系统应用打开资源：${error}`);
}

export interface FileActionHost {
	platform: NodeJS.Platform;
	showItemInFolder(path: string): void;
	openPath(path: string): Promise<string>;
	openExternal(url: string): Promise<void>;
	trashItem(path: string): Promise<void>;
	showSaveDialog(defaultPath: string): Promise<string | null>;
	writeClipboard(formats: { text?: string; buffers?: Record<string, Buffer> }): void;
}

/**
 * 文件放进系统剪贴板，可在资源管理器 / Finder / 文件管理器里粘贴。
 * cut：Windows 写 Preferred DropEffect=MOVE，Linux 写 gnome-copied-files 的 cut 前缀；macOS Finder 没有文件剪切，等同复制。
 */
export function clipboardFormats(
	path: string,
	platform: NodeJS.Platform,
	cut: boolean,
): { text?: string; buffers?: Record<string, Buffer> } {
	if (platform === "win32") {
		const buffers: Record<string, Buffer> = { FileNameW: Buffer.from(`${path}\0`, "utf16le") };
		if (cut) buffers["Preferred DropEffect"] = Buffer.from([2, 0, 0, 0]);
		return { text: path, buffers };
	}
	if (platform === "darwin") {
		const escaped = path.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
		const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><array><string>${escaped}</string></array></plist>`;
		return { text: path, buffers: { NSFilenamesPboardType: Buffer.from(plist, "utf8") } };
	}
	const uri = pathToFileURL(path).href;
	return {
		text: path,
		buffers: {
			"text/uri-list": Buffer.from(`${uri}\r\n`, "utf8"),
			"x-special/gnome-copied-files": Buffer.from(`${cut ? "cut" : "copy"}\n${uri}`, "utf8"),
		},
	};
}

export async function runFileAction(
	host: FileActionHost,
	action: HostFileAction,
	target: string,
	cwd: string | null,
	arg: string | null,
): Promise<string | null> {
	const path = resolveResourcePath(target, cwd ?? undefined);
	const info = await stat(path);
	if (!info.isFile() && action !== "reveal" && action !== "openDefault")
		throw new Error("only files support this action");
	switch (action) {
		case "reveal":
			host.showItemInFolder(path);
			return null;
		case "openDefault": {
			const error = await host.openPath(path);
			ensureExternalOpenSucceeded(error);
			return null;
		}
		case "openInEditor":
			// VS Code URL 协议：不拼命令行，不依赖 PATH
			{
				const normalized = path.replaceAll("\\", "/");
				await host.openExternal(
					`vscode://file${normalized.startsWith("/") ? "" : "/"}${encodeURI(normalized)}`,
				);
			}
			return null;
		case "download": {
			const destination = await host.showSaveDialog(basename(path));
			if (!destination) return null;
			await copyFile(path, destination);
			return destination;
		}
		case "cut":
		case "copy":
			host.writeClipboard(clipboardFormats(path, host.platform, action === "cut"));
			return null;
		case "rename": {
			const name = (arg ?? "").trim();
			const invalid = validateNewFileName(name);
			if (invalid) throw new Error(`invalid file name (${invalid})`);
			const destination = join(dirname(path), name);
			if (destination === path) return path;
			const exists = await stat(destination).then(
				() => true,
				() => false,
			);
			if (exists) throw new Error("a file with that name already exists");
			await rename(path, destination);
			return destination;
		}
		case "trash":
			// 进回收站而不是直接删除，可恢复
			await host.trashItem(path);
			return null;
	}
}
