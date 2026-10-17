import {
	GlobalWorkerOptions,
	getDocument,
	type PDFDocumentProxy,
	type PDFPageProxy,
	type RenderTask,
} from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";
import { useEffect, useRef, useState } from "react";
import { useT } from "../../../i18n";
import type { PreviewRendererProps } from "../preview-registry";
import "../../diff/resource-reader.css";

let workerPort: Worker | null = null;

/**
 * PDF.js requires an explicit worker in a bundled Electron renderer. Keeping the
 * worker setup here avoids Chromium's built-in PDF extension, which cannot
 * reliably render data: URLs in the packaged app.
 */
function ensureWorker(): void {
	if (workerPort || typeof Worker === "undefined") return;
	workerPort = new PdfWorker();
	GlobalWorkerOptions.workerPort = workerPort;
}

function decodePdfData(src: string): Uint8Array {
	const comma = src.indexOf(",");
	if (comma < 0) throw new Error("Invalid PDF preview data");
	const encoded = src.slice(comma + 1);
	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function cancelRender(task: RenderTask | null): void {
	if (!task) return;
	task.cancel();
}

/** Render local PDF bytes directly with PDF.js instead of a Chromium PDF iframe. */
export function PdfViewer({ src }: PreviewRendererProps) {
	const t = useT();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
	const [page, setPage] = useState(1);
	const [loading, setLoading] = useState(true);
	const [rendering, setRendering] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!src) {
			setPdf(null);
			setLoading(false);
			setError(null);
			return;
		}
		let cancelled = false;
		let loadingTask: ReturnType<typeof getDocument> | null = null;
		setPdf(null);
		setPage(1);
		setLoading(true);
		setError(null);
		try {
			ensureWorker();
			loadingTask = getDocument({ data: decodePdfData(src) });
			void loadingTask.promise
				.then((document) => {
					if (cancelled) {
						void document.cleanup();
						return;
					}
					setPdf(document);
					setLoading(false);
				})
				.catch((reason: unknown) => {
					if (!cancelled) {
						setLoading(false);
						setError(reason instanceof Error ? reason.message : String(reason));
					}
				});
		} catch (reason) {
			setLoading(false);
			setError(reason instanceof Error ? reason.message : String(reason));
		}
		return () => {
			cancelled = true;
			if (loadingTask) void loadingTask.destroy().catch(() => undefined);
		};
	}, [src]);

	useEffect(() => {
		if (!pdf || !canvasRef.current) return;
		let cancelled = false;
		let renderTask: RenderTask | null = null;
		setRendering(true);
		setError(null);
		void pdf
			.getPage(page)
			.then((pdfPage: PDFPageProxy) => {
				if (cancelled || !canvasRef.current) return;
				const viewport = pdfPage.getViewport({ scale: 1 });
				const outputScale = window.devicePixelRatio || 1;
				const canvas = canvasRef.current;
				canvas.width = Math.floor(viewport.width * outputScale);
				canvas.height = Math.floor(viewport.height * outputScale);
				canvas.style.width = `${viewport.width}px`;
				canvas.style.height = `${viewport.height}px`;
				const context = canvas.getContext("2d");
				if (!context) throw new Error("Canvas 2D context is unavailable");
				renderTask = pdfPage.render({
					canvas,
					canvasContext: context,
					viewport,
					...(outputScale !== 1 ? { transform: [outputScale, 0, 0, outputScale, 0, 0] } : {}),
				});
				return renderTask.promise;
			})
			.then(() => {
				if (!cancelled) setRendering(false);
			})
			.catch((reason: unknown) => {
				if (!cancelled && (reason as { name?: string })?.name !== "RenderingCancelledException") {
					setRendering(false);
					setError(reason instanceof Error ? reason.message : String(reason));
				}
			});
		return () => {
			cancelled = true;
			cancelRender(renderTask);
		};
	}, [pdf, page]);

	if (!src) return <div className="resource-empty">{t("resource.viewer.mediaTooLarge")}</div>;
	if (loading)
		return (
			<div className="resource-empty" role="status">
				{t("resource.loading")}
			</div>
		);
	if (error || !pdf)
		return (
			<div className="resource-empty" role="alert">
				<div>{t("resource.previewFailed")}</div>
				{error && <div className="resource-error">{error}</div>}
			</div>
		);
	return (
		<div className="pdf-viewer" data-preview-kind="pdf">
			<div className="pdf-viewer-toolbar" role="toolbar" aria-label="PDF">
				<button
					type="button"
					disabled={page <= 1}
					onClick={() => setPage((current) => Math.max(1, current - 1))}
				>
					{t("resource.viewer.prevPage")}
				</button>
				<span aria-live="polite">{t("resource.viewer.pdfPage", { page, pages: pdf.numPages })}</span>
				<button
					type="button"
					disabled={page >= pdf.numPages}
					onClick={() => setPage((current) => Math.min(pdf.numPages, current + 1))}
				>
					{t("resource.viewer.nextPage")}
				</button>
				{rendering && <span role="status">{t("resource.loading")}</span>}
			</div>
			<div className="pdf-page">
				<canvas ref={canvasRef} aria-label={t("resource.viewer.pdfPage", { page, pages: pdf.numPages })} />
			</div>
		</div>
	);
}
