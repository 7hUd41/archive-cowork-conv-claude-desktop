// Cowork Local Viewer — loader.js
// Charge des sessions Cowork LOCALES (dossier local-agent-mode-sessions ou claude-code-sessions)
// déposées dans la page, les convertit au format d'événements de l'extension, et réutilise le même moteur d'aperçu/export.
// Lecture seule : rien n'est écrit sur le disque, rien ne quitte le navigateur.

const LOCAL = { sessions: [], current: null, spaces: [], remote: [], spacesSource: null };
const $L = id => document.getElementById(id);

// ---------- fuseau horaire d'affichage ----------
// Les horodatages stockés (audit.jsonl, local_….json) sont des instants UTC : le fuseau d'origine n'est PAS enregistré.
// On choisit donc le fuseau d'affichage par session (défaut : America/Toronto), mémorisé dans le navigateur.
const TZ_DEFAULT = 'America/Toronto';
const TZ_CHOICES = [['America/Toronto', 'Toronto / Montréal (heure de l\'Est)'], ['Europe/Paris', 'Paris'], ['UTC', 'UTC (brut)'], ['America/Vancouver', 'Vancouver'], ['Europe/London', 'Londres'], ['Europe/Lisbon', 'Lisbonne'], ['Asia/Tokyo', 'Tokyo']];
function tzGet(id, hint) { try { return localStorage.getItem('cowork-tz:' + id) || hint || localStorage.getItem('cowork-tz:default') || TZ_DEFAULT; } catch (_) { return hint || TZ_DEFAULT; } }
function tzSet(id, tz) { try { localStorage.setItem('cowork-tz:' + id, tz); } catch (_) {} }
function tzApply(tz) { window.DISPLAY_TZ = tz; const sel = $L('tzSelect'); if (sel && sel.value !== tz) sel.value = tz; }
function withTz(tz, fn) { const prev = window.DISPLAY_TZ; window.DISPLAY_TZ = tz; try { return fn(); } finally { window.DISPLAY_TZ = prev; } }
window.DISPLAY_TZ = (() => { try { return localStorage.getItem('cowork-tz:default') || TZ_DEFAULT; } catch (_) { return TZ_DEFAULT; } })();

// ---------- projets (Spaces) ----------
// spaces.json : { spaces: [ { id, name, folders: [ { path } ], createdAt, updatedAt } ] }
// remote-sessions-spaces.json : { entries: [ { sessionId: "session_…", folders: [ "/chemin" ] } ] }  (sessions cloud)
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
      log(`spaces.json lu : ${LOCAL.spaces.length} projet(s) connus (${LOCAL.spaces.slice(0, 6).map(s => s.name).join(', ')}${LOCAL.spaces.length > 6 ? ', …' : ''}).`, 'ok');
    } catch (e) { log('spaces.json illisible : ' + e.message, 'err'); } }
    if (f._remote) { try {
      const j = JSON.parse(await f.file.text());
      LOCAL.remote = (j.entries || []).map(e => ({ sessionId: e.sessionId, folders: (e.folders || []).map(x => typeof x === 'string' ? x : (x && x.path) || '') }));
      log(`remote-sessions-spaces.json lu : ${LOCAL.remote.length} session(s) cloud rattachée(s) à un dossier.`, 'ok');
    } catch (e) { log('remote-sessions-spaces.json illisible : ' + e.message, 'err'); } }
  }
}
function spaceByFolder(path) { const p = normPath(path); if (!p) return null; return LOCAL.spaces.find(sp => sp.folders.some(fp => normPath(fp) === p)) || LOCAL.spaces.find(sp => sp.folders.some(fp => p.startsWith(normPath(fp) + '/'))) || null; }
function spaceById(id) { return id ? LOCAL.spaces.find(sp => sp.id === id) || null : null; }
// Dossiers déclarés dans le local_<uuid>.json (userSelectedFolders, folders, …) — plusieurs formes tolérées
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
// Repli : chercher les chemins des projets dans le début de l'audit (outils Read/Write/Bash citent le dossier du projet)
async function sniffProject(s) {
  if (!s.audit || !LOCAL.spaces.length) return null;
  let head = ''; try { head = (await s.audit.slice(0, 3 * 1024 * 1024).text()).toLowerCase(); } catch (_) { return null; }
  let best = null, bestN = 0;
  for (const sp of LOCAL.spaces) for (const fp of sp.folders) {
    const needle = normPath(fp) + '/'; if (needle.length < 4) continue;
    let n = 0, i = -1; while ((i = head.indexOf(needle, i + 1)) !== -1 && n < 50) n++;
    // aussi la forme montée dans la VM locale : $HOME/mnt/<nom du dossier>/
    const mnt = '/mnt/' + fp.split('/').filter(Boolean).pop().toLowerCase() + '/';
    i = -1; while ((i = head.indexOf(mnt, i + 1)) !== -1 && n < 50) n++;
    if (n > bestN) { bestN = n; best = sp; }
  }
  return best ? { name: best.name, id: best.id, how: 'déduit', hits: bestN } : null;
}
async function resolveProject(s) {
  const meta = s.meta || null;
  const sid = metaSpaceId(meta); const byId = spaceById(sid);
  if (byId) return { name: byId.name, id: byId.id, how: 'meta' };
  const folders = metaFolders(meta);
  for (const p of folders) { const sp = spaceByFolder(p); if (sp) return { name: sp.name, id: sp.id, how: 'meta', folder: p }; }
  if (folders.length) return { name: folders[0].split('/').filter(Boolean).pop() || folders[0], id: null, how: 'dossier', folder: folders[0] };
  if (sid) return { name: sid, id: sid, how: 'id-inconnu' };
  return await sniffProject(s);
}
function projectLabel(s) { const p = s.project; if (!p) return ''; return p.name + (p.how === 'déduit' ? ' (déduit)' : p.how === 'dossier' ? ' (dossier)' : ''); }

// Ligne d'état toujours visible (indépendante du mode lecture)
function status(msg, cls, append) { const el = $L('dropStatus'); if (!el) return; el.textContent = append && el.textContent ? el.textContent + '\n' + msg : msg; el.className = 'dstatus ' + (cls || ''); el.hidden = false; }
window.addEventListener('error', e => status('Erreur : ' + (e.message || e.error), 'err'));
window.addEventListener('unhandledrejection', e => status('Erreur : ' + ((e.reason && e.reason.message) || e.reason), 'err'));

// ---------- collecte des fichiers déposés ----------
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
  const kinds = items ? [...items].map(it => it.kind + ':' + (it.type || '?')).join(', ') : '(pas d\'items)';
  status(`Dépôt reçu — ${items ? items.length : 0} élément(s) [${kinds}], ${dataTransfer.files ? dataTransfer.files.length : 0} fichier(s) plats. Lecture…`);
  // 1) entrées de dossier (Chrome/Safari) — à récupérer de façon synchrone pendant l'événement
  const entries = [];
  if (items && items.length) for (const it of items) { try { const en = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (en) entries.push(en); } catch (_) {} }
  for (const en of entries) await walkEntry(en, '', out);
  // 2) repli : liste de fichiers simple (si aucune entrée n'a été fournie)
  if (!out.length && dataTransfer.files && dataTransfer.files.length) for (const f of dataTransfer.files) out.push({ path: f.webkitRelativePath || f.name, file: f });
  status(`${out.length} fichier(s) lus : ${out.slice(0, 4).map(f => f.path).join(' · ')}${out.length > 4 ? ' · …' : ''}`, '', true);
  return out;
}

function collectInput(fileList) {
  const out = []; for (const f of fileList) out.push({ path: f.webkitRelativePath || f.name, file: f }); return out;
}

// ---------- regroupement en sessions ----------
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
  // métadonnées : local_<id>.json à côté du dossier
  for (const f of files) {
    const m = f.path.match(/^(.*?)(local_[A-Za-z0-9-]+)\.json$/);
    if (m) { const key = m[1] + m[2]; if (!byDir.has(key)) byDir.set(key, { key, id: m[2].replace(/^local_/, ''), dir: m[1] + m[2] + '/', audit: null, uploads: [], outputs: [], others: [], meta: null }); byDir.get(key).metaFile = f.file; }
  }
  // un audit.jsonl déposé seul (sans dossier parent local_…)
  for (const f of files) if (/(^|\/)audit\.jsonl$/.test(f.path) && ![...byDir.values()].some(s => s.audit === f.file)) {
    byDir.set(f.path, { key: f.path, id: f.path.replace(/\/?audit\.jsonl$/, '') || 'session', dir: '', audit: f.file, uploads: [], outputs: [], others: [], meta: null });
  }
  // on garde aussi les sessions dont on n'a QUE le local_….json (index : titre, dates, projet — conversation non déposée)
  return [...byDir.values()].filter(s => s.audit || s.metaFile);
}

// Fusion avec les sessions déjà listées (on peut déposer spaces.json, puis les .json, puis les dossiers, dans n'importe quel ordre)
function mergeSessions(existing, incoming) {
  const byId = new Map(existing.map(s => [s.id, s]));
  for (const n of incoming) {
    const o = byId.get(n.id);
    if (!o) { byId.set(n.id, n); continue; }
    if (n.audit) { o.audit = n.audit; o.uploads = n.uploads; o.outputs = n.outputs; o.others = n.others; o.dir = n.dir || o.dir; }
    if (n.metaFile) { o.metaFile = n.metaFile; o.meta = null; }
    o.project = null; // à recalculer
  }
  return [...byId.values()];
}

// ---------- relecture d'une ARCHIVE déjà exportée (ZIP de cette page ou de l'extension, ou son dossier décompressé) ----------
// Une archive = events.json (+ manifest.json, session.json, images/, uploads/, outputs/, audit.jsonl…). On la rouvre telle quelle.
function zipReader(z, label) {
  const names = Object.keys(z.files).filter(n => !z.files[n].dir);
  // tolère un dossier racine dans le zip (ex. "cowork-…/events.json")
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
    catch (err) { log(`ZIP ${f.path} illisible : ${err.message}`, 'warn'); }
  }
  for (const f of files) { const m = f.path.match(/^(.*\/)?events\.json$/); if (m) { try { out.push(await archiveSession(dirReader(files, m[1] || '', f.path))); } catch (err) { log(`Archive ${f.path} illisible : ${err.message}`, 'warn'); } } }
  return out;
}
async function archiveEvents(s) {
  if (s.events) return s.events;
  const ev = JSON.parse(await s.archive.text('events.json'));
  const events = Array.isArray(ev) ? ev : (ev.data || ev.events || []);
  events.sort((a, b) => (Number(a.sequence_num) || 0) - (Number(b.sequence_num) || 0));
  s.events = events; return events;
}
function guessTitleFromEvents(events) {
  for (const e of events) {
    const p = e.payload || {}; if (e.event_type !== 'user' || p.parent_tool_use_id) continue;
    const c = p.message && p.message.content; const t = typeof c === 'string' ? c : (Array.isArray(c) ? (c.find(b => b && b.type === 'text') || {}).text : '');
    if (t && compactionSummary(p)) continue;
    const clean = cleanUserText(t || '').replace(/\s+/g, ' ').trim();
    if (clean) return clean.slice(0, 70) + (clean.length > 70 ? '…' : '');
  }
  return null;
}

// ---------- adaptation audit.jsonl -> événements de l'extension ----------
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
  if (!(file instanceof Blob)) { // objet distant (mode serveur)
    return file.arrayBuffer().then(buf => { const u = new Uint8Array(buf); let bin = ''; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(bin); });
  }
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(file); });
}

async function adaptSession(s) {
  const text = s.auditText || (s.auditText = await s.audit.text());
  const lines = text.split('\n');
  const uploadsByName = new Map(s.uploads.map(u => [u.name.split('/').pop(), u]));
  const events = [];
  let seq = 0, lastTs = null;
  for (const line of lines) {
    const t = line.trim(); if (!t.startsWith('{')) continue;
    let entry; try { entry = JSON.parse(t); } catch (_) { continue; }
    seq++;
    const ts = normTs(entry._audit_timestamp ?? entry.timestamp ?? entry.created_at ?? entry.time) || lastTs || new Date(0).toISOString();
    lastTs = ts;
    const type = entry.type || entry.event_type || 'unknown';
    const payload = entry;
    // images / pièces jointes : si le message référence des fichiers envoyés, on va les chercher dans uploads/
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
function human(n) { for (const u of ['o', 'Ko', 'Mo', 'Go']) { if (n < 1024) return n.toFixed(0) + ' ' + u; n /= 1024; } return n.toFixed(0) + ' To'; }

// Titre de repli : début du premier message utilisateur (quand le local_<uuid>.json manque)
async function guessTitle(s) {
  try {
    const head = await s.audit.slice(0, 400000).text();
    for (const line of head.split('\n')) {
      if (!line.startsWith('{')) continue;
      let e; try { e = JSON.parse(line); } catch (_) { continue; }
      if (e.type !== 'user' || e.parent_tool_use_id) continue;
      const c = e.message && e.message.content;
      const t = typeof c === 'string' ? c : (Array.isArray(c) ? (c.find(b => b && b.type === 'text') || {}).text : '');
      const clean = cleanUserText(t || '').replace(/\s+/g, ' ').trim();
      if (clean) return clean.slice(0, 70) + (clean.length > 70 ? '…' : '');
    }
  } catch (_) {}
  return null;
}

function sessionTitle(s) {
  return (s.meta && (s.meta.title || s.meta.name)) || (s.guess ? s.guess + '  (titre déduit du 1er message)' : s.id);
}

function dl(name, content, type) {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function isoOr(v) { const t = normTs(v); return t || ''; }
function sortedByProject(sessions) {
  return sessions.slice().sort((a, b) => (a.project ? a.project.name : '~').localeCompare(b.project ? b.project.name : '~', 'fr') || (Number(b.meta && (b.meta.lastActivityAt || b.meta.createdAt)) || 0) - (Number(a.meta && (a.meta.lastActivityAt || a.meta.createdAt)) || 0));
}
// Index de toutes les sessions listées : CSV (Numbers/Excel) + Markdown (lisible, groupé par projet)
function exportIndex() {
  const S = LOCAL.sessions; if (!S.length) { log('Aucune session listée : dépose d\'abord des local_….json (et spaces.json pour les projets).', 'warn'); return; }
  const stamp = new Date().toISOString().slice(0, 10);
  const rows = [['projet', 'projet_source', 'titre', 'identifiant', 'creee_le_utc', 'derniere_activite_utc', 'fuseau', 'creee_le_locale', 'derniere_activite_locale', 'conversation_deposee', 'audit_ko', 'envois', 'produits', 'archivee', 'dossier_projet', 'modele']];
  for (const s of sortedByProject(S)) {
    const m = s.meta || {}; const p = s.project || {}; const tz = s.tz || tzGet(s.id);
    const loc = v => v ? withTz(tz, () => fmtFull(normTs(v))) : '';
    rows.push([p.name || '', p.how || '', sessionTitle(s), s.id, isoOr(m.createdAt), isoOr(m.lastActivityAt), tz, loc(m.createdAt), loc(m.lastActivityAt), s.audit ? 'oui' : 'non', s.audit ? Math.round(s.audit.size / 1024) : '', s.uploads.length, s.outputs.length, m.isArchived ? 'oui' : 'non', p.folder || (p.id ? (spaceById(p.id) || { folders: [] }).folders.join(' | ') : ''), m.model || '']);
  }
  const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\n');
  dl(`cowork-index-sessions-${stamp}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');

  const md = [`# Index des sessions Cowork locales — ${stamp}`, '', `${S.length} session(s) listée(s) · ${S.filter(s => s.project).length} rattachée(s) à un projet · ${S.filter(s => s.audit).length} avec leur conversation déposée.`, '',
    'Colonnes : titre · identifiant (dossier `local_<id>`) · créée → dernière activité (dans le fuseau choisi pour la session, défaut ' + TZ_DEFAULT + ' ; le CSV donne aussi l\'UTC brut) · taille de l\'audit · Conv = conversation déposée dans cette page.', ''];
  const groups = new Map();
  for (const s of sortedByProject(S)) { const k = s.project ? s.project.name : '(sans projet identifié)'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
  for (const [name, list] of groups) {
    const sp = list[0].project && spaceById(list[0].project.id);
    md.push(`## ${name} — ${list.length} session(s)`, '');
    if (sp) md.push(`Dossier(s) du projet : ${sp.folders.map(f => '`' + f + '`').join(', ')}  ·  identifiant du projet : \`${sp.id}\``, '');
    md.push('| Titre | Identifiant | Créée | Dernière activité | Fuseau | Audit | Conv | Archivée |', '|---|---|---|---|---|---|---|---|');
    for (const s of list) {
      const m = s.meta || {}; const tz = s.tz || tzGet(s.id);
      const src = s.project && s.project.how !== 'meta' ? ` _(${s.project.how})_` : '';
      md.push(`| ${sessionTitle(s).replace(/\|/g, '\\|')}${src} | \`${s.id}\` | ${m.createdAt ? withTz(tz, () => fmtFull(normTs(m.createdAt))) : ''} | ${m.lastActivityAt ? withTz(tz, () => fmtFull(normTs(m.lastActivityAt))) : ''} | ${tz} | ${s.audit ? human(s.audit.size) : '—'} | ${s.audit ? 'oui' : 'non'} | ${m.isArchived ? 'oui' : ''} |`);
    }
    md.push('');
  }
  if (LOCAL.remote.length) {
    md.push('## Sessions cloud (remote-sessions-spaces.json)', '', 'Ces sessions vivent sur claude.ai (à archiver avec l\'extension Cowork Session Archiver) ; ce fichier ne donne que leur dossier, pas leur titre.', '', '| Identifiant cloud | Projet | Dossier(s) |', '|---|---|---|');
    for (const r of LOCAL.remote) { const sp = r.folders.map(spaceByFolder).find(Boolean); md.push(`| \`${r.sessionId}\` | ${sp ? sp.name : '?'} | ${r.folders.map(f => '`' + f + '`').join(', ')} |`); }
    md.push('');
  }
  if (LOCAL.spaces.length) {
    md.push('## Projets connus (spaces.json)', '', '| Projet | Sessions listées ici | Dossier(s) | Créé |', '|---|---|---|---|');
    for (const sp of LOCAL.spaces.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'))) md.push(`| ${sp.name} | ${S.filter(s => s.project && s.project.id === sp.id).length} | ${sp.folders.map(f => '`' + f + '`').join(', ')} | ${sp.createdAt ? fmtFull(normTs(sp.createdAt)) : ''} |`);
    md.push('');
  }
  dl(`cowork-index-sessions-${stamp}.md`, md.join('\n'), 'text/markdown');
  log(`Index exporté : cowork-index-sessions-${stamp}.csv (séparateur ; — Numbers/Excel) + cowork-index-sessions-${stamp}.md (${S.length} sessions, ${groups.size} groupe(s)).`, 'ok');
}
const exportSessionList = exportIndex;

async function onFiles(files) {
  try {
  if (!files || !files.length) { status('Rien reçu par glisser-déposer. Si tu as ouvert la page en double-cliquant (adresse file://), lance-la avec node server.js : Chrome ne lit pas les dossiers déposés sur une page file://.', 'warn', true); return; }
  const nSpaces = ingestSpaces(files);
  if (nSpaces) await loadSpaces(files);
  const found = groupSessions(files).concat(await detectArchives(files));
  if (!found.length) {
    if (nSpaces) {
      // spaces.json déposé seul : on rattache les sessions déjà listées, sinon on attend
      if (LOCAL.sessions.length) { await renderSessionList(LOCAL.sessions); return; }
      status(`${LOCAL.spaces.length} projet(s) chargé(s) depuis spaces.json${LOCAL.remote.length ? ` + ${LOCAL.remote.length} session(s) cloud` : ''}. Dépose maintenant les local_….json (index) et/ou les dossiers local_… (conversations).`, 'ok');
      return;
    }
    if (!LOCAL.sessions.length) $L('sessions').innerHTML = '';
    status(`Aucune session trouvée parmi ${files.length} fichier(s) reçus (${files.slice(0, 3).map(f => f.path).join(' · ')}). Dépose des dossiers local_… (conversation), des local_….json (index), spaces.json (projets), ou un audit.jsonl.`, 'warn');
    return;
  }
  await renderSessionList(mergeSessions(LOCAL.sessions, found));
  } catch (err) { console.error(err); status('Erreur pendant la lecture : ' + err.message, 'err'); }
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
  $L('sessionsCount').textContent = (q || pj) ? `${shown} / ${n}` : `${n} session${n > 1 ? 's' : ''}`;
}

async function renderSessionList(sessions) {
  LOCAL.sessions = sessions;
  const list = $L('sessions'); list.innerHTML = '';
  // lire les métadonnées pour afficher titre + date ; sinon titre déduit du 1er message ; puis projet
  for (const s of sessions) {
    if (!s.meta && s.metaFile) { try { s.meta = JSON.parse(await s.metaFile.text()); } catch (_) {} }
    if (!(s.meta && (s.meta.title || s.meta.name)) && s.audit && !s.guess) s.guess = await guessTitle(s);
    if (!(s.meta && (s.meta.title || s.meta.name)) && s.archive && !s.guess) { try { s.guess = guessTitleFromEvents(await archiveEvents(s)); } catch (_) {} }
    if (s.archive && !s.meta) { // dates depuis les événements
      try { const ev = await archiveEvents(s); if (ev.length) s.meta = { createdAt: normTs(ev[0].created_at), lastActivityAt: normTs(ev[ev.length - 1].created_at), _fromEvents: true }; } catch (_) {} }
    if (!s.project) s.project = await resolveProject(s);
  }
  sessions.sort((a, b) => ((b.meta && (b.meta.lastActivityAt || b.meta.createdAt)) || 0) - ((a.meta && (a.meta.lastActivityAt || a.meta.createdAt)) || 0));
  for (const s of sessions) {
    const row = document.createElement('div'); row.className = 'srow' + (s.audit || s.archive ? '' : ' noconv');
    row.dataset.project = s.project ? s.project.name : '';
    const title = sessionTitle(s);
    const when = s.meta && (s.meta.lastActivityAt || s.meta.createdAt) ? fmtFull(normTs(s.meta.lastActivityAt || s.meta.createdAt)) : '';
    const t = document.createElement('div'); t.className = 'stitle';
    if (s.project) { const chip = document.createElement('span'); chip.className = 'pchip' + (s.project.how === 'meta' ? '' : ' soft'); chip.textContent = projectLabel(s); t.appendChild(chip); }
    t.appendChild(document.createTextNode(title));
    const m = document.createElement('div'); m.className = 'smeta';
    m.textContent = [when, s.archive ? `archive relue (${s.archive.label.split('/').pop()}${s.manifest && s.manifest.captured_at ? ', exportée le ' + fmtFull(s.manifest.captured_at) : ''}${s.manifest ? ', ' + s.manifest.event_count + ' événements' : ''})` : s.audit ? `audit ${human(s.audit.size)}` : 'conversation non déposée (dépose le dossier local_' + s.id.slice(0, 8) + '… pour l\'ouvrir)', s.uploads.length ? `${s.uploads.length} envoi(s)` : '', s.outputs.length ? `${s.outputs.length} produit(s)` : '', s.meta && s.meta.isArchived ? 'archivée' : ''].filter(Boolean).join(' · ');
    row.appendChild(t); row.appendChild(m);
    row.addEventListener('click', () => openSession(s, row));
    list.appendChild(row);
  }
  $L('sessionsCard').hidden = false;
  $L('sessionsCount').textContent = `${sessions.length} session${sessions.length > 1 ? 's' : ''}`;
  const search = $L('sessionSearch');
  if (search) { search.hidden = sessions.length < 6; search.oninput = applySessionFilter; }
  // filtre par projet
  const psel = $L('projectSelect');
  if (psel) {
    const names = [...new Set(sessions.map(s => s.project ? s.project.name : ''))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'fr'));
    const prev = psel.value; psel.innerHTML = '';
    const all = document.createElement('option'); all.value = ''; all.textContent = `Tous les projets (${sessions.length})`; psel.appendChild(all);
    for (const n of names) { const o = document.createElement('option'); o.value = n; o.textContent = `${n} (${sessions.filter(s => s.project && s.project.name === n).length})`; psel.appendChild(o); }
    if (sessions.some(s => !s.project)) { const o = document.createElement('option'); o.value = '__none__'; o.textContent = `Sans projet identifié (${sessions.filter(s => !s.project).length})`; psel.appendChild(o); }
    psel.hidden = names.length === 0; psel.value = [...psel.options].some(o => o.value === prev) ? prev : '';
    psel.onchange = applySessionFilter;
  }
  applySessionFilter();
  const withTitle = sessions.filter(s => s.meta && (s.meta.title || s.meta.name)).length;
  const withConv = sessions.filter(s => s.audit).length;
  const withProj = sessions.filter(s => s.project).length;
  log(`${sessions.length} session(s) listée(s) : ${withTitle} avec leur titre officiel, ${withConv} avec leur conversation, ${withProj} rattachée(s) à un projet${LOCAL.spaces.length ? '' : ' (dépose spaces.json pour les noms de projets)'}.`, withTitle < sessions.length ? 'warn' : 'ok');
  if (withTitle < sessions.length) log('Pour avoir tous les titres, dépose aussi les fichiers local_….json (à côté des dossiers local_…).', 'warn');
  status(`${sessions.length} session(s) listée(s) — seuls titres/dates/projets ont été lus, aucune conversation n'est ouverte. Clique UNE session pour l'afficher, ou « Construire l'index ».`, 'ok');
}

function renderCurrent() {
  const s = LOCAL.current; if (!s || !state.events) return;
  const stats = renderPreview(state);
  Viewer.setMode($L('modeBtn').dataset.mode || 'hr');
  const days = listDays(state.events); state.days = days;
  const sel = $L('daySelect'); sel.innerHTML = '';
  const ph = document.createElement('option'); ph.value = ''; ph.textContent = 'Choisir un jour…  (tout afficher)'; sel.appendChild(ph);
  for (const d of days) { const o = document.createElement('option'); o.value = d.key; o.textContent = `${d.label} — ${d.user} de toi, ${d.claude} de Claude`; sel.appendChild(o); }
  sel.value = ''; $L('dayExport').hidden = false; $L('dayBtn').disabled = true; $L('zipDayBtn').disabled = days.length === 0;
  return stats;
}

async function openSession(s, row) {
  document.querySelectorAll('.srow.sel').forEach(e => e.classList.remove('sel'));
  if (row) row.classList.add('sel');
  if (!s.audit && !s.archive) { status(`Cette session n'a que son titre (local_….json). Pour lire la conversation, dépose le DOSSIER local_${s.id}.`, 'warn'); return; }
  ui.log.textContent = ''; setProgress(10);
  try {
    s.tz = s.tz || tzGet(s.id, s.tzHint); tzApply(s.tz);
    const { events, meta } = s.archive ? { events: await archiveEvents(s), meta: s.meta && !s.meta._fromEvents ? s.meta : null } : await adaptSession(s);
    LOCAL.current = s;
    state.sessionId = 'local_' + s.id;
    state.events = events; state.meta = meta; state.pages = s.archive ? ((s.manifest && s.manifest.pages) || [{ url: 'archive:' + s.archive.label, count: events.length }]) : [{ url: 'local:' + s.dir + 'audit.jsonl', count: events.length }]; state.cursorParam = s.archive ? 'archive' : 'local'; state.missing = (s.manifest && s.manifest.missing_sequences) || [];
    ui.sid.textContent = ((meta && (meta.title || meta.name)) || s.id) + (s.project ? '   ·   projet : ' + projectLabel(s) : '');
    setProgress(60);
    const stats = renderCurrent();
    $L('zipBtn').disabled = false; $L('tzWrap').hidden = false;
    setProgress(100);
    log(`Aperçu prêt : ${stats.userCount} messages de toi, ${stats.claudeCount} de Claude, ${stats.toolCount} appels d'outil, ${stats.imgCount} images. Heures affichées en ${s.tz}.`, 'ok');
    // pré-lecture des pièces (uploads/outputs) tant que les références de fichiers sont fraîches
    if (!s.archive) prefetchAttachments(s);
  } catch (err) { console.error(err); log(`Échec : ${err.message}`, 'err'); setProgress(0); }
}

// Chrome invalide une référence de fichier déposé dès que le fichier change sur le disque (session encore ouverte dans Cowork, iCloud…) :
// « The requested file could not be read… ». On lit donc les pièces tôt et on garde les octets en mémoire (jusqu'à 60 Mo par fichier).
const PREFETCH_MAX = 60 * 1024 * 1024;
async function readSafe(file, name) {
  try { return await file.arrayBuffer(); } catch (err) { return { error: err.message || String(err), name }; }
}
async function prefetchAttachments(s) {
  if (s._prefetched) return; s._prefetched = true;
  for (const list of [s.uploads, s.outputs]) for (const u of list) {
    if (u.bytes || u.error) continue;
    if (u.file.size > PREFETCH_MAX) continue; // lu à la demande
    const r = await readSafe(u.file, u.name);
    if (r instanceof ArrayBuffer) u.bytes = r; else u.error = r.error;
  }
  if (s.metaFile && !s.metaText) { try { s.metaText = await s.metaFile.text(); } catch (_) {} }
}

// Fichiers locaux ajoutés au ZIP (uploads/ et outputs/ de la session)
window.LOCAL_EXTRA = async function (zip) {
  const s = LOCAL.current; if (!s) return;
  zip.file('session-local.json', JSON.stringify({ id: s.id, title: sessionTitle(s), project: s.project || null, tz: s.tz || null, source: s.archive ? 'archive:' + s.archive.label : 'local-agent-mode-sessions', exported_at: new Date().toISOString() }, null, 2));
  if (s.archive) { // ré-export d'une archive : on recopie les pièces d'origine telles quelles
    let n = 0;
    for (const name of s.archive.names) if (/^(audit\.jsonl|session-meta\.json|uploads\/|outputs\/|FICHIERS-NON-LUS\.txt)/.test(name)) { try { zip.file(name, await s.archive.bytes(name)); n++; } catch (_) {} }
    log(`${n} pièce(s) recopiée(s) depuis l'archive d'origine.`, 'ok'); return;
  }
  const failed = [];
  for (const [list, dir] of [[s.uploads, 'uploads'], [s.outputs, 'outputs']]) for (const u of list) {
    let bytes = u.bytes;
    if (!bytes) { const r = await readSafe(u.file, u.name); if (r instanceof ArrayBuffer) bytes = r; else { failed.push(`${dir}/${u.name} (${r.error})`); continue; } }
    zip.file(`${dir}/${u.name}`, bytes);
  }
  if (s.metaFile) { const t = s.metaText || await s.metaFile.text().catch(() => null); if (t != null) zip.file('session-meta.json', t); else failed.push('local_….json'); }
  if (s.auditText != null) zip.file('audit.jsonl', s.auditText);
  else { try { zip.file('audit.jsonl', await s.audit.text()); } catch (err) { failed.push(`audit.jsonl (${err.message})`); } }
  if (failed.length) {
    zip.file('FICHIERS-NON-LUS.txt', 'Ces fichiers n\'ont pas pu être relus par le navigateur au moment du ZIP (référence invalidée : fichier modifié depuis le dépôt, session encore ouverte dans Cowork, fichier iCloud non téléchargé, ou permissions).\nRe-dépose la session et recommence pour les inclure.\n\n' + failed.join('\n') + '\n');
    log(`${failed.length} fichier(s) non relu(s) — ZIP créé sans eux (liste dans FICHIERS-NON-LUS.txt) : ${failed.slice(0, 3).join(' · ')}${failed.length > 3 ? ' · …' : ''}`, 'warn');
  } else log(`${s.uploads.length + s.outputs.length} pièce(s) locale(s) (uploads/, outputs/) + audit.jsonl ajoutés au ZIP.`, 'ok');
};

document.addEventListener('DOMContentLoaded', async () => {
  Viewer.init('hr');
  const drop = $L('drop');
  // Glisser-déposer accepté sur TOUTE la page (et jamais de navigation vers le fichier déposé)
  ['dragenter', 'dragover'].forEach(ev => window.addEventListener(ev, e => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {} drop.classList.add('over'); }));
  window.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
  window.addEventListener('drop', async e => { e.preventDefault(); drop.classList.remove('over'); const files = await collectDrop(e.dataTransfer); await onFiles(files); });
  $L('csvBtn').addEventListener('click', exportSessionList);
  const tzSel = $L('tzSelect');
  for (const [v, lab] of TZ_CHOICES) { const o = document.createElement('option'); o.value = v; o.textContent = lab; tzSel.appendChild(o); }
  tzSel.value = window.DISPLAY_TZ;
  tzSel.addEventListener('change', () => {
    const tz = tzSel.value; const s = LOCAL.current;
    if (s) { s.tz = tz; tzSet(s.id, tz); tzApply(tz); renderCurrent(); log(`Heures maintenant affichées en ${tz} pour cette session (mémorisé).`, 'ok'); }
    else { tzApply(tz); try { localStorage.setItem('cowork-tz:default', tz); } catch (_) {} log(`Fuseau par défaut : ${tz}.`, 'ok'); }
  });
  $L('tzDefaultBtn').addEventListener('click', () => { try { localStorage.setItem('cowork-tz:default', tzSel.value); } catch (_) {} log(`${tzSel.value} devient le fuseau par défaut des sessions sans choix mémorisé.`, 'ok'); });
  $L('dirInput').addEventListener('change', e => { status(`${e.target.files.length} fichier(s) dans le dossier choisi. Lecture…`); onFiles(collectInput(e.target.files)); });

  $L('zipBtn').addEventListener('click', doZip);
  $L('zipDayBtn').addEventListener('click', doZipByDay);
  const daySelect = $L('daySelect');
  daySelect.addEventListener('change', () => { const key = daySelect.value; filterConvByDay(key); $L('dayBtn').disabled = (key === ''); });
  $L('dayBtn').addEventListener('click', () => {
    if (!state.events) return;
    const key = daySelect.value; if (!key) { log('Choisis d\'abord un jour dans le menu.', 'warn'); return; }
    const md = buildDayMarkdown(state.sessionId, state.events, state.meta, key);
    const blob = new Blob([md], { type: 'text/markdown' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `cowork-${state.sessionId}-jour-${key}.md`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000); log(`Journée ${key} exportée en .md`, 'ok');
  });
});
