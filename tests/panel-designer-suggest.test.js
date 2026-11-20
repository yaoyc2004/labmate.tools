/* Regression tests for Panel Designer SUGGEST (tools/panel-designer).
   Run from the repo root:  NODE_PATH=$(npm root -g) node tests/panel-designer-suggest.test.js
   Needs Playwright with Chromium. All panels here are synthetic test cases, not user data. */
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

const PAGE = 'file://' + path.resolve(__dirname, '../tools/panel-designer/index.html');
const ATTUNE = 'thermo-attune-nxt-4l-14c', AURORA = 'cytek-aurora-5l';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route(/^https?:/, (r) => r.abort());               // no analytics or fonts in tests
  await page.addInitScript(() => { window.LMT_PD_TEST = {}; });
  await page.goto(PAGE);

  // suggest(rows, rowIndex) -> [{id, cost, why, det, alt}]
  const sg = (inst, rows, i) => page.evaluate(([inst, rows, i]) => {
    const A = window.LMT_PD_TEST.api, m = A.setPanel(inst, rows);
    return A.suggest(i, m).map((x) => ({ id: x.f.id, cost: x.cost, why: x.why.join(' | '), det: x.det.key, alt: x.altOf ? x.altOf.f.id : null }));
  }, [inst, rows, i]);
  const ids = (l) => l.map((x) => x.id);
  let n = 0;
  const t = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

  // ---- F02: candidates vs dyes already in the panel ----
  await t('conventional: BV421 in panel -> Alexa Fluor 405 not suggested (same detector)', async () => {
    const l = await sg(ATTUNE, [['CD3', 'high', 'bv421'], ['X', 'low', null]], 1);
    assert(!ids(l).includes('alexa-fluor-405'), ids(l));
  });
  await t('conventional: Alexa Fluor 405 in panel -> BV421 not suggested', async () => {
    const l = await sg(ATTUNE, [['CD3', 'high', 'alexa-fluor-405'], ['X', 'low', null]], 1);
    assert(!ids(l).includes('bv421'), ids(l));
  });
  await t('spectral: BV421 in panel -> Alexa Fluor 405 not suggested (similarity >= 0.92)', async () => {
    const l = await sg(AURORA, [['CD3', 'high', 'bv421'], ['X', 'low', null]], 1);
    assert(!ids(l).includes('alexa-fluor-405'), ids(l));
    const sim = await page.evaluate(() => window.LMT_PD_TEST.api.setPanel('cytek-aurora-5l', [['a', '', 'bv421'], ['b', '', 'alexa-fluor-405']]).sim[0][1]);
    assert(sim >= 0.92, sim);
  });
  await t('same-row alternatives on one detector are labelled "either ... not both"', async () => {
    const l = await sg(ATTUNE, [['CD8', 'high', 'fitc'], ['X', '', null]], 1);
    const a = l.find((x) => x.id === 'alexa-fluor-405'), b = l.find((x) => x.id === 'bv421');
    assert(a && b, ids(l));
    const later = l.indexOf(a) > l.indexOf(b) ? a : b, first = later === a ? b : a;
    assert.strictEqual(later.alt, first.id);
    assert(/either this or .*not both/.test(later.why), later.why);
    assert.strictEqual(first.alt, null);
  });
  await t('spectral same-row alternatives are labelled by signature similarity', async () => {
    const l = await sg(AURORA, [['X', '', null]], 0);
    const alts = l.filter((x) => x.alt);
    assert(alts.length >= 1, JSON.stringify(l));
    assert(alts.every((x) => /near-identical signature/.test(x.why)));
  });
  await t('every candidate in a conventional list without alt label uses its own detector', async () => {
    const l = await sg(ATTUNE, [['CD3', 'high', 'bv421'], ['CD8', 'high', 'fitc'], ['X', 'med', null]], 2);
    const seen = {};
    l.forEach((x) => { if (!x.alt) { assert(!seen[x.det], x.id + ' shares ' + x.det); seen[x.det] = 1; } });
  });

  // ---- F01: expression x brightness ----
  // full scored list (not just the top 4) so cost comparisons do not depend on truncation
  const all = (inst, rows, i) => page.evaluate(([inst, rows, i]) => {
    const A = window.LMT_PD_TEST.api, m = A.setPanel(inst, rows);
    const o = {}; A.suggest(i, m, 9999).forEach((x) => { o[x.f.id] = { cost: x.cost, why: x.why.join(' | ') }; }); return o;
  }, [inst, rows, i]);
  await t('known-bright dye (PE, 5/5) costs less for LOW than MED than HIGH; unknown-brightness dyes do not move between MED and HIGH', async () => {
    const base = [['CD3', 'high', 'bv421']];
    const lo = await all(ATTUNE, base.concat([['X', 'low', null]]), 1), hi = await all(ATTUNE, base.concat([['X', 'high', null]]), 1), md = await all(ATTUNE, base.concat([['X', 'med', null]]), 1);
    assert(lo.pe.cost < md.pe.cost && md.pe.cost < hi.pe.cost, JSON.stringify([lo.pe, md.pe, hi.pe]));
    assert(/bright dye \(5\/5\) for a dim marker/.test(lo.pe.why), lo.pe.why);
    assert(/brightness unknown/.test(lo['bv711'] ? lo['bv711'].why : lo['percp-cy5-5'].why));
    for (const id of Object.keys(lo)) {
      const f = await page.evaluate((id) => window.LMT_PD_TEST.api.fluor(id).brightness || null, id);
      // LOW also weights spill received x1.5 (by design), so compare MED and HIGH, which differ only in brightness terms
      if (f == null) assert.strictEqual(md[id].cost, hi[id].cost, id + ' has no brightness but its cost moved with expression');
    }
  });
  await t('known-dim dye (Pacific Blue, 1/5) is penalised for a LOW marker and the reason is shown', async () => {
    const lo = await all(ATTUNE, [['X', 'low', null]], 0), hi = await all(ATTUNE, [['X', 'high', null]], 0);
    assert(lo['pacific-blue'].cost > hi['pacific-blue'].cost);
    assert(/dim dye \(1\/5\) for a dim marker/.test(lo['pacific-blue'].why), lo['pacific-blue'].why);
  });
  await t("row's own DYE 1-5 rating is used for the dye already on a CHECK row", async () => {
    const r = await page.evaluate(() => {
      const A = window.LMT_PD_TEST.api;
      const run = (b) => { const m = A.setPanel('thermo-attune-nxt-4l-14c', [['X', 'low', 'bv421', b]]); const x = A.suggest(0, m, 9999).find((y) => y.f.id === 'bv421'); return x && { cost: x.cost, why: x.why.join('|') }; };
      return { none: run(null), five: run(5) };
    });
    assert(r.none && /brightness unknown/.test(r.none.why));
    assert(r.five && /bright dye \(5\/5\)/.test(r.five.why) && r.five.cost < r.none.cost, JSON.stringify(r));
  });
  await t('no expression set -> no brightness reasoning attached', async () => {
    const l = await sg(ATTUNE, [['X', '', null]], 0);
    l.forEach((x) => assert(!/brightness/.test(x.why), x.why));
  });

  // ---- F03: PerCP-Cy5.5 candidate is scored, not forced ----
  await t('PerCP-Cy5.5 is excluded once BL3 is taken; PerCP on the same detector is marked as its alternative', async () => {
    const l = await sg(ATTUNE, [['CD3', 'high', 'bv421'], ['CD8', 'high', 'fitc'], ['X', 'low', null]], 2);
    if (l.find((x) => x.id === 'percp-cy5-5') && l.find((x) => x.id === 'percp')) {
      const a = l.find((x) => x.id === 'percp-cy5-5'), b = l.find((x) => x.id === 'percp');
      assert(a.alt === 'percp' || b.alt === 'percp-cy5-5');
    }
    const l2 = await sg(ATTUNE, [['CD3', 'high', 'percp-cy5-5'], ['X', 'low', null]], 1);
    assert(!ids(l2).includes('percp') && !ids(l2).includes('percp-cy5-5'), ids(l2));
  });

  // ---- save / restore ----
  await t('share link round-trip keeps expression and DYE rating, and SUGGEST gives the same list', async () => {
    const rows = [['CD3', 'high', 'bv421', null], ['CD25', 'low', null, null], ['CD127', 'low', 'apc', 4]];
    const before = await sg(ATTUNE, rows, 1);
    const hash = await page.evaluate((rows) => '#p=' + btoa(unescape(encodeURIComponent(JSON.stringify({ v: 1, i: 'thermo-attune-nxt-4l-14c', inst: null, rows: rows.map((r) => [r[0], r[1], r[2], null, r[3]]), fl: [] })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), rows);
    const p2 = await browser.newPage();
    await p2.route(/^https?:/, (r) => r.abort());
    await p2.addInitScript(() => { window.LMT_PD_TEST = {}; });
    await p2.goto(PAGE + hash);
    const after = await p2.evaluate(() => {
      const A = window.LMT_PD_TEST.api, st = A.state();
      return { rows: st.rows.map((r) => [r.marker, r.expr, r.fluorId, r.bright]), sg: A.suggest(1, A.analyse()).map((x) => x.f.id) };
    });
    assert.deepStrictEqual(after.rows, rows.map((r) => [r[0], r[1], r[2], r[3]]));
    assert.deepStrictEqual(after.sg, ids(before));
    await p2.close();
  });

  // ---- rendered UI ----
  await t('suggestion panel renders the one-row note and the brightness note', async () => {
    const hash = await page.evaluate(() => '#p=' + btoa(JSON.stringify({ v: 1, i: 'thermo-attune-nxt-4l-14c', inst: null, rows: [['CD8', 'high', 'fitc', null, null], ['CD25', 'low', null, null, null]], fl: [] })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
    const p3 = await browser.newPage();
    p3.on('pageerror', (e) => errors.push(String(e)));
    await p3.route(/^https?:/, (r) => r.abort());
    await p3.goto(PAGE + hash);
    await p3.locator('tr[data-i="1"] .sg-btn').click();
    const note = await p3.locator('.sg-note').innerText();
    assert(/Alternatives for this one row/.test(note), note);
    assert(/Brightness is known for \d of these/.test(note), note);
    const picks = await p3.locator('.sg-pick small').allInnerTexts();
    assert(picks.some((x) => /brightness/.test(x)), picks.join(' / '));
    await p3.close();
  });

  assert.deepStrictEqual(errors, []);
  console.log(n + ' passed');
  await browser.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
