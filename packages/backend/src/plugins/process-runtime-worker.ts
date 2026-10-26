/** Executed only in the permission-restricted child, never imported as plugin code by the host. */
export const PROCESS_RUNTIME_WORKER = String.raw`
import { createInterface } from "node:readline";
import { AsyncLocalStorage } from "node:async_hooks";
import { pathToFileURL } from "node:url";

const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const messageError = (error) => error instanceof Error ? error.message : String(error);
const lifecycle = new AbortController();
const calls = new Map();
const nativeSessions = new Map();
const currentCall = new AsyncLocalStorage();
const capabilityCalls = new Map();
let capabilitySequence = 0;
const capabilities = {
  call(name, input) {
    const callId = currentCall.getStore();
    if (!callId) return Promise.reject(new Error("Plugin capability has no live caller"));
    const id = String(++capabilitySequence);
    return new Promise((resolve, reject) => {
      capabilityCalls.set(id, {resolve, reject});
      send({type:"capability", id, callId, name, input});
    });
  }
};
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let runtime;
console.log = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
console.info = console.log;
console.warn = console.log;

input.on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.type === "capability_result") {
    const pending = capabilityCalls.get(message.id);
    if (!pending) throw new Error("Unknown capability result");
    capabilityCalls.delete(message.id);
    if (message.ok) pending.resolve(message.value);
    else { const error = new Error(message.error); if (typeof message.code === "string") error.code = message.code; pending.reject(error); }
    return;
  }
  if (message.type === "cancel") { calls.get(message.id)?.abort(); return; }
  if (message.type === "stop") { lifecycle.abort(); return; }
  try {
    if (message.type === "start") {
      lifecycle.signal.throwIfAborted();
      const module = await import(pathToFileURL(process.argv[1]).href);
      const events = { changed() { lifecycle.signal.throwIfAborted(); send({ type: "changed" }); } };
      if (message.resource) {
        const resource = await currentCall.run("bootstrap", () => module.default({ ...message.resource, signal: lifecycle.signal, capabilities, events }));
        runtime = {operations:{request:{
          inputSchema:{type:"object",required:["operation","input"],properties:{operation:{type:"string"},input:{}},additionalProperties:false},
          resultSchema:{},effect:"read",
          execute:({operation,input})=>resource.invoke(operation,input)
        }},dispose:()=>resource.dispose()};
      } else {
        runtime = await currentCall.run("bootstrap", () => module.default({ applicationId: message.applicationId, signal: lifecycle.signal, resources: message.resources, capabilities, events }));
      }
      const operations = Object.fromEntries(Object.entries(runtime.operations).map(([name, operation]) => [name, {
        inputSchema: operation.inputSchema, resultSchema: operation.resultSchema, effect: operation.effect,
      }]));
      send({ type: "ready", operations, native: typeof runtime.createNativeSession === "function" });
      return;
    }

    if (message.type === "native_attach") {
      const adapter = await runtime.createNativeSession();
      if (adapter.projection) { await adapter.dispose(); throw new Error("Native publication projection is not yet supported by this adapter"); }
      const tools = new Map(), hooks = new Map();
      const unsupported = (name) => { throw new Error("Unsupported native Pi API: " + name); };
      const pi = new Proxy({
        registerTool(tool) { if(tool.renderCall||tool.renderResult) unsupported("tool rendering"); if(tools.has(tool.name)) throw new Error("Duplicate native tool"); tools.set(tool.name,tool); },
        on(name,handler) { if(name!=="session_start"&&name!=="session_shutdown") unsupported("on("+name+")"); const list=hooks.get(name)||[];list.push(handler);hooks.set(name,list); }
      }, {get(target,name){if(name in target)return target[name];return unsupported(String(name));}});
      try { await adapter.extension(pi); }
      catch(error) { await adapter.dispose(); throw error; }
      nativeSessions.set(message.attachment, {adapter,tools,hooks,pending:new Map(),closed:false});
      send({type:"result",id:message.id,ok:true,value:{tools:[...tools.values()].map(({name,label,description,parameters,drone})=>({name,label,description,parameters,...(drone===undefined?{}:{drone})})),effects:adapter.toolEffects||{},events:[...hooks.keys()]}});
      return;
    }
    if (message.type === "native_detach") {
      const session = nativeSessions.get(message.attachment);
      if(!session) throw new Error("Native attachment is not active");
      session.closed=true;
      for(const id of session.pending.keys()) calls.get(id)?.abort();
      await Promise.allSettled([...session.pending.values()]);
      await session.adapter.dispose();
      nativeSessions.delete(message.attachment);
      send({type:"result",id:message.id,ok:true,value:null});
      return;
    }
    if (message.type === "native_call") {
      const session=nativeSessions.get(message.attachment);
      if(!session||session.closed)throw new Error("Native attachment is not active");
      const controller=new AbortController();calls.set(message.id,controller);
      const signal=AbortSignal.any([lifecycle.signal,controller.signal]);
      const unsupported=(name)=>{throw new Error("Unsupported native Pi context: "+name);};
      const ctx=new Proxy({cwd:message.context.cwd,hasUI:false,sessionManager:new Proxy({getSessionId:()=>message.context.sessionId},{get(target,name){if(name in target)return target[name];return unsupported("sessionManager."+String(name));}})},{get(target,name){if(name in target)return target[name];return unsupported(String(name));}});
      const pending=currentCall.run(message.id,async()=>{
        signal.throwIfAborted();
        if(message.kind==="tool") return session.tools.get(message.name).execute(message.toolCallId,message.input,signal,undefined,ctx);
        let result;
        for(const handler of session.hooks.get(message.name)||[]) result=await handler(message.input,ctx);
        return result ?? null;
      });
      session.pending.set(message.id,pending);
      try { const value=await pending;send({type:"result",id:message.id,ok:true,value}); }
      finally { session.pending.delete(message.id);calls.delete(message.id); }
      return;
    }
    if (message.type === "dispose") {
      for(const session of nativeSessions.values()) await session.adapter.dispose();
      nativeSessions.clear();
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
      const value = await currentCall.run(message.id, () => runtime.operations[message.operation].execute(message.input, { scope: Object.freeze(message.scope), signal, capabilities }));
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
