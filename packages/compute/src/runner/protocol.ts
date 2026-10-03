import { RunnerProtocolError } from "../runner";
import {
	RUNNER_COMMANDS,
	type RunnerCommand,
	type RunnerError,
	type RunnerRequest,
	type RunnerResponse,
} from "../types";

export { RunnerProtocolError };

const commandSet = new Set<string>(RUNNER_COMMANDS);

export function encodeRunnerRequest<TPayload>(
	request: Omit<RunnerRequest<TPayload>, "protocolVersion"> & { protocolVersion?: number },
): string {
	if (!commandSet.has(request.command))
		throw new RunnerProtocolError(
			"unsupported-command",
			`runner command ${String(request.command)} is unsupported`,
		);
	if (!request.requestId)
		throw new RunnerProtocolError("invalid-message", "runner requestId must be non-empty");
	const protocolVersion = request.protocolVersion ?? 1;
	if (!Number.isInteger(protocolVersion) || protocolVersion < 1)
		throw new RunnerProtocolError("invalid-message", "runner protocolVersion must be positive");
	return `${JSON.stringify({ ...request, protocolVersion })}\n`;
}

export function decodeRunnerResponse<TPayload = unknown>(line: string): RunnerResponse<TPayload> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		throw new RunnerProtocolError("invalid-json", "runner response is not valid JSON");
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
		throw new RunnerProtocolError("invalid-message", "runner response must be an object");
	const row = parsed as Record<string, unknown>;
	if (row.protocolVersion !== 1)
		throw new RunnerProtocolError(
			"protocol-mismatch",
			`runner protocol ${String(row.protocolVersion)} is unsupported`,
		);
	if (typeof row.ok !== "boolean")
		throw new RunnerProtocolError("invalid-message", "runner response ok must be boolean");
	if (!row.ok) {
		const error = row.error;
		if (
			typeof error !== "object" ||
			error === null ||
			typeof (error as RunnerError).code !== "string" ||
			typeof (error as RunnerError).message !== "string"
		) {
			throw new RunnerProtocolError("invalid-message", "failed runner response must include an error");
		}
	}
	return row as unknown as RunnerResponse<TPayload>;
}

export function assertSuccessfulResponse<TPayload>(response: RunnerResponse<TPayload>): TPayload {
	if (!response.ok)
		throw new RunnerProtocolError(
			response.error?.code ?? "runner-error",
			response.error?.message ?? "runner request failed",
			response.error?.retryable ?? false,
		);
	return (response.payload ?? response.data ?? response.result) as TPayload;
}

export type { RunnerCommand };
