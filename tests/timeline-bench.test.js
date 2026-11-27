/* Bench mode, share link and offline copy of 10.1 Protocol Timeline Planner (tools/protocol-timeline).
   Run from the repo root:  NODE_PATH=$(npm root -g) node tests/timeline-bench.test.js
   Needs Playwright with Chromium. Serves the repo on a local port; the page clock is faked. */
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
  const BASE = `http://localhost:${server.address().port}/`;
  const URL0 = BASE + 'tools/protocol-timeline/';
  const browser = await chromium.launch();
  let n = 0;
  const t = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };
  const errors = [];
  const ctx = await browser.newContext({ locale: 'en-US', timezoneId: 'America/New_York', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route((u) => !u.href.startsWith('http://localhost'), (r) => r.abort());
  await page.clock.install({ time: new Date('2026-12-02T09:00:00-05:00') });
  const M = () => page.evaluate(() => window.LMT_TL_TEST.bench.model().map((m) => ({ kind: m.kind, n: m.n, shift: m.shift })));
  const run = () => page.evaluate(() => window.LMT_TL_TEST.bench.run);
  const tick = async (ms) => { await page.clock.fastForward(ms); await page.evaluate(() => window.LMT_TL_TEST.bench.render()); };

  await page.goto(URL0);
  await page.fill('#at', '2026-12-02T10:00');
  await page.click('#nMinus'); // one group

  await t('START BENCH MODE opens the run: first step waits for its planned time', async () => {
    await page.click('#bench');
    assert(await page.isVisible('#benchView'));
    const m = await M();
    assert.deepStrictEqual(m.map((x) => x.kind), ['before']);
    assert.match(await page.textContent('#benchBody'), /Starts 10:00 AM/);
    assert.match(await page.textContent('#benchBody'), /START EVERYTHING NOW/);
    assert.match(await page.title(), /^1 h 00 min · Prepare samples/);
  });

  await t('START EVERYTHING NOW moves the plan to now; first step is hands-on with a countdown', async () => {
    await page.click('[data-act="startall"]');
    const m = await M();
    assert.strictEqual(m[0].kind, 'hands');
    const r = await run();
    assert.strictEqual(new Date(r.groups[0].plan[0].s).toISOString(), '2026-12-02T14:00:00.000Z');
    assert.match(await page.textContent('.tl-card.is-top .tl-cd'), /^30:00 left$/);
    assert.match(await page.textContent('.tl-card.is-top'), /NEXT · Load the gel/);
  });

  await t('a step running long shows the overrun; DONE late re-plans the rest and shows the knock-on', async () => {
    await tick(40 * 60000);
    assert.strictEqual((await M())[0].kind, 'over');
    assert.match(await page.textContent('.tl-card.is-top .tl-cd'), /^\+10:00$/);
    await page.click('[data-act="done"]');
    const m = await M();
    assert.strictEqual(m[0].n, 1); assert.strictEqual(m[0].kind, 'hands');
    assert.match(await page.textContent('.tl-card.is-top'), /STEP 2 OF 11/);
    await tick(15 * 60000); await page.click('[data-act="done"]'); // load the gel on time
    // run the gel: 60–120 min allowed, so what is left of the delay is absorbed before the transfer
    const r = await page.evaluate(() => { const b = window.LMT_TL_TEST.bench.model()[0]; return b.out.map((o) => o.shift); });
    assert.deepStrictEqual(r.slice(2, 4), [5, 0]); // 10 min late, 5 eaten by the step buffers
    assert.match(await page.textContent('#benchBody'), /COMING UP/);
  });

  await t('a hands-on moment arriving while you wait beeps and buzzes', async () => {
    const before = await page.evaluate(() => window.LMT_TL_TEST.alarms || 0);
    await tick(10 * 60000); // into the gel run, nothing due
    assert.strictEqual(await page.evaluate(() => window.LMT_TL_TEST.alarms || 0), before);
    assert.strictEqual((await M())[0].kind, 'wait');
    await tick(80 * 60000); // past the planned end of the run
    assert.strictEqual(await page.evaluate(() => window.LMT_TL_TEST.alarms || 0), before + 1);
    assert.strictEqual((await M())[0].kind, 'over');
    assert.match(await page.textContent('.tl-card.is-top'), /Time’s up · fine until/);
  });

  await t('the run survives a reload and reopens; UNDO takes back the last DONE', async () => {
    await page.reload();
    assert(await page.isVisible('#benchView'));
    assert.strictEqual((await M())[0].n, 2);
    await page.click('.tl-card.is-top [data-act="undo"]');
    assert.strictEqual((await M())[0].n, 1);
    await page.click('[data-act="done"]');
    assert.strictEqual((await M())[0].n, 2);
  });

  await t('BACK TO PLAN keeps the run; END RUN needs a second tap', async () => {
    await page.click('[data-act="exit"]');
    assert(!(await page.isVisible('#benchView')));
    assert.strictEqual(await page.textContent('#bench'), 'RESUME BENCH MODE');
    assert.match(await page.textContent('#runInfo'), /2 of 11 steps done/);
    await page.click('#bench');
    await page.click('#benchEnd');
    assert.strictEqual(await page.textContent('#benchEnd'), 'TAP AGAIN TO END');
    assert(await run());
    await page.click('#benchEnd');
    assert.strictEqual(await run(), null);
    assert(!(await page.isVisible('#benchView')));
    assert.strictEqual(await page.textContent('#bench'), 'START BENCH MODE');
  });

  await t('two groups: one card each, the busier one first, DONE moves only that group', async () => {
    await page.click('#nPlus');
    await page.fill('#at', '2026-12-03T09:00');
    await page.click('#bench');
    await page.click('[data-act="startall"]');
    assert.strictEqual(await page.$$eval('.tl-card', (c) => c.length), 2);
    const m = await M();
    assert.deepStrictEqual(m.map((x) => x.kind), ['hands', 'before']);
    await page.click('.tl-card.is-top [data-act="done"]');
    const m2 = await M();
    assert.deepStrictEqual(m2.map((x) => x.n), [1, 0]);
  });

  for (const w of [390, 1280]) {
    await t(`bench view fits ${w} px with no sideways scroll`, async () => {
      await page.setViewportSize({ width: w, height: 800 });
      const sw = await page.$eval('#benchView', (v) => v.scrollWidth);
      assert(sw <= w, sw + ' > ' + w);
    });
  }

  await t('SHARE PLAN puts the plan in a link that rebuilds it elsewhere; a broken link is ignored', async () => {
    await page.click('[data-act="exit"]');
    await page.click('#tplChips [data-tpl="ihc"]');
    await page.fill('#steps details:first-child [data-f="dur"]', '45').catch(async () => {
      await page.click('#steps details:first-child summary'); await page.fill('#steps details:first-child [data-f="dur"]', '45');
    });
    await page.click('#share');
    const link = await page.evaluate(() => window.LMT_TL_TEST.lastLink);
    assert.match(link, /#p=[A-Za-z0-9_-]+$/);
    const p2 = await ctx.newPage();
    await p2.route((u) => !u.href.startsWith('http://localhost'), (r) => r.abort());
    await p2.evaluate(() => {}).catch(() => {});
    await p2.goto(BASE + 'about/');
    await p2.evaluate(() => localStorage.clear());
    await p2.goto(link);
    const s = await p2.evaluate(() => { const S = window.LMT_TL_TEST.S; return { tpl: S.tpl, name: S.protocol.name, dur: S.protocol.steps[0].dur, n: S.plan.n, at: S.plan.at, hash: location.hash }; });
    assert.deepStrictEqual(s, { tpl: 'shared', name: 'IHC on paraffin sections (DAB)', dur: 45, n: 2, at: '2026-12-03T09:00', hash: '' });
    assert.match(await p2.textContent('#tplInfo'), /SHARED WITH YOU/);
    await p2.goto(URL0 + '#p=notalink'); // same page: read on hashchange
    await p2.waitForTimeout(50); await p2.clock.fastForward(200);
    assert.match(await p2.textContent('#copied'), /BROKEN/);
    assert.strictEqual(await p2.evaluate(() => window.LMT_TL_TEST.S.protocol.name), 'IHC on paraffin sections (DAB)');
    await p2.close();
  });

  await t('no JS errors', async () => { assert.deepStrictEqual(errors, []); });

  await t('offline: after one visit the planner opens with no network', async () => {
    const c2 = await browser.newContext({ locale: 'en-US', timezoneId: 'America/New_York' });
    const p = await c2.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(URL0);
    await p.waitForFunction(() => window.LMT_TL_TEST && window.LMT_TL_TEST.offline === true, null, { timeout: 15000 });
    await p.waitForTimeout(1500); // let the worker copy what the page loaded
    await c2.setOffline(true);
    await p.reload();
    assert(await p.evaluate(() => window.LMT_TL_TEST.R && window.LMT_TL_TEST.R.ok));
    assert.strictEqual(await p.$$eval('#tplChips .chip', (b) => b.length), 9);
    assert.deepStrictEqual(errs, []);
    await c2.close();
  });

  console.log(n + ' passed');
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
