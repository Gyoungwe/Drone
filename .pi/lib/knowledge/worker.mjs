import { DatabaseSync } from 'node:sqlite';
import { watch } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { allowedSegment, canRead, inspectNote, noteScope, readNoteFile, snippet, validateNote } from './files.mjs';

await mkdir(dirname(workerData.database), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(workerData.database, { timeout: 1500 });
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1500; PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT OR IGNORE INTO meta VALUES('revision',0);
CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE,
 title TEXT NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL, signature TEXT NOT NULL,
 scope TEXT NOT NULL, kind TEXT NOT NULL, bytes INTEGER NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(title, terms, tokenize='unicode61');
CREATE TABLE IF NOT EXISTS links(source TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY(source,target));
CREATE INDEX IF NOT EXISTS links_target ON links(target);
CREATE INDEX IF NOT EXISTS notes_scope ON notes(scope,kind);
CREATE TABLE IF NOT EXISTS jobs(key TEXT PRIMARY KEY, kind TEXT NOT NULL, path TEXT NOT NULL,
 scope TEXT NOT NULL, revision INTEGER NOT NULL, updated TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_scope_updated ON jobs(scope,updated DESC);
CREATE INDEX IF NOT EXISTS jobs_scope_kind_updated ON jobs(scope,kind,updated DESC);
CREATE TABLE IF NOT EXISTS problems(path TEXT PRIMARY KEY, message TEXT NOT NULL);
PRAGMA user_version=1;`);
let revision = Number(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value);
let scan = null, coverage = 'uninitialized', lastReconciledAt = null, watching = false, timer = null, closed = false;
let fullScanRequested = false;
const dirty = new Set(), inflight = new Map();
const stats = { bodyReads: 0, metadataChecks: 0, reconciliations: 0, changes: 0, searches: 0 };
const statements = {
 get: db.prepare('SELECT * FROM notes WHERE path=?'),
 count: db.prepare('SELECT count(*) count FROM notes'),
 removeFts: db.prepare('DELETE FROM search WHERE rowid=?'),
 remove: db.prepare('DELETE FROM notes WHERE path=?'),
 links: db.prepare('DELETE FROM links WHERE source=?'),
 addLink: db.prepare('INSERT OR IGNORE INTO links VALUES(?,?)'),
 problem: db.prepare('INSERT OR REPLACE INTO problems VALUES(?,?)'),
 clearProblem: db.prepare('DELETE FROM problems WHERE path=?'),
 job: db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET revision=excluded.revision,updated=excluded.updated'),
};
function bump() {
  revision = Number(db.prepare("UPDATE meta SET value=value+1 WHERE key='revision' RETURNING value").get().value);
}
function tokens(text) {
  const words = String(text).normalize('NFKC').toLowerCase().match(/[a-z0-9][a-z0-9._+-]*|[\p{Script=Han}]+/gu) || [];
  const out = [];
  for (const word of words) {
    if (/\p{Script=Han}/u.test(word)) {
      // Explicit Chinese character/bigram tokens cover one- and two-character queries.
      const chars = [...word];
      for (let i = 0; i < chars.length; i++) {
        out.push(chars[i]);
        if (i + 1 < chars.length) out.push(chars[i] + chars[i + 1]);
      }
    } else out.push(word);
  }
  return out;
}
function queryExpression(query) {
  if (typeof query !== 'string' || !query.trim() || query.length > 2000) throw new Error('Query must contain 1–2000 characters');
  const terms = [...new Set(tokens(query))].slice(0, 32);
  if (!terms.length) throw new Error('Query has no searchable terms');
  return terms.map(term => '"' + term.replaceAll('"', '""') + '"').join(' OR ');
}
function job(kind, path, scope) {
  statements.job.run(`${kind}:${path}`, kind, path, scope, revision, new Date().toISOString());
}
let uiTimer=null;
function signalUiChange(){if(uiTimer)return;uiTimer=setTimeout(()=>{uiTimer=null;parentPort.postMessage({uiChanged:true});},500);uiTimer.unref();}
function changed(path, previous) {
  signalUiChange();
  stats.changes++;
  const scope = noteScope(path);
  if (!/(?:^|\/)(?:Index|Context|Home)\.md$/i.test(path)) {
    job('navigation', scope === 'shared' ? (path.startsWith('Wiki/') ? 'Wiki/Index.md' : 'Library/Index.md') : `Projects/${scope}/Index.md`, scope);
    // New evidence is searchable immediately; semantic Wiki consolidation is a separate pending item.
    if (!/(?:^|\/)Wiki\//.test(path)) job('evidence-review', path, scope);
  }
  const dependents = db.prepare('SELECT source FROM links WHERE target=?').all(path);
  for (const { source } of dependents) if (/(?:^|\/)Wiki\//.test(source) && !source.endsWith('/Index.md')) job('wiki-review', source, noteScope(source));
  if (previous && previous.scope !== scope) job('navigation', `Projects/${previous.scope}/Index.md`, previous.scope);
}
function internalLinks(path, text) {
  const out = new Set();
  for (const match of text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
    let target = match[1].trim();
    if (!target.includes('/')) {
      // Only unambiguous root or sibling links are treated as dependency edges.
      target = ['Home', 'Index', 'Context'].includes(target) && target !== 'Home'
        ? `${path.split('/').slice(0,-1).join('/')}/${target}` : target;
    }
    if (!target.endsWith('.md')) target += '.md';
    try { validateNote(target); out.add(target); } catch { /* unsafe/external link: never followed */ }
  }
  return out;
}
async function updatePath(path, force = false) {
  validateNote(path);
  if (inflight.has(path)) return inflight.get(path);
  const task = (async () => {
    const previous = statements.get.get(path);
    try {
      stats.metadataChecks++;
      const info = await inspectNote(workerData.vault, path);
      if (!force && previous?.signature === info.signature) return previous;
      const file = await readNoteFile(workerData.vault, path); stats.bodyReads++;
      if (previous?.hash === file.hash) {
        db.prepare('UPDATE notes SET signature=? WHERE path=?').run(file.signature, path);
        statements.clearProblem.run(path);
        return statements.get.get(path);
      }
      const title = file.text.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.split('/').at(-1).slice(0,-3);
      const kind = /(?:^|\/)(?:Index|Context|Home)\.md$/i.test(path) ? 'navigation' : /(?:^|\/)Wiki\//.test(path) ? 'wiki' : 'note';
      db.exec('BEGIN IMMEDIATE');
      try {
        if (previous) statements.removeFts.run(previous.id);
        db.prepare(`INSERT INTO notes(path,title,body,hash,signature,scope,kind,bytes) VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(path) DO UPDATE SET title=excluded.title,body=excluded.body,hash=excluded.hash,
          signature=excluded.signature,scope=excluded.scope,kind=excluded.kind,bytes=excluded.bytes`)
          .run(path,title,file.text,file.hash,file.signature,noteScope(path),kind,file.bytes);
        const row = statements.get.get(path);
        db.prepare('INSERT INTO search(rowid,title,terms) VALUES(?,?,?)').run(row.id,tokens(title).join(' '),tokens(file.text).join(' '));
        statements.links.run(path);
        for (const target of internalLinks(path, file.text)) statements.addLink.run(path,target);
        statements.clearProblem.run(path); bump(); changed(path, previous); db.exec('COMMIT');
        return row;
      } catch (error) { db.exec('ROLLBACK'); revision = Number(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value); throw error; }
    } catch (error) {
      // Unreadable/symlinked/deleted notes must not remain in search as stale evidence.
      if (previous) {
        db.exec('BEGIN IMMEDIATE');
        try { statements.removeFts.run(previous.id); statements.remove.run(path); statements.links.run(path); bump(); changed(path, previous); db.exec('COMMIT'); }
        catch (inner) { db.exec('ROLLBACK'); throw inner; }
      }
      if (['ENOENT','ENOTDIR'].includes(error.code)) statements.clearProblem.run(path);
      else statements.problem.run(path, String(error.message).slice(0,400));
      if (['ENOENT','ENOTDIR'].includes(error.code)) return null;
      throw error;
    }
  })();
  inflight.set(path, task);
  try { return await task; } finally { if (inflight.get(path) === task) inflight.delete(path); }
}
async function* walk(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!allowedSegment(entry.name) || entry.isSymbolicLink()) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* walk(join(directory,entry.name),path);
    else if (entry.isFile() && path.endsWith('.md')) yield path;
  }
}
function beginReconcile(force = false) {
  if (scan) return scan;
  coverage = 'indexing'; stats.reconciliations++;
  scan = (async () => {
    const seen = new Set(), initial = db.prepare('SELECT path FROM notes').all(); let n = 0, interrupted = false;
    try {
      for await (const path of walk(workerData.vault)) {
        seen.add(path);
        try { await updatePath(path,force); } catch { /* per-file problem is visible in status */ }
        if (++n % 24 === 0) await yieldTurn();
      }
    } catch (error) { interrupted = true; statements.problem.run('<inventory>',String(error.message)); }
    if (!interrupted) {
      statements.clearProblem.run('<inventory>');
      for (const { path } of initial) if (!seen.has(path)) {
        try { await updatePath(path,true); } catch { /* excluded or unreadable: already invalidated */ }
      }
      lastReconciledAt = new Date().toISOString();
    }
    coverage = interrupted ? 'partial' : 'ready';signalUiChange();
  })().finally(() => { scan = null; });
  return scan;
}
async function flushDirty(limit = 32) {
  // Debounced batches are coalesced by path. Requests yield between notes.
  const paths = [...dirty].slice(0,limit);
  for (let i = 0; i < paths.length; i++) {
    dirty.delete(paths[i]);
    try { await updatePath(paths[i]); } catch { /* surfaced by status */ }
    if (i % 16 === 15) await yieldTurn();
  }
  if (dirty.size) schedule();
  if (fullScanRequested && !scan) { fullScanRequested = false; void beginReconcile(); }
}
function schedule() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; void flushDirty(); },150);
  timer.unref();
}
let watcher;
try {
  watcher = watch(workerData.vault, { recursive: true, persistent: false }, (_event,name) => {
    const path = name?.toString().replaceAll('\\','/');
    if (path?.endsWith('.md')) {
      try { validateNote(path); dirty.add(path); } catch { return; }
    } else if (!path || path.split('/').every(allowedSegment)) fullScanRequested = true;
    schedule();
  });
  watcher.on('error', error => { watching = false; statements.problem.run('<watcher>', String(error.message)); });
  watching = true;
} catch (error) { statements.problem.run('<watcher>',String(error.message)); }
const reconcileTimer = setInterval(() => { if (!scan) void beginReconcile(); }, workerData.reconcileMs || 120000);
reconcileTimer.unref();
function status() {
  revision = Number(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value);
  return { revision, coverage, noteCount: Number(statements.count.get().count), lastReconciledAt, watching,
    pendingChanges: dirty.size, jobs: Number(db.prepare('SELECT count(*) count FROM jobs').get().count),
    problems: db.prepare('SELECT * FROM problems ORDER BY path LIMIT 20').all(), stats: { ...stats } };
}
function pending(project, limit = 20, kind = null) {
  return db.prepare("SELECT * FROM jobs WHERE (scope='shared' OR scope=?) AND (? IS NULL OR kind=?) ORDER BY updated DESC LIMIT ?").all(project || '',kind,kind,limit);
}
async function read(path, project, options = {}) {
  if (!canRead(validateNote(path),project)) throw new Error('Note is outside shared/current-project scope');
  const row = await updatePath(path);
  if (!row) return { path, missing: true };
  const part = snippet(row.body,options);
  const reviewAt = row.body.split('\n').findIndex(line => /^## Human review\s*$/i.test(line));
  const humanReview = reviewAt >= 0 ? snippet(row.body,{ startLine:reviewAt+1,maxChars:options.reviewMaxChars || 1600 }) : null;
  return { path, hash: row.hash, ...part, humanReview,
    pending: db.prepare('SELECT kind,revision FROM jobs WHERE path=?').all(path) };
}
async function search(args) {
  stats.searches++;
  if (coverage === 'uninitialized') void beginReconcile();
  await flushDirty();
  const expression = queryExpression(args.query);
  const limit = Math.max(1,Math.min(12,Math.floor(args.limit || 5)));
  const wiki = args.wikiOnly ? "AND n.kind='wiki'" : '';
  // Keep selective FTS matches as the outer loop; a scope-first join probes FTS once per note.
  const rows = db.prepare(`SELECT n.path,n.title,n.hash,n.kind,n.body,bm25(search,6.0,1.0) rank
    FROM search CROSS JOIN notes n ON n.id=search.rowid
    WHERE search MATCH ? AND (n.scope='shared' OR n.scope=?) ${wiki}
    ORDER BY rank,n.path LIMIT ?`).all(expression,args.project || '',limit*2);
  const hits = []; let staleCandidates = 0;
  for (const item of rows) {
    if (hits.length >= limit) break;
    let current;
    try { current = await updatePath(item.path); } catch { continue; }
    if (!current || current.hash !== item.hash) { staleCandidates++; continue; } // never emit stale cached snippets
    const lower = current.body.normalize('NFKC').toLowerCase();
    const needle = String(args.query).normalize('NFKC').toLowerCase();
    let at = lower.indexOf(needle);
    if (at < 0) at = tokens(args.query).map(t=>lower.indexOf(t)).find(i=>i>=0) ?? 0;
    const startLine = Math.max(1,current.body.slice(0,at).split('\n').length-2);
    const part = snippet(current.body,{startLine,maxChars:1600});
    hits.push({ path:item.path,title:item.title,hash:current.hash,kind:item.kind,rank:item.rank,...part });
  }
  return { query:args.query,hits, ...status(), pendingMaintenance:pending(args.project,8),
    staleCandidates, complete: staleCandidates===0 && coverage==='ready' && dirty.size===0 && db.prepare('SELECT count(*) count FROM problems').get().count===0,
    warning: coverage==='ready' ? null : 'Index is still being reconciled; zero hits are not proof of absence.' };
}
async function dispatch(op,args) {
  if (op==='status') return status();
  if (op==='read') return read(args.path,args.project,args);
  if (op==='search') return search(args);
  if (op==='warm') { void beginReconcile(); return status(); }
  if (op==='reconcile') { await beginReconcile(!!args.force); await flushDirty(); return status(); }
  if (op==='changed') {
    for (const path of args.paths.slice(0,100)) { await updatePath(path); dirty.delete(path); }
    return status();
  }
  if (op==='enqueueNavigation') {
    const project = args.project;
    if (project && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project)) throw new Error('Invalid project scope');
    if(project)job('navigation',`Projects/${project}/Index.md`,project);
    job('navigation','Library/Index.md','shared');return status();
  }
  if (op==='uiJobs') {
    const offset=Math.max(0,Math.min(100000,Math.floor(args.offset||0))), limit=Math.max(1,Math.min(50,Math.floor(args.limit||20)));
    const scope=args.project||'';
    const where="(scope='shared' OR scope=?)";
    const total=Number(db.prepare(`SELECT count(*) n FROM jobs WHERE ${where}`).get(scope).n);
    const items=db.prepare(`SELECT * FROM jobs WHERE ${where} ORDER BY updated DESC,key LIMIT ? OFFSET ?`).all(scope,limit,offset);
    return {items,total,offset,nextOffset:offset+items.length<total?offset+items.length:null};
  }
  if (op==='jobs') return { ...status(),items:pending(args.project,100,args.kind || null) };
  if (op==='completeJob') {
    db.prepare('DELETE FROM jobs WHERE key=? AND revision=?').run(args.key,args.revision); return status();
  }
  if (op==='navigation') {
    const scope = args.project || 'shared';
    const filter = args.targetPath === 'Wiki/Index.md' ? "AND kind='wiki' AND path LIKE 'Wiki/%'"
      : args.targetPath === 'Library/Index.md' ? "AND path LIKE 'Library/%'" : "AND kind!='navigation'";
    return db.prepare(`SELECT path,title,kind FROM notes WHERE scope=? ${filter} ORDER BY path LIMIT 61`).all(scope);
  }
  throw new Error('Unknown knowledge operation');
}
parentPort.on('message', async ({id,op,args={}}) => {
  try { const result = await dispatch(op,args); parentPort.postMessage({id,result}); }
  catch (error) { parentPort.postMessage({id,error:String(error.message)}); }
});
parentPort.postMessage({ready:true});
