import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	normalizeAlwaysWith,
	parseAlwaysWith,
	resetSkillFrontmatterCache,
	skillAlwaysWith,
} from "../src/capabilities/skill-frontmatter";

describe("skill alwaysWith frontmatter (hook 5)", () => {
	let dir = "";
	beforeEach(async () => {
		resetSkillFrontmatterCache();
		dir = await mkdtemp(join(tmpdir(), "drone-skill-frontmatter-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("accepts scalar, list and comma-separated declarations and drops unknown capability ids", () => {
		expect([...normalizeAlwaysWith("research")]).toEqual(["research"]);
		expect([...normalizeAlwaysWith(["knowledge", "research"])]).toEqual(["knowledge", "research"]);
		expect([...normalizeAlwaysWith("knowledge, Research")]).toEqual(["knowledge", "research"]);
		expect([...normalizeAlwaysWith(["research", "not-a-capability", 42])]).toEqual(["research"]);
		expect(normalizeAlwaysWith(undefined).size).toBe(0);
		expect(normalizeAlwaysWith({ research: true }).size).toBe(0);
	});

	it("parses SKILL.md frontmatter and tolerates missing or broken frontmatter", () => {
		expect([...parseAlwaysWith("---\nname: a\nalwaysWith: research\n---\n# A\n")]).toEqual(["research"]);
		expect([...parseAlwaysWith("---\nname: a\nalwaysWith: [knowledge, research]\n---\n")]).toEqual([
			"knowledge",
			"research",
		]);
		expect([...parseAlwaysWith("---\nname: a\nalways-with:\n  - research\n---\n")]).toEqual(["research"]);
		expect(parseAlwaysWith("# no frontmatter\n").size).toBe(0);
		expect(parseAlwaysWith("---\nname: [unterminated\n---\n").size).toBe(0);
	});

	it("prefers the in-memory declaration, then reads the file and refreshes when it changes", async () => {
		const filePath = join(dir, "SKILL.md");
		await writeFile(filePath, "---\nname: vendor\ndescription: v\nalwaysWith: research\n---\n");
		expect([...skillAlwaysWith({ name: "vendor", filePath, alwaysWith: [] })]).toEqual([]);
		expect([...skillAlwaysWith({ name: "vendor", filePath })]).toEqual(["research"]);
		// 同一路径在 TTL 内直接命中缓存
		expect([...skillAlwaysWith({ name: "vendor", filePath })]).toEqual(["research"]);
		await writeFile(filePath, "---\nname: vendor\ndescription: v\nalwaysWith: [knowledge]\n---\n");
		const later = new Date(Date.now() + 5_000);
		await utimes(filePath, later, later);
		expect([...skillAlwaysWith({ name: "vendor", filePath }, Date.now() + 2_000)]).toEqual(["knowledge"]);
		expect(skillAlwaysWith({ name: "missing", filePath: join(dir, "nope", "SKILL.md") }).size).toBe(0);
		expect(skillAlwaysWith({ name: "no-path" }).size).toBe(0);
	});
});
