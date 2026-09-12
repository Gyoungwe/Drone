import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadWorkspaceConfig } from "../extensions/workspace-config.mjs";
import { publishSourceNote } from "./obsidian-workbench.mjs";
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
	const allowed = ["doi", "pmid", "commit", "version", "license", "title", "authors", "repository"];
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
	category = "papers",
	filename,
	metadata,
	local_file,
	human_verified = false,
	content_type,
	max_bytes = DEFAULT_MAX_BYTES,
	timeout_ms = DEFAULT_TIMEOUT_MS,
	fetchImpl = globalThis.fetch,
} = {}) {
	if (!SOURCE_CATEGORIES.includes(category))
		throw new Error(`category must be one of: ${SOURCE_CATEGORIES.join(", ")}`);
	if (typeof url !== "string" || !/^https?:\/\//i.test(url)) throw new Error("url must be an http(s) URL");
	if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
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
	const persist = async (bytes, { resolvedUrl, contentType, outputName, verified = false }) =>
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
				metadata: normaliseMetadata(metadata),
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
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);
	let response;
	try {
		response = await fetchImpl(url, {
			redirect: "follow",
			signal: controller.signal,
			headers: {
				accept:
					"application/pdf,application/zip,application/octet-stream,text/plain,text/markdown,text/html;q=0.8,*/*;q=0.1",
			},
		});
		const contentType = response.headers.get("content-type") || "application/octet-stream";
		if (looksLikeChallenge(response.status, contentType, "")) {
			const failure = {
				url,
				category,
				failed_at: new Date().toISOString(),
				reason: `HTTP ${response.status} requires browser verification or login`,
				browser_required: true,
				browser_handoff: {
					url,
					action: "Open this URL in Computer Use browser, complete verification manually, then retry archive",
				},
			};
			await recordFailure(manifestPath, failuresPath, runDir, failure);
			return {
				status: "browser_required",
				browser_required: true,
				...failure,
				manifest_path: manifestPath,
				failures_path: failuresPath,
			};
		}
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const bytes = await readBody(response, limit);
		const resolvedUrl = response.url || url;
		const outputName = safeFilename(
			filename || filenameFromResponse(response, resolvedUrl, category),
			`${category}-${randomUUID()}.bin`,
		);
		const sample = contentType.includes("text/html") ? new TextDecoder().decode(bytes.subarray(0, 8192)) : "";
		if (looksLikeChallenge(response.status, contentType, sample)) {
			const failure = {
				url,
				category,
				failed_at: new Date().toISOString(),
				reason: "Response requires browser verification or login",
				browser_required: true,
				browser_handoff: {
					url,
					action: "Open this URL in Computer Use browser, complete verification manually, then retry archive",
				},
			};
			await recordFailure(manifestPath, failuresPath, runDir, failure);
			return {
				status: "browser_required",
				browser_required: true,
				...failure,
				manifest_path: manifestPath,
				failures_path: failuresPath,
			};
		}
		return await persist(bytes, { resolvedUrl, contentType, outputName });
	} catch (error) {
		const browserRequired =
			error.name === "AbortError"
				? false
				: /HTTP (401|403|407|429)|cloudflare|captcha|login|required/i.test(error.message);
		const failure = {
			url,
			category,
			failed_at: new Date().toISOString(),
			reason: error.message,
			browser_required: browserRequired,
			...(browserRequired
				? {
						browser_handoff: {
							url,
							action:
								"Open this URL in Computer Use browser, complete verification manually, then retry archive",
						},
					}
				: {}),
		};
		await recordFailure(manifestPath, failuresPath, runDir, failure);
		return { status: "failed", ...failure, manifest_path: manifestPath, failures_path: failuresPath };
	} finally {
		clearTimeout(timer);
	}
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
