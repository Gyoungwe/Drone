// @ts-nocheck
import {
  readNoteFile
} from "./chunk-UFYQ36T5.mjs";

// packages/knowledge/src/layout.ts
import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
var MANAGED_START = "<!-- pi-agent:managed:start -->";
var MANAGED_END = "<!-- pi-agent:managed:end -->";
var PROJECT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var NAVIGATION_TARGETS = /* @__PURE__ */ new Set(["Home.md", "Wiki/Index.md", "Library/Index.md"]);
function containsPath(root, target) {
  const relativePath = relative(root, target);
  return relativePath === "" || !isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`);
}
async function canonicalPath(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== "ENOENT" || dirname(path) === path) throw error;
    return join(await canonicalPath(dirname(path)), basename(path));
  }
}
async function containedVaultFile(root, path) {
  const vault = resolve(root);
  const target = resolve(vault, path);
  if (!containsPath(vault, target) || !containsPath(vault, await canonicalPath(target)))
    throw new Error("Path must stay inside Vault");
  return target;
}
async function createVaultFileOnly(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  try {
    await link(temporary, path);
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await lstat(path);
    if (!existing.isFile() || existing.isSymbolicLink())
      throw new Error(`Expected a regular Vault file: ${path}`);
    return false;
  } finally {
    await unlink(temporary);
  }
}
function navigationBase(heading) {
  return `${heading}

## Human review
`;
}
var hash = (text) => createHash("sha256").update(text).digest("hex");
async function updateVaultNavigation(vault, path, heading, body, containedFile = containedVaultFile) {
  if (!NAVIGATION_TARGETS.has(path) && !/^Projects\/[a-z0-9-]+\/Index\.md$/.test(path))
    throw new Error("Not an allowed navigation target");
  const full = await containedFile(vault, path);
  let original = null;
  try {
    original = (await readNoteFile(vault, path)).text;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const base = original ?? navigationBase(heading);
  const start = base.indexOf(MANAGED_START);
  const end = base.indexOf(MANAGED_END);
  const block = `${MANAGED_START}
${body.trim()}
${MANAGED_END}`;
  if (start < 0 !== end < 0 || end < start || start >= 0 && (base.indexOf(MANAGED_START, start + 1) >= 0 || base.indexOf(MANAGED_END, end + 1) >= 0))
    throw new Error("Invalid navigation managed markers");
  const updated = start >= 0 ? base.slice(0, start) + block + base.slice(end + MANAGED_END.length) : `${base.trimEnd()}

${block}
`;
  if (updated === original) return { path, changed: false };
  if (original !== null) {
    if ((await readNoteFile(vault, path)).hash !== hash(original))
      throw new Error("Human navigation changed; update was not applied");
  }
  await mkdir(dirname(full), { recursive: true });
  if (original === null) {
    await writeFile(full, updated, { encoding: "utf8", flag: "wx" });
  } else {
    const temporary = `${full}.${randomUUID()}.tmp`;
    await writeFile(temporary, updated, { encoding: "utf8", flag: "wx" });
    try {
      await rename(temporary, full);
    } finally {
      await unlink(temporary).catch(() => void 0);
    }
  }
  return { path, changed: true };
}
function resolveDependencies(dependencies) {
  const containedFile = dependencies.containedFile ?? containedVaultFile;
  return {
    containedFile,
    createOnly: dependencies.createOnly ?? createVaultFileOnly,
    updateNavigation: dependencies.updateNavigation ?? ((vault, path, heading, body) => updateVaultNavigation(vault, path, heading, body, containedFile))
  };
}
async function initializeSharedNavigation(vault, dependencies = {}) {
  const { containedFile, createOnly, updateNavigation } = resolveDependencies(dependencies);
  for (const directory of ["Wiki", "Inbox"])
    await mkdir(await containedFile(vault, directory), { recursive: true });
  await createOnly(
    await containedFile(vault, "Wiki/Index.md"),
    "# Research Wiki\n\n\u8FD9\u91CC\u7EF4\u62A4\u8DE8\u9879\u76EE\u7684\u4E3B\u9898\u5730\u56FE\u3002\u5148\u9605\u8BFB\u76F8\u5173\u4E3B\u9898\uFF0C\u518D\u6CBF\u6765\u6E90\u67E5\u8BC1\uFF1B\u4E0D\u8981\u628A\u76EE\u5F55\u672A\u547D\u4E2D\u5F53\u6210\u6CA1\u6709\u77E5\u8BC6\u3002\n\n<!-- pi-agent:managed:start -->\n<!-- pi-agent:managed:end -->\n\n## Human review\n"
  );
  await createOnly(
    await containedFile(vault, "Inbox/Index.md"),
    "# Inbox\n\n\u5F85\u6574\u7406\u3001\u5F85\u6838\u9A8C\u7684\u8F93\u5165\u3002\u8FD9\u91CC\u7684\u5185\u5BB9\u4E0D\u662F\u5DF2\u786E\u8BA4\u7ED3\u8BBA\u3002\n\n## Human review\n"
  );
  await updateNavigation(
    vault,
    "Home.md",
    "# Research Vault",
    "- [[Wiki/Index]] \u2014 \u5171\u4EAB\u4E3B\u9898\u4E0E\u9605\u8BFB\u8DEF\u7EBF\n- [[Library/Index]] \u2014 \u6587\u732E\u3001\u65B9\u6CD5\u4E0E\u53EF\u590D\u7528\u77E5\u8BC6\n- [[Projects/Index]] \u2014 \u9879\u76EE\u80CC\u666F\u4E0E\u8BC1\u636E\u94FE\n- [[Inbox/Index]] \u2014 \u5F85\u6574\u7406\u8D44\u6599\n\nWiki \u662F\u5BFC\u822A\u4E0E\u7EFC\u5408\u8BA4\u8BC6\uFF0C\u4E0D\u4EE3\u66FF\u539F\u59CB\u8BC1\u636E\u3002\u4EBA\u5DE5\u590D\u6838\u4E0E\u51B2\u7A81\u72B6\u6001\u5FC5\u987B\u4E00\u8D77\u9605\u8BFB\u3002"
  );
}
async function initializeProjectContext(vault, project, dependencies = {}) {
  if (!PROJECT_PATTERN.test(project)) throw new Error("Invalid project identifier");
  const { containedFile, createOnly } = resolveDependencies(dependencies);
  await createOnly(
    await containedFile(vault, `Projects/${project}/Context.md`),
    `---
type: project-context
project: ${JSON.stringify(project)}
---

# ${project}

## \u7814\u7A76\u76EE\u6807
\u5C1A\u5F85\u7528\u6237\u786E\u8BA4\u3002

## \u9002\u7528\u8303\u56F4\u4E0E\u9650\u5236
\u5C1A\u5F85\u786E\u8BA4\u3002

## \u65E2\u6709\u51B3\u7B56
\u53C2\u89C1\u672C\u9879\u76EE\u7684 Decisions \u4E0E Runs\u3002

## Human review
`
  );
}

export {
  containedVaultFile,
  createVaultFileOnly,
  updateVaultNavigation,
  initializeSharedNavigation,
  initializeProjectContext
};
