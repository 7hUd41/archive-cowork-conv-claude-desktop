#!/usr/bin/env node
// Cowork Local Viewer — serveur minimal. Il ne fait QU'UNE chose : servir la page index.html sur http://127.0.0.1.
// Il ne lit pas tes sessions, ne liste rien, n'écrit rien. La page, elle, ne lit que ce que tu y déposes.
// Pourquoi ? Chrome interdit de lire un DOSSIER déposé sur une page ouverte en file:// ; servie en http://localhost, ça marche.
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
  console.log('Cowork Local Viewer — page servie sur', url, '(Ctrl+C pour arrêter)');
  console.log('Glisse tes dossiers de session dans la page. Rien n\'est lu sur le disque tant que tu ne déposes rien.');
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try { execFile(opener, [url], () => {}); } catch (_) {}
});
