/** Executed only in the permission-restricted child, never imported as plugin code by the host. */
export const PROCESS_RUNTIME_WORKER = String.raw`
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const messageError = (error) => error instanceof Error ? error.message : String(error);
const lifecycle = new AbortController();
const calls = new Map();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let runtime;
console.log = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
console.info = console.log;
console.warn = console.log;

input.on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.type === "cancel") { calls.get(message.id)?.abort(); return; }
  if (message.type === "stop") { lifecycle.abort(); return; }
  try {
    if (message.type === "start") {
      lifecycle.signal.throwIfAborted();
      const module = await import(pathToFileURL(process.argv[1]).href);
      runtime = await module.default({ applicationId: message.applicationId, signal: lifecycle.signal });
      const operations = Object.fromEntries(Object.entries(runtime.operations).map(([name, operation]) => [name, {
        inputSchema: operation.inputSchema, resultSchema: operation.resultSchema, effect: operation.effect,
      }]));
      send({ type: "ready", operations });
      return;
    }
    if (message.type === "dispose") {
      await runtime.dispose();
      send({ type: "result", id: message.id, ok: true, value: null });
      input.close();
      process.stdin.destroy();
      return;
    }
    if (message.type !== "invoke") throw new Error("Unknown runtime protocol request");
    const controller = new AbortController();
    calls.set(message.id, controller);
    try {
      const signal = AbortSignal.any([lifecycle.signal, controller.signal]);
      signal.throwIfAborted();
      const value = await runtime.operations[message.operation].execute(message.input, { scope: Object.freeze(message.scope), signal });
      send({ type: "result", id: message.id, ok: true, value });
    } finally {
      calls.delete(message.id);
    }
  } catch (error) {
    if (message.type === "start") {
      if (lifecycle.signal.aborted && error === lifecycle.signal.reason) send({ type: "canceled" });
      else send({ type: "error", error: messageError(error) });
    }
    else send({ type: "result", id: message.id, ok: false, error: messageError(error) });
  }
});
`;
