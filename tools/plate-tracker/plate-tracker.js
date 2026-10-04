/* labmate.tools — Plate Tracker (1.1)
 * One plate per format. Each well stores a bitmask, per round r (1..8):
 *   bit (r-1)  = reagent of round r added
 *   bit (r+7)  = well skipped in round r
 * In a round a well is either added, skipped or open — never both.
 * Everything is saved to localStorage after every change.
 */
(function () {
  'use strict';

  var KEY = 'labmate.plateTracker.v1';
  var MAX_ROUNDS = 8;
  var HIST_MAX = 40;
  var LETTERS = 'ABCDEFGHIJKLMNOP'.split('');
  var ROUND_COLORS = [
    { c: '#9CC7B6', ink: '#1B2224' },
    { c: '#C98A2B', ink: '#1B2224' },
    { c: '#A6452F', ink: '#FAF7EE' },
    { c: '#2F4A6E', ink: '#FAF7EE' },
    { c: '#D9C25A', ink: '#1B2224' },
    { c: '#7A6A9E', ink: '#FAF7EE' },
    { c: '#C08A9C', ink: '#1B2224' },
    { c: '#6B5A45', ink: '#FAF7EE' }
  ];
  var FORMATS = { 96: { rows: 8, cols: 12 }, 384: { rows: 16, cols: 24 } };
  var ADD_MASK = 0xFF, SKIP_MASK = 0xFF00;

  /* ---------- state ---------- */

  function freshPlate(fmt) {
    var n = FORMATS[fmt].rows * FORMATS[fmt].cols, w = [];
    for (var i = 0; i < n; i++) { w.push(0); }
    return { name: 'Plate 1', wells: w, round: 1, rounds: [{ name: 'Reagent 1' }], zone: 0, view: 'auto', cursor: -1, hist: [] };
  }
  function freshState() {
    return { v: 2, format: 96, scope: 'well', act: 'add', order: 'col', wake: true, op: { on: false, remember: false, k: 0, card: false }, plates: { 96: freshPlate(96), 384: freshPlate(384) } };
  }
  function validPlate(p, fmt) {
    var n = FORMATS[fmt].rows * FORMATS[fmt].cols;
    return p && Array.isArray(p.wells) && p.wells.length === n && Array.isArray(p.rounds) &&
      p.rounds.length >= 1 && p.rounds.length <= MAX_ROUNDS && p.round >= 1 && p.round <= p.rounds.length;
  }

  var storageOK = true;
  function load() {
    var s;
    try {
      var raw = window.localStorage.getItem(KEY);
      s = raw ? JSON.parse(raw) : null;
    } catch (e) { storageOK = false; s = null; }
    var f = freshState();
    if (!s || (s.v !== 1 && s.v !== 2) || !s.plates) { return f; }
    [96, 384].forEach(function (fmt) {
      var p = s.plates[fmt];
      if (validPlate(p, fmt)) {
        if (s.v === 1) {
          // v1: one plate-wide skip flag (256). Make it a skip in every existing round.
          var all = 0;
          for (var r = 1; r <= p.rounds.length; r++) { all |= skipBit(r); }
          p.wells = p.wells.map(function (v) { return (v & 256) ? ((v & ADD_MASK) | all) : (v & ADD_MASK); });
          p.hist = [];
        }
        p.hist = Array.isArray(p.hist) ? p.hist.filter(function (h) { return h && Array.isArray(h.w) && h.w.length === p.wells.length; }) : [];
        p.zone = p.zone >= 0 && p.zone < 4 ? p.zone : 0;
        p.view = p.view === 'zones' || p.view === 'full' ? p.view : 'auto';
        p.cursor = typeof p.cursor === 'number' && p.cursor >= 0 && p.cursor < p.wells.length ? p.cursor : -1;
        f.plates[fmt] = p;
      }
    });
    f.format = s.format === 384 ? 384 : 96;
    f.scope = ['well', 'row', 'col'].indexOf(s.scope) >= 0 ? s.scope : (['row', 'col'].indexOf(s.mode) >= 0 ? s.mode : 'well');
    f.act = s.act === 'skip' || s.mode === 'skip' ? 'skip' : 'add';
    f.order = s.order === 'row' ? 'row' : 'col';
    f.wake = s.wake !== false;
    var o = s.op || {};
    f.op = { on: !!o.on, remember: !!o.remember, k: (typeof o.k === 'number' && o.k > 1.5 && o.k < 15) ? o.k : 0, card: false };
    return f;
  }

  function skipBit(r) { return 1 << (r + 7); }
  var S = load();
  var savedAt = null;
  function save() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(S));
      storageOK = true;
      savedAt = new Date();
    } catch (e) { storageOK = false; }
    renderSaved();
  }

  function P() { return S.plates[S.format]; }
  function dims() { return FORMATS[S.format]; }
  function bit(r) { return 1 << (r - 1); }
  function isSkip(v, r) { return (v & skipBit(r || P().round)) !== 0; }
  function hasR(v, r) { return (v & bit(r)) !== 0; }
  function isOpen(v) { var R = P().round; return !hasR(v, R) && !isSkip(v, R); }
  function wellId(i) { var d = dims(); return LETTERS[Math.floor(i / d.cols)] + ((i % d.cols) + 1); }
  function topRound(v) { for (var r = MAX_ROUNDS; r >= 1; r--) { if (v & bit(r)) { return r; } } return 0; }

  function snapshot() {
    var p = P();
    p.hist.push({ w: p.wells.slice(), r: p.round, n: p.rounds.length });
    if (p.hist.length > HIST_MAX) { p.hist.splice(0, p.hist.length - HIST_MAX); }
  }

  function orderList() {
    var d = dims(), out = [], r, c;
    if (S.order === 'col') { for (c = 0; c < d.cols; c++) { for (r = 0; r < d.rows; r++) { out.push(r * d.cols + c); } } }
    else { for (r = 0; r < d.rows; r++) { for (c = 0; c < d.cols; c++) { out.push(r * d.cols + c); } } }
    return out;
  }
  function nextIndex() {
    var w = P().wells, l = orderList();
    for (var k = 0; k < l.length; k++) { if (isOpen(w[l[k]])) { return l[k]; } }
    return -1;
  }
  function stats(r) {
    var w = P().wells, total = 0, done = 0, skipped = 0;
    for (var i = 0; i < w.length; i++) {
      if (isSkip(w[i], r)) { skipped++; continue; }
      total++;
      if (hasR(w[i], r)) { done++; }
    }
    return { total: total, done: done, skipped: skipped };
  }

  /* ---------- operations (current round only) ---------- */

  // add / un-add; a skipped well can't be added
  function setWell(i, on) {
    var p = P(), v = p.wells[i], R = p.round;
    if (isSkip(v, R)) { return; }
    p.wells[i] = on ? (v | bit(R)) : (v & ~bit(R));
  }
  // skip / un-skip; an added well can't be skipped
  function setSkip(i, on) {
    var p = P(), v = p.wells[i], R = p.round;
    if (hasR(v, R)) { return; }
    p.wells[i] = on ? (v | skipBit(R)) : (v & ~skipBit(R));
  }
  function lineIndices(kind, i) {
    var d = dims(), r = Math.floor(i / d.cols), c = i % d.cols, out = [], k;
    if (kind === 'row') { for (k = 0; k < d.cols; k++) { out.push(r * d.cols + k); } }
    else { for (k = 0; k < d.rows; k++) { out.push(k * d.cols + c); } }
    return out;
  }
  // tap with ROW / COLUMN scope: fill the line's free wells, or clear them if already all filled
  function markLine(kind, i) {
    var p = P(), R = p.round, idx = lineIndices(kind, i);
    if (S.act === 'skip') {
      var free = idx.filter(function (j) { return !hasR(p.wells[j], R); });
      if (!free.length) { return; }
      var allSkip = free.every(function (j) { return isSkip(p.wells[j], R); });
      snapshot();
      free.forEach(function (j) { setSkip(j, !allSkip); });
      afterChange();
      return;
    }
    var open = idx.filter(function (j) { return !isSkip(p.wells[j], R); });
    if (!open.length) { return; }
    var allOn = open.every(function (j) { return hasR(p.wells[j], R); });
    snapshot();
    open.forEach(function (j) { setWell(j, !allOn); });
    afterChange();
  }
  // What MARK NEXT will fill (add or skip), following the WELL / ROW / COLUMN scope:
  // the next line that still has open wells, and only its open wells.
  function autoTarget() {
    var d = dims(), w = P().wells, r, c, k, idx, open;
    var isO = function (j) { return isOpen(w[j]); };
    if (S.scope === 'row') {
      for (r = 0; r < d.rows; r++) {
        idx = []; for (k = 0; k < d.cols; k++) { idx.push(r * d.cols + k); }
        open = idx.filter(isO);
        if (open.length) { return { idx: open, label: 'ROW ' + LETTERS[r], first: open[0] }; }
      }
      return null;
    }
    if (S.scope === 'col') {
      for (c = 0; c < d.cols; c++) {
        idx = []; for (k = 0; k < d.rows; k++) { idx.push(k * d.cols + c); }
        open = idx.filter(isO);
        if (open.length) { return { idx: open, label: 'COL ' + (c + 1), first: open[0] }; }
      }
      return null;
    }
    var i = nextIndex();
    return i < 0 ? null : { idx: [i], label: wellId(i), first: i };
  }

  /* MOVE NEXT: a manual cursor (an anchor well). -1 = AUTO (first open spot). */
  function cursor() { var c = P().cursor; return typeof c === 'number' && c >= 0 && c < P().wells.length ? c : -1; }
  function targetAt(a) {
    var d = dims(), w = P().wells, r = Math.floor(a / d.cols), c = a % d.cols;
    var isO = function (j) { return isOpen(w[j]); };
    if (S.scope === 'row') { return { idx: lineIndices('row', a).filter(isO), label: 'ROW ' + LETTERS[r], first: a, anchor: a, manual: true }; }
    if (S.scope === 'col') { return { idx: lineIndices('col', a).filter(isO), label: 'COL ' + (c + 1), first: a, anchor: a, manual: true }; }
    return { idx: isO(a) ? [a] : [], label: wellId(a), first: a, anchor: a, manual: true };
  }
  function nextTarget() {
    var a = cursor();
    if (a >= 0) { var t = targetAt(a); if (t.idx.length) { t.first = t.idx[0]; } return t; }
    var at = autoTarget();
    if (at) { at.anchor = at.first; }
    return at;
  }
  // after MARK NEXT in manual mode: carry on from where the cursor is, wrapping round
  function advanceCursor(a) {
    var d = dims(), r = Math.floor(a / d.cols), c = a % d.cols, k, n, cand;
    var has = function (x) { return targetAt(x).idx.length > 0; };
    if (S.scope === 'row') {
      for (k = 1; k <= d.rows; k++) { n = (r + k) % d.rows; cand = n * d.cols + c; if (has(cand)) { return cand; } }
      return -1;
    }
    if (S.scope === 'col') {
      for (k = 1; k <= d.cols; k++) { n = (c + k) % d.cols; cand = r * d.cols + n; if (has(cand)) { return cand; } }
      return -1;
    }
    var l = orderList(), pos = l.indexOf(a);
    for (k = 1; k <= l.length; k++) { cand = l[(pos + k) % l.length]; if (has(cand)) { return cand; } }
    return -1;
  }
  // screen direction -> plate step (the phone view is turned 90°)
  function stepFor(dir) {
    var m = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[dir], dr, dc; // [screen dy, dx]
    if (L && L.rot) { dr = -m[1]; dc = m[0]; }        // 1:1 plate turned 90° clockwise
    else if (L && L.t) { dr = m[1]; dc = m[0]; }      // phone view: rows across
    else { dr = m[0]; dc = m[1]; }
    if (S.scope === 'row' && dc) { return null; }
    if (S.scope === 'col' && dr) { return null; }
    return [dr, dc];
  }
  function moveTo(dir, dry) {
    var st = stepFor(dir);
    if (!st) { return false; }
    var d = dims(), a = cursor();
    if (a < 0) { var at = autoTarget(); a = at ? at.first : 0; }
    var r = Math.floor(a / d.cols) + st[0], c = (a % d.cols) + st[1];
    if (r < 0 || r >= d.rows || c < 0 || c >= d.cols) { return false; }
    if (dry) { return true; }
    P().cursor = r * d.cols + c;
    var z = P().zone;
    followZone(P().cursor);
    afterChange(P().zone !== z);
    return true;
  }
  function autoCursor() {
    P().cursor = -1;
    followZone(nextFirst());
    afterChange(true);
  }
  function nextFirst() { var t = nextTarget(); return t ? t.first : -1; }
  function markNext() {
    var t = nextTarget();
    if (!t || !t.idx.length) { return; }
    snapshot();
    var skip = S.act === 'skip';
    t.idx.forEach(function (j) { if (skip) { setSkip(j, true); } else { setWell(j, true); } });
    if (cursor() >= 0) { P().cursor = advanceCursor(t.anchor); }
    var n = nextTarget();
    followZone(n ? n.first : -1);
    afterChange();
  }
  function undo() {
    var p = P(), h = p.hist.pop();
    if (!h) { return; }
    p.wells = h.w;
    while (p.rounds.length < h.n) { p.rounds.push({ name: 'Reagent ' + (p.rounds.length + 1) }); }
    if (p.rounds.length > h.n) { p.rounds.length = Math.max(h.n, 1); }
    p.round = Math.min(h.r, p.rounds.length);
    afterChange(true);
  }
  // a new round starts with the previous round's skipped wells (blanks stay blank)
  function addRound(go) {
    var p = P(), n = p.rounds.length;
    if (n >= MAX_ROUNDS) { return; }
    p.rounds.push({ name: 'Reagent ' + (n + 1) });
    var from = skipBit(n), to = skipBit(n + 1);
    p.wells = p.wells.map(function (v) { v &= ~(bit(n + 1) | to); return (v & from) ? (v | to) : v; });
    if (go) { p.round = p.rounds.length; p.cursor = -1; }
    afterChange(true);
  }
  function removeRound() {
    var p = P(), n = p.rounds.length;
    if (n <= 1) { return; }
    snapshot();
    var b = bit(n) | skipBit(n);
    p.wells = p.wells.map(function (v) { return v & ~b; });
    p.rounds.pop();
    if (p.round > p.rounds.length) { p.round = p.rounds.length; }
    afterChange(true);
  }
  function goRound(r) {
    var p = P();
    if (r < 1 || r > p.rounds.length) { return; }
    p.round = r;
    p.cursor = -1;
    followZone(nextFirst());
    afterChange(true);
  }
  function nextRound() {
    var p = P();
    if (p.round < p.rounds.length) { goRound(p.round + 1); }
    else if (p.rounds.length < MAX_ROUNDS) { addRound(true); followZone(nextFirst()); renderAll(); }
  }
  // clears what was added; skipped wells stay as they were set up
  function resetPlate() {
    var p = P();
    snapshot();
    p.wells = p.wells.map(function (v) { return v & SKIP_MASK; });
    p.round = 1;
    p.zone = 0;
    p.cursor = -1;
    afterChange(true);
  }

  /* ---------- layout ---------- */

  var $ = function (id) { return document.getElementById(id); };
  var plateEl = $('plate'), frameEl = $('frame');
  var wellEls = {};   // index -> element
  var layoutKey = '';
  var L = null;       // current layout

  function useZones() {
    if (S.format !== 384 || opActive()) { return false; }
    var v = P().view;
    if (v === 'zones') { return true; }
    if (v === 'full') { return false; }
    return fullSize() < 30;
  }
  function frameBox() {
    var stacked = window.matchMedia('(max-width: 899px)').matches;
    var w = frameEl.clientWidth;
    var h = stacked ? Infinity : frameEl.clientHeight;
    return { w: w, h: h, stacked: stacked };
  }
  function transposed() {
    return !opActive() && window.matchMedia('(max-width: 600px)').matches && window.innerHeight > window.innerWidth;
  }
  function sizeFor(nRows, nCols) {
    var b = frameBox(), pad = window.matchMedia('(max-width: 600px)').matches ? 20 : 32;
    var lab = 26, gapK = 0.11;
    var byW = (b.w - pad - 3 - lab) / (nCols + nCols * gapK);
    var byH = (b.h - pad - 3 - 22) / (nRows + nRows * gapK);
    return Math.max(10, Math.min(byW, byH, 72));
  }
  function fullSize() {
    var d = dims(), t = transposed();
    return sizeFor(t ? d.cols : d.rows, t ? d.rows : d.cols);
  }

  function computeLayout() {
    var d = dims(), zones = useZones(), p = P();
    var r0 = 0, r1 = d.rows, c0 = 0, c1 = d.cols;
    if (zones) {
      r0 = p.zone >= 2 ? 8 : 0; r1 = r0 + 8;
      c0 = p.zone % 2 ? 12 : 0; c1 = c0 + 12;
    }
    var t = transposed();
    return { zones: zones, r0: r0, r1: r1, c0: c0, c1: c1, t: t, nr: t ? (c1 - c0) : (r1 - r0), nc: t ? (r1 - r0) : (c1 - c0) };
  }


  /* ---------- 1:1 ON PLATE ----------
   * SLAS/ANSI microplate standard: footprint 127.76 × 85.48 mm.
   * 96: pitch 9 mm, A1 centre 14.38 mm from the left edge, 11.24 mm from the top.
   * 384: pitch 4.5 mm, A1 centre 12.13 / 8.99 mm.
   * k = CSS px per real mm on this screen. Browsers can't measure it, so we guess
   * from the screen and let the user calibrate once against a real plate (or a card).
   */
  var PLATE_W = 127.76, PLATE_H = 85.48, CARD_W = 85.60, CARD_H = 53.98, OP_LAB = 20;
  var SPEC = {
    96: { x0: 14.38, y0: 11.24, p: 9, dw: 6.6, sq: false },
    384: { x0: 12.13, y0: 8.99, p: 4.5, dw: 3.7, sq: true }
  };
  var calibrating = false, calK = 0;
  function isIPad() {
    var ua = navigator.userAgent || '';
    return /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }
  function guessK() {
    var a = Math.max(screen.width, screen.height), b = Math.min(screen.width, screen.height);
    if (isIPad()) {
      if (a === 1133 && b === 744) { return 326 / 2 / 25.4; }   // iPad mini 6 / 7
      return 264 / 2 / 25.4;                                   // other current iPads
    }
    return 96 / 25.4;                                          // CSS reference; calibrate
  }
  function opActive() { return !!(S.op && S.op.on) || calibrating; }
  function opK() { return calibrating ? calK : (S.op.k || guessK()); }
  function opStacked() { return window.innerWidth < 900; }
  function opRotate(k) {
    var avail = opStacked() ? window.innerWidth - 24 : window.innerWidth - 260 - 24;
    return (PLATE_W * k + OP_LAB) > avail && (PLATE_H * k + OP_LAB) <= avail;
  }
  var opTooSmall = false;
  function buildOnPlate() {
    var k = opK(), d = dims(), sp = SPEC[S.format], rot = opRotate(k);
    var showCard = calibrating && S.op.card;
    L = { zones: false, t: false, op: true, rot: rot, r0: 0, c0: 0, r1: d.rows, c1: d.cols, nr: d.rows, nc: d.cols };
    var key = ['op', S.format, k.toFixed(4), rot, showCard].join('|');
    var ow = (rot ? PLATE_H : PLATE_W) * k, oh = (rot ? PLATE_W : PLATE_H) * k;
    var avail = opStacked() ? window.innerWidth - 24 : window.innerWidth - 260 - 24;
    opTooSmall = Math.min(ow, oh) + OP_LAB > avail;
    if (key === layoutKey) { return; }
    layoutKey = key;
    wellEls = {};
    plateEl.innerHTML = '';
    plateEl.className = 'pt-plate pt-op' + (sp.sq ? ' is-square' : '') + (S.format === 384 ? ' is-tiny' : '');
    plateEl.style.width = (OP_LAB + ow) + 'px';
    plateEl.style.height = (OP_LAB + oh) + 'px';
    plateEl.style.setProperty('--w', (sp.dw * k) + 'px');
    plateEl.style.setProperty('--k', k + 'px');
    var frag = document.createDocumentFragment();
    var box = mk('div', 'op-outline', '');
    place(box, OP_LAB, OP_LAB, ow, oh);
    frag.appendChild(box);
    if (showCard) {
      var card = mk('div', 'op-card', '');
      place(card, OP_LAB, OP_LAB, CARD_W * k, CARD_H * k);
      frag.appendChild(card);
    }
    // plate mm (x along columns, y along rows) -> screen px inside the outline
    var toScreen = function (x, y) {
      return rot ? { x: OP_LAB + (PLATE_H - y) * k, y: OP_LAB + x * k } : { x: OP_LAB + x * k, y: OP_LAB + y * k };
    };
    var r, c, pt, lab;
    for (c = 0; c < d.cols; c++) {
      pt = toScreen(sp.x0 + c * sp.p, 0);
      lab = mk('div', 'op-lab', String(c + 1));
      if (rot) { lab.style.left = (OP_LAB / 2) + 'px'; lab.style.top = pt.y + 'px'; }
      else { lab.style.left = pt.x + 'px'; lab.style.top = (OP_LAB / 2) + 'px'; }
      frag.appendChild(lab);
    }
    for (r = 0; r < d.rows; r++) {
      pt = toScreen(0, sp.y0 + r * sp.p);
      lab = mk('div', 'op-lab row', LETTERS[r]);
      if (rot) { lab.style.left = pt.x + 'px'; lab.style.top = (OP_LAB / 2) + 'px'; }
      else { lab.style.left = (OP_LAB / 2) + 'px'; lab.style.top = pt.y + 'px'; }
      frag.appendChild(lab);
    }
    var half = sp.dw * k / 2;
    for (r = 0; r < d.rows; r++) {
      for (c = 0; c < d.cols; c++) {
        var i = r * d.cols + c, el = mk('button', 'well', '');
        pt = toScreen(sp.x0 + c * sp.p, sp.y0 + r * sp.p);
        el.type = 'button';
        el.dataset.i = i;
        el.style.left = (pt.x - half) + 'px';
        el.style.top = (pt.y - half) + 'px';
        wellEls[i] = el;
        frag.appendChild(el);
      }
    }
    plateEl.appendChild(frag);
  }
  function place(el, x, y, w, h) { el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.width = w + 'px'; el.style.height = h + 'px'; }

  function renderOp() {
    var on = opActive();
    document.body.classList.toggle('is-op', on);
    document.body.classList.toggle('is-calibrating', calibrating);
    var rotTight = on && L && L.rot && opStacked();
    document.body.classList.toggle('is-op-rot', !!rotTight);
    $('opBtn').setAttribute('aria-pressed', String(on));
    $('calib').hidden = !calibrating;
    $('opNote').hidden = !S.op.on || calibrating;
    if (!on) { return; }
    var k = opK();
    $('opScale').textContent = k.toFixed(2) + ' PX/MM' + (S.op.k ? '' : ' · NOT CALIBRATED');
    $('calRead').textContent = k.toFixed(2) + ' px/mm';
    $('calibSteps').hidden = !!S.op.card;
    $('calibStepsCard').hidden = !S.op.card;
    $('calCard').textContent = S.op.card ? 'USE THE PLATE INSTEAD' : 'NO PLATE AT HAND? USE A CARD';
    var warn = '';
    var side = window.innerWidth > window.innerHeight ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    if (opTooSmall) { warn = 'SCREEN TOO SMALL FOR A REAL-SIZE PLATE'; }
    else if (rotTight) { warn = 'PLATE TURNED TO FIT · TURN THE IPAD SIDEWAYS FOR ROUNDS & MOVE NEXT'; }
    else if (isIPad() && window.innerWidth < side * 0.97) { warn = 'PAGE ZOOMED OR SPLIT SCREEN? 1:1 NEEDS SAFARI FULL SCREEN AT 100%'; }
    else if (window.visualViewport && Math.abs(window.visualViewport.scale - 1) > 0.02) { warn = 'PINCH-ZOOMED — PINCH BACK OUT FOR 1:1'; }
    $('opWarn').hidden = !warn;
    $('opWarn').textContent = warn;
  }
  function enterOp() {
    S.op.on = true;
    layoutKey = '';
    if (!S.op.k) { startCalib(); return; }
    renderAll(); save();
  }
  function exitOp() {
    S.op.on = false; calibrating = false; layoutKey = '';
    renderAll(); save();
  }
  function startCalib() {
    calibrating = true; calK = S.op.k || guessK(); layoutKey = '';
    window.scrollTo(0, 0);
    renderAll();
  }

  function buildPlate() {
    if (opActive()) { buildOnPlate(); return; }
    L = computeLayout();
    var key = [S.format, L.zones, L.r0, L.c0, L.t].join('|');
    if (key !== layoutKey) {
      layoutKey = key;
      var d = dims(), frag = document.createDocumentFragment(), i, a, b;
      wellEls = {};
      plateEl.innerHTML = '';
      plateEl.className = 'pt-plate';
      plateEl.style.width = ''; plateEl.style.height = '';
      plateEl.style.setProperty('--nc', L.nc);
      plateEl.classList.toggle('is-square', S.format === 384);
      // header row: corner + column labels
      frag.appendChild(mk('div', 'lab corner', ''));
      for (b = 0; b < L.nc; b++) {
        frag.appendChild(mk('div', 'lab colh', L.t ? LETTERS[L.r0 + b] : String(L.c0 + b + 1)));
      }
      for (a = 0; a < L.nr; a++) {
        frag.appendChild(mk('div', L.t ? 'lab' : 'lab row', L.t ? String(L.c0 + a + 1) : LETTERS[L.r0 + a]));
        for (b = 0; b < L.nc; b++) {
          var r = L.t ? L.r0 + b : L.r0 + a, c = L.t ? L.c0 + a : L.c0 + b;
          i = r * d.cols + c;
          var el = mk('button', 'well', '');
          el.type = 'button';
          el.dataset.i = i;
          wellEls[i] = el;
          frag.appendChild(el);
        }
      }
      plateEl.appendChild(frag);
      if (L.t) { plateEl.querySelectorAll('.lab.colh').forEach(function (x) { x.classList.add('row'); x.style.color = '#1B2224'; x.style.fontWeight = '600'; }); }
    }
    sizePlate();
  }
  function sizePlate() {
    if (!L) { return; }
    var s = Math.floor(sizeFor(L.nr, L.nc));
    plateEl.style.setProperty('--w', s + 'px');
    plateEl.style.setProperty('--g', Math.max(2, Math.round(s * 0.11)) + 'px');
    plateEl.style.setProperty('--lab', (s < 24 ? 18 : 26) + 'px');
    plateEl.classList.toggle('is-tiny', s < 34);
  }
  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    e.className = cls;
    if (text) { e.textContent = text; }
    return e;
  }

  function followZone(i) {
    if (i < 0 || S.format !== 384 || !useZones()) { return; }
    var d = dims(), r = Math.floor(i / d.cols), c = i % d.cols;
    var z = (r >= 8 ? 2 : 0) + (c >= 12 ? 1 : 0);
    if (z !== P().zone) { P().zone = z; }
  }

  /* ---------- rendering ---------- */

  function renderWells() {
    var p = P(), R = p.round, w = p.wells, t = nextTarget(), nextSet = {};
    if (t) {
      var ring = t.idx.length ? t.idx : (S.scope === 'well' ? [t.anchor] : lineIndices(S.scope, t.anchor));
      ring.forEach(function (j) { nextSet[j] = true; });
    }
    Object.keys(wellEls).forEach(function (k) {
      var i = +k, el = wellEls[k], v = w[i], cls = 'well', st = '';
      var id = wellId(i);
      if (isSkip(v)) {
        cls += ' skip';
        el.setAttribute('aria-label', id + ', skipped');
        el.textContent = '';
      } else {
        var top = topRound(v), done = hasR(v, R), next = !!nextSet[i];
        if (done) { cls += ' has done'; st = ROUND_COLORS[R - 1]; }
        else if (top) { cls += ' has'; st = ROUND_COLORS[top - 1]; }
        if (next) { cls += ' next'; }
        el.setAttribute('aria-label', id + (done ? ', added' : ', not added') + (next ? ', next' : ''));
        el.textContent = id;
      }
      if (el.className !== cls) { el.className = cls; }
      if (st) { el.style.setProperty('--c', st.c); el.style.setProperty('--ink2', st.ink); }
      else { el.style.removeProperty('--c'); el.style.removeProperty('--ink2'); }
    });
  }

  function renderSide() {
    var p = P(), R = p.round, col = ROUND_COLORS[R - 1], st = stats(R), t = nextTarget();
    var nid = t ? t.label : '—';
    var skipping = S.act === 'skip';

    $('curSwatch').style.background = col.c;
    $('lgDone').style.background = col.c;
    $('curRoundLabel').textContent = 'ROUND ' + R + ' / ' + p.rounds.length;
    $('curName').textContent = p.rounds[R - 1].name || ('Reagent ' + R);
    $('nextLabel').textContent = (skipping ? 'NEXT TO SKIP · ' : 'NEXT ') + ({ well: 'WELL', row: 'ROW', col: 'COLUMN' })[S.scope];
    $('nextId').textContent = nid;
    var mark = $('markNext');
    mark.classList.toggle('is-skip', skipping);
    if (t && t.idx.length) {
      $('markVerb').textContent = skipping ? 'SKIP NEXT' : 'MARK NEXT';
      $('markId').textContent = nid;
      mark.disabled = false;
    } else if (t) {
      $('markVerb').textContent = nid;
      $('markId').textContent = 'Already done';
      mark.disabled = true;
    } else {
      $('markVerb').textContent = 'ROUND ' + R;
      $('markId').textContent = 'All in ✓';
      mark.disabled = true;
    }
    $('orderBtn').hidden = S.scope !== 'well' || skipping;
    $('orderBtn').textContent = S.order === 'col' ? '↓ BY COL' : '→ BY ROW';

    // MOVE NEXT pad
    var manual = cursor() >= 0;
    $('padState').textContent = (manual ? 'MANUAL · ' : 'AUTO · ') + nid;
    ['up', 'down', 'left', 'right'].forEach(function (dir) { $('pad-' + dir).disabled = !moveTo(dir, true); });
    $('padAuto').setAttribute('aria-pressed', String(!manual));

    $('count').textContent = st.done;
    $('total').textContent = '/ ' + st.total;
    $('skipNote').textContent = st.skipped ? st.skipped + ' SKIPPED' : '';
    var meter = $('meter');
    meter.style.width = (st.total ? Math.round(st.done / st.total * 100) : 0) + '%';
    meter.style.setProperty('--c', col.c);

    var full = st.total > 0 && st.done === st.total;
    $('stamp').hidden = !full;
    $('stamp').textContent = 'ROUND ' + R + ' · PASS ✓';
    var primary = $('nextRound');
    primary.classList.toggle('is-pass', full);
    var last = R >= p.rounds.length && p.rounds.length >= MAX_ROUNDS;
    if (full && R === p.rounds.length && last) { primary.textContent = 'ALL ROUNDS PASS ✓'; }
    else if (full) { primary.textContent = 'ROUND ' + R + ' PASS ✓ — NEXT ROUND →'; }
    else { primary.textContent = R < p.rounds.length ? 'GO TO ROUND ' + (R + 1) + ' →' : 'NEXT ROUND →'; }
    primary.disabled = last && R === p.rounds.length;

    $('undo').disabled = !p.hist.length;
    $('addRound').hidden = p.rounds.length >= MAX_ROUNDS;
    $('removeRound').hidden = p.rounds.length <= 1;

    // segmented states
    document.querySelectorAll('[data-format]').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.dataset.format === S.format)); });
    document.querySelectorAll('[data-scope]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.scope === S.scope)); });
    document.querySelectorAll('[data-act]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.act === S.act)); });
    var tip = skipping
      ? ({ well: 'TAP OR DRAG TO SKIP · TAP AGAIN TO RESTORE', row: 'TAP A WELL TO SKIP ITS ROW · AGAIN TO RESTORE', col: 'TAP A WELL TO SKIP ITS COLUMN · AGAIN TO RESTORE' })[S.scope]
      : ({ well: 'TAP AGAIN TO UN-MARK · DRAG TO PAINT', row: 'TAP A WELL TO MARK ITS ROW', col: 'TAP A WELL TO MARK ITS COLUMN' })[S.scope];
    $('legendTip').textContent = tip;

    var nameIn = $('plateName');
    if (document.activeElement !== nameIn) { nameIn.value = p.name; }

    renderRounds();
    renderZones();
  }

  function renderRounds() {
    var p = P(), ol = $('rounds'), active = document.activeElement;
    if (active && active.classList && active.classList.contains('nm') && ol.contains(active)) { // don't rebuild while typing
      updateRoundCounts();
      return;
    }
    ol.innerHTML = '';
    p.rounds.forEach(function (rd, k) {
      var n = k + 1, st = stats(n), on = n === p.round, pass = st.total > 0 && st.done === st.total;
      var li = document.createElement('li');
      var row = document.createElement(on ? 'div' : 'button');
      row.className = 'pt-round' + (on ? ' is-active' : '');
      if (!on) { row.type = 'button'; row.addEventListener('click', function () { goRound(n); }); row.setAttribute('aria-label', 'Switch to round ' + n + ', ' + rd.name); }
      var sw = mk('span', 'sw', ''); sw.style.background = ROUND_COLORS[k].c;
      row.appendChild(sw);
      row.appendChild(mk('span', 'n', 'R' + n));
      if (on) {
        var inp = document.createElement('input');
        inp.className = 'nm'; inp.type = 'text'; inp.maxLength = 28; inp.value = rd.name;
        inp.setAttribute('aria-label', 'Round ' + n + ' reagent name');
        inp.addEventListener('input', function () { rd.name = inp.value; $('curName').textContent = inp.value || ('Reagent ' + n); save(); });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { inp.blur(); } });
        row.appendChild(inp);
      } else {
        row.appendChild(mk('span', 'nm', rd.name || ('Reagent ' + n)));
      }
      var ct = mk('span', 'ct', st.done + '/' + st.total); ct.dataset.ct = n; row.appendChild(ct);
      var s = mk('span', 'st' + (pass || on ? ' ok' : ''), pass ? 'PASS ✓' : (on ? 'IN PROGRESS' : (st.done ? 'PARTIAL' : 'QUEUED')));
      s.dataset.st = n;
      row.appendChild(s);
      li.appendChild(row);
      ol.appendChild(li);
    });
    var act = ol.querySelector('.is-active');
    if (act && ol.scrollHeight > ol.clientHeight) { ol.scrollTop = Math.max(0, act.parentNode.offsetTop - ol.offsetTop - 44); }
  }
  function updateRoundCounts() {
    P().rounds.forEach(function (rd, k) {
      var st = stats(k + 1), el = document.querySelector('[data-ct="' + (k + 1) + '"]');
      if (el) { el.textContent = st.done + '/' + st.total; }
    });
  }

  var minimapBuilt = false;
  function renderZones() {
    var is384 = S.format === 384, zones = L && L.zones;
    $('zonebar').hidden = !is384 || opActive();
    $('minimapWrap').hidden = !(is384 && zones);
    if (!is384) { return; }
    var p = P();
    $('zoneLabel').textContent = zones ? ('ZONE ' + (p.zone + 1) + ' / 4 · ROWS ' + (p.zone >= 2 ? 'I–P' : 'A–H') + ' · COLS ' + (p.zone % 2 ? '13–24' : '1–12')) : 'FULL PLATE · 384';
    $('zonePrev').hidden = !zones;
    $('zoneNext').hidden = !zones;
    $('zoneToggle').textContent = zones ? 'FULL PLATE' : 'ZOOM ZONES';
    if (!zones) { return; }
    var mm = $('minimap');
    if (!minimapBuilt) {
      mm.innerHTML = '';
      for (var i = 0; i < 384; i++) { var c = mk('div', 'mc', ''); c.dataset.i = i; mm.appendChild(c); }
      for (var z = 0; z < 4; z++) {
        (function (z) {
          var b = mk('button', 'mz', '');
          b.type = 'button';
          b.style.left = (8 + (z % 2) * 144) + 'px';
          b.style.top = (8 + (z >= 2 ? 96 : 0)) + 'px';
          b.style.width = '143px'; b.style.height = '95px';
          b.setAttribute('aria-label', 'Show zone ' + (z + 1));
          b.dataset.z = z;
          b.addEventListener('click', function () { P().zone = z; afterChange(true); });
          mm.appendChild(b);
        })(z);
      }
      minimapBuilt = true;
    }
    var w = p.wells, R = p.round;
    mm.querySelectorAll('.mc').forEach(function (c) {
      var v = w[+c.dataset.i], cls = 'mc';
      if (isSkip(v)) { cls += ' skip'; c.style.removeProperty('--c'); }
      else if (hasR(v, R)) { cls += ' has done'; c.style.setProperty('--c', ROUND_COLORS[R - 1].c); }
      else if (topRound(v)) { cls += ' has'; c.style.setProperty('--c', ROUND_COLORS[topRound(v) - 1].c); }
      else { c.style.removeProperty('--c'); }
      if (c.className !== cls) { c.className = cls; }
    });
    mm.querySelectorAll('.mz').forEach(function (b) { b.classList.toggle('is-on', +b.dataset.z === p.zone); });
  }

  var checkSvg = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6.5" fill="#2E9E5B"/><path d="M4 7.2 l2 2 l4 -4.2" fill="none" stroke="#FFFFFF" stroke-width="1.6"/></svg>';
  function renderSaved() {
    var el = $('saved');
    if (!storageOK) {
      el.className = 'pt-saved is-off';
      el.innerHTML = '<span>NOT SAVING</span>';
      el.title = 'This browser is blocking storage (private mode?). Progress will be lost on refresh.';
      return;
    }
    el.className = 'pt-saved';
    el.innerHTML = checkSvg + '<span class="txt">AUTO-SAVED</span>';
    el.title = savedAt ? 'Saved in this browser at ' + savedAt.toLocaleTimeString() : 'Saved in this browser';
  }

  function renderAll() {
    buildPlate();
    renderWells();
    renderSide();
    renderOp();
  }
  function afterChange(relayout) {
    if (relayout) { renderAll(); } else { renderWells(); renderSide(); }
    save();
  }

  /* ---------- plate input: tap, drag-paint, shift-range ---------- */

  var drag = null, lastTapped = -1;

  function wellFromPoint(x, y) {
    var el = document.elementFromPoint(x, y);
    return el && el.classList && el.classList.contains('well') && plateEl.contains(el) ? el : null;
  }
  function paint(i) {
    if (drag.seen[i]) { return; }
    drag.seen[i] = true;
    if (drag.kind === 'skip') { setSkip(i, drag.on); } else { setWell(i, drag.on); }
    renderWells();
  }
  function rectRange(a, b) {
    var d = dims(), r0 = Math.floor(a / d.cols), c0 = a % d.cols, r1 = Math.floor(b / d.cols), c1 = b % d.cols, out = [];
    for (var r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) { for (var c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) { out.push(r * d.cols + c); } }
    return out;
  }

  plateEl.addEventListener('pointerdown', function (e) {
    var el = e.target.closest ? e.target.closest('.well') : null;
    if (!el || e.button > 0) { return; }
    e.preventDefault(); // no focus / text selection; keeps Space for "mark next"
    requestWake();
    var i = +el.dataset.i, p = P(), v = p.wells[i];
    if (S.scope === 'row' || S.scope === 'col') { markLine(S.scope, i); lastTapped = i; return; }
    if (S.act === 'add' && isSkip(v)) { return; }        // skipped this round: can't add
    if (S.act === 'skip' && hasR(v, p.round)) { return; } // added this round: can't skip
    var kind = S.act === 'skip' ? 'skip' : 'well';
    var on = kind === 'skip' ? !isSkip(v) : !hasR(v, p.round);
    snapshot();
    drag = { id: e.pointerId, kind: kind, on: on, seen: {} };
    if (e.shiftKey && lastTapped >= 0) {
      rectRange(lastTapped, i).forEach(paint);
    } else {
      paint(i);
    }
    lastTapped = i;
    try { plateEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  plateEl.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) { return; }
    var el = wellFromPoint(e.clientX, e.clientY);
    if (el) { paint(+el.dataset.i); lastTapped = +el.dataset.i; }
  });
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) { return; }
    drag = null;
    afterChange();
  }
  plateEl.addEventListener('pointerup', endDrag);
  plateEl.addEventListener('pointercancel', endDrag);
  // keyboard activation of a focused well (Tab users): click with detail 0
  plateEl.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('.well') : null;
    if (!el || e.detail !== 0) { return; }
    var i = +el.dataset.i, p = P(), v = p.wells[i];
    if (S.scope === 'row' || S.scope === 'col') { markLine(S.scope, i); return; }
    snapshot();
    if (S.act === 'skip') { setSkip(i, !isSkip(v)); } else if (!isSkip(v)) { setWell(i, !hasR(v, p.round)); }
    afterChange();
  });

  /* ---------- controls ---------- */

  document.querySelectorAll('[data-format]').forEach(function (b) {
    b.addEventListener('click', function () { S.format = +b.dataset.format; lastTapped = -1; minimapBuilt = false; afterChange(true); });
  });
  document.querySelectorAll('[data-scope]').forEach(function (b) {
    b.addEventListener('click', function () { S.scope = b.dataset.scope; followZone(nextFirst()); afterChange(true); });
  });
  document.querySelectorAll('[data-act]').forEach(function (b) {
    b.addEventListener('click', function () { S.act = b.dataset.act; afterChange(); });
  });
  $('orderBtn').addEventListener('click', function () { S.order = S.order === 'col' ? 'row' : 'col'; followZone(nextFirst()); afterChange(true); });
  $('undo').addEventListener('click', undo);
  $('markNext').addEventListener('click', function () { requestWake(); markNext(); if (L && L.zones) { renderAll(); } });
  $('nextRound').addEventListener('click', nextRound);
  $('addRound').addEventListener('click', function () { addRound(false); });
  $('removeRound').addEventListener('click', removeRound);
  $('zonePrev').addEventListener('click', function () { var p = P(); p.zone = (p.zone + 3) % 4; afterChange(true); });
  $('zoneNext').addEventListener('click', function () { var p = P(); p.zone = (p.zone + 1) % 4; afterChange(true); });
  $('zoneToggle').addEventListener('click', function () { var p = P(); p.view = useZones() ? 'full' : 'zones'; afterChange(true); });
  $('plateName').addEventListener('input', function (e) { P().name = e.target.value; save(); });
  ['up', 'down', 'left', 'right'].forEach(function (dir) {
    $('pad-' + dir).addEventListener('click', function () { moveTo(dir); });
  });
  $('padAuto').addEventListener('click', autoCursor);
  $('plateName').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.target.blur(); } });

  // RESET: tap twice within 3 s (no pop-up dialog at the bench)
  var resetBtn = $('reset'), resetTimer = null;
  resetBtn.addEventListener('click', function () {
    if (resetBtn.classList.contains('is-armed')) {
      clearTimeout(resetTimer);
      resetBtn.classList.remove('is-armed');
      resetBtn.textContent = 'RESET';
      resetPlate();
      return;
    }
    resetBtn.classList.add('is-armed');
    resetBtn.textContent = 'TAP AGAIN TO CLEAR';
    resetTimer = setTimeout(function () { resetBtn.classList.remove('is-armed'); resetBtn.textContent = 'RESET'; }, 3000);
  });

  // after a mouse click, drop focus from buttons so Space / Enter go to the shortcuts
  document.addEventListener('pointerup', function (e) {
    var a = document.activeElement;
    if (e.pointerType === 'mouse' && a && a.tagName === 'BUTTON') { a.blur(); }
  });

  document.addEventListener('keydown', function (e) {
    var t = e.target, tag = t && t.tagName;
    if (!$('askModal').hidden) { if (e.key === 'Escape') { closeAsk(false); } return; }
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.altKey) { return; }
    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); return; }
    if (e.ctrlKey) { return; }
    var onButton = tag === 'BUTTON' || tag === 'A';
    var k = e.key;
    var arrows = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (arrows[k]) { e.preventDefault(); moveTo(arrows[k]); return; }
    if (k === 'a' || k === 'A') { autoCursor(); return; }
    if (k === ' ' && !onButton) { e.preventDefault(); markNext(); if (L && L.zones) { renderAll(); } }
    else if (k === 'Enter' && !onButton) { e.preventDefault(); nextRound(); }
    else if (k === 'z' || k === 'Z') { undo(); }
    else if (k === 'w' || k === 'W') { S.scope = 'well'; afterChange(true); }
    else if (k === 'r' || k === 'R') { S.scope = 'row'; followZone(nextFirst()); afterChange(true); }
    else if (k === 'c' || k === 'C') { S.scope = 'col'; followZone(nextFirst()); afterChange(true); }
    else if (k === 's' || k === 'S') { S.act = S.act === 'skip' ? 'add' : 'skip'; afterChange(); }
    else if (/^[1-8]$/.test(k)) { goRound(+k); }
  });

  /* ---------- keep screen awake (iPad at the bench) ---------- */

  var wakeLock = null, wakeSupported = 'wakeLock' in navigator;
  var wakeBox = $('wake');
  if (wakeSupported) {
    $('wakeRow').hidden = false;
    wakeBox.checked = S.wake;
    wakeBox.addEventListener('change', function () {
      S.wake = wakeBox.checked; save();
      if (S.wake) { requestWake(); } else if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
    });
  }
  function requestWake() {
    if (!wakeSupported || !S.wake || wakeLock || document.visibilityState !== 'visible') { return; }
    navigator.wakeLock.request('screen').then(function (l) {
      wakeLock = l;
      l.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () { /* not allowed right now */ });
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { requestWake(); } });

  /* ---------- go ---------- */

  var resizeRaf = 0;
  function onResize() {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(function () {
      var before = layoutKey;
      buildPlate();
      if (layoutKey !== before) { renderWells(); renderZones(); }
      renderOp();
    });
  }
  window.addEventListener('resize', onResize);
  if ('ResizeObserver' in window) { new ResizeObserver(onResize).observe(frameEl); }
  // other tab changed the plate: pick it up
  window.addEventListener('storage', function (e) { if (e.key === KEY) { S = load(); minimapBuilt = false; layoutKey = ''; renderAll(); } });

  /* ---------- 1:1 controls & start-up choice ---------- */

  $('opBtn').addEventListener('click', function () { if (opActive()) { exitOp(); } else { enterOp(); } });
  $('opExit').addEventListener('click', exitOp);
  $('opRecal').addEventListener('click', startCalib);
  document.querySelectorAll('[data-cal]').forEach(function (b) {
    b.addEventListener('click', function () {
      calK = Math.min(14, Math.max(2, calK * parseFloat(b.dataset.cal)));
      renderAll();
    });
  });
  $('calDefault').addEventListener('click', function () { calK = guessK(); renderAll(); });
  $('calCard').addEventListener('click', function () { S.op.card = !S.op.card; renderAll(); });
  $('calDone').addEventListener('click', function () {
    S.op.k = calK; S.op.on = true; S.op.card = false; calibrating = false; layoutKey = '';
    renderAll(); save();
  });
  $('calCancel').addEventListener('click', function () {
    calibrating = false; S.op.card = false; layoutKey = '';
    if (!S.op.k) { S.op.on = false; }
    renderAll(); save();
  });

  var askModal = $('askModal');
  function openAsk() {
    $('askYesSub').textContent = S.op.k ? 'Already calibrated on this device — set the plate on the outline' : 'Calibrate once, then work under the plate';
    $('askRemember').checked = false;
    askModal.hidden = false;
    $(S.op.on ? 'askYes' : 'askYes').focus();
  }
  function closeAsk(yes) {
    askModal.hidden = true;
    S.op.remember = $('askRemember').checked;
    if (yes) { enterOp(); } else { S.op.on = false; calibrating = false; layoutKey = ''; renderAll(); save(); }
  }
  $('askYes').addEventListener('click', function () { closeAsk(true); });
  $('askNo').addEventListener('click', function () { closeAsk(false); });

  renderAll();
  renderSaved();
  if (isIPad() && !S.op.remember) { openAsk(); }
  else if (S.op.on && !S.op.k) { startCalib(); }
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', renderOp); }
  if (document.fonts && document.fonts.ready) { document.fonts.ready.then(onResize); }
})();
