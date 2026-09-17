import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { knowledgeDirectory, withKnowledgeBinding } from "./config.mjs";
import { canRead, readNoteFile, validateNote } from "./files.mjs";
import { readReviewMode } from "./review-policy.mjs";
import { invalidateKnowledgeUi } from "./ui-state.mjs";

const AUTOMATIC_AUTHORITY = Symbol("host-automatic-wiki");
const START = "<!-- pi-agent:managed:start -->",
	END = "<!-- pi-agent:managed:end -->";
const queueKey = Symbol.for("drone.knowledge.wiki-review-locks.v1");
globalThis[queueKey] ??= new Map();
const queues = globalThis[queueKey];
const digest = (text) => createHash("sha256").update(text).digest("hex");
const MAX_PENDING = 100,
	MAX_AGE = 24 * 60 * 60 * 1000;
async function exclusive(key, operation) {
	const previous = queues.get(key) || Promise.resolve(),
		next = previous.catch(() => {}).then(operation);
	queues.set(key, next);
	try {
		return await next;
	} finally {
		if (queues.get(key) === next) queues.delete(key);
	}
}
function rootFor(service) {
	return join(knowledgeDirectory(), service.binding.vaultId, "wiki-review");
}
function checkId(id) {
	if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid Wiki proposal id");
	return id;
}
function targetPath(path, project) {
	validateNote(path);
	const prefix = `Projects/${project}/Wiki/`;
	const tail = path.startsWith("Wiki/")
		? path.slice(5)
		: path.startsWith(prefix)
			? path.slice(prefix.length)
			: null;
	if (!tail || tail.includes("/") || /^Index\.md$/i.test(tail) || /[[\]#|\r\n]/.test(tail))
		throw new Error("Target must be a shared or current-project Wiki page, not navigation");
	return path;
}
function immutableHash(p) {
	return digest(
		JSON.stringify({
			id: p.id,
			vaultId: p.vaultId,
			bindingRevision: p.bindingRevision,
			project: p.project,
			path: p.path,
			title: p.title,
			rationale: p.rationale,
			createdAt: p.createdAt,
			before: p.before,
			after: p.after,
			sources: p.sources,
		}),
	);
}
async function atomicJson(path, value) {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temp = join(dirname(path), `.${randomUUID()}.tmp`);
	try {
		await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
		await rename(temp, path);
	} finally {
		await unlink(temp).catch((error) => {
			if (error.code !== "ENOENT") throw error;
		});
	}
}
async function currentNote(service, path) {
	try {
		return await readNoteFile(service.binding.vault, path);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}
function managedParts(text) {
	const start = text.indexOf(START),
		end = text.indexOf(END);
	if (
		start < 0 !== end < 0 ||
		end < start ||
		(start >= 0 && (text.indexOf(START, start + 1) >= 0 || text.indexOf(END, end + 1) >= 0))
	)
		throw new Error("Invalid managed block markers");
	return { start, end, body: start < 0 ? "" : text.slice(start + START.length, end).trim() };
}
function proposedText(original, title, body) {
	const block = `${START}\n${body.trim()}\n${END}`;
	if (original === null)
		return `---\ntype: wiki\nstatus: unverified\n---\n\n# ${title}\n\n${block}\n\n## Human review\n\n`;
	const { start, end } = managedParts(original);
	return start < 0
		? `${original}${original.endsWith("\n") ? "\n" : "\n\n"}${block}\n`
		: original.slice(0, start) + block + original.slice(end + END.length);
}
async function loadProposal(service, id, project) {
	checkId(id);
	const root = rootFor(service);
	let text;
	try {
		text = await readFile(join(root, "pending", `${id}.json`), "utf8");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		text = await readFile(join(root, "reviewed", `${id}.json`), "utf8");
	}
	if (Buffer.byteLength(text) > 256 * 1024) throw new Error("Wiki proposal exceeds its storage budget");
	const p = JSON.parse(text);
	if (
		p.id !== id ||
		p.project !== project ||
		p.vaultId !== service.binding.vaultId ||
		p.bindingRevision !== service.binding.revision
	)
		throw new Error("Proposal belongs to a different project or binding");
	targetPath(p.path, project);
	if (
		immutableHash(p) !== p.proposalHash ||
		digest(p.after) !== p.afterHash ||
		(p.before === null ? p.beforeHash !== null : digest(p.before) !== p.beforeHash)
	)
		throw new Error("Wiki proposal content changed");
	return p;
}
export function validateWikiSourcePaths(paths) {
	if (!Array.isArray(paths) || !paths.length || paths.length > 12)
		throw Object.assign(
			new Error("source_paths: supply 1–12 Vault-relative Markdown notes already read this turn"),
			{ code: "source-note-required", field: "source_paths" },
		);
	for (let index = 0; index < paths.length; index++) {
		try {
			validateNote(paths[index]);
		} catch {
			throw Object.assign(
				new Error(
					`source_paths[${index}]: expected a Vault-relative Markdown source note (for example Library/Papers/source.md), not a workspace PDF or URL. Read the corresponding source note first; changing the Wiki target path cannot fix this field.`,
				),
				{ code: "source-note-required", field: `source_paths[${index}]`, retryable: false },
			);
		}
	}
}
export async function stageWikiProposal(service, ticket, cwd, input) {
	validateWikiSourcePaths(input.source_paths);
	return withKnowledgeBinding(service.binding, async () => {
		if (service.binding.depositMode === "run-only")
			throw new Error("Wiki proposals are disabled by run-only mode");
		const { project, sources } = await service.evidenceReceipts(ticket, cwd, input.source_paths);
		const path = targetPath(input.path, project);
		if (sources.some((source) => source.path === path || /[[\]#|\r\n]/.test(source.path)))
			throw new Error("A Wiki cannot cite itself or an ambiguous link path");
		if (
			sources.every(
				(source) =>
					/(?:^|\/)Wiki\//.test(source.path) || /(?:^|\/)(?:Home|Index|Context)\.md$/.test(source.path),
			)
		)
			throw new Error("Read at least one underlying evidence/source note, not only Wiki or navigation");
		const { title, markdown, rationale } = input;
		if (typeof title !== "string" || !title.trim() || title.length > 200 || /[\r\n]/.test(title))
			throw new Error("A single-line Wiki title is required");
		if (
			typeof markdown !== "string" ||
			!markdown.trim() ||
			markdown.length > 24000 ||
			markdown.includes("<!-- pi-agent:managed:")
		)
			throw new Error("Wiki candidate must contain 1–24000 characters and no managed markers");
		if (typeof rationale !== "string" || !rationale.trim() || rationale.length > 1000)
			throw new Error("A concise change rationale is required");
		const original = await currentNote(service, path);
		if (original) await service.evidenceReceipts(ticket, cwd, [path]);
		if (original && original.bytes > 64 * 1024)
			throw new Error("Existing Wiki exceeds the bounded review size; split it before editing");
		if (original && managedParts(original.text).body.length > 24000)
			throw new Error("Existing generated block exceeds the review size");
		const refs = sources
			.map(
				(source) =>
					`- [[${source.path.slice(0, -3)}]] · lines ${source.startLine}–${source.endLine} · sha256 ${source.hash}`,
			)
			.join("\n");
		const after = proposedText(
			original?.text ?? null,
			title.trim(),
			`${markdown.trim()}\n\n## Sources\n${refs}`,
		);
		const proposal = {
			id: randomUUID(),
			status: "pending",
			vaultId: service.binding.vaultId,
			bindingRevision: service.binding.revision,
			project,
			path,
			title: title.trim(),
			rationale: rationale.trim(),
			createdAt: Date.now(),
			sources,
			before: original?.text ?? null,
			beforeHash: original?.hash ?? null,
			after,
			afterHash: digest(after),
		};
		proposal.proposalHash = immutableHash(proposal);
		if (Buffer.byteLength(JSON.stringify(proposal, null, 2)) + 1 > 256 * 1024)
			throw new Error("Wiki proposal exceeds the bounded review storage size");
		const root = rootFor(service);
		await exclusive(root, async () => {
			const directory = join(root, "pending");
			await mkdir(directory, { recursive: true, mode: 0o700 });
			if ((await readdir(directory)).filter((name) => name.endsWith(".json")).length >= MAX_PENDING)
				throw new Error("Pending Wiki review limit reached; review existing candidates first");
			await atomicJson(join(directory, `${proposal.id}.json`), proposal);
		});
		invalidateKnowledgeUi();
		if ((await readReviewMode()) === "automatic") {
			try {
				return await decideWikiProposal(service, proposal.id, project, proposal.proposalHash, "apply", {
					actor: "automatic",
					authority: AUTOMATIC_AUTHORITY,
				});
			} catch {
				// Keep the exact candidate pending. Never overwrite human edits or retry an uncertain write.
			}
		}
		return {
			id: proposal.id,
			status: "pending",
			path,
			project,
			proposalHash: proposal.proposalHash,
			sources,
			vaultWritten: false,
			scientificallyVerified: false,
			next: "User: run /obsidian-review to review the exact proposed change.",
		};
	});
}

// Host-only accumulation for repeated research rounds on the exact same topic.
// It keeps one pending candidate, revalidates all earlier source versions, and
// invalidates any stale UI preview by changing the proposal hash.
export async function mergeWikiProposal(
	service,
	ticket,
	cwd,
	id,
	{ markdown, rationale, source_paths } = {},
) {
	checkId(id);
	return exclusive(`${rootFor(service)}:${id}`, () =>
		withKnowledgeBinding(service.binding, async () => {
			const { project, sources: newSources } = await service.evidenceReceipts(ticket, cwd, source_paths);
			const p = await loadProposal(service, id, project);
			if (p.status !== "pending")
				throw new Error("Only a pending Wiki candidate can accumulate another research round");
			if (Date.now() > p.createdAt + MAX_AGE)
				throw new Error(
					"Pending Wiki candidate expired; review or replace it before accumulating more rounds",
				);
			const target = await currentNote(service, p.path);
			if ((target?.hash ?? null) !== p.beforeHash)
				throw new Error("Wiki changed since the pending candidate was created");
			await verifySources(service, p);
			const byPath = new Map(p.sources.map((source) => [source.path, source]));
			for (const source of newSources) byPath.set(source.path, source);
			const sources = [...byPath.values()];
			if (sources.length > 12)
				throw new Error(
					"Pending topic reached the 12-source review budget; review it before adding another round",
				);
			if (
				typeof markdown !== "string" ||
				!markdown.trim() ||
				markdown.length > 12000 ||
				markdown.includes("<!-- pi-agent:managed:")
			)
				throw new Error("Incremental topic summary must contain 1–12000 characters and no managed markers");
			if (typeof rationale !== "string" || !rationale.trim() || rationale.length > 1000)
				throw new Error("A concise merge rationale is required");
			const prior = managedParts(p.after)
				.body.replace(/\n\n## Sources\n[\s\S]*$/, "")
				.trim();
			const update = `## Research update · ${new Date().toISOString()}\n\n${markdown.trim()}`;
			const merged = [prior, update].filter(Boolean).join("\n\n");
			if (merged.length > 22000)
				throw new Error("Pending topic synthesis is too large; review it before adding another round");
			const refs = sources
				.map(
					(source) =>
						`- [[${source.path.slice(0, -3)}]] · lines ${source.startLine}–${source.endLine} · sha256 ${source.hash}`,
				)
				.join("\n");
			const after = proposedText(p.before, p.title, `${merged}\n\n## Sources\n${refs}`);
			const updated = {
				...p,
				createdAt: Date.now(),
				rationale: `${p.rationale}\n\nAccumulated research round: ${rationale.trim()}`.slice(0, 1000),
				sources,
				after,
				afterHash: digest(after),
			};
			updated.proposalHash = immutableHash(updated);
			if (Buffer.byteLength(JSON.stringify(updated, null, 2)) + 1 > 256 * 1024)
				throw new Error("Merged Wiki proposal exceeds the bounded review storage size");
			await exclusive(rootFor(service), () =>
				atomicJson(join(rootFor(service), "pending", `${p.id}.json`), updated),
			);
			invalidateKnowledgeUi();
			return {
				id: p.id,
				status: "pending",
				path: p.path,
				project,
				proposalHash: updated.proposalHash,
				sources,
				merged: true,
				roundAdded: true,
				vaultWritten: false,
				scientificallyVerified: false,
				next: "User: review the accumulated exact change in Wiki review.",
			};
		}),
	);
}

export async function previewWikiProposal(service, id, project) {
	return withKnowledgeBinding(service.binding, async () => {
		const p = await loadProposal(service, id, project);
		const now = Date.now(),
			target = await currentNote(service, p.path);
		const sources = [];
		for (const source of p.sources) {
			let current = null,
				error = null;
			try {
				current = await currentNote(service, source.path);
			} catch (e) {
				error = e.message;
			}
			sources.push({
				...source,
				currentHash: current?.hash || null,
				changed: !current || current.hash !== source.hash,
				error,
			});
		}
		const expired = now > p.createdAt + MAX_AGE,
			targetChanged = (target?.hash ?? null) !== p.beforeHash;
		const protectedText =
			p.before === null
				? ""
				: p.before.replace(
						/<!-- pi-agent:managed:start -->[\s\S]*?<!-- pi-agent:managed:end -->/,
						"（此处为智能体托管区）",
					);
		return {
			id: p.id,
			path: p.path,
			project,
			status: p.status,
			proposalHash: p.proposalHash,
			title: p.title,
			rationale: p.rationale,
			before: managedParts(p.before || "").body,
			after: managedParts(p.after).body,
			sources,
			protectedText,
			expired,
			targetChanged,
			canApply: p.status === "pending" && !expired && !targetChanged && !sources.some((s) => s.changed),
			expiresAt: p.createdAt + MAX_AGE,
			scientificallyVerified: false,
		};
	});
}
export async function listWikiProposals(service, project) {
	return withKnowledgeBinding(service.binding, async () => {
		let names;
		try {
			names = await readdir(join(rootFor(service), "pending"));
		} catch (error) {
			if (error.code === "ENOENT") return { items: [], problems: [] };
			throw error;
		}
		const items = [],
			problems = [];
		for (const name of names
			.filter((name) => /^[0-9a-f-]{36}\.json$/.test(name))
			.sort()
			.slice(0, MAX_PENDING)) {
			try {
				const p = JSON.parse(await readFile(join(rootFor(service), "pending", name), "utf8"));
				if (p.project !== project) continue;
				if (immutableHash(p) !== p.proposalHash) throw new Error("Wiki proposal content changed");
				items.push({
					id: p.id,
					path: p.path,
					title: p.title,
					status: p.status,
					expiresAt: p.createdAt + MAX_AGE,
					expired: Date.now() > p.createdAt + MAX_AGE,
					bindingChanged: p.bindingRevision !== service.binding.revision,
				});
			} catch (error) {
				problems.push({ id: name.slice(0, -5), error: error.message });
			}
		}
		return { items, problems };
	});
}
async function ensureParent(vault, path) {
	let full = vault;
	for (const part of path.split("/").slice(0, -1)) {
		full = join(full, part);
		try {
			await mkdir(full);
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
		}
		const info = await lstat(full);
		if (!info.isDirectory() || info.isSymbolicLink())
			throw new Error("Wiki parent must be a regular directory");
	}
}
async function verifySources(service, p) {
	for (const source of p.sources) {
		validateNote(source.path);
		if (!canRead(source.path, p.project)) throw new Error("Source is outside proposal scope");
		const current = await currentNote(service, source.path);
		if (!current || current.hash !== source.hash)
			throw new Error(`Source changed since proposal: ${source.path}`);
	}
}
async function finish(service, p, status, review = { actor: "human" }) {
	const updated = {
		...p,
		status,
		reviewedAt: Date.now(),
		reviewMethod: review.actor,
		modelReview: review.actor === "model" ? review : null,
		humanReviewed: review.actor === "human",
		scientificallyVerified: false,
	};
	await atomicJson(join(rootFor(service), "reviewed", `${p.id}.json`), updated);
	await unlink(join(rootFor(service), "pending", `${p.id}.json`)).catch((error) => {
		if (error.code !== "ENOENT") throw error;
	});
	invalidateKnowledgeUi();
}
// This is a host API. It is deliberately not exposed as a model tool with approved:true.
// The UI command passes the exact preview hash after a fresh native user choice.
export async function decideWikiProposal(
	service,
	id,
	project,
	expectedHash,
	decision,
	review = { actor: "human" },
) {
	checkId(id);
	if (
		!["human", "model", "automatic"].includes(review.actor) ||
		(review.actor === "automatic" && review.authority !== AUTOMATIC_AUTHORITY) ||
		(review.actor === "model" &&
			(!review.auditId || review.verdict !== "approve" || typeof review.checkCurrent !== "function"))
	)
		throw new Error("Invalid model-review authority");
	return exclusive(`${rootFor(service)}:${id}`, () =>
		withKnowledgeBinding(service.binding, async () => {
			await review.checkCurrent?.();
			const p = await loadProposal(service, id, project);
			if (expectedHash !== p.proposalHash)
				throw new Error("The reviewed candidate changed; preview it again");
			if (p.status !== "pending") return { id, status: p.status, alreadyReviewed: true };
			if (decision === "reject") {
				await finish(service, p, "rejected", review);
				return { id, status: "rejected", vaultWritten: false };
			}
			if (decision !== "apply") throw new Error("Unknown review decision");
			if (service.binding.depositMode === "run-only")
				throw new Error("Wiki writes are disabled by run-only mode");
			if (Date.now() - p.createdAt > MAX_AGE)
				throw new Error("Wiki proposal expired; regenerate it from current evidence");
			return exclusive(`${service.binding.vault}:wiki:${p.path}`, async () => {
				const current = await currentNote(service, p.path);
				const recovered = current?.hash === p.afterHash;
				if (review.actor === "automatic") {
					if ((await readReviewMode()) !== "automatic")
						throw new Error("Strict review requires confirmation");
					if (!recovered && current && !(await knownGeneratedPage(service, p.project, p.path, current.hash)))
						throw new Error("Existing or human-edited page requires confirmation");
				}
				if (!recovered) {
					if ((current?.hash ?? null) !== p.beforeHash)
						throw new Error("Wiki changed after preview; no user edits were overwritten");
					await verifySources(service, p);
					await ensureParent(service.binding.vault, p.path);
					const full = join(service.binding.vault, p.path),
						temp = join(dirname(full), `.${basename(full)}.${randomUUID()}.tmp`);
					const mode = current ? (await lstat(full)).mode & 0o777 : 0o600;
					try {
						await writeFile(temp, p.after, { flag: "wx", mode });
						await withKnowledgeBinding(service.binding, async () => {});
						if (((await currentNote(service, p.path))?.hash ?? null) !== p.beforeHash)
							throw new Error("Wiki changed during review; no overwrite applied");
						await verifySources(service, p);
						await review.checkCurrent?.();
						if (p.before === null) await link(temp, full);
						else await rename(temp, full);
					} finally {
						await unlink(temp).catch((error) => {
							if (error.code !== "ENOENT") throw error;
						});
					}
				}
				let reviewRecorded = true,
					recordError = null,
					indexed = true,
					indexError = null;
				try {
					await finish(service, p, "applied", review);
				} catch (error) {
					reviewRecorded = false;
					recordError = error.message;
				}
				try {
					await service.request("changed", { paths: [p.path] });
				} catch (error) {
					indexed = false;
					indexError = error.message;
				}
				return {
					id,
					status: "applied",
					path: p.path,
					vaultWritten: true,
					recovered,
					reviewRecorded,
					recordError,
					indexed,
					indexError,
					scientificallyVerified: false,
					humanReviewed: review.actor === "human",
					reviewMethod: review.actor,
					maintenance: "queued",
				};
			});
		}),
	);
}

// History contains exact before/after content; ownership is proven by a prior applied hash,
// not by a marker a human may have typed into a page.
export async function wikiHistory(service, project) {
	return withKnowledgeBinding(service.binding, async () => {
		let names;
		try {
			names = await readdir(join(rootFor(service), "reviewed"));
		} catch (error) {
			if (error.code === "ENOENT") return [];
			throw error;
		}
		const items = [];
		for (const name of names.filter((n) => /^[0-9a-f-]{36}\.json$/.test(n))) {
			let p;
			try {
				p = await loadProposal(service, name.slice(0, -5), project);
			} catch {
				continue;
			}
			if (p.status !== "applied") continue;
			items.push({
				id: p.id,
				path: p.path,
				afterHash: p.afterHash,
				reviewedAt: p.reviewedAt,
				reviewMethod: p.reviewMethod,
			});
		}
		return items.sort((a, b) => b.reviewedAt - a.reviewedAt);
	});
}
async function knownGeneratedPage(service, project, path, hash) {
	return (await wikiHistory(service, project)).some((p) => p.path === path && p.afterHash === hash);
}
// Host UI only; compare-and-swap protects edits made after the saved version.
export async function undoWikiUpdate(service, project, id, expectedHash) {
	checkId(id);
	return exclusive(`${rootFor(service)}:${id}`, () =>
		withKnowledgeBinding(service.binding, async () => {
			const p = await loadProposal(service, id, project);
			if (p.status !== "applied" || p.afterHash !== expectedHash)
				throw new Error("Refresh Wiki history before undo");
			return exclusive(`${service.binding.vault}:wiki:${p.path}`, async () => {
				const current = await currentNote(service, p.path);
				if (current?.hash !== p.afterHash)
					throw new Error("Wiki changed since saving; undo would overwrite edits");
				const full = join(service.binding.vault, p.path);
				if (p.before === null) await unlink(full);
				else {
					const temp = join(dirname(full), `.${randomUUID()}.tmp`);
					try {
						await writeFile(temp, p.before, { flag: "wx", mode: (await lstat(full)).mode & 0o777 });
						if ((await currentNote(service, p.path))?.hash !== p.afterHash)
							throw new Error("Wiki changed during undo");
						await rename(temp, full);
					} finally {
						await unlink(temp).catch((e) => {
							if (e.code !== "ENOENT") throw e;
						});
					}
				}
				await finish(service, p, "reverted");
				await service.request("changed", { paths: [p.path] });
				return { status: "reverted", path: p.path };
			});
		}),
	);
}
