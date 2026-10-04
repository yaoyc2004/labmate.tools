/* labmate.tools · Panel Designer
   Assign fluors to markers on a cytometer, see spectra, estimated spillover
   (conventional) or signature similarity (spectral). Runs in the browser;
   state is kept in localStorage. */
(function () {
  'use strict';

  var DATA = window.LMT_CYTO;
  var SPEC = window.LMT_SPECTRA || { source: null, spectra: {} };
  if (!DATA) { document.body.insertAdjacentHTML('afterbegin', '<p style="padding:16px">Data file did not load.</p>'); return; }

  var STORE_KEY = 'labmate.panelDesigner.v1';
  var L0 = 300, L1 = 900, N = L1 - L0 + 1;
  var LN2 = Math.LN2;
  var COMPAT = 0.08;               // share of a dye's light that must reach some detector to count as usable
  var LASER_NAMES = { 355: 'UV', 375: 'NEAR UV', 405: 'VIOLET', 488: 'BLUE', 532: 'GREEN', 561: 'YELLOW-GREEN', 594: 'ORANGE', 633: 'RED', 637: 'RED', 638: 'RED', 640: 'RED', 808: 'IR' };
  var X0 = 350, X1 = 850, CW = 860, CH = 300;   // chart geometry

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function laserName(nm) { return LASER_NAMES[nm] || (nm < 400 ? 'UV' : nm < 450 ? 'VIOLET' : nm < 520 ? 'BLUE' : nm < 600 ? 'YELLOW-GREEN' : nm < 700 ? 'RED' : 'IR'); }
  function fmtPct(v) { return v < 0.05 ? '·' : v.toFixed(1); }
  function toast(msg) { var t = $('toast'); t.textContent = msg; clearTimeout(toast.t); toast.t = setTimeout(function () { t.textContent = ''; }, 3500); }

  // colour for a curve, from its emission peak
  function waveColor(nm) {
    var stops = [[400, 262], [440, 236], [480, 200], [510, 160], [540, 110], [570, 50], [600, 28], [640, 6], [690, 350], [760, 325], [850, 300]];
    nm = Math.max(400, Math.min(850, nm || 550));
    for (var i = 1; i < stops.length; i++) {
      if (nm <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i], t = (nm - a[0]) / (b[0] - a[0]);
        var h1 = a[1], h2 = b[1]; if (Math.abs(h2 - h1) > 180) h2 += h2 < h1 ? 360 : -360;
        return 'hsl(' + Math.round(((h1 + (h2 - h1) * t) + 360) % 360) + ' 58% ' + (nm > 680 ? 34 : 40) + '%)';
      }
    }
    return 'hsl(300 50% 34%)';
  }

  /* ---------- filters ---------- */
  function parseFilter(s) {
    var t = String(s || '').trim().toUpperCase().replace(/\s+/g, '').replace(/NM/g, '').replace(/[–—]/g, '-');
    var m, lo, hi;
    if ((m = t.match(/^(\d{3}(?:\.\d+)?)\/(\d{1,3}(?:\.\d+)?)$/))) { var c = +m[1], w = +m[2]; if (w <= 0 || w > 300) return null; lo = c - w / 2; hi = c + w / 2; }
    else if ((m = t.match(/^(\d{3})(?:LP|>)$/))) { lo = +m[1]; hi = L1; }
    else if ((m = t.match(/^>(\d{3})$/))) { lo = +m[1]; hi = L1; }
    else if ((m = t.match(/^(\d{3})SP$/))) { lo = L0; hi = +m[1]; }
    else if ((m = t.match(/^(\d{3}(?:\.\d+)?)-(\d{3}(?:\.\d+)?)$/))) { lo = +m[1]; hi = +m[2]; }
    else return null;
    if (!(lo < hi) || lo < L0 || hi > L1) return null;
    return [lo, hi];
  }
  function detRange(d) { return d.range ? [d.range[0], d.range[1]] : parseFilter(d.filter); }
  function detLabel(d) { return d.filter || (d.range ? (+d.range[0]).toFixed(d.range[0] % 1 ? 1 : 0) + '–' + (+d.range[1]).toFixed(d.range[1] % 1 ? 1 : 0) : '?'); }

  /* ---------- state ---------- */
  var DEFAULT_ROWS = [
    ['CD3', 'high', 'bv421'], ['Live/Dead', '', 'zombie-aqua'], ['CD45RA', 'high', 'bv605'], ['CD8', 'high', 'fitc'],
    ['CCR7', 'med', 'pe'], ['CD4', 'high', 'pe-dazzle-594'], ['CD27', 'med', 'pe-cy7'], ['CD25', 'low', 'apc'], ['CD127', 'low', 'alexa-fluor-700']
  ];
  function newRow(marker, expr, fluorId) { return { id: uid('r'), marker: marker || '', expr: expr || '', fluorId: fluorId || null, det: null, bright: null }; }
  var defaults = {
    v: 1, instId: 'thermo-attune-nxt-4l-14c',
    rows: DEFAULT_ROWS.map(function (r) { return newRow(r[0], r[1], r[2]); }),
    custom: { instruments: [], fluors: [] },
    view: { curve: 'em', lasers: true, bands: true }, sigOff: [], backup: null
  };
  var state = clone(defaults);
  var canStore = true;
  try {
    var raw = localStorage.getItem(STORE_KEY);
    if (raw) { var saved = JSON.parse(raw); if (saved && saved.v === 1) state = Object.assign(clone(defaults), saved); }
  } catch (e) { canStore = false; }
  if (!state.custom || !Array.isArray(state.custom.instruments)) state.custom = { instruments: [], fluors: [] };
  if (!Array.isArray(state.rows)) state.rows = [];
  if (!state.view) state.view = clone(defaults.view);
  if (!Array.isArray(state.sigOff)) state.sigOff = [];

  function save() {
    if (!canStore) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { canStore = false; }
    var f = $('savedFlag');
    f.textContent = canStore ? '● AUTO-SAVED · STAYS IN THIS BROWSER' : 'NOT SAVED · BROWSER STORAGE IS OFF';
    f.classList.toggle('off', !canStore);
  }

  /* ---------- registries ---------- */
  var fluorById = {}, instById = {};
  function rebuildRegistry() {
    fluorById = {}; instById = {};
    DATA.fluors.forEach(function (f) { fluorById[f.id] = f; });
    state.custom.fluors.forEach(function (f) { f.origin = 'user'; fluorById[f.id] = f; });
    DATA.instruments.forEach(function (i) { instById[i.id] = i; });
    state.custom.instruments.forEach(function (i) { i.origin = 'user'; instById[i.id] = i; });
    compatCache = {};
  }
  function allFluors() { return DATA.fluors.concat(state.custom.fluors); }
  function inst() { return instById[state.instId] || DATA.instruments[0]; }
  function isSpectral(i) { return (i || inst()).type === 'spectral'; }

  function flatDets(i) {
    var out = [];
    i.lasers.forEach(function (L) {
      (L.detectors || []).forEach(function (d) {
        var r = detRange(d);
        if (r) out.push({ key: L.nm + ':' + d.id, id: d.id, laser: +L.nm, range: r, label: detLabel(d), typical: d.typical || '' });
      });
    });
    return out;
  }

  /* ---------- spectra ---------- */
  var specCache = {};
  function band(arr, peak, h, sl, sr) {
    for (var i = 0; i < N; i++) {
      var l = L0 + i, s = l < peak ? sl : sr, x = (l - peak) / s;
      if (x > -6 && x < 6) arr[i] += h * Math.exp(-LN2 * x * x);
    }
  }
  function normalise(arr) { var m = 0, i; for (i = 0; i < N; i++) if (arr[i] > m) m = arr[i]; if (m > 0) for (i = 0; i < N; i++) arr[i] /= m; return arr; }
  function defaultEx(laser) { return { 355: 350, 375: 372, 405: 405, 488: 495, 532: 535, 561: 560, 594: 590, 640: 650, 808: 800 }[laser] || laser || 490; }

  function kindOf(f) {
    var n = f.name || '', fam = f.family || '';
    if (/^cFluor BYG/.test(n)) return 'PE';
    if (/^PE(?=[-\/ ]|$)/.test(n)) return n === 'PE' ? 'PE0' : 'PE';
    if (/^APC(?=[-\/ ]|$)/.test(n)) return n === 'APC' ? 'APC0' : 'APC';
    if (/^PerCP(?=[-\/ ]|$)/.test(n)) return n === 'PerCP' ? 'PerCP0' : 'PerCP';
    if (/Brilliant Violet|Super Bright|RealViolet/.test(fam) || /^(StarBright Violet|cFluor V|NovaFluor Violet)/.test(n)) return 'PV';
    if (/Brilliant UV/.test(fam) || /^(StarBright UltraViolet|cFluor UV|NovaFluor UV|Spark UV)/.test(n)) return 'PU';
    return '';
  }
  function accH(em) { return em < 640 ? 0.06 : em < 700 ? 0.12 : em < 740 ? 0.08 : 0.04; }
  function acceptorEm(em, emM) { band(em, emM, 1, emM > 740 ? 22 : 16, emM > 740 ? 35 : 30); }

  // modelled spectra from peak values; replaced by measured spectra where available
  function modelSpectra(f) {
    var ex = new Float64Array(N), em = new Float64Array(N);
    var k = kindOf(f), exM = f.exMax || defaultEx(f.laser), emM = f.emMax || exM + 30;
    var PEx = function () { band(ex, 498, 0.5, 14, 14); band(ex, 546, 0.82, 14, 14); band(ex, 566, 1, 12, 12); band(ex, 380, 0.06, 40, 40); };
    var APCx = function () { band(ex, 610, 0.55, 30, 30); band(ex, 651, 1, 12, 12); };
    var PerCPx = function () { band(ex, 482, 1, 22, 22); band(ex, 435, 0.55, 22, 22); };
    switch (k) {
      case 'PE0': PEx(); band(em, 576, 1, 10, 18); band(em, 615, 0.12, 25, 30); break;
      case 'PE': PEx(); band(ex, emM - 25, accH(emM), 18, 14); acceptorEm(em, emM); band(em, 576, 0.06, 10, 20); break;
      case 'APC0': APCx(); band(em, 660, 1, 10, 22); band(em, 722, 0.06, 20, 25); break;
      case 'APC': APCx(); band(ex, emM - 25, 0.06, 18, 14); acceptorEm(em, emM); band(em, 660, 0.05, 10, 18); break;
      case 'PerCP0': PerCPx(); band(em, 678, 1, 12, 20); break;
      case 'PerCP': PerCPx(); band(ex, emM - 25, 0.15, 18, 14); acceptorEm(em, emM); band(em, 678, 0.08, 12, 20); break;
      case 'PV':
        band(ex, exM, 1, 28, 20); band(ex, 350, 0.35, 30, 30);
        if (emM > 460) { band(ex, emM - 25, accH(emM), 18, 14); acceptorEm(em, emM); band(em, 421, 0.03, 8, 14); }
        else { band(em, emM, 1, 9, 16); band(em, emM + 22, 0.3, 12, 18); }
        break;
      case 'PU':
        band(ex, exM, 1, 22, 25);
        if (emM > 430) { band(ex, emM - 25, accH(emM), 18, 14); acceptorEm(em, emM); band(em, 395, 0.03, 8, 12); }
        else { band(em, emM, 1, 9, 16); band(em, emM + 22, 0.3, 12, 18); }
        break;
      default:
        // band widths grow with wavelength; large-Stokes-shift dyes (e.g. amine-reactive viability dyes) have broad excitation
        var broad = emM - exM > 70, sl = broad ? 40 : 0.06 * exM, sr = broad ? 30 : 0.035 * exM;
        band(ex, exM, 1, sl, sr); band(ex, exM - 0.07 * exM, 0.2, 0.035 * exM, 0.035 * exM); band(ex, Math.max(L0, 0.62 * exM), 0.08, 25, 25);
        // red dyes have a narrower main band and a weaker vibronic shoulder than green ones
        var t = Math.max(0, Math.min(1, (emM - 600) / 100));
        band(em, emM, 1, 0.028 * emM, (0.05 - 0.018 * t) * emM); band(em, emM + 0.06 * emM, 0.3 - 0.12 * t, 0.035 * emM, 0.045 * emM);
    }
    if (f.origin === 'user' && Array.isArray(f.alsoExcitedBy)) f.alsoExcitedBy.forEach(function (nm) { band(ex, +nm, 0.3, 15, 15); });
    return { ex: normalise(ex), em: normalise(em) };
  }
  function fromPacked(p) { // [startNm, [ints 0..1000]]
    var arr = new Float64Array(N);
    if (!p || !Array.isArray(p[1])) return null;
    for (var j = 0; j < p[1].length; j++) { var i = p[0] + j - L0; if (i >= 0 && i < N) arr[i] = p[1][j] / 1000; }
    return normalise(arr);
  }
  function spectra(f) {
    if (specCache[f.id]) return specCache[f.id];
    var real = null, src = 'model';
    if (f.spectrum && (f.spectrum.source === 'csv' || f.spectrum.source === 'fpbase') && f.spectrum.ex && f.spectrum.em) {
      real = { ex: fromPacked(f.spectrum.ex), em: fromPacked(f.spectrum.em) }; src = f.spectrum.source;
    } else if (SPEC.spectra && SPEC.spectra[f.id]) {
      var s = SPEC.spectra[f.id]; real = { ex: fromPacked(s.ex), em: fromPacked(s.em) }; src = 'fpbase';
    }
    var sp = (real && real.ex && real.em) ? real : modelSpectra(f);
    if (!(real && real.ex && real.em)) src = 'model';
    var cum = new Float64Array(N + 1);
    for (var i = 0; i < N; i++) cum[i + 1] = cum[i] + sp.em[i];
    sp.cum = cum; sp.total = cum[N] || 1; sp.src = src; sp.approx = src === 'model';
    specCache[f.id] = sp;
    return sp;
  }
  function exAt(sp, nm) {
    var x = nm - L0, i = Math.floor(x); if (i < 0 || i >= N - 1) return 0;
    return sp.ex[i] + (sp.ex[i + 1] - sp.ex[i]) * (x - i);
  }
  function bandSum(sp, r) {
    var i0 = Math.max(0, Math.ceil(r[0] - L0)), i1 = Math.min(N - 1, Math.floor(r[1] - L0));
    return i1 < i0 ? 0 : sp.cum[i1 + 1] - sp.cum[i0];
  }
  function sig(f, d) { var sp = spectra(f); return exAt(sp, d.laser) * bandSum(sp, d.range); }

  var compatCache = {};
  function bestEff(f, i, dets) {
    var key = i.id + '|' + f.id;
    if (compatCache[key] != null) return compatCache[key];
    var sp = spectra(f), best = 0;
    dets.forEach(function (d) { var v = sig(f, d) / sp.total; if (v > best) best = v; });
    return (compatCache[key] = best);
  }

  /* ---------- analysis ---------- */
  var model = null;
  function analyse() {
    var I = inst(), dets = flatDets(I), spectral = isSpectral(I);
    var rows = state.rows.map(function (r, idx) {
      var f = r.fluorId ? fluorById[r.fluorId] : null;
      var o = { r: r, idx: idx, f: f, checks: [], color: f ? waveColor(f.emMax || defaultEx(f.laser) + 30) : '#8A918C' };
      if (!f) return o;
      o.sp = spectra(f);
      var sigs = dets.map(function (d) { return sig(f, d); });
      var bi = 0;
      if (spectral) sigs.forEach(function (v, k) { if (v > sigs[bi]) bi = k; });
      else {
        // auto detector: only lasers that excite the dye almost as well as its best laser,
        // so a wide filter on a weaker laser does not win on raw light alone (e.g. PE goes to 561, not 488)
        var exL = {}, exMaxL = 0;
        dets.forEach(function (d) { if (exL[d.laser] == null) { exL[d.laser] = exAt(o.sp, d.laser); exMaxL = Math.max(exMaxL, exL[d.laser]); } });
        bi = -1;
        sigs.forEach(function (v, k) { if (exL[dets[k].laser] >= 0.75 * exMaxL && (bi < 0 || v > sigs[bi])) bi = k; });
        if (bi < 0) bi = 0;
      }
      o.sigs = sigs; o.best = dets[bi]; o.bestSig = sigs[bi] || 0;
      o.eff = (sigs[bi] || 0) / o.sp.total;
      if (spectral) { o.det = o.best; o.detSig = o.bestSig; }
      else {
        var chosen = r.det ? dets.filter(function (d) { return d.key === r.det; })[0] : null;
        o.det = chosen || o.best; o.detSig = chosen ? sigs[dets.indexOf(chosen)] : o.bestSig;
        o.manual = !!chosen;
      }
      return o;
    });
    var act = rows.filter(function (o) { return o.f && o.det && o.detSig > 0; });
    var m = { inst: I, dets: dets, spectral: spectral, rows: rows, act: act, approxN: 0 };
    act.forEach(function (o) { if (o.sp.approx) m.approxN++; });

    if (!spectral) {
      // spill[i][j] = % of fluor i's primary signal that lands in fluor j's detector
      m.spill = act.map(function (a) { return act.map(function (b) { return a === b ? 100 : 100 * (a.sigs[m.dets.indexOf(b.det)] || 0) / a.detSig; }); });
      act.forEach(function (o, j) {
        var mx = 0, from = null;
        act.forEach(function (p, i) { if (i !== j && m.spill[i][j] > mx) { mx = m.spill[i][j]; from = p; } });
        o.recv = mx; o.recvFrom = from;
      });
    } else {
      act.forEach(function (o) {
        var n = Math.sqrt(o.sigs.reduce(function (s, v) { return s + v * v; }, 0)) || 1;
        o.unit = o.sigs.map(function (v) { return v / n; });
        var mx = Math.max.apply(null, o.sigs) || 1;
        o.sigNorm = o.sigs.map(function (v) { return v / mx; });
      });
      m.sim = act.map(function (a) { return act.map(function (b) { var s = 0; for (var k = 0; k < a.unit.length; k++) s += a.unit[k] * b.unit[k]; return s; }); });
      act.forEach(function (o, j) {
        var mx = -1, from = null;
        act.forEach(function (p, i) { if (i !== j && m.sim[i][j] > mx) { mx = m.sim[i][j]; from = p; } });
        o.recv = Math.max(0, mx); o.recvFrom = from;
      });
      m.cplx = act.length > 1 ? condition(m.sim) : (act.length ? 1 : null);
    }
    checks(m);
    model = m;
    return m;
  }

  function exprRank(e) { return { high: 3, med: 2, low: 1 }[e] || 0; }
  function brightOf(o) { return o.r.bright != null ? +o.r.bright : (o.f && o.f.brightness ? o.f.brightness : null); }

  function checks(m) {
    var byDet = {};
    m.act.forEach(function (o) { (byDet[o.det.key] = byDet[o.det.key] || []).push(o); });
    m.rows.forEach(function (o) {
      var c = o.checks, r = o.r;
      if (!o.f) { c.push(['empty', 'Pick a fluor.']); return; }
      if (o.eff < COMPAT) c.push(['check', 'This instrument barely excites or detects ' + o.f.name + '.']);
      if (!m.spectral) {
        var same = (byDet[o.det.key] || []).filter(function (p) { return p !== o; });
        if (same.length) c.push(['check', 'Shares ' + o.det.id + ' with ' + same.map(function (p) { return p.r.marker || p.f.name; }).join(', ') + ' — choose another detector or dye.']);
        if (o.manual && o.det !== o.best && o.detSig < 0.7 * o.bestSig) c.push(['check', o.f.name + ' is brighter in ' + o.best.id + ' (' + o.best.label + '); only ' + Math.round(100 * o.detSig / o.bestSig) + ' % of that here.']);
        if (o.recvFrom && o.recv >= 10) c.push(['check', 'Gets ' + o.recv.toFixed(1) + ' % from ' + o.recvFrom.f.name + ' (' + (o.recvFrom.r.marker || '—') + ').']);
        else if (o.recvFrom && o.recv >= 5 && exprRank(r.expr) === 1 && exprRank(o.recvFrom.r.expr) === 3) c.push(['check', 'Dim marker receiving ' + o.recv.toFixed(1) + ' % from bright ' + (o.recvFrom.r.marker || o.recvFrom.f.name) + '.']);
      } else {
        if (o.recvFrom && o.recv >= 0.9) c.push(['check', 'Nearly the same signature as ' + o.recvFrom.f.name + ' (' + o.recv.toFixed(2) + ') — hard to unmix.']);
        else if (o.recvFrom && o.recv >= 0.8) c.push(['note', 'Similar to ' + o.recvFrom.f.name + ' (' + o.recv.toFixed(2) + '); keep them on markers that are not co-expressed.']);
      }
      var b = brightOf(o);
      if (exprRank(r.expr) === 1 && b != null && b <= 2) c.push(['check', 'Dim marker on a dim dye — try a brighter one.']);
      if (exprRank(r.expr) === 1 && b != null && b >= 4) c.push(['note', 'Dim marker on a bright dye — good.']);
      if (o.f.name && /-(Cy7|Cy5\.5|Cy5|Fire|Vio770)/.test(o.f.name) && !c.some(function (x) { return x[0] === 'check'; })) c.push(['note', 'Tandem — protect from light and fixative.']);
    });
  }

  // condition number of a symmetric positive semi-definite matrix (cyclic Jacobi)
  function condition(S) {
    var n = S.length, A = S.map(function (r) { return r.slice(); });
    for (var sweep = 0; sweep < 60; sweep++) {
      var off = 0, p, q;
      for (p = 0; p < n; p++) for (q = p + 1; q < n; q++) off += A[p][q] * A[p][q];
      if (off < 1e-18) break;
      for (p = 0; p < n; p++) for (q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-15) continue;
        var th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        var t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        var c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (var k = 0; k < n; k++) {
          var akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
        }
        for (k = 0; k < n; k++) {
          var apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
        }
      }
    }
    var ev = A.map(function (r, i) { return r[i]; }), mx = Math.max.apply(null, ev), mn = Math.min.apply(null, ev);
    return mn <= 1e-9 ? Infinity : Math.sqrt(mx / mn);
  }

  /* ---------- render: instrument ---------- */
  function renderInstSelect() {
    var sel = $('inst'), I = inst();
    var mine = state.custom.instruments, conv = DATA.instruments.filter(function (i) { return i.type !== 'spectral'; }), spec = DATA.instruments.filter(function (i) { return i.type === 'spectral'; });
    var byName = function (a, b) { return a.name.localeCompare(b.name); };
    var opt = function (i) { return '<option value="' + esc(i.id) + '"' + (i.id === I.id ? ' selected' : '') + '>' + esc(i.name + ' — ' + (i.variant || '')) + '</option>'; };
    var h = '';
    if (mine.length) h += '<optgroup label="MY INSTRUMENTS">' + mine.slice().sort(byName).map(opt).join('') + '</optgroup>';
    h += '<optgroup label="PRESETS · CONVENTIONAL">' + conv.slice().sort(byName).map(opt).join('') + '</optgroup>';
    h += '<optgroup label="PRESETS · SPECTRAL">' + spec.slice().sort(byName).map(opt).join('') + '</optgroup>';
    h += '<option value="__add">+ Add your own instrument…</option>';
    sel.innerHTML = h;
    $('delInst').hidden = I.origin !== 'user';
    $('editInst').textContent = I.origin === 'user' ? 'EDIT' : 'EDIT FILTERS';
  }

  function renderInst(m) {
    var I = m.inst, nDet = m.dets.length;
    var used = {}; m.act.forEach(function (o) { (used[o.det.key] = used[o.det.key] || []).push(o); });
    $('instSummary').textContent = nDet + (m.spectral ? ' CHANNELS · ' : ' DETECTORS · ') + I.lasers.length + ' LASER' + (I.lasers.length > 1 ? 'S' : '') + (m.spectral ? ' · SPECTRAL' : '');
    var src = I.origin === 'user'
      ? 'Your own instrument' + (I.basedOn && instById[I.basedOn] ? ', copied from ' + instById[I.basedOn].name + '.' : '.') + ' Saved in this browser.'
      : (I.status === 'verify' ? 'To check: ' + (I.statusNote || 'not yet verified against a primary source.') + ' ' : '') + 'Source: ' + (I.source || '—').split(' ; ').map(function (u) { return '<a href="' + esc(u) + '" rel="noopener" target="_blank">' + esc(u.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]) + '</a>'; }).join(', ') + '.';
    $('instSource').innerHTML = I.origin === 'user' ? esc(src) : src;
    var h = '';
    I.lasers.forEach(function (L) {
      var dl = m.dets.filter(function (d) { return d.laser === +L.nm; });
      h += '<div class="laser"><div class="laser-head"><span class="nm">' + esc(L.nm) + ' <small>nm</small></span><span class="meta">' + esc(L.name ? L.name.toUpperCase() : laserName(+L.nm)) + (L.mW ? ' · ' + esc(L.mW) + ' mW' : '') + '</span></div>';
      if (m.spectral) {
        var lo = dl.length ? Math.round(dl[0].range[0]) : '', hi = dl.length ? Math.round(dl[dl.length - 1].range[1]) : '';
        var peaks = dl.filter(function (d) { return used[d.key]; });
        h += '<div class="spec-laser"><span class="mono" style="font-size:12px">' + dl.length + ' CHANNELS · ' + lo + '–' + hi + ' nm</span>';
        h += peaks.length ? '<div class="chips">' + peaks.map(function (d) { return '<span class="chip" title="' + esc(used[d.key].map(function (o) { return o.f.name; }).join(', ')) + '">' + esc(d.id) + ' · ' + esc(used[d.key].map(function (o) { return o.r.marker || o.f.name; }).join(' / ')) + '</span>'; }).join('') + '</div>' : '<span class="muted" style="font-size:12px">No peak channels used</span>';
        h += '</div>';
      } else {
        dl.forEach(function (d) {
          var u = used[d.key];
          h += '<div class="det' + (u && u.length > 1 ? ' clash' : '') + '"><b>' + esc(d.id) + '</b><span>' + esc(d.label) + '</span>' +
            (u ? '<span class="use" title="' + esc(u.map(function (o) { return o.f.name + ' · ' + (o.r.marker || ''); }).join(', ')) + '">' + esc(u.map(function (o) { return o.f.name.replace(/Alexa Fluor /, 'AF') + ' · ' + (o.r.marker || '—'); }).join(' / ')) + '</span>' : '<span class="free">— free</span>') + '</div>';
        });
      }
      h += '</div>';
    });
    $('detGrid').innerHTML = h;
  }

  /* ---------- render: panel table ---------- */
  function renderRows(m) {
    $('thDet').textContent = m.spectral ? 'PEAK CHANNEL' : 'DETECTOR';
    $('thRecv').textContent = m.spectral ? 'MOST SIMILAR' : 'RECEIVES (MAX)';
    var h = '';
    m.rows.forEach(function (o, i) {
      var r = o.r, f = o.f;
      var exprSel = '<select data-k="expr" aria-label="Expression, row ' + (i + 1) + '">' + [['', '—'], ['high', 'HIGH'], ['med', 'MED'], ['low', 'LOW']].map(function (x) { return '<option value="' + x[0] + '"' + (r.expr === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>';
      var fb = f ? '<button type="button" class="fluor-btn" data-act="pick" aria-label="Fluor for row ' + (i + 1) + ': ' + esc(f.name) + '. Change"><span class="sw" style="background:' + o.color + '"></span><span class="nm">' + esc(f.name) + '</span>' + (f.origin === 'user' ? ' <span class="tag mine">MINE</span>' : '') + '</button>'
        : '<button type="button" class="fluor-btn empty" data-act="pick">CHOOSE…</button>';
      var bv = r.bright != null ? String(r.bright) : (f && f.brightness ? String(f.brightness) : '');
      var bSel = '<select data-k="bright" aria-label="Dye brightness, row ' + (i + 1) + '"' + (f && f.brightness && r.bright == null ? ' title="From ' + esc(f.brightnessSrc || 'vendor') + '"' : '') + '><option value="">—</option>' + [1, 2, 3, 4, 5].map(function (n) { return '<option value="' + n + '"' + (bv === String(n) ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>';
      var det = '';
      if (f && o.det) {
        if (m.spectral) det = '<span class="mono" style="font-size:12px">' + esc(o.det.id) + '</span>';
        else {
          var opts = m.dets.map(function (d, k) { return { d: d, v: o.sigs[k] }; }).filter(function (x) { return x.v > 0.002 * o.bestSig; }).sort(function (a, b) { return b.v - a.v; });
          det = '<select data-k="det" aria-label="Detector, row ' + (i + 1) + '"><option value="">AUTO · ' + esc(o.best.id) + '</option>' +
            opts.map(function (x) { return '<option value="' + esc(x.d.key) + '"' + (r.det === x.d.key ? ' selected' : '') + '>' + esc(x.d.id + ' · ' + x.d.label + ' · ' + Math.round(100 * x.v / o.bestSig) + '%') + '</option>'; }).join('') + '</select>';
        }
      }
      var recv = '';
      if (o.recvFrom) recv = m.spectral ? o.recv.toFixed(2) + ' · ' + esc(o.recvFrom.f.name) : (o.recv < 0.05 ? '0.0 %' : o.recv.toFixed(1) + ' %');
      else if (f && o.det) recv = m.spectral ? '—' : '0.0 %';
      if (recv && o.sp && (o.sp.approx || (o.recvFrom && o.recvFrom.sp.approx))) recv = '≈ ' + recv;
      var first = o.checks.filter(function (c) { return c[0] === 'check'; })[0];
      var note = o.checks.filter(function (c) { return c[0] === 'note'; })[0];
      var chk = !f ? '<span class="muted">Pick a fluor.</span>'
        : first ? '<span class="tag check">CHECK</span>' + esc(first[1]) + (o.checks.filter(function (c) { return c[0] === 'check'; }).length > 1 ? ' <span class="muted">(+' + (o.checks.filter(function (c) { return c[0] === 'check'; }).length - 1) + ')</span>' : '')
        : '<span class="tag pass">PASS</span>' + (note ? esc(note[1]) : '');
      h += '<tr data-i="' + i + '"><td class="num">' + String(i + 1).padStart(2, '0') + '</td>' +
        '<td><input data-k="marker" value="' + esc(r.marker) + '" aria-label="Marker, row ' + (i + 1) + '" autocomplete="off" spellcheck="false" placeholder="marker"></td>' +
        '<td>' + exprSel + '</td><td>' + fb + '</td><td>' + bSel + '</td><td>' + det + '</td>' +
        '<td class="recv">' + recv + '</td><td class="chk" title="' + esc(o.checks.map(function (c) { return c[1]; }).join('\n')) + '">' + chk + '</td>' +
        '<td><button type="button" class="rm" data-act="rm" aria-label="Remove row ' + (i + 1) + '">×</button></td></tr>';
    });
    if (!m.rows.length) h = '<tr><td colspan="9" class="muted" style="padding:18px 6px">No markers yet — add one, or paste a list.</td></tr>';
    $('rows').innerHTML = h;
    var nCheck = m.rows.filter(function (o) { return o.f && o.checks.some(function (c) { return c[0] === 'check'; }); }).length;
    var usedDet = {}; m.act.forEach(function (o) { usedDet[o.det.key] = 1; });
    $('panelSummary').textContent = m.rows.length + ' MARKER' + (m.rows.length === 1 ? '' : 'S') + (m.spectral ? '' : ' · ' + Object.keys(usedDet).length + ' OF ' + m.dets.length + ' DETECTORS USED') + (nCheck ? ' · ' + nCheck + ' TO CHECK' : '');
  }

  /* ---------- render: spectra chart ---------- */
  function cx(l) { return (l - X0) / (X1 - X0) * CW; }
  function curvePath(arr) {
    var pts = [];
    for (var l = X0; l <= X1; l += 2) pts.push(cx(l).toFixed(1) + ',' + (CH - arr[l - L0] * (CH - 20)).toFixed(1));
    return 'M' + pts.join(' L');
  }
  function renderChart(m) {
    var exView = state.view.curve === 'ex';
    $('chartMode').textContent = (exView ? 'EXCITATION' : 'EMISSION') + ' · NORMALISED';
    $('showBands').disabled = m.spectral;
    var s = '<svg viewBox="-44 -64 ' + (CW + 70) + ' ' + (CH + 110) + '" role="img" aria-label="' + (exView ? 'Excitation' : 'Emission') + ' spectra of the panel dyes, ' + X0 + ' to ' + X1 + ' nm">';
    if (state.view.bands && !m.spectral && !exView) {
      var seen = {};
      m.act.forEach(function (o) {
        if (seen[o.det.key]) return; seen[o.det.key] = 1;
        var a = Math.max(X0, o.det.range[0]), b = Math.min(X1, o.det.range[1]); if (b <= a) return;
        s += '<rect x="' + cx(a).toFixed(1) + '" y="0" width="' + (cx(b) - cx(a)).toFixed(1) + '" height="' + CH + '" fill="#9CC7B6" opacity=".38"/>' +
          '<text x="' + cx((a + b) / 2).toFixed(1) + '" y="' + (CH + 46) + '" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="9" fill="#17403D">' + esc(o.det.id) + '</text>';
      });
    }
    for (var l = 350; l <= 850; l += 50) s += '<line x1="' + cx(l) + '" y1="' + CH + '" x2="' + cx(l) + '" y2="' + (CH + 6) + '" stroke="#1B2224"/><text x="' + cx(l) + '" y="' + (CH + 20) + '" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="11" fill="#1B2224">' + l + '</text>';
    s += '<line x1="0" y1="' + CH + '" x2="' + CW + '" y2="' + CH + '" stroke="#1B2224" stroke-width="1.5"/><line x1="0" y1="0" x2="0" y2="' + CH + '" stroke="#1B2224"/>';
    if (state.view.lasers) m.inst.lasers.forEach(function (L) {
      var nm = +L.nm; if (nm < X0 || nm > X1) return;
      s += '<line x1="' + cx(nm).toFixed(1) + '" y1="4" x2="' + cx(nm).toFixed(1) + '" y2="' + CH + '" stroke="#1B2224" stroke-width="2.4"/><text x="' + (cx(nm) + 4).toFixed(1) + '" y="14" font-family="IBM Plex Mono, monospace" font-size="10" font-weight="600" fill="#1B2224">' + nm + '</text>';
    });
    // curves + staggered labels
    var labels = [];
    m.rows.forEach(function (o) {
      if (!o.f) return;
      var arr = exView ? o.sp.ex : o.sp.em, pk = 0, pki = 0;
      for (var l = X0; l <= X1; l++) if (arr[l - L0] > pk) { pk = arr[l - L0]; pki = l; }
      if (pk <= 0) return;
      s += '<path d="' + curvePath(arr) + '" fill="none" stroke="' + o.color + '" stroke-width="2"' + (exView ? ' stroke-dasharray="6 3"' : '') + (o.sp.approx ? '' : '') + '/>';
      labels.push({ x: cx(pki), text: (o.r.marker ? o.r.marker + ' · ' : '') + o.f.name.replace(/Alexa Fluor /, 'AF'), color: o.color });
    });
    labels.sort(function (a, b) { return a.x - b.x; });
    var tiers = [-1e9, -1e9, -1e9, -1e9];
    labels.forEach(function (lb) {
      var w = lb.text.length * 5.6 + 8, t = 0;
      while (t < tiers.length - 1 && tiers[t] > lb.x - w / 2) t++;
      tiers[t] = lb.x + w / 2;
      var y = -8 - t * 14;
      s += '<line x1="' + lb.x.toFixed(1) + '" y1="' + (y + 3) + '" x2="' + lb.x.toFixed(1) + '" y2="18" stroke="' + lb.color + '" stroke-width="1" stroke-dasharray="1 2"/>' +
        '<text x="' + lb.x.toFixed(1) + '" y="' + y + '" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-size="10.5" fill="#1B2224">' + esc(lb.text) + '</text>';
    });
    s += '<text x="' + CW + '" y="' + (CH + 36) + '" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="10" fill="#1B2224">WAVELENGTH, nm</text></svg>';
    $('chart').innerHTML = s;
    $('chartCap').textContent = 'FIG. 7.1a — ' + (m.spectral ? 'BLACK RULES = LASERS' : exView ? 'DASHED = EXCITATION · BLACK RULES = LASERS' : 'SHADED = DETECTORS IN USE · BLACK RULES = LASERS');
    var nReal = m.act.filter(function (o) { return !o.sp.approx; }).length;
    $('chartSrc').textContent = !m.act.length ? '' : nReal === m.act.length ? 'MEASURED SPECTRA' : nReal ? nReal + ' MEASURED · ' + (m.act.length - nReal) + ' MODELLED FROM PEAKS' : 'ALL MODELLED FROM PEAKS';
  }

  /* ---------- render: matrix / similarity ---------- */
  function cellClass(v, self, approx) {
    var c = self ? 'c-self' : v < 0.05 ? 'c-zero' : v < 2 ? 'c-low' : v < 10 ? 'c-mid' : 'c-high';
    return c + (approx && !self ? ' c-approx' : '');
  }
  function renderMatrix(m) {
    var area = $('matrixArea');
    $('s4title').textContent = m.spectral ? '04 — SIGNATURES & SIMILARITY' : '04 — SPILLOVER, ESTIMATED';
    $('s4note').textContent = m.spectral ? m.dets.length + ' CHANNELS · COSINE SIMILARITY' : '% OF PRIMARY SIGNAL · ROW SPILLS INTO COLUMN';
    if (m.act.length < 2) { area.innerHTML = '<p class="hint" style="padding:16px 0">Add at least two markers with a fluor to see ' + (m.spectral ? 'how alike their signatures are.' : 'how much they spill into each other.') + '</p>'; return; }
    if (!m.spectral) return renderSpill(m, area);
    renderSimilarity(m, area);
  }
  function renderSpill(m, area) {
    var A = m.act;
    var h = '<div class="matrix-wrap"><div class="matrix-main scroll"><table class="matrix"><thead><tr><th class="corner">FLUOR ↓ · DETECTOR →</th>';
    A.forEach(function (o) { h += '<th>' + esc(o.det.id) + '<span>' + esc((o.r.marker || '').slice(0, 10)) + '</span></th>'; });
    h += '</tr></thead><tbody>';
    var worst = null;
    A.forEach(function (a, i) {
      h += '<tr><th class="rowh"><span style="display:inline-block;width:10px;height:3px;background:' + a.color + ';vertical-align:middle;margin-right:6px"></span>' + esc(a.f.name) + '</th>';
      A.forEach(function (b, j) {
        var v = m.spill[i][j], self = i === j, ap = a.sp.approx;
        if (!self && a.det.key !== b.det.key && (!worst || v > worst.v)) worst = { v: v, a: a, b: b };
        h += '<td class="' + cellClass(v, self, ap) + '">' + (self ? '—' : fmtPct(v)) + '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table>' + (m.approxN ? '<p class="hint small" style="margin-top:8px"><i>Italic</i> = estimated from a modelled spectrum.</p>' : '') + '</div>';
    h += '<div class="matrix-side"><div class="side-title">KEY</div>' +
      '<div class="key-row"><span class="key-sw c-low" style="border:1px solid #C9D6CF"></span> under 2 % — fine</div>' +
      '<div class="key-row"><span class="key-sw c-mid"></span> 2–10 % — normal, compensate</div>' +
      '<div class="key-row"><span class="key-sw c-high"></span> over 10 % — check co-expression</div>';
    if (worst && worst.v >= 0.05) {
      h += '<div class="worst"><span class="side-title">WORST PAIR</span><div class="big">' + esc(worst.a.f.name) + ' → ' + esc(worst.b.det.id) + '</div>' +
        esc((worst.a.r.marker || worst.a.f.name) + ' lands ' + worst.v.toFixed(1) + ' % in the ' + (worst.b.r.marker || '') + ' (' + worst.b.f.name + ') channel. ') +
        (worst.v >= 10 ? 'Fine if they are on different cells; if they are co-expressed, move one of them to another laser or a dye further away.' : 'Within the normal range for compensation.') + '</div>';
    }
    h += '</div></div>';
    area.innerHTML = h;
  }
  function renderSimilarity(m, area) {
    var A = m.act, on = A.filter(function (o) { return state.sigOff.indexOf(o.r.id) < 0; }).slice(0, 4);
    var h = '<div style="padding-top:14px"><div class="sig-chips no-print"><span class="side-title">SIGNATURES</span>';
    A.forEach(function (o) { var p = on.indexOf(o) >= 0; h += '<button type="button" data-sig="' + esc(o.r.id) + '" aria-pressed="' + p + '"><span class="sw" style="background:' + o.color + '"></span>' + esc(o.f.name) + '</button>'; });
    h += '<span class="hint small">Up to four at a time. Bars are scaled to each dye’s own peak channel.</span></div>';
    // grouped bars
    var D = m.dets, W = 1240, step = W / D.length, bw = Math.max(1.5, Math.min(6, (step - 2) / Math.max(1, on.length)));
    var s = '<svg viewBox="-30 -26 ' + (W + 40) + ' 280" role="img" aria-label="Signatures of the selected dyes across ' + D.length + ' channels" style="display:block;width:100%;height:auto">';
    var start = 0;
    m.inst.lasers.forEach(function (L) {
      var n = D.filter(function (d) { return d.laser === +L.nm; }).length; if (!n) return;
      s += '<rect x="' + (start * step).toFixed(1) + '" y="-22" width="' + (n * step - 1).toFixed(1) + '" height="16" fill="#1B2224"/><text x="' + ((start + n / 2) * step).toFixed(1) + '" y="-10" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="10" fill="#F2EDDF">' + esc((L.name ? L.name.toUpperCase() : laserName(+L.nm)) + ' · ' + L.nm) + '</text>' +
        '<line x1="' + (start * step).toFixed(1) + '" y1="-6" x2="' + (start * step).toFixed(1) + '" y2="220" stroke="#1B2224"/>';
      start += n;
    });
    s += '<line x1="0" y1="220" x2="' + W + '" y2="220" stroke="#1B2224" stroke-width="1.5"/>';
    on.forEach(function (o, k) {
      o.sigNorm.forEach(function (v, i) { if (v > 0.005) s += '<rect x="' + (i * step + 1 + k * bw).toFixed(1) + '" y="' + (220 - v * 200).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (v * 200).toFixed(1) + '" fill="' + o.color + '"/>'; });
    });
    var peakIdx = {}; on.forEach(function (o) { peakIdx[D.indexOf(o.det)] = 1; });
    D.forEach(function (d, i) { s += '<text x="' + (i * step + step / 2).toFixed(1) + '" y="236" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="8" font-weight="' + (peakIdx[i] ? 700 : 400) + '" fill="#1B2224">' + esc(peakIdx[i] ? d.id : d.id.replace(/^[A-Z]+/, '')) + '</text>'; });
    s += '</svg>';
    h += '<figure class="chart-fig">' + s + '<figcaption class="caption"><span>FIG. 7.1b — CHANNEL EDGES FROM THE INSTRUMENT CONFIGURATION</span><span>' + (on.some(function (o) { return o.sp.approx; }) ? 'INCLUDES MODELLED SPECTRA' : 'MEASURED SPECTRA') + '</span></figcaption></figure>';
    // similarity table + complexity
    h += '<div class="matrix-wrap"><div class="matrix-main scroll"><table class="matrix"><thead><tr><th class="corner">SIMILARITY</th>';
    A.forEach(function (o) { h += '<th>' + esc(o.f.name.replace(/Alexa Fluor /, 'AF').slice(0, 12)) + '<span>' + esc((o.r.marker || '').slice(0, 10)) + '</span></th>'; });
    h += '</tr></thead><tbody>';
    var worst = null;
    A.forEach(function (a, i) {
      h += '<tr><th class="rowh"><span style="display:inline-block;width:10px;height:3px;background:' + a.color + ';vertical-align:middle;margin-right:6px"></span>' + esc(a.f.name) + '</th>';
      A.forEach(function (b, j) {
        var v = m.sim[i][j], self = i === j;
        if (!self && (!worst || v > worst.v)) worst = { v: v, a: a, b: b };
        var cls = self ? 'c-self' : v >= 0.9 ? 'c-high' : v >= 0.8 ? 'c-mid' : v >= 0.3 ? 'c-low' : 'c-zero';
        h += '<td class="' + cls + (a.sp.approx || b.sp.approx ? ' c-approx' : '') + '">' + (self ? '—' : v.toFixed(2)) + '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div><div class="matrix-side">';
    var ci = m.cplx;
    h += '<div class="cplx"><div><div class="side-title">COMPLEXITY INDEX</div><div class="num">' + (ci === Infinity ? '∞' : ci.toFixed(2)) + '</div></div><div>Condition number of the ' + A.length + '-dye reference matrix. Lower is easier to unmix; it climbs fast as dyes with similar signatures are added.</div></div>';
    h += '<div class="key-row"><span class="key-sw c-mid"></span> 0.80–0.90 — keep apart on co-expressed markers</div><div class="key-row"><span class="key-sw c-high"></span> over 0.90 — hard to separate</div>';
    if (worst) h += '<div class="worst"><span class="side-title">MOST ALIKE</span><div class="big">' + esc(worst.a.f.name) + ' · ' + esc(worst.b.f.name) + '</div>Similarity ' + worst.v.toFixed(2) + '. ' + (worst.v >= 0.9 ? 'Expect poor unmixing — swap one of them.' : worst.v >= 0.8 ? 'Workable if the two markers are not on the same cells.' : 'Distinct enough to unmix.') + '</div>';
    h += '</div></div></div>';
    area.innerHTML = h;
  }

  /* ---------- notices ---------- */
  function renderNotices(m) {
    var anyReal = SPEC.spectra && Object.keys(SPEC.spectra).length;
    var t = '';
    if (!anyReal) t = 'This copy has no measured spectra loaded yet, so every curve is modelled from the published excitation and emission peaks. Use the numbers to compare options, not as real values.';
    else if (m.approxN) t = m.approxN + ' of the dyes in this panel have no measured spectrum here, so their curves are modelled from published peaks. Numbers that involve them are marked ≈ or shown in italics.';
    $('approxNote').hidden = !t;
    $('approxText').textContent = t;
    $('knowSpectra').innerHTML = anyReal
      ? 'Measured spectra: <a href="https://www.fpbase.org" rel="noopener" target="_blank">FPbase</a> (CC BY-SA 4.0), fetched ' + esc(SPEC.fetched || '') + '. Dyes not on FPbase are modelled from their published peak wavelengths.'
      : 'Curves are modelled from each dye’s published excitation and emission peaks; measured spectra from <a href="https://www.fpbase.org" rel="noopener" target="_blank">FPbase</a> (CC BY-SA 4.0) replace them once loaded.';
  }

  function renderAll(opts) {
    opts = opts || {};
    var m = analyse();
    if (!opts.keepSelect) renderInstSelect();
    renderInst(m);
    if (!opts.skipRows) renderRows(m);
    renderChart(m);
    renderMatrix(m);
    renderNotices(m);
    $('viewEm').setAttribute('aria-pressed', String(state.view.curve !== 'ex'));
    $('viewEx').setAttribute('aria-pressed', String(state.view.curve === 'ex'));
    $('showLasers').checked = state.view.lasers; $('showBands').checked = state.view.bands;
  }

  /* ---------- panel events ---------- */
  $('rows').addEventListener('input', function (e) {
    var t = e.target, tr = t.closest('tr'); if (!tr || t.getAttribute('data-k') !== 'marker') return;
    state.rows[+tr.getAttribute('data-i')].marker = t.value; save();
    renderAll({ skipRows: true, keepSelect: true });
  });
  $('rows').addEventListener('change', function (e) {
    var t = e.target, tr = t.closest('tr'), k = t.getAttribute('data-k'); if (!tr || !k || k === 'marker') return;
    var i = +tr.getAttribute('data-i'), r = state.rows[i];
    if (k === 'expr') r.expr = t.value;
    if (k === 'bright') r.bright = t.value === '' ? null : +t.value;
    if (k === 'det') r.det = t.value || null;
    save(); renderAll({ keepSelect: true });
    var again = document.querySelector('#rows tr[data-i="' + i + '"] [data-k="' + k + '"]'); if (again) again.focus();
  });
  $('rows').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var i = +b.closest('tr').getAttribute('data-i');
    if (b.getAttribute('data-act') === 'rm') { state.rows.splice(i, 1); save(); renderAll({ keepSelect: true }); var nx = document.querySelector('#rows tr[data-i="' + Math.min(i, state.rows.length - 1) + '"] .rm'); if (nx) nx.focus(); }
    if (b.getAttribute('data-act') === 'pick') openPicker(i);
  });
  $('addRow').addEventListener('click', function () {
    state.rows.push(newRow()); save(); renderAll({ keepSelect: true });
    var inp = document.querySelector('#rows tr:last-child input[data-k="marker"]'); if (inp) inp.focus();
  });
  $('clearRows').addEventListener('click', function () {
    if (!state.rows.length) return;
    if (!window.confirm('Remove all ' + state.rows.length + ' markers from the panel?')) return;
    state.rows = []; save(); renderAll({ keepSelect: true });
  });

  /* ---------- instrument events ---------- */
  $('inst').addEventListener('change', function (e) {
    if (e.target.value === '__add') { e.target.value = state.instId; openEditor(null); return; }
    state.instId = e.target.value;
    state.rows.forEach(function (r) { r.det = null; });
    save(); renderAll();
  });
  $('editInst').addEventListener('click', function () { openEditor(inst()); });
  $('addInst').addEventListener('click', function () { openEditor(null); });
  $('delInst').addEventListener('click', function () {
    var I = inst(); if (I.origin !== 'user') return;
    if (!window.confirm('Delete “' + I.name + '” from your instruments?')) return;
    state.custom.instruments = state.custom.instruments.filter(function (x) { return x.id !== I.id; });
    state.instId = I.basedOn && instById[I.basedOn] ? I.basedOn : defaults.instId;
    rebuildRegistry(); save(); renderAll();
  });

  $('viewEm').addEventListener('click', function () { state.view.curve = 'em'; save(); renderAll({ keepSelect: true, skipRows: true }); });
  $('viewEx').addEventListener('click', function () { state.view.curve = 'ex'; save(); renderAll({ keepSelect: true, skipRows: true }); });
  $('showLasers').addEventListener('change', function (e) { state.view.lasers = e.target.checked; save(); renderAll({ keepSelect: true, skipRows: true }); });
  $('showBands').addEventListener('change', function (e) { state.view.bands = e.target.checked; save(); renderAll({ keepSelect: true, skipRows: true }); });
  $('matrixArea').addEventListener('click', function (e) {
    var b = e.target.closest('[data-sig]'); if (!b) return;
    var id = b.getAttribute('data-sig'), k = state.sigOff.indexOf(id);
    if (k >= 0) {
      var onNow = model.act.filter(function (o) { return state.sigOff.indexOf(o.r.id) < 0; });
      if (onNow.length >= 4) { toast('Four at a time — switch one off first.'); return; }
      state.sigOff.splice(k, 1);
    } else state.sigOff.push(id);
    save(); renderAll({ keepSelect: true, skipRows: true });
  });

  /* ---------- dialogs: shared ---------- */
  document.querySelectorAll('dialog').forEach(function (d) {
    d.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) d.close(); });
  });
  function openDlg(d) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); }

  /* ---------- instrument editor ---------- */
  var draft = null, draftBase = null;
  function blankDraft() { return { id: null, name: 'My instrument', type: 'conventional', basedOn: null, lasers: [{ nm: 488, detectors: [{ id: 'B1', filter: '530/30' }] }] }; }
  function draftFrom(i) {
    return { id: null, name: i.name + ' (my copy)', type: i.type, basedOn: i.id,
      lasers: i.lasers.map(function (L) { return { nm: +L.nm, mW: L.mW, name: L.name, detectors: L.detectors.map(function (d) { return { id: d.id, filter: d.filter || detLabel(d) }; }) }; }) };
  }
  function baseFilter(L, d) {
    if (!draftBase) return null;
    var bl = draftBase.lasers.filter(function (x) { return +x.nm === +L.nm; })[0]; if (!bl) return null;
    var bd = bl.detectors.filter(function (x) { return x.id === d.id; })[0];
    return bd ? (bd.filter || detLabel(bd)) : null;
  }
  function openEditor(i) {
    var isMine = i && i.origin === 'user';
    if (isMine) { draft = clone(i); draft.lasers.forEach(function (L) { L.detectors.forEach(function (d) { if (!d.filter) d.filter = detLabel(d); delete d.range; }); }); draftBase = draft.basedOn ? instById[draft.basedOn] : null; }
    else if (i) { draft = draftFrom(i); draftBase = i; }
    else { draft = draftFrom(inst().origin === 'user' && instById[inst().basedOn] ? instById[inst().basedOn] : inst()); draftBase = instById[draft.basedOn] || null; }
    $('instDlgTitle').textContent = isMine ? '01 — INSTRUMENT · EDIT YOUR OWN' : '01 — INSTRUMENT · YOUR OWN';
    var opts = DATA.instruments.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (p) { return '<option value="' + esc(p.id) + '"' + (draft.basedOn === p.id ? ' selected' : '') + '>' + esc(p.name + ' — ' + p.variant) + ' (copy, then edit)</option>'; }).join('');
    $('edStart').innerHTML = opts + '<option value="__blank">Blank instrument</option>';
    $('edStartWrap').hidden = isMine;
    $('edPaste').value = ''; $('edPasteMsg').textContent = 'Tabs, commas or semicolons all work. Replaces the lasers above.';
    renderEditor();
    openDlg($('instDlg'));
    $('edName').focus(); $('edName').select();
  }
  function filterMsg(L, d) {
    var r = parseFilter(d.filter);
    if (!r) return { cls: 'bad', text: d.filter.trim() ? 'Can’t read “' + d.filter + '” — write 530/30, 670LP or 655-730.' : 'Enter a filter.' };
    var b = baseFilter(L, d);
    if (b && norm(b) !== norm(d.filter)) return { cls: 'edited', text: 'Changed from preset (' + b + ').' };
    return { cls: '', text: '' };
  }
  function renderEditor() {
    $('edName').value = draft.name;
    $('edConv').setAttribute('aria-pressed', String(draft.type !== 'spectral'));
    $('edSpec').setAttribute('aria-pressed', String(draft.type === 'spectral'));
    var h = '';
    draft.lasers.forEach(function (L, li) {
      h += '<div class="ed-laser" data-li="' + li + '"><div class="ed-laser-head"><label class="sr" for="edl' + li + '">Laser wavelength</label><input id="edl' + li + '" data-f="nm" value="' + esc(L.nm) + '" inputmode="numeric"><span class="mono" style="font-size:12px">nm</span><span class="lname">' + esc(laserName(+L.nm)) + '</span><button type="button" class="rm" data-ed="rmLaser" aria-label="Remove laser ' + esc(L.nm) + '">×</button></div>';
      h += '<div class="ed-cols"><span>ID</span><span>FILTER</span><span></span></div>';
      L.detectors.forEach(function (d, di) {
        var msg = filterMsg(L, d);
        h += '<div data-di="' + di + '"><div class="ed-det"><input data-f="id" value="' + esc(d.id) + '" aria-label="Detector id" spellcheck="false"><input data-f="filter" class="' + msg.cls + '" value="' + esc(d.filter) + '" aria-label="Filter for ' + esc(d.id) + '" spellcheck="false"><button type="button" class="rm" data-ed="rmDet" aria-label="Remove detector ' + esc(d.id) + '">×</button></div>' +
          '<div class="ed-msg ' + msg.cls + '"' + (msg.text ? '' : ' hidden') + '>' + esc(msg.text) + '</div></div>';
      });
      h += '<button type="button" class="btn dashed" data-ed="addDet">+ DETECTOR</button></div>';
    });
    h += '<button type="button" class="btn dashed ed-add-laser" data-ed="addLaser">+ LASER</button>';
    $('edLasers').innerHTML = h;
    editorCount();
  }
  function editorErrors() {
    var bad = 0, n = 0;
    draft.lasers.forEach(function (L) { if (!(+L.nm >= 300 && +L.nm <= 900)) bad++; L.detectors.forEach(function (d) { n++; if (!parseFilter(d.filter) || !d.id.trim()) bad++; }); });
    return { bad: bad, n: n };
  }
  function editorCount() {
    var e = editorErrors();
    $('edCount').innerHTML = esc(e.n + (draft.type === 'spectral' ? ' channels · ' : ' detectors · ') + draft.lasers.length + ' lasers') + (e.bad ? ' · <span class="err" style="display:inline">' + e.bad + ' to fix</span>' : ' · <span class="tag mine">MINE</span> shows next to it in every list');
    $('edSave').disabled = !!e.bad || !e.n || !draft.name.trim();
  }
  $('edLasers').addEventListener('input', function (e) {
    var t = e.target, f = t.getAttribute('data-f'); if (!f) return;
    var li = +t.closest('[data-li]').getAttribute('data-li'), L = draft.lasers[li];
    if (f === 'nm') { L.nm = t.value.replace(/[^\d.]/g, ''); t.closest('.ed-laser').querySelector('.lname').textContent = laserName(+L.nm); }
    else {
      var di = +t.closest('[data-di]').getAttribute('data-di'), d = L.detectors[di];
      d[f] = t.value;
      if (f === 'filter') {
        var msg = filterMsg(L, d), box = t.closest('[data-di]').querySelector('.ed-msg');
        t.className = msg.cls; box.className = 'ed-msg ' + msg.cls; box.textContent = msg.text; box.hidden = !msg.text;
      }
    }
    editorCount();
  });
  $('edLasers').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ed]'); if (!b) return;
    var act = b.getAttribute('data-ed'), lw = b.closest('[data-li]'), li = lw ? +lw.getAttribute('data-li') : -1;
    if (act === 'addLaser') {
      var used = draft.lasers.map(function (L) { return +L.nm; }), next = [405, 488, 561, 640, 355].filter(function (x) { return used.indexOf(x) < 0; })[0] || 640;
      draft.lasers.push({ nm: next, detectors: [{ id: laserName(next).charAt(0) + '1', filter: '' }] });
      draft.lasers.sort(function (a, b) { return a.nm - b.nm; });
    }
    if (act === 'rmLaser') draft.lasers.splice(li, 1);
    if (act === 'addDet') { var L = draft.lasers[li], p = laserName(+L.nm).charAt(0); L.detectors.push({ id: p + (L.detectors.length + 1), filter: '' }); }
    if (act === 'rmDet') draft.lasers[li].detectors.splice(+b.closest('[data-di]').getAttribute('data-di'), 1);
    renderEditor();
    if (act === 'addDet') { var ins = $('edLasers').querySelectorAll('[data-li="' + li + '"] input[data-f="filter"]'); if (ins.length) ins[ins.length - 1].focus(); }
  });
  $('edName').addEventListener('input', function (e) { draft.name = e.target.value; editorCount(); });
  $('edConv').addEventListener('click', function () { draft.type = 'conventional'; renderEditor(); });
  $('edSpec').addEventListener('click', function () { draft.type = 'spectral'; renderEditor(); });
  $('edStart').addEventListener('change', function (e) {
    var name = draft.name;
    if (e.target.value === '__blank') { draft = blankDraft(); draftBase = null; }
    else { draft = draftFrom(instById[e.target.value]); draftBase = instById[e.target.value]; }
    if (!/\(my copy\)$/.test(name) && name !== 'My instrument') draft.name = name;
    renderEditor();
  });
  $('edApplyPaste').addEventListener('click', function () {
    var lines = $('edPaste').value.split(/\r?\n/), lasers = {}, n = 0, skipped = 0;
    lines.forEach(function (ln) {
      var c = ln.split(/\t|;|,/).map(function (x) { return x.trim(); }).filter(Boolean);
      if (c.length < 3) { if (ln.trim()) skipped++; return; }
      var nm = parseFloat(c[0]); if (!(nm >= 300 && nm <= 900) || !parseFilter(c[2])) { skipped++; return; }
      (lasers[nm] = lasers[nm] || []).push({ id: c[1], filter: c[2] }); n++;
    });
    if (!n) { $('edPasteMsg').textContent = 'Nothing usable found — each line needs laser, detector, filter.'; return; }
    draft.lasers = Object.keys(lasers).map(Number).sort(function (a, b) { return a - b; }).map(function (nm) { return { nm: nm, detectors: lasers[nm] }; });
    draftBase = null; draft.basedOn = null;
    $('edPasteMsg').textContent = 'Read ' + n + ' detectors' + (skipped ? ', skipped ' + skipped + ' line' + (skipped > 1 ? 's' : '') + '.' : '.');
    renderEditor();
  });
  $('edSave').addEventListener('click', function () {
    if (editorErrors().bad) return;
    var out = { id: draft.id || uid('u-inst-'), name: draft.name.trim(), variant: (draft.type === 'spectral' ? 'spectral · ' : '') + draft.lasers.length + ' lasers (mine)', type: draft.type, basedOn: draft.basedOn || null, vendor: 'mine',
      lasers: draft.lasers.map(function (L) { return { nm: +L.nm, name: L.name || laserName(+L.nm).charAt(0) + laserName(+L.nm).slice(1).toLowerCase(), mW: L.mW, detectors: L.detectors.map(function (d) { return { id: d.id.trim(), filter: d.filter.trim().toUpperCase().replace(/\s+/g, '') }; }) }; }) };
    var k = state.custom.instruments.map(function (x) { return x.id; }).indexOf(out.id);
    if (k >= 0) state.custom.instruments[k] = out; else state.custom.instruments.push(out);
    state.instId = out.id;
    state.rows.forEach(function (r) { r.det = null; });
    rebuildRegistry(); save(); $('instDlg').close(); renderAll();
    toast('Saved “' + out.name + '” to your instruments.');
  });

  /* ---------- fluor picker ---------- */
  var pickRow = -1, pickLaser = 'all', cfEdit = null, cfData = null;
  function lasersOf(I) { return I.lasers.map(function (L) { return +L.nm; }); }
  function mainLaserGroup(f) { var l = +f.laser; return l || 0; }
  function openPicker(i) {
    pickRow = i; pickLaser = 'all';
    var r = state.rows[i];
    $('fluorDlgTitle').textContent = 'FLUOR FOR ' + (r.marker ? r.marker.toUpperCase() : 'ROW ' + (i + 1)) + ' · ROW ' + String(i + 1).padStart(2, '0');
    $('pkSearch').value = '';
    $('pickView').hidden = false; $('cfView').hidden = true;
    renderPicker();
    openDlg($('fluorDlg'));
    $('pkSearch').focus();
  }
  function renderPicker() {
    var I = inst(), dets = flatDets(I), q = norm($('pkSearch').value), compat = $('pkCompat').checked;
    var ls = lasersOf(I);
    var tabs = ['all'].concat(ls.map(String)).concat(['mine']);
    $('pkTabs').innerHTML = tabs.map(function (t) { return '<button type="button" data-tab="' + t + '" aria-pressed="' + (pickLaser === t) + '">' + (t === 'all' ? 'ALL' : t === 'mine' ? 'MINE' : t) + '</button>'; }).join('');
    var inUse = {}; state.rows.forEach(function (r, k) { if (r.fluorId && k !== pickRow) inUse[r.fluorId] = 1; });
    var cur = state.rows[pickRow] && state.rows[pickRow].fluorId;
    var list = allFluors().filter(function (f) {
      if (q && norm(f.name).indexOf(q) < 0 && norm(f.family).indexOf(q) < 0 && String(f.emMax || '').indexOf(q) < 0 && norm(f.vendor).indexOf(q) < 0) return false;
      if (pickLaser === 'mine') return f.origin === 'user';
      if (pickLaser !== 'all') {
        var nearest = ls.reduce(function (b, l) { return Math.abs(l - f.laser) < Math.abs(b - f.laser) ? l : b; }, ls[0]);
        if (String(nearest) !== pickLaser) return false;
      }
      if (compat && f.origin !== 'user' && bestEff(f, I, dets) < COMPAT) return false;
      return true;
    });
    list.sort(function (a, b) { return (mainLaserGroup(a) - mainLaserGroup(b)) || ((a.emMax || 0) - (b.emMax || 0)) || a.name.localeCompare(b.name); });
    var h = '', group = null;
    var mine = list.filter(function (f) { return f.origin === 'user'; }), rest = list.filter(function (f) { return f.origin !== 'user'; });
    var item = function (f) {
      var badge = f.origin === 'user' ? '<span class="tag mine">MINE</span>' : inUse[f.id] ? '<span class="tag use">IN USE</span>' : !f.exMax ? '<span class="tag dim">EM ONLY</span>' : '';
      return '<div class="pk-item' + (f.id === cur ? ' cur' : '') + '"><button type="button" class="pk-pick" data-fid="' + esc(f.id) + '"><span class="pk-name">' + esc(f.name) + '</span><span class="pk-peaks">' + (f.exMax || '—') + ' / ' + (f.emMax || '—') + '</span><span class="pk-ven">' + esc(f.origin === 'user' ? 'you' : (f.vendor || f.family || '')) + '</span>' + badge + '</button>' +
        (f.origin === 'user' ? '<button type="button" class="pk-mini" data-edit="' + esc(f.id) + '">EDIT</button><button type="button" class="pk-mini" data-del="' + esc(f.id) + '" aria-label="Delete ' + esc(f.name) + '">DELETE</button>' : '') + '</div>';
    };
    if (mine.length) { h += '<div class="pk-group">MINE · ' + mine.length + '</div>'; mine.forEach(function (f) { h += item(f); }); }
    rest.forEach(function (f) {
      var g = mainLaserGroup(f);
      if (g !== group) { group = g; h += '<div class="pk-group">' + esc(laserName(g) + ' · ' + g + ' nm · ' + rest.filter(function (x) { return mainLaserGroup(x) === g; }).length) + '</div>'; }
      h += item(f);
    });
    if (!list.length) h = '<div class="pk-empty">Nothing matches' + (compat ? ' on this instrument — untick “Only dyes this instrument can…” to see all, or add your own.' : '. Add your own below.') + '</div>';
    $('pkScroll').innerHTML = h;
    $('pkNone').hidden = !cur;
  }
  $('pkSearch').addEventListener('input', renderPicker);
  $('pkCompat').addEventListener('change', renderPicker);
  $('pkTabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (!b) return; pickLaser = b.getAttribute('data-tab'); renderPicker(); });
  $('pkScroll').addEventListener('click', function (e) {
    var p = e.target.closest('[data-fid]'), ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (p) { assignFluor(p.getAttribute('data-fid')); return; }
    if (ed) { openCustomFluor(fluorById[ed.getAttribute('data-edit')]); return; }
    if (del) {
      var f = fluorById[del.getAttribute('data-del')];
      var usedBy = state.rows.filter(function (r) { return r.fluorId === f.id; }).length;
      if (!window.confirm('Delete “' + f.name + '”?' + (usedBy ? ' It is used on ' + usedBy + ' row' + (usedBy > 1 ? 's' : '') + '.' : ''))) return;
      state.custom.fluors = state.custom.fluors.filter(function (x) { return x.id !== f.id; });
      state.rows.forEach(function (r) { if (r.fluorId === f.id) { r.fluorId = null; r.det = null; } });
      delete specCache[f.id]; rebuildRegistry(); save(); renderPicker(); renderAll({ keepSelect: true });
    }
  });
  function assignFluor(fid) {
    var r = state.rows[pickRow]; if (!r) return;
    r.fluorId = fid; r.det = null; r.bright = null;
    save(); $('fluorDlg').close(); renderAll({ keepSelect: true });
    var b = document.querySelector('#rows tr[data-i="' + pickRow + '"] .fluor-btn'); if (b) b.focus();
  }
  $('pkNone').addEventListener('click', function () { var r = state.rows[pickRow]; if (!r) return; r.fluorId = null; r.det = null; save(); $('fluorDlg').close(); renderAll({ keepSelect: true }); });
  $('pkAdd').addEventListener('click', function () { openCustomFluor(null); });

  /* ---------- custom fluor ---------- */
  function openCustomFluor(f) {
    cfEdit = f || null;
    cfData = f && f.spectrum && f.spectrum.ex ? { ex: f.spectrum.ex, em: f.spectrum.em, source: f.spectrum.source } : null;
    $('cfName').value = f ? f.name : '';
    $('cfEx').value = f && f.exMax ? f.exMax : '';
    $('cfEm').value = f && f.emMax ? f.emMax : '';
    var ls = [355, 405, 488, 561, 640].concat(lasersOf(inst())).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
    $('cfLaser').value = f ? String(f.laser) : '561';
    $('cfAlso').innerHTML = ls.map(function (l) { return '<label class="check"><input type="checkbox" value="' + l + '"' + (f && (f.alsoExcitedBy || []).indexOf(l) >= 0 ? ' checked' : '') + '> ' + l + '</label>'; }).join('');
    var bsel = f && f.brightness ? f.brightness : 0;
    $('cfBright').innerHTML = [0, 1, 2, 3, 4, 5].map(function (n) { return '<button type="button" data-b="' + n + '" aria-pressed="' + (n === bsel) + '">' + (n || '—') + '</button>'; }).join('');
    var src = cfData ? cfData.source : 'peaks';
    document.querySelectorAll('input[name="cfSrc"]').forEach(function (x) { x.checked = x.value === src; });
    $('cfCsvMsg').textContent = cfData && src === 'csv' ? 'Using the curves saved with this dye.' : '';
    $('cfFpMsg').textContent = cfData && src === 'fpbase' ? 'Using the curves saved with this dye.' : '';
    $('cfErr').hidden = true;
    $('cfSave').textContent = f ? 'SAVE CHANGES' : (pickRow >= 0 ? 'SAVE & USE FOR ' + (state.rows[pickRow].marker || 'ROW ' + (pickRow + 1)).toUpperCase() : 'SAVE');
    $('pickView').hidden = true; $('cfView').hidden = false;
    cfSrcUI(); cfPreview();
    $('cfName').focus();
  }
  function cfSrc() { var c = document.querySelector('input[name="cfSrc"]:checked'); return c ? c.value : 'peaks'; }
  function cfSrcUI() { $('cfCsvBox').hidden = cfSrc() !== 'csv'; $('cfFpBox').hidden = cfSrc() !== 'fpbase'; }
  function cfDraft() {
    var ex = parseFloat($('cfEx').value), em = parseFloat($('cfEm').value);
    var also = Array.prototype.map.call(document.querySelectorAll('#cfAlso input:checked'), function (x) { return +x.value; });
    var b = document.querySelector('#cfBright [aria-pressed="true"]'); b = b ? +b.getAttribute('data-b') : 0;
    var f = { id: cfEdit ? cfEdit.id : 'tmp-preview', origin: 'user', name: $('cfName').value.trim(), laser: +$('cfLaser').value,
      exMax: ex >= 250 && ex <= 900 ? Math.round(ex) : null, emMax: em >= 300 && em <= 900 ? Math.round(em) : null,
      alsoExcitedBy: also.filter(function (l) { return l !== +$('cfLaser').value; }), family: 'mine', vendor: 'you', spectrum: { source: 'peaks-approx' } };
    if (b) f.brightness = b;
    var s = cfSrc();
    if ((s === 'csv' || s === 'fpbase') && cfData && cfData.ex && cfData.em) f.spectrum = { source: s, ex: cfData.ex, em: cfData.em };
    return f;
  }
  function cfPreview() {
    var f = cfDraft(); delete specCache[f.id];
    var ok = f.emMax || (f.spectrum.ex && f.spectrum.em);
    if (!ok) { $('cfPreview').innerHTML = '<p class="hint" style="padding:30px 8px">Enter at least the emission peak to see the curves.</p>'; $('cfStamp').hidden = true; return; }
    var sp = spectra(f); delete specCache[f.id];
    var W = 640, H = 170, X = function (l) { return (l - 350) / 500 * W; };
    var path = function (arr) { var p = []; for (var l = 350; l <= 850; l += 3) p.push(X(l).toFixed(1) + ',' + (H - arr[l - L0] * 150).toFixed(1)); return 'M' + p.join(' L'); };
    var s = '<svg viewBox="-20 -16 ' + (W + 40) + ' ' + (H + 40) + '" role="img" aria-label="Preview of the excitation and emission curves"><line x1="0" y1="' + H + '" x2="' + W + '" y2="' + H + '" stroke="#1B2224" stroke-width="1.5"/>';
    for (var l = 350; l <= 850; l += 50) s += '<text x="' + X(l) + '" y="' + (H + 16) + '" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="10" fill="#1B2224">' + l + '</text>';
    lasersOf(inst()).forEach(function (nm) { if (nm >= 350 && nm <= 850) s += '<line x1="' + X(nm) + '" y1="0" x2="' + X(nm) + '" y2="' + H + '" stroke="#1B2224" stroke-dasharray="2 3"/><text x="' + (X(nm) + 3) + '" y="8" font-family="IBM Plex Mono, monospace" font-size="9" fill="#1B2224">' + nm + '</text>'; });
    s += '<path d="' + path(sp.ex) + '" fill="none" stroke="#1B2224" stroke-width="1.6" stroke-dasharray="5 4"/><path d="' + path(sp.em) + '" fill="none" stroke="' + waveColor(f.emMax || 600) + '" stroke-width="2.2"/></svg>';
    $('cfPreview').innerHTML = s + '<div class="caption"><span>FIG. 7.1c — DASHED = EXCITATION · SOLID = EMISSION</span><span>' + (sp.approx ? 'SHAPE GUESSED FROM PEAKS' : 'FROM YOUR ' + (f.spectrum.source === 'csv' ? 'FILES' : 'FPBASE SPECTRA')) + '</span></div>';
    $('cfStamp').hidden = !sp.approx;
  }
  ['cfName', 'cfEx', 'cfEm'].forEach(function (id) { $(id).addEventListener('input', cfPreview); });
  $('cfLaser').addEventListener('change', cfPreview);
  $('cfAlso').addEventListener('change', cfPreview);
  $('cfBright').addEventListener('click', function (e) { var b = e.target.closest('[data-b]'); if (!b) return; $('cfBright').querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); });
  document.querySelectorAll('input[name="cfSrc"]').forEach(function (x) { x.addEventListener('change', function () { cfSrcUI(); cfPreview(); }); });
  $('cfBack').addEventListener('click', function () { $('cfView').hidden = true; $('pickView').hidden = false; renderPicker(); $('pkSearch').focus(); });

  function packCurve(pts) { // [[nm, v]...] -> [start, ints]
    pts = pts.filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); }).sort(function (a, b) { return a[0] - b[0]; });
    if (pts.length < 3) return null;
    var mx = Math.max.apply(null, pts.map(function (p) { return p[1]; })); if (!(mx > 0)) return null;
    var lo = Math.max(L0, Math.ceil(pts[0][0])), hi = Math.min(L1, Math.floor(pts[pts.length - 1][0])), out = [], j = 0;
    for (var nm = lo; nm <= hi; nm++) {
      while (j < pts.length - 2 && pts[j + 1][0] < nm) j++;
      var a = pts[j], b = pts[j + 1], v = b[0] === a[0] ? a[1] : a[1] + (b[1] - a[1]) * (nm - a[0]) / (b[0] - a[0]);
      out.push(Math.max(0, Math.min(1000, Math.round(v / mx * 1000))));
    }
    return [lo, out];
  }
  function parseCsv(text) {
    var pts = [];
    text.split(/\r?\n/).forEach(function (ln) {
      var c = ln.split(/[\t,; ]+/).map(function (x) { return parseFloat(x); }).filter(function (x) { return !isNaN(x); });
      if (c.length >= 2 && c[0] >= 200 && c[0] <= 1100) pts.push([c[0], c[1]]);
    });
    return packCurve(pts);
  }
  function readFile(input, key) {
    var file = input.files && input.files[0]; if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      var c = parseCsv(String(rd.result));
      cfData = cfData && cfData.source === 'csv' ? cfData : { source: 'csv' };
      if (!c) { $('cfCsvMsg').textContent = 'Couldn’t read ' + file.name + ' — need two columns: wavelength (nm), intensity.'; return; }
      cfData[key] = c;
      $('cfCsvMsg').textContent = (cfData.ex ? 'Excitation ✓ ' : 'Excitation — ') + ' · ' + (cfData.em ? 'Emission ✓' : 'Emission —');
      if (!$('cfEm').value && cfData.em) { var e = cfData.em[1], k = e.indexOf(Math.max.apply(null, e)); $('cfEm').value = cfData.em[0] + k; }
      if (!$('cfEx').value && cfData.ex) { var x = cfData.ex[1], kx = x.indexOf(Math.max.apply(null, x)); $('cfEx').value = cfData.ex[0] + kx; }
      cfPreview();
    };
    rd.readAsText(file);
  }
  $('cfCsvEx').addEventListener('change', function (e) { readFile(e.target, 'ex'); });
  $('cfCsvEm').addEventListener('change', function (e) { readFile(e.target, 'em'); });
  $('cfFpGo').addEventListener('click', function () {
    var v = $('cfFp').value, m = v.match(/[?&]s=([\d,]+)/), ids = (m ? m[1] : v).split(/[^\d]+/).filter(Boolean).slice(0, 6);
    if (!ids.length) { $('cfFpMsg').textContent = 'Paste a link like fpbase.org/spectra/?s=17,18 or the IDs.'; return; }
    $('cfFpMsg').textContent = 'Asking FPbase…';
    var q = '{' + ids.map(function (id) { return 's' + id + ': spectrum(id:' + id + '){subtype owner{name} data}'; }).join(' ') + '}';
    fetch('https://www.fpbase.org/graphql/?query=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (res) {
      var d = res && res.data || {}, got = { source: 'fpbase' }, owner = '';
      Object.keys(d).forEach(function (k) {
        var s = d[k]; if (!s || !s.data) return;
        if (s.subtype === 'EM' && !got.em) { got.em = packCurve(s.data); owner = s.owner && s.owner.name; }
        if ((s.subtype === 'EX' || s.subtype === 'AB') && !got.ex) { got.ex = packCurve(s.data); owner = owner || (s.owner && s.owner.name); }
      });
      if (!got.ex || !got.em) { $('cfFpMsg').textContent = 'Need one excitation (or absorption) and one emission spectrum — got ' + (got.ex ? 'excitation' : got.em ? 'emission' : 'neither') + '.'; return; }
      cfData = got;
      if (!$('cfName').value && owner) $('cfName').value = owner;
      $('cfFpMsg').textContent = 'Loaded ' + (owner || 'spectra') + ' from FPbase (CC BY-SA 4.0).';
      if (!$('cfEm').value) { var e = got.em[1]; $('cfEm').value = got.em[0] + e.indexOf(Math.max.apply(null, e)); }
      if (!$('cfEx').value) { var x = got.ex[1]; $('cfEx').value = got.ex[0] + x.indexOf(Math.max.apply(null, x)); }
      cfPreview();
    }).catch(function () { $('cfFpMsg').textContent = 'FPbase didn’t answer from this browser. Download the CSV from its spectra viewer and use Upload CSV instead.'; });
  });
  $('cfSave').addEventListener('click', function () {
    var f = cfDraft(), err = '';
    if (!f.name) err = 'Give the dye a name.';
    else if (!f.emMax && !(f.spectrum.ex && f.spectrum.em)) err = 'Enter the emission peak, or load spectra.';
    else if (f.exMax && f.emMax && f.emMax < f.exMax) err = 'Emission peak should be longer than the excitation peak.';
    else if ((cfSrc() === 'csv' || cfSrc() === 'fpbase') && f.spectrum.source === 'peaks-approx') err = 'Load both spectra first, or choose “Peaks only”.';
    else if (allFluors().some(function (x) { return x.id !== f.id && norm(x.name) === norm(f.name); })) err = 'A dye with this name is already in the list.';
    $('cfErr').textContent = err; $('cfErr').hidden = !err; if (err) return;
    if (!cfEdit) f.id = 'u-' + slug(f.name).slice(0, 24) + '-' + Date.now().toString(36);
    var k = state.custom.fluors.map(function (x) { return x.id; }).indexOf(f.id);
    if (k >= 0) state.custom.fluors[k] = f; else state.custom.fluors.push(f);
    delete specCache[f.id]; rebuildRegistry();
    if (!cfEdit && pickRow >= 0) { assignFluor(f.id); toast('Added “' + f.name + '” to your dyes.'); return; }
    save(); renderAll({ keepSelect: true });
    $('cfView').hidden = true; $('pickView').hidden = false; renderPicker();
  });

  /* ---------- paste markers ---------- */
  $('pasteRows').addEventListener('click', function () { $('pasteText').value = ''; $('pasteReplace').checked = false; openDlg($('pasteDlg')); $('pasteText').focus(); });
  $('pasteGo').addEventListener('click', function () {
    var byName = {}; allFluors().forEach(function (f) { byName[norm(f.name)] = f.id; });
    var add = [], miss = 0;
    $('pasteText').value.split(/\r?\n/).forEach(function (ln) {
      if (!ln.trim()) return;
      var c = ln.split(/\t|,|;/).map(function (x) { return x.trim(); });
      var fid = c[1] ? (byName[norm(c[1])] || byName[norm(c[1].replace(/^BV\s*/i, 'BV'))] || null) : null;
      if (c[1] && !fid) miss++;
      add.push(newRow(c[0], '', fid));
    });
    if (!add.length) { $('pasteMsg').textContent = 'Nothing to add.'; return; }
    state.rows = $('pasteReplace').checked ? add : state.rows.concat(add);
    save(); $('pasteDlg').close(); renderAll({ keepSelect: true });
    toast('Added ' + add.length + ' marker' + (add.length > 1 ? 's' : '') + (miss ? ' · ' + miss + ' fluor name' + (miss > 1 ? 's' : '') + ' not found' : '') + '.');
  });

  /* ---------- share, CSV, export ---------- */
  function b64e(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64d(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }
  $('shareBtn').addEventListener('click', function () {
    var I = inst();
    var usedF = state.custom.fluors.filter(function (f) { return state.rows.some(function (r) { return r.fluorId === f.id; }); });
    var payload = { v: 1, i: I.id, inst: I.origin === 'user' ? I : null, rows: state.rows.map(function (r) { return [r.marker, r.expr, r.fluorId, r.det, r.bright]; }), fl: usedF };
    var url = location.href.split('#')[0] + '#p=' + b64e(JSON.stringify(payload));
    var done = function () { toast('Link copied' + (url.length > 2000 ? ' — it is long because it carries your own instrument or dyes.' : '.')); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copy this link:', url); });
    else window.prompt('Copy this link:', url);
  });
  function loadShared() {
    var m = location.hash.match(/^#p=([\w-]+)/); if (!m) return;
    try {
      var p = JSON.parse(b64d(m[1])); if (!p || p.v !== 1) return;
      state.backup = { instId: state.instId, rows: state.rows };
      (p.fl || []).forEach(function (f) { if (!state.custom.fluors.some(function (x) { return x.id === f.id; })) state.custom.fluors.push(f); });
      if (p.inst && !state.custom.instruments.some(function (x) { return x.id === p.inst.id; })) state.custom.instruments.push(p.inst);
      rebuildRegistry();
      state.instId = instById[p.i] ? p.i : state.instId;
      state.rows = (p.rows || []).map(function (r) { var o = newRow(r[0], r[1], fluorById[r[2]] ? r[2] : null); o.det = r[3] || null; o.bright = r[4] == null ? null : r[4]; return o; });
      $('shareNote').hidden = false;
      history.replaceState(null, '', location.pathname + location.search);
      save();
    } catch (e) { toast('That share link could not be read.'); }
  }
  $('restoreMine').addEventListener('click', function () {
    if (state.backup) { state.instId = instById[state.backup.instId] ? state.backup.instId : state.instId; state.rows = state.backup.rows; }
    state.backup = null; $('shareNote').hidden = true; save(); renderAll();
  });
  $('keepShared').addEventListener('click', function () { state.backup = null; $('shareNote').hidden = true; save(); });

  function download(name, text, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function csvCell(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  $('csvBtn').addEventListener('click', function () {
    var m = model, I = m.inst;
    var head = ['#', 'marker', 'expression', 'fluor', 'ex peak nm', 'em peak nm', m.spectral ? 'peak channel' : 'detector', 'laser nm', 'filter', m.spectral ? 'most similar' : 'receives max %', 'check', 'spectrum'];
    var lines = [head.join(',')];
    m.rows.forEach(function (o, i) {
      var chk = o.checks.filter(function (c) { return c[0] === 'check'; }).map(function (c) { return c[1]; }).join(' | ') || (o.f ? 'PASS' : '');
      lines.push([i + 1, o.r.marker, o.r.expr, o.f ? o.f.name : '', o.f ? o.f.exMax || '' : '', o.f ? o.f.emMax || '' : '', o.det ? o.det.id : '', o.det ? o.det.laser : '', o.det ? o.det.label : '',
        o.recvFrom ? (m.spectral ? o.recv.toFixed(2) + ' ' + o.recvFrom.f.name : o.recv.toFixed(1)) : '', chk, o.sp ? (o.sp.approx ? 'modelled from peaks' : o.sp.src) : ''].map(csvCell).join(','));
    });
    lines.push(''); lines.push(csvCell('Instrument: ' + I.name + ' — ' + (I.variant || '')));
    lines.push(csvCell('Estimates from spectra and filters (labmate.tools Panel Designer). Compensation must come from single-stain controls.'));
    download('panel-' + slug(I.name) + '.csv', '﻿' + lines.join('\r\n'), 'text/csv');
  });
  $('printBtn').addEventListener('click', function () { window.print(); });
  $('exportMine').addEventListener('click', function () {
    if (!state.custom.instruments.length && !state.custom.fluors.length) { toast('Nothing to export yet — add an instrument or a dye first.'); return; }
    download('labmate-panel-designer-mine.json', JSON.stringify({ kind: 'labmate.panelDesigner.custom', v: 1, exported: new Date().toISOString().slice(0, 10), instruments: state.custom.instruments, fluors: state.custom.fluors }, null, 1), 'application/json');
  });
  $('importMine').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0]; if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var d = JSON.parse(String(rd.result));
        if (!d || d.kind !== 'labmate.panelDesigner.custom') throw new Error('kind');
        var ni = 0, nf = 0;
        (d.instruments || []).forEach(function (i) { if (i && i.id && i.lasers && !state.custom.instruments.some(function (x) { return x.id === i.id; })) { state.custom.instruments.push(i); ni++; } });
        (d.fluors || []).forEach(function (f) { if (f && f.id && f.name && !state.custom.fluors.some(function (x) { return x.id === f.id; })) { state.custom.fluors.push(f); nf++; } });
        rebuildRegistry(); save(); renderAll();
        toast('Imported ' + ni + ' instrument' + (ni === 1 ? '' : 's') + ' and ' + nf + ' dye' + (nf === 1 ? '' : 's') + '.');
      } catch (err) { toast('That file is not a Panel Designer export.'); }
      e.target.value = '';
    };
    rd.readAsText(file);
  });

  /* ---------- start ---------- */
  rebuildRegistry();
  loadShared();
  if (!instById[state.instId]) state.instId = defaults.instId;
  $('factCounts').textContent = DATA.instruments.length + ' PRESETS · ' + DATA.fluors.length + ' FLUORS';
  save();
  renderAll();
})();
