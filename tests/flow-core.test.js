/* Maths of 7.2 Antibody Titration and 7.3 Staining Cocktail (assets/flow-core.js), in Node.
   Run from the repo root:  node tests/flow-core.test.js
   Numbers are compared with tests/fixtures/flow/reference.json (regenerate: python3 tests/flow_reference.py). */
const assert = require('assert');
const F = require('../assets/flow-core.js');
const ref = require('./fixtures/flow/reference.json');

let n = 0, worst = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const near = (a, b, what) => {
  if (b === null) { assert.strictEqual(a, null, what); return; }
  const d = Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
  worst = Math.max(worst, d);
  assert(d < 1e-9, `${what}: ${a} vs ${b}`);
};

ref.series.forEach((c, k) => t(`series ${k + 1} (${c.in.points} points, ×${c.in.factor}) matches Python`, () => {
  const r = F.series(Object.assign({ mode: 'serial' }, c.in));
  assert(r.ok);
  near(r.keep, c.out.keep, 'keep'); near(r.transfer, c.out.transfer, 'transfer');
  near(r.first.total, c.out.firstTotal, 'tube 1 total'); near(r.first.stock, c.out.firstStock, 'tube 1 stock');
  c.out.tubes.forEach((e, i) => {
    near(r.tubes[i].amount, e.amount, 'amount ' + i); near(r.tubes[i].ulStock, e.ulStock, 'µL ' + i);
    near(r.tubes[i].dil, e.dil, 'dil ' + i); near(r.tubes[i].finalUgMl, e.finalUgMl, 'µg/mL ' + i);
  });
}));

t('serial transfer leaves every tube with the same volume and a factor-f step', () => {
  const r = F.series({ stock: 0.2, rec: 0.25, finalVol: 100, cellVol: 50, top: 4, factor: 2, points: 8, mode: 'serial', extra: 0.1 });
  // tube 1 after giving T away; tube i receives T into keep µL buffer
  assert(Math.abs(r.first.total - r.transfer - r.keep) < 1e-9);
  assert(Math.abs(r.transfer / (r.transfer + r.buffer) - 1 / 2) < 1e-12);
  assert.strictEqual(r.discard, r.transfer);
});

t('direct mode: a volume under 0.5 µL gets a predilution of at least 2 µL', () => {
  const r = F.series({ stock: null, rec: 5, finalVol: 100, cellVol: 50, top: 4, factor: 2, points: 10, mode: 'direct', extra: 0.1 });
  r.tubes.forEach(x => {
    if (x.ulStock >= 0.5) { assert.strictEqual(x.pre.d, 1); assert.strictEqual(x.add, x.ulStock); }
    else { assert(x.pre.d > 1 && x.add >= 2 - 1e-9, 'tube ' + x.n); assert(Math.abs(x.add / x.pre.d - x.ulStock) < 1e-12); }
    assert(Math.abs(x.add + x.buffer - r.vMix) < 1e-9);
  });
});

t('predilution factors are 1/2/2.5/4/5 × 10^k and the stock pipetted is ≥ 2 µL', () => {
  [0.4, 0.1, 0.03, 0.0125, 0.007].forEach(v => {
    const p = F.predilute(v, 8);
    const m = p.d / Math.pow(10, Math.floor(Math.log10(p.d)));
    assert([1, 2, 2.5, 4, 5].some(x => Math.abs(x - m) < 1e-9), 'factor ' + p.d);
    assert(p.make.stock >= 2 - 1e-9); assert(Math.abs(p.make.total - p.make.stock * p.d) < 1e-9);
  });
});

t('invalid series inputs are refused, not computed', () => {
  assert.deepStrictEqual(F.series({ stock: 0.2, rec: 0, finalVol: 100, cellVol: 100, top: 4, factor: 1, points: 1, extra: 0 }).err,
    ['rec', 'cellVol', 'factor', 'points']);
});

ref.index.forEach((c, k) => t(`stain, separation and S/N index ${k + 1} match Python`, () => {
  near(F.index(c, 'si'), c.si, 'SI'); near(F.index(c, 'sep'), c.sep, 'sep'); near(F.index(c, 'sn'), c.sn, 'S/N');
}));

const rowsFrom = (xs, pos, neg, sd) => xs.map((x, i) => ({ x, label: 'r' + i, pos: pos[i], neg: neg[i], sd: sd && sd[i] }));
t('best = highest index; lean = lowest amount within 90% of it', () => {
  const a = F.analyse(rowsFrom([0.0625, 0.125, 0.25, 0.5, 1], [9000, 27500, 30000, 33000, 34000], [300, 300, 320, 400, 700], [100, 100, 100, 110, 160]), 'auto');
  assert.strictEqual(a.method, 'si');
  assert.strictEqual(a.best.x, 0.25);          // SI 148.4 at 0.25 vs 148.2 at 0.5
  assert.strictEqual(a.lean.x, 0.125);         // SI 136 ≥ 0.9 × 148.4
  assert.deepStrictEqual(a.flags, ['bgUp']);   // negative 700 at the top vs 300 at the bottom
});
t('flags: still rising at the top, background more than doubles', () => {
  const a = F.analyse(rowsFrom([0.1, 0.2, 0.4], [1000, 3000, 9000], [100, 150, 250], [20, 20, 20]), 'si');
  assert(a.flags.includes('topBest')); assert(a.flags.includes('bgUp'));
});
t('method falls back to separation index, then S/N', () => {
  const r = rowsFrom([1, 2], [100, 200], [10, 10]);
  assert.strictEqual(F.analyse(r, 'auto').method, 'sn');
  r.forEach(x => { x.p84 = 14; });
  assert.strictEqual(F.analyse(r, 'auto').method, 'sep');
});

t('sample names → amounts', () => {
  const cases = { 'CD4 1:200.fcs': ['dil', 200], 'tube 1/50': ['dil', 50], 'Ab_1-400': ['dil', 400], '0.25ug': ['ug', 0.25],
    '0,125 µg CD8': ['ug', 0.125], '62.5 ng': ['ug', 0.0625], '2 uL': ['ul', 2], '4x': ['mult', 4] };
  Object.keys(cases).forEach(s => { const a = F.labelAmount(s); assert(a, s); assert.strictEqual(a.kind, cases[s][0], s); near(a.v, cases[s][1], s); });
  assert.strictEqual(F.labelAmount('Unstained'), null);
});

t('FlowJo table: columns found by name, mean/SD rows dropped', () => {
  const txt = 'Name\tLymphocytes/CD4+ | Median (Comp-BV421-A)\tLymphocytes/CD4- | Median (Comp-BV421-A)\tLymphocytes/CD4- | Robust SD (Comp-BV421-A)\tCount\n' +
    '1:25.fcs\t52000\t900\t300\t9000\n1:50.fcs\t50000\t600\t250\t9100\nMean\t1\t2\t3\t4\nSD\t1\t1\t1\t1\n';
  const r = F.readTable(txt);
  assert.deepStrictEqual(r.guess, { name: 0, pos: 1, neg: 2, sd: 3, p84: -1 });
  assert.strictEqual(r.rows.length, 2);
});
t('semicolon CSV with decimal commas and an 84th percentile column', () => {
  const txt = 'Sample;Pos MFI;Neg MFI;Neg 84th percentile\n0,25 ug;1830,5;211,2;290,1\n0,125 ug;1500;200;280\n';
  const r = F.readTable(txt);
  assert.deepStrictEqual(r.guess, { name: 0, pos: 1, neg: 2, sd: -1, p84: 3 });
});
t('bare numbers: name, pos, neg, sd in order', () => {
  const r = F.readTable('1:100 30000 400 120\n1:200 25000 380 115');
  assert.deepStrictEqual(r.guess, { name: 0, pos: 1, neg: 2, sd: 3, p84: -1 });
});

ref.cocktail.forEach((c, k) => t(`cocktail ${k + 1} (${c.in.tubes} tubes) matches Python`, () => {
  const r = F.cocktail({ tubes: c.in.tubes, overMode: 'pct', over: c.in.over, finalVol: c.in.finalVol, cocktailVol: c.in.cocktailVol, bsb: c.in.bsb,
    abs: c.in.abs.map((a, i) => ({ name: 'Ab' + i, fluor: 'PE', use: a[0], value: a[1], stock: a[2] })) });
  near(r.n, c.out.n, 'n');
  c.out.perTest.forEach((v, i) => { near(r.lines[i].perTest, v, 'per test ' + i); near(r.lines[i].total, c.out.total[i], 'total ' + i); });
  near(r.bufferPerTest, c.out.bufferPerTest, 'buffer'); near(r.bufferTotal, c.out.bufferTotal, 'buffer total');
}));
t('cocktail warnings: too much antibody, two Brilliant dyes without buffer, under 0.5 µL', () => {
  const r = F.cocktail({ tubes: 2, overMode: 'tubes', over: 0, finalVol: 100, cocktailVol: 5, bsb: 0,
    abs: [{ fluor: 'BV421', use: 'ul', value: 5 }, { fluor: 'BUV395', use: 'ul', value: 1 }, { fluor: 'FITC', use: 'dil', value: 1000 }] });
  assert.deepStrictEqual(r.warn, ['tooMuch', 'needBsb', 'small']);
  near(r.minCocktail, 6.1, 'min');
  assert.strictEqual(r.lines[2].minTubes, 5);
});
t('viability dye is listed apart and not counted in the cocktail', () => {
  const r = F.cocktail({ tubes: 10, overMode: 'tubes', over: 1, finalVol: 100, cocktailVol: 50, bsb: 0,
    abs: [{ fluor: 'PE', use: 'ul', value: 2 }, { fluor: 'Zombie NIR', use: 'dil', value: 1000, viability: true }] });
  assert.strictEqual(r.lines.length, 1); assert.strictEqual(r.live.length, 1);
  near(r.n, 11, 'n'); near(r.bufferPerTest, 48, 'buffer');
});
t('library lookup by target and fluor ignores case, spaces and dashes', () => {
  const lib = [{ target: 'CD4', fluor: 'PE-Cy7', clone: 'RPA-T4' }, { target: 'CD4', fluor: 'BV421' }];
  assert.strictEqual(F.libFind(lib, 'cd4 ', 'pe cy7').clone, 'RPA-T4');
  assert.strictEqual(F.libFind(lib, 'CD8', 'PE-Cy7'), null);
});

console.log(`\n${n} tests passed, largest relative difference to the Python reference ${worst.toExponential(1)}`);
