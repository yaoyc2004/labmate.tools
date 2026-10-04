/* labmate.tools · Cryo Labels
   Turns a list of sample IDs into a PDF for laser cryo label sheets.
   Everything runs in the browser; settings are kept in localStorage. */
(function () {
  'use strict';

  var STORE_KEY = 'labmate.cryoLabels.v1';
  var PT = 25.4 / 72;          // 1 pt in mm
  var MIN_PT = 6;              // smallest size we call readable
  var LH = 1.18;               // line height factor
  var PAGES = { letter: { w: 215.9, h: 279.4, name: 'LETTER' }, a4: { w: 210, h: 297, name: 'A4' } };

  /* Label sizes and grids come from the makers' product pages.
     Margins and spacing are NOT published there, so they are estimated
     (centred grid) and should be checked with the calibration page. */
  var SHEETS = [
    { id: 'l-85',   page: 'letter', w: 32.5, h: 12.7,  cols: 5, rows: 17, r: 1.5, inch: '1.28 × 0.50 in', use: '1.5–2 ml tubes', ref: 'Diversified Biotech LCRY-1700 (Cryo-Babies)' },
    { id: 'l-126',  page: 'letter', w: 32.5, h: 12.7,  cols: 6, rows: 21, r: 1.5, inch: '1.28 × 0.50 in', use: 'microtubes, vials', ref: 'LabTAG CL-23' },
    { id: 'l-119',  page: 'letter', w: 23.9, h: 12.7,  cols: 7, rows: 17, r: 1.5, inch: '0.94 × 0.50 in', use: '0.5 ml tubes', ref: 'Diversified Biotech LCRY-2380' },
    { id: 'l-60',   page: 'letter', w: 38.1, h: 19.05, cols: 5, rows: 12, r: 1.5, inch: '1.50 × 0.75 in', use: 'general purpose', ref: 'Diversified Biotech LCRY-1200' },
    { id: 'l-52',   page: 'letter', w: 42.9, h: 19.05, cols: 4, rows: 13, r: 1.5, inch: '1.69 × 0.75 in', use: 'cryovials', ref: 'Diversified Biotech LCRY-1100' },
    { id: 'l-50',   page: 'letter', w: 38.1, h: 25.4,  cols: 5, rows: 10, r: 1.5, inch: '1.50 × 1.00 in', use: '', ref: 'LabTAG CL-70' },
    { id: 'l-30',   page: 'letter', w: 66.7, h: 25.4,  cols: 3, rows: 10, r: 1.5, inch: '2.625 × 1.00 in', use: 'boxes, racks', ref: 'Diversified Biotech LCRY-1258' },
    { id: 'a4-126', page: 'a4',     w: 31.5, h: 13.0,  cols: 6, rows: 21, r: 1.5, inch: '1.24 × 0.51 in', use: '', ref: 'LabTAG A4RCL-23', inferred: true },
    { id: 'a4-100', page: 'a4',     w: 36.0, h: 14.0,  cols: 5, rows: 20, r: 1.5, inch: '1.42 × 0.55 in', use: '', ref: 'LabTAG A4RCL-6', inferred: true }
  ];
  var SHEET_BY_ID = {};
  SHEETS.forEach(function (s) { SHEET_BY_ID[s.id] = s; });

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function r2(v) { return Math.round(v * 100) / 100; }
  function fmt1(v) { return (v > 0 ? '+' : '') + (Math.round(v * 10) / 10).toFixed(1); }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  /* centred-grid estimate for a preset */
  function estimateGeom(s) {
    var pg = PAGES[s.page];
    var gx = s.cols > 1 ? clamp((pg.w - 12 - s.cols * s.w) / (s.cols - 1), 0, 3.2) : 0;
    var gy = s.rows > 1 ? clamp((pg.h - 12 - s.rows * s.h) / (s.rows - 1), 0, 3.2) : 0;
    return {
      page: s.page, cols: s.cols, rows: s.rows, w: s.w, h: s.h, r: s.r,
      left: r2((pg.w - s.cols * s.w - (s.cols - 1) * gx) / 2),
      top: r2((pg.h - s.rows * s.h - (s.rows - 1) * gy) / 2),
      px: r2(s.w + gx), py: r2(s.h + gy)
    };
  }

  /* ---------- state ---------- */
  var defaults = {
    v: 1, mode: 'range', prefix: 'S', from: '001', to: '048', list: '',
    copies: 2, placement: 'side', line2: todayISO(), line3: '',
    sheetId: 'l-85', template: 'lines', textSize: 'auto', wrap: false, outlines: false,
    custom: null, offsets: {}
  };
  var state = Object.assign({}, defaults);
  var canStore = true;
  try {
    var raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      var saved = JSON.parse(raw);
      if (saved && saved.v === 1) state = Object.assign({}, defaults, saved);
    }
  } catch (e) { canStore = false; }
  if (!state.custom) state.custom = estimateGeom(SHEETS[0]);
  if (!state.offsets || typeof state.offsets !== 'object') state.offsets = {};
  if (state.sheetId !== 'custom' && !SHEET_BY_ID[state.sheetId]) state.sheetId = 'l-85';

  function save() {
    if (!canStore) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { canStore = false; }
  }

  function currentGeom() {
    return state.sheetId === 'custom' ? state.custom : estimateGeom(SHEET_BY_ID[state.sheetId]);
  }
  function currentOffset() {
    var o = state.offsets[state.sheetId];
    return { x: o && isFinite(o.x) ? o.x : 0, y: o && isFinite(o.y) ? o.y : 0 };
  }

  /* ---------- text measuring (jsPDF metrics, so preview = PDF) ---------- */
  var meter = null;
  var canvasCtx = null;
  function measure(str, pt, bold) {
    if (!meter && window.jspdf && window.jspdf.jsPDF) meter = new window.jspdf.jsPDF({ unit: 'mm' });
    if (meter) {
      meter.setFont('helvetica', bold ? 'bold' : 'normal');
      return meter.getStringUnitWidth(str) * pt * PT;
    }
    if (!canvasCtx) canvasCtx = document.createElement('canvas').getContext('2d');
    canvasCtx.font = (bold ? 'bold ' : '') + '100px Helvetica, Arial, sans-serif';
    return canvasCtx.measureText(str).width / 100 * pt * PT;
  }

  /* ---------- IDs ---------- */
  function buildIds() {
    var ids = [];
    if (state.mode === 'range') {
      var from = String(state.from).trim(), to = String(state.to).trim();
      if (!/^\d+$/.test(from) || !/^\d+$/.test(to)) return { ids: [], error: 'FROM and TO must be whole numbers.' };
      var a = parseInt(from, 10), b = parseInt(to, 10);
      if (b < a) return { ids: [], error: 'TO is smaller than FROM.' };
      if (b - a + 1 > 5000) return { ids: [], error: 'That is more than 5,000 IDs. Split it into smaller batches.' };
      var pad = /^0\d/.test(from) ? from.length : 0;
      for (var i = a; i <= b; i++) ids.push(String(state.prefix || '') + (pad ? String(i).padStart(pad, '0') : String(i)));
    } else {
      ids = String(state.list || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (ids.length > 5000) return { ids: [], error: 'The list has more than 5,000 IDs. Split it into smaller batches.' };
    }
    return { ids: ids, error: null };
  }

  function buildLabels(ids) {
    var n = clamp(parseInt(state.copies, 10) || 1, 1, 20);
    var out = [];
    if (state.placement === 'sets') {
      for (var c = 0; c < n; c++) ids.forEach(function (id) { out.push(id); });
    } else {
      ids.forEach(function (id) { for (var c2 = 0; c2 < n; c2++) out.push(id); });
    }
    return out;
  }

  /* ---------- label layout (shared by preview and PDF) ---------- */
  function splitId(id) {
    var mid = id.length / 2, best = -1, bestD = Infinity;
    for (var i = 1; i < id.length - 1; i++) {
      if ('-_./ '.indexOf(id[i]) >= 0) {
        var d = Math.abs(i + 1 - mid);
        if (d < bestD) { bestD = d; best = i + 1; }
      }
    }
    if (best < 0) best = Math.ceil(mid);
    return [id.slice(0, best).trim(), id.slice(best).trim()];
  }

  // lines: [{text, bold, weight, kind}] → sized, positioned text ops
  function fitLines(lines, x0, top, availW, availH, maxBase, center) {
    var sumW = lines.reduce(function (s, l) { return s + l.weight; }, 0);
    var base = Math.min(availH / (sumW * PT * LH), maxBase);
    var small = {};
    var sized = lines.map(function (l) {
      var pt = base * l.weight;
      var tw = measure(l.text, pt, l.bold);
      if (tw > availW && tw > 0) { pt = pt * availW / tw; tw = availW; }
      if (pt < MIN_PT - 1e-6) small[l.kind] = true;
      return { text: l.text, bold: l.bold, pt: pt, tw: tw, kind: l.kind };
    });
    var blockH = sized.reduce(function (s, l) { return s + l.pt * PT * LH; }, 0);
    var y = top + Math.max(0, (availH - blockH) / 2);
    var ops = sized.map(function (l) {
      var lh = l.pt * PT * LH;
      var op = { t: 'text', text: l.text, bold: l.bold, pt: l.pt, x: center ? x0 + (availW - l.tw) / 2 : x0, y: y + lh * 0.5 + l.pt * PT * 0.36 };
      y += lh;
      return op;
    });
    var minId = Math.min.apply(null, sized.filter(function (l) { return l.kind === 'id'; }).map(function (l) { return l.pt; }).concat([99]));
    return { ops: ops, small: small, minId: minId };
  }

  function textLines(id, idWeight, split) {
    var lines = [];
    if (split) {
      var p = splitId(id);
      lines.push({ text: p[0], bold: true, weight: idWeight * 0.85, kind: 'id' });
      lines.push({ text: p[1], bold: true, weight: idWeight * 0.85, kind: 'id' });
    } else {
      lines.push({ text: id, bold: true, weight: idWeight, kind: 'id' });
    }
    if (String(state.line2).trim()) lines.push({ text: String(state.line2).trim(), bold: false, weight: 1, kind: 'line2' });
    if (String(state.line3).trim()) lines.push({ text: String(state.line3).trim(), bold: false, weight: 1, kind: 'line3' });
    return lines;
  }

  function layoutLabel(id, g) {
    var pad = clamp(Math.min(g.w, g.h) * 0.08, 0.6, 1.5);
    var inset = pad + Math.min(g.r, 3) * 0.3;
    var fixed = state.textSize === 'auto' ? null : parseFloat(state.textSize);
    var ops = [], res;

    if (state.template === 'id') {
      var maxB = fixed ? fixed * 1.6 : 28;
      var one = [{ text: id, bold: true, weight: 1, kind: 'id' }];
      res = fitLines(one, inset, pad, g.w - 2 * inset, g.h - 2 * pad, maxB, true);
      if (res.small.id && state.wrap) {
        var two = splitId(id).map(function (t) { return { text: t, bold: true, weight: 1, kind: 'id' }; });
        var res2 = fitLines(two, inset, pad, g.w - 2 * inset, g.h - 2 * pad, maxB, true);
        if (res2.minId > res.minId) res = res2;
      }
      return { ops: res.ops, small: res.small };
    }

    var x0 = inset, availW = g.w - 2 * inset;
    if (state.template === 'qr') {
      var qs = Math.min(g.h - 2 * pad, (g.w - 2 * pad) * 0.45);
      var qrOps = qrModules(id, pad, (g.h - qs) / 2, qs);
      ops = ops.concat(qrOps);
      x0 = pad + qs + Math.max(0.8, pad);
      availW = g.w - x0 - inset;
    }
    var idW = state.template === 'qr' ? 1.25 : 1.35;
    var maxBase = fixed || 11;
    res = fitLines(textLines(id, idW, false), x0, pad, availW, g.h - 2 * pad, maxBase, false);
    if (res.small.id && state.wrap) {
      var resW = fitLines(textLines(id, idW, true), x0, pad, availW, g.h - 2 * pad, maxBase, false);
      if (resW.minId > res.minId) res = resW;
    }
    return { ops: ops.concat(res.ops), small: res.small };
  }

  function qrModules(text, x, y, size) {
    if (typeof window.qrcode !== 'function') return [{ t: 'qrmissing', x: x, y: y, s: size }];
    var q = window.qrcode(0, 'M');
    q.addData(text);
    q.make();
    var n = q.getModuleCount(), m = size / n, cells = [];
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) cells.push([x + c * m, y + r * m]);
    return [{ t: 'qr', cells: cells, m: m }];
  }

  var UNSUPPORTED = /[^\x20-\x7E -ÿ–—‘’“”•…€]/g;

  /* ---------- compute everything ---------- */
  function compute() {
    var g = currentGeom();
    var built = buildIds();
    var labels = buildLabels(built.ids);
    var cap = Math.max(1, g.cols * g.rows);
    var pages = labels.length ? Math.ceil(labels.length / cap) : 1;
    var layouts = new Map();
    var tooLongIds = [], line2Small = false, line3Small = false;
    built.ids.forEach(function (id) {
      if (layouts.has(id)) return;
      var L = layoutLabel(id, g);
      layouts.set(id, L);
      if (L.small.id) tooLongIds.push(id);
      if (L.small.line2) line2Small = true;
      if (L.small.line3) line3Small = true;
    });
    var badChars = {};
    built.ids.concat([state.line2, state.line3]).forEach(function (s) {
      (String(s).match(UNSUPPORTED) || []).forEach(function (ch) { badChars[ch] = true; });
    });
    var pg = PAGES[g.page] || PAGES.letter;
    var geomProblems = [];
    if (g.px < g.w - 0.01) geomProblems.push('Pitch → is smaller than the label width, so labels overlap.');
    if (g.py < g.h - 0.01) geomProblems.push('Pitch ↓ is smaller than the label height, so labels overlap.');
    if (g.left + (g.cols - 1) * g.px + g.w > pg.w + 0.01) geomProblems.push('The last column runs off the right edge of the page.');
    if (g.top + (g.rows - 1) * g.py + g.h > pg.h + 0.01) geomProblems.push('The last row runs off the bottom of the page.');
    return {
      g: g, pg: pg, ids: built.ids, error: built.error, labels: labels, cap: cap, pages: pages,
      empty: labels.length ? pages * cap - labels.length : 0,
      layouts: layouts, tooLongIds: tooLongIds, line2Small: line2Small, line3Small: line3Small,
      badChars: Object.keys(badChars), geomProblems: geomProblems
    };
  }

  /* ---------- DOM ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var els = {};
  ['modeRange', 'modeList', 'rangeFields', 'listFields', 'prefix', 'from', 'to', 'list', 'csvFile', 'copies', 'placement',
   'line2', 'line3', 'sheet', 'sheetInfo', 'geomBox', 'geomTag', 'geomWarn', 'g_page', 'g_cols', 'g_rows', 'g_w', 'g_h', 'g_r',
   'g_top', 'g_left', 'g_px', 'g_py', 'template', 'textSize', 'wrap', 'offX', 'offY', 'offsetFor', 'countBar',
   'previewTitle', 'previewCount', 'sheetFrame', 'pager', 'prevPage', 'nextPage', 'pageLabel', 'status',
   'stLabels', 'stSheets', 'stEmpty', 'stOffset', 'outlines', 'downloadPdf', 'calPdf', 'libError', 'savedFlag'
  ].forEach(function (id) { els[id] = $(id); });

  var GEOM_FIELDS = ['cols', 'rows', 'w', 'h', 'r', 'top', 'left', 'px', 'py'];
  var currentPage = 0;
  var last = null;

  function buildSheetSelect() {
    var html = '';
    var groups = [['letter', 'US LETTER · 8.5 × 11 IN'], ['a4', 'A4 · 210 × 297 MM']];
    groups.forEach(function (gr) {
      html += '<optgroup label="' + gr[1] + '">';
      SHEETS.filter(function (s) { return s.page === gr[0]; }).forEach(function (s) {
        var cap = s.cols * s.rows;
        var size = s.page === 'a4' ? s.w.toFixed(1) + ' × ' + s.h.toFixed(1) + ' mm' : s.inch;
        html += '<option value="' + s.id + '">' + esc(size + ' · ' + s.cols + ' × ' + s.rows + ' = ' + cap + (s.use ? ' · ' + s.use : '')) + '</option>';
      });
      html += '</optgroup>';
    });
    html += '<optgroup label="OTHER"><option value="custom">Custom — my own measurements</option></optgroup>';
    els.sheet.innerHTML = html;
  }

  function fillInputs() {
    els.prefix.value = state.prefix;
    els.from.value = state.from;
    els.to.value = state.to;
    els.list.value = state.list;
    els.copies.value = state.copies;
    els.placement.value = state.placement;
    els.line2.value = state.line2;
    els.line3.value = state.line3;
    els.sheet.value = state.sheetId;
    els.template.value = state.template;
    els.textSize.value = state.textSize;
    els.wrap.checked = !!state.wrap;
    els.outlines.checked = !!state.outlines;
    fillGeom();
    fillOffsets();
  }
  function fillGeom() {
    var g = currentGeom();
    els.g_page.value = g.page;
    GEOM_FIELDS.forEach(function (k) { els['g_' + k].value = g[k]; });
  }
  function fillOffsets() {
    var o = currentOffset();
    els.offX.value = o.x;
    els.offY.value = o.y;
  }

  function setMode(m) {
    state.mode = m;
    els.modeRange.setAttribute('aria-pressed', String(m === 'range'));
    els.modeList.setAttribute('aria-pressed', String(m === 'list'));
    els.rangeFields.hidden = m !== 'range';
    els.listFields.hidden = m !== 'list';
  }

  function sheetTitle() {
    if (state.sheetId === 'custom') return 'CUSTOM';
    var s = SHEET_BY_ID[state.sheetId];
    return (s.page === 'a4' ? 'A4 ' + s.w.toFixed(1) + '×' + s.h.toFixed(1) + ' MM' : s.inch.replace(/ in$/, '″').replace(/ /g, '')) + ' · ' + (s.cols * s.rows);
  }

  function renderSheetInfo(c) {
    var g = c.g;
    var line1 = g.w.toFixed(1) + ' × ' + g.h.toFixed(1) + ' MM · ' + g.cols + ' × ' + g.rows + ' = ' + c.cap + ' / SHEET · ' + c.pg.name;
    var html = '<div>' + esc(line1) + '</div>';
    if (state.sheetId === 'custom') {
      html += '<div class="ref">YOUR MEASUREMENTS · SAVED IN THIS BROWSER</div>';
      els.geomTag.textContent = 'CUSTOM';
    } else {
      var s = SHEET_BY_ID[state.sheetId];
      html += '<div class="ref">SAME SIZE AS ' + esc(s.ref.toUpperCase()) + '</div>';
      html += '<div class="est">○ ' + (s.inferred ? 'GRID INFERRED FROM LABEL COUNT · ' : '') + 'SPACING ESTIMATED · CHECK WITH THE CALIBRATION PAGE</div>';
      els.geomTag.textContent = 'ESTIMATED';
    }
    els.sheetInfo.innerHTML = html;
    els.geomWarn.hidden = !c.geomProblems.length;
    els.geomWarn.textContent = c.geomProblems.join(' ');
  }

  function renderSVG(c) {
    var g = c.g, pg = c.pg;
    var start = currentPage * c.cap;
    var tooLong = {};
    c.tooLongIds.forEach(function (id) { tooLong[id] = true; });
    var parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + pg.w + ' ' + pg.h + '" font-family="Helvetica, Arial, sans-serif">'];
    parts.push('<rect width="' + pg.w + '" height="' + pg.h + '" fill="#fff"/>');
    for (var i = 0; i < c.cap; i++) {
      var row = Math.floor(i / g.cols), col = i % g.cols;
      var x = r2(g.left + col * g.px), y = r2(g.top + row * g.py);
      var id = c.labels[start + i];
      if (id === undefined) {
        parts.push('<rect x="' + x + '" y="' + y + '" width="' + g.w + '" height="' + g.h + '" rx="' + g.r + '" fill="none" stroke="#B9BFBC" stroke-width="0.25" stroke-dasharray="1 0.8"/>');
        continue;
      }
      var bad = tooLong[id] || (c.line2Small || c.line3Small);
      parts.push('<rect x="' + x + '" y="' + y + '" width="' + g.w + '" height="' + g.h + '" rx="' + g.r + '" fill="' + (bad ? '#FCEFD9' : '#fff') + '" stroke="' + (bad ? '#B4690E' : '#B9BFBC') + '" stroke-width="' + (bad ? 0.45 : 0.25) + '"/>');
      parts.push('<g transform="translate(' + x + ' ' + y + ')">');
      c.layouts.get(id).ops.forEach(function (op) {
        if (op.t === 'text') {
          parts.push('<text x="' + r2(op.x) + '" y="' + r2(op.y) + '" font-size="' + (op.pt * PT).toFixed(3) + '"' + (op.bold ? ' font-weight="700"' : '') + ' fill="#1B2224">' + esc(op.text) + '</text>');
        } else if (op.t === 'qr') {
          var m = op.m.toFixed(3), d = '';
          op.cells.forEach(function (p) { d += 'M' + p[0].toFixed(2) + ' ' + p[1].toFixed(2) + 'h' + m + 'v' + m + 'h-' + m + 'z'; });
          parts.push('<path d="' + d + '" fill="#1B2224"/>');
        } else if (op.t === 'qrmissing') {
          parts.push('<rect x="' + op.x + '" y="' + op.y + '" width="' + op.s + '" height="' + op.s + '" fill="none" stroke="#B4690E" stroke-width="0.3"/>');
        }
      });
      parts.push('</g>');
    }
    parts.push('</svg>');
    els.sheetFrame.innerHTML = parts.join('');
    els.sheetFrame.setAttribute('aria-label', 'Preview of page ' + (currentPage + 1) + ' of ' + c.pages);
  }

  function statusBox(kind, title, body) {
    return '<div class="status ' + kind + '"><div class="status-title">' + title + '</div>' + (body ? '<p class="sans">' + body + '</p>' : '') + '</div>';
  }

  function renderStatus(c) {
    var out = [];
    if (c.error) out.push(statusBox('warn', '! CHECK THE SAMPLE LIST', esc(c.error)));
    else if (!c.labels.length) out.push(statusBox('empty', 'NO LABELS YET', 'Add a range or paste a list of sample IDs.'));
    if (c.geomProblems.length) out.push(statusBox('warn', '! SHEET GEOMETRY', esc(c.geomProblems.join(' '))));
    if (c.tooLongIds.length) {
      var n = c.tooLongIds.length;
      var shown = c.tooLongIds.slice(0, 4).map(function (s) { return '<code>' + esc(s) + '</code>'; }).join(', ') + (n > 4 ? ' and ' + (n - 4) + ' more' : '');
      var copies = clamp(parseInt(state.copies, 10) || 1, 1, 20);
      out.push(statusBox('warn', '! ' + n + (n === 1 ? ' ID' : ' IDS') + ' TOO LONG · ' + n * copies + ' LABELS',
        shown + ' ' + (n === 1 ? 'does' : 'do') + ' not fit a ' + c.g.w.toFixed(1) + ' mm label at 6 pt. ' +
        (state.wrap ? 'Shorten ' + (n === 1 ? 'it' : 'them') + ' or pick a wider label.' : 'Shorten ' + (n === 1 ? 'it' : 'them') + ', pick a wider label, or let long IDs wrap.') +
        ' The PDF still prints ' + (n === 1 ? 'it' : 'them') + ', just smaller.'));
    }
    if (c.line2Small || c.line3Small) {
      var which = c.line2Small && c.line3Small ? 'LINES 2 AND 3' : (c.line2Small ? 'LINE 2' : 'LINE 3');
      out.push(statusBox('warn', '! ' + which + ' TOO LONG', 'It prints below 6 pt on every label. Shorten it or pick a wider label.'));
    }
    if (c.badChars.length) {
      out.push(statusBox('warn', '! CHARACTERS THE PDF CAN’T PRINT', c.badChars.map(function (ch) { return '<code>' + esc(ch) + '</code>'; }).join(' ') + ' — use Latin letters, digits and common symbols.'));
    }
    if (!out.length) {
      out.push('<div class="status pass"><svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="#2E9E5B"/><path d="M4.3 8.3l2.4 2.4 5-5" fill="none" stroke="#fff" stroke-width="2"/></svg><div class="status-title">PASS — ALL ' + c.labels.length + ' LABELS FIT</div></div>');
    }
    els.status.innerHTML = out.join('');
  }

  function render() {
    var c = compute();
    last = c;
    currentPage = clamp(currentPage, 0, c.pages - 1);
    var o = currentOffset();
    els.countBar.textContent = c.ids.length + ' IDS × ' + clamp(parseInt(state.copies, 10) || 1, 1, 20) + ' = ' + c.labels.length;
    els.previewTitle.textContent = 'PREVIEW · ' + sheetTitle();
    els.previewCount.textContent = c.labels.length + ' LABELS · ' + c.cap + ' / SHEET';
    els.offsetFor.textContent = 'SAVED · ' + sheetTitle();
    els.pageLabel.textContent = 'PAGE ' + (currentPage + 1) + ' OF ' + c.pages;
    els.prevPage.disabled = currentPage === 0;
    els.nextPage.disabled = currentPage >= c.pages - 1;
    els.pager.hidden = c.pages < 2;
    els.stLabels.textContent = c.labels.length;
    els.stSheets.textContent = c.labels.length ? c.pages : 0;
    els.stEmpty.textContent = c.empty;
    els.stOffset.textContent = 'X ' + fmt1(o.x) + ' · Y ' + fmt1(o.y) + ' MM';
    var libOk = !!(window.jspdf && window.jspdf.jsPDF);
    els.libError.hidden = libOk;
    els.downloadPdf.disabled = !libOk || !c.labels.length || !!c.error;
    els.calPdf.disabled = !libOk;
    renderSheetInfo(c);
    renderSVG(c);
    renderStatus(c);
    els.savedFlag.textContent = canStore ? '● AUTO-SAVED · SETTINGS STAY IN THIS BROWSER' : '○ NOT SAVED · THIS BROWSER BLOCKS STORAGE';
    els.savedFlag.style.color = canStore ? '' : 'var(--muted)';
  }

  function changed() { save(); render(); }

  /* ---------- PDF ---------- */
  function newDoc(g) {
    var doc = new window.jspdf.jsPDF({ unit: 'mm', format: g.page === 'a4' ? 'a4' : 'letter', orientation: 'portrait', compress: true });
    try { doc.viewerPreferences({ PrintScaling: 'None' }); } catch (e) { /* older viewers ignore it */ }
    return doc;
  }

  function slotRect(doc, x, y, g, style) {
    if (g.r > 0) doc.roundedRect(x, y, g.w, g.h, Math.min(g.r, g.w / 2, g.h / 2), Math.min(g.r, g.w / 2, g.h / 2), style);
    else doc.rect(x, y, g.w, g.h, style);
  }

  function downloadLabels() {
    var c = last || compute();
    if (!c.labels.length) return;
    var g = c.g, o = currentOffset();
    var doc = newDoc(g);
    doc.setProperties({ title: 'Cryo labels ' + todayISO(), creator: 'labmate.tools · Cryo Labels' });
    doc.setTextColor(0, 0, 0);
    doc.setFillColor(0, 0, 0);
    for (var p = 0; p < c.pages; p++) {
      if (p > 0) doc.addPage();
      for (var i = 0; i < c.cap; i++) {
        var id = c.labels[p * c.cap + i];
        if (id === undefined) break;
        var row = Math.floor(i / g.cols), col = i % g.cols;
        var x = g.left + col * g.px + o.x, y = g.top + row * g.py + o.y;
        if (state.outlines) { doc.setDrawColor(160); doc.setLineWidth(0.15); slotRect(doc, x, y, g, 'S'); }
        c.layouts.get(id).ops.forEach(function (op) {
          if (op.t === 'text') {
            doc.setFont('helvetica', op.bold ? 'bold' : 'normal');
            doc.setFontSize(op.pt);
            doc.text(op.text, x + op.x, y + op.y);
          } else if (op.t === 'qr') {
            op.cells.forEach(function (pt) { doc.rect(x + pt[0], y + pt[1], op.m + 0.01, op.m + 0.01, 'F'); });
          }
        });
      }
    }
    doc.save('cryo-labels-' + todayISO() + '.pdf');
  }

  function downloadCalibration() {
    var c = last || compute();
    var g = c.g, pg = c.pg, o = currentOffset();
    var doc = newDoc(g);
    doc.setProperties({ title: 'Cryo labels calibration page', creator: 'labmate.tools · Cryo Labels' });
    var arm = Math.min(g.w, g.h) * 0.32;
    for (var i = 0; i < g.cols * g.rows; i++) {
      var row = Math.floor(i / g.cols), col = i % g.cols;
      var x = g.left + col * g.px + o.x, y = g.top + row * g.py + o.y;
      var cx = x + g.w / 2, cy = y + g.h / 2;
      doc.setDrawColor(140); doc.setLineWidth(0.15);
      doc.setLineDashPattern([0.8, 0.8], 0);
      slotRect(doc, x, y, g, 'S');
      doc.setLineDashPattern([], 0);
      doc.setDrawColor(0); doc.setLineWidth(0.2);
      doc.line(cx - arm, cy, cx + arm, cy);
      doc.line(cx, cy - arm, cx, cy + arm);
      doc.circle(cx, cy, Math.min(1.5, arm * 0.5), 'S');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(4.5); doc.setTextColor(90);
      doc.text(String(i + 1), x + 0.8, y + 2);
    }
    // instruction panel
    var bw = 150, bx = (pg.w - bw) / 2;
    var title = state.sheetId === 'custom' ? 'Custom sheet' : (SHEET_BY_ID[state.sheetId].inch + ', ' + g.cols + ' x ' + g.rows + ' (same size as ' + SHEET_BY_ID[state.sheetId].ref + ')');
    var steps = [
      '1.  Print this page on plain paper at Actual size / 100% - not "Fit to page".',
      '2.  The bar below must measure exactly 100 mm. If it does not, fix the print scale first.',
      '3.  Lay this page on a blank label sheet, edges flush, and hold both up to a window or lamp.',
      '4.  Compare a top-left and a bottom-right label. If the crosses sit 1 mm left of the label centres, add +1 to X. If they sit 1 mm above, add +1 to Y. Print this page again to check.',
      '5.  Corners right but the middle drifts? The spacing is off: adjust the pitch under Sheet geometry.'
    ];
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    var wrapped = [];
    steps.forEach(function (s) { wrapped = wrapped.concat(doc.splitTextToSize(s, bw - 12)); });
    var bh = 34 + wrapped.length * 3.9;
    var by = (pg.h - bh) / 2;
    doc.setFillColor(255, 255, 255); doc.setDrawColor(0); doc.setLineWidth(0.5);
    doc.rect(bx, by, bw, bh, 'FD');
    doc.setFillColor(27, 34, 36);
    doc.rect(bx, by, bw, 7, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text('LABMATE.TOOLS  -  CRYO LABELS CALIBRATION PAGE', bx + 6, by + 4.8);
    doc.setTextColor(0); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(doc.splitTextToSize(title, bw - 12)[0], bx + 6, by + 12);
    doc.text('Offset in this print:  X ' + fmt1(o.x) + ' mm,  Y ' + fmt1(o.y) + ' mm   (printed ' + todayISO() + ')', bx + 6, by + 16.5);
    var ty = by + 22;
    wrapped.forEach(function (line) { doc.text(line, bx + 6, ty); ty += 3.9; });
    // 100 mm scale bar
    var sx = bx + (bw - 100) / 2, sy = ty + 3;
    doc.setLineWidth(0.3);
    doc.line(sx, sy, sx + 100, sy);
    for (var t = 0; t <= 100; t += 5) doc.line(sx + t, sy, sx + t, sy - (t % 10 === 0 ? 2.5 : 1.3));
    doc.setFontSize(6);
    doc.text('0', sx - 0.8, sy + 3); doc.text('50', sx + 49, sy + 3); doc.text('100 mm', sx + 97, sy + 3);
    doc.save('cryo-labels-calibration.pdf');
  }

  /* ---------- events ---------- */
  function bindText(el, key) { el.addEventListener('input', function () { state[key] = el.value; changed(); }); }
  bindText(els.prefix, 'prefix');
  bindText(els.from, 'from');
  bindText(els.to, 'to');
  bindText(els.list, 'list');
  bindText(els.line2, 'line2');
  bindText(els.line3, 'line3');
  els.copies.addEventListener('input', function () {
    var v = parseInt(els.copies.value, 10);
    if (isFinite(v)) { state.copies = clamp(v, 1, 20); changed(); }
  });
  els.copies.addEventListener('change', function () { els.copies.value = state.copies; });
  els.placement.addEventListener('change', function () { state.placement = els.placement.value; changed(); });
  els.template.addEventListener('change', function () { state.template = els.template.value; changed(); });
  els.textSize.addEventListener('change', function () { state.textSize = els.textSize.value; changed(); });
  els.wrap.addEventListener('change', function () { state.wrap = els.wrap.checked; changed(); });
  els.outlines.addEventListener('change', function () { state.outlines = els.outlines.checked; save(); });
  els.modeRange.addEventListener('click', function () { setMode('range'); currentPage = 0; changed(); });
  els.modeList.addEventListener('click', function () { setMode('list'); currentPage = 0; changed(); });

  els.sheet.addEventListener('change', function () {
    state.sheetId = els.sheet.value;
    currentPage = 0;
    fillGeom(); fillOffsets(); changed();
  });

  function onGeomInput() {
    var g = Object.assign({}, currentGeom());
    g.page = els.g_page.value === 'a4' ? 'a4' : 'letter';
    GEOM_FIELDS.forEach(function (k) {
      var v = parseFloat(els['g_' + k].value);
      if (isFinite(v)) g[k] = (k === 'cols' || k === 'rows') ? clamp(Math.round(v), 1, k === 'cols' ? 20 : 60) : Math.max(0, v);
    });
    g.w = Math.max(3, g.w); g.h = Math.max(3, g.h);
    if (state.sheetId !== 'custom') {
      // carry the preset's offset over to the new custom sheet
      state.offsets.custom = Object.assign({}, currentOffset());
    }
    state.custom = g;
    state.sheetId = 'custom';
    els.sheet.value = 'custom';
    fillOffsets();
    changed();
  }
  els.g_page.addEventListener('change', onGeomInput);
  GEOM_FIELDS.forEach(function (k) { els['g_' + k].addEventListener('input', onGeomInput); });

  function onOffset() {
    var x = parseFloat(els.offX.value), y = parseFloat(els.offY.value);
    state.offsets[state.sheetId] = { x: isFinite(x) ? clamp(x, -20, 20) : 0, y: isFinite(y) ? clamp(y, -20, 20) : 0 };
    changed();
  }
  els.offX.addEventListener('input', onOffset);
  els.offY.addEventListener('input', onOffset);

  els.csvFile.addEventListener('change', function () {
    var f = els.csvFile.files && els.csvFile.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var ids = String(reader.result).replace(/^﻿/, '').split(/\r?\n/).map(function (line) {
        return line.split(/[,;\t]/)[0].replace(/^"(.*)"$/, '$1').trim();
      }).filter(Boolean);
      state.list = ids.join('\n');
      els.list.value = state.list;
      setMode('list');
      currentPage = 0;
      changed();
      els.csvFile.value = '';
    };
    reader.readAsText(f);
  });

  els.prevPage.addEventListener('click', function () { currentPage--; render(); });
  els.nextPage.addEventListener('click', function () { currentPage++; render(); });
  els.downloadPdf.addEventListener('click', downloadLabels);
  els.calPdf.addEventListener('click', downloadCalibration);

  /* ---------- start ---------- */
  buildSheetSelect();
  setMode(state.mode);
  fillInputs();
  render();
  // fonts can arrive after first paint; nothing to re-measure (PDF metrics), but re-render once jsPDF is surely ready
  window.addEventListener('load', render);

  // exposed for testing in the console
  window.__cryoLabels = { compute: compute, layoutLabel: layoutLabel, estimateGeom: estimateGeom, SHEETS: SHEETS };
})();
