/** Coalesce identical in-flight UI commands BEFORE they cancel handoffs or reattach context.
 * Different commands still run normally and invalidate earlier work. No consent is cached.
 */
export function singleFlightCommand(handler) {
	const pending = new Map();
	return async (args, ctx) => {
		if (args.length > 6000) throw new Error("Task command too large.");
		const key = JSON.stringify([ctx.sessionManager?.getSessionId?.() || ctx.sessionId, ctx.cwd, args]);
		if (pending.has(key)) return pending.get(key);
		const run = Promise.resolve().then(() => handler(args, ctx));
		pending.set(key, run);
		try {
			return await run;
		} finally {
			pending.delete(key);
		}
	};
}
