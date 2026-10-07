import { describe, expect, it } from "vitest";
import { createAntigravityProvider } from "../src/session-engine/antigravity/provider";
import { ANTIGRAVITY_PROVIDER_ID } from "../src/session-engine/antigravity/types";

describe("Antigravity provider", () => {
	it("is an independent OAuth provider", () => {
		const provider = createAntigravityProvider();
		expect(provider.id).toBe(ANTIGRAVITY_PROVIDER_ID);
		expect(provider.auth.oauth?.loginLabel).toContain("Antigravity");
		expect(provider.getModels().length).toBeGreaterThan(0);
	});
});
