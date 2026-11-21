/* assets/recipe-core.js against the independent Python reference (tests/recipe_reference.py)
   and against published recipes. Run from the repo root:  node tests/recipe-core.test.js */
const R = require('../assets/recipe-core.js');
const ref = require('./fixtures/recipe/reference.json');
const assert = require('assert');
let n = 0, worst = 0;
const close = (a, b, what) => {
  const d = Math.abs(a - b) / Math.max(1e-12, Math.abs(b));
  worst = Math.max(worst, b === 0 ? Math.abs(a) : d);
  assert(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${what}: ${a} vs ${b}`); n++;
};
const KEYS = ['water', 'tris', 'acryl', 'sds', 'aps', 'temed'];
const byK = (m) => { const o = {}; m.rows.forEach((r) => { o[r.k] = r.v; }); return o; };

ref.mix.forEach((c, i) => {
  const m = R.gelMix(c.inp); assert(m.ok); const o = byK(m);
  KEYS.forEach((k) => close(o[k] || 0, c.out[k], `mix ${i} ${k}`)); close(m.total, c.out.total, `mix ${i} total`);
});
ref.plan.forEach((c, i) => {
  const p = R.gelPlan(c.inp); assert(p.ok);
  p.resolving.forEach((m, j) => { close(m.volume, c.out.res[j].volume, `plan ${i} res ${j} V`); const o = byK(m); KEYS.forEach((k) => close(o[k] || 0, c.out.res[j][k], `plan ${i} res ${j} ${k}`)); });
  close(p.stacking.volume, c.out.stk.volume, `plan ${i} stk V`); const o = byK(p.stacking); KEYS.forEach((k) => close(o[k] || 0, c.out.stk[k], `plan ${i} stk ${k}`));
});
ref.make.forEach((c, i) => {
  const m = R.makeFromComponents(c.inp); assert(m.ok, JSON.stringify(m.errors));
  m.rows.forEach((r, j) => {
    const e = c.out[j];
    if (e === null) { assert(r.skipped); return; }
    if (e[0] === 'g') close(r.amount.g, e[1], `make ${c.inp.recipe} ${j}`); else close(r.amount.mL, e[1], `make ${c.inp.recipe} ${j}`);
  });
});
ref.dilute.forEach((c) => {
  const d = R.diluteStock({ from: c.inp.from_, to: c.inp.to, V: c.inp.V, components: c.inp.components }); assert(d.ok);
  close(d.stockV, c.out.stockV, 'dilute stock'); close(d.water, c.out.water, 'dilute water');
  d.adds.forEach((a, j) => close(a.amount.mL, c.out.adds[j], 'dilute add'));
});

// published recipes (rounded as printed)
const r2 = (x) => Math.round(x * 100) / 100;
let m = byK(R.gelMix({ kind: 'resolving', volume: 10, pct: 10, water: 'nominal' }));
assert.deepStrictEqual([r2(m.acryl), m.tris, m.sds, m.aps, m.temed, Math.round(m.water * 10) / 10], [3.33, 2.5, 0.1, 0.05, 0.005, 4.1]); n++; // Bio-Rad 10007296
m = byK(R.gelMix({ kind: 'resolving', volume: 10, pct: 10, water: 'strict', stocks: Object.assign({}, R.GEL_STOCKS, { acryl: 40 }) }));
assert.strictEqual(r2(m.water), 4.85); n++; // Robertson lab: 4.85 mL
m = byK(R.gelMix({ kind: 'stacking', volume: 10, pct: 4, water: 'strict', stocks: Object.assign({}, R.GEL_STOCKS, { acryl: 40 }) }));
assert.deepStrictEqual([m.acryl, m.tris, m.aps, m.temed], [1, 2.5, 0.05, 0.01]); assert(Math.abs(m.water - 6.34) < 0.006); n++; // Robertson 6.35
const pbs = R.makeFromComponents({ components: R.preset('pbs').comps, x: 10, V: 1000 }).rows.map((r) => r.amount.g);
assert.deepStrictEqual(pbs.map((g) => Math.round(g)), [80, 2, 14, 2]); n++; // Fisher 80 / 2 / 14.4 / 2.4
const tbe = R.makeFromComponents({ components: R.preset('tbe').comps, x: 5, V: 1000 }).rows.map((r) => r.amount);
assert.deepStrictEqual([Math.round(tbe[0].g), Math.round(tbe[1].g * 2) / 2, tbe[2].mL], [54, 27.5, 20]); n++; // CSH 54 g / 27.5 g / 20 mL
const tae = R.makeFromComponents({ components: R.preset('tae').comps, x: 10, V: 1000 }).rows.map((r) => r.amount);
assert.deepStrictEqual([Math.round(tae[0].g * 10) / 10, Math.round(tae[1].mL * 10) / 10], [48.5, 11.4]); n++; // Fisher 48.4 g / 11.4 mL

// refusals
assert(!R.gelMix({ kind: 'resolving', volume: 10, pct: 30 }).ok); n++;
assert.deepStrictEqual(R.gelMix({ kind: 'resolving', volume: 10, pct: 25, finals: { tris: 1.4, sds: 0.1, aps: 0.05, temed: 0.05 } }).errors, ['no-room']); n++;
assert.strictEqual(R.componentAmount({ c: 20, u: 'v/v', form: 'powder' }, 1, 1000).error, 'form'); n++;
assert.strictEqual(R.componentAmount({ c: 1, u: 'M', form: 'stock', stock: 0.5 }, 1, 1000).error, 'over-stock'); n++;
assert.strictEqual(R.makeFromComponents({ components: R.preset('towbin').comps, x: 10, V: 1000 }).rows[2].skipped, true); n++;
assert(!R.diluteStock({ from: 1, to: 10, V: 100 }).ok); n++;
console.log(`ok  ${n} checks, largest relative difference to the Python reference ${worst.toExponential(1)}`);
