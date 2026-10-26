import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AppContract, defineDomain, type PiApi } from "@drone/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
			transport.handlers.set(channel, handler),
		removeHandler: (channel: string) => transport.handlers.delete(channel),
	},
	ipcRenderer: {
		invoke: async (channel: string, ...args: unknown[]) => transport.handlers.get(channel)!({}, ...args),
	},
	contextBridge: {},
}));

import { previewLocalFile } from "../main/file-preview";
import { bindContract } from "../main/ipc/bind-contract";
import { exposeContract } from "./expose-contract";

const contract = defineDomain("file", { methods: { preview: AppContract.methods.filePreview } });
const client = exposeContract(contract);
// Match window.pi's optional arguments, forwarded unchanged by the preload facade.
const previewFile: PiApi["previewFile"] = (...args) => Reflect.apply(client.preview, client, args);
let root: string;
let project: string;
let pdf: string;

beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-projectless-preview-")));
	project = join(root, "project");
	await mkdir(project);
	pdf = join(project, "paper.pdf");
	await writeFile(pdf, "%PDF-1.4\npreview acceptance\n");
	bindContract(contract, { preview: previewLocalFile });
});

afterEach(async () => {
	transport.handlers.clear();
	await rm(root, { recursive: true, force: true });
});

it("previews an absolute PDF with the absent project passed by the knowledge page", async () => {
	const result = await previewFile(pdf, undefined);
	expect(result).toMatchObject({ path: pdf, previewKind: "pdf", mimeType: "application/pdf" });
	expect(Buffer.from(result.data!, "base64").toString()).toBe("%PDF-1.4\npreview acceptance\n");
	expect(await previewFile(pathToFileURL(pdf).href, undefined, undefined)).toMatchObject({ path: pdf });
});

it("keeps project-relative resolution and explicit confinement intact", async () => {
	expect(await previewFile("paper.pdf", project, true)).toMatchObject({ path: pdf });
	const outside = join(root, "outside.pdf");
	await writeFile(outside, "%PDF-1.4\n");
	await expect(previewFile(outside, project, true)).rejects.toThrow("outside the project root");
	await expect(previewFile(pdf, undefined, true)).rejects.toThrow("a project root is required");
});
