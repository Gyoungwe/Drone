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
