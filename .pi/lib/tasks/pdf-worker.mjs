import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";

try {
	let modulePath;
	try {
		modulePath = createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.mjs");
	} catch {
		modulePath = createRequire(join(process.resourcesPath || "", "app.asar/package.json")).resolve(
			"pdfjs-dist/legacy/build/pdf.mjs",
		);
	}
	const { getDocument } = await import(pathToFileURL(modulePath).href);
	// pdf.js requires a trailing "/" on factory URLs; path.sep would be "\" on Windows.
	const standardFontDataUrl = `${pathToFileURL(join(dirname(modulePath), "../../standard_fonts")).href}/`;
	const loading = getDocument({
		data: new Uint8Array(workerData.bytes),
		standardFontDataUrl,
		isEvalSupported: false,
		useSystemFonts: false,
		disableFontFace: true,
		useWorkerFetch: false,
		stopAtErrors: true,
	});
	const doc = await loading.promise;
	let text = "";
	const totalPages = doc.numPages;
	const pages = Math.min(totalPages, 3);
	for (let page = 1; page <= pages; page++) {
		const content = await (await doc.getPage(page)).getTextContent();
		text += `${content.items
			.map((item) => item.str || "")
			.join(" ")
			.slice(0, 30000)}\n`;
	}
	await (typeof doc.destroy === "function" ? doc.destroy() : loading.destroy());
	parentPort.postMessage({ text, pages, partial: totalPages > pages });
} catch {
	parentPort.postMessage({ error: "invalid, encrypted, unsupported or unavailable PDF parser" });
}
