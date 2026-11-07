import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pdfTextCapabilityHandlers } from "./pdf-text-capability";

const runtimeDirectory = resolve(
	__dirname,
	`../../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);
const pdfjsRoot = realpathSync(dirname(require.resolve("pdfjs-dist/package.json")));
const { "document.pdfText": pdfText } = pdfTextCapabilityHandlers({ runtimeDirectory, pdfjsRoot });
const run = (input: unknown, signal = new AbortController().signal) =>
	pdfText.execute(input, { signal } as Parameters<typeof pdfText.execute>[1]);

/** A PDF with one page per entry of `pages`, each showing that text. */
function pdfWith(...pages: string[]): Buffer {
	const objects = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
	const kids: string[] = [];
	for (const text of pages) {
		const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
		const page = objects.length + 1;
		kids.push(`${page} 0 R`);
		objects.push(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${page + 1} 0 R /Resources << /Font << /F1 ${page + 2} 0 R >> >> >>`,
			`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
			"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		);
	}
	objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
	let body = "%PDF-1.4\n";
	const offsets = objects.map((object, index) => {
		const offset = body.length;
		body += `${index + 1} 0 obj\n${object}\nendobj\n`;
		return offset;
	});
	const xref = body.length;
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
	body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(body, "latin1");
}

describe("document.pdfText", () => {
	it("returns the text of the first pages, parsed in an isolated process", async () => {
		const base64 = pdfWith("Gut microbiota doi:10.1000/gut.2021.001", "second", "third").toString("base64");
		expect(await run({ base64, maxPages: 2 })).toEqual({
			text: "[[page:1]]\nGut microbiota doi:10.1000/gut.2021.001\n[[page:2]]\nsecond\n",
			pages: 2,
			partial: true,
		});
	}, 30_000);

	it("fails loudly on bytes that are not a readable PDF", async () => {
		await expect(run({ base64: Buffer.from("%PDF-1.4 broken").toString("base64") })).rejects.toThrow(
			"PDF text extraction failed",
		);
	}, 30_000);

	it("gives the parser no files outside pdfjs-dist, no subprocesses and no environment", async () => {
		// A stand-in pdfjs-dist whose "worker" probes the sandbox and reports through the page text.
		const fake = mkdtempSync(join(tmpdir(), "pdfjs-probe-"));
		const secret = join(fake, "..", `${basename(fake)}-secret.txt`);
		writeFileSync(secret, "SECRET");
		mkdirSync(join(fake, "legacy/build"), { recursive: true });
		writeFileSync(
			join(fake, "legacy/build/pdf.worker.mjs"),
			`import { readFileSync } from "node:fs";
			import { execFileSync } from "node:child_process";
			const probe = (f) => { try { return String(f()); } catch (e) { return e.code; } };
			export const WorkerMessageHandler = [
				probe(() => readFileSync(${JSON.stringify(secret)}, "utf8")),
				probe(() => execFileSync("/bin/echo", ["SPAWNED"])),
				["HOME", "PATH", "VITEST"].filter((key) => key in process.env).join(",") || "NO_ENV",
			].join(" ");`,
		);
		writeFileSync(
			join(fake, "legacy/build/pdf.mjs"),
			`export const getDocument = () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({
				getTextContent: async () => ({ items: [{ str: globalThis.pdfjsWorker.WorkerMessageHandler }] }) }) }) });`,
		);
		try {
			const probe = pdfTextCapabilityHandlers({ runtimeDirectory, pdfjsRoot: realpathSync(fake) })[
				"document.pdfText"
			];
			const result = (await probe.execute({ base64: "JVBERg==" }, {
				signal: new AbortController().signal,
			} as Parameters<typeof probe.execute>[1])) as { text: string };
			expect(result.text).toBe("[[page:1]]\nERR_ACCESS_DENIED ERR_ACCESS_DENIED NO_ENV\n");
		} finally {
			rmSync(fake, { recursive: true, force: true });
			rmSync(secret, { force: true });
		}
	}, 30_000);

	it("stops the parser when the call is cancelled", async () => {
		const controller = new AbortController();
		const pending = run({ base64: pdfWith("x").toString("base64") }, controller.signal);
		controller.abort();
		await expect(pending).rejects.toThrow();
	}, 30_000);
});
