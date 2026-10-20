import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESEARCH_SKILL_SOURCES } from "@drone/shared";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, relaunch: vi.fn(), exit: vi.fn() } }));

const { checkResearchSkillUpdates, configureResearchSkillUpdater, onResearchSkillUpdateState } = await import(
	"./research-skill-updater"
);

const roots: string[] = [];
afterEach(() => {
	vi.unstubAllGlobals();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("checks the two built-in sources against their pinned current commits", async () => {
	const root = mkdtempSync(join(tmpdir(), "research-skill-update-"));
	roots.push(root);
	configureResearchSkillUpdater(root);
	const sourceCommit = new Map(RESEARCH_SKILL_SOURCES.map((source) => [source.id, source.commit]));
	const fetch = vi.fn(async (url: string) => ({
		ok: true,
		status: 200,
		json: async () => ({
			sha: url.includes("nature-skills") ? sourceCommit.get("nature") : sourceCommit.get("scientific"),
		}),
	}));
	vi.stubGlobal("fetch", fetch);
	const states: string[] = [];
	onResearchSkillUpdateState((state) => states.push(state.phase));
	await checkResearchSkillUpdates();
	expect(states.at(-2)).toBe("checking");
	expect(states.at(-1)).toBe("up-to-date");
	expect(fetch).toHaveBeenCalledTimes(2);
});

it("falls back to the public commit feed when GitHub API rate limits the desktop", async () => {
	const root = mkdtempSync(join(tmpdir(), "research-skill-update-feed-"));
	roots.push(root);
	configureResearchSkillUpdater(root);
	const sourceCommit = new Map(RESEARCH_SKILL_SOURCES.map((source) => [source.id, source.commit]));
	const fetch = vi.fn(async (url: string) => {
		if (url.includes("api.github.com")) return { ok: false, status: 403 };
		const sha = url.includes("nature-skills") ? sourceCommit.get("nature") : sourceCommit.get("scientific");
		return {
			ok: true,
			status: 200,
			text: async () => `<entry><id>tag:github.com,2008:Grit::Commit/${sha}</id></entry>`,
		};
	});
	vi.stubGlobal("fetch", fetch);
	const states: string[] = [];
	onResearchSkillUpdateState((state) => states.push(state.phase));
	await checkResearchSkillUpdates();
	expect(states.at(-1)).toBe("up-to-date");
	expect(fetch).toHaveBeenCalledTimes(4);
});

it("keeps commit identities inside the integrity gate", async () => {
	const root = mkdtempSync(join(tmpdir(), "research-skill-update-public-state-"));
	roots.push(root);
	configureResearchSkillUpdater(root);
	const fetch = vi.fn(async (_url: string) => ({
		ok: true,
		status: 200,
		json: async () => ({ sha: "f".repeat(40) }),
	}));
	vi.stubGlobal("fetch", fetch);
	let latest: Record<string, unknown> | undefined;
	onResearchSkillUpdateState((state) => {
		if (state.phase === "available") latest = state.packs[0] as unknown as Record<string, unknown>;
	});
	await checkResearchSkillUpdates();
	expect(latest).toMatchObject({ id: "nature", repository: "Yuan1z0825/nature-skills" });
	expect(latest).not.toHaveProperty("currentCommit");
	expect(latest).not.toHaveProperty("latestCommit");
});
