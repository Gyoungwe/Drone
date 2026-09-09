import { access, mkdir, readdir, readFile, writeFile, rename, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { initializeVault, loadWorkspaceConfig, saveWorkspaceConfig } from '../extensions/workspace-config.mjs';
import { LAYOUT, renderTemplate } from './vault-layout.mjs';

export const SERVER_NAME = 'research-obsidian';

const PROJECT_TYPES = [...LAYOUT.projectTypes, 'Software', 'Methods'];
const LIBRARY_TYPES = LAYOUT.libraryTypes;
const MANAGED_START = '<!-- pi-agent:managed:start -->';
const MANAGED_END = '<!-- pi-agent:managed:end -->';
const PROJECT_TEMPLATE = `---\ntype: project\nproject: "{{project_slug}}"\ntitle: {{project_title_yaml}}\ncreated_at: "{{created_at}}"\n---\n\n# {{project_title}}\n\n[[Home]] | [[Projects/Index]] | [[Library/Index]]\n\n## Research question\n\n## Goals\n\n## Next steps\n\n${MANAGED_START}\n{{project_content}}\n${MANAGED_END}\n\n## Human review\n\n`;
const vaultUpdates = new Map();

function validateProject(project) {
  if (typeof project !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(project)) {
    throw new Error('project must be a non-reserved lowercase kebab-case slug');
  }
  return project;
}

async function configuredVault(cwd) {
  const { obsidianVault } = await loadWorkspaceConfig(cwd);
  if (!obsidianVault) throw new Error('Obsidian vault must be configured first');
  // Summaries may be the first writer in a freshly configured test or vault;
  // initializeVault will add the directory structure below.
  await mkdir(obsidianVault, { recursive: true });
  return canonical(obsidianVault);
}

async function vaultPath(vault, ...parts) {
  const file = join(vault, ...parts);
  if (!contains(vault, await canonical(file))) throw new Error('Project path must stay inside the configured vault');
  return file;
}

// Serialize updates for one vault so parallel project creation cannot lose links.
async function updateVault(cwd, operation) {
  const vault = await configuredVault(cwd);
  const previous = vaultUpdates.get(vault) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => operation(vault));
  vaultUpdates.set(vault, next);
  try { return await next; }
  finally { if (vaultUpdates.get(vault) === next) vaultUpdates.delete(vault); }
}

async function readText(file) {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function writeManagedIndex(file, heading, body) {
  const original = await readText(file) ?? `${heading}\n\n## Human review\n\n`;
  const start = original.indexOf(MANAGED_START);
  const end = original.indexOf(MANAGED_END);
  const block = `${MANAGED_START}\n${body.trim()}\n${MANAGED_END}`;
  let updated;
  if (start !== -1 || end !== -1) {
    if (start === -1 || end < start || original.indexOf(MANAGED_START, start + 1) !== -1 || original.indexOf(MANAGED_END, end + 1) !== -1) {
      throw new Error(`Invalid managed index markers: ${file}`);
    }
    updated = original.slice(0, start) + block + original.slice(end + MANAGED_END.length);
  } else {
    const review = original.search(/^## Human review\s*$/m);
    updated = review < 0 ? `${original}${original.endsWith('\n') ? '\n' : '\n\n'}${block}\n` : `${original.slice(0, review)}${block}\n\n${original.slice(review)}`;
  }
  if (updated === original) return;
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, updated, 'utf8');
  await rename(temporary, file);
}

async function childEntries(directory) {
  try { return await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function noteLinks(vault, directory) {
  const links = [];
  for (const entry of await childEntries(directory)) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) links.push(...await noteLinks(vault, file));
    else if (entry.isFile() && entry.name.endsWith('.md')) {
      const target = relative(vault, file).replaceAll(sep, '/').slice(0, -3);
      if (!/[\[\]|#\r\n]/.test(target)) links.push(`- [[${target}]]`);
    }
  }
  return links.sort((a, b) => a.localeCompare(b));
}

async function categorizedLinks(vault, root, types) {
  const sections = [];
  for (const type of types) {
    const directory = await vaultPath(vault, root, type);
    const links = await noteLinks(vault, directory);
    sections.push(`## ${type}\n\n${links.join('\n')}`.trimEnd());
  }
  return sections.join('\n\n');
}

function renderProjectTemplate(template, project, title, body) {
  return renderTemplate(template, { project_slug: project, title, project_title: title, project_title_yaml: JSON.stringify(title), created_at: new Date().toISOString(), project_content: body });
}

async function ensureTemplate(vault) {
  const template = await vaultPath(vault, 'Templates', 'Project.md');
  await createOnly(template, PROJECT_TEMPLATE);
  return template;
}

async function refreshIndexes(vault, project = null, refreshAll = false) {
  const projectRoot = await vaultPath(vault, 'Projects');
  const projects = (await childEntries(projectRoot)).filter(entry => entry.isDirectory() && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)).map(entry => entry.name).sort();
  const projectIndexes = [];
  for (const slug of projects) {
    const index = await vaultPath(vault, 'Projects', slug, 'Index.md');
    if (refreshAll || project === slug || await readText(index) === null) {
      const body = await categorizedLinks(vault, `Projects/${slug}`, PROJECT_TYPES);
      await writeManagedIndex(index, `---\ntype: project\nproject: ${JSON.stringify(slug)}\n---\n\n# ${slug}\n\n[[Home]] | [[Projects/Index]] | [[Library/Index]]`, body);
    }
    projectIndexes.push(index);
  }
  const links = projects.map(slug => `- [[Projects/${slug}/Index]]`).join('\n');
  const projectsIndex = await vaultPath(vault, 'Projects', 'Index.md');
  const legacyIndex = await vaultPath(vault, 'Indexes', 'Projects.md');
  const libraryIndex = await vaultPath(vault, 'Library', 'Index.md');
  await writeManagedIndex(projectsIndex, '# Projects\n\n[[Home]]', links);
  await writeManagedIndex(legacyIndex, '# Projects', links);
  await writeManagedIndex(libraryIndex, '# Library\n\n[[Home]]', await categorizedLinks(vault, 'Library', LIBRARY_TYPES));
  const knowledgeIndex = await vaultPath(vault, 'Indexes', 'Knowledge.md');
  await writeManagedIndex(knowledgeIndex, '# Knowledge', [links, '[[Library/Index]]'].filter(Boolean).join('\n\n'));
  return { projectsIndex, legacyIndex, libraryIndex, knowledgeIndex, projectIndexes };
}

export async function installProjectTemplate({ cwd = process.cwd() } = {}) {
  return updateVault(cwd, async vault => ({ vault, template: await ensureTemplate(vault), ...await refreshIndexes(vault) }));
}

export async function refreshProjectIndexes({ cwd = process.cwd(), project = null } = {}) {
  if (project !== null) validateProject(project);
  return updateVault(cwd, async vault => ({ vault, ...await refreshIndexes(vault, project, project === null) }));
}

export async function publishSourceNote({ cwd = process.cwd(), runDir, entry }) {
  const config = await loadWorkspaceConfig(cwd);
  if (!config.obsidianVault) return { obsidian_note: null, knowledge_status: 'not-configured' };
  if (entry.status !== 'downloaded' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Only verified downloads can be indexed');
  if (!contains(await canonical(config.resultsRoot), await canonical(runDir)) || !contains(await canonical(runDir), await canonical(entry.path))) throw new Error('Source must remain inside its research run');
  if (createHash('sha256').update(await readFile(entry.path)).digest('hex') !== entry.sha256) throw new Error('Source hash changed before indexing');
  const metadata = await readJson(join(runDir, 'metadata.json'));
  const project = validateProject(metadata.project || 'research-workbench');
  const category = ['papers', 'supplementary'].includes(entry.category) ? 'Papers' : 'Software';
  const title = String(entry.metadata?.title || basename(entry.path)).replace(/[<>\r\n]/g, ' ').trim().slice(0, 200);
  const slug = (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || entry.category) + '-' + entry.sha256.slice(0, 16);
  return updateVault(cwd, async vault => {
    const note = await vaultPath(vault, 'Library', category, `${slug}.md`);
    const projectNote = await vaultPath(vault, 'Projects', project, category, `${slug}.md`);
    const provenance = JSON.stringify({ url: entry.url, final_url: entry.final_url, downloaded_at: entry.downloaded_at, sha256: entry.sha256, size_bytes: entry.size_bytes, metadata: entry.metadata }, null, 2).replaceAll('<', '\\u003c');
    const body = `[[Projects/${project}/Index]] | [[Library/Index]]\n\n[Original file](${pathToFileURL(entry.path).href})\n\n## Provenance\n\n\`\`\`json\n${provenance}\n\`\`\`\n\n## Evidence status\n\nArchived source; scientific claims have not been independently verified.`;
    await writeManagedIndex(note, `---\nid: pi-${randomUUID()}\ntype: ${category === 'Papers' ? 'paper' : 'software'}\nsource_sha256: ${entry.sha256}\n---\n\n# ${title}`, body);
    await writeManagedIndex(projectNote, `# ${title}`, `[[Library/${category}/${slug}]]\n\n[Run files](${pathToFileURL(runDir).href})`);
    return { obsidian_note: note, project_note: projectNote, knowledge_status: 'written', indexes: await refreshIndexes(vault, project) };
  });
}

export async function createObsidianProject({ cwd = process.cwd(), project, title = project } = {}) {
  validateProject(project);
  if (typeof title !== 'string' || !title.trim() || title.length > 200 || /[\r\n\x00-\x1f]/.test(title)) throw new Error('Project title must be a single non-empty line of at most 200 characters');
  return updateVault(cwd, async vault => {
    const template = await ensureTemplate(vault);
    const directory = await vaultPath(vault, 'Projects', project);
    const index = await vaultPath(vault, 'Projects', project, 'Index.md');
    const created = await readText(index) === null;
    for (const type of PROJECT_TYPES) await mkdir(await vaultPath(vault, 'Projects', project, type), { recursive: true });
    if (created) {
      const body = await categorizedLinks(vault, `Projects/${project}`, PROJECT_TYPES);
      await createOnly(index, renderProjectTemplate(await readFile(template, 'utf8'), project, title.trim(), body));
      const copyDefaults = async (parts = []) => {
        const source = await vaultPath(vault, 'Projects', '_template', ...parts);
        for (const entry of await childEntries(source)) {
          if (entry.isSymbolicLink()) throw new Error('Project template symlinks are not allowed');
          if (!parts.length && entry.name === 'Index.md') continue;
          const next = [...parts, entry.name];
          const target = await vaultPath(vault, 'Projects', project, ...next);
          if (entry.isDirectory()) { await mkdir(target, { recursive: true }); await copyDefaults(next); }
          else if (entry.isFile() && entry.name.endsWith('.md')) {
            await createOnly(target, renderProjectTemplate(await readFile(join(source, entry.name), 'utf8'), project, title.trim(), ''));
          }
        }
      };
      await copyDefaults();
    }
    const indexes = await refreshIndexes(vault, project);
    return { vault, project, directory, index, template, created, ...indexes };
  });
}

async function readJson(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Invalid JSON object: ${file}`);
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function atomicJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await rename(temp, file);
}

async function createOnly(file, content) {
  await mkdir(dirname(file), { recursive: true });
  try { await writeFile(file, content, { encoding: 'utf8', flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}

// Resolve existing ancestors as well as the final component to catch junctions.
async function canonical(file) {
  try { return await realpath(file); }
  catch (error) {
    if (error.code !== 'ENOENT' || dirname(file) === file) throw error;
    return join(await canonical(dirname(file)), basename(file));
  }
}

function contains(root, child) {
  const rel = relative(root, child);
  return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
}

export async function obsidianStatus(cwd) {
  try {
    const config = await loadWorkspaceConfig(cwd);
    const vault = config.obsidianVault;
    if (!vault) return { state: 'needs-setup', vault: null };
    if (process.env.PI_RESEARCH_DESKTOP_CONFIG) return { state: config.mcpStatus === 'connected' ? 'ready' : config.mcpStatus || 'missing-mcp', vault, server: SERVER_NAME };
    try { await access(join(vault, '.obsidian')); }
    catch { return { state: 'missing-vault', vault }; }
    const mcp = await readJson(join(cwd, '.mcp.json'));
    const server = mcp.mcpServers?.[SERVER_NAME];
    if (!server || server.disabled || server.args?.at(-1) !== vault) return { state: 'missing-mcp', vault };
    try { await access(server.args[0]); if (server.args[0].endsWith('vault-mcp-proxy.mjs')) await access(server.args[1]); }
    catch { return { state: 'missing-server', vault }; }
    const home = join(vault, 'Home.md');
    return { state: 'ready', vault, server: SERVER_NAME, home, uri: `obsidian://open?path=${encodeURIComponent(home.replaceAll('\\', '/'))}` };
  } catch (error) { return { state: 'config-error', error: error.message }; }
}

export async function configureObsidian({ cwd, vault, project = null, server }) {
  if (process.env.PI_RESEARCH_DESKTOP_CONFIG) throw new Error('Use desktop settings to initialize or bind a Vault');
  if (typeof vault !== 'string' || !vault.trim()) throw new Error('Vault path is required');
  cwd = await canonical(resolve(cwd));
  vault = await canonical(resolve(cwd, vault));
  if (contains(cwd, vault) || contains(vault, cwd)) throw new Error('Vault must be independent from the code workspace');
  if (project !== null) validateProject(project);
  server = resolve(server || join(cwd, '.pi/npm/node_modules/@bitbonsai/mcpvault/dist/server.js'));
  const mcpPath = join(cwd, '.mcp.json');
  const mcp = await readJson(mcpPath);
  if (mcp.mcpServers && (typeof mcp.mcpServers !== 'object' || Array.isArray(mcp.mcpServers))) throw new Error('Invalid JSON mcpServers');
  const proxy = fileURLToPath(new URL('./vault-mcp-proxy.mjs', import.meta.url));
  const existing = mcp.mcpServers?.[SERVER_NAME];
  if (existing && existing.args?.[0] !== server && existing.args?.[0] !== proxy) throw new Error('research-obsidian is already configured by another server');
  await initializeVault(vault, project);
  await saveWorkspaceConfig(cwd, { obsidianVault: vault });
  mcp.mcpServers = { ...mcp.mcpServers, [SERVER_NAME]: {
    command: process.env.PI_MCP_NODE_PATH || process.execPath,
    args: [proxy, server, join(cwd, '.pi/research-workspace.json'), vault], cwd,
    lifecycle: 'lazy',
  } };
  await atomicJson(mcpPath, mcp);
  if (project) await createObsidianProject({ cwd, project });
  await refreshProjectIndexes({ cwd });
  return obsidianStatus(cwd);
}
