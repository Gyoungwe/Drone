import assert from "node:assert/strict";
import test from "node:test";
import {
	analysisAdapterSnapshotSha256,
	compareHostVersions,
	createAnalysisContext,
	createPermissionedHostPort,
	negotiateCapabilities,
} from "../dist/index.js";

const host = {
	host: "drone-desktop",
	hostVersion: "0.33.0",
	pluginApiVersion: 1,
	piApiVersion: 1,
	capabilities: ["readSource", "searchKnowledge"],
};

test("accepts a plugin when host and declared capabilities match", () => {
	assert.deepEqual(
		negotiateCapabilities(
			{ pluginApi: 1, minHostVersion: "0.31.0", hosts: ["drone-desktop"], capabilities: ["readSource"] },
			host,
		),
		{ status: "compatible", host: "drone-desktop", pluginApi: 1, missingCapabilities: [] },
	);
});

test("refuses an incompatible host without partial loading", () => {
	const result = negotiateCapabilities(
		{ pluginApi: 1, hosts: ["native-pi"], capabilities: ["runCompute"] },
		host,
	);
	assert.equal(result.status, "incompatible");
	assert.equal(result.reason, "host");
});

test("refuses an older host and reports missing capabilities", () => {
	const oldHost = { ...host, hostVersion: "0.30.0" };
	assert.equal(
		negotiateCapabilities({ pluginApi: 1, minHostVersion: "0.31.0" }, oldHost).reason,
		"host-version",
	);
	const missing = negotiateCapabilities({ pluginApi: 1, capabilities: ["runCompute"] }, host);
	assert.equal(missing.reason, "capability");
	assert.deepEqual(missing.missingCapabilities, ["runCompute"]);
});

test("compares host versions by numeric major/minor/patch components", () => {
	assert.equal(compareHostVersions("v1.1.0", "1.1.0-beta.1"), 0);
	assert.equal(compareHostVersions("1.2.0", "1.1.9"), 1);
	assert.equal(compareHostVersions("1.0.9", "1.1.0"), -1);
});

test("keeps analysis contracts deterministic and host-neutral", () => {
	const adapter = {
		identity: { id: "assembly", version: "1.0.0" },
		contract: {
			schemaVersion: 1,
			assay: "assembly",
			domain: "genomics",
			researchStages: ["design", "readiness"],
			inputs: [{ id: "reads", type: "file", required: true }],
			outputs: [{ id: "contigs", type: "file", required: true }],
			capabilities: ["analysis"],
			sideEffects: ["read-only"],
			evidenceTypes: ["assembly-fasta"],
		},
	};
	const first = analysisAdapterSnapshotSha256(adapter);
	const second = analysisAdapterSnapshotSha256({
		identity: { ...adapter.identity },
		contract: { ...adapter.contract },
	});
	assert.match(first, /^[a-f0-9]{64}$/);
	assert.equal(first, second);
	assert.deepEqual(
		createAnalysisContext({
			id: "assembly-1",
			question: "Assemble reads",
			assay: "assembly",
			mode: "exploratory",
			adapter: adapter.identity,
		}),
		{
			version: 1,
			id: "assembly-1",
			question: "Assemble reads",
			assay: "assembly",
			mode: "exploratory",
			adapter: { id: "assembly", version: "1.0.0" },
		},
	);
	assert.throws(
		() =>
			createAnalysisContext({
				id: "../unsafe",
				question: "x",
				assay: "assembly",
				mode: "exploratory",
				adapter: adapter.identity,
			}),
		/unsafe/,
	);
});

test("permissioned host denies undeclared side effects and records a redacted audit event", async () => {
	const audit = [];
	const host = createPermissionedHostPort(
		{
			host: "native-pi",
			capabilities: () => ({ capabilities: ["requestAuthorization"] }),
			requestAuthorization: async () => ({ granted: true, decidedAt: "2026-10-24T00:00:00.000Z" }),
		},
		{
			pluginId: "drone-fixture",
			permissions: { filesystem: ["workspace-read"], network: [], subprocess: [], externalWrites: false },
			audit: (event) => audit.push(event),
		},
	);
	const receipt = await host.requestAuthorization({ action: "external-write", reason: "write a record" });
	assert.equal(receipt.granted, false);
	assert.match(receipt.reason, /did not declare permission/);
	assert.equal(audit.length, 1);
	assert.deepEqual(
		{ ...audit[0], at: "fixed" },
		{
			pluginId: "drone-fixture",
			operation: "external-write",
			action: "external-write",
			granted: false,
			at: "fixed",
			reason: "Plugin drone-fixture did not declare permission for external-write",
		},
	);
});

test("permissioned host delegates declared side effects and audits the host decision", async () => {
	const audit = [];
	const host = createPermissionedHostPort(
		{
			host: "drone-desktop",
			capabilities: () => ({ capabilities: ["requestAuthorization"] }),
			requestAuthorization: async () => ({
				granted: true,
				authorizationRef: "auth:fixture",
				decidedAt: "2026-10-24T00:00:00.000Z",
			}),
		},
		{
			pluginId: "drone-fixture",
			permissions: { filesystem: ["workspace"], network: [], subprocess: [], externalWrites: true },
			audit: (event) => audit.push(event),
		},
	);
	const receipt = await host.requestAuthorization({ action: "write", scope: "workspace" });
	assert.equal(receipt.authorizationRef, "auth:fixture");
	assert.equal(audit[0].operation, "external-write");
	assert.equal(audit[0].granted, true);
});

test("application state declaration does not authorize generic file access", async () => {
	let approvals = 0;
	const host = createPermissionedHostPort(
		{
			host: "drone-desktop",
			capabilities: () => ({ capabilities: ["requestAuthorization"] }),
			requestAuthorization: async () => {
				approvals++;
				return { granted: true, decidedAt: "2026-10-26T00:00:00.000Z" };
			},
		},
		{
			pluginId: "state-fixture",
			permissions: { filesystem: ["application-state"], network: [], subprocess: [], externalWrites: false },
		},
	);
	for (const action of ["filesystem-read", "filesystem-write"]) {
		assert.equal((await host.requestAuthorization({ action, scope: "workspace" })).granted, false);
	}
	assert.equal(approvals, 0);
});

test("configured-vault-write declares host-mediated Vault file writes", async () => {
	const host = createPermissionedHostPort(
		{
			host: "drone-desktop",
			capabilities: () => ({ capabilities: ["requestAuthorization"] }),
			requestAuthorization: async () => ({ granted: true, decidedAt: "2026-10-26T00:00:00.000Z" }),
		},
		{
			pluginId: "vault-fixture",
			permissions: {
				filesystem: ["configured-vault-write"],
				network: [],
				subprocess: [],
				externalWrites: false,
			},
		},
	);
	assert.equal(
		(await host.requestAuthorization({ action: "filesystem-write", scope: "configured-vault" })).granted,
		true,
	);
	assert.equal(
		(await host.requestAuthorization({ action: "filesystem-read", scope: "configured-vault" })).granted,
		true,
	);
	assert.equal(
		(await host.requestAuthorization({ action: "external-write", scope: "configured-vault" })).granted,
		false,
	);
});
