import { NATIVE_EVENTS } from "./native-events";

/** Executed only in the permission-restricted child, never imported as plugin code by the host. */
export const PROCESS_RUNTIME_WORKER = String.raw`
import { createInterface } from "node:readline";
import { AsyncLocalStorage } from "node:async_hooks";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const messageError = (error) => error instanceof Error ? error.message : String(error);
const lifecycle = new AbortController();
const calls = new Map();
const nativeSessions = new Map();
const supportedEvents = new Set(${JSON.stringify(NATIVE_EVENTS)});
const currentCall = new AsyncLocalStorage();
const capabilityCalls = new Map();
let capabilitySequence = 0;
const capabilities = {
  call(name, input, signal) {
    const callId = currentCall.getStore();
    if (!callId) return Promise.reject(new Error("Plugin capability has no live caller"));
    if (signal?.aborted) return Promise.reject(signal.reason);
    const id = String(++capabilitySequence);
    const cancelKey = randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = () => send({type:"cancel_capability",id,callId,cancelKey});
      capabilityCalls.set(id, {resolve,reject,signal,cleanup:()=>signal?.removeEventListener("abort",cancel)});
      signal?.addEventListener("abort",cancel,{once:true});
      send({type:"capability",id,callId,cancelKey,name,input});
    });
  }
};
let resourcesStopping;
const resourcesLifecycle = {
  dispose() {
    return resourcesStopping ??= new Promise((resolve, reject) => {
      const id = String(++capabilitySequence);
      capabilityCalls.set(id, {resolve, reject});
      send({type:"dispose_resources", id, callId:currentCall.getStore()});
    });
  }
};
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let runtime;
// Attachment-private originals; no message/proof JSON field is an authority reference.
function retainMessages(session, value) {
  const retain = message => {
    if (!message || typeof message !== "object") return null;
    let reference = session.references.get(message);
    if (!reference) { reference = String(++session.messageSequence); session.references.set(message,reference); }
    session.originals.set(reference,{message,fingerprint:JSON.stringify(message)});
    return reference;
  };
  if (!value || typeof value !== "object") return {};
  const message = retain(value.message);
  return {...(message===null?{}:{message}),...(Array.isArray(value.messages)?{messages:value.messages.map(retain)}:{})};
}
function restoreMessages(session, value, references) {
  const restore = (message, reference) => {
    if (reference===null || reference===undefined) return message;
    const original=session.originals.get(reference);
    if (!original || original.fingerprint!==JSON.stringify(message) || original.fingerprint!==JSON.stringify(original.message))
      throw new Error("Native message reference is no longer current");
    return original.message;
  };
  if (!references) return value;
  if (references.message!==undefined) value.message=restore(value.message,references.message);
  if (references.messages!==undefined) {
    if(!Array.isArray(value.messages)||value.messages.length!==references.messages.length)throw new Error("Invalid native message references");
    value.messages=value.messages.map((message,index)=>restore(message,references.messages[index]));
  }
  if (references.historicalAliases!==undefined) {
    if(!Array.isArray(value.messages)||!Array.isArray(value.persisted)||value.messages.length!==references.historicalAliases.length)
      throw new Error("Invalid native historical aliases");
    for(const [index,persistedIndex] of references.historicalAliases.entries()) {
      if(persistedIndex===null)continue;
      if(!Number.isSafeInteger(persistedIndex)||persistedIndex<0||persistedIndex>=value.persisted.length||
        JSON.stringify(value.messages[index])!==JSON.stringify(value.persisted[persistedIndex]))
        throw new Error("Native historical alias is no longer current");
      value.messages[index]=value.persisted[persistedIndex];
    }
  }
  return value;
}
console.log = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
console.info = console.log;
console.warn = console.log;

input.on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.type === "capability_result") {
    const pending = capabilityCalls.get(message.id);
    if (!pending) throw new Error("Unknown capability result");
    capabilityCalls.delete(message.id);
    pending.cleanup?.();
    if (message.ok) {
      if (pending.signal?.aborted) pending.reject(pending.signal.reason);
      else pending.resolve(message.value);
    }
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
        runtime = await currentCall.run("bootstrap", () => module.default({ applicationId: message.applicationId, signal: lifecycle.signal, resources: message.resources, ...(message.resourcesLifecycle ? {resourcesLifecycle} : {}), capabilities, events }));
      }
      const operations = Object.fromEntries(Object.entries(runtime.operations).map(([name, operation]) => [name, {
        inputSchema: operation.inputSchema, resultSchema: operation.resultSchema, effect: operation.effect,
      }]));
      send({ type: "ready", operations, native: typeof runtime.createNativeSession === "function" });
      return;
    }

    if (message.type === "native_attach") {
      const adapter = await runtime.createNativeSession(message.facts);
      if (adapter.projection && (typeof adapter.projection.event!=="function" || typeof adapter.projection.snapshot!=="function" || (adapter.projection.finalize!==undefined && typeof adapter.projection.finalize!=="function"))) {
        await adapter.dispose();
        throw new Error("Invalid native publication projection");
      }
      const tools = new Map(), commands = new Map(), hooks = [];
      const unsupported = (name) => { throw new Error("Unsupported native Pi API: " + name); };
      const pi = new Proxy({
        registerTool(tool) {
          for(const field of ["prepareArguments","prepareLoadout","renderCall","renderResult"])
            if(tool[field]!==undefined) unsupported("tool "+tool.name+"."+field);
          if(tools.has(tool.name)) throw new Error("Duplicate native tool"); tools.set(tool.name,tool);
        },
        registerCommand(name,options) {
          if(options.getArgumentCompletions!==undefined) unsupported("command "+name+".getArgumentCompletions");
          if(commands.has(name)) throw new Error("Duplicate native command");
          commands.set(name,options);
        },
        on(name,handler) { if(!supportedEvents.has(name)) unsupported("on("+name+")"); const hook={name,handler,active:true};hooks.push(hook);return ()=>{hook.active=false;}; }
      }, {get(target,name){if(name in target)return target[name];return unsupported(String(name));}});
      try { await adapter.extension(pi); }
      catch(error) { await adapter.dispose(); throw error; }
      nativeSessions.set(message.attachment, {adapter,tools,commands,hooks,pending:new Map(),closed:false,originals:new Map(),references:new WeakMap(),messageSequence:0});
      send({type:"result",id:message.id,ok:true,value:{tools:[...tools.values()].map(tool=>Object.fromEntries(
        ["name","label","description","parameters","outputSchema","constrainedSampling","renderShell","promptSnippet","promptGuidelines","exposure","namespace","annotations","defaultActive","executionMode","drone"]
          .filter(key=>tool[key]!==undefined).map(key=>[key,tool[key]])
      )),commands:[...commands.entries()].map(([name,command])=>({name,...(command.description===undefined?{}:{description:command.description})})),effects:adapter.toolEffects||{},commandEffects:adapter.commandEffects||{},eventEffects:adapter.eventEffects||{},nativeOperations:Object.fromEntries(Object.entries(adapter.nativeOperations||{}).map(([name,operation])=>[name,{event:operation.event,inputSchema:operation.inputSchema,resultSchema:operation.resultSchema,effect:operation.effect}])),...(adapter.projection?{projection:{finalize:typeof adapter.projection.finalize==="function",effect:adapter.projection.finalizeEffect??"write"}}:{}),events:hooks.map(({name},index)=>({name,index}))}});
      return;
    }
    if (message.type === "native_detach") {
      const session = nativeSessions.get(message.attachment);
      if(!session) throw new Error("Native attachment is not active");
      session.closed=true;
      for(const id of session.pending.keys()) calls.get(id)?.abort();
      await Promise.allSettled([...session.pending.values()]);
      await currentCall.run(message.id,()=>session.adapter.dispose());
      nativeSessions.delete(message.attachment);
      send({type:"result",id:message.id,ok:true,value:null});
      return;
    }
    if (message.type === "native_call" || message.type === "native_projection" || message.type === "native_operation") {
      const session=nativeSessions.get(message.attachment);
      if(!session||session.closed)throw new Error("Native attachment is not active");
      const controller=new AbortController();calls.set(message.id,controller);
      const signal=AbortSignal.any([lifecycle.signal,controller.signal]);
      const unsupported=(name)=>{throw new Error("Unsupported native Pi context: "+name);};
      const ctx=message.type==="native_call"?new Proxy({cwd:message.context.cwd,hasUI:false,signal,sessionManager:new Proxy({getSessionId:()=>message.context.sessionId},{get(target,name){if(name in target)return target[name];return unsupported("sessionManager."+String(name));}})},{get(target,name){if(name in target)return target[name];return unsupported(String(name));}}):undefined;
      const pending=currentCall.run(message.id,async()=>{
        signal.throwIfAborted();
        if(message.type==="native_operation")return session.adapter.nativeOperations[message.name].execute(message.input,restoreMessages(session,message.event,message.references),{scope:Object.freeze(message.scope),signal,capabilities});
        message.input=restoreMessages(session,message.input,message.references);
        if(message.type==="native_projection") {
          const projection=session.adapter.projection;
          if(!projection)throw new Error("Native publication projection is unavailable");
          if(message.kind==="finalize") {
            if(!projection.finalize)throw new Error("Native publication finalizer is unavailable");
            return projection.finalize(message.input,{scope:Object.freeze(message.scope),signal,capabilities});
          }
          if(message.kind==="event")return projection.event(message.input,signal);
          if(message.kind==="snapshot")return {messages:await projection.snapshot(message.input.messages,message.input.persisted,signal)};
          throw new Error("Unknown native projection request");
        }
        if(message.kind==="tool") {
          const update=message.updates?value=>{
            signal.throwIfAborted();
            if(calls.get(message.id)!==controller)throw new Error("Native tool invocation is no longer active");
            send({type:"native_update",id:message.id,value});
          }:undefined;
          return session.tools.get(message.name).execute(message.toolCallId,message.input,signal,update,ctx);
        }
        if(message.kind==="command") {
          await session.commands.get(message.name).handler(message.input,ctx);
          return null;
        }
        const hook=session.hooks[message.hookIndex];
        if(!hook||hook.name!==message.name)throw new Error("Unknown native event handler");
        if(!hook.active&&message.name!=="before_agent_start")return null;
        // The SDK retains this object even if a handler reassigns the event property.
        const systemPromptOptions=message.input.systemPromptOptions;
        const toolInput=message.name==="tool_call"?message.input.input:undefined;
        const boundaryEntries=message.name==="turn_end"?message.input.entries:undefined;
        const boundaryBefore=message.name==="turn_end"?JSON.stringify(boundaryEntries):undefined;
        const result=hook.active?await hook.handler(message.input,ctx):undefined;
        if(message.name==="before_agent_start")return {systemPromptOptions,result:result??null};
        if(message.name==="tool_call")return {input:toolInput,result:result??null};
        if(message.name==="turn_end"&&(result?.entries!==undefined||JSON.stringify(boundaryEntries)!==boundaryBefore))throw new Error("Unsupported native turn_end boundary drafts");
        // Official context handlers may mutate their message list instead of returning it.
        if(message.name==="context")return {messages:result?.messages??message.input.messages};
        // Preserve final-message mutation before the SDK persists its replacement.
        if(message.name==="message_end")return {message:result?.message??message.input.message};
        return result ?? null;
      });
      session.pending.set(message.id,pending);
      try { const value=await pending;signal.throwIfAborted();const references=message.type==="native_operation"||message.kind==="tool"||message.kind==="command"?{}:retainMessages(session,value);send({type:"result",id:message.id,ok:true,value:{value,references}}); }
      finally { session.pending.delete(message.id);calls.delete(message.id); }
      return;
    }
    if (message.type === "dispose") {
      await currentCall.run(message.id,async()=>{
        for(const session of nativeSessions.values()) await session.adapter.dispose();
        nativeSessions.clear();
        await runtime.dispose();
      });
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
