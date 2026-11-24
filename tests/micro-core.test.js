/* Maths of 8.2 Nyquist Calculator (assets/micro-core.js) and the hardware library, in Node.
   Run from the repo root:  node tests/micro-core.test.js
   Numbers are compared with tests/fixtures/micro/reference.json (regenerate: python3 tests/micro_reference.py). */
const assert = require('assert');
const M = require('../assets/micro-core.js');
const ref = require('./fixtures/micro/reference.json');
const fs = require('fs');

let n = 0, worst = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const near = (a, b, what, tol = 1e-9) => {
  const d = Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
  worst = Math.max(worst, d);
  assert(d < tol, `${what}: ${a} vs ${b}`);
};

ref.nyquist.forEach((c, i) => t(`nyquist + resolution case ${i + 1} (${c.in.mode}, NA ${c.in.na}, ${c.in.au} AU) matches Python`, () => {
  const q = M.nyquist(c.in), r = M.resolution(c.in);
  near(q.dx, c.nyq.dx, 'dx'); near(q.dz, c.nyq.dz, 'dz');
  if (c.res === null) assert.strictEqual(r, null);
  else { near(r.lat, c.res.lat, 'lat'); near(r.ax, c.res.ax, 'ax'); }
}));
ref.camera.forEach((c, i) => t(`camera pixel ${i + 1} matches Python`, () => near(M.camera(Object.assign({}, c.in)).pixel, c.pixel, 'pixel')));
ref.scan.forEach((c, i) => t(`scan pixel ${i + 1} matches Python`, () => {
  const o = { mag: c.in.mag, designTube: c.in.designTube, standTube: c.in.standTube, field: c.in.field, zoom: c.in.zoom, frame: [c.in.frame, c.in.frame] };
  near(M.scan(o).pixel, c.pixel, 'pixel');
  // the zoom found for that pixel size gives it back
  near(M.zoomFor(o, c.pixel), c.in.zoom, 'zoomFor');
}));

t('SVI FAQ example: NA 1.3 oil, 520 nm widefield → 100 nm lateral', () => near(M.nyquist({ mode: 'widefield', na: 1.3, n: 1.515, lem: 520 }).dx, 100, 'dx', 1e-12));
t('UQ IMB table: 63×/1.4 oil confocal at 488 nm → 43 nm / 130 nm', () => {
  const q = M.nyquist({ mode: 'confocal', na: 1.4, n: 1.515, lex: 488 });
  assert(Math.abs(q.dx - 43) < 1 && Math.abs(q.dz - 130) < 1.5, q.dx + ' / ' + q.dz);
});
t('two-photon at λex equals confocal formula with k = 2 (SVI eq. 5)', () => {
  const a = M.nyquist({ mode: 'twophoton', na: 1.0, n: 1.333, lex: 920 }), b = M.nyquist({ mode: 'confocal', na: 1.0, n: 1.333, lex: 920 });
  near(a.dx, b.dx, 'dx'); near(a.dz, b.dz, 'dz');
});
t('NA at or above n is refused', () => {
  assert.strictEqual(M.nyquist({ mode: 'widefield', na: 1.4, n: 1.33, lem: 500 }), null);
  const r = M.evaluate({ mode: 'widefield', na: 1.4, n: 1.33, mag: 60, channels: [{ lem: 500 }] });
  assert(!r.ok && r.errors.indexOf('na>=n') >= 0);
});
t('tube lens: a Zeiss (165 mm) 63× on a Nikon (200 mm) stand works as 76.4×', () => near(M.objMag(63, 165, 200), 63 * 200 / 165, 'mag'));
t('verdict thresholds: > 1 under, 0.5–1 ok, < 0.5 over', () => {
  assert.strictEqual(M.verdict(108, 90).state, 'under');
  assert.strictEqual(M.verdict(90, 90).state, 'ok');
  assert.strictEqual(M.verdict(46, 90).state, 'ok');
  assert.strictEqual(M.verdict(44, 90).state, 'over');
});
t('camera options: 60×, 6.5 µm, target 89 nm → 1.5× adapter first, every option meets it', () => {
  const o = M.cameraOptions({ mag: 60, pix: 6.5 }, 89.26);
  assert.strictEqual(o.options[0].bin, 1); assert.strictEqual(o.options[0].adapter, 1.5);
  o.options.forEach(x => assert(x.pixel <= 89.26 + 1e-9));
});
t('page example: Nikon 60×/1.42, 1024 px, 20 mm field, 488 nm confocal → zoom 5.4', () => {
  const z = M.zoomFor({ mag: 60, field: 20, frame: [1024, 1024] }, M.nyquist({ mode: 'confocal', na: 1.42, n: 1.518, lex: 488 }).dx);
  assert.strictEqual(M.zoomUp(z), 5.4);
});
t('evaluate: strictest channel sets the target; z plan rounds down', () => {
  const r = M.evaluate({ mode: 'widefield', na: 1.4, n: 1.515, mag: 60, channels: [{ name: 'GFP', lem: 510 }, { name: 'DAPI', lem: 461 }], camera: { pix: 6.5, px: [2048, 2048], adapter: 1 }, depth: 10 });
  assert.strictEqual(r.target.channel, 'DAPI');
  assert(r.zPlan.step <= r.target.dz / 1000);
  assert.strictEqual(r.zPlan.slices, Math.ceil(10 / r.zPlan.step) + 1);
  assert.strictEqual(r.xy.state, 'under');
});
t('spinning disk: 50 µm pinhole at 100×/1.4, 520 nm ≈ 1.1 AU', () => {
  const d = M.diskAU({ mag: 100, pinhole: 50, na: 1.4, lem: 520 });
  near(d.au, 500 / (1.22 * 520 / 1.4), 'au');
});
t('vignetting: a 29.4 mm chip overfills FN 25 (more so behind a 0.7× adapter); a 18.8 mm chip does not', () => {
  const r = M.camera({ mag: 20, pix: 6.5, px: [3200, 3200], diag: 29.4, adapter: 1, fn: 25 });
  assert.strictEqual(r.vignette, true);
  assert.strictEqual(M.camera({ mag: 20, pix: 6.5, px: [3200, 3200], diag: 29.4, adapter: 0.7, fn: 25 }).vignette, true);
  assert.strictEqual(M.camera({ mag: 20, pix: 6.5, px: [2048, 2048], adapter: 1, fn: 25 }).vignette, false);
});

// hardware library
global.window = {};
eval(fs.readFileSync(__dirname + '/../assets/data/microscopy-data.js', 'utf8'));
const D = global.window.LMT_MICRO;
t('library: every objective passes the checks and has NA below its immersion index', () => {
  D.objectives.forEach(o => { assert.deepStrictEqual(M.checkObjective(Object.assign({ nImm: D.media[o.immersion] }, o)), [], o.id); assert(o.source, o.id); });
});
t('library: every camera passes the checks and has a source', () => D.cameras.forEach(c => { assert.deepStrictEqual(M.checkCamera(c), [], c.id); assert(c.source); }));
t('library: tube lens by maker (Nikon/Leica 200, Evident 180, Zeiss 165)', () => D.objectives.forEach(o => assert.strictEqual(o.tubeLens_mm, M.TUBE[o.brand.toLowerCase()], o.id)));
t('library: ids unique', () => ['objectives', 'cameras', 'scanSystems', 'fluors'].forEach(k => { const ids = D[k].map(x => x.id); assert.strictEqual(new Set(ids).size, ids.length, k); }));

console.log(`\n${n} tests passed · largest relative difference vs Python ${worst.toExponential(1)}`);
