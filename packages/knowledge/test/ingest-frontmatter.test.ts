import { describe, expect, it } from "vitest";
import {
	buildFrontmatter,
	classForType,
	NOTE_SCHEMA,
	normalizeTag,
	parseFrontmatter,
	renderNote,
	serializeFrontmatter,
	splitFrontmatter,
	validateFrontmatter,
} from "../src/ingest-frontmatter";
import { contentHash } from "../src/ingest-identity";

const NOTE = `---
schema: drone-note/1
id: pi-abc123
type: paper
project: shared
status: verified
confidence: high # reviewed by hand
tags: [single-cell, "#Atlas", Atlas]
aliases:
  - HCA
identity:
  doi: https://doi.org/10.1038/S41586-020-2649-2
  pmid: 32939066
sources:
  - doi: 10.1038/s41586-020-2649-2
    locator: "Fig. 2"
  - "PMID: 32939066"
  - Library/Papers/hca.md
created_from:
  session: s-1
  run: run-20261008
  task: t-9
  tool: research_deposit_knowledge
  turn: 4
derived_from:
  - "[[Library/Papers/hca]]"
  - [[Wiki/Atlas]]
created: 2026-10-08
updated: "2026-10-08T01:40:00+08:00"
---
# Human Cell Atlas

Body.
`;

describe("splitFrontmatter / parseFrontmatter", () => {
	it("returns null data without a frontmatter block", () => {
		expect(parseFrontmatter("# Title\n")).toEqual({ data: null, body: "# Title\n", errors: [] });
		expect(splitFrontmatter("---\nno end")).toEqual({ raw: null, body: "---\nno end" });
	});

	it("parses maps, lists, list maps, flow collections and comments", () => {
		const parsed = parseFrontmatter(NOTE);
		expect(parsed.errors).toEqual([]);
		expect(parsed.body).toBe("# Human Cell Atlas\n\nBody.\n");
		expect(parsed.data).toMatchObject({
			schema: "drone-note/1",
			type: "paper",
			confidence: "high",
			tags: ["single-cell", "#Atlas", "Atlas"],
			aliases: ["HCA"],
			identity: { doi: "https://doi.org/10.1038/S41586-020-2649-2", pmid: 32939066 },
			sources: [
				{ doi: "10.1038/s41586-020-2649-2", locator: "Fig. 2" },
				"PMID: 32939066",
				"Library/Papers/hca.md",
			],
			created_from: {
				session: "s-1",
				run: "run-20261008",
				task: "t-9",
				tool: "research_deposit_knowledge",
				turn: 4,
			},
			created: "2026-10-08",
			updated: "2026-10-08T01:40:00+08:00",
		});
	});

	it("handles CRLF, block scalars and keys followed by same-indent lists", () => {
		const text =
			"---\r\ntitle: |\r\n  line one\r\n  line two\r\nsummary: >-\r\n  folded\r\n  text\r\ntags:\r\n- a\r\n- b\r\n---\r\nBody";
		const parsed = parseFrontmatter(text);
		expect(parsed.errors).toEqual([]);
		expect(parsed.data).toEqual({ title: "line one\nline two\n", summary: "folded text", tags: ["a", "b"] });
		expect(parsed.body).toBe("Body");
	});

	it("parses scalars like YAML", () => {
		const parsed = parseFrontmatter(
			"---\na: ~\nb: true\nc: 1.5\nd: 'it''s'\ne: \"x\\ny\"\nf: {k: v, n: 2}\ng: []\nh: 10.1000/x\n---\n",
		);
		expect(parsed.data).toEqual({
			a: null,
			b: true,
			c: 1.5,
			d: "it's",
			e: "x\ny",
			f: { k: "v", n: 2 },
			g: [],
			h: "10.1000/x",
		});
	});

	it.each([
		["tabs", "---\ntags:\n\t- a\n---\n", /tabs/],
		["anchors", "---\na: &x 1\n---\n", /Unsupported/],
		["duplicate keys", "---\na: 1\na: 2\n---\n", /duplicate/],
		["bad indentation", "---\na: 1\n  b: 2\n---\n", /indentation/],
		["top-level list", "---\n- a\n---\n", /mapping/],
		["unterminated quote", '---\na: "x\n---\n', /Unterminated/],
	])("reports %s as an error instead of throwing", (_name, text, pattern) => {
		const parsed = parseFrontmatter(text);
		expect(parsed.data).toBeNull();
		expect(parsed.errors[0]).toMatch(pattern);
	});

	it("drops prototype-polluting keys", () => {
		const parsed = parseFrontmatter(
			"---\n__proto__:\n  polluted: true\nconstructor: x\na: {__proto__: 1}\n---\n",
		);
		expect(parsed.data).toEqual({ a: {} });
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it("rejects oversized and overly nested frontmatter", () => {
		expect(parseFrontmatter(`---\na: "${"x".repeat(70_000)}"\n---\n`).errors[0]).toMatch(/64 KiB/);
		const nested = `---\n${Array.from({ length: 9 }, (_, i) => `${"  ".repeat(i)}k${i}:`).join("\n")}\n${"  ".repeat(9)}v: 1\n---\n`;
		expect(parseFrontmatter(nested).errors[0]).toMatch(/too deep/);
	});
});

describe("validateFrontmatter", () => {
	it("normalizes a complete paper note", () => {
		const parsed = parseFrontmatter(NOTE);
		const result = validateFrontmatter(parsed.data, { body: parsed.body });
		expect(result.errors).toEqual([]);
		expect(result.value).toEqual({
			schema: NOTE_SCHEMA,
			id: "pi-abc123",
			type: "paper",
			class: "knowledge",
			project: "shared",
			status: "verified",
			confidence: "high",
			tags: ["single-cell", "atlas"],
			aliases: ["HCA"],
			identity: { doi: "10.1038/s41586-020-2649-2", pmid: "32939066" },
			sources: [
				{ doi: "10.1038/s41586-020-2649-2", locator: "Fig. 2" },
				{ pmid: "32939066" },
				{ vault: "Library/Papers/hca.md" },
			],
			created_from: {
				session: "s-1",
				run: "run-20261008",
				task: "t-9",
				tool: "research_deposit_knowledge",
				turn: 4,
			},
			derived_from: ["[[Library/Papers/hca]]", "[[Wiki/Atlas]]"],
			created: "2026-10-08",
			updated: "2026-10-08T01:40:00+08:00",
		});
	});

	it("derives class from type", () => {
		expect(classForType("method")).toBe("knowledge");
		expect(classForType("explainer")).toBe("run-result");
		expect(validateFrontmatter({ type: "run", project: "demo", status: "verified" }).value?.class).toBe(
			"run-result",
		);
	});

	it("rejects class/type conflicts and ephemeral class", () => {
		expect(validateFrontmatter({ type: "run", class: "knowledge", project: "demo" }).errors).toContain(
			"class: knowledge conflicts with type run",
		);
		expect(validateFrontmatter({ type: "idea", class: "ephemeral", project: "demo" }).errors[0]).toMatch(
			/never stored/,
		);
	});

	it("requires a known type and a valid project", () => {
		const result = validateFrontmatter({ type: "note", project: "My Project" });
		expect(result.value).toBeNull();
		expect(result.errors).toEqual(
			expect.arrayContaining([expect.stringMatching(/^type:/), expect.stringMatching(/^project:/)]),
		);
		expect(validateFrontmatter({ type: "idea" }).errors).toContain(
			"project: required (shared or a kebab-case project slug)",
		);
		expect(validateFrontmatter({ type: "idea", project: "Drone-1a2b3c4d5e" }).value?.project).toBe(
			"drone-1a2b3c4d5e",
		);
	});

	it("maps legacy statuses with a warning and defaults missing status to candidate", () => {
		const legacy = validateFrontmatter({ type: "wiki", project: "shared", status: "applied" });
		expect(legacy.value?.status).toBe("verified");
		expect(legacy.warnings).toContain("status: legacy value applied mapped to verified");
		const draft = validateFrontmatter({ type: "idea", project: "shared", status: "Draft" });
		expect(draft.value?.status).toBe("candidate");
		const missing = validateFrontmatter({ type: "idea", project: "shared" });
		expect(missing.value?.status).toBe("candidate");
		expect(missing.warnings).toContain("status: missing; defaulted to candidate");
		expect(validateFrontmatter({ type: "idea", project: "shared", status: "done" }).value).toBeNull();
	});

	it("rejects invalid identifiers, sources and provenance", () => {
		const result = validateFrontmatter({
			type: "paper",
			project: "shared",
			status: "candidate",
			identity: { doi: "not-a-doi", wos: "123" },
			sources: [
				"Smith 2020",
				{ locator: "p. 3" },
				{ vault: "../escape.md" },
				{ file: "/etc/passwd" },
				{ sha256: "xyz", url: "https://a.org" },
			],
			created_from: { session: "", turn: -1 },
			derived_from: ["[[../x]]"],
			content_sha256: "abc",
			id: "note-1",
			created: "yesterday",
			confidence: "certain",
		});
		expect(result.value).toBeNull();
		expect(result.errors).toEqual(
			expect.arrayContaining([
				"identity.doi: invalid or unsupported identifier",
				"identity.wos: invalid or unsupported identifier",
				"sources[0]: unrecognized reference",
				"sources[1]: needs one of doi/pmid/pmcid/arxiv/isbn/zotero_key/url/vault/file",
				"sources[2].vault: expected a Vault-relative .md path",
				"sources[3].file: expected a workspace-relative path",
				"sources[4].sha256: expected 64 hex characters",
				"created_from.session: invalid value",
				"created_from.turn: expected a non-negative integer",
				'derived_from: invalid link "[[../x]]"',
				"content_sha256: expected 64 hex characters",
				"id: expected pi-<id>",
				"created: expected an ISO 8601 date",
				expect.stringMatching(/^confidence:/),
			]),
		);
	});

	it("infers paper identity from sources but not for other types", () => {
		const paper = validateFrontmatter({
			type: "paper",
			project: "shared",
			status: "candidate",
			sources: ["arXiv:2401.01234v2"],
		});
		expect(paper.value?.identity).toEqual({ arxiv: "2401.01234" });
		const method = validateFrontmatter({
			type: "method",
			project: "shared",
			status: "candidate",
			sources: ["PMID: 1"],
		});
		expect(method.value?.identity).toEqual({});
		expect(method.value?.sources).toEqual([{ pmid: "1" }]);
	});

	it("warns when a source-bearing knowledge note cites nothing", () => {
		const result = validateFrontmatter({ type: "claim", project: "demo", status: "candidate" });
		expect(result.value).not.toBeNull();
		expect(result.warnings).toContain("sources: a claim note should cite at least one source");
		expect(validateFrontmatter({ type: "idea", project: "demo", status: "candidate" }).warnings).toEqual([]);
	});

	it("warns when the body no longer matches content_sha256", () => {
		const hash = contentHash("Body");
		const ok = validateFrontmatter(
			{ type: "idea", project: "demo", status: "candidate", content_sha256: hash },
			{ body: "Body\n" },
		);
		expect(ok.warnings).toEqual([]);
		const changed = validateFrontmatter(
			{ type: "idea", project: "demo", status: "candidate", content_sha256: hash },
			{ body: "Edited" },
		);
		expect(changed.value?.content_sha256).toBe(hash);
		expect(changed.warnings).toContain("content_sha256: body changed since the hash was recorded");
	});

	it("rejects non-mapping input", () => {
		expect(validateFrontmatter(null).errors).toEqual(["frontmatter must be a mapping"]);
		expect(validateFrontmatter(["x"]).errors).toEqual(["frontmatter must be a mapping"]);
	});
});

describe("normalizeTag", () => {
	it.each([
		["#Single Cell", "single-cell"],
		["bio/genomics/", "bio/genomics"],
		["单细胞", "单细胞"],
		["2026", null],
		["a b!", null],
		["", null],
	])("%s → %s", (input, expected) => {
		expect(normalizeTag(input)).toBe(expected);
	});
});

describe("buildFrontmatter / serializeFrontmatter", () => {
	const input = {
		type: "method" as const,
		project: "drone-1a2b3c4d5e",
		tags: ["Protocol"],
		sources: ["https://doi.org/10.1000/ABC", { file: "results\\run-1\\methods.md", sha256: "A".repeat(64) }],
		createdFrom: { session: "s-1", run: "run-1", tool: "research_deposit_knowledge" },
		derivedFrom: ["[[Library/Papers/abc]]"],
		body: '## Methods\n\nStep 1: "quote"\n',
		created: "2026-10-08",
	};

	it("builds a normalized candidate with a content hash", () => {
		const fm = buildFrontmatter(input);
		expect(fm).toMatchObject({
			schema: NOTE_SCHEMA,
			type: "method",
			class: "knowledge",
			status: "candidate",
			tags: ["protocol"],
			sources: [{ doi: "10.1000/abc" }, { file: "results/run-1/methods.md", sha256: "a".repeat(64) }],
			content_sha256: contentHash(input.body),
		});
	});

	it("throws with every error for invalid input", () => {
		expect(() => buildFrontmatter({ type: "method", project: "Bad Slug", sources: ["??"] })).toThrow(
			/project: expected.*sources\[0\]: unrecognized reference/,
		);
	});

	it("serializes deterministically and round-trips through the parser", () => {
		const fm = buildFrontmatter(input);
		const text = serializeFrontmatter(fm);
		expect(text.startsWith('---\nschema: "drone-note/1"\ntype: "method"\nclass: "knowledge"\n')).toBe(true);
		expect(text.endsWith("---\n")).toBe(true);
		expect(serializeFrontmatter(buildFrontmatter(input))).toBe(text);

		const note = renderNote(fm, input.body);
		const parsed = parseFrontmatter(note);
		expect(parsed.errors).toEqual([]);
		expect(parsed.body.trim()).toBe(input.body.trim());
		const again = validateFrontmatter(parsed.data, { body: parsed.body });
		expect(again.errors).toEqual([]);
		expect(again.warnings).toEqual([]);
		expect(again.value).toEqual(fm);
	});

	it("serializes empty collections as flow literals", () => {
		const text = serializeFrontmatter(buildFrontmatter({ type: "idea", project: "shared" }));
		expect(text).toContain("tags: []\n");
		expect(text).toContain("identity: {}\n");
		expect(parseFrontmatter(`${text}body`).data).toMatchObject({ tags: [], identity: {}, sources: [] });
	});
});
