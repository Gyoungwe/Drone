import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { externalEffectKey } from "@drone/compute/jobs/idempotency";
import { normalizeDoi } from "./literature-receipt";
import { normalizePmcid, normalizePmid, OA_MAX_CANDIDATES, resolveOpenAccess } from "./open-access";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_TIMEOUT_MS,
	isWithin,
	looksLikeChallenge,
	looksLikeCloudflare,
	normalizeMetadata,
	SOURCE_CATEGORIES,
	safeFilename,
	validateContent,
	validateRunDir,
} from "./source-archive-policy";
import { assessManualPage } from "./source-delivery";

export { DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS, SOURCE_CATEGORIES } from "./source-archive-policy";

export interface SourceArchiveWorkspace {
	resultsRoot: string;
	obsidianVault?: string | null;
}

export interface SourceArchivePorts {
	workspace(cwd: string): Promise<SourceArchiveWorkspace>;
	publishSourceNote(input: Record<string, unknown>): Promise<Record<string, unknown>>;
	exclusive<T>(key: string, work: () => Promise<T>): Promise<T>;
	loadInstitutionalConfig?(): Promise<Record<string, unknown> | null>;
	isElectronAvailable?(): boolean;
	institutionalFetch?(url: string, options?: Record<string, unknown>): Promise<any>;
	buildProxiedUrl?(url: string, template: string): string;
	/** One Cloudflare card for this call. Missing means keep today's browser_required result. */
	askCloudflare?(url: string, signal?: AbortSignal): Promise<"continue" | "skip">;
}

type ArchiveOptions = Record<string, any>;

function filenameFromResponse(response: any, url: string, category: string) {
	const disposition = response.headers.get("content-disposition") || "";
	const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^;"]+)/i);
	let filename = match ? decodeURIComponent(match[1].trim()) : "";
	if (!filename) {
		try {
			filename = basename(new URL(url).pathname);
		} catch {
			/* fallback below */
		}
	}
	const fallback = `${category}-${new Date()
		.toISOString()
		.replace(/[-:.TZ]/g, "")
		.slice(0, 14)}.bin`;
	return safeFilename(filename, fallback);
}

async function atomicJson(file: string, value: any) {
	await mkdir(dirname(file), { recursive: true });
	const temp = `${file}.${randomUUID()}.tmp`;
	await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	await rename(temp, file);
}

async function withRunLock(ports: SourceArchivePorts, key: string, fn: () => Promise<any>) {
	return ports.exclusive(key, fn);
}

async function readManifest(file: string, runDir: string): Promise<any> {
	try {
		const parsed = JSON.parse(await readFile(file, "utf8"));
		if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items))
			throw new Error("invalid manifest");
		return parsed;
	} catch (error: any) {
		if (error.code !== "ENOENT") throw error;
		return { version: 1, run_dir: runDir, updated_at: null, items: [] };
	}
}

async function verifyManifestItems(manifest: any, runDir: string): Promise<Record<string, unknown>> {
	const downloaded = manifest.items.filter((entry: any) => entry?.status === "downloaded");
	if (downloaded.length === 0) return { ok: true, items: [] };
	let sourcesRoot: string;
	try {
		sourcesRoot = await realpath(join(runDir, "sources"));
	} catch {
		return {
			ok: false,
			items: downloaded.map((item: any) => ({
				id: item.id ?? null,
				path: item.path ?? item.local_path ?? null,
				ok: false,
				reason: "sources directory is missing",
			})),
		};
	}
	const items = [];
	for (const item of downloaded) {
		const path =
			typeof item.path === "string" ? item.path : typeof item.local_path === "string" ? item.local_path : "";
		if (!path) {
			items.push({ id: item.id ?? null, path: null, ok: false, reason: "missing manifest path" });
			continue;
		}
		try {
			const canonical = await realpath(isAbsolute(path) ? path : resolve(runDir, path));
			if (!isWithin(sourcesRoot, canonical)) throw new Error("path escapes run sources");
			const bytes = await readFile(canonical);
			const sha256 = createHash("sha256").update(bytes).digest("hex");
			if (sha256 !== String(item.sha256 || "").toLowerCase()) throw new Error("sha256 mismatch");
			if (item.size_bytes !== undefined && Number(item.size_bytes) !== bytes.byteLength)
				throw new Error("size mismatch");
			items.push({ id: item.id ?? null, path: canonical, ok: true, sha256, size_bytes: bytes.byteLength });
		} catch (error: any) {
			items.push({ id: item.id ?? null, path, ok: false, reason: String(error?.message || error) });
		}
	}
	return { ok: items.every((item: any) => item.ok === true), items };
}

async function appendFailure(file: string, failure: any) {
	let original = "# Source download failures\n\n";
	try {
		original = await readFile(file, "utf8");
	} catch (error: any) {
		if (error.code !== "ENOENT") throw error;
	}
	const lines = [
		`## ${failure.failed_at} · ${failure.category}`,
		`- URL: ${failure.url}`,
		`- Reason: ${failure.reason}`,
		`- Browser required: ${failure.browser_required ? "yes" : "no"}`,
	];
	if (failure.browser_handoff) lines.push(`- Browser handoff: ${failure.browser_handoff.url}`);
	if (failure.open_access) {
		const oa = failure.open_access;
		lines.push(
			`- Open access: ${oa.doi || oa.pmcid || "?"} · oa_status=${oa.oa_status || "unknown"} · sources=${(
				oa.queried || []
			)
				.map((q: any) => `${q.source}:${q.status}`)
				.join(",")}`,
		);
		for (const attempt of oa.attempts || [])
			lines.push(`  - tried ${attempt.url} (${attempt.source}): ${attempt.reason}`);
		if (failure.manual_import) lines.push(`- Manual import: ${failure.manual_import.how}`);
	}
	const temp = `${file}.${randomUUID()}.tmp`;
	await mkdir(dirname(file), { recursive: true });
	await writeFile(temp, `${original.trimEnd()}\n\n${lines.join("\n")}\n`, "utf8");
	await rename(temp, file);
}

async function recordFailure(
	ports: SourceArchivePorts,
	manifestPath: string,
	failuresPath: string,
	runDir: string,
	failure: any,
) {
	return withRunLock(ports, manifestPath, async () => {
		const manifest = await readManifest(manifestPath, runDir);
		manifest.updated_at = failure.failed_at;
		manifest.failures = Array.isArray(manifest.failures) ? manifest.failures : [];
		manifest.failures.push(failure);
		await atomicJson(manifestPath, manifest);
		await appendFailure(failuresPath, failure);
	});
}

async function readBody(response: any, maxBytes: number): Promise<Uint8Array> {
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > maxBytes)
		throw new Error(`response exceeds max_bytes (${maxBytes})`);
	if (!response.body) {
		const array = new Uint8Array(await response.arrayBuffer());
		if (array.byteLength > maxBytes) throw new Error(`response exceeds max_bytes (${maxBytes})`);
		return array;
	}
	const reader = response.body.getReader();
	const chunks = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > maxBytes) {
			await reader.cancel();
			throw new Error(`response exceeds max_bytes (${maxBytes})`);
		}
		chunks.push(value);
	}
	const result = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

/** First bytes of a challenge or HTML response, without pulling the rest of a large error page. */
async function readPrefix(response: any, maxBytes: number): Promise<Uint8Array> {
	if (!response.body?.getReader) {
		const array = new Uint8Array(await response.arrayBuffer());
		return array.subarray(0, maxBytes);
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (size < maxBytes) {
			const { done, value } = await reader.read();
			if (done || !value) break;
			const room = maxBytes - size;
			const slice = value.byteLength > room ? value.subarray(0, room) : value;
			chunks.push(slice);
			size += slice.byteLength;
		}
	} finally {
		try {
			await reader.cancel();
		} catch {
			/* the prefix is enough */
		}
	}
	const result = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

function institutionalText(inst: any): { contentType: string; snippet: string } {
	const headers = inst?.headers;
	let contentType = "";
	if (headers && typeof headers.get === "function") contentType = String(headers.get("content-type") || "");
	else if (headers && typeof headers === "object") {
		const found = Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type");
		contentType = found ? String(found[1] ?? "") : "";
	}
	let snippet = "";
	try {
		const body = inst?.body;
		const bytes = body instanceof Uint8Array ? body : body ? new Uint8Array(body) : new Uint8Array();
		snippet = new TextDecoder().decode(bytes.subarray(0, 8192));
	} catch {
		snippet = "";
	}
	return { contentType, snippet };
}

export async function archiveSource(
	options: ArchiveOptions = {},
	ports: SourceArchivePorts,
): Promise<Record<string, any>> {
	if (!ports) throw new Error("Source archive host ports are required");
	const {
		cwd = process.cwd(),
		run_dir,
		url,
		doi,
		pmcid,
		pmid,
		email,
		resolve_open_access,
		max_candidates = OA_MAX_CANDIDATES,
		category = "papers",
		filename,
		metadata,
		local_file,
		human_verified = false,
		content_type,
		max_bytes = DEFAULT_MAX_BYTES,
		timeout_ms = DEFAULT_TIMEOUT_MS,
		fetchImpl = globalThis.fetch,
		signal,
		env = process.env,
	} = options;
	if (!SOURCE_CATEGORIES.includes(category))
		throw new Error(`category must be one of: ${SOURCE_CATEGORIES.join(", ")}`);
	// 身份（DOI / PMCID / PMID）来自参数或 metadata；papers 可以只给身份，由合法 OA 来源解析 PDF 位置
	const identity: Record<string, any> = {
		doi: normalizeDoi(doi || metadata?.doi),
		pmcid: normalizePmcid(pmcid || metadata?.pmcid),
		pmid: normalizePmid(pmid || metadata?.pmid),
	};
	const hasIdentity = Boolean(identity.doi || identity.pmcid || identity.pmid);
	if (url == null && !(category === "papers" && hasIdentity))
		throw new Error("url is required unless category is papers and a doi/pmcid/pmid is given");
	if (url != null && (typeof url !== "string" || !/^https?:\/\//i.test(url)))
		throw new Error("url must be an http(s) URL");
	if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
	const openAccessWanted = category === "papers" && hasIdentity && resolve_open_access !== false;
	const candidateLimit = Number(max_candidates);
	if (!Number.isInteger(candidateLimit) || candidateLimit < 1 || candidateLimit > OA_MAX_CANDIDATES)
		throw new Error(`max_candidates must be between 1 and ${OA_MAX_CANDIDATES}`);
	const config = await ports.workspace(cwd);
	const runDir = validateRunDir(config.resultsRoot, resolve(cwd, run_dir));
	await access(runDir);
	if (!isWithin(await realpath(config.resultsRoot), await realpath(runDir)))
		throw new Error("run_dir escapes results root through a link");
	const limit = Number(max_bytes);
	const timeout = Number(timeout_ms);
	if (!Number.isInteger(limit) || limit < 1 || limit > 500 * 1024 * 1024)
		throw new Error("max_bytes must be between 1 and 524288000");
	if (!Number.isInteger(timeout) || timeout < 100 || timeout > 10 * 60 * 1000)
		throw new Error("timeout_ms must be between 100 and 600000");
	const sourcesDir = join(runDir, "sources", category);
	const manifestPath = join(runDir, "sources", "download-manifest.json");
	const failuresPath = join(runDir, "sources", "download-failures.md");
	await mkdir(sourcesDir, { recursive: true });
	if (!isWithin(await realpath(runDir), await realpath(sourcesDir)))
		throw new Error("sources directory escapes the run through a link");
	const persist = async (
		bytes: Uint8Array,
		{ resolvedUrl, contentType, outputName, verified = false, openAccess = null }: Record<string, any>,
	) =>
		withRunLock(ports, manifestPath, async () => {
			const validation = validateContent(category, contentType, outputName, bytes);
			if (!validation.ok) throw new Error(validation.reason);
			const sha256 = createHash("sha256").update(bytes).digest("hex");
			const idempotencyKey = externalEffectKey("research.download", {
				category,
				identity,
				url: url ?? resolvedUrl,
				outputName,
			});
			let outputPath = join(sourcesDir, outputName);
			if (!isWithin(sourcesDir, outputPath)) throw new Error("filename escapes source category directory");
			try {
				const existing = new Uint8Array(await readFile(outputPath));
				const existingHash = createHash("sha256").update(existing).digest("hex");
				if (existingHash !== sha256) {
					const extension = extname(outputName);
					const stem = outputName.slice(0, outputName.length - extension.length);
					outputPath = join(sourcesDir, `${stem}-${sha256.slice(0, 12)}${extension}`);
				}
			} catch (error: any) {
				if (error.code !== "ENOENT") throw error;
			}
			try {
				const existing = await readFile(outputPath);
				if (createHash("sha256").update(existing).digest("hex") !== sha256)
					throw new Error("Archived version path has different content");
			} catch (error: any) {
				if (error.code !== "ENOENT") throw error;
				const temporary = `${outputPath}.${randomUUID()}.part`;
				await writeFile(temporary, bytes);
				await rename(temporary, outputPath);
			}
			const downloadedAt = new Date().toISOString();
			const entry = {
				...(category === "manuals"
					? { manualCoverage: assessManualPage(bytes, contentType, resolvedUrl) }
					: {}),
				id: randomUUID(),
				idempotency_key: idempotencyKey,
				status: "downloaded",
				category,
				// 仅凭 DOI 归档时没有调用方 URL：以实际取得文件的地址作为来源
				url: url ?? resolvedUrl,
				final_url: resolvedUrl,
				downloaded_at: downloadedAt,
				path: outputPath,
				local_path: outputPath,
				relative_path: relative(cwd, outputPath).replaceAll(sep, "/"),
				size_bytes: bytes.byteLength,
				sha256,
				content_type: contentType,
				human_verified: Boolean(verified),
				metadata: normalizeMetadata({
					...identity,
					...(metadata || {}),
					...(openAccess ? { open_access: openAccess } : {}),
				}),
			};
			const manifest = await readManifest(manifestPath, runDir);
			const prior = manifest.items.find((item: any) => item?.idempotency_key === idempotencyKey);
			if (prior) {
				if (prior.sha256 !== sha256)
					throw new Error(
						"Download idempotency key already exists with different content; reconcile the manifest first",
					);
				return { ...prior, manifest_path: manifestPath, manifestPath, idempotent_replay: true };
			}
			manifest.updated_at = downloadedAt;
			manifest.items = [...manifest.items, entry];
			await atomicJson(manifestPath, manifest);
			let knowledge: Record<string, unknown>;
			try {
				knowledge = await ports.publishSourceNote({ cwd, runDir, entry });
			} catch (error: any) {
				knowledge = { obsidian_note: null, knowledge_status: "failed", obsidian_error: error.message };
			}
			return {
				...entry,
				...knowledge,
				...(openAccess ? { open_access: openAccess } : {}),
				manifest_path: manifestPath,
				manifestPath,
				failures_path: await access(failuresPath).then(
					() => failuresPath,
					() => null,
				),
			};
		});
	if (local_file != null) {
		try {
			if (human_verified !== true) throw new Error("local_file imports require explicit human_verified=true");
			const downloadRoot = await realpath(resolve(cwd, ".pi", "browser-downloads"));
			const canonical = await realpath(resolve(cwd, local_file));
			if (!isWithin(downloadRoot, canonical))
				throw new Error("local_file must be inside .pi/browser-downloads");
			const bytes = new Uint8Array(await readFile(canonical));
			if (bytes.byteLength > limit) throw new Error(`local file exceeds max_bytes (${limit})`);
			const outputName = safeFilename(filename || basename(canonical), `${category}-${randomUUID()}.bin`);
			return await persist(bytes, {
				resolvedUrl:
					url ?? (identity.doi ? `https://doi.org/${identity.doi}` : `file:${basename(canonical)}`),
				contentType: content_type || metadata?.content_type || "application/octet-stream",
				outputName,
				verified: true,
			});
		} catch (error: any) {
			const failure = {
				url,
				category,
				failed_at: new Date().toISOString(),
				reason: error.message,
				browser_required: false,
				local_file,
			};
			await recordFailure(ports, manifestPath, failuresPath, runDir, failure);
			return { status: "failed", ...failure, manifest_path: manifestPath, failures_path: failuresPath };
		}
	}
	const handoff = (target: string) => ({
		url: target,
		action: "Open this URL in Computer Use browser, complete verification manually, then retry archive",
	});
	/** 一次网络下载：不落盘，只返回字节或失败原因（浏览器验证 / HTTP 错误 / 超时）。 */
	async function attemptDownload(target: string): Promise<any> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeout);
		const onAbort = () => controller.abort();
		signal?.addEventListener("abort", onAbort, { once: true });
		try {
			const response = await fetchImpl(target, {
				redirect: "follow",
				signal: controller.signal,
				headers: {
					accept:
						"application/pdf,application/zip,application/octet-stream,text/plain,text/markdown,text/html;q=0.8,*/*;q=0.1",
				},
			});
			const contentType = response.headers.get("content-type") || "application/octet-stream";
			const headers = response.headers;
			if (looksLikeCloudflare(headers, ""))
				return { kind: "cloudflare", reason: "Cloudflare browser verification" };
			const challengeStatus = [401, 403, 407, 429].includes(response.status);
			const html = contentType.toLowerCase().includes("text/html");
			if (challengeStatus) {
				const sample = new TextDecoder().decode(await readPrefix(response, 8192));
				if (looksLikeCloudflare(headers, sample))
					return { kind: "cloudflare", reason: "Cloudflare browser verification" };
				return {
					kind: "challenge",
					reason: `HTTP ${response.status} requires browser verification or login`,
				};
			}
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const bytes = await readBody(response, limit);
			const resolvedUrl = response.url || target;
			const sample = html ? new TextDecoder().decode(bytes.subarray(0, 8192)) : "";
			if (looksLikeCloudflare(headers, sample))
				return { kind: "cloudflare", reason: "Cloudflare browser verification" };
			if (looksLikeChallenge(response.status, contentType, sample))
				return { kind: "challenge", reason: "Response requires browser verification or login" };
			return { kind: "ok", bytes, resolvedUrl, contentType, response };
		} catch (error: any) {
			const browserRequired =
				error.name === "AbortError"
					? false
					: /HTTP (401|403|407|429)|cloudflare|captcha|login|required/i.test(error.message);
			return {
				kind: "error",
				reason: error.name === "AbortError" && signal?.aborted ? "aborted" : error.message,
				browserRequired,
			};
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		}
	}
	const needsBrowser = (attempt: any) =>
		attempt.kind === "challenge" || attempt.kind === "cloudflare" || attempt.browserRequired === true;
	const failureFor = (target: string, attempt: any) => ({
		url: target,
		category,
		failed_at: new Date().toISOString(),
		reason: attempt.reason,
		browser_required: needsBrowser(attempt),
		...(needsBrowser(attempt) ? { browser_handoff: handoff(target) } : {}),
	});
	// One Cloudflare card per archiveSource call. Continue retries only the URL that was shown.
	let cloudflareAsked = false;
	async function askCloudflareOnce(target: string): Promise<"continue" | "skip" | "unavailable"> {
		if (typeof ports.askCloudflare !== "function" || cloudflareAsked || signal?.aborted) return "unavailable";
		cloudflareAsked = true;
		try {
			const answer = await ports.askCloudflare(target, signal);
			return answer === "continue" ? "continue" : "skip";
		} catch {
			return "skip";
		}
	}
	async function resolveAttempt(target: string): Promise<any> {
		const attempt = await attemptDownload(target);
		if (attempt.kind !== "cloudflare") return attempt;
		if ((await askCloudflareOnce(target)) !== "continue") return { ...attempt, browserRequired: true };
		const retry = await attemptDownload(target);
		if (retry.kind === "cloudflare" || retry.kind === "challenge") return { ...retry, browserRequired: true };
		return retry;
	}
	const legacyFailure = async (failure: any) => {
		await recordFailure(ports, manifestPath, failuresPath, runDir, failure);
		return {
			status: failure.browser_required ? "browser_required" : "failed",
			...failure,
			manifest_path: manifestPath,
			failures_path: failuresPath,
		};
	};
	const attempts = [];
	// 1) 调用方给定的 URL：原有行为；papers 且已知身份时，失败后继续走合法 OA 解析
	if (url != null) {
		const attempt = await resolveAttempt(url);
		let failure = null;
		if (attempt.kind === "ok") {
			const outputName = safeFilename(
				filename || filenameFromResponse(attempt.response, attempt.resolvedUrl, category),
				`${category}-${randomUUID()}.bin`,
			);
			try {
				return await persist(attempt.bytes, {
					resolvedUrl: attempt.resolvedUrl,
					contentType: attempt.contentType,
					outputName,
				});
			} catch (error: any) {
				failure = failureFor(url, {
					kind: "error",
					reason: error.message,
					browserRequired: /HTTP (401|403|407|429)|cloudflare|captcha|login|required/i.test(error.message),
				});
			}
		} else failure = failureFor(url, attempt);
		if (!openAccessWanted) return legacyFailure(failure);
		attempts.push({
			url,
			source: "given",
			reason: failure.reason,
			browser_required: failure.browser_required,
		});
	}
	// 2) 合法开放获取来源解析（Europe PMC / PMC OA / Unpaywall / OpenAlex / Semantic Scholar / Crossref）
	let resolution: any;
	try {
		resolution = await resolveOpenAccess({
			...identity,
			email,
			fetchImpl,
			signal,
			env,
			timeoutMs: Math.min(timeout, 15_000),
			maxCandidates: candidateLimit,
		});
	} catch (error: any) {
		resolution = {
			...identity,
			candidates: [],
			queried: [{ source: "resolver", status: "error", detail: error.message }],
		};
	}
	// 解析补全的身份（如 DOI → PMCID）一并进入归档元数据
	for (const key of ["doi", "pmcid", "pmid"]) identity[key] = identity[key] || resolution[key] || null;
	for (const candidate of resolution.candidates.slice(0, candidateLimit)) {
		if (signal?.aborted) break;
		const attempt = await resolveAttempt(candidate.url);
		if (attempt.kind !== "ok") {
			attempts.push({
				url: candidate.url,
				source: candidate.source,
				reason: attempt.reason,
				browser_required: needsBrowser(attempt),
			});
			continue;
		}
		const outputName = safeFilename(
			filename || filenameFromResponse(attempt.response, attempt.resolvedUrl, category),
			`${category}-${randomUUID()}.bin`,
		);
		try {
			return await persist(attempt.bytes, {
				resolvedUrl: attempt.resolvedUrl,
				contentType: attempt.contentType,
				outputName: /\.pdf$/i.test(outputName)
					? outputName
					: `${outputName.replace(/\.[a-z0-9]{1,5}$/i, "")}.pdf`,
				openAccess: {
					source: candidate.source,
					url: candidate.url,
					license: candidate.license || resolution.license || null,
					version: candidate.version || null,
					oa_status: resolution.oaStatus || null,
					candidates_tried: attempts.length + 1,
				},
			});
		} catch (error: any) {
			attempts.push({
				url: candidate.url,
				source: candidate.source,
				reason: error.message,
				browser_required: false,
			});
		}
	}
	// 2.5) 机构访问通道（合法机构会话 + EZproxy 模板）：仅当配置允许且未超限时尝试
	const _institutionalResult = null;
	let institutionalConfig: any = null;
	try {
		institutionalConfig = (await ports.loadInstitutionalConfig?.()) || null;
	} catch {
		institutionalConfig = null;
	}
	const institutionalEnabled =
		institutionalConfig?.autoDownloadEnabled !== false && institutionalConfig?.configured;
	if (institutionalEnabled && (ports.isElectronAvailable?.() ?? false) && ports.institutionalFetch) {
		// 检查每任务上限
		const limit = institutionalConfig?.perTaskLimit ?? 20;
		let used = 0;
		try {
			const manifest = await readManifest(manifestPath, runDir);
			used = manifest.items.filter((it: any) => it.open_access?.source === "institutional").length;
		} catch {
			used = 0;
		}
		if (used >= limit) {
			const failureLimit = {
				url: url || `https://doi.org/${identity.doi || ""}`.replace(/\/$/, ""),
				category,
				failed_at: new Date().toISOString(),
				reason: `institutional limit reached: ${used}/${limit} files already fetched via institutional access in this run`,
				browser_required: false,
				open_access: {
					doi: identity.doi,
					pmcid: resolution.pmcid || identity.pmcid,
					pmid: resolution.pmid || identity.pmid,
					oa_status: resolution.oaStatus || null,
					license: resolution.license || null,
					queried: resolution.queried,
					attempts,
				},
				institutional: {
					limit,
					used,
					status: "limit_reached",
				},
			};
			await recordFailure(ports, manifestPath, failuresPath, runDir, failureLimit);
			return {
				status: "institutional_limit_reached",
				...failureLimit,
				manifest_path: manifestPath,
				failures_path: failuresPath,
			};
		}

		const candidates = [];
		// Build proxied URLs for original url and OA candidates that failed
		const originalForProxy = url || (identity.doi ? `https://doi.org/${identity.doi}` : null);
		const urlsToTry = [];
		if (originalForProxy) urlsToTry.push(originalForProxy);
		for (const c of resolution.candidates.slice(0, candidateLimit)) {
			if (c.url && !urlsToTry.includes(c.url)) urlsToTry.push(c.url);
		}
		// Also try doi.org directly
		if (identity.doi) {
			const doiUrl = `https://doi.org/${identity.doi}`;
			if (!urlsToTry.includes(doiUrl)) urlsToTry.push(doiUrl);
		}

		for (const u of urlsToTry) {
			const proxied =
				institutionalConfig.ezproxyTemplate && ports.buildProxiedUrl
					? ports.buildProxiedUrl(u, String(institutionalConfig.ezproxyTemplate))
					: null;
			if (proxied) candidates.push({ url: proxied, via: "ezproxy", original: u });
			candidates.push({ url: u, via: "institutional_session", original: u });
		}

		for (const cand of candidates) {
			if (signal?.aborted) break;
			try {
				let inst = await ports.institutionalFetch(cand.url, { timeoutMs: Math.min(timeout, 20000) });
				let viewed = institutionalText(inst);
				if (looksLikeCloudflare(inst.headers, viewed.snippet)) {
					const choice = await askCloudflareOnce(cand.url);
					let stillCloudflare = true;
					if (choice === "continue") {
						inst = await ports.institutionalFetch(cand.url, { timeoutMs: Math.min(timeout, 20000) });
						viewed = institutionalText(inst);
						stillCloudflare = looksLikeCloudflare(inst.headers, viewed.snippet);
					}
					if (stillCloudflare) {
						attempts.push({
							url: cand.url,
							source: cand.via === "ezproxy" ? "ezproxy" : "institutional_session",
							reason: "Cloudflare browser verification",
							browser_required: true,
							cloudflare: true,
						});
						continue;
					}
				}
				if (inst.status >= 200 && inst.status < 400) {
					const ct = viewed.contentType || inst.headers?.["content-type"] || "";
					const _isPdf = ct.includes("pdf") || cand.url.toLowerCase().includes(".pdf");
					const isHtmlLogin =
						ct.includes("text/html") &&
						inst.body?.byteLength < 100000 &&
						(() => {
							try {
								const snippet = new TextDecoder().decode(inst.body.slice(0, 4000)).toLowerCase();
								return (
									snippet.includes("shibboleth") ||
									(snippet.includes("login") && snippet.includes("password")) ||
									(snippet.includes("openathens") && snippet.includes("sign in")) ||
									(snippet.includes("ezproxy") && snippet.includes("login"))
								);
							} catch {
								return false;
							}
						})();
					if (isHtmlLogin) {
						attempts.push({
							url: cand.url,
							source: cand.via === "ezproxy" ? "ezproxy" : "institutional_session",
							reason: `institutional auth required (login page detected at ${cand.url.slice(0, 120)})`,
							browser_required: true,
						});
						continue;
					}
					// If we got something, try to persist
					const outputName = safeFilename(
						filename ||
							filenameFromResponse(
								{ headers: { get: (k: string) => inst.headers[k.toLowerCase()] || "" } },
								inst.finalUrl,
								category,
							),
						`${category}-${randomUUID()}.bin`,
					);
					try {
						return await persist(inst.body, {
							resolvedUrl: inst.finalUrl,
							contentType: ct || "application/pdf",
							outputName: /\.pdf$/i.test(outputName)
								? outputName
								: `${outputName.replace(/\.[a-z0-9]{1,5}$/i, "")}.pdf`,
							openAccess: {
								source: "institutional",
								url: cand.url,
								original_url: cand.original,
								via: cand.via,
								candidates_tried: attempts.length + 1,
							},
						});
					} catch (error: any) {
						attempts.push({
							url: cand.url,
							source: cand.via === "ezproxy" ? "ezproxy" : "institutional_session",
							reason: error.message,
							browser_required: false,
						});
					}
				}
			} catch (error: any) {
				attempts.push({
					url: cand.url,
					source: cand.via === "ezproxy" ? "ezproxy" : "institutional_session",
					reason: error.message,
					browser_required: /HTTP (401|403|407|429)|login|auth|shibboleth|captcha/i.test(error.message),
				});
			}
		}
	}

	// 3) 没有合法 OA 版本：如实记录一次；闭源文献只能由用户用自己的访问权限下载后以 local_file 导入
	const challenged = attempts.find((a) => a.browser_required);
	const label = identity.doi ? `doi:${identity.doi}` : identity.pmcid || `pmid:${identity.pmid}`;
	const institutionalAttempt = attempts.find(
		(a) => (a.source === "ezproxy" || a.source === "institutional_session") && a.cloudflare !== true,
	);
	const failure = {
		url: url || `https://doi.org/${identity.doi || ""}`.replace(/\/$/, ""),
		category,
		failed_at: new Date().toISOString(),
		reason: resolution.candidates.length
			? `no open-access PDF could be archived for ${label}: ${attempts.length} candidate(s) failed`
			: `no open-access location found for ${label} (${resolution.queried.map((q: any) => `${q.source}:${q.status}`).join(", ") || "no source answered"})`,
		browser_required: Boolean(challenged),
		...(challenged ? { browser_handoff: handoff(challenged.url) } : {}),
		open_access: {
			doi: identity.doi,
			pmcid: resolution.pmcid || identity.pmcid,
			pmid: resolution.pmid || identity.pmid,
			oa_status: resolution.oaStatus || null,
			license: resolution.license || null,
			queried: resolution.queried,
			attempts,
		},
		institutional: institutionalConfig
			? {
					configured: Boolean(institutionalConfig.configured),
					auto_enabled: institutionalConfig.autoDownloadEnabled,
					ezproxy_template: institutionalConfig.ezproxyTemplate ? "set" : "not_set",
					attempted: Boolean(institutionalAttempt),
					last_login_at: institutionalConfig.lastLoginAt || null,
				}
			: { configured: false },
		manual_import: {
			how: "If you have legitimate access (institutional login, purchase or the author's copy), download the PDF in your own browser, place it under .pi/browser-downloads, then call research_archive_source with local_file and human_verified=true. Or configure institutional access in Settings → Zotero panel → Institutional Access and log in once. Do not use pirate mirrors.",
			task_wait: { kind: "download", doi: identity.doi, title: resolution.title || null },
			institutional_login: institutionalConfig?.configured
				? {
						action: "open_login",
						hint: "Institutional session may have expired; open Settings → Zotero → Institutional Access → Login",
					}
				: {
						action: "configure",
						hint: "Set EZproxy template or log in via institutional browser in Settings",
					},
		},
	};
	await recordFailure(ports, manifestPath, failuresPath, runDir, failure);
	// If institutional was configured but auth failed, surface as institutional_auth_required so UI can prompt login
	if (institutionalConfig?.configured && institutionalAttempt && challenged) {
		return {
			status: "institutional_auth_required",
			...failure,
			manifest_path: manifestPath,
			failures_path: failuresPath,
		};
	}
	return { status: "no_open_access", ...failure, manifest_path: manifestPath, failures_path: failuresPath };
}

export async function sourceStatus(
	options: ArchiveOptions = {},
	ports: SourceArchivePorts,
): Promise<Record<string, any>> {
	if (!ports) throw new Error("Source archive host ports are required");
	const { cwd = process.cwd(), run_dir } = options;
	const config = await ports.workspace(cwd);
	const runDir = run_dir ? validateRunDir(config.resultsRoot, resolve(cwd, run_dir)) : null;
	if (!runDir) return { results_root: config.resultsRoot, categories: SOURCE_CATEGORIES, run_dir: null };
	const manifestPath = join(runDir, "sources", "download-manifest.json");
	const failuresPath = join(runDir, "sources", "download-failures.md");
	const manifest = await readManifest(manifestPath, runDir);
	let failures = "";
	try {
		failures = await readFile(failuresPath, "utf8");
	} catch (error: any) {
		if (error.code !== "ENOENT") throw error;
	}
	const manifestExists = await access(manifestPath).then(
		() => true,
		() => false,
	);
	const failuresExists = await access(failuresPath).then(
		() => true,
		() => false,
	);
	return {
		run_dir: runDir,
		manifest_path: manifestExists ? manifestPath : null,
		failures_path: failuresExists ? failuresPath : null,
		manifest,
		failure_count: manifest.failures?.length ?? Math.max(0, (failures.match(/^## /gm) || []).length),
		...(options.verify ? { verification: await verifyManifestItems(manifest, runDir) } : {}),
	};
}

export default { archiveSource, sourceStatus };
