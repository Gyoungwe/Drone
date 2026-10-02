import type { CommandResult } from "./types";

export type RunnerOperation =
	| "version"
	| "capabilities"
	| "prepare"
	| "start"
	| "status"
	| "logs"
	| "cancel"
	| "collect";

export interface RunnerRequest {
	operation: RunnerOperation;
	jobId?: string;
	cursor?: string;
	payload?: Readonly<Record<string, unknown>>;
}

export interface RunnerResponse {
	ok: boolean;
	operation: RunnerOperation;
	jobId?: string;
	status?: string;
	cursor?: string;
	data?: unknown;
	error?: string;
}

/** Fixed-subcommand seam: transport implementations encode this request as JSON on stdin. */
export interface RemoteRunner {
	request(request: RunnerRequest): Promise<RunnerResponse>;
}

export class FakeRemoteRunner implements RemoteRunner {
	readonly requests: RunnerRequest[] = [];
	private readonly responses = new Map<RunnerOperation, RunnerResponse>();

	respond(operation: RunnerOperation, response: Omit<RunnerResponse, "operation">): this {
		this.responses.set(operation, { ...response, operation });
		return this;
	}

	async request(request: RunnerRequest): Promise<RunnerResponse> {
		this.requests.push(structuredClone(request));
		return (
			this.responses.get(request.operation) ?? {
				operation: request.operation,
				ok: true,
				jobId: request.jobId,
			}
		);
	}
}

export function runnerCommand(operation: RunnerOperation): readonly string[] {
	return ["runner", operation];
}

export function boundedRunnerResponse(response: RunnerResponse, maxBytes = 1024 * 1024): RunnerResponse {
	const text = JSON.stringify(response.data ?? "");
	if (Buffer.byteLength(text, "utf8") > maxBytes)
		throw new Error("Runner response exceeds the bounded payload limit");
	return response;
}

export type FixedCommandExecutor = (argv: readonly string[], stdin: string) => Promise<CommandResult>;
