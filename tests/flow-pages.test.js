/* Page behaviour of 7.2 Antibody Titration (tools/antibody-titration) and 7.3 Staining Cocktail
   (tools/staining-cocktail): series plan, paste → stain index, library hand-over, Panel Designer hand-off,
   share link, phone widths, no JS errors.
   Run from the repo root:  NODE_PATH=$(npm root -g) node tests/flow-pages.test.js
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
  const BASE = `http://localhost:${server.address().port}/tools/`;
  const browser = await chromium.launch();
  let n = 0;
  const t = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };
  const errors = [];
  const ctx = await browser.newContext({ acceptDownloads: true, locale: 'en-US' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route((u) => !u.href.startsWith('http://localhost'), (r) => r.abort());
  await page.addInitScript(() => { window.LMT_FLOW_TEST = {}; });
  const T = () => page.evaluate(() => {
    const s = window.LMT_FLOW_TEST.titration.series(), r = window.LMT_FLOW_TEST.titration.result();
    return { s: s && { first: s.first, transfer: s.transfer, keep: s.keep, n: s.tubes.length }, r: r && r.ok ? { method: r.method, best: r.best.x, lean: r.lean.x, flags: r.flags, n: r.pts.length } : null };
  });

  await page.goto(BASE + 'antibody-titration/');
  await t('7.2 opens with the default series: 8 tubes, tube 1 = 11 µL + 99 µL, 55 µL transfers', async () => {
    const { s } = await T();
    assert.strictEqual(s.n, 8); assert.strictEqual(s.keep, 55); assert.strictEqual(s.transfer, 55);
    assert(Math.abs(s.first.stock - 11) < 1e-9 && Math.abs(s.first.buffer - 99) < 1e-9);
    assert((await page.textContent('#steps')).includes('11 µL antibody'));
  });

  await t('tube-by-tube mode shares one 1:100 predilution for the tubes under 0.5 µL', async () => {
    await page.click('#modeSeg [data-mode=direct]');
    const txt = await page.textContent('#steps');
    assert(/Predilute the stock 1:100 for tubes 5, 6, 7, 8/.test(txt), txt);
    await page.click('#modeSeg [data-mode=serial]');
  });

  await t('example paste → stain index, amounts read from 1:X names, best 0.125 µg/test', async () => {
    await page.click('#example');
    const { r } = await T();
    assert.strictEqual(r.method, 'si'); assert.strictEqual(r.n, 8);
    assert.strictEqual(r.best, 0.125); assert(r.flags.includes('bgUp'));
    assert((await page.textContent('#siSay')).includes('1:160'));
    assert(await page.$('#chart svg circle.bst'));
  });

  await t('typing an amount over a row re-runs the analysis', async () => {
    await page.fill('#siRows tr:nth-child(8) input', '');
    await page.waitForTimeout(700);
    assert.strictEqual((await T()).r.n, 8);   // empty → falls back to the name
    await page.fill('#siRows tr:nth-child(8) input', 'abc');
    await page.waitForTimeout(700);
    assert.strictEqual((await T()).r.n, 7);
    await page.fill('#siRows tr:nth-child(8) input', '');
    await page.waitForTimeout(700);
  });

  await t('separation index when only an 84th percentile column is given', async () => {
    await page.fill('#paste', 'Sample;Pos MFI;Neg MFI;Neg 84th percentile\n0,5 ug;30000;400;520\n0,25 ug;28000;300;390\n0,125 ug;20000;260;330\n');
    await page.waitForTimeout(100);
    const { r } = await T();
    assert.strictEqual(r.method, 'sep'); assert.strictEqual(r.best, 0.25);
  });

  await t('downloads: series CSV, index CSV, SVG and PNG', async () => {
    for (const id of ['csv', 'siCsv', 'svg', 'png']) {
      const [d] = await Promise.all([page.waitForEvent('download'), page.click('#' + id)]);
      assert(/\.(csv|svg|png)$/.test(d.suggestedFilename()), d.suggestedFilename());
    }
  });

  await t('save to my antibodies → listed on both pages', async () => {
    await page.click('#example');
    await page.click('#saveLib');
    assert((await page.textContent('[data-lib-body]')).includes('0.125 µg / 100 µL'));
  });

  await page.goto(BASE + 'staining-cocktail/');
  const C = () => page.evaluate(() => { const r = window.LMT_FLOW_TEST.cocktail.result(); return r.ok ? { n: r.n, total: r.cocktailTotal, buf: r.bufferTotal, warn: r.warn, lines: r.lines.map((l) => [l.name, l.total]), live: r.live.length } : { err: r.err }; });

  await t('7.3 default: 13.2 tubes, 660 µL, viability dye apart', async () => {
    const c = await C();
    assert(Math.abs(c.n - 13.2) < 1e-9); assert(Math.abs(c.total - 660) < 1e-9); assert.strictEqual(c.live, 1);
    assert(Math.abs(c.buf - (50 - 2.125) * 13.2) < 1e-9);
  });

  await t('library: the titrated antibody is offered and added with its titer', async () => {
    const opts = await page.$$eval('#libAdd option', (o) => o.map((x) => x.textContent));
    assert(opts.some((x) => x.includes('CD4 PE')));
    await page.selectOption('#libAdd', { index: 1 });
    const st = await page.evaluate(() => window.LMT_FLOW_TEST.cocktail.state().rows.slice(-1)[0]);
    assert.strictEqual(st.use, 'ug'); assert.strictEqual(st.value, '0.125'); assert.strictEqual(st.stock, '0.2');
  });

  await t('scaling a titer to another staining volume keeps the concentration', async () => {
    await page.fill('#finalVol', '50'); await page.fill('#cocktailVol', '25');
    await page.selectOption('#libAdd', { index: 1 });
    const st = await page.evaluate(() => window.LMT_FLOW_TEST.cocktail.state().rows.slice(-1)[0]);
    assert.strictEqual(st.value, '0.0625');
    await page.click('#clear');
  });

  await t('warnings: cocktail too small, two Brilliant dyes, under 0.5 µL', async () => {
    await page.fill('#tubes', '2'); await page.selectOption('#overMode', 'tubes'); await page.fill('#over', '0');
    await page.fill('#rv1', '0.01'); await page.selectOption('#ru1', 'ul'); await page.fill('#rf2', 'BV605');
    await page.waitForTimeout(100);
    let c = await C();
    assert(c.warn.includes('needBsb') && c.warn.includes('small'));
    assert((await page.textContent('#notes')).includes('Predilute'));
    await page.fill('#cocktailVol', '1');
    c = await C();
    assert(c.warn.includes('tooMuch'));
    assert.strictEqual(await page.textContent('#ansBig'), 'Doesn\'t fit');
    await page.selectOption('#bsbKind', 'plus'); await page.fill('#cocktailVol', '50');
    c = await C();
    assert(!c.warn.includes('needBsb'));
    assert.strictEqual(await page.inputValue('#bsb'), '10');
  });

  await t('typing in a row then clicking × removes the row (no lost click)', async () => {
    const before = await page.$$eval('#rows tr', (l) => l.length);
    await page.fill('#rt0', 'CD3e');
    await page.click('#rows tr[data-i="1"] .rc-x');
    assert.strictEqual(await page.$$eval('#rows tr', (l) => l.length), before - 1);
  });

  await t('share link reopens the same cocktail', async () => {
    await page.fill('#name', 'T-cell panel');
    await page.waitForTimeout(50);
    const url = await page.evaluate(() => {
      const st = window.LMT_FLOW_TEST.cocktail.state();
      return location.pathname + '#c=' + btoa(unescape(encodeURIComponent(JSON.stringify({ v: 1, st })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    });
    const p2 = await ctx.newPage(); p2.on('pageerror', (e) => errors.push(String(e)));
    await p2.route((u) => !u.href.startsWith('http://localhost'), (r) => r.abort());
    await p2.addInitScript(() => { window.LMT_FLOW_TEST = {}; });
    await p2.goto(`http://localhost:${server.address().port}` + url);
    assert.strictEqual(await p2.inputValue('#name'), 'T-cell panel');
    await p2.close();
  });

  await t('Panel Designer → BUILD STAINING COCKTAIL imports its markers and dyes', async () => {
    await page.goto(BASE + 'panel-designer/');
    await page.click('#cocktailBtn');
    await page.waitForURL(/staining-cocktail/);
    const rows = await page.evaluate(() => window.LMT_FLOW_TEST.cocktail.state().rows.map((r) => r.target + '|' + r.fluor));
    assert(rows.length >= 5, rows.join());
    assert(rows.includes('CD4|PE') || rows.some((r) => r.startsWith('CD4|')), rows.join());
    assert((await page.textContent('.lm-handoff-note')).includes('Panel Designer'));
  });

  for (const w of [1440, 834, 390]) {
    await t(`no horizontal scroll at ${w} px on both pages`, async () => {
      await page.setViewportSize({ width: w, height: 900 });
      for (const tool of ['antibody-titration', 'staining-cocktail']) {
        await page.goto(BASE + tool + '/');
        if (tool === 'antibody-titration') await page.click('#example');
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        assert(sw <= w, `${tool} ${sw} > ${w}`);
      }
    });
  }

  await browser.close(); server.close();
  assert.deepStrictEqual(errors, []);
  console.log(`\n${n} page tests passed, no JS errors`);
})().catch((e) => { console.error(e); process.exit(1); });
