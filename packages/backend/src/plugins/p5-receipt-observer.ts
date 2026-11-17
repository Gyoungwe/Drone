import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Code, FileReadback, Receipt, RequestInput } from "@gyoungwe/plugin-api/p5-receipts";
import type { P5ReceiptStore } from "./p5-receipt-store";

export interface P5ReceiptObservation<T> {
	readonly request: RequestInput;
	readonly metadata: Pick<Receipt, "operation" | "inputSha256" | "scope" | "category" | "parentReceiptRef">;
	/** Actual readback must match this host-reviewed list, including its order. */
	readonly expectedReadback: readonly FileReadback[];
	readonly approved: boolean;
	execute(): Promise<T>;
	readback(): Promise<readonly FileReadback[]>;
}

function failure(code: Code): Error {
	return Object.assign(new Error(`P5 receipt observation failed: ${code}`), { code });
}

async function runEffect<T>(observation: P5ReceiptObservation<T>) {
	const value = await observation.execute();
	const readback = await observation.readback();
	return { value, readback };
}

/** Host-only observation: callers supply current approval and metadata, never restored authority. */
export function createP5ReceiptObserver(store: P5ReceiptStore, now: () => string) {
	return async <T>(observation: P5ReceiptObservation<T>): Promise<T> => {
		const { approved } = observation;
		const receiptRef = randomUUID();
		const accepted = await store
			.accept(observation.request, {
				...observation.metadata,
				receiptRef,
				decision: approved ? "approved" : "denied",
				status: approved ? "accepted" : "failed",
				at: now(),
				resultSha256: null,
				readback: [],
			})
			.catch(() => {
				throw failure("PERSISTENCE_PENDING");
			});
		// R1 returns existing receipts idempotently; only this fresh acceptance can invoke an effect.
		if (accepted.receiptRef !== receiptRef) throw failure("STATE_CONFLICT");
		if (!approved) throw failure("DENIED");
		const finish = async (
			status: "succeeded" | "failed" | "outcome-unknown",
			resultSha256: string | null,
			readback: readonly FileReadback[],
		) =>
			store.finish(observation.request, { status, at: now(), resultSha256, readback }).catch(() => {
				throw failure("PERSISTENCE_PENDING");
			});
		let result: Awaited<ReturnType<typeof runEffect<T>>>;
		try {
			result = await runEffect(observation);
		} catch {
			// Effect/readback errors can contain payloads; persist uncertainty and expose only a code.
			await finish("outcome-unknown", null, []);
			throw failure("OUTCOME_UNKNOWN");
		}
		if (!isDeepStrictEqual(result.readback, observation.expectedReadback)) {
			await finish("failed", null, result.readback);
			throw failure("READBACK_FAILED");
		}
		const resultSha256 = createHash("sha256")
			.update(JSON.stringify(result.value) ?? "null")
			.digest("hex");
		await finish("succeeded", resultSha256, result.readback);
		return result.value;
	};
}
