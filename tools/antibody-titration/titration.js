// labmate.tools — 7.2 Antibody Titration: the page. Maths in assets/flow-core.js (window.LMF).
(function () {
  "use strict";
  var LM = window.LM, F = window.LMF, G = window.LMG, Lib = window.LMLib;
  var KEY = "lm-titration-v1";
  var $ = function (id) { return document.getElementById(id); };

  var DEF = { target: "CD4", fluor: "PE", clone: "", lot: "", stock: "0.2", rec: "0.25", recUnit: "ug",
    finalVol: "100", cellVol: "50", top: "4", factor: "2", points: "8", mode: "serial", extra: "10", cells: "1000000", cellType: "",
    paste: "", method: "auto", cols: null, amounts: {} };
  var st = LM.load(KEY);
  if (!st || typeof st !== "object") st = JSON.parse(JSON.stringify(DEF));
  Object.keys(DEF).forEach(function (k) { if (st[k] === undefined) st[k] = JSON.parse(JSON.stringify(DEF[k])); });

  var FIELDS = ["target", "fluor", "clone", "lot", "stock", "rec", "recUnit", "finalVol", "cellVol", "top", "factor", "points", "extra", "cells", "cellType"];
  function fill() {
    FIELDS.forEach(function (k) { $(k).value = st[k]; });
    $("paste").value = st.paste;
    segSet("modeSeg", "mode", st.mode); segSet("methodSeg", "method", st.method);
  }
  function segSet(seg, attr, v) {
    Array.prototype.forEach.call($(seg).querySelectorAll("button"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-" + attr) === v)); });
  }
  function read() { FIELDS.forEach(function (k) { st[k] = $(k).value; }); st.paste = $("paste").value; }

  function setMsg(id, text) {
    var m = $(id + "m"); if (m) m.textContent = text || "";
    var t = document.querySelector('[data-term="' + id + '"]'); if (t) t.classList.toggle("is-bad", !!text);
  }
  function val(id, o) {
    o = o || {};
    var v = LM.parse(st[id]);
    if (v == null) { if (o.optional) return o.def; setMsg(id, "Required"); return NaN; }
    if (isNaN(v)) { setMsg(id, "Not a number"); return NaN; }
    if (o.int && v !== Math.round(v)) { setMsg(id, "Whole number"); return NaN; }
    if (o.min != null && v < o.min) { setMsg(id, o.minMsg || "Too small"); return NaN; }
    if (o.max != null && v > o.max) { setMsg(id, o.maxMsg || "Too large"); return NaN; }
    if (!o.zero && v <= 0) { setMsg(id, "Must be above zero"); return NaN; }
    return v;
  }
  var ul = function (v) { return v == null || !isFinite(v) ? "—" : LM.fmt(v, v >= 100 ? 4 : 3) + " µL"; };
  var amtUnit = function () { return stockOn() ? "µg" : "µL"; };
  function stockOn() { var v = LM.parse(st.stock); return st.recUnit === "ug" || (v > 0 && !isNaN(v)); }

  // ---------------- 1 + 2: the series ----------------
  var ser = null;
  function series() {
    ["stock", "rec", "finalVol", "cellVol", "top", "factor", "points", "extra"].forEach(function (k) { setMsg(k, ""); });
    var stock = LM.parse(st.stock);
    if (stock != null && (isNaN(stock) || stock <= 0)) { setMsg("stock", "Leave empty or above zero"); stock = NaN; }
    if (st.recUnit === "ug" && stock == null) { setMsg("stock", "Needed for µg per test"); stock = NaN; }
    var o = {
      stock: st.recUnit === "ul" ? null : stock, rec: val("rec"), finalVol: val("finalVol"),
      cellVol: val("cellVol", { zero: true, optional: true, def: 0 }), top: val("top"),
      factor: val("factor", { min: 1.2, minMsg: "At least 1.2" }), points: val("points", { int: true, min: 2, max: 16, minMsg: "2 to 16", maxMsg: "2 to 16" }),
      extra: val("extra", { zero: true, optional: true, def: 0 }) / 100, mode: st.mode
    };
    if (o.cellVol >= o.finalVol) setMsg("cellVol", "Must be below the staining volume");
    var bad = Object.keys(o).some(function (k) { return k !== "stock" && k !== "mode" && typeof o[k] === "number" && isNaN(o[k]); }) || (o.stock !== null && isNaN(o.stock));
    if (bad || o.cellVol >= o.finalVol) { ser = null; return renderSeries(); }
    ser = F.series(o);
    ser.o = o;
    renderSeries();
  }

  function renderSeries() {
    var ans = $("ans"), big = $("ansBig"), say = $("ansSay");
    if (!ser || !ser.ok) {
      ans.className = "ans is-empty"; big.textContent = "—"; say.textContent = "Fill in the antibody and the series to get the tube plan.";
      $("tubes").innerHTML = ""; $("steps").innerHTML = ""; $("serNotes").innerHTML = ""; return;
    }
    var o = ser.o, t = ser.tubes, u = ser.byUl ? "µL" : "µg";
    ans.className = "ans";
    big.innerHTML = t.length + " tubes <span class=\"eq\">" + LM.fmt(t[0].amount, 3) + " → " + LM.fmt(t[t.length - 1].amount, 3) + "</span> " + u + "/test";
    say.innerHTML = "From <b>" + LM.fmt(o.top, 3) + "×</b> the recommended amount down to <b>" + LM.fmt(t[t.length - 1].mult, 3) + "×</b> in ×" + LM.fmt(o.factor, 3) +
      " steps, " + LM.fmt(o.finalVol, 4) + " µL per tube" + (o.cellVol > 0 ? " (" + LM.fmt(ser.vMix, 4) + " µL antibody mix + " + LM.fmt(o.cellVol, 4) + " µL cells)" : "") + ".";

    var head = '<thead><tr><th class="c-chk"><span class="sr">Done</span></th><th>TUBE</th><th class="c-num">AMOUNT / TEST</th><th class="c-num">DILUTION</th>' +
      (ser.byUl ? "" : '<th class="c-num">FINAL µg/mL</th>') + (ser.mode === "serial" ? '<th class="c-num">MIX µg/mL</th>' : '<th class="c-num">ANTIBODY</th><th class="c-num">BUFFER</th>') + '</tr></thead>';
    if (ser.mode === "serial" && ser.byUl) head = head.replace('<th class="c-num">MIX µg/mL</th>', '<th class="c-num">MIX</th>');
    var body = t.map(function (x) {
      var cells = '<td class="c-chk"><input type="checkbox" aria-label="Tube ' + x.n + ' done"></td><td data-l="TUBE"><b>' + x.n + '</b> <small>' + LM.fmt(x.mult, 3) + '× rec.</small></td>' +
        '<td class="c-num" data-l="AMOUNT / TEST">' + LM.fmt(x.amount, 3) + " " + u + '<small>' + ul(x.ulStock) + ' stock</small></td>' +
        '<td class="c-num" data-l="DILUTION">1:' + LM.fmt(x.dil, 4) + '</td>' +
        (ser.byUl ? "" : '<td class="c-num" data-l="FINAL µg/mL">' + LM.fmt(x.finalUgMl, 3) + '</td>');
      if (ser.mode === "serial") cells += '<td class="c-num" data-l="MIX">' + (ser.byUl ? "1:" + LM.fmt(o.finalVol / x.ulStock / ser.conc, 4) : LM.fmt(x.mixUgMl, 3)) + '</td>';
      else cells += '<td class="c-num c-add" data-l="ANTIBODY">' + (x.pre && x.pre.d > 1 ? ul(x.add) + '<small>of 1:' + LM.fmt(x.pre.d, 3) + ' predilution</small>' : ul(x.add)) + '</td>' +
        '<td class="c-num" data-l="BUFFER">' + ul(x.buffer) + '</td>';
      return '<tr class="' + (x.buffer < 0 ? "is-warn" : "") + '">' + cells + '</tr>';
    }).join("");
    if (st.unstained) body += '<tr><td class="c-chk"><input type="checkbox" aria-label="Unstained tube done"></td><td data-l="TUBE" class="c-wide"><b>U</b> <small>unstained control</small></td><td class="c-num" data-l="AMOUNT / TEST">0</td><td class="c-num" data-l="DILUTION">—</td>' +
      (ser.byUl ? "" : '<td class="c-num">—</td>') + (ser.mode === "serial" ? '<td class="c-num" data-l="BUFFER">' + ul(ser.keep) + ' buffer</td>' : '<td class="c-num">—</td><td class="c-num" data-l="BUFFER">' + ul(ser.vMix) + '</td>') + '</tr>';
    $("tubes").innerHTML = head + "<tbody>" + body + "</tbody>";

    var steps = [], notes = [];
    if (ser.mode === "serial") {
      var f = ser.first, pre = f.pre;
      if (pre && pre.d > 1) steps.push("Predilute the stock 1:" + LM.fmt(pre.d, 3) + ": <b>" + ul(pre.make.stock) + "</b> antibody + <b>" + ul(pre.make.buffer) + "</b> buffer.");
      steps.push("Tube 1: <b>" + ul(pre && pre.d > 1 ? f.stockUse : f.stock) + "</b> " + (pre && pre.d > 1 ? "of the predilution" : "antibody") + " + <b>" + ul(f.buffer) + "</b> buffer (" + ul(f.total) + " in all). Mix.");
      steps.push("Tubes 2–" + t.length + ": <b>" + ul(ser.buffer) + "</b> buffer each.");
      steps.push("Move <b>" + ul(ser.transfer) + "</b> from tube 1 to tube 2, mix, then 2 → 3 and on to tube " + t.length + ". Change tips between tubes.");
      steps.push("Take <b>" + ul(ser.discard) + "</b> out of tube " + t.length + " and discard it, so every tube holds " + ul(ser.keep) + ".");
      steps.push("Add <b>" + ul(o.cellVol) + "</b> cells to each tube" + (o.cellVol > 0 ? "" : " (cells already pelleted in the tube)") + " and stain as usual. " + LM.fmt(ser.keep - ser.vMix, 3) + " µL per tube is spare.");
      if (ser.warn.some(function (w) { return w.k === "tooConc"; })) notes.push('<li class="note">The stock is too dilute for tube 1: it needs more antibody than the tube holds. Start lower, or use a larger staining volume.</li>');
    } else {
      steps.push("Put the buffer listed in each tube, then the antibody. Use a fresh tip for each tube.");
      if (ser.pre) steps.unshift("Predilute the stock 1:" + LM.fmt(ser.pre.d, 3) + " for tubes " + t.filter(function (x) { return x.pre.d > 1; }).map(function (x) { return x.n; }).join(", ") +
        ": <b>" + ul(ser.pre.stock) + "</b> antibody + <b>" + ul(ser.pre.buffer) + "</b> buffer.");
      else if (t.some(function (x) { return x.pre.d > 1; })) steps.unshift("Make the predilution shown for each small tube (" + ul(F.TARGET_UL) + " antibody + buffer to the factor).");
      steps.push("Add <b>" + ul(o.cellVol) + "</b> cells to each tube and stain as usual.");
      if (ser.warn.length) notes.push('<li class="note">The antibody volume is more than the ' + ul(ser.vMix) + ' mix in some tubes. Start lower or use a more concentrated stock.</li>');
    }
    if (ser.byUl) notes.push('<li class="note info">No stock concentration: amounts are µL of the vial per test. Enter the concentration from the datasheet to see µg and µg/mL.</li>');
    if (o.top < 2) notes.push('<li class="note info">The series starts at ' + LM.fmt(o.top, 3) + '× the recommendation. Starting at 2–4× shows whether the antibody saturates above it.</li>');
    $("steps").innerHTML = steps.map(function (s) { return "<li>" + s + "</li>"; }).join("");
    $("serNotes").innerHTML = notes.join("");
    $("printHead").textContent = "Antibody titration · " + [st.target, st.fluor, st.clone].filter(Boolean).join(" ") + (st.lot ? " · lot " + st.lot : "") + " · " + new Date().toISOString().slice(0, 10);
  }

  // ---------------- 3: stain index ----------------
  var tab = null, res = null;
  function readPaste() {
    tab = st.paste.trim() ? F.readTable(st.paste) : null;
    var box = $("colBox");
    if (!tab || !tab.ok) { box.hidden = true; return; }
    box.hidden = false;
    var cols = st.cols && st.cols.n === tab.head.length && st.cols.h === tab.head.join("\u0001") ? st.cols : null;
    var g = cols ? cols.g : tab.guess;
    st.cols = { n: tab.head.length, h: tab.head.join("\u0001"), g: g };
    ["name", "pos", "neg", "sd", "p84"].forEach(function (k) {
      var sel = $("col-" + k);
      sel.innerHTML = '<option value="-1">' + (k === "name" || k === "pos" || k === "neg" ? "—" : "none") + '</option>' +
        tab.head.map(function (h, i) { return '<option value="' + i + '">' + LM.esc(h.length > 48 ? h.slice(0, 46) + "…" : h) + '</option>'; }).join("");
      sel.value = String(g[k]);
    });
  }
  function amountOf(label, i) {
    var o = ser && ser.ok ? ser.o : null, a = F.labelAmount(label);
    var stock = o ? o.stock : null, fv = o ? o.finalVol : LM.parse(st.finalVol);
    var inUg = stockOn();
    if (a) {
      if (a.kind === "mult" && o) return o.rec * a.v;
      if (a.kind === "dil" && fv > 0) { var u = fv / a.v; return inUg ? (stock > 0 ? u * stock : NaN) : u; }
      if (a.kind === "ul") return inUg ? (stock > 0 ? a.v * stock : NaN) : a.v;
      if (a.kind === "ug") return inUg ? a.v : NaN;
    }
    if (ser && ser.ok && ser.tubes[i]) return ser.tubes[i].amount;
    return NaN;
  }
  function analyse() {
    var tbody = $("siRows"), m = $("siMsg");
    res = null;
    if (!tab || !tab.ok) {
      tbody.innerHTML = ""; $("chart").innerHTML = ""; $("siAns").className = "ans is-empty";
      $("siBig").textContent = "—"; $("siSay").textContent = st.paste.trim() ? "No rows with numbers found in the paste." : "Paste the statistics table from your analysis software.";
      $("siNotes").innerHTML = ""; $("saveLib").disabled = true; m.textContent = ""; return;
    }
    var g = st.cols.g;
    var num = function (r, c) { return c >= 0 ? G.num(r[c]) : null; };
    var rows = tab.rows.map(function (r, i) {
      var label = g.name >= 0 ? r[g.name] : "Row " + (i + 1);
      var key = label || ("#" + i);
      var manual = st.amounts[key];
      var x = manual != null && manual !== "" ? LM.parse(manual) : amountOf(label, i);
      return { key: key, label: label, x: x, manual: manual, pos: num(r, g.pos), neg: num(r, g.neg), sd: num(r, g.sd), p84: num(r, g.p84) };
    });
    var use = rows.filter(function (r) { return r.x > 0 && r.pos != null && r.neg != null; });
    m.textContent = g.pos < 0 || g.neg < 0 ? "Pick the positive and negative MFI columns." : "";
    res = g.pos >= 0 && g.neg >= 0 ? F.analyse(use, st.method) : null;
    var u = amtUnit() + "/test";
    tbody.innerHTML = rows.map(function (r) {
      var p = res && res.ok ? res.pts.filter(function (q) { return q.label === r.label && q.x === r.x; })[0] : null;
      var cls = p && res.best === p ? "is-best" : "";
      if (p && res.lean === p) cls += " is-lean";
      var tags = (p && res.best === p ? '<span class="fl-tag is-best">BEST</span>' : "") + (p && res.lean === p && res.lean !== res.best ? '<span class="fl-tag is-lean">LEAN</span>' : "") +
        (p && p.bgUp ? '<span class="fl-tag is-bg">BG ↑</span>' : "");
      return '<tr class="' + cls + '"><td data-l="SAMPLE" class="c-wide">' + LM.esc(r.label || "") + tags + '</td>' +
        '<td data-l="AMOUNT ' + u + '"><label class="sr" for="am-' + LM.esc(r.key) + '">Amount per test for ' + LM.esc(r.label) + '</label><input type="text" class="num" inputmode="decimal" id="am-' + LM.esc(r.key) + '" data-key="' + LM.esc(r.key) + '" value="' + LM.esc(r.manual != null && r.manual !== "" ? r.manual : (r.x > 0 ? LM.fmtPlain(r.x, 4) : "")) + '" placeholder="?"></td>' +
        '<td class="c-num" data-l="POS MFI">' + LM.fmt(r.pos, 5) + '</td><td class="c-num" data-l="NEG MFI">' + LM.fmt(r.neg, 4) + '</td>' +
        '<td class="c-num" data-l="NEG SD">' + (r.sd != null ? LM.fmt(r.sd, 4) : r.p84 != null ? '<small>p84 ' + LM.fmt(r.p84, 4) + '</small>' : "—") + '</td>' +
        '<td class="c-num c-add" data-l="INDEX">' + (p && isFinite(p.v) ? LM.fmt(p.v, 3) : "—") + '</td></tr>';
    }).join("");
    $("siHeadAmt").textContent = "AMOUNT " + u.toUpperCase();
    var notes = [];
    if (!res || !res.ok) {
      $("siAns").className = "ans is-empty"; $("siBig").textContent = "—";
      $("siSay").textContent = use.length < 2 ? "Need at least two rows with an amount, a positive and a negative MFI. Type missing amounts in the table." : "The index cannot be worked out from these columns.";
      $("chart").innerHTML = ""; $("siNotes").innerHTML = ""; $("saveLib").disabled = true; return;
    }
    var NAMES = { si: "stain index", sep: "separation index (84th percentile)", sn: "signal-to-noise (pos ÷ neg)" };
    $("siAns").className = "ans";
    $("siBig").innerHTML = LM.fmt(res.lean.x, 3) + " " + LM.esc(u) + (res.lean !== res.best ? ' <span class="eq">or ' + LM.fmt(res.best.x, 3) + '</span>' : "");
    $("siSay").innerHTML = (res.lean !== res.best
      ? "<b>" + LM.fmt(res.lean.x, 3) + " " + u + "</b> is the lowest amount within " + Math.round(res.keepFrac * 100) + "% of the best " + NAMES[res.method] + " (" + LM.fmt(res.lean.v, 3) + " vs " + LM.fmt(res.best.v, 3) + " at " + LM.fmt(res.best.x, 3) + "). Use it to save antibody; use the best for the widest separation."
      : "<b>" + LM.fmt(res.best.x, 3) + " " + u + "</b> gives the highest " + NAMES[res.method] + " (" + LM.fmt(res.best.v, 3) + ") and no lower amount comes within " + Math.round(res.keepFrac * 100) + "% of it.") +
      (ser && ser.ok ? " In " + LM.fmt(ser.o.finalVol, 4) + " µL that is 1:" + LM.fmt(ser.o.finalVol / (stockOn() ? res.lean.x / ser.o.stock : res.lean.x), 4) + "." : "");
    if (res.method === "sn") notes.push('<li class="note">No SD or 84th percentile column for the negative population, so this is signal-to-noise (pos ÷ neg), which ignores spread. Add a robust SD (rSD) column to get the stain index.</li>');
    if (res.flags.indexOf("topBest") >= 0) notes.push('<li class="note">The index is still highest at the top amount: the antibody may not be saturating yet. Repeat with a higher start.</li>');
    if (res.flags.indexOf("lowBest") >= 0) notes.push('<li class="note">The index is highest at the lowest amount. Repeat the series starting lower.</li>');
    if (res.flags.indexOf("bgUp") >= 0) notes.push('<li class="note">The negative population is more than twice as bright at the amounts marked BG ↑ as at the lowest one: non-specific binding. Stay below them.</li>');
    if (rows.length > use.length) notes.push('<li class="note info">' + (rows.length - use.length) + ' row' + (rows.length - use.length === 1 ? " is" : "s are") + ' left out (no amount or no MFI). Type an amount to include ' + (rows.length - use.length === 1 ? "it" : "them") + '.</li>');
    notes.push('<li class="note info">Valid for ' + (LM.parse(st.cells) > 0 ? LM.fmt(LM.parse(st.cells), 3) + " cells in " : "") + LM.fmt(LM.parse(st.finalVol), 4) + ' µL. Staining a different number of cells or volume changes the best concentration.</li>');
    $("siNotes").innerHTML = notes.join("");
    $("chart").innerHTML = chartSvg(false);
    $("saveLib").disabled = false;
  }

  // ---------------- chart ----------------
  function chartSvg(forExport) {
    if (!res || !res.ok) return "";
    var W = 640, H = 340, m = { l: 58, r: 16, t: 18, b: 48 };
    var pts = res.pts.filter(function (p) { return isFinite(p.v); });
    var xs = pts.map(function (p) { return p.x; });
    var lx0 = Math.log10(Math.min.apply(null, xs)), lx1 = Math.log10(Math.max.apply(null, xs));
    var padX = Math.max((lx1 - lx0) * 0.06, 0.15); lx0 -= padX; lx1 += padX;
    var vmax = Math.max.apply(null, pts.map(function (p) { return p.v; })), vmin = Math.min(0, Math.min.apply(null, pts.map(function (p) { return p.v; })));
    var y1 = vmax * 1.12 || 1, y0 = vmin;
    var X = function (x) { return m.l + (Math.log10(x) - lx0) / (lx1 - lx0) * (W - m.l - m.r); };
    var Y = function (v) { return m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b); };
    var css = forExport ? '<style>text{font-family:"IBM Plex Mono",Menlo,monospace;font-size:11px;fill:#4A5655}.g{stroke:#E2DED2}.ax{stroke:#1B2224;stroke-width:1.2}.ln{fill:none;stroke:#17403D;stroke-width:2}.pt{fill:#fff;stroke:#1B2224;stroke-width:1.4}.bst{fill:#2E9E5B;stroke:#1B2224;stroke-width:1.4}.ln2{stroke:#2E9E5B;stroke-dasharray:4 3}.lean{fill:none;stroke:#17403D;stroke-width:2}</style>' : "";
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Index against antibody amount">' + css;
    if (forExport) s += '<rect width="' + W + '" height="' + H + '" fill="#fff"/>';
    // y grid
    var step = niceStep((y1 - y0) / 5);
    for (var v = Math.ceil(y0 / step) * step; v <= y1 + 1e-9; v += step) {
      var gy = Y(v).toFixed(1);
      s += '<line class="g" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + gy + '" y2="' + gy + '"/><text x="' + (m.l - 6) + '" y="' + (+gy + 4) + '" text-anchor="end">' + LM.fmt(v, 3) + '</text>';
    }
    G.logTicks(Math.pow(10, lx0), Math.pow(10, lx1)).forEach(function (tk) {
      var gx = X(tk.v).toFixed(1);
      s += '<line class="g" x1="' + gx + '" x2="' + gx + '" y1="' + m.t + '" y2="' + (H - m.b) + '"' + (tk.major ? "" : ' stroke-opacity=".5"') + '/>';
      s += '<text x="' + gx + '" y="' + (H - m.b + 16) + '" text-anchor="middle">' + LM.fmt(tk.v, 3) + '</text>';
    });
    s += '<line class="ax" x1="' + m.l + '" x2="' + m.l + '" y1="' + m.t + '" y2="' + (H - m.b) + '"/><line class="ax" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + (H - m.b) + '" y2="' + (H - m.b) + '"/>';
    s += '<text x="' + ((m.l + W - m.r) / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + LM.esc(amtUnit()) + ' per test (log scale)</text>';
    s += '<text x="14" y="' + ((m.t + H - m.b) / 2) + '" text-anchor="middle" transform="rotate(-90 14 ' + ((m.t + H - m.b) / 2) + ')">' + ({ si: "Stain index", sep: "Separation index", sn: "Pos ÷ neg" })[res.method] + '</text>';
    var thr = res.best.v * res.keepFrac;
    s += '<line class="ln2" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(thr).toFixed(1) + '" y2="' + Y(thr).toFixed(1) + '"/>';
    s += '<text x="' + (W - m.r - 4) + '" y="' + (Y(thr) - 5).toFixed(1) + '" text-anchor="end">' + Math.round(res.keepFrac * 100) + '% of best</text>';
    s += '<polyline class="ln" points="' + pts.map(function (p) { return X(p.x).toFixed(1) + "," + Y(p.v).toFixed(1); }).join(" ") + '"/>';
    pts.forEach(function (p) {
      var isB = p === res.best;
      s += '<circle class="' + (isB ? "bst" : "pt") + '" cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) + '" r="' + (isB ? 6 : 4.5) + '"><title>' + LM.esc(p.label || "") + ": " + LM.fmt(p.x, 3) + " → " + LM.fmt(p.v, 3) + '</title></circle>';
    });
    if (res.lean !== res.best) s += '<circle class="lean" cx="' + X(res.lean.x).toFixed(1) + '" cy="' + Y(res.lean.v).toFixed(1) + '" r="10"/>';
    return s + "</svg>";
  }
  function niceStep(raw) {
    var e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  }

  function download(name, blob) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function stem() { return ("titration-" + [st.target, st.fluor].filter(Boolean).join("-")).replace(/[^\w.-]+/g, "-").toLowerCase(); }
  function csvCell(v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

  // ---------------- events ----------------
  function update() { read(); series(); readPaste(); analyse(); LM.save(KEY, st); }
  document.addEventListener("input", function (e) {
    if (e.target.closest(".fl-out") && e.target.getAttribute("data-key")) {
      st.amounts[e.target.getAttribute("data-key")] = e.target.value; LM.save(KEY, st);
      clearTimeout(analyse.t); analyse.t = setTimeout(function () { var id = e.target.id, pos = e.target.selectionStart; analyse(); var el = $(id); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) { /* */ } } }, 500);
      return;
    }
    if (e.target.closest("#colBox") || e.target.type === "checkbox") return;
    update();
  });
  $("colBox").addEventListener("change", function (e) {
    var k = e.target.id.replace("col-", ""); st.cols.g[k] = +e.target.value; LM.save(KEY, st); analyse();
  });
  $("unstained").addEventListener("change", function () { st.unstained = this.checked; renderSeries(); LM.save(KEY, st); });
  $("tubes").addEventListener("change", function (e) { if (e.target.type === "checkbox") e.target.closest("tr").classList.toggle("is-done", e.target.checked); });
  $("modeSeg").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; st.mode = b.getAttribute("data-mode"); segSet("modeSeg", "mode", st.mode); update(); });
  $("methodSeg").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; st.method = b.getAttribute("data-method"); segSet("methodSeg", "method", st.method); analyse(); LM.save(KEY, st); });
  $("recUnit").addEventListener("change", update);
  $("file").addEventListener("change", function () {
    var f = this.files && this.files[0]; if (!f) return;
    f.arrayBuffer().then(function (buf) { $("paste").value = G.decode(buf); st.amounts = {}; update(); $("file").value = ""; });
  });
  $("example").addEventListener("click", function () {
    var lines = ["Name\tLymphocytes/CD4+ | Median (Comp-PE-A)\tLymphocytes/CD4- | Median (Comp-PE-A)\tLymphocytes/CD4- | Robust SD (Comp-PE-A)"];
    var pos = [41200, 39800, 36900, 30100, 21400, 13200, 7400, 3900], neg = [1180, 690, 410, 260, 190, 160, 150, 145], sd = [420, 260, 170, 120, 100, 92, 88, 86];
    var dils = [20, 40, 80, 160, 320, 640, 1280, 2560];
    dils.forEach(function (d, i) { lines.push("CD4 PE 1:" + d + ".fcs\t" + pos[i] + "\t" + neg[i] + "\t" + sd[i]); });
    $("paste").value = lines.join("\n"); st.amounts = {}; update();
    $("paste").scrollIntoView({ block: "nearest" });
  });
  $("clearPaste").addEventListener("click", function () { $("paste").value = ""; st.amounts = {}; st.cols = null; update(); });
  $("print").addEventListener("click", function () { window.print(); });
  $("copy").addEventListener("click", function () {
    if (!ser || !ser.ok) return;
    var text = $("printHead").textContent + "\n" + ser.tubes.map(function (x) { return "Tube " + x.n + ": " + LM.fmtPlain(x.amount, 4) + " " + (ser.byUl ? "µL" : "µg") + "/test, 1:" + LM.fmtPlain(x.dil, 4) + (x.add != null ? ", add " + LM.fmtPlain(x.add, 3) + " µL" + (x.pre && x.pre.d > 1 ? " of 1:" + x.pre.d : "") + " + " + LM.fmtPlain(x.buffer, 4) + " µL buffer" : ""); }).join("\n") +
      "\n" + Array.prototype.map.call($("steps").querySelectorAll("li"), function (li, i) { return (i + 1) + ". " + li.textContent; }).join("\n");
    LM.copy(text, function (ok) { $("copied").textContent = ok ? "COPIED" : "COPY FAILED"; setTimeout(function () { $("copied").textContent = ""; }, 2500); });
  });
  $("csv").addEventListener("click", function () {
    if (!ser || !ser.ok) return;
    var u = ser.byUl ? "uL" : "ug";
    var lines = [["tube", "x recommended", "amount " + u + "/test", "stock uL/test", "dilution 1:", "final ug/mL", "add uL", "predilution 1:", "buffer uL"].join(",")];
    ser.tubes.forEach(function (x) { lines.push([x.n, x.mult, x.amount, x.ulStock, x.dil, x.finalUgMl == null ? "" : x.finalUgMl, x.add == null ? "" : x.add, x.pre && x.pre.d > 1 ? x.pre.d : "", x.buffer == null ? "" : x.buffer].map(csvCell).join(",")); });
    lines.push(""); lines.push(csvCell($("printHead").textContent));
    if (ser.mode === "serial") lines.push(csvCell("Serial: tube 1 " + LM.fmtPlain(ser.first.total, 4) + " uL; tubes 2-" + ser.tubes.length + " " + LM.fmtPlain(ser.buffer, 4) + " uL buffer; transfer " + LM.fmtPlain(ser.transfer, 4) + " uL; discard " + LM.fmtPlain(ser.discard, 4) + " uL from the last tube."));
    download(stem() + "-series.csv", new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" }));
  });
  $("siCsv").addEventListener("click", function () {
    if (!res || !res.ok) return;
    var lines = [["sample", "amount " + amtUnit() + "/test", "pos MFI", "neg MFI", "neg SD", "neg p84", res.method + " index", "pick"].join(",")];
    res.pts.forEach(function (p) { lines.push([p.label, p.x, p.pos, p.neg, p.sd == null ? "" : p.sd, p.p84 == null ? "" : p.p84, p.v, p === res.best ? "best" : p === res.lean ? "lean" : ""].map(csvCell).join(",")); });
    lines.push(""); lines.push(csvCell("labmate.tools Antibody Titration (" + F.ALGO + ")"));
    download(stem() + "-index.csv", new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" }));
  });
  $("svg").addEventListener("click", function () { if (res && res.ok) download(stem() + ".svg", new Blob([chartSvg(true)], { type: "image/svg+xml" })); });
  $("png").addEventListener("click", function () {
    if (!res || !res.ok) return;
    var img = new Image(), url = URL.createObjectURL(new Blob([chartSvg(true)], { type: "image/svg+xml" }));
    img.onload = function () {
      var c = document.createElement("canvas"); c.width = 1280; c.height = 680;
      var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); c.toBlob(function (b) { download(stem() + ".png", b); });
    };
    img.src = url;
  });
  $("saveLib").addEventListener("click", function () {
    if (!res || !res.ok) return;
    var pick = $("pickWhich").value === "best" ? res.best : res.lean;
    var stock = LM.parse(st.stock), rec = LM.parse(st.rec);
    var a = Lib.put({
      target: st.target.trim(), fluor: st.fluor.trim(), clone: st.clone.trim(), lot: st.lot.trim(),
      stock: stock > 0 ? stock : null, rec: rec > 0 ? rec : null, recUnit: st.recUnit,
      titer: { amount: pick.x, unit: stockOn() ? "ug" : "ul", finalVol: LM.parse(st.finalVol), cells: st.cells.trim(), cellType: st.cellType.trim(),
        index: pick.v, method: res.method, lot: st.lot.trim(), date: new Date().toISOString().slice(0, 10) }
    });
    $("saved").textContent = "SAVED " + Lib.label(a).toUpperCase();
    setTimeout(function () { $("saved").textContent = ""; }, 4000);
  });
  $("clear").addEventListener("click", function () {
    st = JSON.parse(JSON.stringify(DEF)); fill(); $("unstained").checked = false; update();
  });

  // a saved antibody → the inputs
  Lib.mount($("lib"), { pick: "LOAD", empty: "Titrate one and press SAVE TO MY ANTIBODIES.", onPick: function (a) {
    st.target = a.target || ""; st.fluor = a.fluor || ""; st.clone = a.clone || ""; st.lot = a.lot || "";
    st.stock = a.stock > 0 ? LM.fmtPlain(a.stock, 4) : ""; st.recUnit = a.recUnit || (a.stock > 0 ? "ug" : "ul");
    if (a.rec > 0) st.rec = LM.fmtPlain(a.rec, 4);
    fill(); update(); window.scrollTo({ top: $("s1").offsetTop - 10, behavior: "smooth" });
  } });

  // ?target=&fluor= from Panel Designer or 7.3
  var q = new URLSearchParams(location.search);
  if (q.get("target")) {
    st.target = q.get("target"); st.fluor = q.get("fluor") || "";
    var hit = Lib.find(st.target, st.fluor);
    if (hit) { st.clone = hit.clone || ""; st.lot = hit.lot || ""; st.stock = hit.stock > 0 ? LM.fmtPlain(hit.stock, 4) : ""; st.recUnit = hit.recUnit || st.recUnit; if (hit.rec > 0) st.rec = LM.fmtPlain(hit.rec, 4); }
  }
  fill(); $("unstained").checked = !!st.unstained;
  update();

  // test hook
  if (window.LMT_FLOW_TEST) window.LMT_FLOW_TEST.titration = { state: function () { return st; }, series: function () { return ser; }, result: function () { return res; }, update: update };
})();
