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
					disabled: true,
					env: { ZOTERO_LOCAL: "true", ZOTERO_API_KEY: "fixture-secret" },
				},
			},
		});
		expect(config.mcpServers.zotero.command).toBe("old");
		expect(JSON.stringify(zoteroMcpSpec("zotero-mcp"))).not.toContain("fixture-secret");
	});

	it("supports the legacy mcp-servers key and explicit enable", () => {
		const result = mergeZoteroMcpConfig({ "mcp-servers": {} }, " /usr/bin/zotero-mcp ", { enable: true });
		expect(result["mcp-servers"]).toMatchObject({
			zotero: { command: "/usr/bin/zotero-mcp", disabled: false, env: { ZOTERO_LOCAL: "true" } },
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
