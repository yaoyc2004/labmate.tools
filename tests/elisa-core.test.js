/* Maths of the ELISA analyzer (tools/elisa/elisa-core.js), in Node — no browser needed.
   Run from the repo root:  node tests/elisa-core.test.js
   1. 4PL and 5PL fits (unweighted, 1/Y, 1/Y²) against SciPy's MINPACK Levenberg–Marquardt on four simulated
      standard curves (tests/fixtures/elisa/scipy-fits.json, regenerate with python3 tests/elisa_reference.py).
   2. The analysis rules: inverse, back-calculation, quantification range, flags, advice, blank handling,
      competitive assays, exclusions. All data are simulated. */
const assert = require('assert');
const E = require('../tools/elisa/elisa-core.js');
const sets = require('./fixtures/elisa/scipy-fits.json');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
const K = ['A', 'B', 'C', 'D', 'G'];

// ---------------------------------------------------------------- 1. against SciPy
for (const d of sets) for (const w of ['none', '1/y', '1/y2']) {
  t(`${d.name}, weights ${w}: 4PL/5PL match SciPy`, () => {
    const pts = d.x.map((x, i) => ({ x, y: d.y[i] }));
    const b = E.fitBoth(pts, 'auto', w), r = d.scipy[w];
    assert(b.f4.converged);
    r.p4.forEach((v, i) => assert(rel(b.f4.p[K[i]], v) < 1e-5, `4PL ${K[i]} ${b.f4.p[K[i]]} vs ${v}`));
    assert(rel(b.f4.ssr, r.ssr4) < 1e-8);
    r.se4.forEach((v, i) => assert(rel(b.f4.se[K[i]], v) < 1e-4, `4PL SE ${K[i]}`));
    if (d.name === 'sandwich-single-nozero') {
      // 6 single wells cannot carry 5 parameters: the 5PL must be refused and 4PL used
      assert(!E.trusted(b.f5)); assert(!b.fit.five);
      return;
    }
    r.p5.forEach((v, i) => assert(rel(b.f5.p[K[i]], v) < 1e-5, `5PL ${K[i]} ${b.f5.p[K[i]]} vs ${v}`));
    assert(rel(b.f5.ssr, r.ssr5) < 1e-8);
    r.se5.forEach((v, i) => assert(rel(b.f5.se[K[i]], v) < 1e-3, `5PL SE ${K[i]}`));
    assert(Math.abs(b.test.p - r.pF) < 1e-6, `F-test p ${b.test.p} vs ${r.pF}`);
    // model choice: 5PL only for the curve simulated as asymmetric
    assert.strictEqual(b.fit.five, d.name === 'sandwich-5pl-trip', 'auto model choice ' + b.why);
  });
}

// ---------------------------------------------------------------- 2. rules
t('inverse is exact for 4PL and 5PL, both directions', () => {
  [{ A: 0.05, B: 1.2, C: 150, D: 3, G: 1 }, { A: 0.05, B: 1.6, C: 40, D: 3.6, G: 0.35 }, { A: 2.2, B: 0.9, C: 15, D: 0.12, G: 1 }, { A: 2.2, B: 1.3, C: 15, D: 0.12, G: 2.5 }].forEach((p) => {
    [0.3, 1, 7, 40, 150, 900].forEach((x) => { const y = E.f(p, x), b = E.inv(p, y); assert(rel(b.x, x) < 1e-9, JSON.stringify([p, x, b])); });
  });
});
t('worked example on the page: OD 1.20 at 1:10 → 103.3 and 1033 pg/mL', () => {
  const x = E.inv({ A: 0.05, B: 1.2, C: 150, D: 3.0, G: 1 }, 1.2).x;
  assert.strictEqual(x.toFixed(1), '103.3'); assert.strictEqual((x * 10).toFixed(0), '1033');
});
t('beyond the asymptotes: below the zero end → low, past saturation → high', () => {
  const p = { A: 0.05, B: 1.2, C: 150, D: 3, G: 1 };
  assert.deepStrictEqual(E.inv(p, 0.03), { x: null, side: 'low' });
  assert.deepStrictEqual(E.inv(p, 3.2), { x: null, side: 'high' });
  const q = { A: 2.2, B: 1, C: 15, D: 0.1, G: 1 }; // competitive
  assert.strictEqual(E.inv(q, 2.4).side, 'low'); assert.strictEqual(E.inv(q, 0.05).side, 'high');
});
t('nice folds', () => {
  assert.strictEqual(E.niceUp(7.3), 10); assert.strictEqual(E.niceUp(2.1), 2.5); assert.strictEqual(E.niceUp(4), 4);
  assert.strictEqual(E.niceDown(3.9), 2.5); assert.strictEqual(E.niceDown(60), 50);
});

// a plate built from a known 4PL
const P = { A: 0.06, B: 1.1, C: 200, D: 3.3, G: 1 };
function plate(extra) {
  const od = E.ROWS.map(() => new Array(12).fill(null)), sat = E.ROWS.map(() => new Array(12).fill(false));
  const wells = {}, groups = {};
  const conc = E.series(500, 2, 8, true);
  conc.forEach((c, i) => {
    groups['STD' + (i + 1)] = { t: 'std', conc: c };
    [0, 1].forEach((k) => { wells[E.ROWS[i] + (k + 1)] = { t: 'std', id: 'STD' + (i + 1) }; od[i][k] = E.f(P, c) * (k ? 1.01 : 0.99); });
  });
  const smp = (id, w, x, dil) => { groups[id] = { t: 'smp', name: id, dil }; w.forEach((ww, k) => { const q = E.parseWell(ww); wells[ww] = { t: 'smp', id }; od[q.r][q.c] = E.f(P, x) * (k ? 1.005 : 0.995); }); };
  smp('S1', ['A3', 'A4'], 100, 10);   // in range → 1000
  smp('S2', ['A5', 'A6'], 900, 2);    // > ULOQ (500)
  smp('S3', ['A7', 'A8'], 3, 4);      // < LLOQ (7.8)
  smp('S4', ['A9', 'A10'], 50, 1);    // high CV (edited below)
  smp('S5', ['A11', 'A12'], 2000, 1); // one saturated well
  od[0][9] *= 1.5;
  sat[0][11] = true; od[0][11] = null;
  groups.C1 = { t: 'ctl', name: 'ctrl', conc: 200, dil: 2 };
  ['B3', 'B4'].forEach((w, k) => { const q = E.parseWell(w); wells[w] = { t: 'ctl', id: 'C1' }; od[q.r][q.c] = E.f(P, 70); });
  if (extra) extra(od, wells, groups);
  return { plate: { od, sat }, wells, groups };
}
const base = { model: '4pl', weight: '1/y2', blank: 'none', zeroFit: true, cvMax: 15, range: 'recovery' };

t('example plate: range, flags, advice', () => {
  const x = plate(), a = E.analyse(x.plate, x.wells, x.groups, base);
  assert(a.ok); assert.strictEqual(a.format, 'sandwich');
  assert(rel(a.lloq, 7.8125) < 1e-12 && rel(a.uloq, 500) < 1e-12, a.lloq + ' ' + a.uloq);
  const S = Object.fromEntries(a.smp.map((o) => [o.id, o]));
  assert.strictEqual(S.S1.status, 'ok'); assert(rel(S.S1.final, 1000) < 0.01, S.S1.final);
  assert.strictEqual(S.S2.status, 'high');
  assert.deepStrictEqual([S.S2.advice.kind, S.S2.advice.fold, S.S2.advice.newDil], ['dilute', 20, 40]); // 900 / 62.5 = 14.4 → 20
  assert.strictEqual(S.S3.status, 'low');
  assert.deepStrictEqual([S.S3.advice.kind, S.S3.advice.newDil], ['less', 1]);
  assert(S.S4.flags.includes('cv')); assert.strictEqual(S.S4.advice.kind, 'repeat');
  assert.strictEqual(S.S5.status, 'above'); assert(S.S5.flags.includes('sat')); assert(S.S5.advice.atLeast);
  const C = a.ctl[0]; assert(rel(C.rec, 70) < 0.02, C.rec); assert(C.flags.includes('rec'));
  // back-calculated standards recover ~100%
  a.std.filter((s) => s.conc > 0).forEach((s) => assert(Math.abs(s.rec - 100) < 2, s.id + ' ' + s.rec));
});
t('excluding the odd well clears the CV flag', () => {
  const x = plate(), a = E.analyse(x.plate, x.wells, x.groups, Object.assign({}, base, { excluded: { A10: 1 } }));
  const s4 = a.smp.find((o) => o.id === 'S4');
  assert(!s4.flags.includes('cv')); assert(s4.flags.includes('single')); assert.strictEqual(s4.status, 'ok');
});
t('a bad top standard pulls the curve: the range shrinks to the standards that still recover', () => {
  const x = plate((od) => { od[0][0] *= 0.8; od[0][1] *= 0.8; });
  const a = E.analyse(x.plate, x.wells, x.groups, base);
  // STD1 reads 77%, STD2 is dragged to 134%: the range ends at STD3 (125)
  assert(rel(a.uloq, 125) < 1e-12, 'ULOQ ' + a.uloq);
  assert(!a.std.find((s) => s.id === 'STD1').inRange && !a.std.find((s) => s.id === 'STD2').inRange);
  assert.strictEqual(a.smp.find((o) => o.id === 'S1').status, 'ok');
  const all = E.analyse(x.plate, x.wells, x.groups, Object.assign({}, base, { range: 'standards' }));
  assert.strictEqual(all.uloq, 500);
});
t('blank subtraction: blank wells and zero standard', () => {
  const x = plate((od, wells, groups) => { ['H11', 'H12'].forEach((w) => { const q = E.parseWell(w); wells[w] = { t: 'blk', id: 'BLK' }; od[q.r][q.c] = 0.04; }); groups.BLK = { t: 'blk' }; });
  const a = E.analyse(x.plate, x.wells, x.groups, Object.assign({}, base, { blank: 'blk' }));
  assert.strictEqual(a.subtract.what, 'blk'); assert(Math.abs(a.subtract.value - 0.04) < 1e-12);
  assert(Math.abs(a.wells.A3.v - (a.wells.A3.raw - 0.04)) < 1e-12);
  const z = E.analyse(x.plate, x.wells, x.groups, Object.assign({}, base, { blank: 'zero', zeroFit: false }));
  assert.strictEqual(z.subtract.what, 'zero'); assert(Math.abs(z.subtract.value - P.A) < 1e-9);
  assert.strictEqual(z.std.find((s) => s.conc === 0).inFit, false);
  assert(rel(z.smp.find((o) => o.id === 'S1').final, 1000) < 0.02);
});
t('competitive assay: direction, LOD below the zero signal, %B/B0', () => {
  const Q = { A: 2.4, B: 1.0, C: 20, D: 0.1, G: 1 };
  const od = E.ROWS.map(() => new Array(12).fill(null)), wells = {}, groups = {};
  E.series(1000, 3, 8, true).forEach((c, i) => { groups['STD' + (i + 1)] = { t: 'std', conc: c }; [0, 1].forEach((k) => { wells[E.ROWS[i] + (k + 1)] = { t: 'std', id: 'STD' + (i + 1) }; od[i][k] = E.f(Q, c) * (1 + (k ? 0.02 : -0.02)); }); });
  groups.S1 = { t: 'smp', name: 'S1', dil: 5 }; wells.A3 = wells.A4 = null; wells.A3 = { t: 'smp', id: 'S1' }; wells.A4 = { t: 'smp', id: 'S1' };
  od[0][2] = od[0][3] = E.f(Q, 20);
  const a = E.analyse({ od, sat: null }, wells, groups, Object.assign({}, base, { format: 'auto' }));
  assert.strictEqual(a.format, 'competitive'); assert.strictEqual(a.dir, 'down');
  assert(a.lod.y < a.lod.mean, 'LOD should be below the zero signal');
  const s = a.smp[0]; assert(rel(s.final, 100) < 0.01, s.final); assert(Math.abs(s.bb0 - 100 * E.f(Q, 20) / 2.4) < 1);
  const w = E.analyse({ od, sat: null }, wells, groups, Object.assign({}, base, { format: 'sandwich' }));
  assert(w.warnings.some((q) => q.code === 'dir'));
});
t('too few standards → no fit, no crash', () => {
  const od = E.ROWS.map(() => new Array(12).fill(0.5)), wells = { A1: { t: 'std', id: 'STD1' }, B1: { t: 'std', id: 'STD2' } };
  const a = E.analyse({ od }, wells, { STD1: { t: 'std', conc: 10 }, STD2: { t: 'std', conc: 5 } }, base);
  assert.strictEqual(a.ok, false); assert.strictEqual(a.why, 'few');
});
t('layout presets', () => {
  const p = E.preset('cols12');
  assert.strictEqual(Object.keys(p).length, 96); assert.deepStrictEqual(p.A3, { t: 'smp', id: 'S1' }); assert.deepStrictEqual(p.H12, { t: 'smp', id: 'S40' });
  const q = E.preset('cols123'); assert.deepStrictEqual(q.C3, { t: 'std', id: 'STD3' }); assert.deepStrictEqual(q.A7, { t: 'smp', id: 'S2' });
});

console.log(`\n${n} tests passed`);
