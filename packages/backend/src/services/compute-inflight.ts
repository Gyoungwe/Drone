export function createComputeInflight() {
	const disposal = new AbortController();
	const pending = new Set<Promise<unknown>>();

	return {
		async run<T>(signal: AbortSignal | undefined, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
			const opSignal = signal ? AbortSignal.any([disposal.signal, signal]) : disposal.signal;
			opSignal.throwIfAborted();
			const operation = Promise.resolve().then(() => task(opSignal));
			pending.add(operation);
			try {
				return await operation;
			} finally {
				pending.delete(operation);
			}
		},
		async abortAndDrain(): Promise<void> {
			disposal.abort();
			await Promise.allSettled(pending);
		},
	};
}
