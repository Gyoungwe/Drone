// @vitest-environment node
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StorageRegistry } from "@drone/backend";
import { expect, it, vi } from "vitest";
import { createDesktopResourceCapabilities } from "./desktop-resource-capabilities";

const desktop = vi.hoisted(() => ({
	showMessageBox: vi.fn(),
	contents: { isDestroyed: vi.fn(() => false) },
	window: {},
}));
vi.mock("electron", () => ({
	app: { getPath: () => "/tmp" },
	BrowserWindow: { fromWebContents: () => desktop.window },
	dialog: { showMessageBox: desktop.showMessageBox },
	webContents: { fromId: () => desktop.contents },
}));

import { approveDesktopRuntime } from "./runtime-host";

const source = {
	pluginId: "@example/index",
	packageRoot: "/example",
	entrypoint: "/example/runtime.mjs",
};
const owner = { id: 1, isDestroyed: () => false };

/**
 * The approved review is a four-part shape: a title, the facts of the
 * pending write, and the Approve and Deny labels. The dialog shows all
 * four when the lane supplies a review, and the generic prompt otherwise.
 */
it("shows the approved review copy, buttons and facts instead of the generic prompt", async () => {
	desktop.showMessageBox.mockReset();
	desktop.showMessageBox.mockResolvedValue({ response: 1 });
	const hash = "a".repeat(64);
	const approved = await approveDesktopRuntime(
		owner,
		source,
		"capability:bytes.write",
		"application-state-write",
		undefined,
		{
			kind: "byte-write",
			pluginId: "@example/index",
			root: "/exports/demo",
			file: { path: "reports/result.bin", bytes: 13, sha256: hash },
		},
	);
	expect(approved).toBe(true);
	expect(desktop.showMessageBox).toHaveBeenCalledWith(
		desktop.window,
		expect.objectContaining({
			title: "Plugin wants to write files",
			message: `Plugin: @example/index\nFolder: /exports/demo\nFiles:\n  reports/result.bin\n    Size: 13\n    SHA-256: ${hash}`,
			buttons: ["Deny", "Approve"],
			detail: "application-state-write",
		}),
	);
});

it("keeps the generic prompt and buttons when no review accompanies the write", async () => {
	desktop.showMessageBox.mockReset();
	desktop.showMessageBox.mockResolvedValue({ response: 1 });
	await approveDesktopRuntime(owner, source, "capability:bytes.write", "application-state-write");
	expect(desktop.showMessageBox).toHaveBeenCalledWith(
		desktop.window,
		expect.objectContaining({
			title: "Plugin runtime permission",
			buttons: ["Deny", "Allow"],
		}),
	);
});

it.each([
	["en", "Move file", "will not be overwritten", "without copying"],
	["zh", "移动文件", "不会覆盖", "不复制"],
])(
	"describes both paths and no-overwrite semantics for a file move in %s",
	async (language, action, overwrite, copy) => {
		const directory = await realpath(await mkdtemp(join(tmpdir(), "drone-move-approval-")));
		vi.stubEnv("DRONE_REPLY_LANGUAGE", language);
		try {
			const activation = {
				pluginId: source.pluginId,
				applicationId: "app",
				signal: new AbortController().signal,
				events: { changed: () => undefined },
			};
			const ports = await createDesktopResourceCapabilities(
				{ ...source, requestsFileWrite: true },
				directory,
				{
					profileDirectory: directory,
					storage: new StorageRegistry(),
					selectDirectories: async () => [directory],
				},
			)(activation);
			try {
				const grant = ports.resources.find(({ kind }) => kind === "files");
				const handler = ports.handlers["files.move"];
				expect(handler).toMatchObject({ effect: "write", approval: "always" });
				const expectedVersion = { dev: 1, ino: 2, size: 3, mtimeMs: 4, ctimeMs: 5 };
				const detail = handler?.approvalDetail?.(
					{ root: grant?.handle, from: "draft/report.bin", to: "results/report.bin", expectedVersion },
					{ ...activation, scope: { kind: "application" } },
				);
				for (const text of [
					action,
					directory,
					"draft/report.bin",
					"results/report.bin",
					JSON.stringify(expectedVersion),
					overwrite,
					copy,
				]) {
					expect(detail).toContain(text);
				}
				expect(detail).not.toContain("undefined");
			} finally {
				await ports.dispose?.();
				await ports.finalRelease?.();
			}
		} finally {
			vi.unstubAllEnvs();
			await rm(directory, { recursive: true, force: true });
		}
	},
);

it.each([
	[
		"en",
		"Write result index",
		"Entry count: 21",
		"Create new; fail if the file already exists.",
		"1 more entries",
	],
	["zh", "写入结果索引", "条目数：21", "新建，已存在则失败。", "另有 1 条"],
])(
	"describes the fixed index path, entry count and result paths in %s",
	async (language, action, count, create, remaining) => {
		const directory = await realpath(await mkdtemp(join(tmpdir(), "drone-index-approval-")));
		vi.stubEnv("DRONE_REPLY_LANGUAGE", language);
		try {
			const activation = {
				pluginId: source.pluginId,
				applicationId: "app",
				signal: new AbortController().signal,
				events: { changed: () => undefined },
			};
			const ports = await createDesktopResourceCapabilities(
				{ ...source, requestsFileWrite: true },
				directory,
				{
					profileDirectory: directory,
					storage: new StorageRegistry(),
					selectDirectories: async () => [directory],
				},
			)(activation);
			try {
				const grant = ports.resources.find(({ kind }) => kind === "files");
				const handler = ports.handlers["files.writeIndex"];
				expect(handler).toMatchObject({ effect: "write", approval: "always" });
				const detail = handler?.approvalDetail?.(
					{
						root: grant?.handle,
						entries: Array.from({ length: 21 }, (_, index) => ({
							resultPath: `results/task/run/${index}.txt`,
						})),
						expectedHash: null,
					},
					{ ...activation, scope: { kind: "application" } },
				);
				for (const text of [
					action,
					directory,
					"results/index.json",
					count,
					create,
					remaining,
					"results/task/run/0.txt",
				])
					expect(detail).toContain(text);
				expect(detail).not.toContain("results/task/run/20.txt");
				expect(detail).not.toContain("undefined");
			} finally {
				await ports.dispose?.();
				await ports.finalRelease?.();
			}
		} finally {
			vi.unstubAllEnvs();
			await rm(directory, { recursive: true, force: true });
		}
	},
);
