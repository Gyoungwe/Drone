export const WORKER_FACT_DELIVERY = String.raw`
async function validateNativeFactOwner(adapter) {
  const owner = adapter.factOwner;
  if (owner !== undefined && (typeof owner?.cursor !== "function" || typeof owner.deliver !== "function")) {
    await adapter.dispose();
    throw new Error("Invalid native fact owner");
  }
  return owner;
}

async function routeNativeFactRequest(message) {
  const session = nativeSessions.get(message.attachment);
  if (!session || session.closed) throw new Error("Native attachment is not active");
  const owner = session.factOwner;
  if (owner === undefined) throw new Error("Native fact owner is unavailable");
  const controller = new AbortController();
  calls.set(message.id, controller);
  const signal = AbortSignal.any([lifecycle.signal, controller.signal]);
  const pending = currentCall.run(message.id, async () => {
    signal.throwIfAborted();
    return message.type === "native_fact_cursor" ? owner.cursor(signal) : owner.deliver(message.facts, signal);
  });
  session.pending.set(message.id, pending);
  try {
    const value = await pending;
    signal.throwIfAborted();
    send({ type: "result", id: message.id, ok: true, value });
  } finally {
    session.pending.delete(message.id);
    calls.delete(message.id);
  }
}
`;
