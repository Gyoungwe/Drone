/**
 * Coalesce identical in-flight UI commands before they cancel handoffs or
 * reattach context. A completed or rejected invocation is removed, so a
 * later explicit retry always gets a fresh run.
 */
export interface TaskCommandContext {
	cwd?: string;
	sessionId?: string;
	sessionManager?: {
		getSessionId?: () => string | null | undefined;
	};
}

export type TaskCommandHandler<Args extends { length: number }, Context, Result> = (
	args: Args,
	ctx: Context,
) => Result | PromiseLike<Result>;

export function singleFlightCommand<
	Args extends { length: number },
	Context extends TaskCommandContext,
	Result,
>(handler: TaskCommandHandler<Args, Context, Result>) {
	const pending = new Map<string, Promise<Awaited<Result>>>();
	return async (args: Args, ctx: Context): Promise<Awaited<Result>> => {
		if (args.length > 6000) throw new Error("Task command too large.");
		const key = JSON.stringify([ctx.sessionManager?.getSessionId?.() || ctx.sessionId, ctx.cwd, args]);
		const existing = pending.get(key);
		if (existing) return existing;
		const run = (async (): Promise<Awaited<Result>> => await handler(args, ctx))();
		pending.set(key, run);
		try {
			return await run;
		} finally {
			pending.delete(key);
		}
	};
}
