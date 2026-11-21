/* Page behaviour of the ELISA analyzer (tools/elisa): example, layout painting, exclusions, settings,
   language switch, exports, record round-trip, print, phone width.
   Run from the repo root:  NODE_PATH=$(npm root -g) node tests/elisa-page.test.js
   Needs Playwright with Chromium. Serves the repo on a local port (the example is fetched). */
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
  const URL = `http://localhost:${server.address().port}/tools/elisa/`;
  const browser = await chromium.launch();
  let n = 0;
  const t = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };
  const errors = [];
  const ctx = await browser.newContext({ acceptDownloads: true, locale: 'en-US' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route((u) => !u.href.startsWith('http://localhost'), (r) => r.abort());
  await page.addInitScript(() => { window.LMT_EL_TEST = {}; });
  await page.goto(URL + '?lang=en');
  await page.waitForFunction(() => window.LMT_EL_TEST.api && window.LMT_EL_TEST.api.res() && window.LMT_EL_TEST.api.res().ok);
  const R = () => page.evaluate(() => { const r = window.LMT_EL_TEST.api.res(); return { ok: r.ok, five: r.ok && r.fit.five, lloq: r.lloq, uloq: r.uloq, smp: r.ok ? r.smp.concat(r.ctl).map((o) => ({ id: o.id, status: o.status, flags: o.flags, final: o.final, adv: o.advice })) : [] }; });

  await t('example opens on first visit: 4PL, range 7.8–500, flags and re-run list', async () => {
    const r = await R();
    assert(r.ok && !r.five); assert(Math.abs(r.lloq - 7.8125) < 1e-9 && r.uloq === 500);
    const S = Object.fromEntries(r.smp.map((o) => [o.id, o]));
    assert.strictEqual(S.S5.status, 'high'); assert.strictEqual(S.S26.status, 'above'); assert(S.S17.flags.includes('cv'));
    assert.strictEqual(S.S12.status, 'low'); assert.strictEqual(S.C1.status, 'ok');
    assert(await page.isVisible('#exampleNote'));
    assert((await page.textContent('#rerunBox')).includes('S5'));
  });
  await t('tapping a result row shows the working', async () => {
    await page.click('#smpRes tr[data-id="S1"]');
    const w = await page.textContent('#work');
    assert(w.includes('x = C') && w.includes('× dilution'), w.slice(0, 200));
  });
  await t('EXCLUDE then tap a well: the high-CV flag on S17 goes away', async () => {
    await page.click('#brushSeg button[data-v="off"]');
    await page.click('#plate [data-w="D6"]');
    const s17 = (await R()).smp.find((o) => o.id === 'S17');
    assert(!s17.flags.includes('cv') && s17.flags.includes('single'));
    await page.click('#plate [data-w="D6"]'); // use it again
    assert((await R()).smp.find((o) => o.id === 'S17').flags.includes('cv'));
  });
  await t('painting: CONTROL ×2 across from H5 makes C3 on H5–H6', async () => {
    await page.click('#brushSeg button[data-v="ctl"]');
    await page.click('#repSeg button[data-v="2"]');
    await page.click('#dirSeg button[data-v="across"]');
    await page.click('#plate [data-w="H5"]');
    const st = await page.evaluate(() => window.LMT_EL_TEST.api.state());
    assert.deepStrictEqual([st.wells.H5, st.wells.H6], [{ t: 'ctl', id: 'C3' }, { t: 'ctl', id: 'C3' }]);
    assert(await page.isVisible('#ctlWrap'));
    assert(!(await page.isVisible('#exampleNote')));
  });
  await t('typing a dilution updates the concentration', async () => {
    const before = (await R()).smp.find((o) => o.id === 'S1').final;
    await page.fill('#smpRows input[data-g="S1"][data-k="dil"]', '1:4');
    await page.press('#smpRows input[data-g="S1"][data-k="dil"]', 'Enter');
    await page.locator('#smpRows input[data-g="S1"][data-k="dil"]').blur();
    const after = (await R()).smp.find((o) => o.id === 'S1').final;
    assert(Math.abs(after / before - 2) < 1e-9, before + ' → ' + after);
  });
  await t('model and weighting buttons refit', async () => {
    await page.click('#modelSeg button[data-v="5pl"]');
    assert((await R()).five);
    assert((await page.textContent('#fitSum')).includes('5PL'));
    await page.click('#modelSeg button[data-v="auto"]');
    await page.click('#weightSeg button[data-v="none"]');
    assert((await page.textContent('#fitSum')).includes('none'));
    await page.click('#weightSeg button[data-v="1/y2"]');
  });
  await t('中文: the language switch translates the page and the results', async () => {
    await page.click('#langSeg button[data-v="zh"]');
    assert.strictEqual(await page.getAttribute('html', 'lang'), 'zh-CN');
    assert((await page.textContent('h1')).includes('ELISA 标准曲线'));
    assert((await page.textContent('#smpRes')).includes('范围内'));
    assert((await page.textContent('#rerunBox')).includes('重测'));
    assert(await page.isVisible('.lm-faq.i18n-zh')); assert(!(await page.isVisible('.lm-faq.i18n-en')));
    assert((await page.textContent('#methods')).includes('logistic 曲线'));
    await page.click('#langSeg button[data-v="en"]');
    assert((await page.textContent('h1')).includes('ELISA Standard Curve Analyzer'));
  });
  await t('CSV download has every sample with its concentration', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#csv')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    assert(csv.startsWith('﻿Type,ID,Name'));
    assert(/sample,S5,Serum 05,.*> ULOQ/.test(csv), 'S5 row');
    assert.strictEqual(csv.trim().split(/\r?\n/).length, 1 + 8 + 37 + 3); // S37 was painted over by C3
  });
  await t('SAVE RECORD → open again: every result matches', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#json')]);
    const rec = fs.readFileSync(await dl.path(), 'utf8');
    await page.click('#clear');
    assert(await page.evaluate(() => document.body.classList.contains('el-empty')));
    await page.setInputFiles('#fileIn', { name: 'run.elisa.json', mimeType: 'application/json', buffer: Buffer.from(rec) });
    await page.waitForFunction(() => /every result matches/.test(document.getElementById('loadMsg').textContent));
    const st = await page.evaluate(() => window.LMT_EL_TEST.api.state());
    assert.strictEqual(st.groups.S1.dil, '1:4'.replace('1:', ''));
  });
  await t('a changed record is reported as different', async () => {
    const rec = await page.evaluate(() => window.LMT_EL_TEST.api.record());
    rec.results.samples[0].concentration *= 1.1;
    await page.setInputFiles('#fileIn', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rec)) });
    await page.waitForFunction(() => /differ from the record/.test(document.getElementById('loadMsg').textContent));
  });
  await t('pasting an 8×12 block keeps the layout and refits', async () => {
    const lines = fs.readFileSync(path.join(ROOT, 'tests/fixtures/elisa/paste-bare.txt'), 'utf8');
    await page.click('#pasteBox summary');
    await page.fill('#pasteText', lines);
    await page.click('#pasteUse');
    const msg = await page.textContent('#loadMsg');
    assert(msg.includes('layout kept'), msg);
  });
  await t('print: report header with the plate map appears, editing sections hidden', async () => {
    await page.click('#example');
    await page.waitForFunction(() => window.LMT_EL_TEST.api.state().example);
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await page.emulateMedia({ media: 'print' });
    assert(await page.isVisible('#printHead .el-plate'));
    assert(!(await page.isVisible('#brushSeg')));
    assert(await page.isVisible('#smpRes'));
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  });
  for (const w of [1440, 834, 390]) {
    await t(`no horizontal scroll at ${w} px (en and 中文)`, async () => {
      for (const l of ['en', 'zh']) {
        const p2 = await ctx.newPage();
        await p2.setViewportSize({ width: w, height: 900 });
        await p2.route((u) => !u.href.startsWith('http://localhost'), (r) => r.abort());
        p2.on('pageerror', (e) => errors.push(String(e)));
        await p2.goto(URL + '?lang=' + l);
        await p2.waitForTimeout(500);
        const sw = await p2.evaluate(() => document.documentElement.scrollWidth);
        assert(sw <= w, `${l} scrollWidth ${sw}`);
        await p2.close();
      }
    });
  }
  assert.deepStrictEqual(errors, []);
  console.log(`\n${n} page tests passed, no JS errors`);
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
