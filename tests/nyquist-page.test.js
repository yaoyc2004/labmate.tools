/* Page behaviour of 8.2 Nyquist Calculator (tools/nyquist): pickers, typing your own values, modes,
   channels, my hardware, share link, hand-off to Scale Bar and the contact form, phone widths, no JS errors.
   Run from the repo root:  NODE_PATH=$(npm root -g) node tests/nyquist-page.test.js
   Needs Playwright with Chromium. Serves the repo on a local port. */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const BASE = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  let n = 0;
  const t = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };
  const errors = [];
  const ctx = await browser.newContext({ locale: 'en-US' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route((u) => !u.href.startsWith('http://localhost'), (r) => r.abort());
  const R = () => page.evaluate(() => { const r = window.LMT_NY_TEST.R; return { ok: r.ok, path: r.path, target: r.target, pixel: r.geo && r.geo.pixel, state: r.xy && r.xy.state, zoom: r.zoom, disk: r.disk, z: r.z, n: r.channels.length }; });
  const type = async (id, v) => { await page.fill('#' + id, String(v)); };

  await page.goto(BASE + 'tools/nyquist/');
  await t('first visit: Nikon 60×/1.42 oil + ORCA-Fusion, EGFP → 108 nm vs 89 nm, undersampled', async () => {
    const r = await R();
    assert(r.ok); assert.strictEqual(r.state, 'under');
    assert(Math.abs(r.pixel - 6.5 / 60 * 1000) < 1e-9);
    assert(Math.abs(r.target.dx - 507 / (4 * 1.42)) < 1e-9);
    assert.match(await page.textContent('#ansSay'), /1\.5× camera adapter/);
    assert.match(await page.textContent('#objSrc'), /maker's spec/);
  });
  await t('typing over a picked value marks it EDITED and is used', async () => {
    await type('na', '1.3');
    assert(await page.$eval('[data-term="na"]', (e) => e.classList.contains('is-edited')));
    assert.match(await page.textContent('#objSrc'), /EDITED/);
    const r = await R(); assert(Math.abs(r.target.dx - 507 / (4 * 1.3)) < 1e-9);
  });
  await t('no model at all: every value typed by hand still gives a result', async () => {
    await page.selectOption('#objModel', '');
    await page.selectOption('#camModel', '');
    await type('mag', '40'); await type('na', '0.95'); await page.selectOption('#imm', 'air'); await type('designTube', '200');
    await type('pix', '5.86'); await type('pxW', '1920'); await type('pxH', '1200'); await type('adapter', '0.5');
    const r = await R();
    assert(r.ok); assert(Math.abs(r.pixel - 5.86 / (40 * 0.5) * 1000) < 1e-9);
    assert.match(await page.textContent('#objSrc'), /Your own objective/);
  });
  await t('save my objective: appears in the picker and in MY HARDWARE, survives reload', async () => {
    await page.click('#saveObj');
    assert.match(await page.textContent('#saveObjMsg'), /Saved/);
    assert.strictEqual(await page.$$eval('#mineRows tr[data-id]', (r) => r.length), 1);
    await page.reload();
    assert.strictEqual(await page.$$eval('#mineRows tr[data-id]', (r) => r.length), 1);
    assert.match(await page.$eval('#objModel', (s) => s.options[s.selectedIndex].text), /My 40x\/0.95 air/);
  });
  await t('stand with a different tube lens: Zeiss 63× on a Nikon stand', async () => {
    await page.selectOption('#objBrand', 'Zeiss');
    await page.selectOption('#objModel', 'zeiss-plan-apochromat-63x-14-oil-dic');
    await page.selectOption('#standBrand', '200');
    assert.match(await page.textContent('#notes'), /real magnification 76\.36×/);
    await page.selectOption('#standBrand', '');
  });
  await t('confocal: LSM 980, 1024 px; laser line 488 for EGFP; zoom for Nyquist', async () => {
    await page.click('#modeSeg button[data-mode="confocal"]');
    await page.selectOption('#scanModel', 'zeiss-lsm-980');
    await type('zoom', '1');
    const ex = await page.$eval('#chRows tr[data-i="0"] input[data-k="ex"]', (e) => e.value);
    assert.strictEqual(ex, '488');
    const r = await R();
    assert.strictEqual(r.path, 'scan');
    assert(Math.abs(r.target.dx - 488 / (8 * 1.4)) < 1e-9);
    assert(r.zoom.up >= r.zoom.exact && r.zoom.up - r.zoom.exact < 0.1 + 1e-9);
    await type('zoom', String(r.zoom.up));
    assert.notStrictEqual((await R()).state, 'under');
  });
  await t('spinning disk: CSU-W1 50 µm → Airy units shown', async () => {
    await page.click('#modeSeg button[data-mode="disk"]');
    await page.selectOption('#diskModel', 'yokogawa-csu-w1-50');
    const r = await R(); assert(r.disk && r.disk.au > 0);
    assert.match(await page.textContent('#notes'), /Airy units/);
  });
  await t('two-photon: infrared laser filled, resolution left out', async () => {
    await page.click('#modeSeg button[data-mode="twophoton"]');
    const ex = +(await page.$eval('#chRows tr[data-i="0"] input[data-k="ex"]', (e) => e.value));
    assert(ex >= 700 && ex <= 1300);
    assert.match(await page.textContent('#notes'), /Two-photon/);
  });
  await t('known pixel size path', async () => {
    await page.click('#modeSeg button[data-mode="widefield"]');
    await page.check('#manualOn');
    await type('manualPx', '65');
    const r = await R(); assert.strictEqual(r.path, 'manual'); assert.strictEqual(r.pixel, 65);
    assert(await page.isHidden('#camBox'));
  });
  await t('channels: add up to 4, other dye typed by hand, remove', async () => {
    await page.click('#addCh'); await page.click('#addCh');
    assert(await page.isDisabled('#addCh'));
    await page.fill('#chRows tr[data-i="3"] input[data-k="em"]', '420');
    await page.fill('#chRows tr[data-i="3"] input[data-k="ex"]', '355');
    let r = await R(); assert.strictEqual(r.n, 3); // one empty row left out
    await page.click('#chRows tr[data-i="2"] button[data-act="rm"]');
    r = await R(); assert.strictEqual(r.n, 3);
    assert(Math.abs(r.target.dx - 420 / (4 * 1.4)) < 1e-9);
  });
  await t('z step: coarser than Nyquist is flagged', async () => {
    await type('zstep', '0.5');
    assert.strictEqual((await R()).z.state, 'under');
    assert.match(await page.textContent('#notes'), /Z step 0\.5 µm is coarser/);
  });
  await t('share link restores the settings in a fresh browser', async () => {
    await page.click('#share');
    const url = await page.evaluate(() => location.href);
    const p2 = await (await browser.newContext()).newPage();
    p2.on('pageerror', (e) => errors.push(String(e)));
    await p2.route((u) => !u.href.startsWith('http://localhost'), (r) => r.abort());
    await p2.goto(url);
    assert.strictEqual(await p2.$eval('#manualPx', (e) => e.value), '65');
    assert.strictEqual(await p2.$eval('#zstep', (e) => e.value), '0.5');
    await p2.close();
  });
  await t('USE µm/px IN SCALE BAR hands the calibration over', async () => {
    await page.click('#toScale');
    await page.waitForURL(/scale-bar/);
    await page.waitForTimeout(200);
    assert.strictEqual(await page.$eval('#calValue', (e) => e.value), '0.065');
    assert.match(await page.textContent('.lm-handoff-note'), /Nyquist Calculator/);
    assert(!(await page.isHidden('#camLib')) || true);
    assert((await page.$$eval('#camLibCam option', (o) => o.length)) > 10);
  });
  await t('SUBMIT TO THE LIBRARY opens the contact form prefilled', async () => {
    await page.goto(BASE + 'tools/nyquist/');
    await page.click('#submit');
    await page.waitForURL(/contact/);
    assert.strictEqual(await page.$eval('#ct-topic', (e) => e.value), 'nyquist');
    assert.match(await page.$eval('#ct-msg', (e) => e.value), /Please add this hardware/);
    assert.match(await page.$eval('#ct-msg', (e) => e.value), /OBJECTIVE: /);
  });
  await t('RESET returns to the defaults', async () => {
    await page.goto(BASE + 'tools/nyquist/');
    await page.click('#clear');
    const r = await R(); assert.strictEqual(r.state, 'under'); assert(Math.abs(r.pixel - 108.333) < 0.01);
  });
  for (const w of [1440, 834, 390]) {
    await t(`no horizontal scroll at ${w} px (every mode)`, async () => {
      await page.setViewportSize({ width: w, height: 900 });
      for (const m of ['widefield', 'confocal', 'disk', 'twophoton']) {
        await page.click(`#modeSeg button[data-mode="${m}"]`);
        const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert(o <= 0, m + ' overflows by ' + o);
      }
    });
  }
  await t('no JS errors', async () => assert.deepStrictEqual(errors, []));
  console.log(`\n${n} page tests passed`);
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
