// Synthetic fixtures for the end-to-end tests — nothing here comes from a real conversation.
// authors: 7hud41 · license: MIT
const fs = require('fs'); const path = require('path'); const zlib = require('zlib');

// Smallest valid PNG (1×1, opaque orange), generated here so no binary file is committed.
function tinyPng() {
  const crcTable = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.from([0, 0xc9, 0x64, 0x42]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const T0 = Date.UTC(2026, 0, 10, 14, 0, 0); // 2026-01-10 14:00 UTC
const at = min => new Date(T0 + min * 60000).toISOString();

// Cloud-style event log, as returned by the sessions/{id}/events endpoint (already sorted ascending).
function cloudEvents() {
  const png = tinyPng().toString('base64');
  let seq = 0; const ev = (type, payload, min) => ({ event_id: 'ev' + (++seq), event_type: type, sequence_num: String(seq), created_at: at(min), source: type === 'user' ? 'client' : 'worker', payload });
  return [
    ev('system', { subtype: 'init', model: 'test-model' }, 0),
    ev('user', { message: { role: 'user', content: [{ type: 'text', text: 'Hello, can you look at this picture?' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }] }, file_attachments: [{ file_name: 'sample.png', file_uuid: 'uuid-1', is_image: true }] }, 1),
    ev('assistant', { message: { role: 'assistant', model: 'test-model', content: [{ type: 'text', text: 'Sure. I will **write a note** about it.' }, { type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: '/work/outputs/note.md', content: '# Note\n\nA tiny orange square.\n' } }] } }, 2),
    ev('user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'File written' }] } }, 3),
    ev('assistant', { message: { role: 'assistant', model: 'test-model', content: [{ type: 'text', text: 'Done — the note is written.' }] } }, 4),
    ev('result', { duration_ms: 65000, num_turns: 2, modelUsage: { 'test-model': { costUSD: 0.012 } } }, 5),
    ev('user', { message: { role: 'user', content: 'This session is being continued from a previous conversation that ran out of context. Summary: a picture was discussed.' } }, 1440),
    ev('user', { message: { role: 'user', content: 'Thanks, second day message.' } }, 1441),
    ev('assistant', { message: { role: 'assistant', model: 'test-model', content: [{ type: 'text', text: 'You are welcome.' }] } }, 1442),
    ev('result', { duration_ms: 3000, num_turns: 1, modelUsage: { 'test-model': { costUSD: 0.001 } } }, 1443),
  ];
}

// Local session as stored by the desktop app: local_<id>.json + local_<id>/{audit.jsonl, uploads/, outputs/}
function writeLocalSession(dir, id, opts = {}) {
  const base = path.join(dir, 'local_' + id);
  fs.mkdirSync(path.join(base, 'uploads'), { recursive: true }); fs.mkdirSync(path.join(base, 'outputs'), { recursive: true });
  fs.writeFileSync(path.join(base, 'uploads', 'sample.png'), tinyPng());
  fs.writeFileSync(path.join(base, 'outputs', 'note.md'), '# Note\n');
  const lines = [
    { type: 'system', subtype: 'init', model: 'test-model', cwd: '/tmp/x/outputs', _audit_timestamp: at(0) },
    { type: 'user', message: { role: 'user', content: 'Hello from a local session\n<uploaded_files><file_path>/mnt/uploads/sample.png</file_path></uploaded_files>' }, _audit_timestamp: at(1) },
    { type: 'assistant', message: { role: 'assistant', model: 'test-model', content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: (opts.projectFolder || '/Users/someone/Projects/Alpha') + '/notes.md' } }] }, _audit_timestamp: at(2) },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] }, parent_tool_use_id: null, _audit_timestamp: at(3) },
    { type: 'assistant', message: { role: 'assistant', model: 'test-model', content: [{ type: 'text', text: 'Hi! I read the notes.' }] }, _audit_timestamp: at(4) },
    { type: 'result', duration_ms: 1200, num_turns: 1, total_cost_usd: 0.002, _audit_timestamp: at(5) },
  ];
  fs.writeFileSync(path.join(base, 'audit.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  if (!opts.noMeta) fs.writeFileSync(path.join(dir, 'local_' + id + '.json'), JSON.stringify({ title: opts.title || 'Local session ' + id, createdAt: T0, lastActivityAt: T0 + 300000, model: 'test-model', isArchived: !!opts.archived, userSelectedFolders: opts.folders || [opts.projectFolder || '/Users/someone/Projects/Alpha'] }));
  return base;
}

function writeSpaces(dir) {
  fs.writeFileSync(path.join(dir, 'spaces.json'), JSON.stringify({ spaces: [
    { id: 'space-alpha', name: 'Alpha', folders: [{ path: '/Users/someone/Projects/Alpha' }], createdAt: T0, updatedAt: T0 },
    { id: 'space-beta', name: 'Beta', folders: [{ path: '/Users/someone/Projects/Beta' }], createdAt: T0, updatedAt: T0 },
  ] }));
  fs.writeFileSync(path.join(dir, 'remote-sessions-spaces.json'), JSON.stringify({ entries: [{ sessionId: 'session_cloud1', folders: ['/Users/someone/Projects/Beta'] }] }));
}

function makeAll(dir) {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify(cloudEvents(), null, 1));
  writeLocalSession(dir, 'a1', { title: 'Alpha — first session' });
  writeLocalSession(dir, 'a2', { noMeta: true, projectFolder: '/Users/someone/Projects/Alpha' });
  fs.writeFileSync(path.join(dir, 'local_b1.json'), JSON.stringify({ title: 'Beta — metadata only', createdAt: T0 - 86400000, lastActivityAt: T0 - 80000000, model: 'test-model', isArchived: true, userSelectedFolders: [{ path: '/Users/someone/Projects/Beta/' }] }));
  writeSpaces(dir);
  return dir;
}

module.exports = { tinyPng, cloudEvents, writeLocalSession, writeSpaces, makeAll };
if (require.main === module) console.log('fixtures written to', makeAll(process.argv[2] || path.join(__dirname, 'out')));
