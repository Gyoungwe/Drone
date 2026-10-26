import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginSandboxSession } from "../src/plugin-sandbox";

const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);
const roots = [];
const sessions = [];
const source = `let executed=0;
export default pi => {
 pi.registerTool({name:"guarded",label:"Guarded",description:"Synthetic UI gate",parameters:{type:"object",properties:{}},async execute(_id,_args,_signal,_update,ctx){
  if(!ctx.hasUI)return {content:[{type:"text",text:"headless"}]};
  if(await ctx.ui.confirm("Synthetic consent","Allow?")){executed++;ctx.ui.notify("performed","info");}
  return {content:[{type:"text",text:String(executed)}]};
 }});
 pi.registerTool({name:"status",label:"Status",description:"Synthetic state",parameters:{type:"object",properties:{}},async execute(){return {content:[{type:"text",text:String(executed)}]};}});
};`;
function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
async function sandbox(code = source) {
	const root = await mkdtemp(join(tmpdir(), "drone-sandbox-ui-"));
	roots.push(root);
	const entrypoint = join(root, "extension.mjs");
	await writeFile(entrypoint, code);
	const session = new PluginSandboxSession({
		pluginId: "example",
		entrypoint,
		packageRoot: root,
		cwd: root,
		runtimeDirectory,
	});
	sessions.push(session);
	await session.start();
	return session;
}
afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.skipIf(!existsSync(join(runtimeDirectory, "runtime.json")))(
	"sandbox official basic UI bridge",
	() => {
		it("uses a truthful headless context without implicit approval", async () => {
			const session = await sandbox();
			const result = await session.invoke("guarded", "call", {});
			expect(result.content[0].text).toBe("headless");
		});
		it("cancels pending consent and ignores a late approval without performing the action", async () => {
			const approval = deferred();
			const asked = deferred();
			const notify = vi.fn();
			let uiSignal;
			const ui = {
				confirm: vi.fn((_title, _message, options) => {
					uiSignal = options.signal;
					asked.resolve();
					return approval.promise;
				}),
				notify,
			};
			const session = await sandbox();
			const controller = new AbortController();
			const invocation = session.invoke("guarded", "call", {}, controller.signal, { hasUI: true, ui });
			const rejected = expect(invocation).rejects.toThrow("aborted");
			await asked.promise;
			controller.abort();
			await rejected;
			expect(uiSignal.aborted).toBe(true);
			approval.resolve(true);
			const result = await session.invoke("status", "status", {});
			expect(result.content[0].text).toBe("0");
			expect(notify).not.toHaveBeenCalled();
		});
		it("binds consent to the originating worker and prevents late responses after close", async () => {
			const approval = deferred();
			const asked = deferred();
			const notify = vi.fn();
			const first = await sandbox();
			const second = await sandbox();
			const invocation = first.invoke("guarded", "same-call", {}, undefined, {
				hasUI: true,
				ui: {
					confirm: () => {
						asked.resolve();
						return approval.promise;
					},
					notify,
				},
			});
			const rejected = expect(invocation).rejects.toThrow();
			await asked.promise;
			const other = await second.invoke("guarded", "same-call", {}, undefined, {
				hasUI: true,
				ui: { confirm: async () => true, notify: vi.fn() },
			});
			expect(other.content[0].text).toBe("1");
			await first.close();
			await rejected;
			approval.resolve(true);
			expect(notify).not.toHaveBeenCalled();
		});
		it("rejects unchecked UI request payloads from a compromised child", async () => {
			const session = await sandbox(
				`export default pi=>pi.registerTool({name:"bad",label:"Bad",description:"Invalid UI wire",parameters:{type:"object",properties:{}},async execute(){process.stdout.write(JSON.stringify({type:"ui_request",id:"example:1",requestId:"1",method:"confirm",title:42,message:"bad"})+"\\n");return {content:[{type:"text",text:"must-not-report-success"}]};}});`,
			);
			const confirm = vi.fn(async () => true);
			await expect(
				session.invoke("bad", "call", {}, undefined, { hasUI: true, ui: { confirm } }),
			).rejects.toThrow("Invalid plugin sandbox UI request");
			expect(confirm).not.toHaveBeenCalled();
		});
		it("fails unsupported terminal UI explicitly", async () => {
			const session = await sandbox(
				`export default pi=>pi.registerTool({name:"custom",label:"Custom",description:"Unsupported TUI",parameters:{type:"object",properties:{}},async execute(_id,_args,_signal,_update,ctx){await ctx.ui.custom(()=>{});}});`,
			);
			await expect(session.invoke("custom", "call", {}, undefined, { hasUI: true, ui: {} })).rejects.toThrow(
				"not supported: ctx.ui.custom",
			);
		});
	},
);
