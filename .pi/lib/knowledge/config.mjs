import { invalidateKnowledgeUi } from './ui-state.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';

const stateKey = Symbol.for('percho.knowledge.binding.v1');
const state = globalThis[stateKey] ||= { local: new AsyncLocalStorage(), queues: new Map() };
export function knowledgeDirectory() {
  const value = process.env.PERCHO_KNOWLEDGE_DIR;
  if (!value) return null; // CLI/legacy projects do not silently mutate desktop state.
  if (!isAbsolute(value)) throw new Error('PERCHO_KNOWLEDGE_DIR must be absolute');
  return resolve(value);
}
export function projectIdentity(cwd, configured) {
  if (configured && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(configured)) return configured;
  const path = resolve(cwd);
  const stem = basename(path).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';
  return `${stem}-${createHash('sha256').update(path).digest('hex').slice(0, 10)}`;
}
export async function readKnowledgeBinding({ fresh = false } = {}) {
  if (!fresh && state.local.getStore()) return state.local.getStore();
  const dir = knowledgeDirectory();
  if (!dir) return null;
  let value;
  try { value = JSON.parse(await readFile(join(dir, 'binding.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error(`Knowledge binding cannot be read: ${error.message}`); }
  if (value.version !== 1 || !isAbsolute(value.vault || '') || !/^[a-f0-9]{24}$/.test(value.vaultId || '') ||
      !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      !['project', 'literature', 'hybrid'].includes(value.profile) ||
      !['run-only', 'verified', 'rich'].includes(value.depositMode) ||
      !['none', 'read-local'].includes(value.subagentPolicy)) throw new Error('Invalid application knowledge binding; no project fallback was used');
  return value;
}
export async function saveKnowledgeBinding(input, expectedRevision = null) {
  const dir = knowledgeDirectory();
  if (!dir) throw new Error('Application knowledge directory is not configured');
  const previous = state.queues.get(dir) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const current = await readKnowledgeBinding({ fresh: true });
    if (expectedRevision !== null && (current?.revision || 0) !== expectedRevision) throw new Error('Knowledge binding changed while confirming; review the new binding');
    const vault = await realpath(input.vault);
    const value = { version: 1, vault, vaultId: createHash('sha256').update(vault).digest('hex').slice(0, 24),
      revision: (current?.revision || 0) + 1, profile: input.profile, depositMode: input.depositMode,
      subagentPolicy: input.subagentPolicy, updatedAt: new Date().toISOString() };
    if (!['project','literature','hybrid'].includes(value.profile) || !['run-only','verified','rich'].includes(value.depositMode) ||
        !['none','read-local'].includes(value.subagentPolicy)) throw new Error('Invalid knowledge policy');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = join(dir, `binding.${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temp, join(dir, 'binding.json'));
    invalidateKnowledgeUi();
    return value;
  });
  state.queues.set(dir, operation);
  try { return await operation; }
  finally { if (state.queues.get(dir) === operation) state.queues.delete(dir); }
}
export async function withKnowledgeBinding(binding, operation) {
  const current = await readKnowledgeBinding({ fresh: true });
  if (!binding || current?.vaultId !== binding.vaultId || current?.revision !== binding.revision) {
    throw new Error('Knowledge binding changed; start a new turn before reading or writing');
  }
  return state.local.run(binding, operation);
}
