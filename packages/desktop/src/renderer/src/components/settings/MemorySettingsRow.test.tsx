import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ComposerStatusView } from "../composer/ComposerStatusBar";
import { MemorySettingsView } from "./MemorySettingsRow";

vi.mock("../../i18n", () => ({
	useT: () => (key: string, params?: Record<string, unknown>) =>
		params ? `${key}:${Object.values(params).join(",")}` : key,
}));
vi.stubGlobal("React", React);

const view = (status: { enabled: boolean; count: number; lastLoaded: number } | null) =>
	renderToStaticMarkup(createElement(MemorySettingsView, { status, onToggle: vi.fn(), onClear: vi.fn() }));

it("shows the per-project count and disables clear when empty", () => {
	expect(view({ enabled: true, count: 12, lastLoaded: 3 })).toContain("settings.memory.hint:12");
	expect(view({ enabled: true, count: 0, lastLoaded: 0 })).toMatch(/<button[^>]*disabled/);
	expect(view(null)).toContain('aria-checked="false"');
});

it("status bar shows loaded memories only when some were injected", () => {
	const bar = (memory: string | null) =>
		renderToStaticMarkup(
			createElement(ComposerStatusView, { host: "本机", project: "p", dir: "~/p", memory }),
		);
	expect(bar("已载入 3 条记忆")).toContain("已载入 3 条记忆");
	expect(bar(null)).not.toContain("composer-status-memory");
});
