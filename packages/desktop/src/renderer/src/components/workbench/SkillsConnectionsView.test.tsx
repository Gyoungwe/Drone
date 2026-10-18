// @vitest-environment jsdom

import type { KnowledgeCloudStatus, ZoteroStatus } from "@drone/shared";
import { describe, expect, it } from "vitest";
import { cloudCapabilityStatus, mcpCapabilityStatus, zoteroCapabilityStatus } from "./SkillsConnectionsView";

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

	it("does not claim Zotero is available from registration alone", () => {
		expect(zoteroCapabilityStatus(zotero({ localApiReachable: true }))).toBe("running");
		expect(zoteroCapabilityStatus(zotero())).toBe("stale");
		expect(zoteroCapabilityStatus(zotero({ enabled: false }))).toBe("configure");
		expect(zoteroCapabilityStatus(null)).toBe("configure");
	});
});
