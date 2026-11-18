import { isUtf8 } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { PluginResourceReservations } from "@gyoungwe/plugin-api/node/reservations";
import { BundleInput, type ExportFile } from "@gyoungwe/plugin-api/p5-evidence";
import { Code, FileReadback } from "@gyoungwe/plugin-api/p5-receipts";
import { Check } from "typebox/value";
import * as review from "./p5-bundle-review";
import type { P5ByteStaging, P5StagingOwner } from "./p5-byte-staging";
import { P5ByteTransaction } from "./p5-byte-transaction";
import type { PluginCapabilityContext, PluginCapabilityHandler } from "./runtime-capabilities";

export interface P5BundlePorts {
	readonly root: string;
	readonly target: review.P5BundleTarget;
	readonly staging: P5ByteStaging;
	readonly reviewer: ReturnType<typeof review.createP5BundleReviewer>;
	owner(): P5StagingOwner | undefined;
	/** Current export C consent for this exact review; never S or a historical receipt. */
	consent(reviewed: review.ReviewedP5Bundle): boolean;
	/** A dedicated invocation owner; failed cleanup retains its leases for host recovery. */
	reservations(): PluginResourceReservations;
}
interface Outcome {
	status: "ok" | "failed";
	code: Code | null;
	committed: FileReadback[];
	readback: FileReadback[];
	cleanup: "complete" | "failed";
}
const TEMP_FLAGS =
	fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW;
const resultSchema = {
	type: "object",
	additionalProperties: false,
	required: ["status", "code", "committed", "readback", "cleanup"],
	properties: {
		status: { enum: ["ok", "failed"] },
		code: { anyOf: [Code, { type: "null" }] },
		committed: { type: "array", items: FileReadback, maxItems: 2 },
		readback: { type: "array", items: FileReadback, maxItems: 2 },
		cleanup: { enum: ["complete", "failed"] },
	},
} as const;
function fail(code: Code): never {
	throw Object.assign(new Error(`P5 bundle: ${code}`), { code });
}
function publicCode(error: unknown): Code {
	if (error instanceof Error && "code" in error && error.code === "EEXIST") return "STATE_CONFLICT";
	if (error instanceof Error && "code" in error && Check(Code, error.code)) return error.code as Code;
	return "READBACK_FAILED";
}
function sourceBytes(file: ExportFile, staging: P5ByteStaging): Buffer {
	const bytes =
		file.source.kind === "text"
			? Buffer.from(file.source.text, "utf8")
			: staging.read({ fileRef: file.source.fileRef });
	if (
		file.source.kind === "staged-file" &&
		(bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256)
	)
		fail("READBACK_FAILED");
	if (file.mediaType !== "application/json" && !isUtf8(bytes)) fail("INVALID_INPUT");
	return bytes;
}
const same = (left: fs.Stats, right: fs.Stats) => left.dev === right.dev && left.ino === right.ino;
function commitFile(
	ports: P5BundlePorts,
	transaction: P5ByteTransaction,
	leases: PluginResourceReservations,
	file: ExportFile,
	path: string,
	result: Outcome,
	check: () => void,
): void {
	const bytes = sourceBytes(file, ports.staging);
	check();
	if (transaction.inspect(path) !== null) fail("STATE_CONFLICT");
	const parent = dirname(join(ports.root, path)),
		identity = fs.lstatSync(parent);
	leases.reserve("state-writers", [parent]);
	const temporary = join(parent, `.${randomUUID()}.tmp`);
	const fd = fs.openSync(temporary, TEMP_FLAGS, 0o600);
	const owned: { identity?: fs.Stats } = {};
	try {
		try {
			owned.identity = fs.fstatSync(fd);
			fs.writeFileSync(fd, bytes);
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		check();
		leases.assertReserved("state-writers", parent);
		if (transaction.inspect(path) !== null) fail("STATE_CONFLICT");
		if (!same(fs.lstatSync(parent), identity)) fail("PATH_ESCAPE");
		if (!same(fs.lstatSync(temporary), owned.identity)) fail("STATE_CONFLICT");
		// Atomic create preserves existing outputs; W1 has no reviewed replacement/version field.
		fs.linkSync(temporary, join(ports.root, path));
		result.committed.push({ path, bytes: file.bytes, sha256: file.sha256 });
		const actual = transaction.inspect(path);
		if (actual?.size !== file.bytes || actual.sha256 !== file.sha256) fail("READBACK_FAILED");
		result.readback.push({ path, bytes: actual.size, sha256: actual.sha256 });
	} finally {
		try {
			if (fs.realpathSync(parent) !== parent || !same(fs.lstatSync(parent), identity)) fail("CLEANUP_FAILED");
			const current = fs.lstatSync(temporary, { throwIfNoEntry: false });
			if (current) {
				if (!owned.identity || !same(current, owned.identity)) fail("CLEANUP_FAILED");
				fs.unlinkSync(temporary);
				if (fs.lstatSync(temporary, { throwIfNoEntry: false })) fail("CLEANUP_FAILED");
			}
		} catch {
			result.cleanup = "failed";
			fail("CLEANUP_FAILED");
		}
	}
}
function candidate(input: unknown, ports: P5BundlePorts, owner: P5StagingOwner) {
	const { workspaceId, sessionId, callerSourceHash, providerSourceHash } = owner;
	const scope = { workspaceId, sessionId, callerSourceHash, providerSourceHash };
	// W1 validates the closed wire schema before snapshotting, including all inline byte metadata.
	const bundle = review.freezeP5Bundle(input as BundleInput, ports.target, scope);
	const media = bundle.request.files.map(({ mediaType }) => mediaType);
	const kinds = media.sort().join(",");
	if (
		kinds !== "application/json" &&
		kinds !== "application/x-ipynb+json,text/x-python" &&
		kinds !== "application/x-ipynb+json,text/x-r"
	)
		fail("INVALID_INPUT");
	return bundle;
}
async function writeBundle(
	ports: P5BundlePorts,
	input: unknown,
	context: PluginCapabilityContext,
	result: Outcome,
): Promise<void> {
	const leases = ports.reservations();
	try {
		const current = ports.owner();
		if (!current) fail("SCOPE_CHANGED");
		const owner = { ...current };
		if (context.signal.aborted || owner.signal.aborted) fail("CANCELLED");
		const bundle = candidate(input, ports, owner);
		const transaction = new P5ByteTransaction(ports.root, ports.staging, () => ports.owner(), leases);
		for (const file of bundle.request.files) sourceBytes(file, ports.staging);
		const reviewed = await ports.reviewer.review(bundle);
		if (!ports.reviewer.validates(reviewed, bundle)) fail("DENIED");
		const check = () => {
			if (context.signal.aborted || owner.signal.aborted) fail("CANCELLED");
			const latest = ports.owner();
			if (latest?.signal !== owner.signal || !isDeepStrictEqual(latest, owner)) fail("SCOPE_CHANGED");
			if (!ports.consent(reviewed)) fail("DENIED");
		};
		for (const file of bundle.request.files) {
			const path = join(bundle.target.destination, file.path);
			commitFile(ports, transaction, leases, file, path, result, check);
		}
	} finally {
		if (result.cleanup === "complete") {
			try {
				leases.dispose();
			} catch {
				result.cleanup = "failed";
				fail("CLEANUP_FAILED");
			}
		}
	}
}
/** Host-private files.writeBundle handler; fresh W1 C is enforced even with broker approval: own. */
export function p5BundleCapability(ports: P5BundlePorts): PluginCapabilityHandler {
	return {
		inputSchema: BundleInput,
		resultSchema,
		effect: "write",
		approval: "own",
		execute: async (input, context): Promise<Outcome> => {
			const result: Outcome = { status: "ok", code: null, committed: [], readback: [], cleanup: "complete" };
			await writeBundle(ports, input, context, result).catch((error: unknown) =>
				Object.assign(result, { status: "failed", code: publicCode(error) }),
			);
			return result;
		},
	};
}
