import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { WebSocket } from "ws";

const PORT = Number(process.env.DRONE_CDP_PORT || 9224);
const OUT = process.env.DRONE_SIM_OUT || "/tmp/drone-v19-sim/out";
mkdirSync(OUT, { recursive: true });

function target(targetUrl = null, targetId = null) {
	const raw = execFileSync("curl", ["--max-time", "5", "-fsS", `http://127.0.0.1:${PORT}/json`], {
		encoding: "utf8",
	});
	const pages = JSON.parse(raw).filter((item) => item.type === "page");
	const page =
		(targetId ? pages.find((item) => item.id === targetId) : null) ||
		(targetUrl ? pages.find((item) => item.url === targetUrl) : null) ||
		pages[0];
	if (!page) throw new Error(`CDP page target not found on ${PORT}`);
	return page;
}

export class CdpPage {
	constructor(targetUrl = null, targetId = null) {
		this.page = target(targetUrl, targetId);
		this.ws = new WebSocket(this.page.webSocketDebuggerUrl);
		this.id = 0;
		this.pending = new Map();
		this.consoleErrors = [];
		this.unhandled = [];
		this.ws.on("message", (data) => {
			const message = JSON.parse(data.toString());
			if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
				this.consoleErrors.push(
					sanitize(message.params.args?.map((arg) => arg.value ?? arg.description).join(" ")),
				);
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
			const timer = setTimeout(() => reject(new Error("CDP WebSocket connection timed out")), 10_000);
			this.ws.once("open", () => {
				clearTimeout(timer);
				resolveOpen();
			});
			this.ws.once("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
		});
		await this.send("Runtime.enable");
		await this.send("Log.enable");
		await this.send("Performance.enable");
		return this;
	}

	send(method, params = {}) {
		return new Promise((resolveSend, reject) => {
			const id = ++this.id;
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP ${method} timed out after 15 seconds`));
			}, 15_000);
			this.pending.set(id, (message) => {
				clearTimeout(timer);
				message.error
					? reject(new Error(`${method}: ${message.error.message}`))
					: resolveSend(message.result);
			});
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
		return this.clickTextWithin("body", text, { tag, exact });
	}

	async clickTextWithin(scope, text, { tag = "button", exact = false } = {}) {
		const needle = JSON.stringify(text);
		const expr = `(() => { const root=document.querySelector(${JSON.stringify(scope)}); if(!root)return false; const nodes=[...root.querySelectorAll(${JSON.stringify(tag)})]; const n=nodes.find(x=>${exact ? `x.textContent.trim()===${needle}` : `x.textContent.includes(${needle})`}); if(!n)return false; n.click(); return true; })()`;
		const ok = await this.eval(expr);
		await this.settle();
		return ok;
	}

	async clickRegexWithin(scope, pattern, { tag = "button" } = {}) {
		const expr = `(() => { const root=document.querySelector(${JSON.stringify(scope)}); if(!root)return false; const re=new RegExp(${JSON.stringify(pattern)},'iu'); const n=[...root.querySelectorAll(${JSON.stringify(tag)})].find(x=>re.test(x.textContent.trim())); if(!n)return false; n.click(); return true; })()`;
		const ok = await this.eval(expr);
		await this.settle();
		return ok;
	}

	async clickSelector(selector) {
		const ok = await this.eval(
			`(() => { const n=document.querySelector(${JSON.stringify(selector)}); if(!n)return false; n.click(); return true; })()`,
		);
		await this.settle();
		return ok;
	}

	async fill(selector, value) {
		const ok = await this.eval(
			`(() => { const n=document.querySelector(${JSON.stringify(selector)}); if(!n)return false; n.focus(); n.select?.(); return true; })()`,
		);
		if (ok) await this.send("Input.insertText", { text: value });
		await this.settle();
		return ok;
	}

	async setSelect(selector, value) {
		const result = await this.eval(
			`(() => { const n=document.querySelector(${JSON.stringify(selector)}); if(!n)return {ok:false}; n.value=${JSON.stringify(value)}; n.dispatchEvent(new Event('change',{bubbles:true})); return {ok:true,value:n.value}; })()`,
		);
		await this.settle();
		return result;
	}

	async settle() {
		await this.eval(
			"new Promise(r=>{setTimeout(r,250);requestAnimationFrame(()=>requestAnimationFrame(r))})",
		);
	}

	async key(key, code = key, modifiers = 0) {
		await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
		await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
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

	async waitForSelector(selector, timeoutMs = 20_000) {
		return this.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, timeoutMs);
	}

	async visibleCount(selector) {
		return this.eval(
			`(() => [...document.querySelectorAll(${JSON.stringify(selector)})].filter(n=>{const r=n.getBoundingClientRect(); return r.width>0&&r.height>0&&getComputedStyle(n).visibility!=='hidden'}).length)()`,
		);
	}

	async scopedText(selector) {
		return this.eval(`document.querySelector(${JSON.stringify(selector)})?.textContent || ''`);
	}

	async assistantText() {
		return this.eval(
			"[...document.querySelectorAll('.markdown-body')].map(n=>n.textContent||'').join('\\n')",
		);
	}

	async userText() {
		return this.eval("[...document.querySelectorAll('.bg-bubble')].map(n=>n.textContent||'').join('\\n')");
	}

	async waitForIdle(timeoutMs = 30_000) {
		return this.waitFor(
			`(() => {
			const stop=document.querySelector('button[aria-label="停止"],button[aria-label="Stop"]');
			const composer=document.querySelector('[data-testid="composer-input"],textarea');
			const modal=document.querySelector('[data-testid="ask-simple"],[data-testid="ask-dialog"],[data-testid="permission-allow-run"]');
			return Boolean(composer && !stop && !modal);
		})()`,
			timeoutMs,
			250,
		);
	}

	async waitForRunStart(timeoutMs = 5_000) {
		return this.waitFor(
			`Boolean(document.querySelector('button[aria-label="停止"],button[aria-label="Stop"],[data-testid="progress-note"],[data-testid="tool-phase-group"],[data-testid="ask-simple"],[data-testid="ask-dialog"],[data-testid="permission-allow-run"]'))`,
			timeoutMs,
			100,
		);
	}

	/** Resolve trust, task ask-user, form ask-user, and tool permission cards through their own DOM contracts. */
	async handleDialogs(maxRounds = 12) {
		const handled = [];
		for (let i = 0; i < maxRounds; i++) {
			if (await this.visibleCount('[data-testid="permission-allow-run"]')) {
				await this.clickSelector('[data-testid="permission-allow-run"]');
				handled.push("permission");
				continue;
			}
			if (await this.visibleCount('[data-testid="ask-simple"]')) {
				const clicked = await this.clickRegexWithin(
					'[data-testid="ask-simple"]',
					"同意|确认|允许|继续|approve|confirm|allow|yes",
				);
				if (!clicked) throw new Error("ask-simple has no confirm option");
				handled.push("ask-user-simple");
				continue;
			}
			if (await this.visibleCount('[data-testid="ask-dialog"]')) {
				const chosen = await this.eval(
					`(() => { const root=document.querySelector('[data-testid="ask-dialog"]'); const sections=[...root.querySelectorAll('section')]; const choices=sections.map(section=>[...section.querySelectorAll('button')].find(x=>!x.disabled)); const all=choices.filter(Boolean); if(!all.length)return false; all.forEach(button=>button.click()); return true; })()`,
				);
				if (!chosen) throw new Error("ask-dialog has no option button");
				const submitted = await this.clickRegexWithin('[data-testid="ask-dialog"]', "提交|完成|submit");
				if (!submitted) throw new Error("ask-dialog has no submit button");
				handled.push("ask-user-form");
				continue;
			}
			const trust = await this.clickRegexWithin('[role="dialog"]', "信任|trust");
			if (trust) {
				handled.push("trust");
				continue;
			}
			break;
		}
		return handled;
	}

	async screenshot(name) {
		const { data } = await this.send("Page.captureScreenshot", { format: "png" });
		const file = resolve(OUT, name);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, Buffer.from(data, "base64"));
		return file;
	}

	async setViewport(width, height) {
		await this.send("Emulation.setDeviceMetricsOverride", {
			width,
			height,
			deviceScaleFactor: 1,
			mobile: false,
		});
	}

	async metrics() {
		const result = await this.send("Performance.getMetrics");
		return Object.fromEntries((result.metrics || []).map((metric) => [metric.name, metric.value]));
	}

	async audit() {
		return this.eval(`(() => {
			const nodes=[...document.querySelectorAll('*')];
			const raw=nodes.map(n=>n.textContent||'').join(' ');
			const key=/\\b[a-z][a-z0-9_-]*(?:\\.[a-z0-9_-]+){2,}\\b/gi;
			const overflows=nodes.map((n,index)=>({n,index})).filter(({n})=>n instanceof HTMLElement && n.scrollWidth>n.clientWidth+2).slice(0,20).map(({n,index})=>({index,tag:n.tagName,cls:String(n.className).slice(0,80),text:(n.textContent||'').trim().slice(0,80),clientWidth:n.clientWidth,scrollWidth:n.scrollWidth}));
			const tiny=nodes.filter(n=>n instanceof HTMLElement && parseFloat(getComputedStyle(n).fontSize)<11 && (n.textContent||'').trim()).length;
			return {viewport:{width:innerWidth,height:innerHeight},rawKeys:[...new Set(raw.match(key)||[])].slice(0,40),overflowCount:overflows.length,overflows,tinyTextCount:tiny};
		})()`);
	}

	async screenshotOverflowCandidates(audit, prefix) {
		const screenshots = [];
		for (const candidate of audit?.overflows || []) {
			await this.eval(
				`(() => { const n=document.querySelectorAll('*')[${candidate.index}]; n?.scrollIntoView({block:'center',inline:'nearest'}); return Boolean(n); })()`,
			);
			screenshots.push({
				...candidate,
				screenshot: await this.screenshot(`${prefix}/overflow-${candidate.index}.png`),
			});
		}
		return screenshots;
	}

	async close() {
		this.ws.close();
	}
}

export function sanitize(value) {
	return String(value ?? "")
		.replace(/\/Users\/[^\s/]+(?:\/[^\s]*)?/g, "<user-path>")
		.replace(/(?:sk|key|token|secret)[-_a-z0-9]*[=:][^\s,}]+/gi, "$1=<redacted>")
		.slice(0, 500);
}

function traceFiles(root) {
	const found = [];
	if (!root) return found;
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = resolve(root, entry.name);
		if (entry.isDirectory()) found.push(...traceFiles(path));
		else if (entry.isFile() && path.endsWith(".jsonl") && path.includes("/traces/")) found.push(path);
	}
	return found;
}

function hasObjectName(value, name) {
	if (!value || typeof value !== "object") return false;
	if (Array.isArray(value)) return value.some((item) => hasObjectName(item, name));
	return Object.entries(value).some(
		([key, item]) => (key === "name" && item === name) || hasObjectName(item, name),
	);
}

export function readTraceSummary(root, sinceMs = 0) {
	const summary = { files: 0, bytes: 0, harnessCalls: 0, harnessRecallCalls: 0, units: {} };
	for (const file of traceFiles(root)) {
		const stat = statSync(file);
		const lines = readFileSync(file, "utf8").split("\n");
		let used = false;
		for (const line of lines) {
			if (!line.trim()) continue;
			let value;
			try {
				value = JSON.parse(line);
			} catch {
				continue;
			}
			if (Number(value.ts || 0) < sinceMs) continue;
			used = true;
			if (value.kind === "harness_unit" || (value.type === "trace_custom" && value.kind === "harness_unit")) {
				const unit = value.data?.unit || value.data?.data?.unit || "unknown";
				summary.units[unit] = (summary.units[unit] || 0) + 1;
				summary.harnessCalls++;
			}
			if (hasObjectName(value, "harness_recall")) summary.harnessRecallCalls++;
		}
		if (used) {
			summary.files++;
			summary.bytes += stat.size;
		}
	}
	return summary;
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
	const result = {
		scenario: name,
		startedAt: new Date().toISOString(),
		steps: [],
		screenshots: [],
		consoleErrors: [],
		unhandledRejections: [],
		metrics: {},
		notes: [],
	};
	await withPage(async (page) => {
		result.initialMetrics = await page.metrics();
		result.initialAudit = await page.audit();
		result.screenshots.push(await page.screenshot(`${name}/00-initial.png`));
		const step = async (
			stepName,
			fnStep,
			screenshotName = `${name}/${result.steps.length + 1}-${slug(stepName)}.png`,
		) => {
			const t0 = Date.now();
			const beforeErrors = page.consoleErrors.length;
			const beforeUnhandled = page.unhandled.length;
			let ok = false;
			let detail = {};
			try {
				const value = await fnStep(page);
				ok = value?.ok === true;
				detail = value && typeof value === "object" ? value : { value };
			} catch (error) {
				detail = { error: sanitize(error?.stack || error) };
			}
			const shot = await page.screenshot(screenshotName);
			result.screenshots.push(shot);
			result.steps.push({
				name: stepName,
				ok,
				elapsedMs: Date.now() - t0,
				consoleErrors: page.consoleErrors.slice(beforeErrors),
				unhandledRejections: page.unhandled.slice(beforeUnhandled),
				screenshot: shot,
				...detail,
			});
			return ok;
		};
		await fn(page, result, step);
		result.finalMetrics = await page.metrics();
		result.finalAudit = await page.audit();
		result.overflowScreenshots = await page.screenshotOverflowCandidates(result.finalAudit, name);
		result.consoleErrors = page.consoleErrors;
		result.unhandledRejections = page.unhandled;
	});
	result.elapsedMs = Date.now() - started;
	const file = resolve(OUT, `${name}.json`);
	writeFileSync(file, JSON.stringify(result, null, 2));
	console.log(
		JSON.stringify({
			scenario: name,
			file,
			elapsedMs: result.elapsedMs,
			failedSteps: result.steps.filter((s) => !s.ok).map((s) => s.name),
			consoleErrors: result.consoleErrors.length,
			unhandled: result.unhandledRejections.length,
		}),
	);
	return result;
}

export function slug(value) {
	return (
		String(value)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 60) || "step"
	);
}

export function outDir() {
	return OUT;
}
