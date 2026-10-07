// Cowork Session Archiver — archive.js
// authors: 7hud41
// license: MIT
//
// Fetches the complete event log of a Cowork session (claude.ai/v1/code/sessions/{id}/events),
// keeps it raw, extracts the uploaded images, the files written by Claude and a readable transcript,
// then packs everything into a ZIP. Everything runs in the browser with the claude.ai session cookies.

const VERSION = '0.9.2';
const API_BASE = 'https://claude.ai/v1/code/sessions/';
const PAGE_LIMIT = 100;
const MAX_PAGES = 1000;

// Headers observed in the requests made by the claude.ai page. `anthropic-version` is mandatory
// (the API answers "anthropic-version: header is required" without it). The others are sent for safety.
const API_HEADERS = {
  'accept': 'application/json',
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'ccr-byoc-2025-07-29',
  'anthropic-client-feature': 'ccr',
  'anthropic-client-platform': 'web_claude_ai',
};

// Pagination parameter names tried in order. The first one that returns events older than
// the ones already received is kept for the whole session.
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
  try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || text.slice(0, 200);
    throw new Error(`HTTP ${res.status} — ${msg}`);
  }
  return json;
}

// ---------- Fetching every page ----------

async function fetchAllEvents(sessionId) {
  const base = `${API_BASE}${encodeURIComponent(sessionId)}/events?limit=${PAGE_LIMIT}`;
  const pages = [];
  const byId = new Map();

  log(t('Page 1: {url}', { url: base }));
  let page = await apiGet(base);
  if (!page || !Array.isArray(page.data)) throw new Error(t('Unexpected response: no "data" array.'));
  pages.push({ url: base, next_cursor: page.next_cursor, resume_cursor: page.resume_cursor, count: page.data.length });
  page.data.forEach(e => byId.set(e.event_id || e.uuid || JSON.stringify(e).slice(0, 80), e));
  log(t('  {n} events, next_cursor = {cursor}', { n: page.data.length, cursor: JSON.stringify(page.next_cursor) }));

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
      try { resp = await apiGet(url); } catch (err) { log(t('  parameter "{p}" rejected: {msg}', { p, msg: err.message }), 'warn'); continue; }
      const data = Array.isArray(resp && resp.data) ? resp.data : [];
      const newer = data.filter(e => !byId.has(e.event_id || e.uuid));
      const oldest = data.length ? Math.min(...data.map(seqNum).filter(n => n !== null)) : null;
      if (newer.length > 0 && oldest !== null && oldest < minSeq) {
        cursorParam = p;
        got = { url, resp, newer };
        break;
      }
      log(t('  parameter "{p}" ignored by the server (same events)', { p }), 'warn');
    }

    if (!got) {
      log(t('Cannot paginate past sequence {seq}: no cursor parameter accepted. The archive will be partial.', { seq: minSeq }), 'err');
      break;
    }

    pageNo++;
    got.newer.forEach(e => byId.set(e.event_id || e.uuid, e));
    pages.push({ url: got.url, next_cursor: got.resp.next_cursor, resume_cursor: got.resp.resume_cursor, count: got.resp.data.length });
    log(t('Page {page} ({param}={cursor}): {n} events, next_cursor = {next}', { page: pageNo, param: cursorParam, cursor, n: got.resp.data.length, next: JSON.stringify(got.resp.next_cursor) }));

    if (got.resp.next_cursor === cursor) { log(t('Same cursor as the previous page, stopping.'), 'warn'); break; }
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
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 150) || 'unnamed';
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
      files.push({ zipPath: `written-files/${name}`, text, sequence_num: seq, event_id: e.event_id, created_at: e.created_at, tool: block.name, original_path: path, tool_use_id: block.id });
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

// ---------- Readable transcript ----------

// Display time zone: the browser's by default; a host page may force one (window.DISPLAY_TZ, e.g. 'America/Toronto').
function TZ() { return (typeof window !== 'undefined' && window.DISPLAY_TZ) || undefined; }
function tzLabel() { return TZ() || Intl.DateTimeFormat().resolvedOptions().timeZone || t('browser time zone'); }
function fmtDate(iso) {
  try { return new Date(iso).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ() }); } catch (_) { return iso || ''; }
}

function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + ' […]' : s; }

// Replaces long base64 runs (images/PDFs returned by tools) with a short note.
function stripBinary(s) {
  return String(s == null ? '' : s).replace(/[A-Za-z0-9+/]{120,}={0,2}/g, m => t('[binary data ~{kb} KB omitted]', { kb: Math.round(m.length * 3 / 4 / 1024) }));
}

// Detects the "fake user message" injected at every compaction (the summary Claude writes for itself).
// Returns the summary text if it is one, else null.
function compactionSummary(p) {
  const c = p && p.message && p.message.content;
  let txt = null;
  if (typeof c === 'string') txt = c;
  else if (Array.isArray(c)) { const b = c.find(x => x && x.type === 'text'); txt = b && b.text; }
  if (txt && /^\s*This session is being continued from a previous conversation/.test(txt)) return txt;
  return null;
}

// Strips the technical blocks injected into user text (kept untouched in events.json).
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

const COMPACTION_HEADING = () => '⟢ ' + t('COMPACTION SUMMARY — context kept by Claude (this is NOT a message from the user)');

function buildTranscript(sessionId, events, meta) {
  const lines = [];
  const title = (meta && (meta.title || meta.name)) || sessionId;
  lines.push(`# ${title}`, '', t('Session: `{id}`', { id: sessionId }) + '  ', t('Archived on: {when}', { when: fmtDate(new Date().toISOString()) }) + '  ', t('Events: {n}', { n: events.length }) + '  ', t('Time zone of displayed times: {tz} (raw timestamps in events.json are UTC)', { tz: tzLabel() }), '', '---', '');

  const toolNames = new Map();
  let imgCounter = 0;

  for (const e of events) {
    const et = e.event_type;
    const p = e.payload || {};
    const seq = seqNum(e);
    const when = fmtDate(e.created_at);

    if (et === 'user') {
      const cs = compactionSummary(p);
      if (cs) {
        lines.push(`## ${COMPACTION_HEADING()} — ${when} · #${seq}`, '', stripBinary(cs), '', '---', '');
        continue;
      }
      const content = p.message && p.message.content;
      if (typeof content === 'string') {
        if (content.trimStart().startsWith('<system-reminder>')) {
          lines.push(`> _[${when} · #${seq}] ${t('injected system reminder (see events.json)')}_`, '');
        } else {
          lines.push(`## ${t('You')} — ${when} · #${seq}`, '', cleanUserText(content), '');
        }
      } else if (Array.isArray(content)) {
        const texts = [], notes = [];
        for (const b of content) {
          if (!b) continue;
          if (b.type === 'text') { const ct = cleanUserText(b.text); if (ct) texts.push(ct); }
          else if (b.type === 'image') { imgCounter++; notes.push(t('[uploaded image #{n}]', { n: imgCounter })); }
          else if (b.type === 'tool_result') {
            const toolName = toolNames.get(b.tool_use_id) || t('tool');
            const c = stripBinary(typeof b.content === 'string' ? b.content : JSON.stringify(b.content));
            notes.push('↩︎ ' + t('result of {tool}: {text}', { tool: toolName, text: truncate(c.replace(/\s+/g, ' '), 300) }));
          } else if (b.type === 'document') notes.push(t('[attached document]'));
          else notes.push(t('[{type} block]', { type: b.type }));
        }
        if (texts.length) lines.push(`## ${t('You')} — ${when} · #${seq}`, '', ...texts, '');
        if (notes.length) { for (const n of notes) lines.push(`> ${n}`); lines.push(''); }
        const atts = p.file_attachments || [];
        if (atts.length) { for (const a of atts) lines.push(`> ${t('attachment: {name} ({kind})', { name: a.file_name, kind: a.is_image ? t('image') : t('file') })}`); lines.push(''); }
      }
    } else if (et === 'assistant') {
      const msg = p.message || {};
      const content = Array.isArray(msg.content) ? msg.content : [];
      const texts = [], acts = [];
      for (const b of content) {
        if (!b) continue;
        if (b.type === 'text') texts.push(b.text || '');
        else if (b.type === 'tool_use') { toolNames.set(b.id, b.name); acts.push(`🔧 ${b.name} — ${summarizeToolInput(b.name, b.input)}`); }
        else if (b.type === 'thinking') { /* empty server-side: nothing to show */ }
        else acts.push(t('[{type} block]', { type: b.type }));
      }
      if (texts.length) lines.push(`## ${t('Claude')}${msg.model ? ' (' + msg.model + ')' : ''} — ${when} · #${seq}`, '', ...texts, '');
      if (acts.length) { for (const a of acts) lines.push(`> ${a}`); lines.push(''); }
    } else if (et === 'result') {
      const cost = turnCost(p);
      const dur = p.duration_ms ? Math.round(p.duration_ms / 1000) + ' s' : '';
      lines.push(`> _${t('end of turn')} · ${dur}${cost !== null ? ' · ' + cost.toFixed(3) + ' $' : ''}${p.is_error ? ' · ' + t('ERROR') : ''}_`, '');
    } else if (et === 'system' && p.subtype === 'init') {
      lines.push(`> _[${when}] ${t('environment started')}${p.model ? ' · ' + t('model') + ' ' + p.model : ''}_`, '');
    }
  }
  lines.push('---', '', `_${t('Reasoning (thinking) blocks are empty in the API and cannot be archived. The complete raw log is in events.json.')}_`);
  return lines.join('\n');
}

// Cost of a turn: cloud sessions expose modelUsage, local audit logs expose total_cost_usd.
function turnCost(p) {
  if (p.modelUsage) return Object.values(p.modelUsage).reduce((s, m) => s + (m.costUSD || 0), 0);
  return typeof p.total_cost_usd === 'number' ? p.total_cost_usd : null;
}

// ---------- Preview (DOM rendering, no innerHTML on content) ----------

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', timeZone: TZ() }); } catch (_) { return ''; }
}
function fmtDay(iso) {
  try { return new Date(iso).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ() }); } catch (_) { return ''; }
}
function fmtDuration(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

// Minimal, safe inline Markdown (text is inserted through textContent).
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
    case 'Write': return t('writes file {path}', { path: s(input.file_path) });
    case 'Edit': return t('edits file {path}', { path: s(input.file_path) });
    case 'Read': return t('reads {path}', { path: s(input.file_path) });
    case 'Bash': return input.description ? s(input.description) : t('runs {cmd}', { cmd: s(input.command) });
    case 'Glob': case 'Grep': return t('searches {pattern}', { pattern: s(input.pattern) }) + (input.path ? t(' in {path}', { path: s(input.path) }) : '');
    case 'WebSearch': return t('web search “{q}”', { q: s(input.query) });
    case 'WebFetch': return t('reads page {url}', { url: s(input.url) });
    case 'Projects': return t('Project · {method}', { method: s(input.method) }) + (input.path ? ' · ' + s(input.path) : '');
    case 'SendUserFile': return t('sends {files}', { files: Array.isArray(input.files) ? input.files.map(f => String(f).split('/').pop()).join(', ') : '' });
    case 'Agent': case 'Task': return t('starts an agent{type}: {desc}', { type: input.subagent_type ? ' ' + s(input.subagent_type) : '', desc: s(input.description || input.prompt) });
    case 'AskUserQuestion': return t('asks a question');
    case 'TaskCreate': return t('task: {subject}', { subject: s(input.subject) });
    case 'TaskUpdate': return t('task #{id} → {status}', { id: s(input.taskId), status: s(input.status || t('updated')) });
    case 'Skill': return t('loads skill {skill}', { skill: s(input.skill) });
    case 'ToolSearch': return t('loads tools ({q})', { q: s(input.query) });
    default: return summarizeToolInput(name, input);
  }
}

function fmtFull(iso) {
  try {
    const d = new Date(iso);
    const day = d.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'short', year: '2-digit', timeZone: TZ() });
    const time = d.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', timeZone: TZ() });
    return t('{day} at {time}', { day, time });
  } catch (_) { return iso || ''; }
}
function fmtBytes(n) { if (!n && n !== 0) return ''; return n < 1024 ? `${n} ${t('B')}` : n < 1048576 ? `${(n / 1024).toFixed(0)} ${t('KB')}` : `${(n / 1048576).toFixed(1)} ${t('MB')}`; }
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
    case 'Write': return t('file created');
    case 'Edit': return t('file edited');
    case 'Read': return t('file read');
    case 'Bash': return t('command run');
    case 'Glob': case 'Grep': return t('file search');
    case 'WebSearch': return t('web search');
    case 'WebFetch': return t('web page read');
    case 'Projects': return /write|create|update|delete/i.test(input.method || '') ? t('project updated') : t('project read');
    case 'SendUserFile': return t('file shared');
    case 'Agent': case 'Task': return t('agent started');
    case 'AskUserQuestion': return t('question asked');
    case 'TaskCreate': case 'TaskUpdate': return t('task list');
    case 'Skill': return t('skill loaded');
    case 'ToolSearch': return t('tools loaded');
    default: return String(name).startsWith('mcp__') ? t('connector {name}', { name: String(name).split('__')[1] }) : name;
  }
}

function dateSpans(iso) {
  // Full mode: whole date. Reading mode: time only, the full date as a tooltip (the day separator already gives it).
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
  let kind = t('File');
  if (mt.startsWith('image/')) kind = t('Image');
  else if (['MD', 'TXT', 'DOCX', 'DOC', 'RTF', 'PDF', 'HTML', 'ODT'].includes(ext) || mt.startsWith('text/') || mt.includes('pdf') || mt.includes('word')) kind = t('Document');
  else if (['CSV', 'XLSX', 'XLS', 'TSV', 'ODS'].includes(ext) || mt.includes('sheet') || mt.includes('csv')) kind = t('Spreadsheet');
  else if (['PPTX', 'PPT', 'KEY'].includes(ext) || mt.includes('presentation')) kind = t('Presentation');
  else if (['ZIP', 'TAR', 'GZ', '7Z'].includes(ext) || mt.includes('zip')) kind = t('Archive');
  else if (['JS', 'PY', 'TS', 'JSON', 'SH', 'CSS', 'YAML', 'YML', 'TOML'].includes(ext)) kind = t('Code');
  else if (mt.startsWith('audio/')) kind = t('Audio');
  else if (mt.startsWith('video/')) kind = t('Video');
  return `${kind}${ext ? ' · ' + ext : ''}`;
}

function fileCard(name, mediaType, metaLines) {
  const card = el('div', 'filecard');
  const icon = el('div', 'ficon'); icon.appendChild(el('div', 'fpage')); icon.appendChild(el('div', 'fpage back'));
  const body = el('div', 'fbody');
  const stem = String(name || '').replace(/\.[A-Za-z0-9]+$/, '') || t('(unnamed)');
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
  let currentBlock = null;       // activity block in progress (timeline)
  const pendingFiles = new Map(); // container -> [delivered file cards waiting for the next Claude message]
  const lastClaude = new Map();   // container -> last rendered Claude bubble
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

  // An activity block = summary header + vertical timeline of actions + shared file cards
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
    block.headText.textContent = label ? label.charAt(0).toUpperCase() + label.slice(1) : t('Activity');
    block.count.textContent = t('{n} action(s)', { n: block.cats.length });
  };

  const containerFor = (parentToolUseId) => {
    const parent = parentToolUseId && toolIndex.get(parentToolUseId);
    if (!parent) return { container: conv, isAgent: false, parent: null };
    if (!parent.agentBox) {
      parent.agentBox = el('div', 'agent');
      parent.agentBox.appendChild(el('div', 'label', t('Agent activity')));
      parent.body.appendChild(parent.agentBox);
      parent.item.open = true;
    }
    return { container: parent.agentBox, isAgent: true, parent };
  };

  const YOU = t('You'), TO_AGENT = t('Message to the agent');

  for (const e of events) {
    const et = e.event_type;
    const p = e.payload || {};
    const parentId = p.parent_tool_use_id || null;
    const when = fmtFull(e.created_at);
    const seq = seqNum(e);

    if (et === 'user') {
      const content = p.message && p.message.content;
      const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : (Array.isArray(content) ? content : []);
      const isReminder = blocks.length && blocks.every(b => b.type === 'text' && String(b.text || '').trimStart().startsWith('<system-reminder>'));
      if (isReminder) { conv.appendChild(el('div', 'sys', `${when} · ${t('injected system reminder')} (#${seq})`)); continue; }
      const cs = compactionSummary(p);
      if (cs) {
        dayMarker(e);
        const det = el('details', 'compact-summary');
        const sm = el('summary');
        sm.appendChild(el('span', 'cs-badge', '⟢ ' + t('Compaction summary')));
        sm.appendChild(el('span', 'cs-note', ` ${t('context kept by Claude — this is NOT a message from the user')} · ${when} · #${seq}`));
        det.appendChild(sm);
        det.appendChild(renderMarkdown(stripBinary(cs)));
        conv.appendChild(det);
        compactSeen++;
        continue;
      }

      const toolResults = blocks.filter(b => b.type === 'tool_result');
      let others = blocks.filter(b => b.type !== 'tool_result');
      // Message reduced to injected technical notes (e.g. "[Image: original …]"): shown as a technical event
      const onlyText = others.length && others.every(b => b.type === 'text');
      if (onlyText && !(p.file_attachments || []).length && others.every(b => !cleanUserText(b.text))) {
        conv.appendChild(el('div', 'sys', `${when} · ${t('injected technical note')} (#${seq})`)); others = [];
      }

      for (const b of toolResults) {
        const ref = toolIndex.get(b.tool_use_id);
        const c = stripBinary(typeof b.content === 'string' ? b.content : (Array.isArray(b.content) ? b.content.map(x => x.text || `[${x.type}]`).join('\n') : JSON.stringify(b.content)));
        const r = el('div', 'result' + (b.is_error ? ' error' : ''));
        r.appendChild(el('span', 'rlabel', (b.is_error ? t('✗ result (error) · ') : t('✓ result · ')) + when));
        r.appendChild(el('pre', '', c));
        if (ref) {
          ref.body.appendChild(r);
          const tr = p.tool_use_result;
          if (tr && Array.isArray(tr.attachments)) {
            const cont = ref.block.node.parentNode;
            for (const a of tr.attachments) {
              queueFile(cont, fileCard(String(a.path || '').split('/').pop(), a.media_type, [t('shared on {when}', { when }), a.media_type || '', fmtBytes(a.size), tr.caption ? `“${tr.caption}”` : '', a.file_uuid ? `uuid ${a.file_uuid}` : '']));
            }
          }
        } else {
          const { container } = containerFor(parentId);
          const d = el('details', 'orphan'); d.appendChild(el('summary', '', t('tool result without a matching call · {when}', { when }))); d.appendChild(r); container.appendChild(d);
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
            card.appendChild(whoLine(isAgent ? TO_AGENT : YOU, e.created_at, [`#${seq}`, a && a.file_uuid ? 'uuid ' + a.file_uuid : '']));
            const img = el('img', 'att'); img.src = `data:${b.source.media_type};base64,${b.source.data}`; img.title = `${(a && a.file_name) || t('image {n}', { n: imgCount })} — ${when}`;
            card.appendChild(img);
            const am = el('div', 'attmeta', (a && a.file_name) || t('image {n}', { n: imgCount }));
            am.appendChild(el('span', 'tech', ` · ${b.source.media_type} · ${fmtBytes(Math.round(b.source.data.length * 3 / 4))}`));
            card.appendChild(am);
            row.appendChild(card);
          } else col.appendChild(el('span', 'chip', t('{type} block', { type: b.type })));
        }
        for (const a of atts.filter(a => !a.is_image)) {
          const card = el('div', 'attcard file');
          card.appendChild(whoLine(isAgent ? TO_AGENT : YOU, e.created_at, [`#${seq}`, a.file_uuid ? 'uuid ' + a.file_uuid : '', t('content not included in the API')]));
          card.appendChild(el('div', 'fname', a.file_name || t('(unnamed)')));
          card.appendChild(el('span', 'badge', extOf(a.file_name) || t('FILE')));
          row.appendChild(card);
        }
        if (row.childElementCount) col.appendChild(row);
        if (textParts.length) {
          const m = el('div', 'msg user');
          m.appendChild(whoLine(isAgent ? TO_AGENT : YOU, e.created_at, [`#${seq}`, p.client_platform || '']));
          for (const tp of textParts) m.appendChild(renderMarkdown(tp));
          col.appendChild(m);
        }
        container.appendChild(col);
        if (!parentId) userCount++;
      }
    }

    else if (et === 'assistant') {
      const msg = p.message || {};
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      const texts = blocks.filter(b => b.type === 'text' && (b.text || '').trim());
      const tools = blocks.filter(b => b.type === 'tool_use');
      const { container, isAgent } = containerFor(parentId);
      if (texts.length) {
        currentBlock = null;
        if (!parentId) dayMarker(e);
        const m = el('div', 'msg claude');
        m.appendChild(whoLine(isAgent ? t('Agent') : t('Claude'), e.created_at, [`#${seq}`, msg.model || '', msg.usage && msg.usage.output_tokens ? msg.usage.output_tokens + ' tokens' : '']));
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
        body.appendChild(el('div', 'rlabel', t('parameters · id {id} · #{seq}', { id: b.id, seq })));
        body.appendChild(el('pre', '', JSON.stringify(b.input, null, 2)));
        item.appendChild(body);
        block.list.appendChild(item);
        block.cats.push(toolCategory(b.name, b.input));
        refreshHead(block);
        toolIndex.set(b.id, { name: b.name, item, body, block, agentBox: null });
      }
    }

    else if (et === 'result') {
      turnCount++;
      for (const c of pendingFiles.keys()) flushFiles(c);
      currentBlock = null;
      const cost = turnCost(p);
      const bits = [t('end of turn {n}', { n: turnCount }), when, fmtDuration(p.duration_ms)];
      if (p.is_error) bits.push(t('ERROR'));
      const techBits = [];
      if (cost !== null) techBits.push(cost.toFixed(3) + ' $');
      if (p.num_turns) techBits.push(t('{n} internal exchange(s)', { n: p.num_turns }));
      if (p.permission_denials && p.permission_denials.length) techBits.push(t('{n} permission(s) denied', { n: p.permission_denials.length }));
      const tn = el('div', 'turn', '— ' + bits.filter(Boolean).join(' · '));
      if (techBits.length) tn.appendChild(el('span', 'tech', ' · ' + techBits.join(' · ')));
      tn.appendChild(document.createTextNode(' —'));
      conv.appendChild(tn);
    }

    else if (et === 'system') {
      if (p.subtype === 'thinking_tokens') continue; // token counters: noise without archival value (kept in the raw log)
      if (p.subtype === 'init') conv.appendChild(el('div', 'sys', `${when} · ${t('environment started')}${p.model ? ' · ' + p.model : ''}`));
      else if (p.subtype === 'post_turn_summary' && p.summary) conv.appendChild(el('div', 'sys', `${when} · ${t('turn summary: {text}', { text: truncate(p.summary, 160) })}`));
      else conv.appendChild(el('div', 'sys', `${when} · ${t('system')} · ${p.subtype || ''}${p.hook_name ? ' · ' + p.hook_name : ''}`));
    }
    else if (et === 'env_manager_log') conv.appendChild(el('div', 'sys', `${when} · ${t('environment')} · ${(p.data && p.data.content) || ''}`));
    else if (et === 'prompt_suggestion') conv.appendChild(el('div', 'sys', `${when} · ${t('suggested prompt: “{text}”', { text: truncate(p.suggestion || '', 120) })}`));
    else conv.appendChild(el('div', 'sys', `${when} · ${et}`));
  }

  for (const c of pendingFiles.keys()) flushFiles(c);

  // Summary
  const seqs = events.map(seqNum).filter(n => n !== null);
  const sm = document.getElementById('summary');
  sm.textContent = '';
  const dl = el('dl');
  const row = (k, v) => { dl.appendChild(el('dt', '', k)); dl.appendChild(el('dd', '', v)); };
  const title = meta && (meta.title || meta.name);
  if (title) row(t('Title'), title);
  row(t('Period'), events.length ? `${fmtFull(events[0].created_at)} → ${fmtFull(events[events.length - 1].created_at)}` : '—');
  if (TZ()) row(t('Time zone'), t('times shown in {tz} (raw timestamps in UTC)', { tz: TZ() }));
  row(t('Events'), t('{n} (sequences {min} → {max})', { n: events.length, min: Math.min(...seqs), max: Math.max(...seqs) }));
  row(t('Messages'), t('{user} from you · {claude} from Claude · {turns} turns', { user: userCount, claude: claudeCount, turns: turnCount }));
  row(t('Activity'), t('{tools} tool call(s) · {images} uploaded image(s)', { tools: toolCount, images: imgCount }));
  if (compactSeen) row(t('Compactions'), t('{n} compaction summary(ies) found', { n: compactSeen }));
  sm.appendChild(dl);
  sm.style.display = 'block';
  return { imgCount, toolCount, turnCount, userCount, claudeCount };
}

// ---------- Orchestration ----------

const state = { sessionId: null, events: null, meta: null, pages: null, cursorParam: null };

// Fills the day selector and enables the day-related buttons after a preview was rendered.
function populateDaySelect(events) {
  const days = listDays(events);
  state.days = days;
  const sel = document.getElementById('daySelect');
  if (!sel) return days;
  sel.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = ''; ph.textContent = t('Pick a day…  (show all)');
  sel.appendChild(ph);
  for (const d of days) {
    const o = document.createElement('option');
    o.value = d.key; o.textContent = t('{label} — {user} from you, {claude} from Claude', { label: d.label, user: d.user, claude: d.claude });
    sel.appendChild(o);
  }
  sel.value = '';
  document.getElementById('dayExport').hidden = false;
  document.getElementById('dayBtn').disabled = true;
  document.getElementById('zipDayBtn').disabled = days.length === 0;
  return days;
}

async function doFetch() {
  const fetchBtn = document.getElementById('fetchBtn'), zipBtn = document.getElementById('zipBtn');
  fetchBtn.disabled = true; zipBtn.disabled = true;
  ui.log.textContent = '';
  setProgress(2);
  try {
    state.meta = null;
    try { state.meta = await apiGet(`${API_BASE}${encodeURIComponent(state.sessionId)}`); log(t('Session metadata fetched.'), 'ok'); }
    catch (err) { log(t('Session metadata unavailable ({msg}) — continuing.', { msg: err.message }), 'warn'); }
    setProgress(8);

    const { events, pages, cursorParam } = await fetchAllEvents(state.sessionId);
    state.events = events; state.pages = pages; state.cursorParam = cursorParam;
    const seqs = events.map(seqNum).filter(n => n !== null);
    log(t('Total: {n} events, sequences {min} → {max}.', { n: events.length, min: Math.min(...seqs), max: Math.max(...seqs) }), 'ok');
    const seqSet = new Set(seqs);
    state.missing = [];
    for (let s = Math.min(...seqs); s <= Math.max(...seqs); s++) if (!seqSet.has(s)) state.missing.push(s);
    if (state.missing.length) log(t('Missing sequences: {list}', { list: state.missing.slice(0, 30).join(', ') + (state.missing.length > 30 ? '…' : '') }), 'warn');
    if (Math.min(...seqs) > 1) log(t('The oldest sequence received is {min} (not 1): check that the preview starts at the beginning.', { min: Math.min(...seqs) }), 'warn');
    setProgress(85);

    const stats = renderPreview(state);
    Viewer.setMode(document.getElementById('modeBtn').dataset.mode || 'hr');
    populateDaySelect(events);
    log(t('Preview ready: {user} messages from you, {claude} from Claude, {tools} tool calls, {images} images. Check it, then download the ZIP.', { user: stats.userCount, claude: stats.claudeCount, tools: stats.toolCount, images: stats.imgCount }), 'ok');
    setProgress(100);
    zipBtn.disabled = false;
  } catch (err) {
    console.error(err);
    log(t('Failed: {msg}', { msg: err.message }), 'err');
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

// Local day key (YYYY-MM-DD) in the display time zone.
function dayKey(iso) {
  try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ() }); } catch (_) { return (iso || '').slice(0, 10); }
}

// Days present in the log, with a readable label and message counts.
function listDays(events) {
  const map = new Map();
  for (const e of events) {
    if (e.event_type !== 'user' && e.event_type !== 'assistant') continue;
    const p = e.payload || {};
    if (p.parent_tool_use_id) continue; // only the main thread is counted
    const k = dayKey(e.created_at);
    if (!map.has(k)) map.set(k, { key: k, label: fmtDay(e.created_at), user: 0, claude: 0, first: e.created_at });
    const d = map.get(k);
    if (e.event_type === 'user') { const c = p.message && p.message.content; const isRem = typeof c === 'string' && c.trimStart().startsWith('<system-reminder>'); if (!isRem && !compactionSummary(p)) d.user++; }
    else d.claude++;
  }
  return [...map.values()].sort((a, b) => a.key < b.key ? -1 : 1);
}

// Markdown of ONE day: full dialogue (you + Claude), full text, images and tools noted.
// Meant to be fed back to Claude so it can re-ingest the whole day after a mid-day compaction.
function buildDayMarkdown(sessionId, events, meta, key) {
  const day = events.filter(e => (e.event_type === 'user' || e.event_type === 'assistant') && dayKey(e.created_at) === key);
  const seqs = day.map(seqNum).filter(n => n !== null);
  const title = (meta && (meta.title || meta.name)) || sessionId;
  const label = day.length ? fmtDay(day[0].created_at) : key;
  const lines = [];
  lines.push(`# ${t('{title} — day {label}', { title, label })}`, '', t('Time zone: {tz} (days are split in this zone; raw timestamps in UTC)', { tz: tzLabel() }), '');
  lines.push(`> ${t('Cowork archive extract (session `{id}`), **full day**, meant to be fed back to Claude to re-ingest this day after a mid-day compaction. Full text, nothing is summarised.', { id: sessionId })}`, '');
  if (seqs.length) lines.push(`> ${t('Sequences #{min} to #{max}.', { min: Math.min(...seqs), max: Math.max(...seqs) })}`, '');
  lines.push('---', '');

  const toolNames = new Map();
  let imgN = 0;
  for (const e of day) {
    const p = e.payload || {};
    const when = fmtTime(e.created_at);
    const seq = seqNum(e);
    const agent = p.parent_tool_use_id ? ' (' + t('agent').toLowerCase() + ')' : '';
    if (e.event_type === 'user') {
      const cs = compactionSummary(p);
      if (cs) {
        lines.push(`### ${COMPACTION_HEADING()} — ${when} · #${seq}`, '', stripBinary(cs), '', '---', '');
        continue;
      }
      const content = p.message && p.message.content;
      const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : (Array.isArray(content) ? content : []);
      const texts = [], notes = [];
      for (const b of blocks) {
        if (!b) continue;
        if (b.type === 'text') { const tx = cleanUserText(b.text); if (tx) texts.push(tx); }
        else if (b.type === 'image') { imgN++; notes.push(t('(uploaded image — see images/ in the archive)')); }
        else if (b.type === 'tool_result') { const n = toolNames.get(b.tool_use_id) || t('tool'); const c = typeof b.content === 'string' ? b.content : JSON.stringify(b.content); notes.push('↩︎ ' + t('result of {tool}: {text}', { tool: n, text: stripBinary(c) })); }
      }
      for (const a of (p.file_attachments || [])) notes.push(t('(attachment: {name}{note})', { name: a.file_name, note: a.is_image ? '' : t(' — content not included') }));
      if (texts.length || notes.length) {
        lines.push(`### ${t('You')}${agent} — ${when} · #${seq}`, '');
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
        lines.push(`### ${t('Claude')}${agent}${msg.model ? ' · ' + msg.model : ''} — ${when} · #${seq}`, '');
        if (texts.length) lines.push(texts.join('\n\n'), '');
        for (const a of acts) lines.push(`> ${a}`);
        if (acts.length) lines.push('');
      }
    }
  }
  return lines.join('\n');
}

// Builds transcript.html: same preview, same functions, embedded fonts, reading mode by default.
async function buildTranscriptHtml(sessionId, meta) {
  let css = await fetchText('viewer.css');
  const js = await fetchText('viewer.js');
  const fonts = ['LibertinusSerif-Regular', 'LibertinusSerif-Bold', 'LibertinusSerif-Italic', 'LibertinusSerif-BoldItalic', 'FiraCode-Regular', 'FiraCode-Bold'];
  for (const f of fonts) {
    try { css = css.replace(`url("fonts/${f}.woff2")`, `url("data:font/woff2;base64,${await fetchB64('fonts/' + f + '.woff2')}")`); }
    catch (_) { /* missing font: the fallback stack takes over */ }
  }
  const title = (meta && (meta.title || meta.name)) || sessionId;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const summary = document.getElementById('summary').innerHTML;
  const conv = document.getElementById('conv').innerHTML;
  return `<!DOCTYPE html>
<html lang="${currentLang()}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ${esc(t('Cowork archive'))}</title>
<style>
${css}
</style>
</head>
<body class="mode-hr">
<div class="tbar"><div class="wrap">
  <h1>${esc(title)}</h1>
  <span class="tech">${esc(t('session'))} ${esc(sessionId)} · ${esc(t('archived on'))} ${esc(fmtFull(new Date().toISOString()))}</span>
  <span class="grow"></span>
  <button id="modeBtn" class="btn" data-mode="hr" data-label-hr="${esc(t('Mode: reading'))}" data-label-full="${esc(t('Mode: full details'))}">${esc(t('Mode: reading'))}</button>
  <label><input type="checkbox" id="optTech"> ${esc(t('technical events'))}</label>
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

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
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
    if (opts.images) log(t('{n} image(s) extracted.', { n: images.length }), images.length ? 'ok' : '');

    const written = opts.written ? extractWrittenFiles(events) : [];
    for (const f of written) zip.file(f.zipPath, f.text);
    if (opts.written) log(t('{n} file(s) written by Claude rebuilt.', { n: written.length }), written.length ? 'ok' : '');

    const referenced = extractReferencedFiles(events);
    const delivered = extractDeliveredFiles(events);
    if (opts.transcript) {
      zip.file('transcript.md', buildTranscript(sessionId, events, meta));
      try { zip.file('transcript.html', await buildTranscriptHtml(sessionId, meta)); log(t('transcript.html generated (standalone preview).'), 'ok'); }
      catch (err) { log(t('transcript.html not generated: {msg}', { msg: err.message }), 'warn'); }
    }

    // Host pages (local viewer) can add their own files before the manifest is written.
    if (typeof window.ARCHIVE_EXTRA === 'function') await window.ARCHIVE_EXTRA(zip);

    const manifest = {
      archiver: `Cowork Session Archiver ${VERSION}`,
      captured_at: new Date().toISOString(),
      display_timezone: tzLabel(),
      language: currentLang(),
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
        t('events.json = raw log, untouched, sorted by ascending sequence_num.'),
        t('Uploaded images are embedded as base64 in events.json and extracted into images/.'),
        t('Non-image uploads are only referenced by name and uuid: their content is not in the events API.'),
        t('Thinking blocks are empty server-side.'),
        t('transcript.html = the same preview as in the extension, standalone (fonts and images embedded), reading mode by default.'),
      ],
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    log(t('Compressing ZIP…'));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, m => setProgress(m.percent));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fname = `cowork-${sessionId}-${stamp}.zip`;
    download(blob, fname);
    setProgress(100);
    log(t('Archive downloaded: {name} ({size} MB)', { name: fname, size: (blob.size / 1024 / 1024).toFixed(1) }), 'ok');
  } catch (err) {
    console.error(err);
    log(t('Failed: {msg}', { msg: err.message }), 'err');
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

    // images and written files grouped by local day
    const imgs = extractImages(events);
    const written = extractWrittenFiles(events);
    const imgByDay = {}, wrByDay = {};
    for (const im of imgs) (imgByDay[dayKey(im.created_at)] ||= []).push(im);
    for (const w of written) (wrByDay[dayKey(w.created_at)] ||= []).push(w);

    const idx = [`# ${t('{title} — archive by day', { title: (meta && (meta.title || meta.name)) || sessionId })}`, '',
                 t('Session `{id}` · {n} day(s) · generated on {when}', { id: sessionId, n: days.length, when: fmtFull(new Date().toISOString()) }), '', t('| Day | You | Claude | Images | Files |'), '|---|---|---|---|---|'];

    for (const d of days) {
      const folder = `days/${d.key}`;
      zip.file(`${folder}/${d.key}.md`, buildDayMarkdown(sessionId, events, meta, d.key));
      const di = imgByDay[d.key] || [];
      for (const im of di) zip.file(`${folder}/images/${im.zipPath.split('/').pop()}`, im.bytes);
      const dw = wrByDay[d.key] || [];
      for (const w of dw) zip.file(`${folder}/written-files/${w.zipPath.split('/').pop()}`, w.text);
      idx.push(`| [${d.label}](days/${d.key}/${d.key}.md) | ${d.user} | ${d.claude} | ${di.length} | ${dw.length} |`);
    }

    zip.file('index.md', idx.join('\n'));
    zip.file('events.json', JSON.stringify(events, null, 2)); // source of truth, linear, at the root

    log(t('Compressing the by-day ZIP…'));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, m => setProgress(m.percent));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fname = `cowork-${sessionId}-by-day-${stamp}.zip`;
    download(blob, fname);
    setProgress(100);
    log(t('By-day archive downloaded: {name} — {n} folder(s) ({size} MB)', { name: fname, n: days.length, size: (blob.size / 1024 / 1024).toFixed(1) }), 'ok');
  } catch (err) {
    console.error(err);
    log(t('Failed (by day): {msg}', { msg: err.message }), 'err');
  } finally {
    btn.disabled = false;
  }
}

// Shared wiring for the day selector and the day export button (used by the extension page and the local viewer).
function wireDayControls() {
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
    if (!key) { log(t('Pick a day in the menu first.'), 'warn'); return; }
    const md = buildDayMarkdown(state.sessionId, state.events, state.meta, key);
    download(new Blob([md], { type: 'text/markdown' }), `cowork-${state.sessionId}-day-${key}.md`);
    log(t('Day {key} exported as .md', { key }), 'ok');
  });
}

// Re-renders the preview in the current language (called by the language selector).
function rerenderForLang() {
  if (!state.events) return;
  const mode = document.getElementById('modeBtn').dataset.mode || 'hr';
  renderPreview(state);
  Viewer.setMode(mode);
  populateDaySelect(state.events);
}

if (typeof window !== 'undefined' && !window.ARCHIVE_HOST) {
  document.addEventListener('DOMContentLoaded', () => {
    initLang();
    const sessionId = new URLSearchParams(location.search).get('session') || '';
    ui.sid.textContent = sessionId || t('(none)');
    Viewer.init('hr');
    window.onLangChange = () => { ui.sid.textContent = sessionId || t('(none)'); Viewer.setMode(document.getElementById('modeBtn').dataset.mode || 'hr'); rerenderForLang(); };
    if (!/^(cse|session)_[A-Za-z0-9]+$/.test(sessionId)) {
      log(t('Missing or invalid session id.'), 'err');
      document.getElementById('fetchBtn').disabled = true;
      return;
    }
    state.sessionId = sessionId;
    document.getElementById('fetchBtn').addEventListener('click', doFetch);
    document.getElementById('zipBtn').addEventListener('click', doZip);
    const zipDayBtn = document.getElementById('zipDayBtn');
    if (zipDayBtn) zipDayBtn.addEventListener('click', doZipByDay);
    wireDayControls();
  });
}
