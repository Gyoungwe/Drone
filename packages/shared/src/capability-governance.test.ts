import { describe, expect, it } from "vitest";
import {
	assessCapabilityGovernance,
	CAPABILITY_GOVERNANCE_SCHEMA,
	CapabilityGovernanceCatalog,
	createCapabilityGovernanceManifest,
} from "./capability-governance";

const hash = "a".repeat(64);
const base = (overrides: Partial<Parameters<typeof createCapabilityGovernanceManifest>[0]> = {}) =>
	createCapabilityGovernanceManifest({
		id: "bulk-rnaseq@3.18.0",
		capabilityId: "analysis",
		name: "bulk RNA-seq",
		version: "3.18.0",
		source: { repository: "nf-core/rnaseq", commit: "abc1234", path: "main.nf", license: "MIT" },
		schema: { inputHash: hash, outputHash: hash },
		permissions: { filesystem: "read", network: "none", process: "sandbox", secrets: [] },
		resources: { cpus: 2, memoryBytes: 4_000_000_000, wallTimeSeconds: 3_600 },
		sideEffects: ["read"],
		environment: {
			readiness: "ready",
			requirements: ["nextflow>=23"],
			fingerprint: "host-fingerprint",
			observedAt: "2026-10-15T00:00:00.000Z",
		},
		createdAt: "2026-10-15T00:00:00.000Z",
		...overrides,
	});

describe("capability governance", () => {
	it("creates a versioned manifest and accepts a fully pinned environment", () => {
		const manifest = base();
		expect(manifest.manifestSchema).toBe(CAPABILITY_GOVERNANCE_SCHEMA);
		expect(assessCapabilityGovernance(manifest)).toMatchObject({
			status: "ready",
			canSubmit: true,
			findings: [],
		});
	});

	it("blocks unregistered, unknown-version and unready capabilities", () => {
		const manifest = base({
			registered: false,
			version: "",
			environment: { readiness: "unknown", requirements: [] },
		});
		const assessment = assessCapabilityGovernance(manifest);
		expect(assessment.canSubmit).toBe(false);
		expect(assessment.findings.map((finding) => finding.code)).toEqual(
			expect.arrayContaining(["unregistered", "unknown-version", "environment-not-ready"]),
		);
	});

	it("requires source provenance and schema hashes", () => {
		const manifest = base({
			source: { repository: "", commit: "", path: "", license: "" },
			schema: { inputHash: "bad", outputHash: "bad" },
		});
		const codes = assessCapabilityGovernance(manifest).findings.map((finding) => finding.code);
		expect(codes).toEqual(expect.arrayContaining(["missing-provenance", "missing-schema"]));
	});

	it("rejects tampered manifests and self-asserted readiness", () => {
		const manifest = base();
		const tampered = { ...manifest, source: { ...manifest.source, commit: "changed" } };
		expect(assessCapabilityGovernance(tampered).findings.map((finding) => finding.code)).toContain(
			"invalid-contract",
		);
		const withoutProbe = base({ environment: { readiness: "ready", requirements: [] } });
		expect(assessCapabilityGovernance(withoutProbe).findings.map((finding) => finding.code)).toContain(
			"environment-not-ready",
		);
	});

	it("rejects malformed prerelease identifiers", () => {
		for (const version of ["1.2.3-01", "1.2.3-alpha..1"]) {
			const assessment = assessCapabilityGovernance(base({ version }));
			expect(assessment.findings.map((finding) => finding.code)).toContain("unknown-version");
		}
	});

	it("catalogs manifests and fails closed for unknown ids or duplicate ids", () => {
		const catalog = new CapabilityGovernanceCatalog();
		catalog.register(base());
		expect(catalog.assess("missing").findings[0]?.code).toBe("unregistered");
		expect(() => catalog.register(base())).toThrow(/already registered/);
		catalog.assertReady("bulk-rnaseq@3.18.0");
	});
});
