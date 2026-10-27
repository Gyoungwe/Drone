// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPlugin } from "./build";

const tmpDirs: string[] = [];

async function makePlugin(src: string, main = "src/index.tsx"): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "ui-plugin-test-"));
	tmpDirs.push(dir);
	await mkdir(join(dir, "src"), { recursive: true });
	await writeFile(join(dir, main), src, "utf-8");
	return dir;
}

afterEach(async () => {
	await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("ui-plugins build", () => {
	it("exports generic sessions and messages while preserving the existing named prompt binding", async () => {
		const dir = await makePlugin(`import { sessions, prompt, useSessionMessages } from "@gyoungwe/plugin-api";
export function bindings() { return { sessionPrompt: sessions.prompt, legacyPrompt: prompt, messages: useSessionMessages }; }`);
		expect(await buildPlugin(dir, "src/index.tsx")).toEqual({ ok: true });
		const sessionPrompt = vi.fn(),
			legacyPrompt = vi.fn(),
			messages = vi.fn();
		vi.stubGlobal("window", {
			DroneUI: {
				version: 1,
				components: {},
				helpers: {},
				stores: {},
				i18n: {},
				hooks: { useSessionMessages: messages },
				knowledge: { prompt: legacyPrompt },
				sessions: { prompt: sessionPrompt },
			},
		});
		try {
			const out = await readFile(join(dir, "dist/index.js"), "utf8");
			const plugin = await import(`data:text/javascript;base64,${Buffer.from(out).toString("base64")}`);
			expect(plugin.bindings()).toEqual({ sessionPrompt, legacyPrompt, messages });
		} finally {
			vi.unstubAllGlobals();
		}
	});
	it("引用 react 的 tsx 构建成功，产物无裸导入（已重写为 window.DroneUI shim）", async () => {
		const dir = await makePlugin(`
import { useState } from "react";
import { Button, useT } from "@gyoungwe/plugin-api";

export function ToolCallCard({ tool }: { tool: { name: string } }) {
	const [n, setN] = useState(0);
	const t = useT();
	return <Button onClick={() => setN(n + 1)}>{t("message.thinking")}{tool.name}{n}</Button>;
}
`);
		const res = await buildPlugin(dir, "src/index.tsx");
		expect(res).toEqual({ ok: true });
		const out = await readFile(join(dir, "dist/index.js"), "utf-8");
		// 产物是自包含 ESM：无 require、无任何裸 import（react/plugin-api 已被重写成 shim）
		expect(out).not.toContain("require(");
		expect(out).not.toContain('from "react"');
		expect(out).not.toContain('from "@gyoungwe/plugin-api"');
		// shim 确实以 window.DroneUI 为源；JSX 经 automatic runtime → 被重写的 jsx-runtime
		expect(out).toContain("window.DroneUI");
		expect(out).toContain("window.DroneUI.jsxRuntime");
	});

	it("jsx automatic 产物使用被重写的 jsx-runtime（无 react/jsx-runtime 裸导入）", async () => {
		const dir = await makePlugin(`
export function Card() { return <div className="x">hi</div>; }
`);
		const res = await buildPlugin(dir, "src/index.tsx");
		expect(res).toEqual({ ok: true });
		const out = await readFile(join(dir, "dist/index.js"), "utf-8");
		expect(out).not.toContain('from "react/jsx-runtime"');
		expect(out).toContain("window.DroneUI.jsxRuntime");
	});

	it("图片资产经 dataurl loader 内联（data:image/png;base64 进产物）", async () => {
		// 1x1 透明 png
		const pngB64 =
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
		const dir = await makePlugin(`
import iconUrl from "./assets/icon.png";
export function Card() { return <img src={iconUrl} alt="" />; }
`);
		await mkdir(join(dir, "src/assets"), { recursive: true });
		await writeFile(join(dir, "src/assets/icon.png"), Buffer.from(pngB64, "base64"));
		const res = await buildPlugin(dir, "src/index.tsx");
		expect(res).toEqual({ ok: true });
		const out = await readFile(join(dir, "dist/index.js"), "utf-8");
		expect(out).toContain("data:image/png;base64,");
		expect(out).toContain(pngB64);
	});

	it("语法错误返回首条错误 text+location 单行字符串，不产出 dist", async () => {
		const dir = await makePlugin(`
export function Card() { return <div>未闭合
`);
		const res = await buildPlugin(dir, "src/index.tsx");
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toContain("src/index.tsx");
			expect(res.error).not.toContain("\n");
		}
		// 构建失败不应留下 dist 产物
		await expect(readFile(join(dir, "dist/index.js"), "utf-8")).rejects.toThrow();
	});
});
