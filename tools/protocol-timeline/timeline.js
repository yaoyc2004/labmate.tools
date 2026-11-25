/* labmate.tools — 10.1 Protocol Timeline Planner: page behaviour.
 * Everything is saved in this browser (localStorage) after each change. Nothing is uploaded.
 */
(function () {
  'use strict';
  var TL = window.LMT_TL, TPL = window.LMT_PROTOCOLS || [], MIN = TL.MIN;
  var KEY = 'labmate.timeline.v1';
  var $ = function (id) { return document.getElementById(id); };
  var LABELS = 'ABCDEFGHIJKL'.split('');

  // ---------- time helpers ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }
  function parseHHMM(s) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); if (!m) return null; var v = +m[1] * 60 + +m[2]; return v >= 0 && v < 1440 ? v : null; }
  function localInput(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fromInput(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : null;
  }
  function tm(ms) { return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
  function dayName(ms) { return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
  function wd(ms) { return new Date(ms).toLocaleDateString(undefined, { weekday: 'short' }); }
  function when(ms, ref) { return (TL.dayStartOf(ms) === TL.dayStartOf(ref) ? '' : wd(ms) + ' ') + tm(ms); }
  var dur = TL.dur;

  // "90", "1:30", "1h30", "1 h 30 min", "16h", "1.5 h", "2 d" → minutes
  function parseDur(s) {
    s = String(s == null ? '' : s).trim().toLowerCase().replace(/,/g, '.');
    if (!s) return null;
    var m;
    if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s));
    if ((m = /^(\d+):(\d{1,2})$/.exec(s))) return +m[1] * 60 + +m[2];
    var re = /(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m)(?![a-z])/g, total = 0, hit = false, rest = s;
    while ((m = re.exec(s))) {
      hit = true; var v = parseFloat(m[1]), u = m[2][0];
      total += u === 'd' ? v * 1440 : u === 'h' ? v * 60 : v;
      rest = rest.replace(m[0], '');
    }
    rest = rest.trim();
    if (hit && /^\d+$/.test(rest) && /h/.test(s)) { total += +rest; rest = ''; } // "1h30"
    if (!hit || rest) return NaN;
    return Math.round(total);
  }
  function showDur(min) { return min >= 1440 && min % 60 === 0 && min % 1440 !== 0 ? (min / 60) + ' h' : dur(min); }

  // ---------- state ----------
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function defaultAt() {
    var now = new Date(), d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (now.getHours() < 9 ? 0 : 1), 10, 0);
    return localInput(d.getTime());
  }
  function fresh() {
    return {
      tpl: 'wb', protocol: { name: TPL[0].name, steps: clone(TPL[0].steps) }, edited: false,
      plan: { anchor: 'start', at: defaultAt(), dayStart: '08:30', dayEnd: '18:00', margin: 15, absorb: true,
        n: 2, stagger: 'auto', gap: 0, people: 1, round: 5, pct: 10,
        groups: LABELS.map(function (l) { return { label: l, guardOn: true, guard: 5 }; }) },
      mine: []
    };
  }
  var S = fresh();
  try {
    var raw = window.localStorage.getItem(KEY);
    if (raw) {
      var got = JSON.parse(raw);
      if (got && got.protocol && got.plan) { S = got; var f = fresh(); for (var k in f.plan) if (S.plan[k] == null) S.plan[k] = f.plan[k]; if (!S.mine) S.mine = []; }
    }
  } catch (e) { /* blocked or broken: start fresh */ }
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(S)); $('saved').textContent = 'SAVED'; } catch (e) { $('saved').textContent = ''; }
  }

  function tplById(id) {
    for (var i = 0; i < TPL.length; i++) if (TPL[i].id === id) return TPL[i];
    for (var j = 0; j < S.mine.length; j++) if (S.mine[j].id === id) return S.mine[j];
    return null;
  }

  // ---------- 1 · protocol ----------
  function renderChips() {
    var box = $('tplChips'); box.innerHTML = '';
    TPL.concat(S.mine).concat([{ id: 'blank', short: 'Blank', name: 'Blank protocol' }]).forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.dataset.tpl = t.id;
      b.setAttribute('aria-pressed', String(S.tpl === t.id));
      b.textContent = t.short || t.name;
      if (t.mine) { var sm = document.createElement('small'); sm.textContent = 'MINE'; b.appendChild(sm); }
      b.title = t.name;
      box.appendChild(b);
    });
    var t = tplById(S.tpl);
    var info = $('tplInfo'); info.innerHTML = '';
    if (t) {
      var p = document.createElement('span'); p.textContent = (S.edited ? 'EDITED · ' : '') + t.name + (t.note ? ' — ' + t.note : '');
      info.appendChild(p);
      (t.ref || []).forEach(function (r, i) {
        info.appendChild(document.createTextNode(i ? ' · ' : ' Checked against: '));
        var a = document.createElement('a'); a.href = r[1]; a.textContent = r[0]; a.rel = 'noopener'; a.target = '_blank'; info.appendChild(a);
      });
    } else if (S.tpl === 'blank') info.textContent = 'Add your own steps below.';
    $('resetTpl').hidden = !(S.edited && t);
    $('tplName').value = S.protocol.name || '';
  }

  function kindOf(st) { return st.hands ? 'hands' : (st.reps > 1 ? 'wash' : 'wait'); }

  function stepSummary(st) {
    var n = TL.normStep(st, S.plan.pct), k = kindOf(st), s = showDur(n.dur);
    if (k === 'wait' && (n.min < n.dur || n.max > n.dur)) s += ' (' + showDur(n.min) + '–' + showDur(n.max) + ')';
    var you = k === 'hands' ? 'you: all of it' : k === 'wash' ? 'you: ' + n.head + ' min × ' + n.reps : 'you: ' + (n.head ? n.head + ' min' : '—') + (n.tail ? ' + ' + n.tail + ' min at the end' : '');
    return { time: s, you: you };
  }

  function field(lbl, id, val, hint, mode) {
    return '<label class="tl-f"><span>' + lbl + '</span><input type="text" inputmode="' + (mode || 'decimal') + '" autocomplete="off" data-f="' + id + '" value="' + esc(val) + '"' + (hint ? ' placeholder="' + esc(hint) + '"' : '') + '></label>';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  var openStep = -1;
  function renderSteps() {
    var box = $('steps'); box.innerHTML = '';
    S.protocol.steps.forEach(function (st, i) {
      var k = kindOf(st), sum = stepSummary(st);
      var d = document.createElement('details');
      d.className = 'tl-step is-' + k; d.dataset.i = i;
      if (openStep === i) d.open = true;
      var opts = [['hands', 'HANDS-ON'], ['wait', 'WAIT / INCUBATE'], ['wash', 'WASHES']].map(function (o) {
        return '<button type="button" data-kind="' + o[0] + '" aria-pressed="' + (k === o[0]) + '">' + o[1] + '</button>';
      }).join('');
      var body = '<div class="tl-fields">' +
        '<label class="tl-f tl-name"><span>STEP</span><input type="text" data-f="name" value="' + esc(st.name) + '" autocomplete="off"></label>' +
        '<div class="tl-f tl-kind"><span>TYPE</span><div class="lm-seg tl-seg" role="group" aria-label="Step type">' + opts + '</div></div>' +
        field(k === 'wash' ? 'TOTAL TIME' : 'TIME', 'dur', showDur(st.dur), 'e.g. 1 h 30') +
        (k === 'wait' ? field('SHORTEST', 'min', st.min != null ? showDur(st.min) : '', 'same') + field('LONGEST', 'max', st.max != null ? showDur(st.max) : '', 'same') +
          field('YOU AT START, MIN', 'head', st.head || 0, '0', 'numeric') + field('YOU AT END, MIN', 'tail', st.tail || 0, '0', 'numeric') : '') +
        (k === 'wash' ? field('CHANGES', 'reps', st.reps || 3, '3', 'numeric') + field('YOU PER CHANGE, MIN', 'head', st.head || 1, '1', 'numeric') : '') +
        field('BUFFER AFTER, MIN', 'buf', st.buf == null ? '' : st.buf, k === 'hands' ? 'auto ' + S.plan.pct + '%' : '0', 'numeric') +
        '<label class="tl-f tl-name"><span>NOTE</span><input type="text" data-f="note" value="' + esc(st.note || '') + '" autocomplete="off" placeholder="optional"></label>' +
        '</div><div class="tl-step-act">' +
        '<button type="button" class="fl-mini" data-act="up"' + (i === 0 ? ' disabled' : '') + '>MOVE UP</button>' +
        '<button type="button" class="fl-mini" data-act="down"' + (i === S.protocol.steps.length - 1 ? ' disabled' : '') + '>MOVE DOWN</button>' +
        '<button type="button" class="fl-mini" data-act="dup">DUPLICATE</button>' +
        '<button type="button" class="fl-mini" data-act="del">DELETE</button></div><p class="tl-msg" role="status"></p>';
      d.innerHTML = '<summary><span class="tl-n">' + (i + 1) + '</span><span class="tl-sn"></span><span class="tl-st"></span><span class="tl-sy"></span></summary>' + body;
      d.querySelector('.tl-sn').textContent = st.name;
      d.querySelector('.tl-st').textContent = sum.time;
      d.querySelector('.tl-sy').textContent = sum.you;
      box.appendChild(d);
    });
    $('stepCount').textContent = S.protocol.steps.length + (S.protocol.steps.length === 1 ? ' STEP' : ' STEPS');
  }

  function touched() {
    S.edited = S.tpl !== 'blank';
    renderChips();
  }

  $('steps').addEventListener('toggle', function (e) {
    var d = e.target; if (!d.dataset) return;
    if (d.open) openStep = +d.dataset.i; else if (openStep === +d.dataset.i) openStep = -1;
  }, true);

  $('steps').addEventListener('input', function (e) {
    var inp = e.target, f = inp.dataset.f; if (!f) return;
    var d = inp.closest('details'), i = +d.dataset.i, st = S.protocol.steps[i], msg = d.querySelector('.tl-msg');
    var v = inp.value, bad = '';
    if (f === 'name' || f === 'note') st[f] = v;
    else if (f === 'dur' || f === 'min' || f === 'max') {
      var m = parseDur(v);
      if (m === null) { if (f === 'dur') bad = 'Give the step a time.'; else delete st[f]; }
      else if (!(m >= 1) || m > 14 * 1440) bad = 'Type a time such as 45, 1:30, 1 h 30 or 16 h.';
      else st[f] = m;
    } else {
      var n = v.trim() === '' ? null : Number(v.replace(',', '.'));
      if (n === null) { if (f === 'buf') st.buf = null; else st[f] = 0; }
      else if (!(n >= 0) || n > 10000) bad = 'Type a number of minutes.';
      else st[f] = f === 'reps' ? Math.max(2, Math.min(20, Math.round(n))) : Math.round(n);
    }
    inp.classList.toggle('is-bad', !!bad);
    msg.textContent = bad;
    if (!bad) {
      var sum = stepSummary(st);
      d.querySelector('.tl-sn').textContent = st.name; d.querySelector('.tl-st').textContent = sum.time; d.querySelector('.tl-sy').textContent = sum.you;
      if (f === 'name' && TL.normStep(st).name !== st.name) { /* unchanged */ }
      var nm = TL.normStep(st, S.plan.pct);
      if ((f === 'min' || f === 'max') && (st.min > st.dur || (st.max != null && st.max < st.dur))) msg.textContent = 'The window must include the time (' + showDur(nm.dur) + ').';
      touched(); update();
    }
  });

  $('steps').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var d = b.closest('details'), i = +d.dataset.i, steps = S.protocol.steps, st = steps[i];
    if (b.dataset.kind) {
      var k = b.dataset.kind;
      if (k === 'hands') { st.hands = true; delete st.reps; delete st.min; delete st.max; st.head = 0; st.tail = 0; }
      else if (k === 'wash') { st.hands = false; st.reps = st.reps > 1 ? st.reps : 3; st.head = st.head || 1; delete st.min; delete st.max; st.tail = 0; }
      else { st.hands = false; delete st.reps; st.head = st.head || 0; }
      openStep = i;
    } else if (b.dataset.act === 'up' && i > 0) { steps.splice(i - 1, 0, steps.splice(i, 1)[0]); openStep = i - 1; }
    else if (b.dataset.act === 'down' && i < steps.length - 1) { steps.splice(i + 1, 0, steps.splice(i, 1)[0]); openStep = i + 1; }
    else if (b.dataset.act === 'dup') { steps.splice(i + 1, 0, clone(st)); openStep = i + 1; }
    else if (b.dataset.act === 'del') { steps.splice(i, 1); openStep = -1; }
    else return;
    touched(); renderSteps(); update();
  });

  $('addStep').addEventListener('click', function () {
    S.protocol.steps.push({ name: 'New step', dur: 30, hands: true });
    openStep = S.protocol.steps.length - 1;
    touched(); renderSteps(); update();
    var last = $('steps').lastElementChild; if (last) { var inp = last.querySelector('[data-f="name"]'); if (inp) { inp.focus(); inp.select(); } }
  });

  $('tplChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tpl]'); if (!b) return;
    loadTpl(b.dataset.tpl);
  });
  function loadTpl(id) {
    if (id === 'blank') { S.tpl = 'blank'; S.protocol = { name: 'My protocol', steps: [{ name: 'New step', dur: 30, hands: true }] }; }
    else { var t = tplById(id); if (!t) return; S.tpl = id; S.protocol = { name: t.name, steps: clone(t.steps) }; }
    S.edited = false; openStep = -1;
    renderChips(); renderSteps(); update();
  }
  $('resetTpl').addEventListener('click', function () { loadTpl(S.tpl); });
  $('tplName').addEventListener('input', function () { S.protocol.name = this.value; save(); });

  $('saveTpl').addEventListener('click', function () {
    var name = ($('tplName').value || '').trim() || 'My protocol', msg = $('saveMsg');
    var existing = null;
    S.mine.forEach(function (m) { if (m.name.toLowerCase() === name.toLowerCase()) existing = m; });
    var base = tplById(S.tpl);
    if (existing) { existing.steps = clone(S.protocol.steps); S.tpl = existing.id; msg.textContent = 'Updated “' + name + '”.'; }
    else {
      var id = 'my-' + Date.now().toString(36);
      S.mine.push({ id: id, mine: true, name: name, short: name.length > 18 ? name.slice(0, 17) + '…' : name, note: 'Your template.', ref: base && base.ref ? base.ref : [], steps: clone(S.protocol.steps) });
      S.tpl = id; msg.textContent = 'Saved “' + name + '” to MY TEMPLATES.';
    }
    S.protocol.name = name; S.edited = false;
    renderChips(); renderMine(); save();
  });

  // ---------- 2 · when, 3 · groups ----------
  function segSet(id, attr, val) {
    Array.prototype.forEach.call($(id).querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', String(b.dataset[attr] === String(val))); });
  }
  function renderPlan() {
    var p = S.plan;
    segSet('anchorSeg', 'anchor', p.anchor);
    $('atK').textContent = p.anchor === 'finish' ? 'DONE BY' : 'START AT';
    $('at').value = p.at;
    $('dayStart').value = p.dayStart; $('dayEnd').value = p.dayEnd;
    $('margin').value = p.margin; $('absorb').checked = p.absorb !== false;
    $('n').textContent = p.n;
    segSet('staggerSeg', 'stagger', p.stagger);
    segSet('peopleSeg', 'people', p.people);
    segSet('roundSeg', 'round', p.round);
    $('gap').value = p.gap; $('pct').value = p.pct;
    $('gapK').textContent = p.stagger === 'fixed' ? 'GAP BETWEEN GROUPS, MIN' : 'AT LEAST, MIN';
    $('gapBox').hidden = p.stagger === 'together';
    $('staggerHint').innerHTML = p.stagger === 'auto' ? 'Each group starts as early as it can without needing you while another group does. Flexible steps may be stretched inside their window to dodge a clash.'
      : p.stagger === 'fixed' ? 'Groups start a fixed time apart. Clashes are shown, not fixed.'
        : 'All groups run side by side, done together as one batch. No clash check.';
    var tb = $('groupRows'); tb.innerHTML = '';
    for (var i = 0; i < p.n; i++) {
      var g = p.groups[i];
      var tr = document.createElement('tr'); tr.dataset.g = i;
      tr.innerHTML = '<td data-l="GROUP"><label class="sr" for="gl' + i + '">Group ' + (i + 1) + ' name</label><input type="text" id="gl' + i + '" data-g="label" maxlength="24" autocomplete="off"></td>' +
        '<td data-l="BUFFER"><label class="tl-gchk"><input type="checkbox" data-g="guardOn"> <span>buffer</span></label></td>' +
        '<td data-l="MINUTES" class="c-num"><label class="sr" for="gg' + i + '">Buffer minutes, group ' + (i + 1) + '</label><input type="text" class="num" inputmode="numeric" id="gg' + i + '" data-g="guard" autocomplete="off"></td>';
      tr.querySelector('[data-g="label"]').value = g.label;
      tr.querySelector('[data-g="guardOn"]').checked = !!g.guardOn;
      var gi = tr.querySelector('[data-g="guard"]'); gi.value = g.guard; gi.disabled = !g.guardOn;
      tb.appendChild(tr);
    }
    $('allGuard').hidden = p.n < 2;
  }

  function planSeg(id, attr, key, num) {
    $(id).addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      S.plan[key] = num ? Number(b.dataset[attr]) : b.dataset[attr];
      if (key === 'anchor') S.plan.at = defaultForAnchor(S.plan.anchor);
      renderPlan(); update();
    });
  }
  function defaultForAnchor(a) {
    var cur = fromInput(S.plan.at); if (cur == null) return defaultAt();
    if (R && R.ok) return localInput(a === 'finish' ? roundUp(R.end, 15) : R.start);
    return S.plan.at;
  }
  function roundUp(ms, m) { var d = new Date(ms); var mins = d.getHours() * 60 + d.getMinutes(); var r = Math.ceil(mins / m) * m; return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, r).getTime(); }
  planSeg('anchorSeg', 'anchor', 'anchor');
  planSeg('staggerSeg', 'stagger', 'stagger');
  planSeg('peopleSeg', 'people', 'people', true);
  planSeg('roundSeg', 'round', 'round', true);

  function numIn(id, key, lo, hi, after) {
    $(id).addEventListener('input', function () {
      var v = this.value.trim() === '' ? 0 : Number(this.value.replace(',', '.'));
      var ok = isFinite(v) && v >= lo && v <= hi;
      this.classList.toggle('is-bad', !ok);
      if (ok) { S.plan[key] = Math.round(v); if (after) after(); update(); }
    });
  }
  numIn('margin', 'margin', 0, 240);
  numIn('gap', 'gap', 0, 1440);
  numIn('pct', 'pct', 0, 100, function () { renderSteps(); });
  $('at').addEventListener('input', function () { if (fromInput(this.value) != null) { S.plan.at = this.value; update(); } });
  function timeIn(id, key) {
    $(id).addEventListener('input', function () {
      var v = parseHHMM(this.value);
      var ok = v != null;
      if (ok) { S.plan[key] = this.value; ok = (parseHHMM(S.plan.dayEnd) - parseHHMM(S.plan.dayStart)) >= 60; }
      this.classList.toggle('is-bad', !ok);
      if (ok) update();
    });
  }
  timeIn('dayStart', 'dayStart'); timeIn('dayEnd', 'dayEnd');
  $('absorb').addEventListener('change', function () { S.plan.absorb = this.checked; update(); });
  $('nMinus').addEventListener('click', function () { if (S.plan.n > 1) { S.plan.n--; renderPlan(); update(); } });
  $('nPlus').addEventListener('click', function () { if (S.plan.n < 12) { S.plan.n++; renderPlan(); update(); } });
  $('groupRows').addEventListener('input', function (e) {
    var el = e.target, tr = el.closest('tr'); if (!tr) return;
    var g = S.plan.groups[+tr.dataset.g], k = el.dataset.g;
    if (k === 'label') g.label = el.value.trim() || LABELS[+tr.dataset.g];
    else if (k === 'guard') { var v = Number(el.value || 0); var ok = isFinite(v) && v >= 0 && v <= 240; el.classList.toggle('is-bad', !ok); if (!ok) return; g.guard = Math.round(v); }
    update();
  });
  $('groupRows').addEventListener('change', function (e) {
    var el = e.target; if (el.dataset.g !== 'guardOn') return;
    var tr = el.closest('tr'), g = S.plan.groups[+tr.dataset.g];
    g.guardOn = el.checked; tr.querySelector('[data-g="guard"]').disabled = !el.checked; update();
  });
  $('allGuard').addEventListener('click', function () {
    var first = S.plan.groups[0];
    for (var i = 1; i < S.plan.n; i++) { S.plan.groups[i].guardOn = first.guardOn; S.plan.groups[i].guard = first.guard; }
    renderPlan(); update();
  });

  // ---------- compute ----------
  var R = null;
  function compute() {
    var p = S.plan, at = fromInput(p.at);
    if (at == null) return { ok: false, why: 'Pick a date and time.' };
    if (!S.protocol.steps.length) return { ok: false, why: 'Add at least one step.' };
    var groups = [];
    for (var i = 0; i < p.n; i++) groups.push({ label: p.groups[i].label, guard: p.groups[i].guardOn ? p.groups[i].guard : 0 });
    return TL.schedule(S.protocol, {
      anchor: p.anchor, at: at, day: { start: parseHHMM(p.dayStart), end: parseHHMM(p.dayEnd) }, endMargin: p.margin,
      people: p.people, stagger: p.stagger, gap: p.gap, round: p.round, stepBufPct: p.pct, absorb: p.absorb !== false, groups: groups
    });
  }

  function update() {
    save();
    R = compute();
    window.LMT_TL_TEST.R = R;
    renderResult();
  }

  // ---------- 4 · result ----------
  function gl(i) { return R.groups[i].label; }
  function renderResult() {
    var ans = $('ans'), big = $('ansBig'), say = $('ansSay'), notes = $('notes');
    notes.innerHTML = ''; $('agenda').innerHTML = ''; $('chart').innerHTML = '';
    if (!R.ok) {
      ans.className = 'ans is-empty'; big.textContent = R.why || '—'; say.textContent = '';
      ['ics', 'copy', 'print'].forEach(function (id) { $(id).disabled = true; });
      return;
    }
    ['ics', 'copy', 'print'].forEach(function (id) { $(id).disabled = false; });
    var bad = R.clashes.length + R.after.length;
    ans.className = 'ans' + (bad ? ' is-warn' : '');
    big.innerHTML = '';
    var a = document.createElement('span'); a.textContent = wd(R.start) + ' ' + tm(R.start);
    var arrow = document.createElement('span'); arrow.className = 'eq'; arrow.textContent = ' → ';
    var b = document.createElement('span'); b.textContent = (TL.dayStartOf(R.end) === TL.dayStartOf(R.start) ? '' : wd(R.end) + ' ') + tm(R.end);
    big.appendChild(a); big.appendChild(arrow); big.appendChild(b);
    var parts = [];
    parts.push('<b>' + esc(S.protocol.name || 'Protocol') + '</b>' + (R.groups.length > 1 ? ' × ' + R.groups.length + ' groups' : ''));
    parts.push(dayName(R.start) + (TL.dayStartOf(R.end) === TL.dayStartOf(R.start) ? '' : ' to ' + dayName(R.end)));
    parts.push('hands-on ' + dur(R.handsMin) + ' in ' + dur(Math.round((R.end - R.start) / MIN)));
    parts.push(R.clashes.length ? '<b>' + R.clashes.length + (R.clashes.length === 1 ? ' clash' : ' clashes') + '</b>' : (R.groups.length > 1 && S.plan.stagger !== 'together' ? 'no clashes' : ''));
    if (R.after.length) parts.push('<b>' + R.after.length + ' outside working hours</b>');
    if (R.target != null) parts.push(R.met ? 'done by ' + when(R.target + R.margin * MIN, R.start) : '<b>misses the deadline</b>');
    say.innerHTML = parts.filter(Boolean).join(' · ');
    $('printHead').textContent = (S.protocol.name || 'Protocol') + ' · ' + dayName(R.start) + ' – ' + dayName(R.end) + ' · labmate.tools/tools/protocol-timeline';
    renderNotes(); renderChart(); renderAgenda();
  }

  function note(cls, html) { var li = document.createElement('li'); li.className = 'note' + (cls ? ' ' + cls : ''); li.innerHTML = html; $('notes').appendChild(li); }
  function stepName(k) { return esc(R.steps[k].name); }

  function renderNotes() {
    var multi = R.groups.length > 1;
    var gp = function (g) { return multi ? '<b>' + esc(gl(g)) + '</b> · ' : ''; };
    if (R.target != null && !R.met) note('', '<b>Can’t be done by the deadline</b> with these working hours. It ends ' + when(R.end, R.start) + '. Start earlier, allow more people, or shorten the flexible steps.');
    if (R.start < TL.at(TL.dayStartOf(R.start), R.day.start)) note('', '<b>Starts before your working day</b> (' + tm(R.start) + ').');
    var seen = {};
    R.clashes.slice(0, 6).forEach(function (c) {
      var key = c.a.g + ':' + c.a.step + ':' + c.b.g + ':' + c.b.step; if (seen[key]) return; seen[key] = 1;
      note('', '<b>Clash ' + when(c.at, R.start) + ':</b> ' + esc(gl(c.a.g)) + ' · ' + stepName(c.a.step) + ' and ' + esc(gl(c.b.g)) + ' · ' + stepName(c.b.step) + ' need you at the same time' + (c.minutes ? ' (' + Math.round(c.minutes) + ' min)' : '') + '.');
    });
    if (R.clashes.length > 6) note('', 'And ' + (R.clashes.length - 6) + ' more clashes. Try AUTO stagger, another person, or a bigger gap.');
    var after = {};
    R.after.forEach(function (h) { var k = h.g + ':' + h.step; if (!after[k]) after[k] = h; });
    Object.keys(after).slice(0, 6).forEach(function (k) {
      var h = after[k];
      note('', gp(h.g) + '<b>' + stepName(h.step) + ' at ' + when(h.s, R.start) + '</b> is outside your working day (' + S.plan.dayStart + '–' + S.plan.dayEnd + (S.plan.margin ? ', ' + S.plan.margin + ' min kept free' : '') + ').' + (R.steps.some(function (s) { return s.flex; }) ? ' No flexible step before it has enough room to move it.' : ''));
    });
    var mv = {}, order = [];
    R.moves.forEach(function (m) {
      var k = m.g + ':' + m.step;
      if (!mv[k]) { mv[k] = { g: m.g, step: m.step, why: {} }; order.push(k); }
      mv[k].why[m.why] = true;
    });
    order.forEach(function (k) {
      var m = mv[k], g = R.groups[m.g], s = g.L.steps[m.step], st = R.steps[m.step], nx = g.L.steps[m.step + 1];
      var why = m.why.hours && m.why.clash ? 'inside your working day and clear of the other groups' : m.why.hours ? 'inside your working day' : 'clear of the other groups';
      note('info', gp(m.g) + '<b>' + stepName(m.step) + '</b> runs <b>' + showDur(s.dur) + '</b> (' + showDur(st.min) + '–' + showDur(st.max) + ' allowed), so ' +
        (nx ? stepName(m.step + 1) + ' starts ' + when(nx.s, R.start) : 'it ends ' + when(s.e, R.start)) + ', ' + why + '.');
    });
    R.nights.forEach(function (n) {
      note('info', gp(n.g) + '<b>' + stepName(n.step) + ':</b> leave ' + when(n.leave, R.start) + ', back ' + when(n.back, R.start) + '. Fine any time from ' + when(n.earliest, R.start) + ' to ' + when(n.latest, R.start) + '.');
    });
    R.weekend.forEach(function (d) { note('', '<b>Hands-on work on ' + dayName(d) + '.</b> Start on another day if you don’t work weekends.'); });
    if (R.groups.length > 1 && S.plan.stagger === 'auto') {
      var offs = R.groups.map(function (g) { return g.offset; });
      note('info', 'Groups start ' + R.groups.map(function (g) { return esc(g.label) + ' ' + when(g.L.start, R.start); }).join(', ') + '.' + (offs[offs.length - 1] > 180 ? ' One person can’t interleave them faster; with 2 people or SIDE BY SIDE they finish sooner.' : ''));
    }
  }

  function renderAgenda() {
    var tb = $('agenda'), lastDay = null, multi = R.groups.length > 1;
    $('agendaGroupH').hidden = !multi;
    R.events.forEach(function (h) {
      var d = TL.dayStartOf(h.s);
      if (d !== lastDay) {
        var hr = document.createElement('tr'); hr.className = 'tl-day';
        hr.innerHTML = '<td colspan="5"></td>'; hr.firstChild.textContent = dayName(h.s);
        tb.appendChild(hr); lastDay = d;
      }
      var g = R.groups[h.g], s = g.L.steps[h.step], st = R.steps[h.step];
      var tr = document.createElement('tr');
      tr.className = (h.clash ? 'is-clash ' : '') + (h.after ? 'is-after ' : '') + (st.hands ? 'is-hands' : 'is-touch');
      var what = TL.eventText(R, h);
      var youMin = Math.round((h.e - h.s) / MIN);
      var next = '';
      if (h.kind === 'start' && !st.hands) next = 'then ' + showDur(s.dur - (st.reps > 1 ? 0 : 0)) + ', until ' + when(s.e, h.s);
      if (h.kind === 'start' && st.reps > 1) next = st.reps + ' changes, until ' + when(s.e, h.s);
      tr.innerHTML = '<td class="c-num" data-l="TIME"></td>' + (multi ? '<td data-l="GROUP"></td>' : '') + '<td class="c-wide" data-l="DO"></td><td class="c-num" data-l="YOU"></td><td data-l="THEN"></td>';
      var c = tr.children, k = 0;
      c[k++].textContent = tm(h.s);
      if (multi) { c[k].innerHTML = '<span class="tl-dot" style="--c:' + color(h.g) + '"></span>'; c[k++].appendChild(document.createTextNode(g.label)); }
      c[k].textContent = what;
      if (h.clash) c[k].insertAdjacentHTML('beforeend', ' <span class="fl-tag is-bg">CLASH</span>');
      if (h.after) c[k].insertAdjacentHTML('beforeend', ' <span class="fl-tag is-bg">AFTER HOURS</span>');
      k++;
      c[k++].textContent = youMin ? youMin + ' min' : '—';
      c[k].textContent = next;
      tb.appendChild(tr);
    });
    // the last step's end
    var tr2 = document.createElement('tr'); tr2.className = 'tl-end';
    tr2.innerHTML = '<td class="c-num" data-l="TIME"></td>' + (multi ? '<td></td>' : '') + '<td class="c-wide" data-l="DO">All done</td><td></td><td></td>';
    tr2.firstChild.textContent = when(R.end, R.events.length ? R.events[R.events.length - 1].s : R.start);
    tb.appendChild(tr2);
  }

  var COLORS = ['#17403D', '#2E9E5B', '#B7791F', '#5B6EAE', '#A3341F', '#7A4E9E', '#2B7A9E', '#8A4B0F', '#4A5655', '#1F7A45', '#9E2B6E', '#6B7472'];
  function color(i) { return COLORS[i % COLORS.length]; }

  // Overview: one row per group, steps as bars, nights shaded. Drawn to scale.
  function renderChart() {
    var W = Math.max(320, Math.round($('chart').clientWidth || 1000)), left = 40, right = 12, top = 34, row = W < 600 ? 34 : 30, n = R.groups.length, H = top + n * row + 26;
    var t0 = R.start, t1 = Math.max(R.end, R.bufEnd), spanMs = Math.max(t1 - t0, 60 * MIN);
    var X = function (t) { return left + (t - t0) / spanMs * (W - left - right); };
    var o = [];
    o.push('<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Timeline of all groups">');
    o.push('<defs><pattern id="tlHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#8A918C" stroke-width="2"/></pattern></defs>');
    // nights (outside working hours)
    for (var d = TL.dayStartOf(t0) - 86400000; d <= t1; d += 86400000) {
      var dd = TL.dayStartOf(d + 43200000), ws = TL.at(dd, R.workday.start), we = TL.at(dd, R.workday.end), nws = TL.at(TL.dayStartOf(dd + 129600000), R.workday.start);
      var a = Math.max(we, t0), b = Math.min(nws, t1);
      if (b > a) o.push('<rect class="night" x="' + X(a).toFixed(1) + '" y="' + (top - 6) + '" width="' + (X(b) - X(a)).toFixed(1) + '" height="' + (n * row + 6) + '"/>');
      if (ws > t0 && ws < t1) { var lx = X(ws), far = lx > W - 110; o.push('<text class="day" x="' + (far ? Math.min(lx, W - right) : lx + 3).toFixed(1) + '" y="' + (top - 10) + '"' + (far ? ' text-anchor="end"' : '') + '>' + esc(dayName(ws)) + '</text>'); }
    }
    // hour ticks
    var hours = spanMs / 3600000, per = hours / ((W - left - right) / 44), stepH = [1, 2, 3, 4, 6, 8, 12, 24].filter(function (x) { return x >= per; })[0] || 24;
    var first = new Date(t0); first = new Date(first.getFullYear(), first.getMonth(), first.getDate(), first.getHours() + 1).getTime();
    for (var t = first; t <= t1; t += 3600000) {
      var hh = new Date(t).getHours(); if (hh % stepH) continue;
      o.push('<line class="g" x1="' + X(t).toFixed(1) + '" x2="' + X(t).toFixed(1) + '" y1="' + (top - 4) + '" y2="' + (top + n * row) + '"/>');
      o.push('<text x="' + X(t).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + pad(hh) + '</text>');
    }
    R.groups.forEach(function (g, gi) {
      var y = top + gi * row + 6, h = row - 12;
      o.push('<text class="lab" x="' + (left - 8) + '" y="' + (y + h / 2 + 4) + '" text-anchor="end">' + esc(g.label) + '</text>');
      g.L.steps.forEach(function (s, k) {
        var st = R.steps[k], x1 = X(s.s), x2 = X(s.e);
        o.push('<rect class="' + (st.hands ? 'hands' : 'wait') + '" x="' + x1.toFixed(1) + '" y="' + y + '" width="' + Math.max(1, x2 - x1).toFixed(1) + '" height="' + h + '" style="--c:' + color(gi) + '"><title>' + esc(s.name) + ' · ' + esc(tm(s.s)) + '–' + esc(tm(s.e)) + '</title></rect>');
        if (s.bufEnd > s.e) o.push('<rect class="buf" x="' + x2.toFixed(1) + '" y="' + y + '" width="' + Math.max(1, X(s.bufEnd) - x2).toFixed(1) + '" height="' + h + '"/>');
      });
      g.L.hands.forEach(function (hd) {
        if (hd.e <= hd.s) return;
        var ev = null; R.events.forEach(function (e) { if (e.g === gi && e.s === hd.s && e.step === hd.step) ev = e; });
        o.push('<rect class="you' + (ev && (ev.clash || ev.after) ? ' bad' : '') + '" x="' + X(hd.s).toFixed(1) + '" y="' + (y - 3) + '" width="' + Math.max(2, X(hd.e) - X(hd.s)).toFixed(1) + '" height="' + (h + 6) + '" style="--c:' + color(gi) + '"/>');
      });
    });
    o.push('<line class="ax" x1="' + left + '" x2="' + (W - right) + '" y1="' + (top + n * row) + '" y2="' + (top + n * row) + '"/>');
    o.push('</svg>');
    $('chart').innerHTML = o.join('');
  }

  // ---------- outputs ----------
  function scheduleText() {
    var out = [], lastDay = null, multi = R.groups.length > 1;
    out.push((S.protocol.name || 'Protocol') + (multi ? ' × ' + R.groups.length + ' groups' : '') + ' — ' + dayName(R.start) + ' ' + tm(R.start) + ' to ' + dayName(R.end) + ' ' + tm(R.end));
    R.events.forEach(function (h) {
      var d = TL.dayStartOf(h.s);
      if (d !== lastDay) { out.push(''); out.push(dayName(h.s)); lastDay = d; }
      var s = R.groups[h.g].L.steps[h.step], st = R.steps[h.step], mins = Math.round((h.e - h.s) / MIN);
      out.push('  ' + tm(h.s) + '  ' + (multi ? '[' + R.groups[h.g].label + '] ' : '') + TL.eventText(R, h) + (mins ? ' (' + mins + ' min)' : '') +
        (h.kind === 'start' && !st.hands ? ' → until ' + when(s.e, h.s) : '') + (h.clash ? ' ! CLASH' : '') + (h.after ? ' ! AFTER HOURS' : ''));
    });
    out.push(''); out.push('All done ' + dayName(R.end) + ' ' + tm(R.end) + '. Hands-on ' + dur(R.handsMin) + '.');
    out.push('Planned with labmate.tools/tools/protocol-timeline');
    return out.join('\n');
  }
  function flash(txt) { var c = $('copied'); c.textContent = txt; setTimeout(function () { c.textContent = ''; }, 2500); }
  $('copy').addEventListener('click', function () {
    var txt = scheduleText();
    var done = function () { flash('COPIED'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt); done(); });
    else { fallbackCopy(txt); done(); }
  });
  function fallbackCopy(txt) { var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { /* ignore */ } ta.remove(); }
  $('print').addEventListener('click', function () { window.print(); });
  $('ics').addEventListener('click', function () {
    var ics = TL.toICS(R, { id: 'lmt-' + R.start.toString(36), name: S.protocol.name || 'Protocol', alarm: 5 });
    window.LMT_TL_TEST.lastICS = ics;
    var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' }), url = URL.createObjectURL(blob);
    var a = document.createElement('a'), d = new Date(R.start);
    a.href = url; a.download = 'protocol-timeline-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    flash('CALENDAR FILE SAVED — OPEN IT TO ADD THE ALARMS');
  });

  // ---------- 5 · my templates ----------
  function renderMine() {
    var tb = $('mineRows'); tb.innerHTML = '';
    if (!S.mine.length) { tb.innerHTML = '<tr><td colspan="3" class="c-wide">None yet. Edit a protocol above and press SAVE AS MY TEMPLATE.</td></tr>'; return; }
    S.mine.forEach(function (m, i) {
      var tot = 0; m.steps.forEach(function (s) { tot += Number(s.dur) || 0; });
      var tr = document.createElement('tr');
      tr.innerHTML = '<td data-l="NAME" class="c-wide"></td><td data-l="STEPS"></td><td class="c-num"><button type="button" class="fl-mini" data-load="' + i + '">USE</button> <button type="button" class="fl-mini" data-del="' + i + '">DELETE</button></td>';
      tr.firstChild.textContent = m.name; tr.children[1].textContent = m.steps.length + ' steps · ' + dur(tot);
      tb.appendChild(tr);
    });
  }
  $('mineRows').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.load != null) { loadTpl(S.mine[+b.dataset.load].id); window.scrollTo({ top: $('s1').offsetTop - 70, behavior: 'smooth' }); }
    if (b.dataset.del != null) {
      var m = S.mine.splice(+b.dataset.del, 1)[0];
      if (S.tpl === m.id) { S.tpl = 'blank'; S.edited = false; }
      renderMine(); renderChips(); save(); $('mineMsg').textContent = 'Deleted “' + m.name + '”.';
    }
  });
  $('mineExport').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify({ app: 'labmate.tools protocol timeline', v: 1, templates: S.mine }, null, 1)], { type: 'application/json' });
    var a = document.createElement('a'), url = URL.createObjectURL(blob); a.href = url; a.download = 'my-protocol-templates.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  });
  $('mineImport').addEventListener('change', function () {
    var f = this.files && this.files[0], msg = $('mineMsg'); if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var d = JSON.parse(rd.result), list = d.templates || d, added = 0;
        if (!Array.isArray(list)) throw new Error('no list');
        list.forEach(function (t) {
          if (!t || !t.name || !Array.isArray(t.steps) || !t.steps.length) return;
          var steps = t.steps.filter(function (s) { return s && s.name && Number(s.dur) > 0; }).map(function (s) {
            var o = { name: String(s.name).slice(0, 120), dur: Math.round(Number(s.dur)) };
            ['min', 'max', 'reps', 'head', 'tail', 'buf'].forEach(function (k) { if (s[k] != null && isFinite(Number(s[k]))) o[k] = Math.round(Number(s[k])); });
            if (s.hands) o.hands = true; if (s.note) o.note = String(s.note).slice(0, 200);
            return o;
          });
          if (!steps.length) return;
          var name = String(t.name).slice(0, 60);
          S.mine = S.mine.filter(function (m) { return m.name.toLowerCase() !== name.toLowerCase(); });
          S.mine.push({ id: 'my-' + Date.now().toString(36) + added, mine: true, name: name, short: name.length > 18 ? name.slice(0, 17) + '…' : name, note: 'Your template.', ref: [], steps: steps });
          added++;
        });
        msg.textContent = added ? 'Imported ' + added + (added === 1 ? ' template.' : ' templates.') : 'No templates found in that file.';
        renderMine(); renderChips(); save();
      } catch (e) { msg.textContent = 'That file is not a template export.'; }
    };
    rd.readAsText(f); this.value = '';
  });

  $('clear').addEventListener('click', function () {
    var mine = S.mine; S = fresh(); S.mine = mine; openStep = -1;
    renderChips(); renderSteps(); renderPlan(); renderMine(); update();
  });

  var lastW = 0;
  window.addEventListener('resize', function () {
    var w = $('chart').clientWidth; if (R && R.ok && Math.abs(w - lastW) > 20) { lastW = w; renderChart(); }
  });

  window.LMT_TL_TEST = { get S() { return S; }, R: null, parseDur: parseDur };
  renderChips(); renderSteps(); renderPlan(); renderMine(); update();
})();
