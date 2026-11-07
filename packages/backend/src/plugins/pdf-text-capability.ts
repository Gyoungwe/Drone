import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Type } from "typebox";
import { pluginRuntimeExecutable } from "../plugin-runtime-executable";
import type { PluginCapabilityHandler } from "./runtime-capabilities";
import { MAX_FILE_BINARY_BASE64 } from "./stable-file-bytes";

const MAX_PAGES = 5;
const MAX_PAGE_CHARS = 30_000;
const TIMEOUT_MS = 30_000;

/**
 * Runs in a fresh plugin-runtime process per call: no environment, no network, no workers, no
 * subprocesses, read access to pdfjs-dist only. PDF bytes arrive on stdin; JSON leaves on stdout.
 * pdf.js runs its worker code on this thread (`globalThis.pdfjsWorker`).
 */
const EXTRACT = `
const [root, maxPages] = [process.argv[1], Number(process.argv[2])];
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
try {
	globalThis.pdfjsWorker = { WorkerMessageHandler: (await import(root + "/legacy/build/pdf.worker.mjs")).WorkerMessageHandler };
	const { getDocument } = await import(root + "/legacy/build/pdf.mjs");
	const doc = await getDocument({
		data: new Uint8Array(Buffer.concat(chunks)),
		standardFontDataUrl: root + "/standard_fonts/",
		isEvalSupported: false,
		useSystemFonts: false,
		disableFontFace: true,
		useWorkerFetch: false,
		stopAtErrors: true,
		verbosity: 0,
	}).promise;
	const pages = Math.min(doc.numPages, maxPages);
	let text = "";
	for (let page = 1; page <= pages; page++) {
		const content = await (await doc.getPage(page)).getTextContent();
		text += "[[page:" + page + "]]\\n" + content.items.map((item) => item.str || "").join(" ").slice(0, ${MAX_PAGE_CHARS}) + "\\n";
	}
	process.stdout.write(JSON.stringify({ text, pages, partial: doc.numPages > pages }));
} catch {
	process.stdout.write(JSON.stringify({ error: "invalid, encrypted or unsupported PDF" }));
}
`;

/** Text of a PDF's first pages, parsed by the host in an isolated one-shot process (pure computation). */
export function pdfTextCapabilityHandlers(options: {
	readonly runtimeDirectory?: string;
	/** Real directory of the host's pdfjs-dist package; the only path the parser may read. */
	readonly pdfjsRoot: string;
}): Record<"document.pdfText", PluginCapabilityHandler> {
	return {
		"document.pdfText": {
			effect: "read",
			inputSchema: Type.Object(
				{
					base64: Type.String({ minLength: 1, maxLength: MAX_FILE_BINARY_BASE64 }),
					maxPages: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_PAGES })),
				},
				{ additionalProperties: false },
			),
			resultSchema: Type.Object(
				{
					text: Type.String({ maxLength: MAX_PAGES * (MAX_PAGE_CHARS + 32) }),
					pages: Type.Integer({ minimum: 0, maximum: MAX_PAGES }),
					partial: Type.Boolean(),
				},
				{ additionalProperties: false },
			),
			execute: async (input, context) => {
				const { base64, maxPages = 3 } = input as { base64: string; maxPages?: number };
				const result = JSON.parse(
					await extract(options, Buffer.from(base64, "base64"), maxPages, context.signal),
				);
				if (result.error) throw new Error(`PDF text extraction failed: ${result.error}`);
				return result;
			},
		},
	};
}

function extract(
	options: { runtimeDirectory?: string; pdfjsRoot: string },
	bytes: Buffer,
	maxPages: number,
	signal: AbortSignal,
): Promise<string> {
	signal.throwIfAborted();
	const child = spawn(
		pluginRuntimeExecutable(options.runtimeDirectory),
		[
			"--permission",
			`--allow-fs-read=${options.pdfjsRoot}`,
			"--max-old-space-size=128",
			"--input-type=module",
			"--eval",
			EXTRACT,
			pathToFileURL(options.pdfjsRoot).href,
			String(maxPages),
		],
		{ env: {}, stdio: ["pipe", "pipe", "ignore"], signal, timeout: TIMEOUT_MS },
	);
	// The child may exit before reading everything (bad input, timeout); that is reported on close.
	child.stdin.once("error", () => child.kill());
	child.stdin.end(bytes);
	let output = "";
	child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
		output += chunk;
	});
	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code, killed) => {
			if (code === 0) resolve(output);
			else reject(new Error(`PDF text extraction stopped (${killed ?? code}); no identity claim was made`));
		});
	});
}
