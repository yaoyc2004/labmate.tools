/* Scheduling core of 10.1 Protocol Timeline Planner (tools/protocol-timeline/timeline-core.js).
   Run from the repo root:  node tests/timeline-core.test.js   (runs in America/New_York local time) */
process.env.TZ = 'America/New_York';
const assert = require('assert');
const TL = require('../tools/protocol-timeline/timeline-core.js');
const T = require('../tools/protocol-timeline/templates.js');
const MIN = 60000;
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const D = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi || 0).getTime();
const hm = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
const base = (o) => Object.assign({ anchor: 'start', at: D(2026, 11, 25, 9), day: { start: 510, end: 1080 }, endMargin: 0, people: 1,
  stagger: 'auto', gap: 0, round: 5, stepBufPct: 0, groups: [{ label: 'A', guard: 0 }] }, o || {});
const simple = { steps: [
  { name: 'Prep', dur: 30, hands: true },
  { name: 'Incubate', dur: 60, min: 45, max: 120, head: 5, tail: 2 },
  { name: 'Wash 3 × 5', dur: 15, reps: 3, head: 1 },
  { name: 'Read', dur: 10, hands: true }
] };
const allPadded = (R) => R.groups.flatMap((g) => TL.padded(g.L.hands, g.guard));

t('normStep: defaults, hands-on steps fixed, auto buffer = % of a hands-on step', () => {
  const a = TL.normStep({ name: 'x', dur: 30, hands: true, min: 10, max: 90 }, 10);
  assert.deepStrictEqual([a.min, a.max, a.buf, a.hands, a.flex], [30, 30, 3, true, false]);
  const b = TL.normStep({ name: 'y', dur: 60, min: 45, max: 120, head: 5 }, 10);
  assert.deepStrictEqual([b.min, b.max, b.buf, b.hands, b.flex], [45, 120, 0, false, true]);
  const c = TL.normStep({ name: 'z', dur: 60, max: 30, min: 90, buf: 4 }, 10);
  assert.deepStrictEqual([c.min, c.max, c.buf], [60, 60, 4]); // windows never exclude the nominal time
});

t('layout: washes give one hands-on part per change; tail at the end', () => {
  const steps = simple.steps.map((s) => TL.normStep(s, 0));
  const L = TL.layout(steps, 0, null);
  const wash = L.hands.filter((h) => h.step === 2);
  assert.deepStrictEqual(wash.map((h) => [h.s / MIN, h.e / MIN, h.kind]), [[90, 91, 'start'], [95, 96, 'rep'], [100, 101, 'rep']]);
  const inc = L.hands.filter((h) => h.step === 1);
  assert.deepStrictEqual(inc.map((h) => [h.s / MIN, h.e / MIN, h.kind]), [[30, 35, 'start'], [88, 90, 'end']]);
  assert.strictEqual(L.end / MIN, 115);
});

t('forward, one group: clock times follow the chain, buffers add slack after hands-on steps', () => {
  const R = TL.schedule(simple, base({ stepBufPct: 10 }));
  const s = R.groups[0].L.steps;
  assert.deepStrictEqual(s.map((x) => hm(x.s)), [540, 573, 633, 648]); // 9:00, 9:33 (30 + 3 buffer), 10:33, 10:48
  assert.strictEqual(hm(R.end), 658);
  assert.strictEqual(R.clashes.length + R.after.length, 0);
  assert.strictEqual(R.handsMin, 30 + 5 + 2 + 3 + 10);
});

t('backward: finishes by the deadline minus the margin, start on the rounding grid, forward from it gives the same plan', () => {
  const p = base({ anchor: 'finish', at: D(2026, 11, 25, 16), endMargin: 15, groups: [{ label: 'A', guard: 5 }, { label: 'B', guard: 5 }] });
  const R = TL.schedule(simple, p);
  assert(R.met); assert(R.bufEnd <= D(2026, 11, 25, 15, 45));
  assert(R.bufEnd > D(2026, 11, 25, 15, 45) - 5 * MIN, 'latest start, not just any start');
  assert.strictEqual(new Date(R.t0).getMinutes() % 5, 0);
  const F = TL.schedule(simple, Object.assign({}, p, { anchor: 'start', at: R.t0 }));
  assert.strictEqual(F.end, R.end);
});

t('auto stagger: no two groups need you at once, guard bands included', () => {
  const p = base({ groups: ['A', 'B', 'C', 'D'].map((l) => ({ label: l, guard: 5 })) });
  const R = TL.schedule(simple, p);
  assert.strictEqual(R.clashes.length, 0);
  assert(!TL.overload(allPadded(R), 1));
  const offs = R.groups.map((g) => g.offset);
  assert.deepStrictEqual(offs, offs.slice().sort((a, b) => a - b));
  offs.forEach((o) => assert.strictEqual(o % 5, 0));
});

t('a guard band spaces groups further apart than none', () => {
  const g0 = TL.schedule(simple, base({ groups: [{ label: 'A', guard: 0 }, { label: 'B', guard: 0 }] }));
  const g15 = TL.schedule(simple, base({ groups: [{ label: 'A', guard: 15 }, { label: 'B', guard: 15 }] }));
  assert(g15.groups[1].offset > g0.groups[1].offset);
});

t('two people: two groups may be hands-on together, a third may not', () => {
  const p = base({ people: 2, groups: [{ label: 'A', guard: 0 }, { label: 'B', guard: 0 }, { label: 'C', guard: 0 }] });
  const R = TL.schedule(simple, p);
  assert(!TL.overload(allPadded(R), 2));
  assert(TL.overload(allPadded(R), 1));
  assert.strictEqual(R.clashes.length, 0);
});

t('fixed gap and together: offsets as asked; clashes reported for fixed, not for side-by-side', () => {
  const fx = TL.schedule(simple, base({ stagger: 'fixed', gap: 10, groups: [{ label: 'A', guard: 0 }, { label: 'B', guard: 0 }] }));
  assert.deepStrictEqual(fx.groups.map((g) => g.offset), [0, 10]);
  assert(fx.clashes.length > 0);
  const tg = TL.schedule(simple, base({ stagger: 'together', groups: [{ label: 'A', guard: 0 }, { label: 'B', guard: 0 }] }));
  assert.deepStrictEqual(tg.groups.map((g) => g.offset), [0, 0]);
  assert.strictEqual(tg.clashes.length, 0);
});

t('overnight: the primary stretches inside 12–18 h so the washes start when the day starts', () => {
  const wb = T.find((x) => x.id === 'wb');
  const R = TL.schedule(wb, base({ at: D(2026, 11, 25, 11) }));
  const g = R.groups[0].L.steps;
  const primary = g[6], wash = g[7];
  assert.strictEqual(hm(wash.s), 510); // 8:30 next morning
  assert(primary.dur >= 720 && primary.dur <= 1080);
  assert(primary.stretch > 0);
  assert.strictEqual(R.after.length, 0);
  assert.strictEqual(R.nights.length, 1);
  assert.strictEqual(R.moves.length, 1);
});

t('a night that cannot be fixed is reported, and the steps after it are not half-moved', () => {
  const wb = T.find((x) => x.id === 'wb');
  const R = TL.schedule(wb, base({ at: D(2026, 11, 25, 9) })); // primary at 14:05, 18 h max → 08:05 < 08:30
  const g = R.groups[0].L.steps;
  assert.strictEqual(g[6].stretch, 0);
  assert(R.after.length > 0);
  const n0 = R.nights[0];
  assert.strictEqual(hm(n0.latest), 8 * 60 + 5);
});

t('day boundaries follow the local clock across the end of daylight saving (1 Nov 2026)', () => {
  const wb = T.find((x) => x.id === 'wb');
  const R = TL.schedule(wb, base({ at: D(2026, 10, 31, 11) }));
  const wash = R.groups[0].L.steps[7];
  assert.strictEqual(new Date(wash.s).getDate(), 1);
  assert.strictEqual(hm(wash.s), 510);
});

t('weekends with hands-on work are listed', () => {
  const lipo = T.find((x) => x.id === 'lipo');
  const R = TL.schedule(lipo, base({ at: D(2026, 11, 25, 9) })); // Wed seed → Sat harvest
  assert(R.weekend.length >= 1);
  assert.strictEqual(new Date(R.weekend[0]).getDay(), 6);
});

t('every built-in template schedules without errors and has a reference', () => {
  assert.strictEqual(T.length, 8);
  T.forEach((tp) => {
    assert(tp.ref.length > 0 && tp.ref.every((r) => /^https:\/\//.test(r[1])));
    const R = TL.schedule(tp, base({ groups: [{ label: 'A', guard: 5 }, { label: 'B', guard: 5 }] }));
    assert(R.ok); assert(R.end > R.start);
    R.groups.forEach((g) => g.L.steps.forEach((s, k) => { const st = R.steps[k]; assert(s.dur >= st.min && s.dur <= st.max, tp.id + ' ' + st.name); }));
  });
});

t('calendar file: balanced blocks, UTC times, ≤ 75 octets a line, an alarm per event', () => {
  const R = TL.schedule(T[0], base({ at: D(2026, 11, 25, 11), groups: [{ label: 'A', guard: 5 }, { label: 'B', guard: 5 }] }));
  const ics = TL.toICS(R, { id: 'test', name: 'Western blot, café', now: D(2026, 11, 24, 12) });
  const lines = ics.split('\r\n');
  lines.forEach((l) => assert(Buffer.byteLength(l, 'utf8') <= 75, l));
  const count = (re) => lines.filter((l) => re.test(l)).length;
  assert.strictEqual(count(/^BEGIN:VEVENT$/), count(/^END:VEVENT$/));
  assert.strictEqual(count(/^BEGIN:VALARM$/), count(/^BEGIN:VEVENT$/));
  assert(count(/^BEGIN:VEVENT$/) >= 22);
  assert(lines.some((l) => /^DTSTART:20261125T160000Z$/.test(l))); // 11:00 EST = 16:00 UTC
  assert(/café/.test(ics) && /\\,/.test(ics));
  const uids = lines.filter((l) => l.startsWith('UID:'));
  assert.strictEqual(new Set(uids).size, uids.length);
});

// ---------- bench mode re-plan ----------
const benchSetup = () => {
  const steps = simple.steps.map((s) => TL.normStep(s, 0));
  const L = TL.layout(steps, 0, null); // Prep 0–30, Incubate 30–90, Wash 90–105, Read 105–115 (minutes)
  return { steps, plan: L.steps.map((x) => ({ s: x.s, e: x.e })) };
};
const mins = (out) => out.map((o) => [o.s / MIN, o.e / MIN]);

t('replan: nothing done follows the plan; an overrunning step is assumed to end now', () => {
  const { steps, plan } = benchSetup();
  assert.deepStrictEqual(mins(TL.replan(steps, plan, [], null, 10 * MIN)), [[0, 30], [30, 90], [90, 105], [105, 115]]);
  const late = TL.replan(steps, plan, [], null, 40 * MIN); // Prep still going at 40
  assert.deepStrictEqual(late[0].e / MIN, 40);
  assert.strictEqual(late[0].due / MIN, 30);
  // the incubation (45–120 allowed) starts 10 late and shrinks to 50 to land back on plan
  assert.deepStrictEqual(mins(late).slice(1), [[40, 90], [90, 105], [105, 115]]);
  assert.deepStrictEqual(late.map((o) => o.state), ['now', 'next', 'next', 'next']);
});

t('replan: lateness bends a flexible wait inside its window, then shifts the rest', () => {
  const { steps, plan } = benchSetup();
  const a = TL.replan(steps, plan, [50 * MIN], null, 50 * MIN); // Prep done 20 min late
  assert.deepStrictEqual(mins(a), [[0, 50], [50, 95], [95, 110], [110, 120]]); // 45 min floor, 5 min knock-on
  assert.deepStrictEqual(a.map((o) => o.shift), [0, 20, 5, 5]);
  const b = TL.replan(steps, plan, [20 * MIN], null, 20 * MIN); // done 10 early: wait stretches, wash on time
  assert.deepStrictEqual(mins(b), [[0, 20], [20, 90], [90, 105], [105, 115]]);
  // a fixed step finishing early lets the next one start straight away, later ones wait for their time
  const c = TL.replan(steps, plan, [30 * MIN, 90 * MIN, 100 * MIN], null, 100 * MIN);
  assert.deepStrictEqual(mins(c)[3], [100, 110]);
  assert.strictEqual(c[3].state, 'now');
});

t('replan: hands-on parts move with the step; first start can be moved', () => {
  const { steps, plan } = benchSetup();
  const a = TL.replan(steps, plan, [], 5 * MIN, 5 * MIN);
  assert.deepStrictEqual(mins(a)[0], [5, 35]);
  assert.deepStrictEqual(a[1].hands.map((h) => [h.s / MIN, h.e / MIN, h.kind]), [[35, 40, 'start'], [88, 90, 'end']]);
  assert.deepStrictEqual(a[2].hands.map((h) => h.s / MIN), [90, 95, 100]);
  assert.ok(TL.bends(steps[1]) && !TL.bends(steps[0]) && !TL.bends(steps[2]));
});

console.log(n + ' passed');
