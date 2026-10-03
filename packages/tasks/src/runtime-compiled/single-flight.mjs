function singleFlightCommand(handler) {
  const pending = /* @__PURE__ */ new Map();
  return async (args, ctx) => {
    if (args.length > 6e3) throw new Error("Task command too large.");
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
export {
  singleFlightCommand
};
