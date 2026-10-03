import type { RunnerCommand } from "./types";

/** RunnerClient's transport seam. Implementations must use argv, never a shell string. */
export interface TransportExecRequest {
	readonly argv: readonly string[];
	readonly stdin?: string | Uint8Array;
	readonly timeoutMs?: number;
}

export interface TransportExecResult {
	readonly exitCode: number;
	readonly stdout: string | Uint8Array;
	readonly stderr: string | Uint8Array;
}

export interface RunnerTransport {
	exec(request: TransportExecRequest): Promise<TransportExecResult>;
	close?(): Promise<void> | void;
	readonly runnerPath?: string;
	/** Optional specialized implementation that can avoid process setup. */
	runRunner?(command: RunnerCommand, input: string, timeoutMs?: number): Promise<TransportExecResult>;
}

/** A deterministic transport fake for package and integration tests. */
export class MemoryTransport implements RunnerTransport {
	readonly requests: TransportExecRequest[] = [];
	readonly uploads: Array<{
		readonly source: Uint8Array | string;
		readonly destination: string;
		readonly maxBytes?: number;
	}> = [];
	readonly downloads = new Map<string, Uint8Array>();
	private readonly responder: (
		request: TransportExecRequest,
	) => TransportExecResult | Promise<TransportExecResult>;

	constructor(
		responder: (request: TransportExecRequest) => TransportExecResult | Promise<TransportExecResult>,
	) {
		this.responder = responder;
	}

	async exec(request: TransportExecRequest): Promise<TransportExecResult> {
		this.requests.push({ ...request, argv: [...request.argv] });
		return await this.responder(request);
	}

	async upload(request: {
		readonly source: Uint8Array | string;
		readonly destination: string;
		readonly maxBytes?: number;
	}): Promise<void> {
		this.uploads.push(request);
		if (typeof request.source !== "string") this.downloads.set(request.destination, request.source.slice());
	}

	async download(request: {
		readonly source: string;
		readonly destination?: string;
		readonly maxBytes?: number;
	}): Promise<Uint8Array> {
		const bytes = this.downloads.get(request.source);
		if (!bytes) throw new Error(`No memory transport file at ${request.source}`);
		if (request.maxBytes !== undefined && bytes.byteLength > request.maxBytes)
			throw new Error(`Download exceeds ${request.maxBytes} bytes`);
		return bytes.slice();
	}
}
