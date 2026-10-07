import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectIdentity } from "../src/config";
import { currentProject } from "../src/extension-helpers";
import {
	dailyWorkspaceDir,
	describeProject,
	isDailyWorkspace,
	isProjectSlug,
	LEGACY_DEFAULT_PROJECT,
	normalizeProjectSlug,
	projectNotice,
	readConfiguredProject,
	resolveProjectIdentity,
	resolveWorkspaceProject,
	runProject,
	SESSION_PROJECT_ENTRY,
	sessionEntriesOf,
	sessionProjectFromEntries,
	workspaceProjectId,
} from "../src/project-identity";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function tempRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "drone-project-identity-"));
	roots.push(root);
	return root;
}
async function configure(cwd: string, value: unknown): Promise<void> {
	await mkdir(join(cwd, ".pi"), { recursive: true });
	await writeFile(join(cwd, ".pi/research-workspace.json"), JSON.stringify({ knowledgeProjectId: value }));
}
const choose = (project: string | null) => ({
	type: "custom",
	customType: SESSION_PROJECT_ENTRY,
	data: { project },
});

describe("project slugs", () => {
	it("accepts kebab-case slugs and rejects reserved names", () => {
		expect(isProjectSlug("gut-microbiome")).toBe(true);
		expect(isProjectSlug("Gut")).toBe(false);
		expect(isProjectSlug("a--b")).toBe(false);
		expect(isProjectSlug("shared")).toBe(false);
		expect(isProjectSlug("con")).toBe(false);
		expect(isProjectSlug("x".repeat(97))).toBe(false);
	});

	it("normalizes user input", () => {
		expect(normalizeProjectSlug(" Gut Microbiome! ")).toBe("gut-microbiome");
		expect(normalizeProjectSlug("ＣＲＩＳＰＲ_screen")).toBe("crispr-screen");
		expect(normalizeProjectSlug("肠道")).toBeNull();
		expect(normalizeProjectSlug("shared")).toBeNull();
		expect(normalizeProjectSlug(42)).toBeNull();
	});

	it("keeps the existing directory-derived identity stable", () => {
		const cwd = join(tmpdir(), "My Project");
		expect(workspaceProjectId(cwd)).toBe(projectIdentity(cwd));
		expect(workspaceProjectId(cwd)).toMatch(/^my-project-[a-f0-9]{10}$/);
		expect(workspaceProjectId(cwd, "demo")).toBe("demo");
		expect(workspaceProjectId(cwd, "shared")).toBe(projectIdentity(cwd));
		expect(workspaceProjectId(cwd, "Not A Slug")).toBe(projectIdentity(cwd));
	});
});

describe("daily space", () => {
	it("detects ~/.drone/daily", () => {
		const home = join(tmpdir(), "home-a");
		expect(dailyWorkspaceDir(home)).toBe(join(home, ".drone", "daily"));
		expect(isDailyWorkspace(join(home, ".drone", "daily"), home)).toBe(true);
		expect(isDailyWorkspace(`${join(home, ".drone", "daily")}/`, home)).toBe(true);
		expect(isDailyWorkspace(join(home, ".drone"), home)).toBe(false);
		expect(isDailyWorkspace(join(home, "work"), home)).toBe(false);
	});

	it("reads the latest valid session choice and honours clearing", () => {
		expect(sessionProjectFromEntries([choose("a"), choose("b")])).toBe("b");
		expect(sessionProjectFromEntries([choose("a"), choose(null)])).toBeNull();
		expect(sessionProjectFromEntries([choose("a"), choose("Bad Slug" as string)])).toBe("a");
		expect(
			sessionProjectFromEntries([
				choose("a"),
				{ type: "message", customType: SESSION_PROJECT_ENTRY, data: { project: "b" } },
			]),
		).toBe("a");
		expect(sessionProjectFromEntries([{ customType: "other", data: { project: "x" } }])).toBeNull();
		expect(sessionProjectFromEntries("nope")).toBeNull();
	});

	it("reads entries from a session manager safely", () => {
		expect(sessionEntriesOf({ sessionManager: { getBranch: () => [choose("a")] } })).toEqual([choose("a")]);
		expect(sessionEntriesOf({ sessionManager: { getEntries: () => [choose("b")] } })).toEqual([choose("b")]);
		expect(
			sessionEntriesOf({
				sessionManager: {
					getBranch: () => {
						throw new Error("closed");
					},
				},
			}),
		).toEqual([]);
		expect(sessionEntriesOf(null)).toEqual([]);
	});
});

describe("resolveProjectIdentity", () => {
	const home = join(tmpdir(), "home-b");
	const daily = join(home, ".drone", "daily");
	const work = join(tmpdir(), "lab-work");

	it("uses the workspace identity and never the legacy default", () => {
		const resolved = resolveProjectIdentity({ cwd: work, home });
		expect(resolved).toEqual({
			project: projectIdentity(work),
			source: "workspace",
			daily: false,
			requested: null,
			ignoredRequest: false,
		});
		expect(resolved.project).not.toBe(LEGACY_DEFAULT_PROJECT);
	});

	it("prefers the configured knowledgeProjectId", () => {
		expect(resolveProjectIdentity({ cwd: work, configured: "lab", home })).toMatchObject({
			project: "lab",
			source: "workspace-config",
		});
	});

	it("ignores session choices outside the daily space", () => {
		expect(resolveProjectIdentity({ cwd: work, home, sessionEntries: [choose("other")] }).project).toBe(
			projectIdentity(work),
		);
	});

	it("lets each daily-space session choose its own project", () => {
		const first = resolveProjectIdentity({ cwd: daily, home, sessionEntries: [choose("gut")] });
		const second = resolveProjectIdentity({ cwd: daily, home, sessionEntries: [choose("brain")] });
		const none = resolveProjectIdentity({ cwd: daily, home, sessionEntries: [] });
		expect(first).toMatchObject({ project: "gut", source: "session", daily: true });
		expect(second).toMatchObject({ project: "brain", source: "session", daily: true });
		expect(none).toMatchObject({ project: projectIdentity(daily), source: "workspace", daily: true });
		expect(
			resolveProjectIdentity({ cwd: daily, home, configured: "daily-notes", sessionEntries: [choose("gut")] })
				.project,
		).toBe("gut");
	});

	it("reports a different requested project as ignored", () => {
		const same = resolveProjectIdentity({ cwd: work, configured: "lab", requested: "Lab", home });
		expect(same).toMatchObject({ requested: "Lab", ignoredRequest: false });
		expect(projectNotice(same)).toBeNull();
		const legacy = resolveProjectIdentity({
			cwd: work,
			configured: "lab",
			requested: LEGACY_DEFAULT_PROJECT,
			home,
		});
		expect(legacy).toMatchObject({ project: "lab", requested: LEGACY_DEFAULT_PROJECT, ignoredRequest: true });
		expect(projectNotice(legacy)).toMatch(/research-workbench.*ignored.*"lab".*knowledgeProjectId/);
		const inDaily = resolveProjectIdentity({
			cwd: daily,
			home,
			requested: "x",
			sessionEntries: [choose("gut")],
		});
		expect(projectNotice(inDaily)).toMatch(/\/project <slug>/);
		expect(describeProject(inDaily)).toEqual({
			project: "gut",
			source: "session",
			notice: projectNotice(inDaily),
		});
		expect(describeProject(same)).toEqual({ project: "lab", source: "workspace-config" });
	});
});

describe("runProject", () => {
	const resolution = resolveProjectIdentity({ cwd: join(tmpdir(), "w"), configured: "current" });
	it("keeps the project recorded on the run", () => {
		expect(runProject("older-project", resolution)).toBe("older-project");
	});
	it("maps legacy default, missing and invalid values to the current project", () => {
		expect(runProject(LEGACY_DEFAULT_PROJECT, resolution)).toBe("current");
		expect(runProject(undefined, resolution)).toBe("current");
		expect(runProject("../x", resolution)).toBe("current");
	});
	it("keeps research-workbench when the workspace opted in to it", () => {
		const optIn = resolveProjectIdentity({ cwd: join(tmpdir(), "w"), configured: LEGACY_DEFAULT_PROJECT });
		expect(runProject(LEGACY_DEFAULT_PROJECT, optIn)).toBe(LEGACY_DEFAULT_PROJECT);
	});
});

describe("workspace configuration", () => {
	it("reads knowledgeProjectId and tolerates missing or broken files", async () => {
		const root = await tempRoot();
		expect(await readConfiguredProject(root)).toBeUndefined();
		await configure(root, "demo");
		expect(await readConfiguredProject(root)).toBe("demo");
		await writeFile(join(root, ".pi/research-workspace.json"), "{broken");
		expect(await readConfiguredProject(root)).toBeUndefined();
	});

	it("resolves the same project for every caller in one workspace", async () => {
		const root = await tempRoot();
		await configure(root, "demo");
		const resolved = await resolveWorkspaceProject({ cwd: root });
		expect(resolved).toMatchObject({ project: "demo", source: "workspace-config" });
		expect(await currentProject(root)).toBe("demo");
		expect(await currentProject(root, { sessionManager: { getBranch: () => [choose("other")] } })).toBe(
			"demo",
		);
	});

	it("uses a daily-space session choice through currentProject", async () => {
		const home = await tempRoot();
		const daily = dailyWorkspaceDir(home);
		await mkdir(daily, { recursive: true });
		const resolved = await resolveWorkspaceProject({ cwd: daily, home, sessionEntries: [choose("gut")] });
		expect(resolved).toMatchObject({ project: "gut", source: "session", daily: true });
	});
});
