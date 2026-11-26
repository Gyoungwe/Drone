import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

function stubBrowser(saved: string | null, locale: string) {
	const store = new Map<string, string>(saved ? [["pi-desktop.lang", saved]] : []);
	const saveUiState = vi.fn(async (_state: unknown) => undefined);
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
	});
	vi.stubGlobal("navigator", { language: locale });
	vi.stubGlobal("window", { pi: { saveUiState } });
	return saveUiState;
}

describe("UI language → host (reply language)", () => {
	it("pushes the detected language on startup and every switch", async () => {
		const saveUiState = stubBrowser(null, "zh-CN");
		const { useI18nStore } = await import("./index");
		expect(saveUiState).toHaveBeenCalledWith({ language: "zh" });
		useI18nStore.getState().setLanguage("en");
		expect(saveUiState).toHaveBeenLastCalledWith({ language: "en" });
	});

	it("prefers the saved choice and tolerates a host without the IPC", async () => {
		const saveUiState = stubBrowser("en", "zh-CN");
		await import("./index");
		expect(saveUiState).toHaveBeenCalledWith({ language: "en" });
		vi.resetModules();
		vi.stubGlobal("window", {});
		const { syncLanguageToHost } = await import("./index");
		expect(() => syncLanguageToHost("zh")).not.toThrow();
	});
});

describe("zh dictionary", () => {
	it("translates the run/inspector labels that used to stay English", async () => {
		stubBrowser(null, "zh-CN");
		const { zh } = await import("./zh");
		expect(zh.message.working).toBe("处理中");
		expect(zh.message.thinkingLabel).toBe("思考中");
		expect(zh.message.worked).toBe("已完成");
		const flat = JSON.stringify(zh);
		for (const english of [
			'"Working"',
			'"Worked"',
			'"Thinking"',
			'"Tools & Skills"',
			'"Active tools"',
			'"Lazy"',
		])
			expect(flat).not.toContain(english);
	});
});

it("ships matching package lifecycle labels in English and Chinese", async () => {
	const { en } = await import("./en");
	const { zh } = await import("./zh");
	const english = en.settings.extensions;
	const chinese = zh.settings.extensions;
	expect(Object.keys(chinese.lifecycleStages)).toEqual(Object.keys(english.lifecycleStages));
	expect(Object.keys(chinese.lifecycleErrors)).toEqual(Object.keys(english.lifecycleErrors));
	expect(english.effectiveRestart).toBe(en.skillsConnections.effectiveRestart);
	expect(chinese.effectiveRestart).toBe(zh.skillsConnections.effectiveRestart);
	expect(chinese.effectiveRestart).not.toBe(english.effectiveRestart);
	expect(en.skillsConnections.currentSessionVersion).toContain("{version}");
	expect(zh.skillsConnections.nextSessionVersion).toContain("{version}");
});
