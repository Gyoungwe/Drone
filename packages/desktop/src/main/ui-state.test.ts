import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));

const { normalizeUiState } = await import("./ui-state");

describe("ui-state language", () => {
	it("keeps a valid UI language so the backend reply rule survives restarts", () => {
		expect(normalizeUiState({ language: "zh" }).language).toBe("zh");
		expect(normalizeUiState({ language: "en" }).language).toBe("en");
	});

	it("drops unknown values instead of persisting them", () => {
		expect(normalizeUiState({ language: "fr" as never })).not.toHaveProperty("language");
		expect(normalizeUiState({})).not.toHaveProperty("language");
	});

	it("a language-only patch merged onto older state keeps the other fields", () => {
		const merged = normalizeUiState({
			...normalizeUiState({ theme: "dark" }),
			...{ language: "zh" as const },
		});
		expect(merged).toMatchObject({ theme: "dark", language: "zh", thinkingLevel: "medium" });
	});
});
