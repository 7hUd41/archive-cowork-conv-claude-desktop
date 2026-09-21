// Cowork Session Archiver — archive.js
// Récupère le journal d'événements complet d'une session Cowork (claude.ai/v1/code/sessions/{id}/events),
// le sauvegarde brut, en extrait les images envoyées, les fichiers écrits par Claude et un transcript lisible,
// puis emballe le tout dans un ZIP. Tout se passe dans le navigateur, avec les cookies de la session claude.ai.

const API_BASE = 'https://claude.ai/v1/code/sessions/';
const PAGE_LIMIT = 100;
const MAX_PAGES = 1000;

// En-têtes observés dans les requêtes de la page claude.ai. `anthropic-version` est obligatoire
// (l'API renvoie "anthropic-version: header is required" sans lui). Les autres sont envoyés par prudence.
const API_HEADERS = {
  'accept': 'application/json',
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'ccr-byoc-2025-07-29',
  'anthropic-client-feature': 'ccr',
  'anthropic-client-platform': 'web_claude_ai',
};

// Noms de paramètre de pagination essayés dans l'ordre. Le premier qui renvoie des événements
// plus anciens que ceux déjà reçus est conservé pour toute la session.
const CURSOR_PARAM_CANDIDATES = ['cursor', 'before', 'before_sequence_num', 'before_cursor', 'after'];

const ui = {
  log: document.getElementById('log'),
  progress: document.getElementById('progress'),
  
  sid: document.getElementById('sid'),
};

function log(msg, cls = '') {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg;
  ui.log.appendChild(line);
  ui.log.scrollTop = ui.log.scrollHeight;
}

function setProgress(pct) {
  ui.progress.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

function seqNum(e) {
  const n = Number(e && e.sequence_num);
  return Number.isFinite(n) ? n : null;
}

async function apiGet(url) {
  const res = await fetch(url, { credentials: 'include', headers: API_HEADERS });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* pas du JSON */ }
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || text.slice(0, 200);
    throw new Error(`HTTP ${res.status} — ${msg}`);
  }
  return json;
}

// ---------- Récupération de toutes les pages ----------

async function fetchAllEvents(sessionId) {
  const base = `${API_BASE}${encodeURIComponent(sessionId)}/events?limit=${PAGE_LIMIT}`;
  const pages = [];
  const byId = new Map();

  log(`Page 1 : ${base}`);
  let page = await apiGet(base);
  if (!page || !Array.isArray(page.data)) throw new Error('Réponse inattendue : pas de tableau "data".');
  pages.push({ url: base, next_cursor: page.next_cursor, resume_cursor: page.resume_cursor, count: page.data.length });
  page.data.forEach(e => byId.set(e.event_id || e.uuid || JSON.stringify(e).slice(0, 80), e));
  log(`  ${page.data.length} événements, next_cursor = ${JSON.stringify(page.next_cursor)}`);

  let cursor = page.next_cursor;
  let cursorParam = null;
  let pageNo = 1;

  while (cursor !== null && cursor !== undefined && pageNo < MAX_PAGES) {
    const minSeq = Math.min(...[...byId.values()].map(seqNum).filter(n => n !== null));
    let got = null;

    const candidates = cursorParam ? [cursorParam] : CURSOR_PARAM_CANDIDATES;
    for (const p of candidates) {
      const url = `${base}&${p}=${encodeURIComponent(cursor)}`;
      let resp;
      try { resp = await apiGet(url); } catch (err) { log(`  paramètre "${p}" refusé : ${err.message}`, 'warn'); continue; }
      const data = Array.isArray(resp && resp.data) ? resp.data : [];
      const newer = data.filter(e => !byId.has(e.event_id || e.uuid));
      const oldest = data.length ? Math.min(...data.map(seqNum).filter(n => n !== null)) : null;
      if (newer.length > 0 && oldest !== null && oldest < minSeq) {
        cursorParam = p;
        got = { url, resp, newer };
        break;
      }
      log(`  paramètre "${p}" ignoré par le serveur (mêmes événements)`, 'warn');
    }

    if (!got) {
      log(`Impossible de paginer au-delà de la séquence ${minSeq} : aucun paramètre de curseur accepté. L'archive sera partielle.`, 'err');
      break;
    }

    pageNo++;
    got.newer.forEach(e => byId.set(e.event_id || e.uuid, e));
    pages.push({ url: got.url, next_cursor: got.resp.next_cursor, resume_cursor: got.resp.resume_cursor, count: got.resp.data.length });
    log(`Page ${pageNo} (${cursorParam}=${cursor}) : ${got.resp.data.length} événements, next_cursor = ${JSON.stringify(got.resp.next_cursor)}`);

    if (got.resp.next_cursor === cursor) { log('Curseur identique à la page précédente, arrêt.', 'warn'); break; }
    cursor = got.resp.next_cursor;
    if (got.resp.data.length === 0) break;
  }

  const events = [...byId.values()].sort((a, b) => (seqNum(a) ?? 0) - (seqNum(b) ?? 0));
  return { events, pages, cursorParam };
}

// ---------- Extraction ----------

const EXT_BY_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/heic': 'heic', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/tiff': 'tiff',
};

function safeName(name) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 150) || 'sans-nom';
}

function pad(n, w = 4) { return String(n).padStart(w, '0'); }

function base64ToUint8(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function extractImages(events) {
  const images = [];
  const usedNames = new Set();
  for (const e of events) {
    if (e.event_type !== 'user') continue;
    const content = e.payload && e.payload.message && e.payload.message.content;
    if (!Array.isArray(content)) continue;
    const attachments = (e.payload.file_attachments || []).filter(a => a.is_image);
    let imgIndex = 0;
    for (const block of content) {
      if (!block || block.type !== 'image' || !block.source || block.source.type !== 'base64') continue;
      const mime = block.source.media_type || 'application/octet-stream';
      const ext = EXT_BY_MIME[mime] || 'bin';
      const att = attachments[imgIndex] || null;
      const seq = seqNum(e);
      let base = att && att.file_name ? safeName(att.file_name.replace(/\.[A-Za-z0-9]+$/, '')) : `image`;
      let name = `${pad(seq)}-${base}.${ext}`;
      let k = 2;
      while (usedNames.has(name)) { name = `${pad(seq)}-${base}-${k++}.${ext}`; }
      usedNames.add(name);
      images.push({
        zipPath: `images/${name}`,
        bytes: base64ToUint8(block.source.data),
        sequence_num: seq,
        event_id: e.event_id,
        created_at: e.created_at,
        original_name: att ? att.file_name : null,
        file_uuid: att ? att.file_uuid : null,
        media_type: mime,
      });
      imgIndex++;
    }
  }
  return images;
}

function extractReferencedFiles(events) {
  const files = [];
  for (const e of events) {
    if (e.event_type !== 'user') continue;
    for (const a of (e.payload && e.payload.file_attachments) || []) {
      files.push({ sequence_num: seqNum(e), event_id: e.event_id, created_at: e.created_at, file_name: a.file_name, file_uuid: a.file_uuid, is_image: !!a.is_image });
    }
  }
  return files;
}

function extractWrittenFiles(events) {
  const files = [];
  const usedNames = new Set();
  for (const e of events) {
    if (e.event_type !== 'assistant') continue;
    const content = e.payload && e.payload.message && e.payload.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || block.type !== 'tool_use' || !block.input) continue;
      const input = block.input;
      let path = null, text = null;
      if (block.name === 'Write' && typeof input.content === 'string' && input.file_path) { path = input.file_path; text = input.content; }
      else if (block.name === 'Projects' && input.method === 'project_write' && typeof input.content === 'string' && input.path) { path = 'project/' + input.path; text = input.content; }
      if (path === null) continue;
      const seq = seqNum(e);
      let name = `${pad(seq)}-${safeName(path.split('/').filter(Boolean).slice(-2).join('__'))}`;
      let k = 2;
      const stem = name;
      while (usedNames.has(name)) { name = `${stem}-${k++}`; }
      usedNames.add(name);
      files.push({ zipPath: `written-files/${name}`, text, sequence_num: seq, event_id: e.event_id, tool: block.name, original_path: path, tool_use_id: block.id });
    }
  }
  return files;
}

function extractDeliveredFiles(events) {
  const out = [];
  for (const e of events) {
    if (e.event_type !== 'user') continue;
    const r = e.payload && e.payload.tool_use_result;
    if (r && Array.isArray(r.attachments)) {
      for (const a of r.attachments) out.push({ sequence_num: seqNum(e), created_at: e.created_at, path: a.path, file_uuid: a.file_uuid, media_type: a.media_type, size: a.size, caption: r.caption || null });
    }
  }
  return out;
}

// ---------- Transcript lisible ----------

// Fuseau horaire d'affichage : par défaut celui du navigateur ; le viewer local peut l'imposer (window.DISPLAY_TZ, ex. 'America/Toronto').
function TZ() { return (typeof window !== 'undefined' && window.DISPLAY_TZ) || undefined; }
function tzLabel() { return TZ() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'fuseau du navigateur'; }
function fmtDate(iso) {
  try { return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ() }); } catch (_) { return iso || ''; }
}

function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + ' […]' : s; }

// Remplace les longues chaînes base64 (images/PDF renvoyés par les outils) par une mention courte.
function stripBinary(s) {
  return String(s == null ? '' : s).replace(/[A-Za-z0-9+/]{120,}={0,2}/g, m => `[données binaires ~${Math.round(m.length * 3 / 4 / 1024)} Ko omises]`);
}

// Détecte le "faux message utilisateur" injecté à chaque compaction (le résumé que Claude s'écrit).
// Renvoie le texte du résumé si c'en est un, sinon null.
function compactionSummary(p) {
  const c = p && p.message && p.message.content;
  let txt = null;
  if (typeof c === 'string') txt = c;
  else if (Array.isArray(c)) { const b = c.find(x => x && x.type === 'text'); txt = b && b.text; }
  if (txt && /^\s*This session is being continued from a previous conversation/.test(txt)) return txt;
  return null;
}

// Retire les blocs techniques injectés dans le texte utilisateur (conservés tels quels dans events.json).
function cleanUserText(text) {
  return String(text || '')
    .replace(/<uploaded_files>[\s\S]*?<\/uploaded_files>/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/\[Image: original \d+x\d+, displayed at \d+x\d+\.[^\]]*\]/g, '')
    .replace(/The \d+ attached images?, in display order, (?:are|is) also saved at[\s\S]*?(?:do not read the files? just to view (?:it|them)\.)/g, '')
    .trim();
}

function summarizeToolInput(name, input) {
  if (!input || typeof input !== 'object') return '';
  const parts = [];
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string') parts.push(`${k}: ${JSON.stringify(truncate(v, 120))}`);
    else parts.push(`${k}: ${truncate(JSON.stringify(v), 120)}`);
  }
  return parts.join(', ');
}

function buildTranscript(sessionId, events, meta) {
  const lines = [];
  const title = (meta && (meta.title || meta.name)) || sessionId;
  lines.push(`# ${title}`, '', `Session : \`${sessionId}\`  `, `Archivé le : ${fmtDate(new Date().toISOString())}  `, `Événements : ${events.length}  `, `Fuseau horaire des heures affichées : ${tzLabel()} (les horodatages bruts d'events.json sont en UTC)`, '', '---', '');

  const toolNames = new Map();
  let imgCounter = 0;

  for (const e of events) {
    const t = e.event_type;
    const p = e.payload || {};
    const seq = seqNum(e);
    const when = fmtDate(e.created_at);

    if (t === 'user') {
      const cs = compactionSummary(p);
      if (cs) {
        lines.push(`## ⟢ RÉSUMÉ DE COMPACTION — contexte retenu par Claude (ce n'est PAS un message de l'utilisateur) — ${when} · #${seq}`, '', stripBinary(cs), '', '---', '');
        continue;
      }
      const content = p.message && p.message.content;
      if (typeof content === 'string') {
        if (content.trimStart().startsWith('<system-reminder>')) {
          lines.push(`> _[${when} · #${seq}] rappel système injecté (voir events.json)_`, '');
        } else {
          lines.push(`## Vous — ${when} · #${seq}`, '', cleanUserText(content), '');
        }
      } else if (Array.isArray(content)) {
        const texts = [], notes = [];
        for (const b of content) {
          if (!b) continue;
          if (b.type === 'text') { const ct = cleanUserText(b.text); if (ct) texts.push(ct); }
          else if (b.type === 'image') { imgCounter++; notes.push(`[image envoyée n°${imgCounter}]`); }
          else if (b.type === 'tool_result') {
            const toolName = toolNames.get(b.tool_use_id) || 'outil';
            const c = stripBinary(typeof b.content === 'string' ? b.content : JSON.stringify(b.content));
            notes.push(`↩︎ résultat de ${toolName} : ${truncate(c.replace(/\s+/g, ' '), 300)}`);
          } else if (b.type === 'document') notes.push('[document joint]');
          else notes.push(`[bloc ${b.type}]`);
        }
        if (texts.length) lines.push(`## Vous — ${when} · #${seq}`, '', ...texts, '');
        if (notes.length) { for (const n of notes) lines.push(`> ${n}`); lines.push(''); }
        const atts = p.file_attachments || [];
        if (atts.length) { for (const a of atts) lines.push(`> pièce jointe : ${a.file_name} (${a.is_image ? 'image' : 'fichier'})`); lines.push(''); }
      }
    } else if (t === 'assistant') {
      const msg = p.message || {};
      const content = Array.isArray(msg.content) ? msg.content : [];
      const texts = [], acts = [];
      for (const b of content) {
        if (!b) continue;
        if (b.type === 'text') texts.push(b.text || '');
        else if (b.type === 'tool_use') { toolNames.set(b.id, b.name); acts.push(`🔧 ${b.name} — ${summarizeToolInput(b.name, b.input)}`); }
        else if (b.type === 'thinking') { /* vide côté serveur : rien à afficher */ }
        else acts.push(`[bloc ${b.type}]`);
      }
      if (texts.length) lines.push(`## Claude${msg.model ? ' (' + msg.model + ')' : ''} — ${when} · #${seq}`, '', ...texts, '');
      if (acts.length) { for (const a of acts) lines.push(`> ${a}`); lines.push(''); }
    } else if (t === 'result') {
      const cost = p.modelUsage ? Object.values(p.modelUsage).reduce((s, m) => s + (m.costUSD || 0), 0) : null;
      const dur = p.duration_ms ? Math.round(p.duration_ms / 1000) + ' s' : '';
      lines.push(`> _fin de tour · ${dur}${cost !== null ? ' · ' + cost.toFixed(3) + ' $' : ''}${p.is_error ? ' · ERREUR' : ''}_`, '');
    } else if (t === 'system' && p.subtype === 'init') {
      lines.push(`> _[${when}] démarrage de l'environnement${p.model ? ' · modèle ' + p.model : ''}_`, '');
    }
  }
  lines.push('---', '', '_Les blocs de raisonnement (thinking) sont vides dans l\'API et ne peuvent pas être archivés. Le journal brut complet est dans events.json._');
  return lines.join('\n');
}


// ---------- Aperçu (rendu DOM, sans innerHTML sur le contenu) ----------

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ() }); } catch (_) { return ''; }
}
function fmtDay(iso) {
  try { return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ() }); } catch (_) { return ''; }
}
function fmtDuration(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

// Mise en forme Markdown minimale et sûre (texte inséré via textContent).
function renderInline(text, parent) {
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    const tok = m[0];
    if (tok.startsWith('**')) parent.appendChild(el('strong', '', tok.slice(2, -2)));
    else if (tok.startsWith('`')) parent.appendChild(el('code', '', tok.slice(1, -1)));
    else parent.appendChild(el('em', '', tok.slice(1, -1)));
    last = m.index + tok.length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

function renderMarkdown(text) {
  const root = el('div', 'body');
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  let para = [], list = null, code = null;
  const flushPara = () => { if (para.length) { const p = el('p'); renderInline(para.join('\n'), p); root.appendChild(p); para = []; } };
  const flushList = () => { if (list) { root.appendChild(list.node); list = null; } };
  for (const raw of lines) {
    if (code) { if (raw.startsWith('```')) { root.appendChild(code); code = null; } else code.textContent += raw + '\n'; continue; }
    if (raw.startsWith('```')) { flushPara(); flushList(); code = el('pre'); continue; }
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); flushList(); const n = el(h[1].length <= 2 ? 'h3' : 'h4'); renderInline(h[2], n); root.appendChild(n); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(raw)) { flushPara(); flushList(); root.appendChild(el('hr')); continue; }
    const li = raw.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (li) {
      flushPara();
      const ordered = /^\s*\d/.test(raw);
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, node: el(ordered ? 'ol' : 'ul') }; }
      const item = el('li'); renderInline(li[1], item); list.node.appendChild(item); continue;
    }
    if (raw.trim() === '') { flushPara(); flushList(); continue; }
    if (list) flushList();
    para.push(raw);
  }
  if (code) root.appendChild(code);
  flushPara(); flushList();
  return root;
}

function toolHeadline(name, input) {
  input = input || {};
  const s = v => truncate(String(v ?? ''), 140);
  switch (name) {
    case 'Write': return `écrit le fichier ${s(input.file_path)}`;
    case 'Edit': return `modifie le fichier ${s(input.file_path)}`;
    case 'Read': return `lit ${s(input.file_path)}`;
    case 'Bash': return input.description ? s(input.description) : `exécute ${s(input.command)}`;
    case 'Glob': case 'Grep': return `cherche ${s(input.pattern)}${input.path ? ' dans ' + s(input.path) : ''}`;
    case 'WebSearch': return `recherche web « ${s(input.query)} »`;
    case 'WebFetch': return `lit la page ${s(input.url)}`;
    case 'Projects': return `Projet · ${s(input.method)}${input.path ? ' · ' + s(input.path) : ''}`;
    case 'SendUserFile': return `envoie ${Array.isArray(input.files) ? input.files.map(f => String(f).split('/').pop()).join(', ') : ''}`;
    case 'Agent': case 'Task': return `lance un agent${input.subagent_type ? ' ' + s(input.subagent_type) : ''} : ${s(input.description || input.prompt)}`;
    case 'AskUserQuestion': return 'pose une question';
    case 'TaskCreate': return `tâche : ${s(input.subject)}`;
    case 'TaskUpdate': return `tâche #${s(input.taskId)} → ${s(input.status || 'mise à jour')}`;
    case 'Skill': return `charge la compétence ${s(input.skill)}`;
    case 'ToolSearch': return `charge des outils (${s(input.query)})`;
    default: return summarizeToolInput(name, input);
  }
}

function fmtFull(iso) {
  try {
    const d = new Date(iso);
    const day = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short', year: '2-digit', timeZone: TZ() });
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ() });
    return `${day} à ${time}`;
  } catch (_) { return iso || ''; }
}
function fmtBytes(n) { if (!n && n !== 0) return ''; return n < 1024 ? `${n} o` : n < 1048576 ? `${(n / 1024).toFixed(0)} Ko` : `${(n / 1048576).toFixed(1)} Mo`; }
function extOf(name) { const m = String(name || '').match(/\.([A-Za-z0-9]+)$/); return m ? m[1].toUpperCase() : ''; }

const TOOL_ICON = {
  Write: '📄', Edit: '✏️', Read: '👁️', Bash: '⌨️', Glob: '🔎', Grep: '🔎', WebSearch: '🌐', WebFetch: '🌐',
  Projects: '📁', SendUserFile: '📤', Agent: '🤖', Task: '🤖', AskUserQuestion: '❓', TaskCreate: '☑️', TaskUpdate: '☑️',
  Skill: '🧩', ToolSearch: '🧰',
};
function toolIcon(name) { return TOOL_ICON[name] || (String(name).startsWith('mcp__') ? '🔌' : '🔧'); }

function toolCategory(name, input) {
  input = input || {};
  switch (name) {
    case 'Write': return 'fichier créé';
    case 'Edit': return 'fichier modifié';
    case 'Read': return 'fichier lu';
    case 'Bash': return 'commande exécutée';
    case 'Glob': case 'Grep': return 'recherche dans les fichiers';
    case 'WebSearch': return 'recherche web';
    case 'WebFetch': return 'page web lue';
    case 'Projects': return /write|create|update|delete/i.test(input.method || '') ? 'projet mis à jour' : 'projet consulté';
    case 'SendUserFile': return 'fichier partagé';
    case 'Agent': case 'Task': return 'agent lancé';
    case 'AskUserQuestion': return 'question posée';
    case 'TaskCreate': case 'TaskUpdate': return 'liste de tâches';
    case 'Skill': return 'compétence chargée';
    case 'ToolSearch': return 'outils chargés';
    default: return String(name).startsWith('mcp__') ? 'connecteur ' + String(name).split('__')[1] : name;
  }
}

function dateSpans(iso) {
  // Mode complet : date entière. Mode lecture : heure seule, la date entière en infobulle (le séparateur de jour la donne déjà).
  const full = el('span', 'd-full', '· ' + fmtFull(iso));
  const short = el('span', 'd-short', '· ' + fmtTime(iso));
  short.dataset.tip = fmtDay(iso);
  return [full, short];
}

function whoLine(who, whenIso, techParts) {
  const w = el('div', 'who');
  w.appendChild(el('b', '', who));
  for (const d of dateSpans(whenIso)) w.appendChild(d);
  const tech = (techParts || []).filter(Boolean);
  if (tech.length) w.appendChild(el('span', 'tech', '· ' + tech.join(' · ')));
  return w;
}

function fileKind(name, mediaType) {
  const ext = extOf(name);
  const mt = String(mediaType || '');
  let kind = 'Fichier';
  if (mt.startsWith('image/')) kind = 'Image';
  else if (['MD', 'TXT', 'DOCX', 'DOC', 'RTF', 'PDF', 'HTML', 'ODT'].includes(ext) || mt.startsWith('text/') || mt.includes('pdf') || mt.includes('word')) kind = 'Document';
  else if (['CSV', 'XLSX', 'XLS', 'TSV', 'ODS'].includes(ext) || mt.includes('sheet') || mt.includes('csv')) kind = 'Tableur';
  else if (['PPTX', 'PPT', 'KEY'].includes(ext) || mt.includes('presentation')) kind = 'Présentation';
  else if (['ZIP', 'TAR', 'GZ', '7Z'].includes(ext) || mt.includes('zip')) kind = 'Archive';
  else if (['JS', 'PY', 'TS', 'JSON', 'SH', 'CSS', 'YAML', 'YML', 'TOML'].includes(ext)) kind = 'Code';
  else if (mt.startsWith('audio/')) kind = 'Audio';
  else if (mt.startsWith('video/')) kind = 'Vidéo';
  return `${kind}${ext ? ' · ' + ext : ''}`;
}

function fileCard(name, mediaType, metaLines) {
  const card = el('div', 'filecard');
  const icon = el('div', 'ficon'); icon.appendChild(el('div', 'fpage')); icon.appendChild(el('div', 'fpage back'));
  const body = el('div', 'fbody');
  const stem = String(name || '').replace(/\.[A-Za-z0-9]+$/, '') || '(sans nom)';
  body.appendChild(el('div', 'fname', stem.charAt(0).toUpperCase() + stem.slice(1)));
  body.appendChild(el('div', 'fkind', fileKind(name, mediaType)));
  const extra = (metaLines || []).filter(Boolean).join(' · ');
  if (extra) body.appendChild(el('div', 'fmeta', extra));
  card.appendChild(icon); card.appendChild(body);
  return card;
}

function renderPreview(state) {
  const { sessionId, events, meta } = state;
  const conv = document.getElementById('conv');
  conv.textContent = '';

  const toolIndex = new Map();   // tool_use_id -> { name, item, body, block, agentBox }
  let lastDay = null;
  let imgCount = 0, toolCount = 0, turnCount = 0, userCount = 0, claudeCount = 0, compactSeen = 0;
  let currentBlock = null;       // bloc d'activité en cours (frise)
  const pendingFiles = new Map(); // container -> [cartes de fichiers livrés, en attente du prochain message Claude]
  const lastClaude = new Map();   // container -> dernière bulle Claude rendue
  const queueFile = (container, card) => { if (!pendingFiles.has(container)) pendingFiles.set(container, []); pendingFiles.get(container).push(card); };
  const flushFiles = (container, target) => {
    const q = pendingFiles.get(container); if (!q || !q.length) return;
    const dest = target || lastClaude.get(container) || (currentBlock && currentBlock.node.parentNode === container ? currentBlock.files : null) || container;
    for (const c of q) dest.appendChild(c);
    pendingFiles.set(container, []);
  };

  const dayMarker = e => {
    const d = fmtDay(e.created_at);
    if (d && d !== lastDay) { const dm = el('div', 'day', d); dm.dataset.dayKey = dayKey(e.created_at); conv.appendChild(dm); lastDay = d; }
  };

  // Un bloc d'activité = en-tête résumé + frise verticale d'actions + cartes de fichiers partagés
  const hrMode = document.body.classList.contains('mode-hr');
  const newBlock = (container) => {
    const block = el('details', 'activity');
    block.open = !hrMode;
    const head = el('summary', 'ahead');
    const headText = el('span', 'htext', '');
    const count = el('span', 'count', '');
    head.appendChild(headText); head.appendChild(count);
    const list = el('div', 'timeline');
    const files = el('div', 'afiles');
    block.appendChild(head); block.appendChild(list); block.appendChild(files);
    container.appendChild(block);
    return { node: block, head, headText, count, list, files, cats: [] };
  };
  const refreshHead = block => {
    const uniq = [...new Set(block.cats)];
    const label = uniq.join(', ');
    block.headText.textContent = label ? label.charAt(0).toUpperCase() + label.slice(1) : 'Activité';
    block.count.textContent = `${block.cats.length} action${block.cats.length > 1 ? 's' : ''}`;
  };

  const containerFor = (parentToolUseId) => {
    const parent = parentToolUseId && toolIndex.get(parentToolUseId);
    if (!parent) return { container: conv, isAgent: false, parent: null };
    if (!parent.agentBox) {
      parent.agentBox = el('div', 'agent');
      parent.agentBox.appendChild(el('div', 'label', "Activité de l'agent"));
      parent.body.appendChild(parent.agentBox);
      parent.item.open = true;
    }
    return { container: parent.agentBox, isAgent: true, parent };
  };

  for (const e of events) {
    const t = e.event_type;
    const p = e.payload || {};
    const parentId = p.parent_tool_use_id || null;
    const when = fmtFull(e.created_at);
    const seq = seqNum(e);

    if (t === 'user') {
      const content = p.message && p.message.content;
      const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : (Array.isArray(content) ? content : []);
      const isReminder = blocks.length && blocks.every(b => b.type === 'text' && String(b.text || '').trimStart().startsWith('<system-reminder>'));
      if (isReminder) { conv.appendChild(el('div', 'sys', `${when} · rappel système injecté (#${seq})`)); continue; }
      const cs = compactionSummary(p);
      if (cs) {
        dayMarker(e);
        const det = el('details', 'compact-summary');
        const sm = el('summary');
        sm.appendChild(el('span', 'cs-badge', '⟢ Résumé de compaction'));
        sm.appendChild(el('span', 'cs-note', ` contexte retenu par Claude — ce n'est PAS un message de l'utilisateur · ${when} · #${seq}`));
        det.appendChild(sm);
        det.appendChild(renderMarkdown(stripBinary(cs)));
        conv.appendChild(det);
        compactSeen++;
        continue;
      }

      const toolResults = blocks.filter(b => b.type === 'tool_result');
      let others = blocks.filter(b => b.type !== 'tool_result');
      // Message réduit à des notes techniques injectées (ex. "[Image: original …]") : on l'affiche comme événement technique
      const onlyText = others.length && others.every(b => b.type === 'text');
      if (onlyText && !(p.file_attachments || []).length && others.every(b => !cleanUserText(b.text))) {
        conv.appendChild(el('div', 'sys', `${when} · note technique injectée (#${seq})`)); others = [];
      }

      for (const b of toolResults) {
        const ref = toolIndex.get(b.tool_use_id);
        const c = stripBinary(typeof b.content === 'string' ? b.content : (Array.isArray(b.content) ? b.content.map(x => x.text || `[${x.type}]`).join('\n') : JSON.stringify(b.content)));
        const r = el('div', 'result' + (b.is_error ? ' error' : ''));
        r.appendChild(el('span', 'rlabel', (b.is_error ? '✗ résultat (erreur) · ' : '✓ résultat · ') + when));
        r.appendChild(el('pre', '', c));
        if (ref) {
          ref.body.appendChild(r);
          const tr = p.tool_use_result;
          if (tr && Array.isArray(tr.attachments)) {
            const cont = ref.block.node.parentNode;
            for (const a of tr.attachments) {
              queueFile(cont, fileCard(String(a.path || '').split('/').pop(), a.media_type, [`partagé le ${when}`, a.media_type || '', fmtBytes(a.size), tr.caption ? `« ${tr.caption} »` : '', a.file_uuid ? `uuid ${a.file_uuid}` : '']));
            }
          }
        } else {
          const { container } = containerFor(parentId);
          const d = el('details', 'orphan'); d.appendChild(el('summary', '', `résultat d'outil sans appel associé · ${when}`)); d.appendChild(r); container.appendChild(d);
        }
      }

      if (others.length) {
        currentBlock = null;
        if (!parentId) dayMarker(e);
        const { container, isAgent } = containerFor(parentId);
        const col = el('div', 'ucol');
        const row = el('div', 'attrow');
        const atts = (p.file_attachments || []);
        const imgAtts = atts.filter(a => a.is_image);
        let ii = 0;
        const textParts = [];
        for (const b of others) {
          if (b.type === 'text') { const ct = cleanUserText(b.text); if (ct) textParts.push(ct); }
          else if (b.type === 'image' && b.source && b.source.type === 'base64') {
            imgCount++;
            const a = imgAtts[ii] || null; ii++;
            const card = el('div', 'attcard');
            card.appendChild(whoLine(isAgent ? 'Message vers l\'agent' : 'Vous', e.created_at, [`#${seq}`, a && a.file_uuid ? 'uuid ' + a.file_uuid : '']));
            const img = el('img', 'att'); img.src = `data:${b.source.media_type};base64,${b.source.data}`; img.title = `${(a && a.file_name) || 'image ' + imgCount} — ${when}`;
            card.appendChild(img);
            const am = el('div', 'attmeta', (a && a.file_name) || `image ${imgCount}`);
            am.appendChild(el('span', 'tech', ` · ${b.source.media_type} · ${fmtBytes(Math.round(b.source.data.length * 3 / 4))}`));
            card.appendChild(am);
            row.appendChild(card);
          } else col.appendChild(el('span', 'chip', `bloc ${b.type}`));
        }
        for (const a of atts.filter(a => !a.is_image)) {
          const card = el('div', 'attcard file');
          card.appendChild(whoLine(isAgent ? 'Message vers l\'agent' : 'Vous', e.created_at, [`#${seq}`, a.file_uuid ? 'uuid ' + a.file_uuid : '', 'contenu non inclus dans l\'API']));
          card.appendChild(el('div', 'fname', a.file_name || '(sans nom)'));
          card.appendChild(el('span', 'badge', extOf(a.file_name) || 'FICHIER'));
          row.appendChild(card);
        }
        if (row.childElementCount) col.appendChild(row);
        if (textParts.length) {
          const m = el('div', 'msg user');
          m.appendChild(whoLine(isAgent ? 'Message vers l\'agent' : 'Vous', e.created_at, [`#${seq}`, p.client_platform || '']));
          for (const tp of textParts) m.appendChild(renderMarkdown(tp));
          col.appendChild(m);
        }
        container.appendChild(col);
        if (!parentId) userCount++;
      }
    }

    else if (t === 'assistant') {
      const msg = p.message || {};
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      const texts = blocks.filter(b => b.type === 'text' && (b.text || '').trim());
      const tools = blocks.filter(b => b.type === 'tool_use');
      const { container, isAgent } = containerFor(parentId);
      if (texts.length) {
        currentBlock = null;
        if (!parentId) dayMarker(e);
        const m = el('div', 'msg claude');
        m.appendChild(whoLine(isAgent ? 'Agent' : 'Claude', e.created_at, [`#${seq}`, msg.model || '', msg.usage && msg.usage.output_tokens ? msg.usage.output_tokens + ' tokens' : '']));
        for (const b of texts) m.appendChild(renderMarkdown(b.text));
        container.appendChild(m);
        lastClaude.set(container, m);
        flushFiles(container, m);
        if (!parentId) claudeCount++;
      }
      for (const b of tools) {
        toolCount++;
        if (!currentBlock || currentBlock.node.parentNode !== container) currentBlock = newBlock(container);
        const block = currentBlock;
        const item = el('details', 'titem');
        const sum = el('summary');
        sum.appendChild(el('span', 'ticon', toolIcon(b.name)));
        const lab = el('span', 'tlabel');
        lab.appendChild(el('b', '', b.name)); lab.appendChild(document.createTextNode(' ' + toolHeadline(b.name, b.input)));
        sum.appendChild(lab);
        const tt = el('span', 'ttime'); for (const d of dateSpans(e.created_at)) { d.textContent = d.textContent.replace(/^· /, ''); tt.appendChild(d); } sum.appendChild(tt);
        item.appendChild(sum);
        const body = el('div', 'tbody');
        body.appendChild(el('div', 'rlabel', `paramètres · id ${b.id} · #${seq}`));
        body.appendChild(el('pre', '', JSON.stringify(b.input, null, 2)));
        item.appendChild(body);
        block.list.appendChild(item);
        block.cats.push(toolCategory(b.name, b.input));
        refreshHead(block);
        toolIndex.set(b.id, { name: b.name, item, body, block, agentBox: null });
      }
    }

    else if (t === 'result') {
      turnCount++;
      for (const c of pendingFiles.keys()) flushFiles(c);
      currentBlock = null;
      const cost = p.modelUsage ? Object.values(p.modelUsage).reduce((s, m) => s + (m.costUSD || 0), 0) : null;
      const bits = [`fin de tour ${turnCount}`, when, fmtDuration(p.duration_ms)];
      if (p.is_error) bits.push('ERREUR');
      const techBits = [];
      if (cost !== null) techBits.push(cost.toFixed(3) + ' $');
      if (p.num_turns) techBits.push(`${p.num_turns} échange${p.num_turns > 1 ? 's' : ''} interne${p.num_turns > 1 ? 's' : ''}`);
      if (p.permission_denials && p.permission_denials.length) techBits.push(`${p.permission_denials.length} permission(s) refusée(s)`);
      const tn = el('div', 'turn', '— ' + bits.filter(Boolean).join(' · '));
      if (techBits.length) tn.appendChild(el('span', 'tech', ' · ' + techBits.join(' · ')));
      tn.appendChild(document.createTextNode(' —'));
      conv.appendChild(tn);
    }

    else if (t === 'system') {
      if (p.subtype === 'thinking_tokens') continue; // compteurs de tokens : bruit sans valeur d'archive (conservés dans le journal brut)
      if (p.subtype === 'init') conv.appendChild(el('div', 'sys', `${when} · démarrage de l'environnement${p.model ? ' · ' + p.model : ''}`));
      else if (p.subtype === 'post_turn_summary' && p.summary) conv.appendChild(el('div', 'sys', `${when} · résumé du tour : ${truncate(p.summary, 160)}`));
      else conv.appendChild(el('div', 'sys', `${when} · système · ${p.subtype || ''}${p.hook_name ? ' · ' + p.hook_name : ''}`));
    }
    else if (t === 'env_manager_log') conv.appendChild(el('div', 'sys', `${when} · environnement · ${(p.data && p.data.content) || ''}`));
    else if (t === 'prompt_suggestion') conv.appendChild(el('div', 'sys', `${when} · suggestion proposée : « ${truncate(p.suggestion || '', 120)} »`));
    else conv.appendChild(el('div', 'sys', `${when} · ${t}`));
  }

  for (const c of pendingFiles.keys()) flushFiles(c);

  // Résumé
  const seqs = events.map(seqNum).filter(n => n !== null);
  const sm = document.getElementById('summary');
  sm.textContent = '';
  const dl = el('dl');
  const row = (k, v) => { dl.appendChild(el('dt', '', k)); dl.appendChild(el('dd', '', v)); };
  const title = meta && (meta.title || meta.name);
  if (title) row('Titre', title);
  row('Période', events.length ? `${fmtFull(events[0].created_at)} → ${fmtFull(events[events.length - 1].created_at)}` : '—');
  if (TZ()) row('Fuseau', `heures affichées en ${TZ()} (horodatages bruts en UTC)`);
  row('Événements', `${events.length} (séquences ${Math.min(...seqs)} → ${Math.max(...seqs)})`);
  row('Messages', `${userCount} de vous · ${claudeCount} de Claude · ${turnCount} tours`);
  row('Activité', `${toolCount} appel(s) d'outil · ${imgCount} image(s) envoyée(s)`);
  if (compactSeen) row('Compactions', `${compactSeen} résumé(s) de compaction repéré(s)`);
  sm.appendChild(dl);
  sm.style.display = 'block';
  return { imgCount, toolCount, turnCount, userCount, claudeCount };
}

// ---------- Orchestration ----------

const state = { sessionId: null, events: null, meta: null, pages: null, cursorParam: null };

async function doFetch() {
  const fetchBtn = document.getElementById('fetchBtn'), zipBtn = document.getElementById('zipBtn');
  fetchBtn.disabled = true; zipBtn.disabled = true;
  ui.log.textContent = '';
  setProgress(2);
  try {
    state.meta = null;
    try { state.meta = await apiGet(`${API_BASE}${encodeURIComponent(state.sessionId)}`); log('Métadonnées de session récupérées.', 'ok'); }
    catch (err) { log(`Métadonnées de session indisponibles (${err.message}) — on continue.`, 'warn'); }
    setProgress(8);

    const { events, pages, cursorParam } = await fetchAllEvents(state.sessionId);
    state.events = events; state.pages = pages; state.cursorParam = cursorParam;
    const seqs = events.map(seqNum).filter(n => n !== null);
    log(`Total : ${events.length} événements, séquences ${Math.min(...seqs)} → ${Math.max(...seqs)}.`, 'ok');
    const seqSet = new Set(seqs);
    state.missing = [];
    for (let s = Math.min(...seqs); s <= Math.max(...seqs); s++) if (!seqSet.has(s)) state.missing.push(s);
    if (state.missing.length) log(`Séquences absentes : ${state.missing.slice(0, 30).join(', ')}${state.missing.length > 30 ? '…' : ''}`, 'warn');
    if (Math.min(...seqs) > 1) log(`La plus ancienne séquence reçue est ${Math.min(...seqs)} (pas 1) : vérifie que l'aperçu commence bien au début.`, 'warn');
    setProgress(85);

    const stats = renderPreview(state);
    Viewer.setMode(document.getElementById('modeBtn').dataset.mode || 'hr');
    // Sélecteur de jour pour l'export d'une journée
    const days = listDays(events);
    state.days = days;
    const sel = document.getElementById('daySelect');
    if (sel) {
      sel.innerHTML = '';
      const ph = document.createElement('option');
      ph.value = ''; ph.textContent = 'Choisir un jour\u2026  (tout afficher)';
      sel.appendChild(ph);
      for (const d of days) {
        const o = document.createElement('option');
        o.value = d.key; o.textContent = `${d.label} — ${d.user} de toi, ${d.claude} de Claude`;
        sel.appendChild(o);
      }
      // par défaut, le dernier jour (souvent celui de la compaction du jour)
      sel.value = '';
      document.getElementById('dayExport').hidden = false;
      document.getElementById('dayBtn').disabled = true;
      document.getElementById('zipDayBtn').disabled = days.length === 0;
    }
    log(`Aperçu prêt : ${stats.userCount} messages de vous, ${stats.claudeCount} de Claude, ${stats.toolCount} appels d'outil, ${stats.imgCount} images. Vérifie, puis télécharge le ZIP.`, 'ok');
    setProgress(100);
    zipBtn.disabled = false;
  } catch (err) {
    console.error(err);
    log(`Échec : ${err.message}`, 'err');
    setProgress(0);
  } finally {
    fetchBtn.disabled = false;
  }
}

async function fetchText(path) {
  const res = await fetch(chrome.runtime.getURL(path));
  return await res.text();
}
async function fetchB64(path) {
  const res = await fetch(chrome.runtime.getURL(path));
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Construit transcript.html : même aperçu, mêmes fonctions, polices embarquées, mode lecture par défaut.
function dayKey(iso) {
  try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ() }); } catch (_) { return (iso || '').slice(0, 10); }
}

// Liste des jours présents (clé locale AAAA-MM-JJ) avec libellé lisible et nombre de messages.
function listDays(events) {
  const map = new Map();
  for (const e of events) {
    if (e.event_type !== 'user' && e.event_type !== 'assistant') continue;
    const p = e.payload || {};
    if (p.parent_tool_use_id) continue; // on ne compte que le fil principal
    const k = dayKey(e.created_at);
    if (!map.has(k)) map.set(k, { key: k, label: fmtDay(e.created_at), user: 0, claude: 0, first: e.created_at });
    const d = map.get(k);
    if (e.event_type === 'user') { const c = p.message && p.message.content; const isRem = typeof c === 'string' && c.trimStart().startsWith('<system-reminder>'); if (!isRem && !compactionSummary(p)) d.user++; }
    else d.claude++;
  }
  return [...map.values()].sort((a, b) => a.key < b.key ? -1 : 1);
}

// Markdown d'UNE journée : dialogue complet (toi + Claude), texte intégral, images et outils notés.
// Pensé pour être redonné à Claude afin qu'il réingère la journée entière après une compaction de mi-journée.
function buildDayMarkdown(sessionId, events, meta, key) {
  const day = events.filter(e => (e.event_type === 'user' || e.event_type === 'assistant') && dayKey(e.created_at) === key);
  const seqs = day.map(seqNum).filter(n => n !== null);
  const title = (meta && (meta.title || meta.name)) || sessionId;
  const label = day.length ? fmtDay(day[0].created_at) : key;
  const lines = [];
  lines.push(`# ${title} — journée du ${label}`, '', `Fuseau horaire : ${tzLabel()} (journée découpée dans ce fuseau ; horodatages bruts en UTC)`, '');
  lines.push(`> Extrait d'archive Cowork (session \`${sessionId}\`), **journée complète**, destiné à être redonné à Claude pour réingérer cette journée après une compaction de mi-journée. Texte intégral, rien n'est résumé.`, '');
  if (seqs.length) lines.push(`> Séquences #${Math.min(...seqs)} à #${Math.max(...seqs)}.`, '');
  lines.push('---', '');

  const toolNames = new Map();
  let imgN = 0;
  for (const e of day) {
    const p = e.payload || {};
    const when = fmtTime(e.created_at);
    const seq = seqNum(e);
    const agent = p.parent_tool_use_id ? ' (agent)' : '';
    if (e.event_type === 'user') {
      const cs = compactionSummary(p);
      if (cs) {
        lines.push(`### ⟢ RÉSUMÉ DE COMPACTION — contexte retenu par Claude (ce n'est PAS un message de l'utilisateur) — ${when} · #${seq}`, '', stripBinary(cs), '', '---', '');
        continue;
      }
      const content = p.message && p.message.content;
      const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : (Array.isArray(content) ? content : []);
      const texts = [], notes = [];
      for (const b of blocks) {
        if (!b) continue;
        if (b.type === 'text') { const t = cleanUserText(b.text); if (t) texts.push(t); }
        else if (b.type === 'image') { imgN++; notes.push(`(image envoyée — voir images/ dans l'archive)`); }
        else if (b.type === 'tool_result') { const n = toolNames.get(b.tool_use_id) || 'outil'; const c = typeof b.content === 'string' ? b.content : JSON.stringify(b.content); notes.push(`↩︎ résultat de ${n} : ${stripBinary(c)}`); }
      }
      for (const a of (p.file_attachments || [])) notes.push(`(pièce jointe : ${a.file_name}${a.is_image ? '' : ' — contenu non inclus'})`);
      if (texts.length || notes.length) {
        lines.push(`### Vous${agent} — ${when} · #${seq}`, '');
        if (texts.length) lines.push(texts.join('\n\n'), '');
        for (const n of notes) lines.push(`> ${n}`);
        if (notes.length) lines.push('');
      }
    } else {
      const msg = p.message || {};
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      const texts = [], acts = [];
      for (const b of blocks) {
        if (!b) continue;
        if (b.type === 'text') texts.push(b.text || '');
        else if (b.type === 'tool_use') { toolNames.set(b.id, b.name); acts.push(`🔧 ${b.name} — ${summarizeToolInput(b.name, b.input)}`); }
      }
      if (texts.length || acts.length) {
        lines.push(`### Claude${agent}${msg.model ? ' · ' + msg.model : ''} — ${when} · #${seq}`, '');
        if (texts.length) lines.push(texts.join('\n\n'), '');
        for (const a of acts) lines.push(`> ${a}`);
        if (acts.length) lines.push('');
      }
    }
  }
  return lines.join('\n');
}

async function buildTranscriptHtml(sessionId, meta) {
  let css = await fetchText('viewer.css');
  const js = await fetchText('viewer.js');
  const fonts = ['LibertinusSerif-Regular', 'LibertinusSerif-Bold', 'LibertinusSerif-Italic', 'LibertinusSerif-BoldItalic', 'FiraCode-Regular', 'FiraCode-Bold'];
  for (const f of fonts) {
    try { css = css.replace(`url("fonts/${f}.woff2")`, `url("data:font/woff2;base64,${await fetchB64('fonts/' + f + '.woff2')}")`); }
    catch (_) { /* police absente : la pile de secours prend le relais */ }
  }
  const title = (meta && (meta.title || meta.name)) || sessionId;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const summary = document.getElementById('summary').innerHTML;
  const conv = document.getElementById('conv').innerHTML;
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — archive Cowork</title>
<style>
${css}
</style>
</head>
<body class="mode-hr">
<div class="tbar"><div class="wrap">
  <h1>${esc(title)}</h1>
  <span class="tech">session ${esc(sessionId)} · archivé le ${esc(fmtFull(new Date().toISOString()))}</span>
  <span class="grow"></span>
  <button id="modeBtn" class="btn" data-mode="hr">Mode : lecture</button>
  <label><input type="checkbox" id="optTech"> événements techniques</label>
</div></div>
<div class="wrap"><div id="summary" style="display:block">${summary}</div></div>
<div id="conv">${conv}</div>
<script>
${js.replace(/<\/script>/g, '<\\/script>')}
Viewer.init('hr');
</script>
</body>
</html>`;
}

async function doZip() {
  const zipBtn = document.getElementById('zipBtn');
  zipBtn.disabled = true;
  const opts = {
    images: document.getElementById('optImages').checked,
    written: document.getElementById('optWritten').checked,
    transcript: document.getElementById('optTranscript').checked,
  };
  try {
    const { sessionId, events, meta, pages, cursorParam } = state;
    const seqs = events.map(seqNum).filter(n => n !== null);
    const zip = new JSZip();
    zip.file('events.json', JSON.stringify(events, null, 2));
    if (meta) zip.file('session.json', JSON.stringify(meta, null, 2));

    const counts = {};
    for (const e of events) counts[e.event_type] = (counts[e.event_type] || 0) + 1;

    const images = opts.images ? extractImages(events) : [];
    for (const im of images) zip.file(im.zipPath, im.bytes);
    if (opts.images) log(`${images.length} image(s) extraite(s).`, images.length ? 'ok' : '');

    const written = opts.written ? extractWrittenFiles(events) : [];
    for (const f of written) zip.file(f.zipPath, f.text);
    if (opts.written) log(`${written.length} fichier(s) écrit(s) par Claude reconstitué(s).`, written.length ? 'ok' : '');

    const referenced = extractReferencedFiles(events);
    const delivered = extractDeliveredFiles(events);
    if (opts.transcript) {
      zip.file('transcript.md', buildTranscript(sessionId, events, meta));
      try { zip.file('transcript.html', await buildTranscriptHtml(sessionId, meta)); log('transcript.html généré (aperçu autonome).', 'ok'); }
      catch (err) { log(`transcript.html non généré : ${err.message}`, 'warn'); }
    }

    const manifest = {
      archiver: 'Cowork Session Archiver 0.9.2',
      captured_at: new Date().toISOString(),
      display_timezone: tzLabel(),
      session_id: sessionId,
      endpoint: `${API_BASE}${sessionId}/events`,
      pagination_param_used: cursorParam,
      pages,
      event_count: events.length,
      sequence_range: [Math.min(...seqs), Math.max(...seqs)],
      missing_sequences: state.missing || [],
      events_by_type: counts,
      images: images.map(({ bytes, ...rest }) => ({ ...rest, bytes: bytes.length })),
      uploaded_files_referenced: referenced,
      files_delivered_by_claude: delivered,
      written_files: written.map(({ text, ...rest }) => ({ ...rest, chars: text.length })),
      notes: [
        'events.json = journal brut, intact, trié par sequence_num croissant.',
        'Les images envoyées sont embarquées en base64 dans events.json et extraites dans images/.',
        "Les fichiers non-image envoyés ne sont référencés que par nom et uuid : leur contenu n'est pas dans l'API events.",
        'Les blocs thinking sont vides côté serveur.',
        'transcript.html = le même aperçu que dans l\'extension, autonome (polices et images embarquées), mode lecture par défaut.',
      ],
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    log('Compression du ZIP…');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, m => setProgress(m.percent));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fname = `cowork-${sessionId}-${stamp}.zip`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setProgress(100);
    log(`Archive téléchargée : ${fname} (${(blob.size / 1024 / 1024).toFixed(1)} Mo)`, 'ok');
  } catch (err) {
    console.error(err);
    log(`Échec : ${err.message}`, 'err');
  } finally {
    zipBtn.disabled = false;
  }
}

function filterConvByDay(key) {
  const conv = document.getElementById('conv');
  let cur = null;
  for (const ch of conv.children) {
    if (ch.classList.contains('day')) { cur = ch.dataset.dayKey || null; ch.hidden = !(key === '' || cur === key); continue; }
    ch.hidden = !(key === '' || cur === key);
  }
}

async function doZipByDay() {
  const btn = document.getElementById('zipDayBtn');
  btn.disabled = true;
  try {
    const { sessionId, events, meta } = state;
    const days = state.days || listDays(events);
    const zip = new JSZip();

    // images et fichiers écrits regroupés par jour local
    const imgs = extractImages(events);
    const written = extractWrittenFiles(events);
    const imgByDay = {}, wrByDay = {};
    for (const im of imgs) (imgByDay[dayKey(im.created_at)] ||= []).push(im);
    for (const w of written) (wrByDay[dayKey(w.created_at)] ||= []).push(w);

    const idx = [`# ${(meta && (meta.title || meta.name)) || sessionId} — archive par jour`, '',
                 `Session \`${sessionId}\` · ${days.length} jour(s) · généré le ${fmtFull(new Date().toISOString())}`, '', '| Jour | Toi | Claude | Images | Fichiers |', '|---|---|---|---|---|'];

    for (const d of days) {
      const folder = `jours/${d.key}`;
      zip.file(`${folder}/${d.key}.md`, buildDayMarkdown(sessionId, events, meta, d.key));
      const di = imgByDay[d.key] || [];
      for (const im of di) zip.file(`${folder}/images/${im.zipPath.split('/').pop()}`, im.bytes);
      const dw = wrByDay[d.key] || [];
      for (const w of dw) zip.file(`${folder}/fichiers-ecrits/${w.zipPath.split('/').pop()}`, w.text);
      idx.push(`| [${d.label}](jours/${d.key}/${d.key}.md) | ${d.user} | ${d.claude} | ${di.length} | ${dw.length} |`);
    }

    zip.file('index.md', idx.join('\n'));
    zip.file('events.json', JSON.stringify(events, null, 2)); // preuve de vérité, linéaire, à la racine

    log('Compression du ZIP par jour…');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, m => setProgress(m.percent));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fname = `cowork-${sessionId}-par-jour-${stamp}.zip`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setProgress(100);
    log(`Archive par jour téléchargée : ${fname} — ${days.length} dossier(s) (${(blob.size / 1024 / 1024).toFixed(1)} Mo)`, 'ok');
  } catch (err) {
    console.error(err);
    log(`Échec (par jour) : ${err.message}`, 'err');
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const sessionId = new URLSearchParams(location.search).get('session') || '';
  ui.sid.textContent = sessionId || '(aucune)';
  Viewer.init('hr');
  if (!/^(cse|session)_[A-Za-z0-9]+$/.test(sessionId)) {
    log('Identifiant de session manquant ou invalide.', 'err');
    document.getElementById('fetchBtn').disabled = true;
    return;
  }
  state.sessionId = sessionId;
  document.getElementById('fetchBtn').addEventListener('click', doFetch);
  document.getElementById('zipBtn').addEventListener('click', doZip);
  const zipDayBtn = document.getElementById('zipDayBtn');
  if (zipDayBtn) zipDayBtn.addEventListener('click', doZipByDay);
  const daySelect = document.getElementById('daySelect');
  if (daySelect) daySelect.addEventListener('change', () => {
    const key = daySelect.value;
    filterConvByDay(key);
    document.getElementById('dayBtn').disabled = (key === '');
  });
  const dayBtn = document.getElementById('dayBtn');
  if (dayBtn) dayBtn.addEventListener('click', () => {
    if (!state.events) return;
    const key = document.getElementById('daySelect').value;
    if (!key) { log('Choisis d\'abord un jour dans le menu.', 'warn'); return; }
    const md = buildDayMarkdown(state.sessionId, state.events, state.meta, key);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `cowork-${state.sessionId}-jour-${key}.md`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    log(`Journée ${key} exportée en .md`, 'ok');
  });
});
