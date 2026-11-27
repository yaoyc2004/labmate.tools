/* labmate.tools — 10.1 Protocol Timeline Planner: bench mode and offline support.
 * Bench mode freezes the current plan into a "run", then follows it live: what to do now, countdowns,
 * a beep and buzz when you are needed, the screen kept on, and a re-plan each time you press DONE.
 * The run is saved in this browser, so a reload or a closed tab picks up where you were.
 */
(function () {
  'use strict';
  var TL = window.LMT_TL, A = window.LMT_TL_APP, MIN = TL.MIN;
  var KEY = 'labmate.timeline.run.v1';
  var $ = function (id) { return document.getElementById(id); };
  var esc = A.esc, tm = A.tm;
  var view = $('benchView'), body = $('benchBody');

  // ---------- the run ----------
  var run = null;
  try {
    var raw = window.localStorage.getItem(KEY);
    if (raw) { var got = JSON.parse(raw); if (got && got.v === 1 && got.steps && got.groups) run = got; }
  } catch (e) { run = null; }
  function saveRun() {
    try { if (run) window.localStorage.setItem(KEY, JSON.stringify(run)); else window.localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
  }
  function newRun(R, S) {
    return {
      v: 1, name: S.protocol.name || 'Protocol', made: Date.now(), people: R.people || 1, together: S.plan.stagger === 'together',
      steps: R.steps,
      groups: R.groups.map(function (g, i) { return { label: g.label, c: A.color(i), plan: g.L.steps.map(function (x) { return { s: x.s, e: x.e }; }) }; }),
      done: R.groups.map(function () { return []; }), first: R.groups.map(function () { return null; }), open: true, sound: true
    };
  }
  function anyDone() { return !!run.started || run.done.some(function (d) { return d.length > 0; }) || run.first.some(function (f) { return f != null; }); }
  function planStart() { return Math.min.apply(null, run.groups.map(function (g) { return g.plan[0].s; })); }
  function planEnd() { return Math.max.apply(null, run.groups.map(function (g) { return g.plan[g.plan.length - 1].e; })); }

  // ---------- where each group is now ----------
  function partText(k, h) {
    var st = run.steps[k];
    if (h && h.kind === 'rep') return st.name + ' — change ' + (h.rep + 1) + ' of ' + st.reps;
    if (h && h.kind === 'end') return st.name + ' — finish';
    if (h && st.reps > 1) return st.name + ' — change 1 of ' + st.reps;
    return st.name;
  }
  function model(now) {
    return run.groups.map(function (g, gi) {
      var out = TL.replan(run.steps, g.plan, run.done[gi], run.first[gi], now), n = run.done[gi].length;
      var m = { gi: gi, g: g, out: out, n: n, end: out[out.length - 1].e, shift: out[out.length - 1].endShift };
      if (n >= run.steps.length) { m.kind = 'fin'; m.t = Infinity; return m; }
      var cur = out[n], st = run.steps[n];
      m.cur = cur; m.st = st;
      if (now < cur.s) { m.kind = 'before'; m.t = cur.s; return m; }
      var act = null, nx = null;
      cur.hands.forEach(function (h) { if (h.e > h.s && now >= h.s && now < h.e && !act) act = h; if (h.s > now && !nx) nx = h; });
      if (act) { m.kind = 'hands'; m.part = act; m.t = now; m.until = act.e; }
      else if (now >= cur.due) { m.kind = 'over'; m.t = now; }
      else { m.kind = 'wait'; m.part = nx; m.t = nx ? nx.s : cur.due; }
      return m;
    });
  }
  var RANK = { hands: 0, over: 0, wait: 1, before: 1, fin: 2 };
  function order(M) { return M.slice().sort(function (a, b) { return RANK[a.kind] - RANK[b.kind] || a.t - b.t || a.gi - b.gi; }); }

  // Hands-on moments from now on, for the alarm and the "coming up" list.
  function moments(M, now) {
    var list = [];
    M.forEach(function (m) {
      if (m.kind === 'fin') return;
      for (var k = m.n; k < m.out.length; k++) {
        var o = m.out[k];
        o.hands.forEach(function (h) { list.push({ t: h.s, e: h.e, gi: m.gi, k: k, h: h, shift: o.shift }); });
        if (k === m.n && o.due != null && !run.steps[k].hands && !run.steps[k].tail) list.push({ t: o.due, e: o.due, gi: m.gi, k: k, h: { kind: 'due' }, shift: o.endShift });
      }
    });
    return list.sort(function (a, b) { return a.t - b.t || a.gi - b.gi; });
  }
  function clashes(list, now) {
    if (run.together || run.groups.length < 2) return [];
    var fut = list.filter(function (x) { return x.e > now && x.e > x.t; }), out = [];
    for (var i = 0; i < fut.length; i++) {
      var hit = fut.filter(function (y) { return y.gi !== fut[i].gi && y.t < fut[i].e && y.e > fut[i].t && y.t <= fut[i].t; });
      if (hit.length >= run.people) out.push([hit[0], fut[i]]);
    }
    return out;
  }

  // ---------- text helpers ----------
  function clock(ms) {
    var s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
    if (h >= 1) return h + ' h ' + (m < 10 ? '0' : '') + m + ' min';
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function shiftTag(min) {
    if (min > 0) return '<span class="tl-sh is-late">+' + A.showDur(min) + '</span>';
    if (min < 0) return '<span class="tl-sh is-early">−' + A.showDur(-min) + '</span>';
    return '<span class="tl-sh">ON PLAN</span>';
  }
  function at(ms) { return A.when(ms, Date.now()); }

  // ---------- render ----------
  var lastSig = '', armed = {}, confirmEnd = false;
  function sig(M, now) {
    return JSON.stringify([order(M).map(function (m) { return [m.gi, m.kind, m.n, m.part ? m.part.s : 0, m.shift]; }), anyDone(), Math.abs(now - planStart()) > 2 * MIN, confirmEnd, run.sound, wake.state]);
  }
  function render(force) {
    if (!run || view.hidden) return;
    var now = Date.now(), M = model(now), s = sig(M, now);
    if (force || s !== lastSig) { lastSig = s; paint(M, now); }
    tick(M, now);
  }
  function paint(M, now) {
    var o = [], sorted = order(M), multi = run.groups.length > 1, allFin = M.every(function (m) { return m.kind === 'fin'; });
    $('benchName').textContent = run.name + (multi ? ' × ' + run.groups.length : '');
    $('benchWake').textContent = wake.state === 'on' ? 'SCREEN STAYS ON' : wake.state === 'none' ? 'KEEP THE SCREEN ON' : 'SCREEN MAY SLEEP';
    $('benchWake').className = 'tl-pill' + (wake.state === 'on' ? ' is-on' : '');
    $('benchSound').textContent = run.sound ? 'SOUND ON' : 'SOUND OFF';
    $('benchSound').setAttribute('aria-pressed', String(!!run.sound));
    $('benchEnd').textContent = confirmEnd ? 'TAP AGAIN TO END' : 'END RUN';
    $('benchEnd').classList.toggle('is-confirm', confirmEnd);

    if (allFin) {
      var end = Math.max.apply(null, M.map(function (m) { return m.end; }));
      o.push('<div class="tl-card is-fin"><div class="tl-ck">ALL DONE</div><div class="tl-cbig">Finished ' + esc(at(end)) + '</div><p class="tl-csub">' +
        shiftTag(Math.round((end - planEnd()) / MIN)) + ' against the plan. Press END RUN to clear it.</p></div>');
    } else if (!anyDone() && Math.abs(now - planStart()) > 2 * MIN) {
      var ahead = planStart() > now;
      o.push('<div class="tl-shift"><p>Planned to start <b>' + esc(at(planStart())) + '</b> (' + (ahead ? 'in ' : '') + esc(A.showDur(Math.round(Math.abs(planStart() - now) / MIN))) + (ahead ? '' : ' ago') + ').</p>' +
        '<button type="button" class="btn" data-act="startall">START EVERYTHING NOW</button><p class="tl-csub">Moves every group by the same amount, so the stagger stays.</p></div>');
    }

    var list = moments(M, now), cl = clashes(list, now);
    if (cl.length) {
      var c = cl[0], a = run.groups[c[0].gi].label, b = run.groups[c[1].gi].label;
      o.push('<p class="tl-warn"><b>Heads-up ' + esc(at(c[1].t)) + ':</b> ' + esc(a) + ' · ' + esc(partText(c[0].k, c[0].h)) + ' and ' + esc(b) + ' · ' + esc(partText(c[1].k, c[1].h)) +
        ' need you at once. Do one a few minutes late; a flexible wait can take it.</p>');
    }

    sorted.forEach(function (m, idx) {
      if (m.kind === 'fin') return;
      var g = m.g, st = m.st, cur = m.cur, k = m.n, nextSt = run.steps[k + 1];
      var head = '<div class="tl-ctop">' + (multi ? '<span class="tl-dot" style="--c:' + g.c + '"></span><b>' + esc(g.label) + '</b> · ' : '') + 'STEP ' + (k + 1) + ' OF ' + run.steps.length + '</div>';
      var big = '', sub = '', cd = '';
      if (m.kind === 'before') {
        big = esc(st.name); sub = 'Starts ' + esc(at(cur.s));
        cd = '<span class="tl-cd" data-to="' + cur.s + '" data-pre="in "></span>';
      } else if (m.kind === 'hands') {
        big = esc(partText(k, m.part)); sub = st.hands ? 'Hands-on' : 'You are needed now';
        cd = '<span class="tl-cd" data-to="' + m.until + '" data-post=" left"></span>';
      } else if (m.kind === 'over') {
        big = esc(st.name);
        if (st.hands) { sub = 'Over the planned time'; cd = '<span class="tl-cd is-over" data-from="' + cur.due + '" data-pre="+"></span>'; }
        else {
          var latest = cur.s + st.max * MIN;
          sub = 'Time’s up' + (TL.bends(st) && latest > now ? ' · fine until ' + esc(at(latest)) : '');
          cd = '<span class="tl-cd is-over" data-from="' + cur.due + '" data-pre="ready "></span>';
        }
      } else {
        big = esc(st.name);
        sub = 'Waiting · ' + (m.part ? esc(partText(k, m.part).replace(st.name + ' — ', '')) : 'done') + ' at ' + esc(at(m.t));
        cd = '<span class="tl-cd" data-to="' + m.t + '" data-pre="in "></span>';
      }

      var bar = m.kind === 'before' ? '' : '<div class="tl-bar"><i data-p0="' + cur.s + '" data-p1="' + (cur.due || cur.e) + '"></i></div>';
      var hot = m.kind === 'hands' || m.kind === 'over';
      var btn = m.kind === 'before'
        ? '<button type="button" class="btn" data-act="start" data-g="' + m.gi + '">START NOW</button>'
        : '<button type="button" class="btn tl-done" data-act="done" data-g="' + m.gi + '">DONE' + (nextSt ? '<small>NEXT · ' + esc(nextSt.name) + '</small>' : '<small>LAST STEP</small>') + '</button>';
      var undo = m.n > 0 || run.first[m.gi] != null ? '<button type="button" class="lm-link" data-act="undo" data-g="' + m.gi + '">UNDO</button>' : '';
      o.push('<section class="tl-card' + (hot ? ' is-hot' : '') + (idx === 0 ? ' is-top' : '') + '" style="--c:' + g.c + '" data-g="' + m.gi + '" aria-label="' + esc((multi ? 'Group ' + g.label + ', ' : '') + st.name) + '">' +
        head + '<div class="tl-cbig">' + big + '</div><div class="tl-crow"><span class="tl-csub">' + sub + '</span>' + cd + '</div>' + bar +
        (st.note ? '<p class="tl-cnote">' + esc(st.note) + '</p>' : '') +
        '<div class="tl-cact">' + btn + undo + '<span class="tl-cend">ends ' + esc(at(m.end)) + ' ' + shiftTag(m.shift) + '</span></div></section>');
    });
    M.forEach(function (m) {
      if (m.kind !== 'fin' || allFin) return;
      o.push('<p class="tl-gfin">' + (multi ? '<span class="tl-dot" style="--c:' + m.g.c + '"></span><b>' + esc(m.g.label) + '</b> · ' : '') + 'all done ' + esc(at(m.end)) + ' ' + shiftTag(m.shift) +
        ' <button type="button" class="lm-link" data-act="undo" data-g="' + m.gi + '">UNDO</button></p>');
    });

    var up = list.filter(function (x) { return x.t > now + 1000; }).slice(0, 8);
    if (up.length) {
      o.push('<h3 class="tl-uph">COMING UP</h3><ol class="tl-up">');
      up.forEach(function (x) {
        var g = run.groups[x.gi];
        o.push('<li><span class="tl-ut">' + esc(at(x.t)) + '</span><span class="tl-uw">' + (multi ? '<span class="tl-dot" style="--c:' + g.c + '"></span>' + esc(g.label) + ' · ' : '') +
          esc(x.h.kind === 'due' ? run.steps[x.k].name + ' — time’s up' : partText(x.k, x.h)) + '</span>' + (x.shift ? shiftTag(x.shift) : '') + '</li>');
      });
      o.push('</ol>');
    }
    body.innerHTML = o.join('');
  }

  // Live bits every second: countdowns, progress bars, the tab title, the alarm.
  var lastTick = Date.now(), lastTap = 0, saved = document.title;
  function tick(M, now) {
    Array.prototype.forEach.call(body.querySelectorAll('.tl-cd'), function (el) {
      var to = el.dataset.to, from = el.dataset.from;
      el.textContent = (el.dataset.pre || '') + clock(to ? Number(to) - now : now - Number(from)) + (el.dataset.post || '');
    });
    Array.prototype.forEach.call(body.querySelectorAll('.tl-bar i'), function (el) {
      var a = Number(el.dataset.p0), b = Number(el.dataset.p1);
      el.style.width = Math.max(0, Math.min(100, (now - a) / Math.max(1, b - a) * 100)).toFixed(1) + '%';
    });
    $('benchNow').textContent = tm(now);
    var top = order(M)[0];
    if (top && top.kind !== 'fin') {
      var lbl = run.groups.length > 1 ? top.g.label + ' · ' : '';
      var t = top.kind === 'hands' ? 'NOW ' + clock(top.until - now) : top.kind === 'over' ? 'READY' : clock(top.t - now);
      document.title = t + ' · ' + lbl + top.st.name;
    } else document.title = 'All done · ' + run.name;
    // alarm: a hands-on moment arrived since the last tick (not the one you just started by pressing DONE)
    // (only the current step of each group: the next one can't start before you press DONE)
    var hit = moments(M, now).some(function (x) { return x.k === M[x.gi].n && x.t > lastTick && x.t <= now && x.t > lastTap + 2000; });
    if (hit) alarm();
    lastTick = now;
  }

  // ---------- sound, buzz, screen ----------
  var ctx = null;
  function audio() {
    try { if (!ctx) { var C = window.AudioContext || window.webkitAudioContext; if (C) ctx = new C(); } if (ctx && ctx.state === 'suspended') ctx.resume(); } catch (e) { ctx = null; }
  }
  function beep(times) {
    if (!ctx) return;
    try {
      var t = ctx.currentTime + 0.02;
      for (var i = 0; i < times; i++) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'square'; o.frequency.value = 1046;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.2); t += 0.3;
      }
    } catch (e) { /* no sound */ }
  }
  function alarm() {
    window.LMT_TL_TEST.alarms = (window.LMT_TL_TEST.alarms || 0) + 1;
    if (run.sound) beep(3);
    try { if (navigator.vibrate) navigator.vibrate([250, 120, 250, 120, 500]); } catch (e) { /* ignore */ }
    view.classList.remove('is-ring'); void view.offsetWidth; view.classList.add('is-ring');
  }
  var wake = { state: 'off', lock: null };
  function keepAwake() {
    if (!('wakeLock' in navigator)) { wake.state = 'none'; return; }
    navigator.wakeLock.request('screen').then(function (l) {
      wake.lock = l; wake.state = 'on'; render(true);
      l.addEventListener('release', function () { wake.lock = null; wake.state = 'off'; render(true); });
    }, function () { wake.state = 'off'; render(true); });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && run && !view.hidden) { if (!wake.lock) keepAwake(); render(true); }
  });

  // ---------- open / close ----------
  var timer = null;
  function open() {
    if (!run) return;
    run.open = true; saveRun();
    view.hidden = false; document.documentElement.classList.add('tl-benching');
    audio(); keepAwake();
    lastTick = Date.now(); render(true);
    if (!timer) timer = setInterval(render, 1000);
    $('benchName').focus();
  }
  function close() {
    view.hidden = true; document.documentElement.classList.remove('tl-benching');
    if (run) { run.open = false; saveRun(); }
    if (timer) { clearInterval(timer); timer = null; }
    if (wake.lock) { try { wake.lock.release(); } catch (e) { /* ignore */ } }
    document.title = saved; confirmEnd = false;
    paintEntry();
    $('bench').focus();
  }

  view.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.dataset.act, gi = b.dataset.g != null ? +b.dataset.g : -1, now = Date.now();
    if (act !== 'end') confirmEnd = false;
    audio();
    if (act === 'done') {
      var n = run.done[gi].length;
      if (n < run.steps.length) { run.done[gi].push(Math.max(now, n ? run.done[gi][n - 1] : 0)); lastTap = now; }
    } else if (act === 'start') { run.first[gi] = now; lastTap = now; }
    else if (act === 'undo') {
      if (run.done[gi].length) run.done[gi].pop(); else run.first[gi] = null;
    } else if (act === 'startall') {
      var d = Math.floor((now - planStart()) / MIN) * MIN;
      run.groups.forEach(function (g) { g.plan.forEach(function (p) { p.s += d; p.e += d; }); });
      run.started = true; lastTap = now;
    } else if (act === 'sound') { run.sound = !run.sound; if (run.sound) beep(1); }
    else if (act === 'exit') { close(); return; }
    else if (act === 'end') {
      if (!confirmEnd) { confirmEnd = true; render(true); return; }
      run = null; saveRun(); close(); return;
    } else return;
    saveRun(); render(true);
  });

  // ---------- entry point in section 4 ----------
  function paintEntry() {
    var b = $('bench'), info = $('runInfo'), R = A.R;
    b.textContent = run ? 'RESUME BENCH MODE' : 'START BENCH MODE';
    b.disabled = !run && !(R && R.ok);
    if (!run) { info.hidden = true; info.innerHTML = ''; return; }
    var total = run.steps.length * run.groups.length, done = run.done.reduce(function (s, d) { return s + d.length; }, 0);
    info.hidden = false;
    info.innerHTML = '<b>Bench run in progress:</b> ' + esc(run.name) + ', ' + done + ' of ' + total + ' steps done. Changes to the plan above don’t touch it. ' +
      '<button type="button" class="lm-link" id="runNew"' + (R && R.ok ? '' : ' disabled') + '>' + (confirmNew ? 'TAP AGAIN TO REPLACE IT' : 'NEW RUN FROM THIS PLAN') + '</button>';
  }
  var confirmNew = false;
  $('bench').addEventListener('click', function () {
    confirmNew = false;
    if (!run) { if (!A.R || !A.R.ok) return; run = newRun(A.R, A.S); saveRun(); }
    open();
  });
  $('runInfo').addEventListener('click', function (e) {
    if (!e.target.closest('#runNew')) return;
    if (!confirmNew) { confirmNew = true; paintEntry(); return; }
    confirmNew = false; run = newRun(A.R, A.S); saveRun(); open();
  });
  A.hooks.push(function () { confirmNew = false; paintEntry(); });

  window.LMT_TL_TEST.bench = { get run() { return run; }, model: function () { return run ? model(Date.now()) : null; }, render: function () { render(true); } };
  paintEntry();
  if (run && run.open) open();

  // ---------- offline: a service worker for this tool only ----------
  try {
    var secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if ('serviceWorker' in navigator && secure) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js', { scope: './' }).then(function () { return navigator.serviceWorker.ready; }).then(function (reg) {
          var urls = [location.href.split('#')[0]].concat(performance.getEntriesByType('resource').map(function (r) { return r.name; }).filter(function (u) {
            return u.indexOf(location.origin + '/') === 0 || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u);
          }));
          if (reg.active) reg.active.postMessage({ cache: urls });
          window.LMT_TL_TEST.offline = true;
        }).catch(function () { /* no offline copy */ });
      });
    }
  } catch (e) { /* no service worker here */ }
})();
