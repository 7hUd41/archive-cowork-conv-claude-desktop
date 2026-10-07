// End-to-end tests for the local viewer: headless Chromium, synthetic fixtures, drops simulated through CDP.
// authors: 7hud41 · license: MIT
// Run: npm test   (needs `npm install` once, for Playwright)
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path'); const os = require('os'); const { spawn } = require('child_process');
const { chromium } = require('playwright');
const { makeAll } = require('./fixtures');

const ROOT = path.resolve(__dirname, '..');
const FX = makeAll(path.join(os.tmpdir(), 'cowork-local-viewer-fixtures'));
const PORT = 4790 + Math.floor(Math.random() * 100);

async function drop(page, files) {
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x: 300, y: 300, data });
}
const texts = (page, sel) => page.$$eval(sel, els => els.map(e => e.textContent));
const openedRow = page => page.waitForFunction(() => !document.getElementById('zipBtn').disabled, null, { timeout: 15000 });

let server, browser, ctx;
test.before(async () => {
  server = spawn('node', [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  browser = await chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
});
test.after(async () => { await browser.close(); server.kill(); });

async function freshPage() {
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  return page;
}

test('sessions, projects, index, time zone, ZIP and reopen', async () => {
  const page = await freshPage();
  assert.equal(await page.$eval('h1', e => e.textContent), 'Cowork Local Viewer');

  await drop(page, [path.join(FX, 'spaces.json'), path.join(FX, 'remote-sessions-spaces.json')]);
  await page.waitForTimeout(400);
  assert.match(await page.$eval('#dropStatus', e => e.textContent), /2 project\(s\) loaded/);

  await drop(page, [path.join(FX, 'local_a1'), path.join(FX, 'local_a1.json'), path.join(FX, 'local_a2'), path.join(FX, 'local_b1.json')]);
  await page.waitForTimeout(1500);
  const rows = await texts(page, '.srow');
  assert.equal(rows.length, 3);
  assert.ok(rows.some(r => r.startsWith('Alpha') && r.includes('Alpha — first session')), 'project chip from metadata');
  assert.ok(rows.some(r => r.includes('Alpha (inferred)') && r.includes('(title inferred from the first message)')), 'inferred project and title');
  assert.ok(rows.some(r => r.includes('Beta') && r.includes('conversation not dropped') && r.includes('archived')), 'metadata-only session');
  assert.deepEqual(await texts(page, '#projectSelect option'), ['All projects (3)', 'Alpha (2)', 'Beta (1)']);

  await page.selectOption('#projectSelect', 'Beta');
  assert.equal(await page.$eval('#sessionsCount', e => e.textContent), '1 / 3');
  await page.selectOption('#projectSelect', '');

  // metadata-only session cannot be opened
  await page.click('.srow.noconv');
  assert.match(await page.$eval('#dropStatus', e => e.textContent), /drop the local_b1 FOLDER/);

  // open a real session: default time zone Toronto, header with project
  await page.click('.srow:not(.noconv)');
  await openedRow(page);
  assert.match(await page.$eval('#sid', e => e.textContent), /Alpha — first session {3}· {3}project: Alpha/);
  assert.equal(await page.$eval('#tzSelect', e => e.value), 'America/Toronto');
  assert.match(await page.$eval('.msg.user .who', e => e.textContent), /09:01/, '14:01 UTC shown as 09:01 Toronto');
  assert.equal((await texts(page, '.ucol img.att')).length, 1, 'uploaded image re-attached from uploads/');

  await page.selectOption('#tzSelect', 'Europe/Paris');
  await page.waitForTimeout(300);
  assert.match(await page.$eval('.msg.user .who', e => e.textContent), /15:01/, 'Paris');

  // index + ZIP downloads
  const downloads = []; page.on('download', d => downloads.push(d));
  await page.click('#csvBtn'); await page.waitForTimeout(800);
  await page.click('#zipBtn'); await page.waitForTimeout(2500);
  const names = downloads.map(d => d.suggestedFilename());
  assert.ok(names.some(n => /^cowork-sessions-index-\d{4}-\d{2}-\d{2}\.csv$/.test(n)));
  assert.ok(names.some(n => /^cowork-sessions-index-\d{4}-\d{2}-\d{2}\.md$/.test(n)));
  const zipDl = downloads.find(d => d.suggestedFilename().endsWith('.zip'));
  assert.ok(zipDl, 'zip downloaded');
  const md = fs.readFileSync(await downloads.find(d => d.suggestedFilename().endsWith('.md')).path(), 'utf8');
  assert.match(md, /^# Index of local Cowork sessions/);
  assert.match(md, /## Alpha — 2 session\(s\)/);
  assert.match(md, /## Cloud sessions/);
  const zipPath = path.join(os.tmpdir(), 'cowork-local-viewer-test.zip');
  fs.copyFileSync(await zipDl.path(), zipPath);
  assert.match(await page.$eval('#log', e => e.textContent), /audit\.jsonl added to the ZIP/);

  // reopen the archive in a new page: project and time zone restored
  const page2 = await freshPage();
  await drop(page2, [zipPath]);
  await page2.waitForTimeout(2500);
  const rows2 = await texts(page2, '.srow');
  assert.equal(rows2.length, 1);
  assert.match(rows2[0], /^AlphaAlpha — first session.*archive reopened \(cowork-local-viewer-test\.zip, exported on .*, 6 events\)/);
  await page2.click('.srow'); await openedRow(page2);
  assert.equal(await page2.$eval('#tzSelect', e => e.value), 'Europe/Paris');
  assert.match(await page2.$eval('#sid', e => e.textContent), /project: Alpha/);

  assert.deepEqual(page.errors, []); assert.deepEqual(page2.errors, []);
  await page.close(); await page2.close();
});

test('language switch re-renders the interface in French and back', async () => {
  const page = await freshPage();
  await drop(page, [path.join(FX, 'local_a1'), path.join(FX, 'local_a1.json')]);
  await page.waitForTimeout(1200);
  await page.click('.srow'); await openedRow(page);
  await page.selectOption('#langSelect', 'fr'); await page.waitForTimeout(500);
  assert.equal(await page.$eval('#zipBtn', e => e.textContent), 'Télécharger le ZIP');
  assert.equal(await page.$eval('#modeBtn', e => e.textContent), 'Mode : lecture');
  assert.match(await page.$eval('.msg.user .who', e => e.textContent), /^Vous/);
  assert.match(await page.$eval('.drop .big', e => e.textContent), /^Glisse ici/);
  assert.match((await texts(page, '.srow'))[0], /audit \d+ Ko/);
  await page.reload(); await page.waitForTimeout(300);
  assert.equal(await page.$eval('#zipBtn', e => e.textContent), 'Télécharger le ZIP', 'language remembered');
  await page.selectOption('#langSelect', 'en'); await page.waitForTimeout(300);
  assert.equal(await page.$eval('#zipBtn', e => e.textContent), 'Download ZIP');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('an unreadable attachment does not break the ZIP', async () => {
  const page = await freshPage();
  const dir = path.join(os.tmpdir(), 'cowork-local-viewer-volatile'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  const { writeLocalSession } = require('./fixtures');
  writeLocalSession(dir, 'v1', { title: 'Volatile' });
  await drop(page, [path.join(dir, 'local_v1'), path.join(dir, 'local_v1.json')]);
  await page.waitForTimeout(1200);
  await page.click('.srow'); await openedRow(page);
  await page.waitForTimeout(300); // prefetch
  fs.appendFileSync(path.join(dir, 'local_v1', 'uploads', 'sample.png'), Buffer.from([0])); // invalidates the dropped reference
  const downloads = []; page.on('download', d => downloads.push(d));
  await page.click('#zipBtn'); await page.waitForTimeout(2500);
  assert.equal(downloads.length, 1, 'ZIP still produced');
  assert.doesNotMatch(await page.$eval('#log', e => e.textContent), /Failed/);
  assert.deepEqual(page.errors, []);
  await page.close();
});
