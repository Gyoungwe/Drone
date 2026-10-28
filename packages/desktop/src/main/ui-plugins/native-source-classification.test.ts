// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { classifyUnmanagedNativePath } from "./native-source-classification";

let root: string;
let path: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "drone-native-source-kind-"));
	path = join(root, "extension.mjs");
	await writeFile(path, "throw new Error('classification must not import code');");
});
afterEach(() => rm(root, { recursive: true, force: true }));

it("accepts an existing ordinary extension without evaluating it", () => {
	expect(classifyUnmanagedNativePath(path, [])).toEqual({ kind: "ordinary" });
});
it("never certifies a missing path as ordinary after a restart with an empty catalog", async () => {
	await rm(path);
	expect(classifyUnmanagedNativePath(path, [])).toEqual({ kind: "unconfirmed" });
});
it("keeps a first-seen managed package with a missing runtime unconfirmed", async () => {
	await writeFile(
		join(root, "plugin.manifest.json"),
		JSON.stringify({
			entrypoints: { desktopRuntime: "./missing.mjs" },
			drone: { deliveryProjection: "required" },
		}),
	);
	expect(classifyUnmanagedNativePath(path, [])).toEqual({ kind: "unconfirmed" });
	expect(classifyUnmanagedNativePath(root, [])).toEqual({ kind: "unconfirmed" });
});
it("keeps malformed declarations unconfirmed instead of inferring an ordinary source", async () => {
	await writeFile(join(root, "plugin.manifest.json"), JSON.stringify({ entrypoints: "damaged" }));
	expect(classifyUnmanagedNativePath(path, [])).toEqual({ kind: "unconfirmed" });
	await writeFile(join(root, "plugin.manifest.json"), "{");
	expect(classifyUnmanagedNativePath(path, [])).toEqual({ kind: "unconfirmed" });
});
it("does not borrow an outer package's manifest for a separate ordinary dependency", async () => {
	await writeFile(
		join(root, "plugin.manifest.json"),
		JSON.stringify({ entrypoints: { desktopRuntime: "./runtime.mjs" } }),
	);
	const nested = join(root, "node_modules", "ordinary");
	await mkdir(nested, { recursive: true });
	await writeFile(join(nested, "package.json"), JSON.stringify({ name: "ordinary" }));
	const extension = join(nested, "index.mjs");
	await writeFile(extension, "export default function () {};");
	expect(classifyUnmanagedNativePath(extension, [])).toEqual({ kind: "ordinary" });
});
