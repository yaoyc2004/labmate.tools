/* Page behaviour of 2.8 DNA/RNA Normalization (tools/nucleic-acid-normalization): example, presets, pasting
   and opening exports, flags, leaving out, ticks kept after reload, plate map, every export file, hand-offs,
   print layout, phone width, no JS errors.
   Run from the repo root:  NODE_PATH=$(npm root -g) node tests/na-page.test.js
   Needs Playwright with Chromium; python3 + openpyxl for the Excel check (skipped if missing). */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const NA = require('../tools/nucleic-acid-normalization/na-core.js');

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
const FX = (f) => path.join(__dirname, 'fixtures', 'na', f);

(async () => {
  await new Promise((r) => server.listen(0, r));
  const BASE = `http://localhost:${server.address().port}/`;
  const URL = BASE + 'tools/nucleic-acid-normalization/';
  const browser = await chromium.launch();
  let n = 0;
  const t = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };
  const errors = [];
  const ctx = await browser.newContext({ locale: 'en-US', acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route((u) => !u.href.startsWith('http://localhost'), (r) => r.abort());
  const L = () => page.evaluate(() => { const C = window.LMT_NA_TEST.last; return C.samples.filter((s) => !s.skip).map((s) => ({ k: s.key, pos: s.pos, st: s.res.status, sv: s.res.sv, w: s.res.water, kk: s.res.k, p280: s.p280.c, p230: s.p230.c, kind: s.kind })); });
  const by = async (k) => (await L()).find((s) => s.k === k);
  const save = async (btn) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(btn)]); const f = path.join(os.tmpdir(), d.suggestedFilename()); await d.saveAs(f); return f; };
  const fill = async (sel, v) => { await page.fill(sel, v); };

  await page.goto(URL);
  await t('first visit: NanoDrop RNA example, RT 1 µg in 10 µL, every status shown', async () => {
    const s = await L();
    assert.strictEqual(s.length, 8);
    assert.deepStrictEqual(s.map((x) => x.st), ['ok', 'ok', 'ok', 'ok', 'dilute', 'predil', 'ok', 'ok']);
    assert.deepStrictEqual([s[0].sv, s[0].w], [2.4, 7.6]);
    assert.deepStrictEqual([s[5].kk, s[5].sv], [4, 1.51]);
    assert(s.every((x) => x.kind === 'RNA'));
    assert.deepStrictEqual([s[6].p230, s[7].p280, s[3].p230], ['r', 'r', 'y']);
    assert.match(await page.textContent('#summary'), /6 READY.*1 PRE-DILUTE.*1 TOO DILUTE.*2 PURITY RED.*1 PURITY AMBER/);
    assert.match(await page.textContent('#rows'), /Pre-dilute 1:4 — 2\.0 µL \+ 6\.0 µL water/);
    assert.match(await page.textContent('#notes'), /Too dilute for 1 µg in 10 µL:.*KO 2/);
    assert.match(await page.textContent('#sheetSub'), /1 µG IN 10 µL/i);
    assert.match(await page.textContent('#maxBox'), /800 ng/);
  });

  await t('USE 800 ng FOR ALL lowers the target and clears the too-dilute row', async () => {
    await page.click('#useMax');
    assert.strictEqual(await page.inputValue('#amount'), '800');
    assert.strictEqual(await page.inputValue('#amountUnit'), 'ng');
    assert(!(await L()).some((x) => x.st === 'dilute'));
    assert.strictEqual(await page.isHidden('#useMax'), true);
  });

  await t('presets and concentration mode: 20 ng/µL in 20 µL; switching back carries the amount', async () => {
    await page.click('#presets [data-p="seq"]');
    assert.strictEqual(await page.isVisible('#targetTerm'), true);
    const s = await by('Ctrl 1');
    assert.strictEqual(s.sv, 0.97); assert.strictEqual(s.w, 19.03); // 400 / 412.6 = 0.969
    await page.click('#modeSeg [data-v="mass"]');
    assert.strictEqual(await page.inputValue('#amount'), '400');
    await page.click('#presets [data-p="rt1"]');
    assert.strictEqual(await page.getAttribute('#presets [data-p="rt1"]', 'aria-pressed'), 'true');
  });

  await t('bad inputs are marked and the sheet waits', async () => {
    await fill('#vf', '0');
    assert.match(await page.textContent('#vfm'), /above zero/);
    assert.strictEqual(await page.isDisabled('#print'), true);
    await fill('#vf', '10');
    assert.strictEqual(await page.isDisabled('#print'), false);
  });

  await t('pre-dilution off → UNDER MIN. VOLUME; smaller minimum → plain row', async () => {
    await page.uncheck('#predil');
    assert.strictEqual((await by('KO 3')).st, 'small');
    await page.check('#predil');
    await fill('#minv', '0.2');
    assert.strictEqual((await by('KO 3')).st, 'ok');
    await fill('#minv', '0.5');
  });

  await t('DNA / RNA choice changes purity; editable limits; reset', async () => {
    await page.click('#typeSeg [data-v="DNA"]');
    assert.strictEqual((await by('Ctrl 1')).p280, 'y'); // 2.08 is high for DNA
    assert.match(await page.textContent('#notes'), /High 260\/280 in DNA/);
    await page.click('#typeSeg [data-v="RNA"]');
    await page.click('#limitsBox summary');
    await page.fill('[data-l="RNA.g230"]', '2.12');
    assert.strictEqual((await by('Ctrl 2')).p230, 'y'); // 2.11
    await page.click('#limitsReset');
    assert.strictEqual((await by('Ctrl 2')).p230, 'g');
    await page.click('#typeSeg [data-v="auto"]');
  });

  await t('leave a sample out and bring it back; positions renumber', async () => {
    await page.click('#rows tr[data-k="Ctrl 2"] .mm-x');
    let s = await L();
    assert.strictEqual(s.length, 7); assert.strictEqual(s[1].k, 'Ctrl 3'); assert.strictEqual(s[1].pos, '2');
    await page.click('#leftOut .na-back');
    s = await L();
    assert.strictEqual(s.length, 8); assert.strictEqual(s[1].k, 'Ctrl 2');
  });

  await t('ticks are kept after a reload, and so are the settings', async () => {
    await page.check('#rows tr[data-k="KO 1"] .na-tick');
    await fill('#title', 'RT liver set 2');
    await page.reload();
    assert.strictEqual(await page.isChecked('#rows tr[data-k="KO 1"] .na-tick'), true);
    assert.match(await page.getAttribute('#rows tr[data-k="KO 1"]', 'class'), /is-done/);
    assert.strictEqual(await page.inputValue('#title'), 'RT liver set 2');
  });

  await t('96-well plate: wells down columns from a start well, skip edges, map, click to tick', async () => {
    await page.click('#laySeg [data-v="96"]');
    await page.fill('#startWell', 'G1');
    let s = await L();
    assert.deepStrictEqual(s.slice(0, 3).map((x) => x.pos), ['G1', 'H1', 'A2']);
    await page.click('#ordSeg [data-v="row"]');
    await page.fill('#startWell', 'A1');
    s = await L();
    assert.deepStrictEqual(s.slice(0, 3).map((x) => x.pos), ['A1', 'A2', 'A3']);
    await page.check('#skipEdge');
    s = await L();
    assert.strictEqual(s[0].pos, 'B2');
    assert.strictEqual(await page.$$eval('#plate .na-w[data-k]', (w) => w.length), 8);
    await page.click('#plate .na-w[data-k="Ctrl 1"]');
    assert.strictEqual(await page.isChecked('#rows tr[data-k="Ctrl 1"] .na-tick'), true);
    await page.click('#plate .na-w[data-k="Ctrl 1"]');
    await page.uncheck('#skipEdge'); await page.click('#ordSeg [data-v="col"]');
  });

  await t('EXCEL: two sheets, header, values, purity fills, plate map', async () => {
    const f = await save('#xlsx');
    assert.match(path.basename(f), /^rt-liver-set-2-\d{4}-\d\d-\d\d\.xlsx$/);
    const py = require('child_process').spawnSync('python3', ['-c', `
import openpyxl,sys
wb=openpyxl.load_workbook(sys.argv[1]); ws=wb['Normalization']
hdr=[c.value for c in ws[6]]
row=[c.value for c in ws[7]]
print(wb.sheetnames); print(hdr[:4], hdr[8:10]); print(row[2], row[4], row[8], row[9], ws.cell(7,6).fill.fgColor.rgb)
pm=wb['Plate map']; print(pm['B3'].value, pm['B14'].value)`, f], { encoding: 'utf8' });
    if (py.status !== 0 && /No module named/.test(py.stderr || '')) { console.log('    (openpyxl not installed — skipped)'); return; }
    assert.strictEqual(py.status, 0, py.stderr);
    const out = py.stdout.trim().split('\n');
    assert.strictEqual(out[0], "['Normalization', 'Plate map']");
    assert.strictEqual(out[1], "['Done', 'Well', 'Sample', 'Type'] ['Sample (µL)', 'water (µL)']");
    assert.strictEqual(out[2], 'Ctrl 1 412.6 2.4 7.6 FFD7EEDF');
    assert.strictEqual(out[3], 'Ctrl 1 2.4');
  });

  await t('CSV, COPY TABLE, worklist and Tecan .gwl', async () => {
    const csv = fs.readFileSync(await save('#csv'), 'utf8');
    assert(csv.startsWith('﻿DNA/RNA normalization'));
    assert.match(csv, /\r\nA1,Ctrl 1,RNA,412.6,2.08,2.15,,2.4,7.6,10,990.2,OK,\r\n/);
    assert.match(csv, /F1,KO 3,RNA,2650,2.07,2.2,1:4 \(2 \+ 6 µL\),1.51,8.49,10,1000.4,PRE-DILUTE,/);
    await page.click('#copy');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(clip, /Target {2}1 ug in 10 uL per well/);
    assert.match(clip, /A1\tCtrl 1\tRNA\t412.6/);
    await page.click('#robot summary');
    const wl = fs.readFileSync(await save('#worklist'), 'utf8').split('\r\n');
    assert.strictEqual(wl[0], 'Sample,SourceLabware,SourceWell,DestLabware,DestWell,SampleVolume_uL,DiluentVolume_uL,PreDilution');
    assert.strictEqual(wl[1], 'Ctrl 1,Source,A1,Destination,A1,2.4,7.6,');
    assert.strictEqual(wl[6], 'KO 3,Source,F1,Destination,F1,1.51,8.49,1:4');
    const g = fs.readFileSync(await save('#gwl'), 'utf8').split('\r\n');
    assert.deepStrictEqual(g.slice(1, 4), ['A;Diluent;;;1;;7.60', 'D;Destination;;;1;;7.60', 'W;']);
    assert(g.includes('A;Source;;;6;;1.51'));
    await page.click('#robot summary');
  });

  await t('paste a Qubit export: original conc. used, no-ratio note, DNA library preset', async () => {
    await page.click('#exChips [data-ex="qb"]');
    const s = await L();
    assert.deepStrictEqual(s.map((x) => x.k), ['Lib A', 'Lib B', 'Lib C', 'Lib D', 'Lib E', 'Lib F']);
    assert.strictEqual(s[0].sv, 4.1); // 100 / 24.6 = 4.065
    assert.strictEqual(s[4].st, 'dilute');
    assert.match(await page.textContent('#readInfo'), /Qubit 4/);
    assert.match(await page.textContent('#notes'), /a Qubit reads one dye/);
  });

  await t('open files: NanoDrop Eight TSV with decimal commas, an .xlsx export, drop', async () => {
    await page.setInputFiles('#file', FX('nanodrop-eight-rna.tsv'));
    await page.waitForFunction(() => /PBL 1/.test(document.getElementById('rows').textContent));
    let s = await L();
    assert.deepStrictEqual(s.map((x) => x.k), ['PBL 1', 'PBL 2', 'PBL 3']);
    assert.strictEqual(s[2].p280, 'q'); // 8.3 ng/µL: grey
    assert.match(await page.textContent('#readInfo'), /Decimal commas/);
    // an .xlsx laid out like a NanoDrop One export
    const grid = fs.readFileSync(FX('nanodrop-one.csv'), 'utf8').trim().split(/\r?\n/).map((l) => l.split(','));
    const x = path.join(os.tmpdir(), 'nd-one.xlsx');
    fs.writeFileSync(x, NA.xlsx([{ name: 'dsDNA', rows: grid.map((r) => r.map((c) => (c !== '' && !isNaN(+c) ? +c : c))) }]));
    await page.setInputFiles('#file', x);
    await page.waitForFunction(() => /Liver 1/.test(document.getElementById('rows').textContent));
    s = await L();
    assert.deepStrictEqual(s.map((q) => q.k), ['Liver 1', 'Liver 2', 'Blank check']); // repeats averaged
    assert.match(await page.textContent('#rows'), /2 readings · CV/);
    assert.strictEqual(s[2].st, 'nodata');
    // drag and drop a file onto the box
    const dt = await page.evaluateHandle((txt) => { const d = new DataTransfer(); d.items.add(new File([txt], 'list.txt', { type: 'text/plain' })); return d; }, 'A1x 300\nB2y 150');
    await page.dispatchEvent('#drop', 'drop', { dataTransfer: dt });
    await page.waitForFunction(() => /A1x/.test(document.getElementById('rows').textContent));
  });

  await t('typing a list; repeats off; names kept unique', async () => {
    await page.fill('#src', 'S1 100\nS1 120\nS2 80');
    assert.deepStrictEqual((await L()).map((x) => x.k), ['S1', 'S2']);
    await page.uncheck('#merge');
    assert.deepStrictEqual((await L()).map((x) => x.k), ['S1', 'S1 (2)', 'S2']);
    await page.check('#merge');
  });

  await t('hand-offs: master mix gets the number of samples, cryo labels get the names', async () => {
    await page.click('#exChips [data-ex="nd"]');
    await page.click('#toMix');
    await page.waitForURL(/master-mix/);
    assert.strictEqual(await page.inputValue('#n'), '8');
    assert.match(await page.textContent('.lm-handoff-note'), /8 samples from DNA\/RNA Normalization/);
    await page.goto(URL);
    await page.click('#toLabels');
    await page.waitForURL(/cryo-labels/);
    assert.match(await page.textContent('.lm-handoff-note'), /8 sample IDs from DNA\/RNA Normalization/);
    await page.goto(URL);
  });

  await t('print layout: only the sheet, a header, tick boxes, notes', async () => {
    await page.emulateMedia({ media: 'print' });
    assert.strictEqual(await page.isVisible('#printHead'), true);
    assert.strictEqual(await page.isVisible('#src'), false);
    assert.strictEqual(await page.isVisible('#print'), false);
    assert.strictEqual(await page.isVisible('#notes'), true);
    assert.match(await page.textContent('#printHead'), /1 µg in 10 µL per well/);
    const box = await page.$eval('#rows tr td.c-done', (td) => getComputedStyle(td, '::before').content);
    assert.strictEqual(box, '"☐"');
    await page.emulateMedia({ media: 'screen' });
  });

  await t('CLEAR empties the paste but keeps lab settings', async () => {
    await fill('#minv', '1');
    await page.click('#clear');
    assert.strictEqual(await page.inputValue('#src'), '');
    assert.strictEqual(await page.inputValue('#minv'), '1');
    assert.match(await page.textContent('#rows'), /Paste concentrations/);
    await fill('#minv', '0.5');
    await page.click('#exChips [data-ex="nd"]');
  });

  for (const [w, h] of [[1440, 900], [834, 1112], [390, 844]]) {
    await t(`no horizontal scroll at ${w} px (tubes and 96-well)`, async () => {
      await page.setViewportSize({ width: w, height: h });
      for (const lay of ['tubes', '96']) {
        await page.click(`#laySeg [data-v="${lay}"]`);
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        assert(sw <= w, `scrollWidth ${sw} at ${w} (${lay})`);
      }
      await page.click('#laySeg [data-v="tubes"]');
    });
  }

  await t('no JS errors', async () => { assert.deepStrictEqual(errors, []); });
  console.log(`\n${n} tests passed`);
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
