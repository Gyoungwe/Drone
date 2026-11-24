import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SKILL_DIR = resolve(import.meta.dirname, "../../../.pi/skills/research-workflow");
const INDEX_PATH = resolve(SKILL_DIR, "SKILL.md");
const REFERENCES_DIR = resolve(SKILL_DIR, "references");
/** AGENTS.md red line 5: a resident SKILL.md index stays at or under 3 KiB. */
const MAX_INDEX_BYTES = 3 * 1024;

const readIndex = () => readFile(INDEX_PATH, "utf8");
const readCards = async () => {
	const names = (await readdir(REFERENCES_DIR)).filter((name) => name.endsWith(".md")).sort();
	return Promise.all(
		names.map(async (name) => ({ name, text: await readFile(resolve(REFERENCES_DIR, name), "utf8") })),
	);
};

describe("the research-workflow skill keeps a resident index and on-demand sub-cards", () => {
	it("keeps the resident index at or under 3 KiB", async () => {
		const bytes = Buffer.byteLength(await readIndex(), "utf8");
		expect(bytes).toBeLessThanOrEqual(MAX_INDEX_BYTES);
	});

	it("keeps the frontmatter byte-identical and links every sub-card", async () => {
		const index = await readIndex();
		expect(index.startsWith("---\nname: research-workflow\n")).toBe(true);
		expect(index).toContain("alwaysWith: research");

		const cards = await readCards();
		expect(cards.length).toBeGreaterThan(0);
		for (const card of cards) {
			expect(index).toContain(`references/${card.name}`);
			// Every card states when to read it, so a model knows it is on demand.
			expect(card.text).toMatch(/^Read this when .+\.$/m);
		}
	});

	it("loses no rule: index plus sub-cards still carry every safety concept", async () => {
		const cards = await readCards();
		const combined = `${await readIndex()}\n${cards.map((card) => card.text).join("\n")}`.toLowerCase();
		// The same concepts the WikiSkill safety gate requires of a research-workflow skill.
		for (const term of ["local", "evidence", "parent", "archive", "claim", "unverified", "browser"]) {
			expect(combined).toContain(term);
		}
	});
});
