// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isPrimaryNavActive, WORKBENCH_NAV_ORDER } from "./WorkbenchNav";

describe("pluginized workbench navigation", () => {
	it("keeps the four primary entries before the project and recent groups", () => {
		expect(WORKBENCH_NAV_ORDER).toEqual(["newTask", "knowledge", "skills", "hosts"]);
	});

	it("keeps the four primary entries aligned with their real destination", () => {
		expect(
			isPrimaryNavActive("newTask", { view: "chat", settingsOpen: false, settingsCategory: "models" }),
		).toBe(true);
		expect(
			isPrimaryNavActive("knowledge", { view: "knowledge", settingsOpen: false, settingsCategory: "models" }),
		).toBe(true);
		expect(isPrimaryNavActive("skills", { view: "chat", settingsOpen: true, settingsCategory: "mcp" })).toBe(
			true,
		);
		expect(
			isPrimaryNavActive("hosts", { view: "chat", settingsOpen: true, settingsCategory: "compute" }),
		).toBe(true);
	});

	it("does not leave New task highlighted while a settings destination is open", () => {
		expect(
			isPrimaryNavActive("newTask", { view: "chat", settingsOpen: true, settingsCategory: "skills" }),
		).toBe(false);
		expect(
			isPrimaryNavActive("hosts", { view: "chat", settingsOpen: false, settingsCategory: "compute" }),
		).toBe(false);
	});
});
