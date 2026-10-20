// @vitest-environment jsdom

import type { KnowledgeCloudStatus, ZoteroStatus } from "@drone/shared";
import { describe, expect, it } from "vitest";
import {
	capabilitySectionKind,
	cloudCapabilityStatus,
	connectorCatalogEntries,
	mcpCapabilityStatus,
	skillSource,
	zoteroCapabilityStatus,
} from "./SkillsConnectionsView";

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
