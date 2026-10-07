// Cowork Local Viewer — loader.js
// authors: 7hud41
// license: MIT
//
// Loads LOCAL Cowork sessions (the local-agent-mode-sessions folder of the Claude desktop app) dropped
// on the page, converts them to the event format used by the archive engine, and reuses the same
// preview/export engine. Also reopens archives (ZIP or unzipped folder) exported by this page or by the
// browser extension. Read-only: nothing is written to disk, nothing leaves the browser.
//
// window.VIEWER_MODE: 'local' (sessions + projects + index + archives) or 'archive' (archives only).

window.ARCHIVE_HOST = true; // tells archive.js not to run the extension bootstrap
const MODE = window.VIEWER_MODE || 'local';
const ARCHIVE_ONLY = MODE === 'archive';
const LOCAL = { sessions: [], current: null, spaces: [], remote: [], spacesSource: null };
const $L = id => document.getElementById(id);

// ---------- display time zone ----------
// Stored timestamps (audit.jsonl, local_….json) are UTC instants: the original time zone is NOT recorded.
// The display time zone is therefore chosen per session (default: America/Toronto) and remembered in the browser.
const TZ_DEFAULT = 'America/Toronto';
const TZ_CHOICES = [['America/Toronto', 'Toronto / Montréal (Eastern)'], ['Europe/Paris', 'Paris'], ['UTC', 'UTC (raw)'], ['America/Vancouver', 'Vancouver'], ['Europe/London', 'London'], ['Europe/Lisbon', 'Lisbon'], ['Asia/Tokyo', 'Tokyo']];
function tzGet(id, hint) { try { return localStorage.getItem('cowork-tz:' + id) || hint || localStorage.getItem('cowork-tz:default') || TZ_DEFAULT; } catch (_) { return hint || TZ_DEFAULT; } }
function tzSet(id, tz) { try { localStorage.setItem('cowork-tz:' + id, tz); } catch (_) {} }
function tzApply(tz) { window.DISPLAY_TZ = tz; const sel = $L('tzSelect'); if (sel && sel.value !== tz) sel.value = tz; }
function withTz(tz, fn) { const prev = window.DISPLAY_TZ; window.DISPLAY_TZ = tz; try { return fn(); } finally { window.DISPLAY_TZ = prev; } }
window.DISPLAY_TZ = (() => { try { return localStorage.getItem('cowork-tz:default') || TZ_DEFAULT; } catch (_) { return TZ_DEFAULT; } })();

// ---------- projects (Spaces) ----------
// spaces.json: { spaces: [ { id, name, folders: [ { path } ], createdAt, updatedAt } ] }
// remote-sessions-spaces.json: { entries: [ { sessionId: "session_…", folders: [ "/path" ] } ] }  (cloud sessions)
function normPath(p) { return String(p || '').replace(/\/+$/, '').toLowerCase(); }
function ingestSpaces(files) {
  let n = 0;
  for (const f of files) {
    const base = f.path.split('/').pop();
    if (base === 'spaces.json') { f._spaces = true; n++; }
    else if (/^remote-sessions?-spaces\.json$/.test(base)) { f._remote = true; n++; }
  }
  return n;
}
async function loadSpaces(files) {
  for (const f of files) {
    if (f._spaces) { try {
      const j = JSON.parse(await f.file.text());
      const arr = Array.isArray(j) ? j : (j.spaces || []);
      LOCAL.spaces = arr.map(sp => ({ id: sp.id, name: sp.name || sp.id, folders: (sp.folders || []).map(x => typeof x === 'string' ? x : (x && x.path) || '').filter(Boolean), createdAt: sp.createdAt, updatedAt: sp.updatedAt }));
      LOCAL.spacesSource = f.path;
      log(t('spaces.json read: {n} known project(s) ({list}).', { n: LOCAL.spaces.length, list: LOCAL.spaces.slice(0, 6).map(s => s.name).join(', ') + (LOCAL.spaces.length > 6 ? ', …' : '') }), 'ok');
    } catch (e) { log(t('spaces.json unreadable: {msg}', { msg: e.message }), 'err'); } }
    if (f._remote) { try {
      const j = JSON.parse(await f.file.text());
      LOCAL.remote = (j.entries || []).map(e => ({ sessionId: e.sessionId, folders: (e.folders || []).map(x => typeof x === 'string' ? x : (x && x.path) || '') }));
      log(t('remote-sessions-spaces.json read: {n} cloud session(s) linked to a folder.', { n: LOCAL.remote.length }), 'ok');
    } catch (e) { log(t('remote-sessions-spaces.json unreadable: {msg}', { msg: e.message }), 'err'); } }
  }
}
function spaceByFolder(path) { const p = normPath(path); if (!p) return null; return LOCAL.spaces.find(sp => sp.folders.some(fp => normPath(fp) === p)) || LOCAL.spaces.find(sp => sp.folders.some(fp => p.startsWith(normPath(fp) + '/'))) || null; }
function spaceById(id) { return id ? LOCAL.spaces.find(sp => sp.id === id) || null : null; }
// Folders declared in local_<uuid>.json (userSelectedFolders, folders, …) — several shapes tolerated
function metaFolders(meta) {
  if (!meta) return [];
  const out = [];
  for (const k of ['userSelectedFolders', 'selectedFolders', 'folders', 'workingDirectories', 'cwd', 'folder']) {
    const v = meta[k]; if (!v) continue;
    for (const x of (Array.isArray(v) ? v : [v])) { const p = typeof x === 'string' ? x : (x && (x.path || x.uri || x.folder)); if (p) out.push(String(p).replace(/^file:\/\//, '')); }
  }
  return out;
}
function metaSpaceId(meta) { if (!meta) return null; for (const k of ['spaceId', 'space_id', 'space', 'projectId', 'project_id']) { const v = meta[k]; if (typeof v === 'string') return v; if (v && v.id) return v.id; } return null; }
// Fallback: look for project folder paths in the head of the audit log (Read/Write/Bash tool calls cite the project folder)
async function sniffProject(s) {
  if (!s.audit || !LOCAL.spaces.length) return null;
  let head = ''; try { head = (await s.audit.slice(0, 3 * 1024 * 1024).text()).toLowerCase(); } catch (_) { return null; }
  let best = null, bestN = 0;
  for (const sp of LOCAL.spaces) for (const fp of sp.folders) {
    const needle = normPath(fp) + '/'; if (needle.length < 4) continue;
    let n = 0, i = -1; while ((i = head.indexOf(needle, i + 1)) !== -1 && n < 50) n++;
    // also the form mounted inside the local VM: $HOME/mnt/<folder name>/
    const mnt = '/mnt/' + fp.split('/').filter(Boolean).pop().toLowerCase() + '/';
    i = -1; while ((i = head.indexOf(mnt, i + 1)) !== -1 && n < 50) n++;
    if (n > bestN) { bestN = n; best = sp; }
  }
  return best ? { name: best.name, id: best.id, how: 'inferred', hits: bestN } : null;
}
async function resolveProject(s) {
  const meta = s.meta || null;
  const sid = metaSpaceId(meta); const byId = spaceById(sid);
  if (byId) return { name: byId.name, id: byId.id, how: 'meta' };
  const folders = metaFolders(meta);
  for (const p of folders) { const sp = spaceByFolder(p); if (sp) return { name: sp.name, id: sp.id, how: 'meta', folder: p }; }
  if (folders.length) return { name: folders[0].split('/').filter(Boolean).pop() || folders[0], id: null, how: 'folder', folder: folders[0] };
  if (sid) return { name: sid, id: sid, how: 'unknown-id' };
  return await sniffProject(s);
}
function projectLabel(s) { const p = s.project; if (!p) return ''; return p.name + (p.how === 'inferred' ? ' ' + t('(inferred)') : p.how === 'folder' ? ' ' + t('(folder)') : ''); }

// Always-visible status line (independent of reading mode)
function status(msg, cls, append) { const el = $L('dropStatus'); if (!el) return; el.textContent = append && el.textContent ? el.textContent + '\n' + msg : msg; el.className = 'dstatus ' + (cls || ''); el.hidden = false; }
window.addEventListener('error', e => status(t('Error: {msg}', { msg: e.message || e.error }), 'err'));
window.addEventListener('unhandledrejection', e => status(t('Error: {msg}', { msg: (e.reason && e.reason.message) || e.reason }), 'err'));

// ---------- collecting dropped files ----------
function walkEntry(entry, prefix, out) {
  return new Promise(resolve => {
    if (entry.isFile) { entry.file(f => { out.push({ path: prefix + entry.name, file: f }); resolve(); }, () => resolve()); }
    else if (entry.isDirectory) {
      const rd = entry.createReader(); const all = [];
      const read = () => rd.readEntries(async ents => {
        if (!ents.length) { for (const c of all) await walkEntry(c, prefix + entry.name + '/', out); resolve(); }
        else { all.push(...ents); read(); }
      }, () => resolve());
      read();
    } else resolve();
  });
}

async function collectDrop(dataTransfer) {
  const out = [];
  const items = dataTransfer.items;
  const kinds = items ? [...items].map(it => it.kind + ':' + (it.type || '?')).join(', ') : t('(no items)');
  status(t('Drop received — {items} item(s) [{kinds}], {files} flat file(s). Reading…', { items: items ? items.length : 0, kinds, files: dataTransfer.files ? dataTransfer.files.length : 0 }));
  // Everything must be grabbed synchronously: the DataTransfer store is emptied as soon as the event handler yields.
  // 1) directory entries (Chrome/Safari)
  const entries = [];
  if (items && items.length) for (const it of items) { try { const en = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (en) entries.push(en); } catch (_) {} }
  // 2) plain file list, kept as a fallback (file:// pages, browsers without directory entries)
  const flat = dataTransfer.files ? [...dataTransfer.files] : [];
  for (const en of entries) await walkEntry(en, '', out);
  if (!out.length && flat.length) for (const f of flat) out.push({ path: f.webkitRelativePath || f.name, file: f });
  status(t('{n} file(s) read: {list}', { n: out.length, list: out.slice(0, 4).map(f => f.path).join(' · ') + (out.length > 4 ? ' · …' : '') }), '', true);
  return out;
}

function collectInput(fileList) {
  const out = []; for (const f of fileList) out.push({ path: f.webkitRelativePath || f.name, file: f }); return out;
}

// ---------- grouping into sessions ----------
function groupSessions(files) {
  const byDir = new Map();
  for (const f of files) {
    const m = f.path.match(/^(.*?)(local_[A-Za-z0-9-]+)\/(.*)$/);
    if (m) {
      const key = m[1] + m[2];
      if (!byDir.has(key)) byDir.set(key, { key, id: m[2].replace(/^local_/, ''), dir: m[1] + m[2] + '/', audit: null, uploads: [], outputs: [], others: [], meta: null });
      const s = byDir.get(key); const rest = m[3];
      if (rest === 'audit.jsonl') s.audit = f.file;
      else if (rest.startsWith('uploads/')) s.uploads.push({ name: rest.slice(8), file: f.file });
      else if (rest.startsWith('outputs/')) s.outputs.push({ name: rest.slice(8), file: f.file });
      else s.others.push({ name: rest, file: f.file });
    }
  }
  // metadata: local_<id>.json next to the folder
  for (const f of files) {
    const m = f.path.match(/^(.*?)(local_[A-Za-z0-9-]+)\.json$/);
    if (m) { const key = m[1] + m[2]; if (!byDir.has(key)) byDir.set(key, { key, id: m[2].replace(/^local_/, ''), dir: m[1] + m[2] + '/', audit: null, uploads: [], outputs: [], others: [], meta: null }); byDir.get(key).metaFile = f.file; }
  }
  // an audit.jsonl dropped on its own (without its local_… parent folder)
  for (const f of files) if (/(^|\/)audit\.jsonl$/.test(f.path) && ![...byDir.values()].some(s => s.audit === f.file)) {
    byDir.set(f.path, { key: f.path, id: f.path.replace(/\/?audit\.jsonl$/, '') || 'session', dir: '', audit: f.file, uploads: [], outputs: [], others: [], meta: null });
  }
  // sessions known only by their local_….json are kept too (index: title, dates, project — conversation not dropped)
  return [...byDir.values()].filter(s => s.audit || s.metaFile);
}

// Merge with the sessions already listed (spaces.json, .json files and folders can be dropped in any order)
function mergeSessions(existing, incoming) {
  const byId = new Map(existing.map(s => [s.id, s]));
  for (const n of incoming) {
    const o = byId.get(n.id);
    if (!o) { byId.set(n.id, n); continue; }
    if (n.audit) { o.audit = n.audit; o.uploads = n.uploads; o.outputs = n.outputs; o.others = n.others; o.dir = n.dir || o.dir; }
    if (n.metaFile) { o.metaFile = n.metaFile; o.meta = null; }
    if (n.archive) { o.archive = n.archive; o.manifest = n.manifest; o.local = n.local; o.events = null; o.tzHint = n.tzHint; }
    o.project = null; // recomputed
  }
  return [...byId.values()];
}

// ---------- reopening an already exported ARCHIVE (ZIP from this page or from the extension, or its unzipped folder) ----------
// An archive = events.json (+ manifest.json, session.json, images/, uploads/, outputs/, audit.jsonl…). It is reopened as is.
function zipReader(z, label) {
  const names = Object.keys(z.files).filter(n => !z.files[n].dir);
  // tolerate a root folder inside the zip (e.g. "cowork-…/events.json")
  const root = (names.find(n => /(^|\/)events\.json$/.test(n)) || '').replace(/events\.json$/, '');
  return { label, names: names.filter(n => n.startsWith(root)).map(n => n.slice(root.length)), text: n => z.file(root + n).async('string'), bytes: n => z.file(root + n).async('arraybuffer'), has: n => !!z.file(root + n) };
}
function dirReader(files, dir, label) {
  const inDir = files.filter(f => f.path.startsWith(dir));
  const find = n => inDir.find(f => f.path === dir + n);
  return { label, names: inDir.map(f => f.path.slice(dir.length)), text: n => find(n).file.text(), bytes: n => find(n).file.arrayBuffer(), has: n => !!find(n) };
}
async function archiveSession(reader) {
  let manifest = null, meta = null, local = null;
  if (reader.has('manifest.json')) { try { manifest = JSON.parse(await reader.text('manifest.json')); } catch (_) {} }
  if (reader.has('session.json')) { try { meta = JSON.parse(await reader.text('session.json')); } catch (_) {} }
  if (reader.has('session-local.json')) { try { local = JSON.parse(await reader.text('session-local.json')); } catch (_) {} }
  const id = (manifest && manifest.session_id) || (local && local.id) || reader.label.replace(/^.*\//, '').replace(/\.zip$/i, '');
  const s = { key: 'archive:' + id, id, dir: '', audit: null, uploads: [], outputs: [], others: [], meta, archive: reader, manifest, local, events: null,
    tzHint: (local && local.tz) || (manifest && manifest.display_timezone) || null };
  if (local && local.project) s.project = { ...local.project, how: local.project.how || 'archive' };
  return s;
}
async function detectArchives(files) {
  const out = [];
  for (const f of files) if (/\.zip$/i.test(f.path)) {
    try { const z = await JSZip.loadAsync(await f.file.arrayBuffer()); if (!Object.keys(z.files).some(n => /(^|\/)events\.json$/.test(n))) continue; out.push(await archiveSession(zipReader(z, f.path))); }
    catch (err) { log(t('ZIP {name} unreadable: {msg}', { name: f.path, msg: err.message }), 'warn'); }
  }
  for (const f of files) { const m = f.path.match(/^(.*\/)?events\.json$/); if (m) { try { out.push(await archiveSession(dirReader(files, m[1] || '', f.path))); } catch (err) { log(t('Archive {name} unreadable: {msg}', { name: f.path, msg: err.message }), 'warn'); } } }
  return out;
}
async function archiveEvents(s) {
  if (s.events) return s.events;
  const ev = JSON.parse(await s.archive.text('events.json'));
  const events = Array.isArray(ev) ? ev : (ev.data || ev.events || []);
  events.sort((a, b) => (Number(a.sequence_num) || 0) - (Number(b.sequence_num) || 0));
  s.events = events; return events;
}
function firstUserLine(text) {
  const clean = cleanUserText(text || '').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 70) + (clean.length > 70 ? '…' : '') : null;
}
function guessTitleFromEvents(events) {
  for (const e of events) {
    const p = e.payload || {}; if (e.event_type !== 'user' || p.parent_tool_use_id) continue;
    const c = p.message && p.message.content; const tx = typeof c === 'string' ? c : (Array.isArray(c) ? (c.find(b => b && b.type === 'text') || {}).text : '');
    if (tx && compactionSummary(p)) continue;
    const g = firstUserLine(tx); if (g) return g;
  }
  return null;
}

// ---------- audit.jsonl -> engine events ----------
function normTs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  if (/^\d+$/.test(String(v))) { const n = Number(v); return new Date(n < 1e12 ? n * 1000 : n).toISOString(); }
  const d = new Date(v); return isNaN(d) ? null : d.toISOString();
}

function mimeOf(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', svg: 'image/svg+xml', bmp: 'image/bmp', pdf: 'application/pdf', md: 'text/markdown', txt: 'text/plain', json: 'application/json', csv: 'text/csv' }[ext] || 'application/octet-stream';
}

function fileToB64(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(file); });
}

async function adaptSession(s) {
  const text = s.auditText || (s.auditText = await s.audit.text());
  const lines = text.split('\n');
  const uploadsByName = new Map(s.uploads.map(u => [u.name.split('/').pop(), u]));
  const events = [];
  let seq = 0, lastTs = null;
  for (const line of lines) {
    const tl = line.trim(); if (!tl.startsWith('{')) continue;
    let entry; try { entry = JSON.parse(tl); } catch (_) { continue; }
    seq++;
    const ts = normTs(entry._audit_timestamp ?? entry.timestamp ?? entry.created_at ?? entry.time) || lastTs || new Date(0).toISOString();
    lastTs = ts;
    const type = entry.type || entry.event_type || 'unknown';
    const payload = entry;
    // images / attachments: when the message references uploaded files, fetch them from uploads/
    if (type === 'user' && payload.message) {
      const c = payload.message.content;
      const txt = typeof c === 'string' ? c : (Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => b.text || '').join('\n') : '');
      const names = [...txt.matchAll(/<file_path>([^<]+)<\/file_path>/g)].map(m => m[1].split('/').pop());
      const hasInlineImage = Array.isArray(c) && c.some(b => b && b.type === 'image');
      if (names.length && !payload.file_attachments) {
        payload.file_attachments = names.map(n => ({ file_name: n, file_uuid: null, is_image: /^image\//.test(mimeOf(n)) }));
      }
      if (!hasInlineImage && names.length) {
        const blocks = Array.isArray(c) ? c.slice() : [{ type: 'text', text: c || '' }];
        for (const n of names) {
          const u = uploadsByName.get(n);
          if (u && /^image\//.test(mimeOf(n)) && u.file.size < 25 * 1024 * 1024) {
            try { blocks.unshift({ type: 'image', source: { type: 'base64', media_type: mimeOf(n), data: await fileToB64(u.file) } }); } catch (_) {}
          }
        }
        payload.message = { ...payload.message, content: blocks };
      }
    }
    events.push({ event_id: entry.uuid || entry.event_id || `l${seq}`, event_type: type, sequence_num: String(seq), created_at: ts, source: (type === 'user' && !entry.parent_tool_use_id && !(Array.isArray(entry.message && entry.message.content) && entry.message.content.some(b => b && b.type === 'tool_result'))) ? 'client' : 'worker', payload });
  }
  let meta = s.meta || null;
  if (!meta && s.metaFile) { try { meta = JSON.parse(await s.metaFile.text()); } catch (_) {} }
  return { events, meta };
}

// ---------- UI ----------
function human(n) { for (const u of ['B', 'KB', 'MB', 'GB']) { if (n < 1024) return n.toFixed(0) + ' ' + t(u); n /= 1024; } return n.toFixed(0) + ' ' + t('TB'); }

// Fallback title: beginning of the first user message (when local_<uuid>.json is missing)
async function guessTitle(s) {
  try {
    const head = await s.audit.slice(0, 400000).text();
    for (const line of head.split('\n')) {
      if (!line.startsWith('{')) continue;
      let e; try { e = JSON.parse(line); } catch (_) { continue; }
      if (e.type !== 'user' || e.parent_tool_use_id) continue;
      const c = e.message && e.message.content;
      const tx = typeof c === 'string' ? c : (Array.isArray(c) ? (c.find(b => b && b.type === 'text') || {}).text : '');
      const g = firstUserLine(tx); if (g) return g;
    }
  } catch (_) {}
  return null;
}

function sessionTitle(s) {
  return (s.meta && (s.meta.title || s.meta.name)) || (s.guess ? s.guess + '  ' + t('(title inferred from the first message)') : s.id);
}

function dl(name, content, type) {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function isoOr(v) { const tv = normTs(v); return tv || ''; }
function sortedByProject(sessions) {
  return sessions.slice().sort((a, b) => (a.project ? a.project.name : '~').localeCompare(b.project ? b.project.name : '~') || (Number(b.meta && (b.meta.lastActivityAt || b.meta.createdAt)) || 0) - (Number(a.meta && (a.meta.lastActivityAt || a.meta.createdAt)) || 0));
}
const yn = v => v ? t('yes') : t('no');
// Index of every listed session: CSV (Numbers/Excel) + Markdown (readable, grouped by project)
function exportIndex() {
  const S = LOCAL.sessions; if (!S.length) { log(t('No session listed: drop local_….json files first (and spaces.json for projects).'), 'warn'); return; }
  const stamp = new Date().toISOString().slice(0, 10);
  const rows = [['project', 'project_source', 'title', 'id', 'created_utc', 'last_activity_utc', 'time_zone', 'created_local', 'last_activity_local', 'conversation_dropped', 'audit_kb', 'uploads', 'outputs', 'archived', 'project_folder', 'model'].map(k => t(k))];
  for (const s of sortedByProject(S)) {
    const m = s.meta || {}; const p = s.project || {}; const tz = s.tz || tzGet(s.id, s.tzHint);
    const loc = v => v ? withTz(tz, () => fmtFull(normTs(v))) : '';
    rows.push([p.name || '', p.how || '', sessionTitle(s), s.id, isoOr(m.createdAt), isoOr(m.lastActivityAt), tz, loc(m.createdAt), loc(m.lastActivityAt), yn(s.audit || s.archive), s.audit ? Math.round(s.audit.size / 1024) : '', s.uploads.length, s.outputs.length, yn(m.isArchived), p.folder || (p.id ? (spaceById(p.id) || { folders: [] }).folders.join(' | ') : ''), m.model || '']);
  }
  const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\n');
  const csvName = `cowork-sessions-index-${stamp}.csv`, mdName = `cowork-sessions-index-${stamp}.md`;
  dl(csvName, '﻿' + csv, 'text/csv;charset=utf-8');

  const md = [t('# Index of local Cowork sessions — {date}', { date: stamp }), '', t('{n} session(s) listed · {projects} linked to a project · {convs} with their conversation dropped.', { n: S.length, projects: S.filter(s => s.project).length, convs: S.filter(s => s.audit || s.archive).length }), '',
    t('Columns: title · id (folder `local_<id>`) · created → last activity (in the time zone chosen for the session, default {tz}; the CSV also gives raw UTC) · audit size · Conv = conversation dropped in this page.', { tz: TZ_DEFAULT }), ''];
  const groups = new Map();
  for (const s of sortedByProject(S)) { const k = s.project ? s.project.name : t('(no project identified)'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
  for (const [name, list] of groups) {
    const sp = list[0].project && spaceById(list[0].project.id);
    md.push(t('## {name} — {n} session(s)', { name, n: list.length }), '');
    if (sp) md.push(t('Project folder(s): {folders}  ·  project id: `{id}`', { folders: sp.folders.map(f => '`' + f + '`').join(', '), id: sp.id }), '');
    md.push(t('| Title | Id | Created | Last activity | Time zone | Audit | Conv | Archived |'), '|---|---|---|---|---|---|---|---|');
    for (const s of list) {
      const m = s.meta || {}; const tz = s.tz || tzGet(s.id, s.tzHint);
      const src = s.project && s.project.how !== 'meta' ? ` _(${s.project.how})_` : '';
      md.push(`| ${sessionTitle(s).replace(/\|/g, '\\|')}${src} | \`${s.id}\` | ${m.createdAt ? withTz(tz, () => fmtFull(normTs(m.createdAt))) : ''} | ${m.lastActivityAt ? withTz(tz, () => fmtFull(normTs(m.lastActivityAt))) : ''} | ${tz} | ${s.audit ? human(s.audit.size) : '—'} | ${yn(s.audit || s.archive)} | ${m.isArchived ? t('yes') : ''} |`);
    }
    md.push('');
  }
  if (LOCAL.remote.length) {
    md.push(t('## Cloud sessions (remote-sessions-spaces.json)'), '', t('These sessions live on claude.ai (archive them with the browser extension); this file only gives their folder, not their title.'), '', t('| Cloud id | Project | Folder(s) |'), '|---|---|---|');
    for (const r of LOCAL.remote) { const sp = r.folders.map(spaceByFolder).find(Boolean); md.push(`| \`${r.sessionId}\` | ${sp ? sp.name : '?'} | ${r.folders.map(f => '`' + f + '`').join(', ')} |`); }
    md.push('');
  }
  if (LOCAL.spaces.length) {
    md.push(t('## Known projects (spaces.json)'), '', t('| Project | Sessions listed here | Folder(s) | Created |'), '|---|---|---|---|');
    for (const sp of LOCAL.spaces.slice().sort((a, b) => a.name.localeCompare(b.name))) md.push(`| ${sp.name} | ${S.filter(s => s.project && s.project.id === sp.id).length} | ${sp.folders.map(f => '`' + f + '`').join(', ')} | ${sp.createdAt ? fmtFull(normTs(sp.createdAt)) : ''} |`);
    md.push('');
  }
  dl(mdName, md.join('\n'), 'text/markdown');
  log(t('Index exported: {csv} (separator ; — Numbers/Excel) + {md} ({n} sessions, {groups} group(s)).', { csv: csvName, md: mdName, n: S.length, groups: groups.size }), 'ok');
}

async function onFiles(files) {
  try {
  if (!files || !files.length) { status(t('Nothing received by drag-and-drop. If you opened the page by double-clicking it (file:// address), start it with node server.js: Chrome does not read folders dropped on a file:// page.'), 'warn', true); return; }
  const nSpaces = ARCHIVE_ONLY ? 0 : ingestSpaces(files);
  if (nSpaces) await loadSpaces(files);
  const found = (ARCHIVE_ONLY ? [] : groupSessions(files)).concat(await detectArchives(files));
  if (!found.length) {
    if (nSpaces) {
      // spaces.json dropped alone: link the sessions already listed, otherwise wait
      if (LOCAL.sessions.length) { await renderSessionList(LOCAL.sessions); return; }
      status(t('{n} project(s) loaded from spaces.json{remote}. Now drop local_….json files (index) and/or local_… folders (conversations).', { n: LOCAL.spaces.length, remote: LOCAL.remote.length ? t(' + {n} cloud session(s)', { n: LOCAL.remote.length }) : '' }), 'ok');
      return;
    }
    if (!LOCAL.sessions.length) $L('sessions').innerHTML = '';
    const list = files.slice(0, 3).map(f => f.path).join(' · ');
    status(ARCHIVE_ONLY
      ? t('No archive found among {n} received file(s) ({list}). Drop an exported ZIP or its unzipped folder (the one containing events.json).', { n: files.length, list })
      : t('No session found among {n} received file(s) ({list}). Drop local_… folders (conversation), local_….json files (index), spaces.json (projects), an audit.jsonl, or an exported archive (ZIP).', { n: files.length, list }), 'warn');
    return;
  }
  await renderSessionList(mergeSessions(LOCAL.sessions, found));
  } catch (err) { console.error(err); status(t('Error: {msg}', { msg: err.message }), 'err'); }
}

function applySessionFilter() {
  const list = $L('sessions'); const search = $L('sessionSearch'); const psel = $L('projectSelect');
  const q = search ? search.value.trim().toLowerCase() : ''; const pj = psel ? psel.value : '';
  let shown = 0;
  for (const row of list.children) {
    const hit = (!q || row.textContent.toLowerCase().includes(q)) && (!pj || (pj === '__none__' ? !row.dataset.project : (row.dataset.project || '') === pj));
    row.hidden = !hit; if (hit) shown++;
  }
  const n = LOCAL.sessions.length;
  $L('sessionsCount').textContent = (q || pj) ? `${shown} / ${n}` : t('{n} session(s)', { n });
}

async function renderSessionList(sessions) {
  LOCAL.sessions = sessions;
  const list = $L('sessions'); list.innerHTML = '';
  // read metadata for title + date; otherwise title inferred from the first message; then project
  for (const s of sessions) {
    if (!s.meta && s.metaFile) { try { s.meta = JSON.parse(await s.metaFile.text()); } catch (_) {} }
    if (!(s.meta && (s.meta.title || s.meta.name)) && s.audit && !s.guess) s.guess = await guessTitle(s);
    if (!(s.meta && (s.meta.title || s.meta.name)) && s.archive && !s.guess) { try { s.guess = guessTitleFromEvents(await archiveEvents(s)); } catch (_) {} }
    if (s.archive && !s.meta) { // dates from the events
      try { const ev = await archiveEvents(s); if (ev.length) s.meta = { createdAt: normTs(ev[0].created_at), lastActivityAt: normTs(ev[ev.length - 1].created_at), _fromEvents: true }; } catch (_) {} }
    if (!s.project && !ARCHIVE_ONLY) s.project = await resolveProject(s);
  }
  sessions.sort((a, b) => ((b.meta && (b.meta.lastActivityAt || b.meta.createdAt)) || 0) - ((a.meta && (a.meta.lastActivityAt || a.meta.createdAt)) || 0));
  for (const s of sessions) {
    const row = document.createElement('div'); row.className = 'srow' + (s.audit || s.archive ? '' : ' noconv');
    row.dataset.project = s.project ? s.project.name : '';
    const title = sessionTitle(s);
    const when = s.meta && (s.meta.lastActivityAt || s.meta.createdAt) ? fmtFull(normTs(s.meta.lastActivityAt || s.meta.createdAt)) : '';
    const tt = document.createElement('div'); tt.className = 'stitle';
    if (s.project) { const chip = document.createElement('span'); chip.className = 'pchip' + (s.project.how === 'meta' ? '' : ' soft'); chip.textContent = projectLabel(s); tt.appendChild(chip); }
    tt.appendChild(document.createTextNode(title));
    const m = document.createElement('div'); m.className = 'smeta';
    const source = s.archive
      ? t('archive reopened ({name}{exported}{events})', { name: s.archive.label.split('/').pop(), exported: s.manifest && s.manifest.captured_at ? t(', exported on {when}', { when: fmtFull(s.manifest.captured_at) }) : '', events: s.manifest ? t(', {n} events', { n: s.manifest.event_count }) : '' })
      : s.audit ? t('audit {size}', { size: human(s.audit.size) }) : t('conversation not dropped (drop the local_{id}… folder to open it)', { id: s.id.slice(0, 8) });
    m.textContent = [when, source, s.uploads.length ? t('{n} upload(s)', { n: s.uploads.length }) : '', s.outputs.length ? t('{n} output(s)', { n: s.outputs.length }) : '', s.meta && s.meta.isArchived ? t('archived') : ''].filter(Boolean).join(' · ');
    row.appendChild(tt); row.appendChild(m);
    row.addEventListener('click', () => openSession(s, row));
    list.appendChild(row);
  }
  $L('sessionsCard').hidden = false;
  $L('sessionsCount').textContent = t('{n} session(s)', { n: sessions.length });
  const search = $L('sessionSearch');
  if (search) { search.hidden = sessions.length < 6; search.oninput = applySessionFilter; }
  // project filter
  const psel = $L('projectSelect');
  if (psel) {
    const names = [...new Set(sessions.map(s => s.project ? s.project.name : ''))].filter(Boolean).sort((a, b) => a.localeCompare(b));
    const prev = psel.value; psel.innerHTML = '';
    const all = document.createElement('option'); all.value = ''; all.textContent = t('All projects ({n})', { n: sessions.length }); psel.appendChild(all);
    for (const n of names) { const o = document.createElement('option'); o.value = n; o.textContent = `${n} (${sessions.filter(s => s.project && s.project.name === n).length})`; psel.appendChild(o); }
    if (sessions.some(s => !s.project)) { const o = document.createElement('option'); o.value = '__none__'; o.textContent = t('No project identified ({n})', { n: sessions.filter(s => !s.project).length }); psel.appendChild(o); }
    psel.hidden = names.length === 0; psel.value = [...psel.options].some(o => o.value === prev) ? prev : '';
    psel.onchange = applySessionFilter;
  }
  applySessionFilter();
  const withTitle = sessions.filter(s => s.meta && (s.meta.title || s.meta.name)).length;
  const withConv = sessions.filter(s => s.audit || s.archive).length;
  const withProj = sessions.filter(s => s.project).length;
  if (ARCHIVE_ONLY) {
    log(t('{n} archive(s) listed. Click one to display it.', { n: sessions.length }), 'ok');
    status(t('{n} archive(s) listed. Click one to display it.', { n: sessions.length }), 'ok');
    return;
  }
  log(t('{n} session(s) listed: {titles} with their official title, {convs} with their conversation, {projects} linked to a project{hint}.', { n: sessions.length, titles: withTitle, convs: withConv, projects: withProj, hint: LOCAL.spaces.length ? '' : t(' (drop spaces.json for project names)') }), withTitle < sessions.length ? 'warn' : 'ok');
  if (withTitle < sessions.length) log(t('To get every title, also drop the local_….json files (next to the local_… folders).'), 'warn');
  status(t('{n} session(s) listed — only titles/dates/projects were read, no conversation is open. Click ONE session to display it, or “Build the index”.', { n: sessions.length }), 'ok');
}

function renderCurrent() {
  const s = LOCAL.current; if (!s || !state.events) return;
  const stats = renderPreview(state);
  Viewer.setMode($L('modeBtn').dataset.mode || 'hr');
  populateDaySelect(state.events);
  return stats;
}

function headerTitle(s, meta) {
  return ((meta && (meta.title || meta.name)) || s.id) + (s.project ? '   ·   ' + t('project: {name}', { name: projectLabel(s) }) : '');
}

async function openSession(s, row) {
  document.querySelectorAll('.srow.sel').forEach(e => e.classList.remove('sel'));
  if (row) row.classList.add('sel');
  if (!s.audit && !s.archive) { status(t('This session only has its title (local_….json). To read the conversation, drop the local_{id} FOLDER.', { id: s.id }), 'warn'); return; }
  ui.log.textContent = ''; setProgress(10);
  try {
    s.tz = s.tz || tzGet(s.id, s.tzHint); tzApply(s.tz);
    const { events, meta } = s.archive ? { events: await archiveEvents(s), meta: s.meta && !s.meta._fromEvents ? s.meta : null } : await adaptSession(s);
    LOCAL.current = s;
    state.sessionId = s.archive ? s.id : 'local_' + s.id;
    state.events = events; state.meta = meta; state.pages = s.archive ? ((s.manifest && s.manifest.pages) || [{ url: 'archive:' + s.archive.label, count: events.length }]) : [{ url: 'local:' + s.dir + 'audit.jsonl', count: events.length }]; state.cursorParam = s.archive ? 'archive' : 'local'; state.missing = (s.manifest && s.manifest.missing_sequences) || [];
    ui.sid.textContent = headerTitle(s, meta);
    setProgress(60);
    const stats = renderCurrent();
    $L('zipBtn').disabled = false; $L('tzWrap').hidden = false;
    setProgress(100);
    log(t('Preview ready: {user} messages from you, {claude} from Claude, {tools} tool calls, {images} images.', { user: stats.userCount, claude: stats.claudeCount, tools: stats.toolCount, images: stats.imgCount }) + ' ' + t('Times shown in {tz}.', { tz: s.tz }), 'ok');
    // pre-read attachments (uploads/outputs) while the file references are fresh
    if (!s.archive) prefetchAttachments(s);
  } catch (err) { console.error(err); log(t('Failed: {msg}', { msg: err.message }), 'err'); setProgress(0); }
}

// Chrome invalidates a dropped file reference as soon as the file changes on disk (session still open in Cowork, cloud sync…):
// "The requested file could not be read…". Attachments are therefore read early and kept in memory (up to 60 MB per file).
const PREFETCH_MAX = 60 * 1024 * 1024;
async function readSafe(file, name) {
  try { return await file.arrayBuffer(); } catch (err) { return { error: err.message || String(err), name }; }
}
async function prefetchAttachments(s) {
  if (s._prefetched) return; s._prefetched = true;
  for (const list of [s.uploads, s.outputs]) for (const u of list) {
    if (u.bytes || u.error) continue;
    if (u.file.size > PREFETCH_MAX) continue; // read on demand
    const r = await readSafe(u.file, u.name);
    if (r instanceof ArrayBuffer) u.bytes = r; else u.error = r.error;
  }
  if (s.metaFile && !s.metaText) { try { s.metaText = await s.metaFile.text(); } catch (_) {} }
}

// Local files added to the ZIP (uploads/ and outputs/ of the session, raw audit log, local metadata)
window.ARCHIVE_EXTRA = async function (zip) {
  const s = LOCAL.current; if (!s) return;
  zip.file('session-local.json', JSON.stringify({ id: s.id, title: sessionTitle(s), project: s.project || null, tz: s.tz || null, source: s.archive ? 'archive:' + s.archive.label : 'local-agent-mode-sessions', exported_at: new Date().toISOString() }, null, 2));
  if (s.archive) { // re-export of an archive: the original items are copied as they are
    let n = 0;
    for (const name of s.archive.names) if (/^(audit\.jsonl|session-meta\.json|uploads\/|outputs\/|UNREADABLE-FILES\.txt)/.test(name)) { try { zip.file(name, await s.archive.bytes(name)); n++; } catch (_) {} }
    log(t('{n} item(s) copied from the original archive.', { n }), 'ok'); return;
  }
  const failed = [];
  for (const [list, dir] of [[s.uploads, 'uploads'], [s.outputs, 'outputs']]) for (const u of list) {
    let bytes = u.bytes;
    if (!bytes) { const r = await readSafe(u.file, u.name); if (r instanceof ArrayBuffer) bytes = r; else { failed.push(`${dir}/${u.name} (${r.error})`); continue; } }
    zip.file(`${dir}/${u.name}`, bytes);
  }
  if (s.metaFile) { const tx = s.metaText || await s.metaFile.text().catch(() => null); if (tx != null) zip.file('session-meta.json', tx); else failed.push('local_….json'); }
  if (s.auditText != null) zip.file('audit.jsonl', s.auditText);
  else { try { zip.file('audit.jsonl', await s.audit.text()); } catch (err) { failed.push(`audit.jsonl (${err.message})`); } }
  if (failed.length) {
    zip.file('UNREADABLE-FILES.txt', t('These files could not be re-read by the browser when the ZIP was built (reference invalidated: file modified since the drop, session still open in Cowork, cloud file not downloaded, or permissions).\nDrop the session again and retry to include them.\n\n') + failed.join('\n') + '\n');
    log(t('{n} file(s) not re-read — ZIP built without them (list in UNREADABLE-FILES.txt): {list}', { n: failed.length, list: failed.slice(0, 3).join(' · ') + (failed.length > 3 ? ' · …' : '') }), 'warn');
  } else log(t('{n} local item(s) (uploads/, outputs/) + audit.jsonl added to the ZIP.', { n: s.uploads.length + s.outputs.length }), 'ok');
};

document.addEventListener('DOMContentLoaded', async () => {
  initLang();
  Viewer.init('hr');
  const drop = $L('drop');
  // Drag-and-drop accepted on the WHOLE page (and never a navigation to the dropped file)
  ['dragenter', 'dragover'].forEach(ev => window.addEventListener(ev, e => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {} drop.classList.add('over'); }));
  window.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
  window.addEventListener('drop', async e => { e.preventDefault(); drop.classList.remove('over'); const files = await collectDrop(e.dataTransfer); await onFiles(files); });
  const csvBtn = $L('csvBtn'); if (csvBtn) csvBtn.addEventListener('click', exportIndex);
  const tzSel = $L('tzSelect');
  const fillTz = () => { const v = tzSel.value || window.DISPLAY_TZ; tzSel.innerHTML = ''; for (const [val, lab] of TZ_CHOICES) { const o = document.createElement('option'); o.value = val; o.textContent = t(lab); tzSel.appendChild(o); } tzSel.value = v; };
  fillTz();
  tzSel.addEventListener('change', () => {
    const tz = tzSel.value; const s = LOCAL.current;
    if (s) { s.tz = tz; tzSet(s.id, tz); tzApply(tz); renderCurrent(); log(t('Times now shown in {tz} for this session (remembered).', { tz }), 'ok'); }
    else { tzApply(tz); try { localStorage.setItem('cowork-tz:default', tz); } catch (_) {} log(t('Default time zone: {tz}.', { tz }), 'ok'); }
  });
  $L('tzDefaultBtn').addEventListener('click', () => { try { localStorage.setItem('cowork-tz:default', tzSel.value); } catch (_) {} log(t('{tz} is now the default time zone for sessions without a remembered choice.', { tz: tzSel.value }), 'ok'); });
  $L('dirInput').addEventListener('change', e => { status(t('{n} file(s) in the chosen folder. Reading…', { n: e.target.files.length })); onFiles(collectInput(e.target.files)); });

  $L('zipBtn').addEventListener('click', doZip);
  $L('zipDayBtn').addEventListener('click', doZipByDay);
  wireDayControls();

  // language switch: re-render everything that was built from strings
  window.onLangChange = async () => {
    fillTz();
    if (LOCAL.sessions.length) await renderSessionList(LOCAL.sessions);
    if (LOCAL.current) { ui.sid.textContent = headerTitle(LOCAL.current, state.meta); renderCurrent(); }
    else Viewer.setMode($L('modeBtn').dataset.mode || 'hr');
  };
});
