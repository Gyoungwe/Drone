import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stableJson } from "@drone/compute";
import { describe, expect, it, onTestFinished } from "vitest";
import { JsonStore } from "../src/json-store";
import { AnalysisEvidenceService, type FrozenFile } from "../src/services/analysis-evidence";
import { AnalysisOrchestrationService, emptyAnalysisLedger } from "../src/services/analysis-orchestration";
import {
	buildAttestationCapsule,
	type EvidenceAttestationCapsule,
	verifyAttestationCapsule,
} from "../src/services/evidence-attestation";
import { StorageRegistry } from "../src/storage/registry";

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const fixtureFiles = [
	["private-input.txt", "reads", "input", "private"],
	["restricted-script.py", "print('ok')", "code", "restricted"],
	["public-result.txt", "done", "output", "public"],
	["unclassified-review.txt", "review", "review", undefined],
] as const;

async function frozenFixture() {
	const root = await mkdtemp(join(tmpdir(), "drone-attestation-"));
	onTestFinished(() => rm(root, { recursive: true, force: true }));
	const analysis = new AnalysisOrchestrationService({
		store: new JsonStore({
			path: join(root, "runs.json"),
			storageId: "attestation-runs",
			defaultValue: emptyAnalysisLedger,
		}),
	});
	await analysis.create({
		id: "capsule-analysis-fixture",
		question: "Freeze this attestation fixture",
		assay: "assembly",
		mode: "exploratory",
	});
	await analysis.recordDesign("capsule-analysis-fixture");
	const evidence = new AnalysisEvidenceService({
		root: join(root, "evidence"),
		analysis,
		storage: new StorageRegistry(),
	});
	const source = join(root, "source");
	await mkdir(source);
	for (const [path, content] of fixtureFiles) await writeFile(join(source, path), content);
	const files: FrozenFile[] = fixtureFiles.map(([path, content, kind, accessLevel], index) => ({
		kind,
		artifact: {
			artifactId: `artifact-${index}`,
			versionId: `version-${index}`,
			path,
			sha256: sha256(content),
			bytes: Buffer.byteLength(content),
			role: kind,
			...(accessLevel ? { accessLevel } : {}),
			parentVersionIds: [],
		},
	}));
	const checkpoint = await evidence.freeze({
		analysisId: "capsule-analysis-fixture",
		sourceRoot: source,
		files,
	});
	return { root, evidence, checkpoint };
}

function jsonStrings(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(jsonStrings);
	if (value && typeof value === "object")
		return Object.entries(value).flatMap(([key, entry]) => [key, ...jsonStrings(entry)]);
	return [];
}

describe("evidence attestation exports", () => {
	it.each(["public", "restricted"] as const)(
		"exports %s with the exact metadata-free shape",
		async (audience) => {
			const { evidence, checkpoint } = await frozenFixture();
			const beforeExport = Date.now();
			const exported = await evidence.exportCapsule(checkpoint.id, audience);
			const bytes = await readFile(exported.path, "utf8");
			const capsule = JSON.parse(bytes) as EvidenceAttestationCapsule;
			expect(Object.keys(capsule).sort()).toEqual([
				"audience",
				"blobs",
				"checkpointId",
				"createdAt",
				"digest",
				"exportedAt",
				"files",
				"format",
				"schemaVersion",
			]);
			for (const file of capsule.files) expect(Object.keys(file).sort()).toEqual(["included", "sha256"]);
			const strings = jsonStrings(capsule);
			for (const forbidden of [
				...fixtureFiles.map(([path]) => path),
				checkpoint.analysis.id,
				checkpoint.analysis.assay,
			])
				expect(strings.some((value) => value.includes(forbidden))).toBe(false);
			expect(capsule.files).toEqual(
				[
					{ sha256: sha256("reads"), included: false },
					{ sha256: sha256("print('ok')"), included: audience === "restricted" },
					{ sha256: sha256("done"), included: true },
					{ sha256: sha256("review"), included: false },
				].sort((a, b) => a.sha256.localeCompare(b.sha256)),
			);
			expect(Object.keys(capsule.blobs).sort()).toEqual(
				(audience === "public" ? [sha256("done")] : [sha256("done"), sha256("print('ok')")]).sort(),
			);
			expect(capsule).toMatchObject({
				format: "drone-evidence-attestation",
				schemaVersion: 1,
				audience,
				checkpointId: checkpoint.id,
				createdAt: checkpoint.createdAt,
			});
			expect(Date.parse(capsule.exportedAt)).toBeGreaterThanOrEqual(beforeExport);
			expect(Date.parse(capsule.exportedAt)).toBeLessThanOrEqual(Date.now());
			expect(exported).toMatchObject({ audience, sha256: sha256(bytes) });
			expect(verifyAttestationCapsule(capsule)).toEqual(capsule);
		},
	);

	it.each(["public", "restricted"] as const)(
		"refuses to import %s attestations without writing",
		async (audience) => {
			const { root, evidence, checkpoint } = await frozenFixture();
			const exported = await evidence.exportCapsule(checkpoint.id, audience);
			const evidenceRoot = join(root, "evidence");
			const before = (await readdir(evidenceRoot, { recursive: true })).sort();
			const ledger = await readFile(join(evidenceRoot, "ledger.json"));
			await expect(evidence.importCapsule(exported.path)).rejects.toThrow(
				new Error("Attestation capsules are verify-only and cannot be imported"),
			);
			expect((await readdir(evidenceRoot, { recursive: true })).sort()).toEqual(before);
			expect(await readFile(join(evidenceRoot, "ledger.json"))).toEqual(ledger);
		},
	);
});

async function freshAttestation() {
	return buildAttestationCapsule(
		{
			id: sha256("checkpoint"),
			createdAt: "2026-11-16T00:00:00.000Z",
			files: [
				{ artifact: { sha256: sha256("public bytes"), accessLevel: "public" } },
				{ artifact: { sha256: sha256("private bytes"), accessLevel: "private" } },
			],
		},
		"public",
		"2026-11-16T01:00:00.000Z",
		async () => Buffer.from("public bytes"),
	);
}

const tamperingCases: readonly [string, (capsule: EvidenceAttestationCapsule) => unknown, string][] = [
	[
		"a flipped blob byte",
		(capsule) => ({
			...capsule,
			blobs: {
				...capsule.blobs,
				[sha256("public bytes")]: Buffer.from("qublic bytes").toString("base64"),
			},
		}),
		"Attestation blob checksum mismatch",
	],
	["a removed included blob", (capsule) => ({ ...capsule, blobs: {} }), "Missing attestation blob"],
	[
		"an extra blob",
		(capsule) => ({
			...capsule,
			blobs: {
				...capsule.blobs,
				[sha256("extra")]: Buffer.from("extra").toString("base64"),
			},
		}),
		"Unexpected attestation blob",
	],
	[
		"a blob for an excluded file",
		(capsule) => ({
			...capsule,
			blobs: {
				...capsule.blobs,
				[sha256("private bytes")]: Buffer.from("private bytes").toString("base64"),
			},
		}),
		"Unexpected attestation blob",
	],
	[
		"an unknown extra key",
		(capsule) => ({ ...capsule, analysisId: "leaked-analysis" }),
		"Invalid attestation keys",
	],
	[
		"metadata in a file entry",
		(capsule) => ({
			...capsule,
			files: capsule.files.map((file) => ({
				...file,
				path: "leaked-path",
			})),
		}),
		"Invalid attestation file keys",
	],
];

describe("evidence attestation verification", () => {
	it("accepts a fresh attestation and binds its checkpoint id to the digest", async () => {
		const capsule = await freshAttestation();
		expect(verifyAttestationCapsule(capsule)).toEqual(capsule);
		const { digest, ...body } = capsule;
		expect(digest).toBe(sha256(stableJson(body)));
		expect(() => verifyAttestationCapsule({ ...capsule, checkpointId: sha256("changed") })).toThrow(
			"Attestation digest mismatch",
		);
	});

	it.each(tamperingCases)("rejects %s", async (_name, tamper, message) => {
		const capsule = await freshAttestation();
		expect(() => verifyAttestationCapsule(tamper(capsule))).toThrow(new Error(message));
	});

	it("enforces the 64 MiB cap even when included files share a blob", async () => {
		const bytes = Buffer.alloc(1024 * 1024);
		await expect(
			buildAttestationCapsule(
				{
					id: sha256("checkpoint"),
					createdAt: "2026-11-16T00:00:00.000Z",
					files: Array.from({ length: 65 }, () => ({
						artifact: { sha256: sha256(bytes), accessLevel: "public" as const },
					})),
				},
				"public",
				"2026-11-16T01:00:00.000Z",
				async () => bytes,
			),
		).rejects.toThrow("Evidence exceeds capsule limit; use a smaller explicit checkpoint");
	});
});
