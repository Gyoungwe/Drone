import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectRecentNotes, ideaNoteMarkdown } from "../src/daily-discovery";
import { buildDailyDiscoveryMessage, parseDailyIdeas } from "../src/daily-discovery-prompt";

let vault = "";
afterEach(async () => {
	if (vault) await rm(vault, { recursive: true, force: true });
});

describe("daily discovery", () => {
	it("collects only notes changed since the last run and skips navigation pages", async () => {
		vault = await mkdtemp(join(tmpdir(), "daily-discovery-"));
		await mkdir(join(vault, "Library", "Papers"), { recursive: true });
		await writeFile(join(vault, "Library", "Papers", "old.md"), "# Old\nbefore");
		await writeFile(join(vault, "Library", "Papers", "new.md"), "# New paper\nafter");
		await writeFile(join(vault, "Library", "Index.md"), "# Index");
		const past = new Date(Date.now() - 3 * 86_400_000);
		await utimes(join(vault, "Library", "Papers", "old.md"), past, past);
		const notes = await collectRecentNotes(vault, Date.now() - 86_400_000);
		expect(notes.map((note) => note.path)).toEqual(["Library/Papers/new.md"]);
		expect(notes[0]?.title).toBe("New paper");
	});

	it("keeps only grounded ideas that cite a new note, never invented paths, at most 3", () => {
		const reply = JSON.stringify([
			{ title: "A", idea: "x", basis: ["Library/new.md", "Library/old.md"], test: "qPCR", whyOverlooked: "" },
			{ title: "B", idea: "y", basis: ["Library/old.md"], test: "t" },
			{ title: "C", idea: "z", basis: ["Invented/paper.md"], test: "t" },
			{ title: "D", idea: "w", basis: ["Library/new.md"], test: "" },
		]);
		const ideas = parseDailyIdeas(
			`Here you go:\n${reply}`,
			["Library/new.md", "Library/old.md"],
			["Library/new.md"],
		);
		expect(ideas.map((idea) => idea.title)).toEqual(["A"]);
		expect(ideas[0]?.basis).toEqual(["Library/new.md", "Library/old.md"]);
		expect(parseDailyIdeas("no json here", [], [])).toEqual([]);
	});

	it("builds a NEW vs OLD message and an idea note marked speculative with links", () => {
		const message = buildDailyDiscoveryMessage(
			[{ path: "Library/new.md", title: "N", text: "new text", mtime: 1 }],
			[],
		);
		expect(message).toContain("NEW notes:");
		expect(message).toContain("(none found)");
		const note = ideaNoteMarkdown(
			{ title: "T", idea: "I", basis: ["Library/new.md"], test: "how", whyOverlooked: "why" },
			new Date(0),
		);
		expect(note).toContain("type: idea");
		expect(note).toContain('status: "speculative"');
		expect(note).toContain("[[Library/new]]");
	});
});
