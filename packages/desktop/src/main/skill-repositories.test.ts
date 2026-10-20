import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	addSkillRepository,
	checkSkillRepository,
	configureSkillRepositoryManager,
	listSkillRepositories,
	readSkillRepositoryInstall,
	removeSkillRepository,
	updateSkillRepository,
} from "./skill-repositories";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(): Promise<{ userData: string; source: string }> {
	const userData = mkdtempSync(join(tmpdir(), "drone-skill-repositories-"));
	const source = join(userData, "source");
	roots.push(userData);
	await mkdir(join(source, "skills", "demo"), { recursive: true });
	await writeFile(
		join(source, "skills", "demo", "SKILL.md"),
		"---\nname: demo\ndescription: Demo\n---\nfirst\n",
	);
	return { userData, source };
}

describe("skill repository manager", () => {
	it("adds a local source, records its license, and exposes only verified snapshots", async () => {
		const { userData, source } = await fixture();
		configureSkillRepositoryManager(userData);
		const repository = await addSkillRepository({
			kind: "local",
			source,
			license: "MIT",
			licenseEvidence: "LICENSE",
		});

		expect(repository).toMatchObject({
			kind: "local",
			source,
			license: "MIT",
			skillCount: 1,
			status: "ready",
		});
		expect(repository).not.toHaveProperty("installRoot");
		expect(listSkillRepositories(userData)).toEqual([repository]);
		const loaded = readSkillRepositoryInstall(userData);
		expect(loaded.warnings).toEqual([]);
		expect(loaded.paths).toHaveLength(1);
		expect(await readFile(loaded.paths[0] as string, "utf8")).toContain("first");
	});

	it("checks and atomically applies local changes, then removes only the repository", async () => {
		const { userData, source } = await fixture();
		configureSkillRepositoryManager(userData);
		const repository = await addSkillRepository({ kind: "local", source, license: "user permission" });
		await writeFile(
			join(source, "skills", "demo", "SKILL.md"),
			"---\nname: demo\ndescription: Demo\n---\nsecond\n",
		);

		const checked = await checkSkillRepository(repository.id, userData);
		expect(checked.changedFiles).toEqual(["skills/demo/SKILL.md"]);
		expect(checked.repository.status).toBe("update-available");
		const applied = await updateSkillRepository(repository.id, userData);
		expect(applied.changedFiles).toEqual(["skills/demo/SKILL.md"]);
		expect(applied.restartedRequired).toBe(true);
		expect(readSkillRepositoryInstall(userData).warnings).toEqual([]);
		const path = readSkillRepositoryInstall(userData).paths[0];
		expect(await readFile(path as string, "utf8")).toContain("second");

		await removeSkillRepository(repository.id, userData);
		expect(listSkillRepositories(userData)).toEqual([]);
		expect(readSkillRepositoryInstall(userData).paths).toEqual([]);
		expect(await readFile(join(source, "skills", "demo", "SKILL.md"), "utf8")).toContain("second");
	});

	it("fails closed for unsafe sources and modified installed snapshots", async () => {
		const { userData, source } = await fixture();
		configureSkillRepositoryManager(userData);
		await expect(
			addSkillRepository({ kind: "local", source, subpath: "../", license: "MIT" }),
		).rejects.toThrow(/subpath/i);
		await expect(
			addSkillRepository({ kind: "git", source: "https://user:secret@example.com/repo.git", license: "MIT" }),
		).rejects.toThrow(/credentials/i);

		const repository = await addSkillRepository({ kind: "local", source, license: "MIT" });
		const internal = listSkillRepositories(userData).find((item) => item.id === repository.id);
		// The public record intentionally hides the snapshot path. Locate it through the managed root
		// and corrupt the only file to verify that startup refuses modified content.
		const managed = join(userData, "research-skills", "repositories");
		const { readdir } = await import("node:fs/promises");
		const dirs = (await readdir(managed)).filter((name) => !name.startsWith("."));
		expect(internal?.id).toBe(repository.id);
		await writeFile(join(managed, dirs[0] as string, "skills", "demo", "SKILL.md"), "tampered");
		const loaded = readSkillRepositoryInstall(userData);
		expect(loaded.paths).toEqual([]);
		expect(loaded.warnings.join(" ")).toContain("Modified skill");
	});
});
