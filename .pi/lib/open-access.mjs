import { normalizeDoi } from "./literature-receipt.mjs";

/**
 * 合法开放获取（OA）全文定位：只查询公开、许可明确的元数据服务，按可信度排序给出 PDF 候选。
 *
 * 来源（全部是公开 API / 出版者或存储库自己提供的文件，不接触任何影子图书馆）：
 *   1. Europe PMC   — DOI/PMID → PMCID、OA 标记、许可；OA 文章的渲染 PDF 与 JATS XML
 *   2. PMC OA 服务   — PMC 开放获取子集的官方 PDF 文件（FTP 镜像的 https 路径）
 *   3. Unpaywall     — 出版者 / 机构库 / 预印本的合法 OA 位置（需要联系邮箱）
 *   4. OpenAlex      — 同上，含 arXiv / bioRxiv / medRxiv 等仓储位置
 *   5. Semantic Scholar — openAccessPdf
 *   6. Crossref      — 出版者登记的全文链接（可能受订阅限制；失败即失败，不绕过）
 *
 * 这里只产生候选与查询记录，不下载正文；下载、校验（必须是 PDF 字节）与归档在 source-archive.mjs。
 * 找不到 OA 版本时如实返回 not-found：闭源文献只能由用户用自己的访问权限下载后以 local_file 导入。
 */
export const OA_SOURCES = Object.freeze([
	"europepmc",
	"pmc-oa",
	"unpaywall",
	"openalex",
	"semanticscholar",
	"crossref",
]);
export const OA_DEFAULT_TIMEOUT_MS = 12_000;
export const OA_MAX_CANDIDATES = 8;
const DEFAULT_EMAIL_ENV = ["DRONE_CONTACT_EMAIL", "UNPAYWALL_EMAIL"];

export function normalizePmcid(value) {
	const raw = String(value || "")
		.trim()
		.toUpperCase();
	const match = raw.match(/^(?:PMC)?(\d{1,9})$/);
	return match ? `PMC${match[1]}` : null;
}
export function normalizePmid(value) {
	const raw = String(value || "").trim();
	return /^\d{1,9}$/.test(raw) ? raw : null;
}
/** 联系邮箱：参数 → 环境变量；Unpaywall 要求提供，OpenAlex 用它进入礼貌池。 */
export function contactEmail(explicit, env = process.env) {
	const candidates = [explicit, ...DEFAULT_EMAIL_ENV.map((key) => env[key])];
	for (const value of candidates) {
		const email = String(value || "").trim();
		if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
	}
	return null;
}

const httpsUrl = (value) => {
	const text = String(value || "").trim();
	if (!/^https?:\/\//i.test(text)) return null;
	try {
		const url = new URL(text);
		if (url.protocol === "ftp:") return null;
		return url.href;
	} catch {
		return null;
	}
};
/** PMC 的 FTP 链接有同路径的 https 镜像。 */
const pmcFtpToHttps = (value) =>
	String(value || "").replace(/^ftp:\/\/ftp\.ncbi\.nlm\.nih\.gov\//i, "https://ftp.ncbi.nlm.nih.gov/");

async function fetchJson(fetchImpl, url, { timeoutMs, signal, accept = "application/json" }) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const onAbort = () => controller.abort();
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		const response = await fetchImpl(url, {
			signal: controller.signal,
			headers: { accept },
			redirect: "follow",
		});
		const text = await response.text();
		if (!response.ok) return { ok: false, status: response.status, detail: `HTTP ${response.status}` };
		if (accept === "application/json") {
			try {
				return { ok: true, status: response.status, body: JSON.parse(text) };
			} catch {
				return { ok: false, status: response.status, detail: "invalid JSON" };
			}
		}
		return { ok: true, status: response.status, body: text };
	} catch (error) {
		return {
			ok: false,
			status: 0,
			detail: error?.name === "AbortError" ? "timeout" : error?.message || "fetch failed",
		};
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}

function makeCollector(limit) {
	const seen = new Set();
	const candidates = [];
	return {
		candidates,
		add(candidate) {
			const url = httpsUrl(candidate?.url);
			if (!url || seen.has(url) || candidates.length >= limit) return false;
			seen.add(url);
			candidates.push({
				url,
				source: candidate.source,
				kind: candidate.kind || "pdf",
				license: candidate.license || null,
				version: candidate.version || null,
				hostType: candidate.hostType || null,
				note: candidate.note || null,
			});
			return true;
		},
	};
}

/**
 * 解析开放获取候选。返回 { doi, pmcid, pmid, oaStatus, license, candidates[], queried[] }。
 * 每个来源独立超时、独立失败；来源顺序即候选顺序（Europe PMC / PMC 官方文件优先于聚合器）。
 */
export async function resolveOpenAccess({
	doi,
	pmcid,
	pmid,
	email,
	fetchImpl = globalThis.fetch,
	timeoutMs = OA_DEFAULT_TIMEOUT_MS,
	signal,
	sources = OA_SOURCES,
	maxCandidates = OA_MAX_CANDIDATES,
	env = process.env,
} = {}) {
	if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
	const identity = { doi: normalizeDoi(doi), pmcid: normalizePmcid(pmcid), pmid: normalizePmid(pmid) };
	if (!identity.doi && !identity.pmcid && !identity.pmid)
		throw new Error("open-access resolution needs a DOI, PMCID or PMID");
	const enabled = new Set(sources);
	const mail = contactEmail(email, env);
	const collector = makeCollector(maxCandidates);
	const queried = [];
	const meta = { oaStatus: null, license: null, title: null };
	const note = (source, status, detail) => queried.push({ source, status, detail: detail || null });
	const opts = { timeoutMs, signal };

	// 1. Europe PMC：身份补全（PMCID）、OA 标记、渲染 PDF / JATS XML
	if (enabled.has("europepmc")) {
		const query = identity.doi
			? `DOI:"${identity.doi}"`
			: identity.pmcid
				? `PMCID:${identity.pmcid}`
				: `EXT_ID:${identity.pmid} AND SRC:MED`;
		const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&resultType=lite&pageSize=5`;
		const result = await fetchJson(fetchImpl, url, opts);
		if (!result.ok) note("europepmc", "error", result.detail);
		else {
			const hits = Array.isArray(result.body?.resultList?.result) ? result.body.resultList.result : [];
			const hit =
				hits.find((h) => identity.doi && normalizeDoi(h.doi) === identity.doi) ||
				hits.find((h) => identity.pmcid && normalizePmcid(h.pmcid) === identity.pmcid) ||
				hits.find((h) => identity.pmid && normalizePmid(h.pmid) === identity.pmid) ||
				null;
			if (!hit) note("europepmc", "ok", "no record");
			else {
				identity.pmcid = identity.pmcid || normalizePmcid(hit.pmcid);
				identity.pmid = identity.pmid || normalizePmid(hit.pmid);
				identity.doi = identity.doi || normalizeDoi(hit.doi);
				meta.title = hit.title || null;
				const isOa = hit.isOpenAccess === "Y";
				const inEpmc = hit.inEPMC === "Y";
				note(
					"europepmc",
					"ok",
					`${identity.pmcid || "no PMCID"}; isOpenAccess=${hit.isOpenAccess || "?"}; inEPMC=${hit.inEPMC || "?"}; hasPDF=${hit.hasPDF || "?"}`,
				);
				if (identity.pmcid && (isOa || inEpmc)) {
					collector.add({
						url: `https://europepmc.org/articles/${identity.pmcid}?pdf=render`,
						source: "europepmc",
						kind: "pdf",
						license: isOa ? "open-access" : null,
						note: "Europe PMC rendered PDF",
					});
					collector.add({
						url: `https://europepmc.org/backend/ptpmcrender.fcgi?accid=${identity.pmcid}&blobtype=pdf`,
						source: "europepmc",
						kind: "pdf",
						license: isOa ? "open-access" : null,
						note: "Europe PMC render backend",
					});
				}
			}
		}
	}

	// 2. PMC 开放获取服务：官方 PDF 文件（仅 OA 子集）
	if (enabled.has("pmc-oa") && identity.pmcid) {
		const url = `https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi?id=${identity.pmcid}`;
		const result = await fetchJson(fetchImpl, url, { ...opts, accept: "application/xml,text/xml" });
		if (!result.ok) note("pmc-oa", "error", result.detail);
		else {
			const xml = String(result.body || "");
			const error = xml.match(/<error[^>]*code="([^"]+)"/i);
			if (error) note("pmc-oa", "ok", `not in OA subset (${error[1]})`);
			else {
				const license = xml.match(/<record[^>]*license="([^"]+)"/i)?.[1] || null;
				let added = 0;
				for (const link of xml.matchAll(/<link\s+([^>]*)\/?>/gi)) {
					const attrs = link[1];
					const format = attrs.match(/format="([^"]+)"/i)?.[1];
					const href = attrs.match(/href="([^"]+)"/i)?.[1];
					if (format !== "pdf" || !href) continue;
					if (
						collector.add({
							url: pmcFtpToHttps(href),
							source: "pmc-oa",
							kind: "pdf",
							license,
							note: "PMC OA subset file",
						})
					)
						added += 1;
				}
				meta.license = meta.license || license;
				note("pmc-oa", "ok", added ? `${added} pdf link(s)` : "no pdf link (tgz only)");
			}
		}
	}

	// 3. Unpaywall（需要邮箱）
	if (enabled.has("unpaywall") && identity.doi) {
		if (!mail) note("unpaywall", "skipped", "no contact email (set DRONE_CONTACT_EMAIL)");
		else {
			const url = `https://api.unpaywall.org/v2/${encodeURIComponent(identity.doi)}?email=${encodeURIComponent(mail)}`;
			const result = await fetchJson(fetchImpl, url, opts);
			if (!result.ok) note("unpaywall", result.status === 404 ? "ok" : "error", result.detail);
			else {
				const body = result.body || {};
				meta.oaStatus = body.oa_status || meta.oaStatus;
				const locations = [
					body.best_oa_location,
					...(Array.isArray(body.oa_locations) ? body.oa_locations : []),
				].filter(Boolean);
				let added = 0;
				for (const loc of locations) {
					if (
						collector.add({
							url: loc.url_for_pdf,
							source: "unpaywall",
							kind: "pdf",
							license: loc.license || null,
							version: loc.version || null,
							hostType: loc.host_type || null,
						})
					)
						added += 1;
					meta.license = meta.license || loc.license || null;
				}
				note(
					"unpaywall",
					"ok",
					`is_oa=${body.is_oa === true}; oa_status=${body.oa_status || "?"}; ${added} pdf link(s)`,
				);
			}
		}
	}

	// 4. OpenAlex
	if (enabled.has("openalex") && identity.doi) {
		const url = `https://api.openalex.org/works/doi:${encodeURIComponent(identity.doi)}${mail ? `?mailto=${encodeURIComponent(mail)}` : ""}`;
		const result = await fetchJson(fetchImpl, url, opts);
		if (!result.ok) note("openalex", result.status === 404 ? "ok" : "error", result.detail);
		else {
			const work = result.body || {};
			meta.oaStatus = meta.oaStatus || work.open_access?.oa_status || null;
			const locations = [
				work.best_oa_location,
				...(Array.isArray(work.locations) ? work.locations : []),
			].filter((loc) => loc && loc.is_oa !== false);
			let added = 0;
			for (const loc of locations) {
				if (
					collector.add({
						url: loc.pdf_url,
						source: "openalex",
						kind: "pdf",
						license: loc.license || null,
						version: loc.version || null,
						hostType: loc.source?.type || null,
					})
				)
					added += 1;
			}
			if (identity.pmcid == null && work.ids?.pmcid)
				identity.pmcid = normalizePmcid(String(work.ids.pmcid).split("/").pop());
			note("openalex", "ok", `is_oa=${work.open_access?.is_oa === true}; ${added} pdf link(s)`);
		}
	}

	// 5. Semantic Scholar
	if (enabled.has("semanticscholar") && identity.doi) {
		const url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(identity.doi)}?fields=openAccessPdf,externalIds,isOpenAccess`;
		const result = await fetchJson(fetchImpl, url, opts);
		if (!result.ok) note("semanticscholar", result.status === 404 ? "ok" : "error", result.detail);
		else {
			const paper = result.body || {};
			const added = collector.add({
				url: paper.openAccessPdf?.url,
				source: "semanticscholar",
				kind: "pdf",
				license: paper.openAccessPdf?.license || null,
				note: paper.openAccessPdf?.status || null,
			});
			const arxiv = paper.externalIds?.ArXiv;
			if (arxiv && /^[0-9]{4}\.[0-9]{4,5}(v\d+)?$/.test(String(arxiv)))
				collector.add({
					url: `https://arxiv.org/pdf/${arxiv}`,
					source: "semanticscholar",
					kind: "pdf",
					note: "arXiv",
				});
			note(
				"semanticscholar",
				"ok",
				`isOpenAccess=${paper.isOpenAccess === true}; ${added ? 1 : 0} pdf link(s)`,
			);
		}
	}

	// 6. Crossref 登记的全文链接（可能需要订阅；只尝试，不绕过）
	if (enabled.has("crossref") && identity.doi) {
		const url = `https://api.crossref.org/works/${encodeURIComponent(identity.doi)}${mail ? `?mailto=${encodeURIComponent(mail)}` : ""}`;
		const result = await fetchJson(fetchImpl, url, opts);
		if (!result.ok) note("crossref", result.status === 404 ? "ok" : "error", result.detail);
		else {
			const message = result.body?.message || {};
			let added = 0;
			for (const link of Array.isArray(message.link) ? message.link : []) {
				if (String(link["content-type"] || "").toLowerCase() !== "application/pdf") continue;
				if (
					collector.add({
						url: link.URL,
						source: "crossref",
						kind: "pdf",
						license: Array.isArray(message.license) ? message.license[0]?.URL || null : null,
						note: link["intended-application"] || null,
					})
				)
					added += 1;
			}
			note("crossref", "ok", `${added} publisher pdf link(s)`);
		}
	}

	return {
		...identity,
		title: meta.title,
		oaStatus: meta.oaStatus,
		license: meta.license,
		candidates: collector.candidates,
		queried,
	};
}

export default { resolveOpenAccess, contactEmail, normalizePmcid, normalizePmid, OA_SOURCES };
