#!/usr/bin/env node
// Cowork Local Viewer — server.js
// authors: 7hud41
// license: MIT
//
// Minimal static server. It does ONE thing: serve index.html on http://127.0.0.1.
// It does not read your sessions, lists nothing, writes nothing. The page itself only reads what you drop on it.
// Why a server? Chrome refuses to read a FOLDER dropped on a page opened as file://; served from localhost it works.
const http = require('http'); const fs = require('fs'); const path = require('path'); const { execFile } = require('child_process');
const PORT = Number(process.env.PORT || 4747);
const HTML = path.join(__dirname, 'index.html');
http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/index.html') || req.url.startsWith('/?'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    fs.createReadStream(HTML).pipe(res);
  } else { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); }
}).listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log('Cowork Local Viewer — page served at', url, '(Ctrl+C to stop)');
  console.log('Drop your session folders on the page. Nothing is read from disk until you drop something.');
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try { execFile(opener, [url], () => {}); } catch (_) {}
});
