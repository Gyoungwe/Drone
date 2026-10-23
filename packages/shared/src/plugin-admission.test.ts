import { describe, expect, it } from "vitest";
import { assessPluginAdmission } from "./plugin-admission";

const accepted = {
	name: "@example/field-tools",
	version: "1.2.3",
	registry: "https://registry.npmjs.org",
	integrity: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
	manifestDeclared: true,
	hosts: ["native-pi", "drone-desktop"],
	packageKind: "pi" as const,
	source: "npm" as const,
};

describe("third-party plugin admission", () => {
	it("accepts an integrity-pinned npm package and classifies it as community", () => {
		expect(assessPluginAdmission(accepted, { host: "drone-desktop" })).toEqual({
			status: "accepted",
			origin: "community",
			code: "accepted",
			message: "Package source is admissible",
		});
	});

	it("accepts a first-party package only after the same source checks", () => {
		const result = assessPluginAdmission({ ...accepted, name: "@gyoungwe/example" });
		expect(result.origin).toBe("official");
		expect(result.status).toBe("accepted");
	});

	it.each([
		["registry-not-allowed", { registry: "https://evil.example" }],
		["integrity-missing", { integrity: undefined }],
		["integrity-invalid", { integrity: "sha512-no spaces" }],
		["host-unsupported", { hosts: ["native-pi"] }],
	] as const)("blocks %s before install", (code, patch) => {
		expect(assessPluginAdmission({ ...accepted, ...patch }, { host: "drone-desktop" })).toMatchObject({
			status: "blocked",
			code,
		});
	});

	it("allows generic L0 packages but blocks untyped UI packages", () => {
		expect(assessPluginAdmission({ ...accepted, manifestDeclared: false })).toMatchObject({
			status: "accepted",
		});
		expect(
			assessPluginAdmission({ ...accepted, packageKind: "desktop-ui", manifestDeclared: false }),
		).toMatchObject({ status: "blocked", code: "manifest-missing" });
	});

	it("keeps local development explicit and blocks git sources", () => {
		expect(
			assessPluginAdmission({ ...accepted, source: "path", registry: undefined, integrity: undefined }),
		).toMatchObject({
			status: "accepted",
			origin: "local",
		});
		expect(assessPluginAdmission({ ...accepted, source: "git" })).toMatchObject({
			status: "blocked",
			code: "unsupported-source",
		});
	});
});
