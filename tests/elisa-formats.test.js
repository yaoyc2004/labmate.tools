/* Plate-reader export formats for the ELISA analyzer (tools/elisa).
   Run from the repo root:  NODE_PATH=$(npm root -g) node tests/elisa-formats.test.js
   Needs Playwright with Chromium. Fixtures: tests/fixtures/elisa (make_formats.py) — simulated plates written
   in the vendors' documented layouts, not files exported in a lab. Every file must give the same 96 values. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const DIR = path.resolve(__dirname, 'fixtures/elisa');
const PAGE = 'file://' + path.resolve(__dirname, '../tools/elisa/index.html');
const truth = JSON.parse(fs.readFileSync(path.join(DIR, 'plate.json'), 'utf8'));

const CASES = [
  // file, expected instrument (substring), has a reference read, saturated well is marked
  ['gen5-interleaved.txt', 'BioTek', true, true],
  ['softmax-plate.txt', 'SoftMax', true, true],
  ['tecan-icontrol.csv', 'Tecan', true, true],
  ['bmg-mars-list.csv', 'BMG', true, true],
  ['bmg-mars-matrix.xlsx', 'BMG', true, true],
  ['skanit.xlsx', 'SkanIt', true, true],
  ['envision-list.csv', '', true, false],
  ['paste-bare.txt', '', false, true],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route(/^https?:/, (r) => r.abort());
  await page.goto(PAGE);
  let n = 0;
  for (const [file, inst, hasRef, satMarked] of CASES) {
    const bytes = Array.from(fs.readFileSync(path.join(DIR, file)));
    const out = await page.evaluate(async ([name, bytes]) => {
      const E = window.LME;
      const p = await E.readAny(name, new Uint8Array(bytes).buffer);
      const g = E.guessBlocks(p.plates);
      return { inst: p.instrument, labels: p.plates.map((q) => q.label), g, plates: p.plates.map((q) => ({ od: q.od, sat: q.sat })) };
    }, [file, bytes]);
    assert(out.g.sig >= 0, file + ': no plate found');
    if (inst) assert(out.inst.includes(inst), file + ': instrument ' + out.inst);
    const S = out.plates[out.g.sig];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 12; c++) {
      const t = truth.sig[r][c];
      if (t == null) {
        assert.strictEqual(S.od[r][c], null, file + ' saturated well has a value');
        if (satMarked) assert.strictEqual(S.sat[r][c], true, file + ': overflow not marked as saturated');
      } else assert(Math.abs(S.od[r][c] - t) < 1e-9, `${file} ${'ABCDEFGH'[r]}${c + 1}: ${S.od[r][c]} vs ${t}`);
    }
    if (hasRef) {
      assert(out.g.ref >= 0, file + ': reference read not picked (' + out.labels.join(' | ') + ')');
      const R = out.plates[out.g.ref];
      for (let r = 0; r < 8; r++) for (let c = 0; c < 12; c++) assert(Math.abs(R.od[r][c] - truth.ref[r][c]) < 1e-9, file + ' ref ' + r + ',' + c);
    }
    n++;
    console.log('ok  ' + file.padEnd(24) + (out.inst || '(no instrument named)') + ' — reads: ' + out.labels.join(' | '));
  }
  // non-plate files give a clear error
  const bad = await page.evaluate(async () => { try { await window.LME.readAny('x.xls', new Uint8Array([0xD0, 0xCF, 0x11, 0xE0]).buffer); return 'no error'; } catch (e) { return e.message; } });
  assert.strictEqual(bad, 'xls'); n++; console.log('ok  old .xls is refused with a message');
  assert.deepStrictEqual(errors, []);
  console.log(`\n${n} format tests passed`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
