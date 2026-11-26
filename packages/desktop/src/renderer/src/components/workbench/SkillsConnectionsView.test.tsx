// @vitest-environment jsdom

import type {
	KnowledgeCloudStatus,
	McpStatus,
	PackageLifecycleReceipt,
	PiApi,
	ResearchConnectorDescriptor,
	ZoteroStatus,
} from "@drone/shared";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useI18nStore } from "../../i18n";
import { useCatalogStore } from "../../stores/catalog";
import { useSettingsStore } from "../../stores/settings";
import { useUiPluginsStore } from "../../stores/ui-plugins";
import {
	capabilitySectionKind,
	cloudCapabilityStatus,
	connectorCatalogEntries,
	mcpCapabilityStatus,
	SkillsConnectionsView,
	skillSource,
	zoteroCapabilityStatus,
} from "./SkillsConnectionsView";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	useCatalogStore.setState(useCatalogStore.getInitialState());
});

const cloud = (mode: KnowledgeCloudStatus["mode"]): KnowledgeCloudStatus => ({
	configured: true,
	passwordSource: "saved",
	endpoint: "https://dav.example.test",
	folder: "notes",
	mode,
	reachable: mode === "ready",
	authenticated: mode === "ready",
	initialized: mode === "ready",
	writable: mode === "ready" ? true : null,
	lastCheckedAt: null,
	message: null,
	warnings: [],
});

const zotero = (overrides: Partial<ZoteroStatus> = {}): ZoteroStatus => ({
	registered: true,
	enabled: true,
	command: "/usr/local/bin/zotero-mcp",
	localApiReachable: false,
	desktopDetected: true,
	desktopPath: "/Applications/Zotero.app",
	docsUrl: "https://www.zotero.org",
	downloadUrl: "https://www.zotero.org/download",
	...overrides,
});

function mcpStatus(disabled: boolean): McpStatus {
	return {
		version: 1,
		servers: [{ name: "Zotero", status: disabled ? "disabled" : "connected", toolCount: 1, disabled }],
		totalTools: 1,
		totalResources: 0,
		connectedCount: disabled ? 0 : 1,
		disabledCount: disabled ? 1 : 0,
	};
}

function installRowBridge() {
	const connector: ResearchConnectorDescriptor = {
		id: "zotero",
		label: "Zotero",
		kind: "citation",
		enabled: false,
	};
	let finishToggle: () => void = () => {
		throw new Error("Toggle promise not initialized");
	};
	const pending = new Promise<void>((resolve) => {
		finishToggle = resolve;
	});
	const bridge = {
		searchCatalog: vi.fn(async () => ({ packages: [], total: 0, page: 1, pageSize: 20 })),
		listConfiguredPackages: vi.fn<PiApi["listConfiguredPackages"]>().mockResolvedValue([]),
		getMcpStatus: vi
			.fn<PiApi["getMcpStatus"]>()
			.mockResolvedValueOnce(mcpStatus(true))
			.mockResolvedValue(mcpStatus(false)),
		setMcpServerEnabled: vi.fn<PiApi["setMcpServerEnabled"]>(async () => {
			await pending;
			return { path: "", cwd: null, servers: [] };
		}),
		getZoteroStatus: vi.fn(async () => zotero({ localApiReachable: true })),
		getZoteroLocalWrite: vi.fn<PiApi["getZoteroLocalWrite"]>().mockRejectedValue(new Error("Unavailable")),
		getInstitutionalStatus: vi
			.fn<PiApi["getInstitutionalStatus"]>()
			.mockRejectedValue(new Error("Unavailable")),
		onMcpEvent: vi.fn(() => vi.fn()),
		listConnectors: vi.fn(async () => ({ connectors: [connector] })),
		setConnectorEnabled: vi.fn<PiApi["setConnectorEnabled"]>(async ({ enabled }) => {
			await pending;
			return { ...connector, enabled };
		}),
	} satisfies Partial<PiApi>;
	vi.stubGlobal("pi", bridge);
	return { bridge, finishToggle };
}

const restartReceipt: PackageLifecycleReceipt = {
	operation: "update",
	packageName: "@gyoungwe/pi-connectors",
	source: "npm:@gyoungwe/pi-connectors",
	scope: "project",
	status: "succeeded",
	effect: "app-restart",
	version: "2.0.0",
	events: [
		{ type: "staged", at: 1, detail: "private /fixture/staged" },
		{ type: "verified", at: 2 },
		{ type: "drained", at: 3, sessionId: "private-session" },
		{ type: "enabled", at: 4 },
	],
};

it("finds the project outcome after a pinned-source refresh and localizes its bounded steps", async () => {
	vi.stubGlobal("React", React);
	useI18nStore.setState({ language: "en" });
	vi.spyOn(useSettingsStore.getState(), "refresh").mockResolvedValue(undefined);
	vi.spyOn(useUiPluginsStore.getState(), "loadAll").mockResolvedValue(undefined);
	const { bridge } = installRowBridge();
	const catalog = useCatalogStore.getState();
	useCatalogStore.setState({ catalogType: "extension" });
	catalog.recordLifecycleReceipt(restartReceipt);
	catalog.recordLifecycleReceipt({
		...restartReceipt,
		scope: "user",
		effect: "current-session",
		events: [{ type: "enabled", at: 10 }],
	});
	bridge.listConfiguredPackages.mockResolvedValue([
		{ source: "npm:@gyoungwe/pi-connectors@2.0.0", scope: "project" },
	]);
	await catalog.refreshConfiguredPackages();
	render(<SkillsConnectionsView />);
	const label = within(screen.getByTestId("plugins-card")).getByText(restartReceipt.packageName);
	const row = label.closest("li");
	if (!row) throw new Error("Package row is missing");
	const item = within(row);
	expect(item.getByText("Applies after app restart")).toBeTruthy();
	const details = item.getByText("Lifecycle details").closest("details");
	if (!details) throw new Error("Lifecycle details are missing");
	details.open = true;
	expect(
		within(details)
			.getAllByRole("listitem")
			.map(({ textContent }) => textContent),
	).toEqual(["Package staged", "Package verified", "Previous worker stopped", "Selection activated"]);
	act(() => useI18nStore.setState({ language: "zh" }));
	expect(item.getByText("重启应用后生效")).toBeTruthy();
	expect(
		within(details)
			.getAllByRole("listitem")
			.map(({ textContent }) => textContent),
	).toEqual(["插件包已暂存", "插件包已验证", "原工作进程已停止", "已启用选定版本"]);
	expect(row.outerHTML).not.toMatch(/private-session|private \/fixture/);
});

it.each([
	["Connectors", "connector-catalog"],
	["MCP", "mcp-servers"],
] as const)("preserves disabled, pending and settled row states in %s", async (section, testId) => {
	vi.stubGlobal("React", React);
	useI18nStore.setState({ language: "en" });
	vi.spyOn(useSettingsStore.getState(), "refresh").mockResolvedValue(undefined);
	vi.spyOn(useUiPluginsStore.getState(), "loadAll").mockResolvedValue(undefined);
	const { bridge, finishToggle } = installRowBridge();
	render(<SkillsConnectionsView />);
	fireEvent.click(screen.getByRole("button", { name: section }));
	const panel = within(screen.getByTestId(testId));
	const toggle = await panel.findByRole("switch", { name: "Enable" });
	expect(panel.getByText("Zotero")).toBeTruthy();
	expect(panel.getByText("Disabled")).toBeTruthy();
	expect(toggle.getAttribute("aria-checked")).toBe("false");
	expect(toggle).toHaveProperty("disabled", false);
	expect(panel.getByRole("button", { name: "View" })).toHaveProperty("disabled", false);

	fireEvent.click(toggle);
	expect(toggle).toHaveProperty("disabled", true);
	expect(toggle.getAttribute("aria-checked")).toBe("false");
	expect(panel.getByText("Disabled")).toBeTruthy();
	if (section === "Connectors") {
		expect(bridge.setConnectorEnabled).toHaveBeenCalledExactlyOnceWith({ id: "zotero", enabled: true });
	} else {
		expect(bridge.setMcpServerEnabled).toHaveBeenCalledExactlyOnceWith("Zotero", true, undefined);
	}

	finishToggle();
	await waitFor(() => {
		const settledToggle = panel.getByRole("switch", { name: "Disable" });
		expect(settledToggle.getAttribute("aria-checked")).toBe("true");
		expect(settledToggle).toHaveProperty("disabled", false);
		expect(panel.getByText("Running")).toBeTruthy();
	});
});

describe("SkillsConnectionsView capability state", () => {
	it("maps MCP runtime evidence to user-facing states", () => {
		expect(mcpCapabilityStatus("connected", true)).toBe("running");
		expect(mcpCapabilityStatus("failed", true)).toBe("error");
		expect(mcpCapabilityStatus("needs-auth", true)).toBe("permission");
		expect(mcpCapabilityStatus("connected", false)).toBe("disabled");
		expect(mcpCapabilityStatus("not-connected", true)).toBe("configure");
	});

	it("preserves WebDAV read-only and offline evidence", () => {
		expect(cloudCapabilityStatus(cloud("ready"))).toBe("available");
		expect(cloudCapabilityStatus(cloud("read-only"))).toBe("permission");
		expect(cloudCapabilityStatus(cloud("offline"))).toBe("stale");
		expect(cloudCapabilityStatus(null)).toBe("configure");
	});

	it("uses the built-in Zotero probe instead of MCP registration state", () => {
		expect(zoteroCapabilityStatus(zotero({ localApiReachable: true }))).toBe("running");
		expect(zoteroCapabilityStatus(zotero({ localApiReachable: true }), false)).toBe("disabled");
		expect(zoteroCapabilityStatus(zotero())).toBe("stale");
		expect(zoteroCapabilityStatus(zotero({ desktopDetected: false }))).toBe("configure");
		expect(zoteroCapabilityStatus(null)).toBe("configure");
	});

	it("resolves bundled research skills to their GitHub source without a product commit pin", () => {
		const resolved = skillSource("nature-citation", "local", "user");
		expect(resolved.key).toContain("github:Yuan1z0825/nature-skills");
		expect(resolved.repository?.url).toBe("https://github.com/Yuan1z0825/nature-skills");
		expect(resolved.profile?.path).toBe("skills/nature-citation/SKILL.md");
		expect(resolved.repository).not.toHaveProperty("commit");
	});

	it("keeps the page sections separate and has no mixed all view", () => {
		expect(capabilitySectionKind("market")).toBeNull();
		expect(capabilitySectionKind("skills")).toBeNull();
		expect(capabilitySectionKind("connectors")).toBe("connector");
		expect(capabilitySectionKind("mcp")).toBe("mcp");
	});

	it("keeps Zotero in its combined status row instead of duplicating the catalog entry", () => {
		const descriptors = [
			{ id: "zotero", kind: "citation", label: "Zotero", enabled: true },
			{ id: "crossref", kind: "literature", label: "Crossref", enabled: true },
			{ id: "institutional", kind: "institutional", label: "Institutional access", enabled: true },
		] as const;
		expect(connectorCatalogEntries(descriptors)).toEqual([descriptors[1]]);
	});

	it("leaves non-catalogue skills on the loader source", () => {
		expect(skillSource("my-local-skill", "local", "user").key).toBe("local");
	});
});
