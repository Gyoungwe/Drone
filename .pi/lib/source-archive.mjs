import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadWorkspaceConfig } from "../extensions/workspace-config.mjs";
import { normalizeDoi } from "./literature-receipt.mjs";
import { publishSourceNote } from "./obsidian-workbench.mjs";
import { normalizePmcid, normalizePmid, OA_MAX_CANDIDATES, resolveOpenAccess } from "./open-access.mjs";
import { assessManualPage } from "./source-delivery.mjs";

export const SOURCE_CATEGORIES = Object.freeze(["papers", "supplementary", "software", "manuals"]);
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 30_000;

function isWithin(root, child) {
	const rel = relative(resolve(root), resolve(child));
	return (
		rel === "" ||
		(!isAbsolute(rel) && !rel.startsWith(`..${sep}`) && rel !== ".." && !rel.includes(`..${sep}`))
	);
}

function validateRunDir(resultsRoot, candidate) {
	const runDir = resolve(candidate);
	const rel = relative(resolve(resultsRoot), runDir);
	const parts = rel.split(sep);
	if (!rel || !isWithin(resultsRoot, runDir) || parts.length !== 2 || !parts[1].startsWith("run-")) {
		throw new Error("run_dir must point to a run directory directly inside the configured results root");
	}
	return runDir;
}

function safeFilename(input, fallback) {
	const value = String(input || "").trim();
	const candidate = [...basename(value)]
		.map((char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? "-" : char))
		.join("")
		.replace(/\s+/g, " ")
		.trim();
	if (!candidate || candidate === "." || candidate === "..") return fallback;
	return candidate.slice(0, 180);
}

function filenameFromResponse(response, url, category) {
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

function looksLikeChallenge(status, contentType, sample) {
	if ([401, 403, 407, 429].includes(status)) return true;
	if (!contentType.includes("text/html")) return false;
	return /cf-chl|cloudflare|captcha|verify you are human|access denied|sign in|log in|login required/i.test(
		sample,
	);
}

function hasMagic(bytes) {
	if (bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-") return true;
	if (
		bytes.length >= 4 &&
		bytes[0] === 0x50 &&
		bytes[1] === 0x4b &&
		(bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
	)
		return true;
	if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return true;
	return false;
}

function validateContent(category, contentType, filename, bytes) {
	const mime = contentType.toLowerCase().split(";", 1)[0].trim();
	const head = new TextDecoder().decode(bytes.subarray(0, 16));
	const executable =
		/\.(?:exe|dll|msi|com|bat|cmd|ps1|sh)$/i.test(filename) ||
		/application\/(?:x-msdownload|x-dosexec)/.test(mime);
	if (executable) return { ok: false, reason: "executable content is not archived" };
	if (category === "papers" && !head.startsWith("%PDF-")) {
		return { ok: false, reason: "papers must be PDF content" };
	}
	if (
		category === "supplementary" &&
		!(mime.includes("pdf") || mime.includes("zip") || mime.includes("gzip") || hasMagic(bytes))
	) {
		return { ok: false, reason: "unsupported supplementary MIME or file signature" };
	}
	if (category === "software" && mime === "text/html")
		return { ok: false, reason: "HTML is not a software archive" };
	if (category === "manuals" && !mime && !bytes.length) return { ok: false, reason: "empty manual content" };
	return { ok: true, mime };
}

async function atomicJson(file, value) {
	await mkdir(dirname(file), { recursive: true });
	const temp = `${file}.${randomUUID()}.tmp`;
	await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	await rename(temp, file);
}

const RUN_LOCKS = new Map();
async function withRunLock(key, fn) {
	const prior = RUN_LOCKS.get(key) || Promise.resolve();
	const current = prior.catch(() => {}).then(fn);
	RUN_LOCKS.set(key, current);
	try {
		return await current;
	} finally {
		if (RUN_LOCKS.get(key) === current) RUN_LOCKS.delete(key);
	}
}

async function readManifest(file, runDir) {
	try {
		const parsed = JSON.parse(await readFile(file, "utf8"));
		if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items))
			throw new Error("invalid manifest");
		return parsed;
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		return { version: 1, run_dir: runDir, updated_at: null, items: [] };
	}
}

async function appendFailure(file, failure) {
	let original = "# Source download failures\n\n";
	try {
		original = await readFile(file, "utf8");
	} catch (error) {
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
				.map((q) => `${q.source}:${q.status}`)
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

async function recordFailure(manifestPath, failuresPath, runDir, failure) {
	return withRunLock(manifestPath, async () => {
		const manifest = await readManifest(manifestPath, runDir);
		manifest.updated_at = failure.failed_at;
		manifest.failures = Array.isArray(manifest.failures) ? manifest.failures : [];
		manifest.failures.push(failure);
		await atomicJson(manifestPath, manifest);
		await appendFailure(failuresPath, failure);
	});
}

async function readBody(response, maxBytes) {
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

function normaliseMetadata(metadata = {}) {
	const allowed = [
		"doi",
		"pmid",
		"pmcid",
		"commit",
		"version",
		"license",
		"title",
		"authors",
		"repository",
		"open_access",
	];
	return Object.fromEntries(
		allowed
			.filter((key) => metadata[key] != null && String(metadata[key]).trim() !== "")
			.map((key) => [key, metadata[key]]),
	);
}

export async function archiveSource({
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
} = {}) {
	if (!SOURCE_CATEGORIES.includes(category))
		throw new Error(`category must be one of: ${SOURCE_CATEGORIES.join(", ")}`);
	// 身份（DOI / PMCID / PMID）来自参数或 metadata；papers 可以只给身份，由合法 OA 来源解析 PDF 位置
	const identity = {
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
	const config = await loadWorkspaceConfig(cwd);
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
		bytes,
		{ resolvedUrl, contentType, outputName, verified = false, openAccess = null },
	) =>
		withRunLock(manifestPath, async () => {
			const validation = validateContent(category, contentType, outputName, bytes);
			if (!validation.ok) throw new Error(validation.reason);
			const sha256 = createHash("sha256").update(bytes).digest("hex");
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
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
			try {
				const existing = await readFile(outputPath);
				if (createHash("sha256").update(existing).digest("hex") !== sha256)
					throw new Error("Archived version path has different content");
			} catch (error) {
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
				status: "downloaded",
				category,
				url,
				final_url: resolvedUrl,
				downloaded_at: downloadedAt,
				path: outputPath,
				local_path: outputPath,
				relative_path: relative(cwd, outputPath).replaceAll(sep, "/"),
				size_bytes: bytes.byteLength,
				sha256,
				content_type: contentType,
				human_verified: Boolean(verified),
				metadata: normaliseMetadata({
					...identity,
					...(metadata || {}),
					...(openAccess ? { open_access: openAccess } : {}),
				}),
			};
			const manifest = await readManifest(manifestPath, runDir);
			manifest.updated_at = downloadedAt;
			manifest.items = [...manifest.items, entry];
			await atomicJson(manifestPath, manifest);
			let knowledge;
			try {
				knowledge = await publishSourceNote({ cwd, runDir, entry });
			} catch (error) {
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
				resolvedUrl: url,
				contentType: content_type || metadata?.content_type || "application/octet-stream",
				outputName,
				verified: true,
			});
		} catch (error) {
			const failure = {
				url,
				category,
				failed_at: new Date().toISOString(),
				reason: error.message,
				browser_required: false,
				local_file,
			};
			await recordFailure(manifestPath, failuresPath, runDir, failure);
			return { status: "failed", ...failure, manifest_path: manifestPath, failures_path: failuresPath };
		}
	}
	const handoff = (target) => ({
		url: target,
		action: "Open this URL in Computer Use browser, complete verification manually, then retry archive",
	});
	/** 一次网络下载：不落盘，只返回字节或失败原因（浏览器验证 / HTTP 错误 / 超时）。 */
	async function attemptDownload(target) {
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
			if (looksLikeChallenge(response.status, contentType, ""))
				return {
					kind: "challenge",
					reason: `HTTP ${response.status} requires browser verification or login`,
				};
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const bytes = await readBody(response, limit);
			const resolvedUrl = response.url || target;
			const sample = contentType.includes("text/html")
				? new TextDecoder().decode(bytes.subarray(0, 8192))
				: "";
			if (looksLikeChallenge(response.status, contentType, sample))
				return { kind: "challenge", reason: "Response requires browser verification or login" };
			return { kind: "ok", bytes, resolvedUrl, contentType, response };
		} catch (error) {
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
	const failureFor = (target, attempt) => ({
		url: target,
		category,
		failed_at: new Date().toISOString(),
		reason: attempt.reason,
		browser_required: attempt.kind === "challenge" || attempt.browserRequired === true,
		...(attempt.kind === "challenge" || attempt.browserRequired ? { browser_handoff: handoff(target) } : {}),
	});
	const legacyFailure = async (failure) => {
		await recordFailure(manifestPath, failuresPath, runDir, failure);
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
		const attempt = await attemptDownload(url);
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
			} catch (error) {
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
	let resolution;
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
	} catch (error) {
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
		const attempt = await attemptDownload(candidate.url);
		if (attempt.kind !== "ok") {
			attempts.push({
				url: candidate.url,
				source: candidate.source,
				reason: attempt.reason,
				browser_required: attempt.kind === "challenge" || attempt.browserRequired === true,
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
		} catch (error) {
			attempts.push({
				url: candidate.url,
				source: candidate.source,
				reason: error.message,
				browser_required: false,
			});
		}
	}
	// 3) 没有合法 OA 版本：如实记录一次；闭源文献只能由用户用自己的访问权限下载后以 local_file 导入
	const challenged = attempts.find((a) => a.browser_required);
	const label = identity.doi ? `doi:${identity.doi}` : identity.pmcid || `pmid:${identity.pmid}`;
	const failure = {
		url: url || `https://doi.org/${identity.doi || ""}`.replace(/\/$/, ""),
		category,
		failed_at: new Date().toISOString(),
		reason: resolution.candidates.length
			? `no open-access PDF could be archived for ${label}: ${attempts.length} candidate(s) failed`
			: `no open-access location found for ${label} (${resolution.queried.map((q) => `${q.source}:${q.status}`).join(", ") || "no source answered"})`,
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
		manual_import: {
			how: "If you have legitimate access (institutional login, purchase or the author's copy), download the PDF in your own browser, place it under .pi/browser-downloads, then call research_archive_source with local_file and human_verified=true. Do not use pirate mirrors.",
			task_wait: { kind: "download", doi: identity.doi, title: resolution.title || null },
		},
	};
	await recordFailure(manifestPath, failuresPath, runDir, failure);
	return { status: "no_open_access", ...failure, manifest_path: manifestPath, failures_path: failuresPath };
}

export async function sourceStatus({ cwd = process.cwd(), run_dir } = {}) {
	const config = await loadWorkspaceConfig(cwd);
	const runDir = run_dir ? validateRunDir(config.resultsRoot, resolve(cwd, run_dir)) : null;
	if (!runDir) return { results_root: config.resultsRoot, categories: SOURCE_CATEGORIES, run_dir: null };
	const manifestPath = join(runDir, "sources", "download-manifest.json");
	const failuresPath = join(runDir, "sources", "download-failures.md");
	const manifest = await readManifest(manifestPath, runDir);
	let failures = "";
	try {
		failures = await readFile(failuresPath, "utf8");
	} catch (error) {
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
	};
}

export default { archiveSource, sourceStatus };
