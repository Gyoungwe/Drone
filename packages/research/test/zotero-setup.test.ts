import { describe, expect, it } from "vitest";
import {
	mergeZoteroMcpConfig,
	readZoteroMcpConfig,
	remainingZoteroSetupSteps,
	ZOTERO_SETUP_BINDING,
	zoteroMcpSpec,
} from "../src/zotero-setup";

describe("zotero setup policy", () => {
	it("projects registration without exposing or changing credentials", () => {
		const config = {
			mcpServers: {
				other: { command: "keep" },
				zotero: { command: "old", disabled: true, env: { ZOTERO_API_KEY: "fixture-secret" } },
			},
		};
		expect(readZoteroMcpConfig(config)).toEqual({ registered: true, disabled: true, command: "old" });
		expect(mergeZoteroMcpConfig(config, "new")).toEqual({
			mcpServers: {
				other: { command: "keep" },
				zotero: {
					command: "old",
					env: {
						ZOTERO_LOCAL: "true",
						ZOTERO_LIBRARY_TYPE: "user",
						ZOTERO_MCP_TOOLSETS: "none",
						ZOTERO_API_KEY: "fixture-secret",
					},
					description: expect.any(String),
					timeout: 120,
					toolExposure: {
						zotero_delete_item: "hidden",
						zotero_delete_collection: "hidden",
						zotero_delete_annotation: "hidden",
					},
					// Legacy `disabled: true` (ignored by pi-mcp-adapter) keeps its intent as `enabled: false`.
					enabled: false,
				},
			},
		});
		expect(config.mcpServers.zotero.command).toBe("old");
		expect(JSON.stringify(zoteroMcpSpec("zotero-mcp"))).not.toContain("fixture-secret");
	});

	it("reads the Pi `enabled` field and keeps legacy `disabled` as intent", () => {
		const read = (zotero: Record<string, unknown>) =>
			readZoteroMcpConfig({ mcpServers: { zotero } }).disabled;
		expect(read({ command: "z", enabled: false })).toBe(true);
		expect(read({ command: "z", disabled: true })).toBe(true);
		expect(read({ command: "z" })).toBe(false);
		expect(read({ command: "z", enabled: true })).toBe(false);
	});

	it("supports the legacy mcp-servers key and explicit enable", () => {
		const result = mergeZoteroMcpConfig({ "mcp-servers": {} }, " /usr/bin/zotero-mcp ", { enable: true });
		expect(result["mcp-servers"]).toMatchObject({
			zotero: {
				command: "/usr/bin/zotero-mcp",
				args: ["serve"],
				env: { ZOTERO_LOCAL: "true", ZOTERO_LIBRARY_TYPE: "user", ZOTERO_MCP_TOOLSETS: "none" },
			},
		});
		const zotero = (result["mcp-servers"] as Record<string, Record<string, unknown>>).zotero;
		expect(zotero).not.toHaveProperty("enabled");
		expect(zotero).not.toHaveProperty("disabled");
	});

	it("never writes the adapter-ignored `disabled` field", () => {
		expect(zoteroMcpSpec("zotero-mcp")).toMatchObject({ enabled: false });
		expect(zoteroMcpSpec("zotero-mcp")).not.toHaveProperty("disabled");
		expect(zoteroMcpSpec("zotero-mcp", { enabled: true })).not.toHaveProperty("enabled");
	});

	it("upgrades a bare PATH command to the resolved absolute Windows path and fixes plural library types", () => {
		const result = mergeZoteroMcpConfig(
			{ mcpServers: { zotero: { command: "zotero-mcp", env: { ZOTERO_LIBRARY_TYPE: "groups" } } } },
			"C:\\Users\\Administrator\\.local\\bin\\zotero-mcp.exe",
		);
		const zotero = (result.mcpServers as Record<string, Record<string, any>>).zotero ?? {};
		expect(zotero.command).toBe("C:\\Users\\Administrator\\.local\\bin\\zotero-mcp.exe");
		expect(zotero.args).toEqual(["serve"]);
		expect(zotero.env.ZOTERO_LIBRARY_TYPE).toBe("group");
		// An enabled existing entry stays enabled.
		expect(zotero).not.toHaveProperty("enabled");
	});

	it("keeps a custom launcher and its arguments", () => {
		const result = mergeZoteroMcpConfig(
			{
				mcpServers: {
					zotero: {
						command: "uvx",
						args: ["--from", "zotero-mcp-server==0.14.0", "zotero-mcp", "serve"],
						enabled: false,
						toolExposure: { zotero_merge_duplicates: "hidden" },
					},
				},
			},
			"C:\\tools\\zotero-mcp.exe",
		);
		const zotero = (result.mcpServers as Record<string, Record<string, any>>).zotero ?? {};
		expect(zotero.command).toBe("uvx");
		expect(zotero.args).toEqual(["--from", "zotero-mcp-server==0.14.0", "zotero-mcp", "serve"]);
		expect(zotero.enabled).toBe(false);
		expect(zotero.toolExposure).toMatchObject({
			zotero_merge_duplicates: "hidden",
			zotero_delete_item: "hidden",
		});
	});

	it("computes setup steps from observed state only", () => {
		const steps = remainingZoteroSetupSteps({
			commands: { zoteroCli: null, zoteroMcp: null },
			localApi: { reachable: false },
			desktop: false,
		});
		expect(steps.map(({ id }) => id)).toEqual(["install-zotero-desktop", "enable-local-api", "install-cli"]);
		expect(ZOTERO_SETUP_BINDING.mcpServer).toBe("zotero");
	});
});
