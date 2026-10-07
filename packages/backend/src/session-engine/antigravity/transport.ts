import {
	type AssistantMessageEventStream,
	createAssistantMessageEventStream,
	type Model,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { buildEnvelope, buildGeminiRequest } from "./request";
import { AntigravityResponse } from "./response";
import {
	ANTIGRAVITY_PRIMARY_ENDPOINT,
	ANTIGRAVITY_SANDBOX_ENDPOINT,
	AntigravityError,
	type AntigravityTransportOptions,
	antigravityHeaders,
	emptyAssistantMessage,
	isTransientAntigravityStatus,
} from "./types";

export { buildEnvelope, buildGeminiRequest, resolveWireModelId } from "./request";

const ENDPOINTS = [ANTIGRAVITY_PRIMARY_ENDPOINT, ANTIGRAVITY_SANDBOX_ENDPOINT];

export async function fetchAvailableModels(
	token: string,
	options: { endpoints?: readonly string[]; fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<unknown> {
	const signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(options.signal ? [options.signal] : [])]);
	for (const endpoint of options.endpoints ?? ENDPOINTS) {
		signal.throwIfAborted();
		try {
			const response = await (options.fetcher ?? fetch)(
				`${endpoint.replace(/\/$/, "")}/v1internal:fetchAvailableModels`,
				{
					method: "POST",
					headers: headers(token),
					body: "{}",
					signal,
				},
			);
			if (response.ok) return await response.json();
			await response.body?.cancel();
			if (!isTransientAntigravityStatus(response.status)) break;
		} catch {
			if (signal.aborted) break;
		}
	}
	return null;
}

export function streamAntigravity(
	model: Model<string>,
	context: TranscriptContext,
	options: AntigravityTransportOptions = {},
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	void runStream(stream, model, context, options);
	return stream;
}

async function runStream(
	stream: AssistantMessageEventStream,
	model: Model<string>,
	context: TranscriptContext,
	options: AntigravityTransportOptions,
): Promise<void> {
	const message = emptyAssistantMessage(model);
	const signal = AbortSignal.any([
		AbortSignal.timeout(options.timeoutMs ?? 600_000),
		...(options.signal ? [options.signal] : []),
	]);
	try {
		signal.throwIfAborted();
		const project = options.headers?.["x-drone-antigravity-project"];
		if (!project)
			throw new AntigravityError("Antigravity project is not configured; sign in again", { kind: "auth" });
		if (!options.apiKey)
			throw new AntigravityError("Antigravity access token is missing; sign in again", { kind: "auth" });
		const envelope = buildEnvelope(buildGeminiRequest(context, model, options), model, project, {
			sessionId: options.sessionId,
			thinking: options.reasoning,
		});
		const replaced = await options.onPayload?.(envelope, model);
		const response = await requestWithFallback(replaced === undefined ? envelope : replaced, model, {
			...options,
			signal,
		});
		await options.onResponse?.(
			{ status: response.status, headers: Object.fromEntries(response.headers.entries()) },
			model,
		);
		if (!response.body)
			throw new AntigravityError("Cloud Code Assist returned an empty stream", { kind: "protocol" });
		stream.push({ type: "start", partial: message });
		const accumulator = new AntigravityResponse(message, stream);
		await consumeSse(
			response.body,
			async (event) => {
				await options.onProviderStreamEvent?.(event, model);
				accumulator.consume(event);
			},
			signal,
		);
		signal.throwIfAborted();
		accumulator.finish();
	} catch (error) {
		message.stopReason = options.signal?.aborted ? "aborted" : "error";
		message.errorMessage = options.signal?.aborted
			? "Antigravity request cancelled"
			: signal.aborted
				? "Antigravity request timed out"
				: error instanceof AntigravityError
					? error.message
					: "Antigravity request failed";
		stream.push({ type: "error", reason: message.stopReason, error: message });
	} finally {
		stream.end(message);
	}
}

async function consumeSse(
	body: ReadableStream<Uint8Array>,
	consume: (value: unknown) => Promise<void>,
	signal: AbortSignal,
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const onAbort = () => {
		void reader.cancel().catch(() => undefined);
	};
	signal.addEventListener("abort", onAbort, { once: true });
	const line = async (text: string) => {
		if (!text.startsWith("data:")) return;
		const data = text.slice(5).trim();
		if (!data || data === "[DONE]") return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(data);
		} catch {
			throw new AntigravityError("Cloud Code Assist returned malformed stream data", { kind: "protocol" });
		}
		await consume(parsed);
	};
	try {
		for (;;) {
			signal.throwIfAborted();
			const chunk = await reader.read();
			if (chunk.done) break;
			buffer += decoder.decode(chunk.value, { stream: true });
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() ?? "";
			for (const value of lines) await line(value);
		}
		await line(buffer + decoder.decode());
	} finally {
		signal.removeEventListener("abort", onAbort);
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}

async function requestWithFallback(
	payload: unknown,
	model: Model<string>,
	options: AntigravityTransportOptions,
): Promise<Response> {
	const baseUrl = options.baseUrl ?? model.baseUrl;
	// Explicit endpoint overrides stay isolated: never send their payload to a different host on failure.
	const endpoints =
		options.endpoints ?? (baseUrl && baseUrl !== ANTIGRAVITY_PRIMARY_ENDPOINT ? [baseUrl] : ENDPOINTS);
	let lastStatus: number | undefined;
	for (const endpoint of endpoints) {
		options.signal?.throwIfAborted();
		let response: Response;
		try {
			response = await (options.fetch ?? fetch)(
				`${endpoint.replace(/\/$/, "")}/v1internal:streamGenerateContent?alt=sse`,
				{
					method: "POST",
					headers: headers(options.apiKey ?? ""),
					body: JSON.stringify(payload),
					signal: options.signal,
				},
			);
		} catch {
			options.signal?.throwIfAborted();
			continue;
		}
		if (response.ok) return response;
		lastStatus = response.status;
		await response.body?.cancel();
		if (isTransientAntigravityStatus(response.status)) continue;
		throw new AntigravityError(
			response.status === 401
				? "Google Antigravity authorization expired; sign in again"
				: response.status === 403
					? "Cloud Code Assist denied access (403); check your account and project eligibility"
					: `Cloud Code Assist request failed (${response.status})`,
			{ kind: response.status === 401 ? "auth" : "transport", status: response.status },
		);
	}
	throw new AntigravityError(
		lastStatus === 429
			? "Cloud Code Assist rate limit reached (429); retry later"
			: lastStatus
				? `Cloud Code Assist endpoints are unavailable (${lastStatus})`
				: "Cloud Code Assist network request failed",
		{ kind: "transport", status: lastStatus },
	);
}
function headers(token: string): Record<string, string> {
	return {
		...antigravityHeaders(token),
		Accept: "text/event-stream",
	};
}
