import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	addAllowedPattern,
	addWorkspaceRoot,
	createWorkspacesLoader,
	emptyWorkspaces,
	loadWorkspaces,
	removeWorkspaceRoot,
	suggestRootCandidate,
	workspaceConfigPath,
} from "../src/project/workspace-store";

function makeAgentDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-ws-"));
	mkdirSync(dir, { recursive: true });
	return dir;
}

function projectRoot(dir: string): string {
	return join(dir, "proj");
}

function otherRoot(dir: string, suffix = "other"): string {
	return join(dir, suffix);
}

describe("workspace-store", () => {
	it("无文件 → 空配置；写后 roundtrip", () => {
		const dir = makeAgentDir();
		expect(loadWorkspaces(dir)).toEqual(emptyWorkspaces());
		const project = projectRoot(dir);
		const root = join(otherRoot(dir), "repo");
		addWorkspaceRoot(dir, project, root);
		expect(loadWorkspaces(dir)).toEqual({
			version: 1,
			projects: { [project]: { roots: [root], allowed: [] } },
		});
	});

	it("根去重；移除后空条目回收", () => {
		const dir = makeAgentDir();
		const project = projectRoot(dir);
		const root = otherRoot(dir);
		addWorkspaceRoot(dir, project, root);
		addWorkspaceRoot(dir, project, root); // 去重
		addAllowedPattern(dir, project, "bash: git push*");
		expect(loadWorkspaces(dir).projects[project].roots).toEqual([root]);
		removeWorkspaceRoot(dir, project, root);
		const afterRemove = loadWorkspaces(dir);
		expect(afterRemove.projects[project]).toEqual({ roots: [], allowed: ["bash: git push*"] });
		// 移除最后记忆后条目整体回收
		const raw = JSON.parse(readFileSync(workspaceConfigPath(dir), "utf-8"));
		raw.projects[project] = { roots: [], allowed: [] };
		writeFileSync(workspaceConfigPath(dir), JSON.stringify(raw));
		removeWorkspaceRoot(dir, project, join(dir, "nonexistent"));
		expect(loadWorkspaces(dir).projects[project]).toBeUndefined();
	});

	it("记忆去重后移到末尾（LRU 语义）；非法文件回退空配置", () => {
		const dir = makeAgentDir();
		const project = projectRoot(dir);
		addAllowedPattern(dir, project, "a*");
		addAllowedPattern(dir, project, "b*");
		addAllowedPattern(dir, project, "a*");
		expect(loadWorkspaces(dir).projects[project].allowed).toEqual(["b*", "a*"]);
		writeFileSync(workspaceConfigPath(dir), "{broken");
		expect(loadWorkspaces(dir)).toEqual(emptyWorkspaces());
	});

	it("mtime 加载器：文件变更后重新读取", () => {
		const dir = makeAgentDir();
		const load = createWorkspacesLoader(dir);
		expect(load()).toEqual(emptyWorkspaces());
		const project = projectRoot(dir);
		const root = otherRoot(dir);
		addWorkspaceRoot(dir, project, root);
		expect(load().projects[project]).toEqual({ roots: [root], allowed: [] });
	});
});

describe("suggestRootCandidate", () => {
	it("向上找最近 .git 根", () => {
		const dir = makeAgentDir();
		const repo = join(dir, "repo");
		mkdirSync(join(repo, ".git"), { recursive: true });
		mkdirSync(join(repo, "a", "b"), { recursive: true });
		const home = join(dir, "home");
		expect(suggestRootCandidate(join(repo, "a", "b", "f.ts"), home)).toBe(repo);
	});

	it("无 .git → 父目录；home/home 祖先/根目录绝不作为候选", () => {
		const dir = makeAgentDir();
		const home = join(dir, "home");
		mkdirSync(join(home, "work", "note"), { recursive: true });
		// 无 .git：父目录
		expect(suggestRootCandidate(join(home, "work", "note", "a.md"), home)).toBe(join(home, "work", "note"));
		// 父目录即 home → null（绝不放行整个家目录）
		expect(suggestRootCandidate(join(home, "todo.md"), home)).toBeNull();
		// 父目录是 home 的祖先 → null（不慎放行 /Users 级别目录）
		expect(suggestRootCandidate(join(dir, "x.md"), home)).toBeNull();
		expect(suggestRootCandidate("/f.ts", home)).toBeNull();
	});

	it("home 下有 .git 也不返回 home（目录而非文件路径的场景同样安全）", () => {
		const dir = makeAgentDir();
		const home = join(dir, "home");
		mkdirSync(join(home, ".git"), { recursive: true });
		mkdirSync(join(home, "sub"), { recursive: true });
		// 从 home/sub/x 向上找到 home 的 .git，但 home 不安全 → 继续向上无 .git → 父目录
		expect(suggestRootCandidate(join(home, "sub", "x"), home)).toBe(join(home, "sub"));
	});
});
