/* labmate.tools — 10.1 Protocol Timeline Planner: the scheduling core (no DOM).
 *
 * A protocol is a chain of steps. Each step has a duration and says when a person must be at the bench:
 *   dur   minutes, nominal
 *   min / max   minutes the step may be shortened / stretched to (incubations: "1–2 h", "12–18 h")
 *   reps  the step is n equal parts (washes: 3 × 10 min → dur 30, reps 3)
 *   head  hands-on minutes at the start of each part (whole part when head ≥ part length)
 *   tail  hands-on minutes at the end of the step (take the membrane out, stop the reaction)
 *   buf   slack minutes after the step (null = automatic: stepBufPct % of a fully hands-on step)
 *
 * A plan runs N groups of the same protocol, either from a start time or back from a finish time.
 * Groups are staggered so their hands-on parts never need more people than you have. Each group may
 * carry a guard band: its hands-on parts are treated as `guard` minutes longer when staggering, so the
 * group can run that late without bumping the next one. Hands-on parts that fall outside the working day
 * are moved by stretching the latest flexible step before them, within its min–max window.
 * All times are epoch milliseconds, worked out in the browser's local time zone.
 */
(function (root) {
  'use strict';
  var MIN = 60000;

  function num(x, d) { x = Number(x); return isFinite(x) ? x : d; }

  // Fill defaults and clamp a step to sane values.
  function normStep(s, pct) {
    var dur = Math.max(1, Math.round(num(s.dur, 1)));
    var reps = Math.max(1, Math.min(20, Math.round(num(s.reps, 1))));
    var part = dur / reps;
    var hands = !!s.hands;
    var head = hands ? part : Math.max(0, Math.min(part, num(s.head, 0)));
    var tail = hands ? 0 : Math.max(0, Math.min(dur - (reps > 1 ? 0 : head), num(s.tail, 0)));
    var min = s.min == null || s.min === '' ? dur : Math.max(1, Math.min(dur, Math.round(num(s.min, dur))));
    var max = s.max == null || s.max === '' ? dur : Math.max(dur, Math.round(num(s.max, dur)));
    if (hands || reps > 1) { min = dur; max = dur; }
    var fully = head >= part - 1e-9;
    var buf = s.buf == null || s.buf === '' ? (fully ? Math.ceil(dur * (num(pct, 0) / 100)) : 0) : Math.max(0, Math.round(num(s.buf, 0)));
    return { name: String(s.name || 'Step'), dur: dur, reps: reps, head: head, tail: tail, min: min, max: max,
      hands: fully, buf: buf, note: s.note ? String(s.note) : '', flex: max > dur };
  }

  // Lay one group out from `start` with extra minutes `stretch[i]` on step i.
  function layout(steps, start, stretch) {
    var t = start, out = [], hands = [];
    for (var i = 0; i < steps.length; i++) {
      var st = steps[i], d = st.dur + (stretch ? stretch[i] || 0 : 0);
      var s = t, e = t + d * MIN, part = d / st.reps;
      var one = { i: i, name: st.name, s: s, e: e, dur: d, stretch: d - st.dur, bufEnd: e + st.buf * MIN, hands: [] };
      for (var r = 0; r < st.reps; r++) {
        var ps = s + r * part * MIN;
        var len = st.reps > 1 ? Math.min(st.head, st.dur / st.reps) : st.head;
        if (len > 0) one.hands.push({ s: ps, e: ps + len * MIN, step: i, kind: r === 0 ? 'start' : 'rep', rep: r });
      }
      if (st.tail > 0) one.hands.push({ s: e - st.tail * MIN, e: e, step: i, kind: 'end', rep: 0 });
      if (!one.hands.length) one.hands.push({ s: s, e: s, step: i, kind: 'start', rep: 0 }); // a moment's touch
      hands = hands.concat(one.hands);
      out.push(one);
      t = one.bufEnd;
    }
    return { steps: out, hands: hands, start: start, end: out.length ? out[out.length - 1].e : start, bufEnd: t };
  }

  // Working day helpers (local time). day = {start: minutes after midnight, end: minutes after midnight}
  function dayStartOf(t) { var d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  function at(dayMs, minutes) {
    var d = new Date(dayMs);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minutes / 60), minutes % 60).getTime();
  }
  function nextDay(dayMs) { var d = new Date(dayMs); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); }
  function inHours(h, day) {
    var d0 = dayStartOf(h.s);
    return h.s >= at(d0, day.start) && h.e <= at(d0, day.end);
  }
  // the first moment ≥ t that opens a working period long enough for an interval that started at t
  function nextOpen(t, day) {
    var d0 = dayStartOf(t);
    if (t < at(d0, day.start)) return at(d0, day.start);
    return at(nextDay(d0), day.start);
  }

  // Does hands-on part h (made `guard` minutes longer) need more people than there are, given `taken`?
  function collides(h, guard, taken, people) {
    var hp = { s: h.s, e: h.e + guard * MIN };
    if (hp.e <= hp.s) return null;
    var hit = taken.filter(function (x) { return x.e > hp.s && x.s < hp.e; });
    if (!hit.length) return null;
    if (people > 1 && !overload(hit.concat([hp]), people)) return null;
    return Math.min.apply(null, hit.map(function (x) { return x.e; }));
  }

  /* Place one group at `start`. Hands-on parts that fall outside the working day, or clash with `taken`
     (other groups' hands-on parts, guard bands included), are moved by stretching the nearest flexible
     step before them within its window. Returns ok:false + shift (minutes) when a clash can't be fixed
     that way, so the caller can start the group later. Night problems that can't be fixed are left for
     the report. */
  function placeGroup(steps, start, day, absorb, taken, people, guard) {
    taken = taken || []; people = people || 1; guard = guard || 0;
    var stretch = steps.map(function () { return 0; });
    var moves = [], hoursFrom = Infinity, L = layout(steps, start, stretch);
    for (var loop = 0; loop < 300; loop++) {
      var bad = null, why = null, target = 0;
      for (var k = 0; k < L.hands.length; k++) {
        var h = L.hands[k];
        if (absorb && h.step < hoursFrom && !inHours(h, day)) { bad = h; why = 'hours'; target = nextOpen(h.s, day); break; }
        var free = collides(h, guard, taken, people);
        if (free != null) { bad = h; why = 'clash'; target = free; break; }
      }
      if (!bad) return { L: L, stretch: stretch, moves: moves, ok: true };
      var delta = Math.max(1, Math.ceil((target - bad.s) / MIN)), done = false;
      for (var j = bad.step; j >= 0; j--) {
        if (j === bad.step && bad.kind !== 'end') continue; // stretching a step never moves its own start
        if (!steps[j].flex) continue;
        if (steps[j].max - (steps[j].dur + stretch[j]) >= delta) {
          stretch[j] += delta; moves.push({ step: j, by: delta, to: target, because: bad.step, kind: bad.kind, why: why });
          done = true; break;
        }
        // not enough room here: try an earlier flexible step (it moves more steps, which are checked again)
      }
      if (!done) {
        if (why === 'clash') return { L: L, stretch: stretch, moves: moves, ok: false, shift: delta };
        hoursFrom = bad.step; // leave this night problem for the report; don't half-fix the steps after it
      }
      L = layout(steps, start, stretch);
    }
    return { L: L, stretch: stretch, moves: moves, ok: true };
  }

  // Peak number of overlapping intervals above `people`?
  function overload(list, people) {
    var ev = [];
    list.forEach(function (x) { if (x.e > x.s) { ev.push([x.s, 1]); ev.push([x.e, -1]); } });
    ev.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var n = 0;
    for (var k = 0; k < ev.length; k++) { n += ev[k][1]; if (n > people) return true; }
    return false;
  }

  // One group's hands-on parts with its guard band, merged where they touch (one person can't clash with themselves).
  function padded(hands, guard) {
    var list = hands.map(function (h) { return { s: h.s, e: h.e + guard * MIN }; })
      .filter(function (x) { return x.e > x.s; }).sort(function (a, b) { return a.s - b.s; });
    var out = [];
    list.forEach(function (x) {
      var last = out[out.length - 1];
      if (last && x.s <= last.e) last.e = Math.max(last.e, x.e); else out.push({ s: x.s, e: x.e });
    });
    return out;
  }

  // Lay all groups out from t0.
  function placeAll(steps, t0, plan) {
    var day = plan.day, people = Math.max(1, plan.people || 1), round = Math.max(1, plan.round || 5);
    var gap = Math.max(0, plan.gap || 0), groups = [], taken = [], absorb = plan.absorb !== false;
    for (var g = 0; g < plan.groups.length; g++) {
      var gr = plan.groups[g], guard = gr.guard > 0 ? gr.guard : 0, off, P;
      if (plan.stagger === 'together') off = 0;
      else if (plan.stagger === 'fixed') off = g * gap;
      else off = g === 0 ? 0 : groups[g - 1].offset + Math.max(round, gap);
      if (plan.stagger === 'auto' && g > 0) {
        var limit = off + 48 * 60, o = off;
        P = null;
        for (var tries = 0; tries < 400 && o <= limit; tries++) {
          var Q = placeGroup(steps, t0 + o * MIN, day, absorb, taken, people, guard);
          if (Q.ok) { P = Q; off = o; break; }
          o += Math.max(round, Math.ceil(Q.shift / round) * round);
        }
        if (!P) P = placeGroup(steps, t0 + off * MIN, day, absorb);
      } else {
        P = placeGroup(steps, t0 + off * MIN, day, absorb);
      }
      taken = taken.concat(padded(P.L.hands, guard));
      groups.push({ index: g, label: gr.label, guard: guard, offset: off, L: P.L, moves: P.moves, stretch: P.stretch });
    }
    return groups;
  }

  function span(groups) {
    var s = Infinity, e = -Infinity, be = -Infinity;
    groups.forEach(function (g) { s = Math.min(s, g.L.start); e = Math.max(e, g.L.end); be = Math.max(be, g.L.bufEnd); });
    return { start: s, end: e, bufEnd: be };
  }

  function roundDown(t, minutes) { var q = minutes * MIN; var off = new Date(t).getTimezoneOffset() * MIN; return Math.floor((t - off) / q) * q + off; }

  /* plan = {
   *   anchor: 'start' | 'finish', at: ms,
   *   day: {start: 510, end: 1080} (minutes), endMargin: 15,
   *   people: 1, stagger: 'auto' | 'fixed' | 'together', gap: 0, round: 5,
   *   stepBufPct: 10, absorb: true, groups: [{label:'A', guard: 5}]
   * }
   * protocol = {name, steps:[…]}
   */
  function schedule(protocol, plan) {
    var steps = (protocol.steps || []).map(function (s) { return normStep(s, plan.stepBufPct); });
    var margin = Math.max(0, plan.endMargin || 0);
    var day = { start: plan.day.start, end: Math.max(plan.day.start + 30, plan.day.end - margin) };
    var p = {}; for (var k in plan) p[k] = plan[k];
    p.day = day;
    if (!p.groups || !p.groups.length) p.groups = [{ label: 'A', guard: 0 }];
    if (!steps.length) return { ok: false, why: 'No steps.' };

    var t0, groups, sp, target = null, met = true;
    if (p.anchor === 'finish') {
      target = plan.at - margin * MIN;
      t0 = target;
      var first = placeAll(steps, t0, p);
      t0 = target - (span(first).bufEnd - t0);
      t0 = roundDown(t0, p.round || 5);
      for (var it = 0; it < 12; it++) {
        groups = placeAll(steps, t0, p); sp = span(groups);
        var over = sp.bufEnd - target;
        if (over <= 0) break;
        t0 = roundDown(t0 - Math.max(over, (p.round || 5) * MIN), p.round || 5);
      }
      groups = placeAll(steps, t0, p); sp = span(groups);
      met = sp.bufEnd <= target;
    } else {
      t0 = plan.at;
      groups = placeAll(steps, t0, p); sp = span(groups);
    }
    return finish(steps, p, groups, sp, { t0: t0, target: target, met: met, margin: margin, workday: plan.day });
  }

  function overlapMin(a, b) { return Math.max(0, Math.min(a.e, b.e) - Math.max(a.s, b.s)) / MIN; }

  function finish(steps, p, groups, sp, meta) {
    var all = [];
    groups.forEach(function (g) { g.L.hands.forEach(function (h) { all.push({ s: h.s, e: h.e, g: g.index, step: h.step, kind: h.kind, rep: h.rep }); }); });
    all.sort(function (a, b) { return a.s - b.s || a.g - b.g; });

    // clashes: more hands-on parts at once than people
    var people = Math.max(1, p.people || 1), clashes = [];
    for (var i = 0; i < all.length && p.stagger !== 'together'; i++) {
      var over = [all[i]];
      for (var j = 0; j < all.length; j++) {
        if (j !== i && all[j].g !== all[i].g && (all[j].s < all[i].s || (all[j].s === all[i].s && j < i)) && all[j].e > all[i].s && all[j].e > all[j].s && all[i].e > all[i].s) over.push(all[j]);
      }
      if (over.length > people) {
        var b = over[1];
        clashes.push({ a: all[i], b: b, minutes: overlapMin(all[i], b), at: all[i].s });
        all[i].clash = true; over.forEach(function (x) { x.clash = true; });
      }
    }

    // outside working hours (whatever the absorption could not fix)
    var after = all.filter(function (h) { return !inHours(h, p.day); });
    after.forEach(function (h) { h.after = true; });

    // weekend days with hands-on work
    var weekend = {};
    all.forEach(function (h) { var d = new Date(h.s).getDay(); if (d === 0 || d === 6) weekend[dayStartOf(h.s)] = true; });

    // passive steps that cross the night: when to leave, when to be back
    var nights = [];
    groups.forEach(function (g) {
      g.L.steps.forEach(function (s, k) {
        var st = steps[k];
        if (st.hands) return;
        var d0 = dayStartOf(s.s);
        if (s.e > at(d0, p.day.end) && s.e - s.s >= 3 * 60 * MIN) {
          nights.push({ g: g.index, step: k, leave: s.s + st.head * MIN, back: s.e - st.tail * MIN,
            earliest: s.s + (st.min - st.tail) * MIN, latest: s.s + (st.max - st.tail) * MIN });
        }
      });
    });

    // hands-on time in total (overlaps counted once)
    var handsMin = 0, cur = null;
    all.forEach(function (h) {
      if (!cur || h.s > cur.e) { if (cur) handsMin += (cur.e - cur.s) / MIN; cur = { s: h.s, e: h.e }; }
      else cur.e = Math.max(cur.e, h.e);
    });
    if (cur) handsMin += (cur.e - cur.s) / MIN;

    var moves = [];
    groups.forEach(function (g) { g.moves.forEach(function (m) { moves.push({ g: g.index, step: m.step, by: m.by, to: m.to, because: m.because, kind: m.kind, why: m.why }); }); });

    return {
      ok: true, steps: steps, groups: groups, events: all,
      start: sp.start, end: sp.end, bufEnd: sp.bufEnd,
      t0: meta.t0, target: meta.target, met: meta.met, margin: meta.margin,
      handsMin: Math.round(handsMin), clashes: clashes, after: after, nights: nights, moves: moves,
      weekend: Object.keys(weekend).map(Number).sort(), day: p.day, workday: meta.workday, people: people
    };
  }

  // ---------- text, calendar ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function icsTime(t) {
    var d = new Date(t);
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }
  function icsEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function fold(line) {
    var out = '', n = 0;
    for (var i = 0; i < line.length; i++) {
      var c = line[i], len = unescape(encodeURIComponent(c)).length;
      if (n + len > 73) { out += '\r\n '; n = 1; }
      out += c; n += len;
    }
    return out;
  }
  function dur(m) {
    m = Math.round(m);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), r = m % 60;
    return h + ' h' + (r ? ' ' + r + ' min' : '');
  }

  // One calendar event per step, alarm `alarm` minutes before each step that needs you.
  function toICS(R, opts) {
    opts = opts || {};
    var id = opts.id || String(R.start), alarm = opts.alarm == null ? 5 : opts.alarm, name = opts.name || 'Protocol';
    var stamp = icsTime(opts.now || Date.now());
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//labmate.tools//Protocol Timeline Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    R.groups.forEach(function (g) {
      var multi = R.groups.length > 1;
      g.L.steps.forEach(function (s, k) {
        var st = R.steps[k];
        var title = (multi ? '[' + g.label + '] ' : '') + s.name;
        var desc = name + (multi ? ' · group ' + g.label : '') + ' · step ' + (k + 1) + ' of ' + R.steps.length + '\n' +
          (st.hands ? 'Hands-on ' + dur(s.dur) : 'Takes ' + dur(s.dur) + (st.head ? ' · hands-on ' + dur(st.head * (st.reps > 1 ? st.reps : 1)) + ' at the start' : '') + (st.tail ? ' · ' + dur(st.tail) + ' at the end' : '')) +
          (s.stretch ? '\nStretched by ' + dur(s.stretch) + ' to fit the working day' : '') + (st.note ? '\n' + st.note : '') + '\nPlanned with labmate.tools';
        L.push('BEGIN:VEVENT', 'UID:' + id + '-' + g.index + '-' + k + '@labmate.tools', 'DTSTAMP:' + stamp,
          'DTSTART:' + icsTime(s.s), 'DTEND:' + icsTime(Math.max(s.e, s.s + MIN)), fold('SUMMARY:' + icsEsc(title)), fold('DESCRIPTION:' + icsEsc(desc)));
        if (alarm >= 0) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', fold('DESCRIPTION:' + icsEsc(title)), 'TRIGGER:-PT' + alarm + 'M', 'END:VALARM');
        L.push('END:VEVENT');
        if (st.tail > 0 && !st.hands && s.e - s.s > 30 * MIN) {
          L.push('BEGIN:VEVENT', 'UID:' + id + '-' + g.index + '-' + k + 'e@labmate.tools', 'DTSTAMP:' + stamp,
            'DTSTART:' + icsTime(s.e - st.tail * MIN), 'DTEND:' + icsTime(s.e), fold('SUMMARY:' + icsEsc(title + ' — finish')), fold('DESCRIPTION:' + icsEsc(desc)));
          if (alarm >= 0) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', fold('DESCRIPTION:' + icsEsc(title + ' — finish')), 'TRIGGER:-PT' + alarm + 'M', 'END:VALARM');
          L.push('END:VEVENT');
        }
      });
    });
    L.push('END:VCALENDAR');
    return L.join('\r\n') + '\r\n';
  }

  // What a bench card / notebook line says for one hands-on moment.
  function eventText(R, h) {
    var st = R.steps[h.step];
    if (h.kind === 'rep') return st.name + ' — part ' + (h.rep + 1) + ' of ' + st.reps;
    if (h.kind === 'end') return st.name + ' — finish';
    return st.name;
  }

  var API = { MIN: MIN, normStep: normStep, layout: layout, placeGroup: placeGroup, schedule: schedule, toICS: toICS,
    eventText: eventText, dur: dur, padded: padded, inHours: inHours, nextOpen: nextOpen, dayStartOf: dayStartOf, at: at, overload: overload };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.LMT_TL = API;
})(this);
