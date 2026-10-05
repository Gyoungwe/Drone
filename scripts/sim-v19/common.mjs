import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { WebSocket } from "ws";

const OUT = process.env.DRONE_SIM_OUT || "/tmp/drone-v19-sim/out";
mkdirSync(OUT, { recursive: true });

function target() {
	const raw = execFileSync("curl", ["-s", "http://127.0.0.1:9224/json"], { encoding: "utf8" });
	const page = JSON.parse(raw).find((item) => item.type === "page");
	if (!page) throw new Error("CDP page target not found on 9224");
	return page;
}

export class CdpPage {
	constructor() {
		this.page = target();
		this.ws = new WebSocket(this.page.webSocketDebuggerUrl);
		this.id = 0;
		this.pending = new Map();
		this.consoleErrors = [];
		this.unhandled = [];
		this.ws.on("message", (data) => {
			const message = JSON.parse(data.toString());
			if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
				this.consoleErrors.push(sanitize(message.params.args?.map((arg) => arg.value ?? arg.description).join(" ")));
			}
			if (message.method === "Runtime.exceptionThrown") {
				this.unhandled.push(sanitize(message.params.exceptionDetails?.text || "exception"));
			}
			if (message.id && this.pending.has(message.id)) {
				const resolvePending = this.pending.get(message.id);
				this.pending.delete(message.id);
				resolvePending(message);
			}
		});
	}

		async open() {
			await new Promise((resolveOpen, reject) => {
				this.ws.once("open", resolveOpen);
				this.ws.once("error", reject);
			});
			await this.send("Runtime.enable");
			await this.send("Log.enable");
			await this.send("Performance.enable");
			return this;
		}

		send(method, params = {}) {
			return new Promise((resolveSend, reject) => {
				const id = ++this.id;
				this.pending.set(id, (message) => (message.error ? reject(new Error(message.error.message)) : resolveSend(message.result)));
				this.ws.send(JSON.stringify({ id, method, params }));
			});
		}

		async eval(expression) {
			const result = await this.send("Runtime.evaluate", {
				expression,
				returnByValue: true,
				awaitPromise: true,
				userGesture: true,
			});
			if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
			return result?.result?.value;
		}

		async clickText(text, { tag = "button", exact = false } = {}) {
			const needle = JSON.stringify(text);
			const expr = `(() => { const nodes=[...document.querySelectorAll(${JSON.stringify(tag)})]; const n=nodes.find(x=>${exact ? `x.textContent.trim()===${needle}` : `x.textContent.includes(${needle})`}); if(!n)return false; n.click(); return true; })()`;
			const ok = await this.eval(expr);
			await this.settle();
			return ok;
		}

		async clickSelector(selector) {
			const ok = await this.eval(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); if(!n)return false; n.click(); return true; })()`);
			await this.settle();
			return ok;
		}

		async fill(selector, value) {
			const ok = await this.eval(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); if(!n)return false; n.focus(); n.select?.(); return true; })()`);
			if (ok) await this.send("Input.insertText", {text:value});
			await this.settle();
			return ok;
		}

		async settle() {
			await this.eval("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
		}

		async key(key, code = key, modifiers = 0) {
			await this.send("Input.dispatchKeyEvent", {type:"keyDown",key,code,modifiers});
			await this.send("Input.dispatchKeyEvent", {type:"keyUp",key,code,modifiers});
			await this.settle();
		}

		async waitFor(expression, timeoutMs = 20_000, intervalMs = 100) {
			const started = Date.now();
			while (Date.now() - started < timeoutMs) {
				if (await this.eval(expression)) return true;
				await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
			}
			return false;
		}

		async bodyText() {
			return this.eval("document.body?.innerText || ''");
		}

		async screenshot(name) {
			const { data } = await this.send("Page.captureScreenshot", { format: "png" });
			const file = resolve(OUT, name);
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, Buffer.from(data, "base64"));
			return file;
		}

		async setViewport(width, height) {
			await this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
		}

		async metrics() {
			const result = await this.send("Performance.getMetrics");
			return Object.fromEntries((result.metrics || []).map((metric) => [metric.name, metric.value]));
		}

		async audit() {
			return this.eval(`(() => {
				const raw=[...document.querySelectorAll('*')].map(n=>n.textContent||'').join(' ');
				const key=/\\b[a-z][a-z0-9_-]*(?:\\.[a-z0-9_-]+){2,}\\b/gi;
				const overflows=[...document.querySelectorAll('*')].filter(n=>n instanceof HTMLElement && n.scrollWidth>n.clientWidth+2).slice(0,20).map(n=>({tag:n.tagName,cls:String(n.className).slice(0,80),text:(n.textContent||'').trim().slice(0,80)}));
				const tiny=[...document.querySelectorAll('*')].filter(n=>n instanceof HTMLElement && parseFloat(getComputedStyle(n).fontSize)<11 && (n.textContent||'').trim()).length;
				return {viewport:{width:innerWidth,height:innerHeight},rawKeys:[...new Set(raw.match(key)||[])].slice(0,40),overflowCount:overflows.length,overflows,tinyTextCount:tiny};
			})()`);
		}

		async close() {
			this.ws.close();
		}
}

export function sanitize(value) {
	return String(value ?? "").replace(/\/Users\/[^\s/]+(?:\/[^\s]*)?/g, "<user-path>").replace(/(?:sk|key|token|secret)[-_a-z0-9]*[=:][^\s,}]+/gi, "$1=<redacted>").slice(0, 500);
}

export async function withPage(fn) {
	const page = await new CdpPage().open();
	try {
		return await fn(page);
	} finally {
		await page.close();
	}
}

export async function runScenario(name, fn) {
	const started = Date.now();
	const result = { scenario: name, startedAt: new Date().toISOString(), steps: [], screenshots: [], consoleErrors: [], unhandledRejections: [], metrics: {}, notes: [] };
	await withPage(async (page) => {
		result.initialMetrics = await page.metrics();
		result.initialAudit = await page.audit();
		result.screenshots.push(await page.screenshot(`${name}/00-initial.png`));
		const step = async (stepName, fnStep, screenshotName = `${name}/${result.steps.length + 1}-${slug(stepName)}.png`) => {
			const t0 = Date.now();
			const beforeErrors = page.consoleErrors.length;
			const beforeUnhandled = page.unhandled.length;
			let ok = false;
			let detail = {};
			try {
				const value = await fnStep(page);
				ok = value?.ok !== false;
				detail = value && typeof value === "object" ? value : {value};
			} catch (error) {
				detail = {error: sanitize(error?.stack || error)};
			}
			const shot = await page.screenshot(screenshotName);
			result.screenshots.push(shot);
			result.steps.push({name:stepName,ok,elapsedMs:Date.now()-t0,consoleErrors:page.consoleErrors.slice(beforeErrors),unhandledRejections:page.unhandled.slice(beforeUnhandled),screenshot:shot,...detail});
			return ok;
		};
		await fn(page, result, step);
		result.finalMetrics = await page.metrics();
		result.finalAudit = await page.audit();
		result.consoleErrors = page.consoleErrors;
		result.unhandledRejections = page.unhandled;
	});
	result.elapsedMs = Date.now() - started;
	const file = resolve(OUT, `${name}.json`);
	writeFileSync(file, JSON.stringify(result, null, 2));
	console.log(JSON.stringify({scenario:name, file, elapsedMs:result.elapsedMs, failedSteps:result.steps.filter((s)=>!s.ok).map((s)=>s.name), consoleErrors:result.consoleErrors.length, unhandled:result.unhandledRejections.length}));
	return result;
}

export function slug(value) {
	return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "step";
}

export function outDir() { return OUT; }
