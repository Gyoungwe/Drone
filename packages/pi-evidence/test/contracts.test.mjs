import assert from "node:assert/strict";
import test from "node:test";
import {
	artifactFromBytes,
	artifactManifestDigest,
	canonicalJson,
	capsuleDigest,
	createBranch,
	createCheckpoint,
	createEvidenceCapsule,
	createReplayReceipt,
	parseCapsule,
	provenanceDigest,
	validateArtifactManifest,
	validateCapsuleImport,
	verifyReplay,
	workflowDigest,
} from "../dist/index.mjs";

const input = artifactFromBytes({
	artifactId: "input-1",
	versionId: "input-1-v1",
	path: "inputs/readme.txt",
	bytes: "hello",
	role: "input",
	accessLevel: "public",
});
const output = artifactFromBytes({
	artifactId: "output-1",
	versionId: "output-1-v1",
	path: "outputs/result.txt",
	bytes: "result",
	role: "output",
	accessLevel: "public",
});
const checkpoint = createCheckpoint({
	analysis: {
		version: 1,
		id: "analysis-1",
		question: "Can it replay?",
		assay: "fixture",
		mode: "exploratory",
	},
	files: [
		{ artifact: input, kind: "input" },
		{ artifact: output, kind: "output" },
	],
	createdAt: "2026-10-18T00:00:00.000Z",
	environmentFingerprint: "env-fixture-v1",
});

test("manifest and checkpoint digests are deterministic", () => {
	const manifest = { version: 1, entries: [input, output] };
	assert.equal(validateArtifactManifest(manifest, { requireIdentity: true }).valid, true);
	assert.equal(
		artifactManifestDigest(manifest),
		artifactManifestDigest({ version: 1, entries: [output, input] }),
	);
	assert.equal(checkpoint.id.length, 64);
	assert.equal(workflowDigest({ z: 1, a: 2 }), workflowDigest({ a: 2, z: 1 }));
	assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}\n');
});

test("capsule round trip and private path rejection are fail closed", () => {
	const capsule = createEvidenceCapsule(
		checkpoint,
		{ [input.sha256]: new TextEncoder().encode("hello"), [output.sha256]: "cmVzdWx0" },
		"public",
	);
	assert.equal(validateCapsuleImport(parseCapsule(JSON.stringify(capsule))).id, checkpoint.id);
	assert.equal(capsuleDigest(capsule).length, 64);
	const unsafe = validateArtifactManifest(
		[
			{
				artifactId: "secret",
				versionId: "secret-v1",
				path: "/Users/private/auth.json",
				bytes: 1,
				sha256: "0".repeat(64),
				role: "output",
				parentVersionIds: [],
			},
		],
		{ requireIdentity: true },
	);
	assert.equal(unsafe.valid, false);
});

test("branch is checkpoint-scoped and replay proof is read-only", () => {
	const branch = createBranch({ id: "retry-1", checkpoint, createdAt: "2026-10-18T00:01:00.000Z" });
	assert.equal(branch.checkpointId, checkpoint.id);
	assert.equal("workspace" in branch, false);
	const proof = verifyReplay(checkpoint, {
		environmentFingerprint: "env-fixture-v1",
		outputs: [{ path: output.path, bytes: output.bytes, sha256: output.sha256 }],
	});
	assert.equal(proof.status, "reproduced");
	const receipt = createReplayReceipt({
		id: "receipt-1",
		checkpoint,
		completedAt: "2026-10-18T00:02:00.000Z",
		environmentFingerprint: "env-fixture-v1",
		outputs: [{ path: output.path, bytes: output.bytes, sha256: output.sha256 }],
	});
	assert.equal(receipt.status, "reproduced");
});

test("provenance digest covers declared artifacts and method identity", () => {
	const provenance = {
		schemaVersion: 1,
		method: { id: "fixture", version: "1.0.0" },
		artifacts: [input],
	};
	assert.equal(provenanceDigest(provenance).length, 64);
});
