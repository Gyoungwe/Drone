// @ts-nocheck
import {
  projectIdentity
} from "./chunk-CXEKIGAQ.mjs";

// packages/knowledge/src/project-identity.ts
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
var SESSION_PROJECT_ENTRY = "drone-session-project-v1";
var LEGACY_DEFAULT_PROJECT = "research-workbench";
var SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|shared)$/;
function isProjectSlug(value) {
  return typeof value === "string" && value.length <= 96 && SLUG.test(value) && !RESERVED.test(value);
}
function normalizeProjectSlug(input) {
  if (typeof input !== "string") return null;
  const slug = input.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96).replace(/-+$/g, "");
  return isProjectSlug(slug) ? slug : null;
}
function workspaceProjectId(cwd, configured) {
  return projectIdentity(cwd, isProjectSlug(configured) ? configured : void 0);
}
function dailyWorkspaceDir(home = homedir()) {
  return join(home, ".drone", "daily");
}
function samePath(a, b) {
  const left = resolve(a).replace(/[\\/]+$/, "");
  const right = resolve(b).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
function isDailyWorkspace(cwd, home) {
  return samePath(cwd, dailyWorkspaceDir(home));
}
function sessionProjectFromEntries(entries) {
  if (!Array.isArray(entries)) return null;
  let project = null;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || entry.customType !== SESSION_PROJECT_ENTRY) continue;
    if (entry.type !== void 0 && entry.type !== "custom") continue;
    const value = entry.data?.project;
    if (value === null) project = null;
    else if (isProjectSlug(value)) project = value;
  }
  return project;
}
function sessionEntriesOf(ctx) {
  try {
    const manager = ctx?.sessionManager;
    const entries = manager?.getBranch?.() ?? manager?.getEntries?.();
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}
function resolveProjectIdentity(input) {
  const daily = isDailyWorkspace(input.cwd, input.home);
  const requestedText = typeof input.requested === "string" ? input.requested.trim() : "";
  const requested = requestedText || null;
  let project;
  let source;
  const session = daily ? sessionProjectFromEntries(input.sessionEntries) : null;
  if (session) {
    project = session;
    source = "session";
  } else if (isProjectSlug(input.configured)) {
    project = input.configured;
    source = "workspace-config";
  } else {
    project = workspaceProjectId(input.cwd);
    source = "workspace";
  }
  const ignoredRequest = requested !== null && normalizeProjectSlug(requested) !== project;
  return { project, source, daily, requested, ignoredRequest };
}
async function readConfiguredProject(cwd) {
  try {
    const parsed = JSON.parse(await readFile(join(cwd, ".pi", "research-workspace.json"), "utf8"));
    if (parsed && typeof parsed === "object" && "knowledgeProjectId" in parsed)
      return parsed.knowledgeProjectId;
  } catch {
  }
  return void 0;
}
async function resolveWorkspaceProject(input) {
  return resolveProjectIdentity({ ...input, configured: await readConfiguredProject(input.cwd) });
}
function runProject(metadataProject, resolution) {
  if (isProjectSlug(metadataProject) && metadataProject !== LEGACY_DEFAULT_PROJECT) return metadataProject;
  return resolution.project;
}
function projectNotice(resolution) {
  if (!resolution.ignoredRequest) return null;
  const how = resolution.daily ? "In the daily space the user picks a project per session with /project <slug>." : "The project is fixed by the current workspace (knowledgeProjectId in .pi/research-workspace.json).";
  return `Requested project "${resolution.requested}" was ignored; using "${resolution.project}". ${how}`;
}
function describeProject(resolution) {
  const notice = projectNotice(resolution);
  return { project: resolution.project, source: resolution.source, ...notice ? { notice } : {} };
}

export {
  SESSION_PROJECT_ENTRY,
  LEGACY_DEFAULT_PROJECT,
  isProjectSlug,
  normalizeProjectSlug,
  workspaceProjectId,
  dailyWorkspaceDir,
  isDailyWorkspace,
  sessionProjectFromEntries,
  sessionEntriesOf,
  resolveProjectIdentity,
  readConfiguredProject,
  resolveWorkspaceProject,
  runProject,
  projectNotice,
  describeProject
};
