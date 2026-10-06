import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	HTML_PREVIEW_CSP,
	handleHtmlPreviewRequest,
	issueHtmlPreviewUrl,
	resetHtmlPreviewRoots,
} from "./html-preview-protocol";

let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "drone-html-preview-"));
	resetHtmlPreviewRoots();
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe("interactive HTML preview protocol", () => {
	it("serves the issued file and its sibling assets with a no-network CSP", async () => {
		await mkdir(join(root, "fig", "lib"), { recursive: true });
		await writeFile(join(root, "fig", "plot.html"), "<script src='lib/plotly.js'></script>");
		await writeFile(join(root, "fig", "lib", "plotly.js"), "window.Plotly = {};");
		const url = await issueHtmlPreviewUrl(join(root, "fig", "plot.html"));
		expect(url).toMatch(/^drone-html:\/\/[0-9a-f]{32}\/plot\.html$/);

		const page = await handleHtmlPreviewRequest(new Request(url));
		expect(page.status).toBe(200);
		expect(page.headers.get("content-type")).toContain("text/html");
		expect(page.headers.get("content-security-policy")).toBe(HTML_PREVIEW_CSP);
		expect(HTML_PREVIEW_CSP).toContain("connect-src 'none'");
		expect(await page.text()).toContain("plotly");

		const script = await handleHtmlPreviewRequest(new Request(url.replace("plot.html", "lib/plotly.js")));
		expect(script.status).toBe(200);
		expect(script.headers.get("content-type")).toContain("javascript");
	});

	it("refuses traversal, unknown tokens, non-GET and non-HTML entry files", async () => {
		await mkdir(join(root, "fig"));
		await writeFile(join(root, "fig", "index.html"), "<p>ok</p>");
		await writeFile(join(root, "secret.txt"), "nope");
		const url = await issueHtmlPreviewUrl(join(root, "fig", "index.html"));
		const token = new URL(url).hostname;
		expect(
			(await handleHtmlPreviewRequest(new Request(`drone-html://${token}/..%2Fsecret.txt`))).status,
		).toBe(403);
		const dotted = await handleHtmlPreviewRequest(new Request(`drone-html://${token}/%2e%2e/secret.txt`));
		expect(dotted.status).not.toBe(200);
		expect(
			(await handleHtmlPreviewRequest(new Request(`drone-html://${"0".repeat(32)}/index.html`))).status,
		).toBe(404);
		expect((await handleHtmlPreviewRequest(new Request(url, { method: "POST", body: "x" }))).status).toBe(
			405,
		);
		await expect(issueHtmlPreviewUrl(join(root, "secret.txt"))).rejects.toThrow(/html/);
	});

	it.skipIf(process.platform === "win32")("refuses symlinks that escape the preview directory", async () => {
		await mkdir(join(root, "fig"));
		await writeFile(join(root, "fig", "index.html"), "<p>ok</p>");
		await writeFile(join(root, "secret.txt"), "nope");
		await symlink(join(root, "secret.txt"), join(root, "fig", "link.txt"));
		const url = await issueHtmlPreviewUrl(join(root, "fig", "index.html"));
		const response = await handleHtmlPreviewRequest(new Request(url.replace("index.html", "link.txt")));
		expect(response.status).toBe(403);
	});

	it("reuses one token per directory", async () => {
		await writeFile(join(root, "a.html"), "a");
		await writeFile(join(root, "b.html"), "b");
		const a = new URL(await issueHtmlPreviewUrl(join(root, "a.html"))).hostname;
		const b = new URL(await issueHtmlPreviewUrl(join(root, "b.html"))).hostname;
		expect(a).toBe(b);
	});
});
