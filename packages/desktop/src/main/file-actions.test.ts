import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { clipboardFormats, type FileActionHost, runFileAction } from "./file-actions";

function host(over: Partial<FileActionHost> = {}): FileActionHost {
	return {
		platform: "linux",
		showItemInFolder: vi.fn(),
		openPath: vi.fn(async () => ""),
		openExternal: vi.fn(async () => {}),
		trashItem: vi.fn(async () => {}),
		showSaveDialog: vi.fn(async () => null),
		writeClipboard: vi.fn(),
		...over,
	};
}
async function fixture() {
	const dir = await mkdtemp(join(tmpdir(), "drone-p7-"));
	const file = join(dir, "a.txt");
	await writeFile(file, "hello");
	return { dir, file };
}

describe("file actions (P7)", () => {
	it("reveals, opens, opens in VS Code via URL protocol", async () => {
		const { file } = await fixture();
		const h = host();
		await runFileAction(h, "reveal", file, null, null);
		await runFileAction(h, "openDefault", file, null, null);
		await runFileAction(h, "openInEditor", file, null, null);
		expect(h.showItemInFolder).toHaveBeenCalledWith(file);
		expect(h.openPath).toHaveBeenCalledWith(file);
		expect(h.openExternal).toHaveBeenCalledWith(
			`vscode://file${file.startsWith("/") ? "" : "/"}${encodeURI(file.replaceAll("\\", "/"))}`,
		);
	});
	it("downloads a copy to the chosen path", async () => {
		const { dir, file } = await fixture();
		const dest = join(dir, "copy.txt");
		const result = await runFileAction(
			host({ showSaveDialog: async () => dest }),
			"download",
			file,
			null,
			null,
		);
		expect(result).toBe(dest);
		expect(await readFile(dest, "utf8")).toBe("hello");
		expect(await runFileAction(host(), "download", file, null, null)).toBeNull();
	});
	it("renames within the same folder and rejects bad names / collisions", async () => {
		const { dir, file } = await fixture();
		await writeFile(join(dir, "taken.txt"), "x");
		await expect(runFileAction(host(), "rename", file, null, "../evil.txt")).rejects.toThrow(/invalid/);
		await expect(runFileAction(host(), "rename", file, null, "taken.txt")).rejects.toThrow(/exists/);
		const next = await runFileAction(host(), "rename", file, null, "b.txt");
		expect(next).toBe(join(dir, "b.txt"));
		expect((await stat(join(dir, "b.txt"))).isFile()).toBe(true);
	});
	it("moves to trash instead of unlinking", async () => {
		const { file } = await fixture();
		const h = host();
		await runFileAction(h, "trash", file, null, null);
		expect(h.trashItem).toHaveBeenCalledWith(file);
	});
	it("writes platform clipboard formats for copy and cut", () => {
		const win = clipboardFormats("C:\\p\\a.txt", "win32", true);
		expect(win.buffers?.FileNameW?.toString("utf16le")).toBe("C:\\p\\a.txt\0");
		expect([...(win.buffers?.["Preferred DropEffect"] ?? [])]).toEqual([2, 0, 0, 0]);
		expect(
			clipboardFormats("C:\\p\\a.txt", "win32", false).buffers?.["Preferred DropEffect"],
		).toBeUndefined();
		const linux = clipboardFormats("/p/a b.txt", "linux", true);
		expect(linux.buffers?.["x-special/gnome-copied-files"]?.toString()).toBe(
			`cut\n${pathToFileURL("/p/a b.txt").href}`,
		);
		const mac = clipboardFormats("/p/<a>.txt", "darwin", false);
		expect(mac.buffers?.NSFilenamesPboardType?.toString()).toContain("<string>/p/&lt;a&gt;.txt</string>");
	});
});
