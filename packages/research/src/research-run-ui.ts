import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
export interface ResearchRunUiListInput {
	resultsRoot: string;
	project?: string | null;
	limit?: number;
}
export interface ResearchRunUiDetailInput {
	resultsRoot: string;
	runDir?: string | null;
	runId?: string | null;
	resultSlug?: string | null;
	vaultRoot?: string | null;
}
type Json = Record<string, any>;
const STAGES = [
	"created",
	"local_query_recorded",
	"external_search_recorded",
	"sources_inspected",
	"sources_archived",
	"sources_reused",
	"claims_bound",
	"answerable",
] as const;
const LABELS: Record<string, string> = {
	created: "准备运行",
	local_query_recorded: "记录本地检索",
	external_search_recorded: "记录外部检索",
	sources_inspected: "检查来源",
	sources_archived: "归档来源",
	sources_reused: "复用来源",
	claims_bound: "绑定主张",
	answerable: "可回答",
};
function text(value: unknown, max = 480): string {
	return String(value ?? "")
		.normalize("NFKC")
		.replace(/\p{Cc}/gu, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, max);
}
function validHash(value: unknown): string | null {
	return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}
function within(root: string, target: string): boolean {
	const rel = relative(resolve(root), resolve(target));
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}
function safeRunDir(resultsRoot: string, candidate: string): string {
	const runDir = resolve(resultsRoot, candidate);
	const parts = relative(resolve(resultsRoot), runDir).split(sep);
	if (!within(resultsRoot, runDir) || parts.length !== 2 || !parts[1]?.startsWith("run-"))
		throw new Error("research run is outside the configured results root");
	return runDir;
}
async function readJson(path: string): Promise<Json | null> {
	try {
		const value = JSON.parse(await readFile(path, "utf8"));
		return value && typeof value === "object" && !Array.isArray(value) ? value : null;
	} catch {
		return null;
	}
}
function gateOf(metadata: Json): Json {
	const gate =
		metadata?.evidence_gate && typeof metadata.evidence_gate === "object" ? metadata.evidence_gate : {};
	return {
		stage: STAGES.includes(gate.stage) ? gate.stage : "created",
		status: gate.status === "failed" ? "failed" : "ok",
		answerable: gate.answerable === true,
		events: Array.isArray(gate.events) ? gate.events.filter((e: unknown) => e && typeof e === "object") : [],
		claimBindings: Array.isArray(gate.claim_bindings) ? gate.claim_bindings : [],
		claimRefs: Array.isArray(gate.claim_refs) ? gate.claim_refs : [],
		sourceRefs: Array.isArray(gate.source_refs) ? gate.source_refs : [],
		archiveCount: Number.isFinite(Number(gate.archive_count)) ? Number(gate.archive_count) : 0,
		reuseCount: Number.isFinite(Number(gate.reuse_count)) ? Number(gate.reuse_count) : 0,
		reusedSources: Array.isArray(gate.reused_sources) ? gate.reused_sources : [],
		warnings: Array.isArray(gate.warnings)
			? gate.warnings.map((x: unknown) => text(x, 240)).filter(Boolean)
			: [],
	};
}
function route(metadata: Json): any[] {
	const gate = gateOf(metadata);
	const events = gate.events.filter((e: Json) => STAGES.includes(e.type));
	const current = events.at(-1)?.type || gate.stage;
	const currentIndex = STAGES.indexOf(current);
	const success = new Map<string, Json>();
	for (const event of events) {
		if (event.failed === true || event.status === "failed" || event.outcome === "failed") continue;
		success.set(event.type, event);
	}
	return STAGES.map((key, index) => {
		const event = success.get(key),
			count = gate.events.filter((e: Json) => e.type === key).length,
			failed = gate.events.some(
				(e: Json) => e.type === key && (e.failed === true || e.status === "failed" || e.outcome === "failed"),
			);
		let state = "pending";
		if (failed && index >= currentIndex) state = "blocked";
		else if (
			event &&
			(key === "answerable" || index < currentIndex || (index === currentIndex && gate.answerable))
		)
			state = "complete";
		else if (key === current && gate.status === "failed") state = "blocked";
		else if (key === current) state = "active";
		return {
			key,
			label: LABELS[key] || key,
			state,
			at: typeof event?.at === "string" ? event.at : null,
			detail: text(event?.notes || event?.outcome || event?.reason, 240) || null,
			...(count > 1 ? { count } : {}),
		};
	});
}
function timeline(metadata: Json): any[] {
	const gate = gateOf(metadata);
	return gate.events.slice(-128).map((event: Json) => ({
		type: text(event.type, 100) || "event",
		at: typeof event.at === "string" ? event.at : null,
		detail: text(event.notes || event.outcome || event.reason, 320) || null,
		status:
			event.failed === true || event.status === "failed" || event.outcome === "failed"
				? "failed"
				: event.observed === true
					? "observed"
					: "ok",
		refs: Array.isArray(event.source_refs)
			? event.source_refs
					.map((item: unknown) => text(item, 240))
					.filter(Boolean)
					.slice(0, 8)
			: undefined,
	}));
}
async function hashFile(path: string): Promise<{ hash: string | null; size: number | null }> {
	try {
		const bytes = await readFile(path);
		return { hash: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength };
	} catch {
		return { hash: null, size: null };
	}
}
async function sourceManifest(
	runDir: string,
	gate: Json,
	vaultRoot?: string | null,
): Promise<{ items: any[]; integrity: any }> {
	const manifest = await readJson(join(runDir, "sources", "download-manifest.json"));
	const items = Array.isArray(manifest?.items) ? manifest.items : [];
	const byPath = new Map<string, any>();
	let checked = 0,
		verified = 0,
		changed = 0,
		missing = 0;
	for (const item of items) {
		const path = text(item?.path || item?.local_path || item?.file, 480).replaceAll("\\", "/");
		if (!path) continue;
		const declared = validHash(item?.sha256);
		let currentHash: string | null = null,
			size: number | null = Number.isFinite(Number(item?.size_bytes)) ? Number(item.size_bytes) : null;
		const candidate = path.startsWith("/") ? path : join(runDir, path);
		if (within(runDir, candidate)) {
			const current = await hashFile(candidate);
			currentHash = current.hash;
			size = current.size ?? size;
		} else if (vaultRoot && within(vaultRoot, join(vaultRoot, path))) {
			const current = await hashFile(join(vaultRoot, path));
			currentHash = current.hash;
			size = current.size ?? size;
		}
		if (declared) {
			checked++;
			if (!currentHash) missing++;
			else if (currentHash === declared) verified++;
			else changed++;
		}
		byPath.set(path, {
			path,
			status: text(item?.status, 80) || "unknown",
			hash: declared,
			verified: Boolean(declared && currentHash && currentHash === declared),
			size,
			location: currentHash ? candidate : null,
			metadata: item?.metadata && typeof item.metadata === "object" ? item.metadata : null,
		});
	}
	for (const path of gate.sourceRefs) {
		const key = text(path, 480).replaceAll("\\", "/");
		if (key && !byPath.has(key))
			byPath.set(key, {
				path: key,
				status: "inspected",
				hash: null,
				verified: false,
				size: null,
				location: null,
				metadata: null,
			});
	}
	for (const source of gate.reusedSources) {
		const key = text(source?.path, 480).replaceAll("\\", "/");
		if (key && !byPath.has(key))
			byPath.set(key, {
				path: key,
				status: "reused",
				hash: validHash(source?.hash),
				verified: false,
				size: null,
				location: null,
				metadata: null,
			});
	}
	return { items: [...byPath.values()].slice(0, 64), integrity: { checked, verified, changed, missing } };
}
function claims(gate: Json): any[] {
	return gate.claimBindings
		.slice(0, 64)
		.map((binding: Json) => {
			const evidence = Array.isArray(binding.sources)
				? binding.sources
						.slice(0, 12)
						.map((item: Json) => ({
							path: text(item?.path, 480),
							startLine: Number.isInteger(item?.start_line) ? item.start_line : null,
							endLine: Number.isInteger(item?.end_line) ? item.end_line : null,
							quote: text(item?.quote, 700) || null,
							hash: validHash(item?.hash),
						}))
						.filter((x: any) => x.path)
				: [];
			return {
				id: text(binding.id, 120) || null,
				claim: text(binding.claim, 480),
				support: evidence.map((x: any) => x.path),
				status: binding.scientificallyVerified === true ? "verified" : binding.relationship || "bound",
				relationship: ["direct", "indirect", "hypothesis", "unsupported"].includes(binding.relationship)
					? binding.relationship
					: null,
				limitations: text(binding.limitations, 480) || null,
				organism: text(binding.organism, 180) || null,
				method: text(binding.method, 360) || null,
				evidence,
			};
		})
		.filter((x: any) => x.claim);
}
async function provenance(runDir: string): Promise<any> {
	const manifest = await readJson(join(runDir, "reproducibility-manifest.json"));
	if (!manifest || !Array.isArray(manifest.files))
		return { status: "not-recorded", files: [], limitations: ["尚未记录运行清单"] };
	const files = [];
	let changed = false,
		incomplete = false;
	for (const item of manifest.files.slice(0, 64)) {
		const path = text(item?.path, 480),
			declared = validHash(item?.sha256),
			current = path ? await hashFile(resolve(runDir, path)) : { hash: null, size: null },
			matches = Boolean(declared && current.hash && declared === current.hash);
		if (!declared || !current.hash) incomplete = true;
		else if (!matches) changed = true;
		files.push({
			path,
			role: text(item?.role, 80) || "unknown",
			hash: declared,
			currentHash: current.hash,
			matches,
		});
	}
	return {
		status: changed ? "changed" : incomplete ? "incomplete" : "observed",
		files,
		limitations: Array.isArray(manifest.limitations)
			? manifest.limitations.map((x: unknown) => text(x, 240)).filter(Boolean)
			: [],
	};
}
function listItem(metadata: Json, runDir: string, resultsRoot: string): any {
	const gate = gateOf(metadata);
	return {
		runId: text(metadata.run_id || basename(runDir), 180),
		resultSlug: text(metadata.result_slug || relative(resultsRoot, runDir).split(sep)[0], 180),
		project: text(metadata.project, 180),
		topicId: text(metadata.topic_id, 180) || null,
		query: text(metadata.query, 1000),
		status: text(metadata.status, 80) || "unknown",
		stage: gate.stage,
		answerable: gate.answerable,
		scientificallyVerified: false,
		startedAt: text(metadata.started_at, 80) || null,
		updatedAt: text(metadata.updated_at || metadata.started_at, 80) || null,
		runDir: relative(resultsRoot, runDir).replaceAll(sep, "/"),
	};
}
async function discover(
	resultsRoot: string,
	project?: string | null,
): Promise<Array<{ metadata: Json; runDir: string }>> {
	const output: Array<{ metadata: Json; runDir: string }> = [];
	try {
		for (const slug of await readdir(resultsRoot, { withFileTypes: true })) {
			if (!slug.isDirectory() || slug.name.startsWith(".")) continue;
			for (const entry of await readdir(join(resultsRoot, slug.name), { withFileTypes: true })) {
				if (!entry.isDirectory() || !entry.name.startsWith("run-")) continue;
				const runDir = join(resultsRoot, slug.name, entry.name),
					metadata = await readJson(join(runDir, "metadata.json"));
				if (metadata && (!project || text(metadata.project, 180) === text(project, 180)))
					output.push({ metadata, runDir });
			}
		}
	} catch {}
	return output.sort((a, b) =>
		String(b.metadata.updated_at || b.metadata.started_at).localeCompare(
			String(a.metadata.updated_at || a.metadata.started_at),
		),
	);
}
export async function listResearchRuns(input: ResearchRunUiListInput): Promise<any> {
	const limit = Math.max(1, Math.min(50, Number(input.limit) || 10)),
		root = resolve(input.resultsRoot),
		found = await discover(root, input.project);
	return {
		items: found.slice(0, limit).map(({ metadata, runDir }) => listItem(metadata, runDir, root)),
		total: found.length,
	};
}
export async function getResearchRun(input: ResearchRunUiDetailInput): Promise<any> {
	const resultsRoot = resolve(input.resultsRoot);
	let runDir = input.runDir ? safeRunDir(resultsRoot, input.runDir) : null;
	if (!runDir && input.runId) {
		const found = await discover(resultsRoot);
		runDir =
			found.find(({ metadata }) => text(metadata.run_id, 180) === text(input.runId, 180))?.runDir || null;
	}
	if (!runDir) throw new Error("research run not found");
	const metadata = await readJson(join(runDir, "metadata.json"));
	if (!metadata) throw new Error("research run metadata is invalid");
	const gate = gateOf(metadata),
		sourceData = await sourceManifest(runDir, gate, input.vaultRoot),
		runClaims = claims(gate),
		runProvenance = await provenance(runDir),
		gaps: string[] = [];
	const hashGroups = new Map<string, string[]>();
	for (const source of sourceData.items) {
		if (source.hash) hashGroups.set(source.hash, [...(hashGroups.get(source.hash) || []), source.path]);
	}
	const governance = {
		duplicateSources: [...hashGroups.values()].filter((paths) => paths.length > 1),
		staleSources: sourceData.items
			.filter((source) => source.metadata?.stale === true || source.metadata?.retracted === true)
			.map((source) => source.path),
		unavailableSources: sourceData.items
			.filter(
				(source) =>
					["failed", "missing", "unavailable"].includes(source.status) || (source.hash && !source.verified),
			)
			.map((source) => source.path),
	};
	if (governance.duplicateSources.length) gaps.push("存在重复来源");
	if (governance.staleSources.length) gaps.push("存在需要复核的过期或撤稿来源");
	if (!runClaims.length) gaps.push("没有结构化主张");
	if (
		runClaims.some(
			(claim: any) => claim.relationship === "unsupported" || claim.relationship === "hypothesis",
		)
	)
		gaps.push("存在未直接支持的主张");
	if (sourceData.integrity.changed || sourceData.integrity.missing) gaps.push("来源文件需要重新核验");
	if (runProvenance.status !== "observed") gaps.push("复现清单不完整或已变化");
	if (gate.status === "failed") gaps.push("当前路由被阻塞");
	return {
		...listItem(metadata, runDir, resultsRoot),
		route: route(metadata),
		timeline: timeline(metadata),
		sources: sourceData.items,
		claims: runClaims,
		warnings: gate.warnings,
		coverage: metadata.retrieval_coverage || metadata.metrics?.index?.semantic || null,
		archive: {
			count: gate.archiveCount,
			reused: gate.reuseCount,
			verified:
				sourceData.integrity.checked > 0 && sourceData.integrity.checked === sourceData.integrity.verified,
		},
		integrity: sourceData.integrity,
		provenance: runProvenance,
		gaps,
		governance,
	};
}
