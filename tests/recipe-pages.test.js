/* Page behaviour of 5.6 SDS-PAGE Gel Recipe and 2.7 Buffer Recipe.
   Run from the repo root:  NODE_PATH=$(npm root -g) node tests/recipe-pages.test.js
   Needs Playwright with Chromium. Serves the repo on a local port. */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
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
  const ctx = await browser.newContext({ locale: 'en-US' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route((u) => !u.href.startsWith('http://localhost'), (r) => r.abort());
  const card = (sel) => page.$$eval(sel + ' .rc-steps li[data-k], ' + sel + ' .rc-steps li:not(.sep):not(.total)', (els) => els.map((li) => [li.querySelector('.n').firstChild.textContent.trim(), li.querySelector('.v').textContent]));
  const type = async (sel, v) => { await page.fill(sel, v); };

  // ---------------- gel ----------------
  await page.goto(BASE + 'sds-page-gel/');
  await t('gel: default 2 × 10% + 2 × 12% on 1.0 mm Mini-PROTEAN', async () => {
    assert.strictEqual(await page.textContent('#ansBig'), '4 gels · 25.50 mL');
    const r = await card('[data-mix="r0"]');
    assert.deepStrictEqual(r, [['Water', '3.81 mL'], ['Tris-HCl pH 8.8', '2.38 mL'], ['Acrylamide/bis 37.5:1', '3.17 mL'], ['SDS', '95 µL'], ['APS', '48 µL'], ['TEMED', '4.8 µL']]);
    const s = await card('[data-mix="s"]');
    assert.deepStrictEqual(s.map((x) => x[1]), ['3.90 mL', '1.63 mL', '867 µL', '65 µL', '33 µL', '6.5 µL']);
    assert((await page.textContent('#perGel')).includes('4.20 mL'));
  });
  await t('gel: one 10 mL mix reproduces Bio-Rad (as printed) and Robertson (40%, exact)', async () => {
    await page.click('#stocksBox summary');
    await page.click('#resRows tr:nth-child(2) .rc-x');
    await page.selectOption('#sys', 'custom'); await type('#dw', '10'); await type('#dh', '10'); await type('#dt', '1');
    await type('#frac', '50'); await type('#over', '0'); await page.selectOption('#step', '0'); await type('#rg0', '1');
    // cassette 10 mL × 50% = 5 mL per gel; 2 gels → 10 mL
    await type('#rg0', '2');
    await page.click('[data-water="nominal"]');
    let r = await card('[data-mix="r0"]');
    assert.deepStrictEqual(r.map((x) => x[1]), ['4.07 mL', '2.50 mL', '3.33 mL', '100 µL', '50 µL', '5 µL']);
    await page.click('[data-water="strict"]'); await type('#acryl', '40');
    r = await card('[data-mix="r0"]');
    assert.deepStrictEqual(r.map((x) => x[1]), ['4.85 mL', '2.50 mL', '2.50 mL', '100 µL', '50 µL', '5 µL']);
    assert((await page.textContent('#stocksSum')).startsWith('40% acrylamide'));
  });
  await t('gel: stocks and plan are kept after reload', async () => {
    await page.reload();
    assert.strictEqual(await page.inputValue('#acryl'), '40');
    assert.strictEqual(await page.inputValue('#sys'), 'custom');
    assert.strictEqual(await page.$$eval('#resRows tr', (x) => x.length), 1);
  });
  await t('gel: ticking a component survives and does not recalculate the card', async () => {
    await page.check('[data-mix="r0"] li[data-k="water"] input');
    assert(await page.$eval('[data-mix="r0"] li[data-k="water"]', (li) => li.classList.contains('is-done')));
  });
  await t('gel: a percentage at or over the stock, or a fractional gel count, is refused', async () => {
    await type('#rp0', '45');
    assert(await page.$eval('#ans', (e) => e.classList.contains('is-error')));
    await type('#rp0', '10'); await type('#rg0', '1.5');
    assert(await page.$eval('#ans', (e) => e.classList.contains('is-error')));
    await type('#rg0', '2');
    assert(!(await page.$eval('#ans', (e) => e.classList.contains('is-error'))));
  });
  await t('gel: add a percentage with the quick chip; max four rows', async () => {
    await page.click('#addRes'); await page.click('[data-pct="15"]'); 
    assert.strictEqual(await page.inputValue('#rp1'), '15');
    await page.click('#addRes'); await page.click('#addRes');
    assert(await page.$eval('#addRes', (b) => b.disabled));
    assert(await page.$eval('#ans', (e) => e.classList.contains('is-error'))); // empty rows are highlighted
    await type('#rp2', '8'); await type('#rp3', '12');
    assert.strictEqual(await page.$$eval('.rc-card', (x) => x.length), 5);
  });
  await t('gel: tiny TEMED is flagged; native gel note when SDS is 0', async () => {
    await page.click('#clear'); await page.selectOption('#sys', 'mp075'); await page.selectOption('#step', '0');
    await type('#rg0', '1'); await type('#rg1', '0');
    assert((await page.textContent('#notes')).includes('Under 2 µL'));
    await page.$eval('#stocksBox', (d) => { d.open = true; });
    await page.fill('[data-f="resolving.sds"]', '0'); await page.fill('[data-f="stacking.sds"]', '0');
    assert((await page.textContent('#notes')).includes('native gel'));
    await page.click('#resetStocks');
    assert.strictEqual(await page.inputValue('[data-f="resolving.sds"]'), '0.1');
  });
  await t('gel: COPY RECIPE text', async () => {
    await page.click('#clear'); await page.click('#copy');
    const txt = await page.evaluate(() => navigator.clipboard.readText());
    assert(txt.includes('10% resolving gel — 9.50 mL for 2 gels') && txt.includes('TEMED (neat)\t4.8 µL'), txt);
  });

  // ---------------- buffers ----------------
  await page.goto(BASE + 'buffer-recipes/');
  const outs = () => page.$$eval('#comps .c-out', (x) => x.map((e) => e.textContent));
  await t('buffer: default 1 L of 10× running buffer', async () => {
    assert.strictEqual(await page.textContent('#ansBig'), '1 L of 10× Running buffer (TGS)');
    assert.deepStrictEqual(await outs(), ['30.29 g', '144.1 g', '10 g']);
  });
  await t('buffer: Towbin 10× leaves methanol for the dilution; dilution gives 100 + 200 + 700 mL', async () => {
    await page.click('[data-preset="towbin"]');
    assert.deepStrictEqual(await outs(), ['30.29 g', '144.1 g', 'at use']);
    await page.click('#toDilute');
    assert.strictEqual(await page.getAttribute('[data-mode="dilute"]', 'aria-pressed'), 'true');
    const r = await page.$$eval('.rc-steps li:not(.sep):not(.total) .v', (x) => x.map((e) => e.textContent));
    assert.deepStrictEqual(r, ['700 mL', '100 mL', '200 mL']);
    assert((await page.textContent('#notes')).includes('methanol'));
  });
  await t('buffer: PBS 10× matches the Fisher recipe; hydrate MW changes the grams', async () => {
    await page.click('[data-mode="make"]'); await page.click('[data-preset="pbs"]');
    assert.deepStrictEqual(await outs(), ['80.06 g', '2.013 g', '14.2 g', '2.45 g']);
    await page.fill('#cm2', '358.14');
    assert.strictEqual((await outs())[2], '35.81 g');
    assert(await page.$eval('[data-preset="pbs"]', (b) => b.classList.contains('is-edited')));
    await page.click('#restore');
    assert.strictEqual((await outs())[2], '14.2 g');
  });
  await t('buffer: TAE 50× and TBE 5×', async () => {
    await page.click('[data-preset="tae"]');
    assert.strictEqual(await page.inputValue('#x'), '50');
    assert.deepStrictEqual(await outs(), ['242.3 g', '57.14 mL', '100 mL']);
    await page.click('[data-preset="tbe"]');
    assert.deepStrictEqual(await outs(), ['53.91 g', '27.51 g', '20 mL']);
  });
  await t('buffer: changing a row to a stock solution swaps MW for stock; weak stock refused', async () => {
    await page.click('[data-preset="custom"]');
    await page.fill('#cn0', 'NaCl'); await page.fill('#cc0', '150'); await page.selectOption('#cu0', 'mM');
    await page.fill('#cm0', '58.44'); await type('#x', '1'); await type('#v', '500'); await page.selectOption('#vu', '1');
    assert.strictEqual((await outs())[0], '4.383 g');
    await page.selectOption('#cf0', 'stock');
    assert.strictEqual(await page.getAttribute('#cm0', 'placeholder'), 'stock M');
    await page.fill('#cm0', '5');
    assert.strictEqual((await outs())[0], '15 mL');
    await page.fill('#cm0', '0.1');
    assert(await page.$eval('#ans', (e) => e.classList.contains('is-error')));
    assert.strictEqual((await outs())[0], 'stock too weak');
  });
  await t('buffer: ?preset=tris88 opens the gel stock', async () => {
    await page.goto(BASE + 'buffer-recipes/?preset=tris88');
    assert.strictEqual(await page.getAttribute('[data-preset="tris88"]', 'aria-pressed'), 'true');
    await type('#x', '1'); await type('#v', '1'); await page.selectOption('#vu', '1000');
    assert.deepStrictEqual(await outs(), ['181.7 g']);
    assert((await page.textContent('.rc-card')).includes('PH 8.8'));
  });
  await t('buffer: COPY RECIPE text', async () => {
    await page.click('#copy');
    const txt = await page.evaluate(() => navigator.clipboard.readText());
    assert(txt.startsWith('1 L of 1× 1.5 M Tris-HCl pH 8.8') && txt.includes('Tris base\t181.7 g'), txt);
  });

  // ---------------- layout ----------------
  await t('both pages: no horizontal scroll at 1440 / 834 / 390 px, print hides inputs', async () => {
    for (const slug of ['sds-page-gel', 'buffer-recipes']) {
      for (const w of [1440, 834, 390]) {
        const p = await ctx.newPage({});
        p.on('pageerror', (e) => errors.push(String(e)));
        await p.route((u) => !u.href.startsWith('http://localhost'), (r) => r.abort());
        await p.setViewportSize({ width: w, height: 900 });
        await p.goto(BASE + slug + '/');
        const sw = await p.evaluate(() => document.documentElement.scrollWidth);
        assert(sw <= w, `${slug} ${w}: ${sw}`);
        await p.emulateMedia({ media: 'print' });
        assert(!(await p.isVisible('.rc-input')) && (await p.isVisible('.rc-card')));
        await p.close();
      }
    }
  });
  assert.deepStrictEqual(errors, []);
  console.log(`ok  ${n} page tests, no JS errors`);
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
