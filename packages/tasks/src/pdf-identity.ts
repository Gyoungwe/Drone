/**
 * Bounded PDF identity inspection contract.
 *
 * PDF parsing is a host concern because the parser normally runs in an
 * isolated worker. This package owns the small, deterministic boundary that
 * validates the worker result and turns parser failures into a stable error
 * for task adapters. The worker implementation is injected so the policy can
 * be tested without loading pdf.js or starting a worker thread.
 */

export interface PdfIdentityResult {
	text: string;
	pages: number;
	partial: boolean;
}

export interface PdfIdentityWorkerResult {
	text?: unknown;
	pages?: unknown;
	partial?: unknown;
	error?: unknown;
}

export type PdfIdentityWorker = (
	bytes: Uint8Array,
	/** Host adapters terminate their isolated worker when this signal aborts. */
	signal: AbortSignal,
) => Promise<PdfIdentityWorkerResult> | PdfIdentityWorkerResult;

export interface PdfIdentityOptions {
	/** Isolated parser supplied by the host (usually a worker-thread adapter). */
	worker: PdfIdentityWorker;
	/** Parser wait in milliseconds, capped at 30 seconds for slower Windows worker startup. */
	timeoutMs?: number;
}

export type PdfIdentityErrorCode = "timeout" | "manual-inspection" | "unavailable";

/** Stable error code for callers that need to distinguish retry vs review. */
export class PdfIdentityError extends Error {
	readonly code: PdfIdentityErrorCode;

	constructor(code: PdfIdentityErrorCode, message: string) {
		super(message);
		this.name = "PdfIdentityError";
		this.code = code;
	}
}

const DEFAULT_TIMEOUT_MS = 30_000;
const TIMEOUT = Symbol("pdf-identity-timeout");

function asBytes(value: Uint8Array): Uint8Array {
	if (!(value instanceof Uint8Array)) throw new TypeError("PDF identity input must be a Uint8Array.");
	// Keep the worker boundary immutable: callers can reuse or mutate their
	// original file buffer while the isolated parser is still running.
	return Uint8Array.from(value);
}

/** Validate and normalize the untrusted parser response. */
export function normalizePdfIdentityResult(result: PdfIdentityWorkerResult): PdfIdentityResult {
	if (result && typeof result.error === "string" && result.error.trim())
		throw new PdfIdentityError(
			"manual-inspection",
			`PDF identity requires manual inspection: ${result.error.trim().slice(0, 240)}`,
		);
	if (
		!result ||
		typeof result.text !== "string" ||
		typeof result.pages !== "number" ||
		!Number.isInteger(result.pages) ||
		result.pages < 0 ||
		result.pages > 3 ||
		typeof result.partial !== "boolean"
	)
		throw new PdfIdentityError(
			"unavailable",
			"PDF identity extractor unavailable; no identity claim was made.",
		);
	return { text: result.text.slice(0, 90_000), pages: result.pages, partial: result.partial };
}

/**
 * Run an injected, isolated PDF parser with a hard timeout.
 *
 * The timeout intentionally does not claim an identity and aborts the host
 * signal, allowing the adapter to terminate its worker immediately.
 */
export async function readPdfIdentity(
	bytes: Uint8Array,
	{ worker, timeoutMs = DEFAULT_TIMEOUT_MS }: PdfIdentityOptions,
): Promise<PdfIdentityResult> {
	const input = asBytes(bytes);
	if (typeof worker !== "function") throw new TypeError("PDF identity worker adapter is required.");
	const timeout =
		Number.isFinite(timeoutMs) && timeoutMs > 0
			? Math.min(timeoutMs, DEFAULT_TIMEOUT_MS)
			: DEFAULT_TIMEOUT_MS;
	const abort = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const operation = Promise.resolve().then(() => worker(input, abort.signal));
		const deadline = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(TIMEOUT), timeout);
		});
		return normalizePdfIdentityResult(await Promise.race([operation, deadline]));
	} catch (error) {
		if (error === TIMEOUT)
			throw new PdfIdentityError("timeout", "PDF identity inspection timed out; no file was changed.");
		if (error instanceof PdfIdentityError) throw error;
		throw new PdfIdentityError(
			"unavailable",
			"PDF identity extractor unavailable; no identity claim was made.",
		);
	} finally {
		if (timer) clearTimeout(timer);
		abort.abort();
	}
}
