/* Page behaviour of 10.1 Protocol Timeline Planner (tools/protocol-timeline): templates, editing steps,
   start / deadline, groups and buffers, calendar file, my templates, saved state, phone widths, no JS errors.
   Run from the repo root:  NODE_PATH=$(npm root -g) node tests/timeline-page.test.js
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
  const BASE = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  let n = 0;
  const t = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };
  const errors = [];
  const ctx = await browser.newContext({ locale: 'en-US', timezoneId: 'America/New_York', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route((u) => !u.href.startsWith('http://localhost'), (r) => r.abort());
  const R = () => page.evaluate(() => { const r = window.LMT_TL_TEST.R; return r.ok ? { ok: true, start: r.start, end: r.end, bufEnd: r.bufEnd, met: r.met, groups: r.groups.map((g) => ({ offset: g.offset, start: g.L.start, steps: g.L.steps.map((s) => ({ s: s.s, e: s.e, dur: s.dur })) })), clashes: r.clashes.length, after: r.after.length, moves: r.moves.length, nights: r.nights.length, events: r.events.length } : { ok: false, why: r.why }; });
  const hm = (ms) => page.evaluate((ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); }, ms);
  const setAt = async (v) => { await page.fill('#at', v); };

  await page.goto(BASE + 'tools/protocol-timeline/');
  await t('first visit: western blot, 2 groups, staggered, no clashes, 8 templates + blank', async () => {
    assert.strictEqual(await page.$$eval('#tplChips .chip', (b) => b.length), 9);
    assert.strictEqual(await page.$eval('#tplChips [aria-pressed="true"]', (b) => b.textContent), 'WB');
    assert.strictEqual(await page.$$eval('#steps details', (d) => d.length), 11);
    const r = await R();
    assert(r.ok); assert.strictEqual(r.groups.length, 2); assert.strictEqual(r.clashes, 0);
    assert(r.groups[1].offset > 0);
    assert.match(await page.textContent('#ansSay'), /no clashes/);
  });

  await t('start at a fixed time: first step at that time; overnight primary is stretched into the morning', async () => {
    await setAt('2026-12-02T11:00');
    await page.click('#nMinus');
    const r = await R();
    assert.strictEqual(r.groups.length, 1);
    assert.strictEqual(await hm(r.start), 11 * 60);
    const wash = r.groups[0].steps[7];
    assert.strictEqual(await hm(wash.s), 8 * 60 + 30);
    assert.strictEqual(r.after, 0); assert.strictEqual(r.nights, 1);
    assert.match(await page.textContent('#notes'), /Primary antibody.*runs/);
    assert.match(await page.textContent('#notes'), /leave .*back/);
  });

  await t('DONE BY: works back from the deadline minus the time kept free', async () => {
    await page.click('#anchorSeg [data-anchor="finish"]');
    await setAt('2026-12-03T12:00');
    const r = await R();
    assert(r.met);
    assert(r.bufEnd <= await page.evaluate(() => new Date(2026, 11, 3, 11, 45).getTime()));
    assert.strictEqual(await page.textContent('#atK'), 'DONE BY');
    assert.match(await page.textContent('#ansSay'), /done by/);
    await page.click('#anchorSeg [data-anchor="start"]');
    await setAt('2026-12-02T11:00');
  });

  await t('editing a step: typed times, windows and hands-on minutes are used; template marked EDITED', async () => {
    await page.click('#steps details:nth-child(6) summary'); // Block
    await page.fill('#steps details:nth-child(6) [data-f="dur"]', '1 h 30');
    let r = await R();
    assert.strictEqual(r.groups[0].steps[5].dur, 90);
    assert.match(await page.textContent('#tplInfo'), /EDITED/);
    assert.match(await page.textContent('#steps details:nth-child(6) .tl-st'), /1 h 30 min/);
    await page.fill('#steps details:nth-child(6) [data-f="dur"]', 'soon');
    assert(await page.$eval('#steps details:nth-child(6) [data-f="dur"]', (e) => e.classList.contains('is-bad')));
    r = await R(); assert.strictEqual(r.groups[0].steps[5].dur, 90); // bad input keeps the last good value
    assert.deepStrictEqual(await page.evaluate(() => ['45', '1:30', '1h30', '1.5 h', '16h', '2 d', 'x'].map((s) => window.LMT_TL_TEST.parseDur(s))), [45, 90, 90, 90, 960, 2880, NaN]);
  });

  await t('steps: change type, move, duplicate, delete, add; undo restores the template', async () => {
    await page.click('#steps details:nth-child(6) [data-kind="hands"]');
    assert(await page.$eval('#steps details:nth-child(6)', (d) => d.classList.contains('is-hands')));
    await page.click('#steps details:nth-child(6) [data-act="up"]');
    assert.match(await page.textContent('#steps details:nth-child(5) .tl-sn'), /Block/);
    await page.click('#steps details:nth-child(5) [data-act="dup"]');
    assert.strictEqual(await page.$$eval('#steps details', (d) => d.length), 12);
    await page.click('#steps details:nth-child(6) [data-act="del"]');
    await page.click('#addStep');
    assert.strictEqual(await page.$$eval('#steps details', (d) => d.length), 12);
    await page.click('#resetTpl');
    assert.strictEqual(await page.$$eval('#steps details', (d) => d.length), 11);
    assert.doesNotMatch(await page.textContent('#tplInfo'), /EDITED/);
  });

  await t('groups: auto stagger with buffers, fixed gap shows clashes, side by side has none', async () => {
    for (let i = 0; i < 2; i++) await page.click('#nPlus');
    let r = await R();
    assert.strictEqual(r.groups.length, 3); assert.strictEqual(r.clashes, 0);
    assert.strictEqual(await page.$$eval('#groupRows tr', (x) => x.length), 3);
    await page.click('#staggerSeg [data-stagger="fixed"]');
    await page.fill('#gap', '5');
    r = await R();
    assert.deepStrictEqual(r.groups.map((g) => g.offset), [0, 5, 10]);
    assert(r.clashes > 0);
    assert.match(await page.textContent('#notes'), /Clash/);
    assert(await page.$$eval('#agenda tr.is-clash', (x) => x.length) > 0);
    await page.click('#staggerSeg [data-stagger="together"]');
    r = await R(); assert.strictEqual(r.clashes, 0);
    assert.deepStrictEqual(r.groups.map((g) => g.offset), [0, 0, 0]);
    await page.click('#staggerSeg [data-stagger="auto"]');
  });

  await t('a bigger group buffer pushes the next group later; turning it off brings it back', async () => {
    const before = (await R()).groups[1].offset;
    await page.fill('#gg0', '30');
    const bigger = (await R()).groups[1].offset;
    assert(bigger > before, bigger + ' > ' + before);
    await page.uncheck('#groupRows tr:nth-child(1) [data-g="guardOn"]');
    const off = (await R()).groups[1].offset;
    assert(off <= before);
    await page.check('#groupRows tr:nth-child(1) [data-g="guardOn"]');
    await page.fill('#gg0', '5');
  });

  await t('two people: groups may overlap, finish sooner', async () => {
    const one = await R();
    await page.click('#peopleSeg [data-people="2"]');
    const two = await R();
    assert(two.end <= one.end); assert.strictEqual(two.clashes, 0);
    await page.click('#peopleSeg [data-people="1"]');
  });

  await t('agenda lists every hands-on moment by day; chart has one row per group', async () => {
    const r = await R();
    assert.strictEqual(await page.$$eval('#agenda tr:not(.tl-day):not(.tl-end)', (x) => x.length), r.events);
    assert(await page.$$eval('#agenda tr.tl-day', (x) => x.length) >= 2);
    assert.strictEqual(await page.$$eval('#chart svg .lab', (x) => x.length), 3);
  });

  await t('ADD TO CALENDAR downloads an .ics with alarms; COPY SCHEDULE gives the text', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#ics')]);
    assert.match(dl.suggestedFilename(), /^protocol-timeline-2026120\d\.ics$/);
    const ics = fs.readFileSync(await dl.path(), 'utf8');
    assert.match(ics, /^BEGIN:VCALENDAR/); assert.match(ics, /BEGIN:VALARM/); assert.match(ics, /SUMMARY:\[A\] Prepare samples/);
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.click('#copy');
    const txt = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(txt, /Western blot × 3 groups/); assert.match(txt, /\[B\] Load the gel/); assert.match(txt, /All done/);
  });

  await t('save as my template, reload keeps everything, export and import', async () => {
    await page.click('#steps details:nth-child(1) summary');
    await page.fill('#steps details:nth-child(1) [data-f="name"]', 'Lyse and boil');
    await page.fill('#tplName', 'My WB');
    await page.click('#saveTpl');
    assert.match(await page.textContent('#saveMsg'), /Saved/);
    assert.strictEqual(await page.$$eval('#tplChips .chip', (b) => b.length), 10);
    await page.reload();
    assert.strictEqual(await page.$eval('#tplChips [aria-pressed="true"]', (b) => b.textContent), 'My WBMINE');
    assert.match(await page.textContent('#steps details:nth-child(1) .tl-sn'), /Lyse and boil/);
    assert.strictEqual((await R()).groups.length, 3);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#mineExport')]);
    const file = await dl.path();
    await page.click('#mineRows [data-del="0"]');
    assert.strictEqual(await page.$$eval('#tplChips .chip', (b) => b.length), 9);
    await page.setInputFiles('#mineImport', file);
    await page.waitForFunction(() => document.getElementById('mineMsg').textContent.includes('Imported'));
    assert.strictEqual(await page.$$eval('#tplChips .chip', (b) => b.length), 10);
  });

  await t('every template loads and plans; blank protocol works', async () => {
    for (const id of ['wb', 'ihc', 'if', 'lipo', 'elisa', 'coip', 'qpcr', 'mini', 'blank']) {
      await page.click(`#tplChips [data-tpl="${id}"]`);
      const r = await R(); assert(r.ok, id);
    }
    assert.strictEqual(await page.$$eval('#steps details', (d) => d.length), 1);
  });

  await t('RESET returns to the defaults but keeps my templates', async () => {
    await page.click('#clear');
    assert.strictEqual(await page.$eval('#tplChips [aria-pressed="true"]', (b) => b.textContent), 'WB');
    assert.strictEqual((await R()).groups.length, 2);
    assert.strictEqual(await page.$$eval('#tplChips .chip', (b) => b.length), 10);
  });

  for (const w of [1440, 834, 390]) {
    await t(`no horizontal scroll at ${w} px, steps open`, async () => {
      await page.setViewportSize({ width: w, height: 900 });
      await page.evaluate(() => document.querySelectorAll('#steps details').forEach((d) => { d.open = true; }));
      await page.waitForTimeout(100);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      assert(sw <= w, sw + ' > ' + w);
    });
  }

  await t('no JS errors', async () => { assert.deepStrictEqual(errors, []); });

  await t('homepage lists the planner in SECTION 10 and the finder finds it', async () => {
    await page.goto(BASE + '?q=western%20blot%20timeline');
    assert(await page.isVisible('a[href="tools/protocol-timeline/"]'));
    assert.match(await page.textContent('#planning-title'), /SECTION 10/);
  });

  console.log(n + ' passed');
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
