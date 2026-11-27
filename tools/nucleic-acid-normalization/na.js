// labmate.tools — 2.8 DNA/RNA Normalization (page). The maths and file formats live in na-core.js.
(function () {
  "use strict";
  var LM = window.LM, NA = window.LMNA;
  var KEY = "lm-na-v1";
  var $ = function (id) { return document.getElementById(id); };
  var esc = LM.esc;

  // ---------- examples ----------
  function ndExample() {
    var rows = [["Ctrl 1", 412.6, 2.08, 2.15], ["Ctrl 2", 386.9, 2.07, 2.11], ["Ctrl 3", 1520.4, 2.06, 2.18], ["KO 1", 198.3, 2.05, 1.62],
      ["KO 2", 85.2, 2.01, 1.95], ["KO 3", 2650.0, 2.07, 2.2], ["Treated 1", 240.8, 2.04, 1.21], ["Treated 2", 160.2, 1.72, 2.02]];
    var t = ["Date\tSample Name\tNucleic Acid(ng/uL)\tA260/A280\tA260/A230\tA260\tA280\tNucleic Acid Factor"];
    rows.forEach(function (r, i) {
      var a260 = r[1] / 40;
      t.push("11/26/2026 10:" + String(12 + i).padStart(2, "0") + ":05 AM\t" + r[0] + "\t" + r[1].toFixed(1) + "\t" + r[2].toFixed(2) + "\t" + r[3].toFixed(2) + "\t" + a260.toFixed(3) + "\t" + (a260 / r[2]).toFixed(3) + "\t40");
    });
    return t.join("\n");
  }
  var EX = {
    nd: { src: ndExample, preset: "rt1", type: "auto" },
    qb: { src: function () {
      return ["Run ID,Assay Name,Test Name,Test Date,Qubit® tube conc.,Units,Original sample conc.,Units,Sample Volume (µL),Dilution Factor",
        "2026-11-26,1x dsDNA High Sensitivity,Lib A,11/26/2026 9:40:54 AM,123,ng/mL,24.6,ng/µL,1,200",
        "2026-11-26,1x dsDNA High Sensitivity,Lib B,11/26/2026 9:41:20 AM,91.0,ng/mL,18.2,ng/µL,1,200",
        "2026-11-26,1x dsDNA High Sensitivity,Lib C,11/26/2026 9:41:47 AM,264,ng/mL,52.7,ng/µL,1,200",
        "2026-11-26,1x dsDNA High Sensitivity,Lib D,11/26/2026 9:42:10 AM,19.5,ng/mL,3.90,ng/µL,1,200",
        "2026-11-26,1x dsDNA High Sensitivity,Lib E,11/26/2026 9:42:31 AM,8.00,ng/mL,1.60,ng/µL,1,200",
        "2026-11-26,1x dsDNA High Sensitivity,Lib F,11/26/2026 9:42:58 AM,57.0,ng/mL,11.4,ng/µL,1,200"].join("\n");
    }, preset: "dnalib", type: "auto" },
    list: { src: function () { return "Ctrl 1  412.6\nCtrl 2  386.9\nKO 1  198.3\nKO 2  85.2"; }, preset: "rt05", type: "RNA" }
  };
  var PRESETS = {
    rt1: { mode: "mass", amount: "1", amountUnit: "µg", vf: "10", type: "RNA" },
    rt05: { mode: "mass", amount: "500", amountUnit: "ng", vf: "10", type: "RNA" },
    rnaseq: { mode: "mass", amount: "500", amountUnit: "ng", vf: "50", type: "RNA" },
    dnalib: { mode: "mass", amount: "100", amountUnit: "ng", vf: "50", type: "DNA" },
    seq: { mode: "conc", target: "20", vf: "20", type: "DNA" }
  };
  var DEFAULTS = { src: "", type: "auto", merge: true, mode: "mass", amount: "1", amountUnit: "µg", target: "20", vf: "10", minv: "0.5", dil: "Nuclease-free water",
    predil: true, step: "auto", lay: "tubes", ord: "col", start: "A1", skipEdge: false, title: "", who: "", done: {}, out: [], srcOrder: "file", limits: null, preset: "rt1", guess: "DNA" };

  var state = LM.load(KEY);
  if (!state || typeof state.src !== "string") { state = clone(DEFAULTS); state.src = ndExample(); state.example = "nd"; state.guess = "RNA"; }
  state = Object.assign(clone(DEFAULTS), state);
  if (!state.limits) state.limits = clone(NA.LIMITS);
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function save() { LM.save(KEY, state); }

  var last = null; // the latest calculation, for exports

  // ---------- number helpers ----------
  var f = function (x, s) { return LM.fmt(x, s || 4); };
  function vol(x, ref) { // µL for the sheet, with the decimals of the pipette step used (ref: the sample volume)
    if (x == null || !isFinite(x)) return "—";
    var st = NA.stepFor(ref == null ? x : ref, state.step) || 0.01;
    var d = Math.max(1, Math.min(2, Math.round(-Math.log10(st) + 0.3)));
    if (st >= 0.5 && st < 1) d = 1;
    return x.toFixed(d);
  }
  function up(s) { return String(s).replace(/[^µ]+/g, function (x) { return x.toUpperCase(); }); }
  function ng(x) {
    if (x == null || !isFinite(x)) return "—";
    if (x >= 1000) return LM.fmt(x / 1000, 3) + " µg";
    return LM.fmt(x, 3) + " ng";
  }
  function pct(x) { return (x > 0 ? "+" : "−") + LM.fmt(Math.abs(x), 2) + "%"; }

  // ---------- read the inputs ----------
  function opts() {
    var vf = LM.parse(state.vf), minv = LM.parse(state.minv), amt = LM.parse(state.amount), tgt = LM.parse(state.target);
    var bad = {};
    if (!(vf > 0)) bad.vf = state.vf.trim() ? "Must be above zero" : "";
    if (!(minv >= 0)) bad.minv = state.minv.trim() ? "0 or more" : "";
    if (state.mode === "mass" && !(amt > 0)) bad.amount = state.amount.trim() ? "Must be above zero" : "";
    if (state.mode === "conc" && !(tgt > 0)) bad.target = state.target.trim() ? "Must be above zero" : "";
    var amountNg = amt * (state.amountUnit === "µg" ? 1000 : 1);
    return { ok: !Object.keys(bad).length, bad: bad, mode: state.mode, amount: amountNg, target: tgt, vf: vf, minVol: minv || 0, step: state.step, predil: state.predil };
  }
  function targetSay(o, plain) {
    var u = plain ? "uL" : "µL";
    if (o.mode === "conc") return LM.fmtPlain(o.target) + " ng/" + u + " in " + LM.fmtPlain(o.vf) + " " + u;
    return (plain ? ng(o.amount).replace("µ", "u") : ng(o.amount)) + " in " + LM.fmtPlain(o.vf) + " " + u;
  }

  var parsedCache = { src: null, p: null };
  function parsed() {
    if (parsedCache.src !== state.src) parsedCache = { src: state.src, p: NA.parse(state.src) };
    return parsedCache.p;
  }

  // ---------- calculate ----------
  function calc() {
    var p = parsed(), o = opts();
    var rows = state.merge ? NA.mergeRepeats(p.rows) : p.rows.map(function (r) { return Object.assign({ n: 1, cv: null }, r); });
    // names must be unique for ticks and leaving out
    var seen = {};
    rows.forEach(function (r) {
      var k = r.name, i = 2;
      while (seen[k.toLowerCase()]) k = r.name + " (" + i++ + ")";
      seen[k.toLowerCase()] = 1; r.key = k;
    });
    var unknownType = false;
    var samples = rows.map(function (r) {
      var t = state.type !== "auto" ? state.type : (r.type || p.fileType);
      if (!t || t === "ssDNA") { if (!t) unknownType = true; t = t || state.guess || "DNA"; }
      return Object.assign({}, r, { kind: t, skip: state.out.indexOf(r.key) >= 0, filePos: NA.parseWell(r.pos) ? r.pos.replace(/^([A-P])0(\d)$/, "$1$2") : "" });
    });
    var res = o.ok ? NA.normalize(samples, o) : samples.map(function () { return { status: "wait" }; });
    var used = [];
    samples.forEach(function (s, i) { s.res = res[i]; if (!s.skip && s.res.status !== "nodata") used.push(s); });
    // positions
    var plate = state.lay !== "tubes";
    var wells = plate ? NA.wells(used.length, state.lay, state.ord, state.start, state.skipEdge) : null;
    used.forEach(function (s, i) { s.pos = plate ? (wells[i] ? wells[i].well : "—") : String(i + 1); s.well = plate ? wells[i] : null; });
    samples.forEach(function (s) {
      var lim = state.limits;
      s.p280 = NA.purity(s, "280", s.kind === "RNA" ? "RNA" : "DNA", lim);
      s.p230 = NA.purity(s, "230", s.kind === "RNA" ? "RNA" : "DNA", lim);
    });
    var maxCap = o.ok ? NA.maxEqual(samples, o.vf) : null;
    var limiting = null;
    if (o.ok) samples.forEach(function (s) { if (!s.skip && s.conc > 0 && (!limiting || s.conc < limiting.conc)) limiting = s; });
    return { p: p, o: o, samples: samples, used: used, plate: plate, wells: wells, unknownType: unknownType, maxCap: maxCap, limiting: limiting };
  }

  // ---------- render ----------
  function chip(pu, v) {
    if (v == null) return '<span class="na-pur is-n">—</span>';
    return '<span class="na-pur is-' + pu.c + '"' + (pu.why ? ' title="' + esc(pu.why) + '"' : "") + ">" + v.toFixed(2) + "</span>";
  }
  var STATUS = {
    ok: "", predil: "PRE-DILUTE", dilute: "TOO DILUTE", small: "UNDER MIN. VOLUME", nodata: "NO VALUE", wait: ""
  };

  function render() {
    var C = last = calc();
    var o = C.o, p = C.p;
    save();

    // 1 · what was read
    var info = [];
    if (!state.src.trim()) info.push('<span class="na-muted">Nothing pasted yet.</span>');
    else if (p.rows.length) {
      info.push("<b>" + esc(p.format) + "</b> · " + p.rows.length + " reading" + (p.rows.length === 1 ? "" : "s") +
        (state.merge && C.samples.length < p.rows.length ? " → " + C.samples.length + " samples" : ""));
      if (p.columns) info.push('<span class="na-cols">' + ["name", "conc", "r280", "r230"].filter(function (k) { return p.columns[k]; }).map(function (k) {
        return '<span><i>' + { name: "name", conc: "conc.", r280: "260/280", r230: "260/230" }[k] + "</i> " + esc(p.columns[k]) + "</span>";
      }).join("") + (p.columns.unit ? "<span><i>unit</i> " + esc(p.columns.unit) + "</span>" : "") + "</span>");
      if (p.fileType) info.push("Application: " + esc(p.fileType));
      if (p.decimalComma) info.push("Decimal commas read as points.");
      if (p.skipped) info.push(p.skipped + " line" + (p.skipped === 1 ? "" : "s") + " without a value skipped.");
    }
    p.warnings.forEach(function (w) { info.push('<span class="na-warn">' + esc(w) + "</span>"); });
    $("readInfo").innerHTML = info.map(function (x) { return "<p>" + x + "</p>"; }).join("");

    // 2 · inputs
    ["amount", "target", "vf", "minv"].forEach(function (k) {
      var bad = o.bad[k];
      $(k + "m").textContent = bad || "";
      document.querySelector('[data-term="' + k + '"]').classList.toggle("is-bad", !!bad);
    });
    $("amountTerm").hidden = state.mode !== "mass";
    $("targetTerm").hidden = state.mode !== "conc";
    $("wHead").textContent = shortDil().toUpperCase() + " µL";
    document.querySelectorAll("#presets .chip").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.p === state.preset && presetMatches(state.preset))); });
    syncSegs();

    var nUsed = C.used.length, nAll = C.samples.length;
    // the largest equal amount
    var mb = $("maxBox");
    if (o.ok && C.maxCap && C.limiting && nUsed > 1) {
      var need = o.mode === "conc" ? o.target * o.vf : o.amount;
      var short = C.maxCap < need * 0.9999;
      mb.hidden = false;
      mb.className = "na-max" + (short ? " is-short" : "");
      mb.innerHTML = "Every sample here can give up to <b>" + ng(C.maxCap) + "</b> in " + LM.fmt(o.vf) + " µL" +
        (o.mode === "conc" ? " (" + LM.fmt(C.maxCap / o.vf, 3) + " ng/µL)" : "") + " — " + esc(C.limiting.key) + " at " + f(C.limiting.conc) + " ng/µL sets the limit." +
        (short ? ' <button type="button" class="btn na-btn2" id="useMax">USE ' + esc(ng(C.maxCap)) + " FOR ALL</button>" : "");
      if (short) $("useMax").onclick = function () { setTargetNg(C.maxCap); };
    } else mb.hidden = true;

    // 3 · sheet
    $("plateOpts").hidden = !C.plate;
    var rowsH = [];
    C.samples.forEach(function (s) {
      if (s.skip) return;
      var r = s.res, done = !!state.done[s.key];
      var cls = "is-" + r.status + (done ? " is-done" : "");
      var sub = "";
      if (s.n > 1) sub += '<small class="na-sub">' + s.n + " readings" + (s.cv != null ? " · CV " + LM.fmt(s.cv, 2) + "%" : "") + "</small>";
      if (r.status === "predil") sub += '<small class="na-sub na-pre">Pre-dilute 1:' + r.k + " — " + vol(r.pre.sample) + " µL + " + vol(r.pre.diluent) + " µL " + esc(shortDil()) + "</small>";
      var note = STATUS[r.status] || "";
      var reasons = [];
      if (s.p280.why && s.p280.c !== "g" && s.p280.c !== "q") reasons.push(s.p280.why);
      if (s.p230.why && s.p230.c !== "g" && s.p230.c !== "q") reasons.push(s.p230.why);
      if (r.status === "nodata") reasons.unshift(s.note || "no concentration");
      if (s.kind === "protein") reasons.unshift("protein reading?");
      var nb = (note ? '<b class="na-st">' + note + "</b> " : "") + esc(reasons.join("; "));
      var gives = r.gives != null ? ng(r.gives) + (Math.abs(r.err) >= 3 ? ' <small class="na-err">' + pct(r.err) + "</small>" : "") : "—";
      rowsH.push('<tr class="' + cls + '" data-k="' + esc(s.key) + '">' +
        '<td class="c-done">' + (r.status === "nodata" ? "" : '<input type="checkbox" class="na-tick" aria-label="Done: ' + esc(s.key) + '"' + (done ? " checked" : "") + ">") + "</td>" +
        '<td class="c-pos">' + esc(s.pos || "") + "</td>" +
        '<td class="c-name"><span class="na-nm">' + esc(s.key) + "</span>" + (s.kind === "RNA" || s.kind === "DNA" ? '<span class="na-kind">' + s.kind + "</span>" : "") + sub + "</td>" +
        '<td class="n" data-h="ng/µL">' + (s.conc != null ? f(s.conc) : "—") + "</td>" +
        '<td class="c-pur" data-h="260/280">' + chip(s.p280, s.r280) + "</td>" +
        '<td class="c-pur" data-h="260/230">' + chip(s.p230, s.r230) + "</td>" +
        '<td class="n c-s" data-h="SAMPLE µL">' + (r.sv != null ? "<b>" + vol(r.sv) + "</b>" + (r.k > 1 ? '<small> of 1:' + r.k + "</small>" : "") : "—") + "</td>" +
        '<td class="n c-w" data-h="' + esc(shortDil().toUpperCase()) + ' µL">' + (r.water != null ? "<b>" + vol(r.water, r.sv) + "</b>" : "—") + "</td>" +
        '<td class="n c-g" data-h="GIVES">' + gives + "</td>" +
        '<td class="c-note">' + nb + "</td>" +
        '<td class="c-x"><button type="button" class="mm-x" aria-label="Leave out ' + esc(s.key) + '" title="Leave out">×</button></td></tr>');
    });
    $("rows").innerHTML = rowsH.length ? rowsH.join("") : '<tr><td colspan="11" class="na-empty">' + (state.src.trim() ? "No samples with a concentration." : "Paste concentrations in box 1, or try an example.") + "</td></tr>";

    // totals
    var totW = 0, totPre = 0, totS = 0;
    C.used.forEach(function (s) { if (s.res.water != null) totW += s.res.water; if (s.res.pre) totPre += s.res.pre.diluent; });
    var totD = totW + totPre;
    $("foot").innerHTML = nUsed && o.ok ? '<tr><td></td><td></td><td colspan="4" class="na-tot-k">' + nUsed + " SAMPLE" + (nUsed === 1 ? "" : "S") + " · " + esc(shortDil().toUpperCase()) + " IN ALL" + (totPre ? " (INCL. PRE-DILUTIONS)" : "") +
      '</td><td></td><td class="n c-w"><b>' + vol(totD) + '</b></td><td colspan="3" class="na-tot-k">+10% → ' + vol(totD * 1.1) + " µL</td></tr>" : "";

    // left out
    var outList = C.samples.filter(function (s) { return s.skip; });
    $("leftOut").hidden = !outList.length;
    $("leftOut").innerHTML = outList.length ? "Left out: " + outList.map(function (s) { return '<button type="button" class="na-back" data-k="' + esc(s.key) + '">' + esc(s.key) + " ↺</button>"; }).join(" ") : "";

    // summary
    var cnt = { ok: 0, predil: 0, dilute: 0, small: 0, nodata: 0 }, purityBad = 0, purityRed = 0;
    C.samples.forEach(function (s) {
      if (s.skip) return;
      if (cnt[s.res.status] != null) cnt[s.res.status]++;
      if (s.p280.c === "r" || s.p230.c === "r") purityRed++;
      else if (s.p280.c === "y" || s.p230.c === "y") purityBad++;
    });
    var sm = [];
    if (nUsed && o.ok) {
      sm.push('<span class="na-sum-main">' + nUsed + " sample" + (nUsed === 1 ? "" : "s") + " · " + esc(targetSay(o)) + " each</span>");
      sm.push('<span class="na-badge is-ok">' + cnt.ok + " READY</span>");
      if (cnt.predil) sm.push('<span class="na-badge is-pre">' + cnt.predil + " PRE-DILUTE</span>");
      if (cnt.dilute) sm.push('<span class="na-badge is-dil">' + cnt.dilute + " TOO DILUTE</span>");
      if (cnt.small) sm.push('<span class="na-badge is-dil">' + cnt.small + " UNDER " + LM.fmt(o.minVol) + " µL</span>");
      if (purityRed) sm.push('<span class="na-badge is-r">' + purityRed + " PURITY RED</span>");
      if (purityBad) sm.push('<span class="na-badge is-y">' + purityBad + " PURITY AMBER</span>");
      if (cnt.nodata) sm.push('<span class="na-badge">' + cnt.nodata + " NO VALUE</span>");
    }
    $("summary").innerHTML = sm.join("");
    $("sheetSub").textContent = nUsed && o.ok ? up(targetSay(o)) + " · ADD " + shortDil().toUpperCase() + " FIRST" : "ADD THE DILUENT FIRST, THEN THE SAMPLE";

    renderPlate(C);
    renderNotes(C, cnt);
    renderPrintHead(C);

    var ok = nUsed > 0 && o.ok;
    ["print", "xlsx", "copy", "csv", "worklist", "gwl", "toMix", "toLabels"].forEach(function (id) { $(id).disabled = !ok; });
    var noPos = C.samples.filter(function (s) { return !s.skip && s.res.status !== "nodata" && NA.parseWell(s.pos) === null; }).length;
    $("robotNote").textContent = cnt.predil ? "Pre-diluted samples are listed with their factor: put the diluted sample in the source well." : "";
    if (C.plate && noPos) $("robotNote").textContent += " " + noPos + " sample" + (noPos === 1 ? " doesn't" : "s don't") + " fit on the plate from " + state.start + ".";
  }

  function shortDil() { return state.dil === "Nuclease-free water" || state.dil === "Water" ? "water" : state.dil.split(" ")[0]; }
  function presetMatches(k) {
    var P = PRESETS[k]; if (!P) return false;
    return Object.keys(P).every(function (x) { return x === "type" || String(state[x]) === String(P[x]); });
  }

  function renderPlate(C) {
    var box = $("plateBox");
    if (!C.plate || !C.used.length) { box.hidden = true; $("plate").innerHTML = ""; return; }
    box.hidden = false;
    var dim = NA.PLATES[state.lay], R = dim[0], Cc = dim[1];
    var at = {};
    C.used.forEach(function (s) { if (s.well) at[s.well.r + "," + s.well.c] = s; });
    var h = ['<span class="na-pl-h"></span>'];
    for (var c = 0; c < Cc; c++) h.push('<span class="na-pl-h">' + (c + 1) + "</span>");
    for (var r = 0; r < R; r++) {
      h.push('<span class="na-pl-h">' + "ABCDEFGHIJKLMNOP"[r] + "</span>");
      for (c = 0; c < Cc; c++) {
        var s = at[r + "," + c];
        if (!s) { h.push('<span class="na-w is-empty"></span>'); continue; }
        var st = s.res.status, pur = s.p280.c === "r" || s.p230.c === "r" ? " pur-r" : s.p280.c === "y" || s.p230.c === "y" ? " pur-y" : "";
        h.push('<button type="button" class="na-w is-' + st + pur + (state.done[s.key] ? " is-done" : "") + '" data-k="' + esc(s.key) + '" title="' + esc(NA.wellName(r, c) + " · " + s.key + " · " + vol(s.res.sv) + " µL sample" + (s.res.k > 1 ? " (1:" + s.res.k + ")" : "") + " + " + vol(s.res.water, s.res.sv) + " µL " + shortDil()) + '">' +
          '<span class="na-w-n">' + esc(s.key) + "</span>" + (state.lay === "96" ? '<span class="na-w-v">' + vol(s.res.sv) + (s.res.k > 1 ? "*" : "") + " / " + vol(s.res.water, s.res.sv) + "</span>" : "") + "</button>");
      }
    }
    $("plate").style.setProperty("--nc", Cc);
    $("plate").className = "na-plate-grid is-" + state.lay;
    $("plate").innerHTML = h.join("");
    $("plateSub").textContent = state.lay === "96" ? "· SAMPLE / " + shortDil().toUpperCase() + " µL · * = PRE-DILUTED" : "· HOVER A WELL FOR VOLUMES";
  }

  function names(list) {
    var n = list.map(function (s) { return s.key; });
    return esc(n.length > 4 ? n.slice(0, 4).join(", ") + " and " + (n.length - 4) + " more" : n.join(", "));
  }
  function renderNotes(C, cnt) {
    var o = C.o, N = [];
    if (!o.ok || !C.used.length) { $("notes").innerHTML = ""; return; }
    var by = function (fn) { return C.samples.filter(function (s) { return !s.skip && fn(s); }); };
    var dil = by(function (s) { return s.res.status === "dilute"; });
    if (dil.length) {
      N.push('<li class="note"><b>Too dilute for ' + esc(targetSay(o)) + ":</b> " + names(dil) + ". The sheet uses all " + LM.fmt(o.vf) + " µL and shows what that gives. " +
        "Lower the amount for every tube" + (C.maxCap ? " (to " + esc(ng(C.maxCap)) + ")" : "") + ", use a larger final volume if your kit allows, or concentrate the sample (ethanol precipitation, vacuum concentrator or a bead clean-up).</li>");
    }
    var pre = by(function (s) { return s.res.status === "predil"; });
    if (pre.length) N.push('<li class="note info"><b>Pre-dilute first:</b> ' + names(pre) + ". Under " + LM.fmt(o.minVol) + " µL is too little to pipette reliably, so dilute in " + esc(state.dil.toLowerCase()) + " as shown under each name, mix and spin down, then add the volume on the sheet.</li>");
    var small = by(function (s) { return s.res.status === "small"; });
    if (small.length) N.push('<li class="note"><b>Under ' + LM.fmt(o.minVol) + " µL:</b> " + names(small) + ". Tick <i>Suggest a pre-dilution</i> above, or use a P2 you trust.</li>");
    var low280 = by(function (s) { return s.p280.c === "r" && s.r280 < (state.limits[s.kind === "RNA" ? "RNA" : "DNA"].g280[0]); });
    if (low280.length) N.push('<li class="note"><b>Low 260/280:</b> ' + names(low280) + ". Protein or phenol carry-over. Phenol also absorbs near 260–270 nm, so the concentration may read high. A column clean-up or another chloroform step helps; a dye assay (Qubit) gives a concentration that phenol doesn't inflate.</li>");
    var hi280 = by(function (s) { return s.p280.c !== "g" && s.p280.c !== "q" && s.p280.c !== "n" && s.kind !== "RNA" && s.r280 > state.limits.DNA.g280[1]; });
    if (hi280.length) N.push('<li class="note info"><b>High 260/280 in DNA:</b> ' + names(hi280) + ". Usually RNA in the prep, which also inflates an absorbance concentration. Treat with RNase A, or normalize on a dsDNA dye assay.</li>");
    var low230 = by(function (s) { return s.p230.c === "r"; });
    if (low230.length) N.push('<li class="note"><b>Low 260/230:</b> ' + names(low230) + ". Guanidine salt from the lysis or binding buffer, phenol (TRIzol), EDTA or carbohydrate. An extra wash with 80% ethanol on the column, or re-precipitation, usually fixes it. Guanidine can inhibit reverse transcriptase and PCR at high carry-over.</li>");
    var q = by(function (s) { return s.p280.c === "q" || s.p230.c === "q"; });
    if (q.length) N.push('<li class="note info"><b>Under ' + NA.LOW_CONC + " ng/µL:</b> " + names(q) + ". At this level a small error in the blank moves the ratios a lot, so they are shown grey rather than judged.</li>");
    var cv = by(function (s) { return s.cv != null && s.cv > 10; });
    if (cv.length) N.push('<li class="note"><b>Readings disagree:</b> ' + cv.map(function (s) { return esc(s.key) + " (CV " + LM.fmt(s.cv, 2) + "%)"; }).join(", ") + ". Flick-mix, spin down and measure again.</li>");
    var off = by(function (s) { return s.res.status !== "dilute" && s.res.gives != null && Math.abs(s.res.err) >= 3; });
    if (off.length) N.push('<li class="note info"><b>Rounding:</b> ' + names(off) + " end up 3% or more off the target. Round to a finer step above, or pre-dilute.</li>");
    var prot = by(function (s) { return s.kind === "protein"; });
    if (prot.length) N.push('<li class="note"><b>Protein readings?</b> ' + names(prot) + " look like an A280 protein measurement, not nucleic acid. For protein, use the Protein Loading calculator.</li>");
    if (C.unknownType) N.push('<li class="note info">The file doesn\'t say whether these are DNA or RNA; purity is judged as <b>' + (state.guess || "DNA") + "</b>. Choose DNA or RNA in box 1 to change it.</li>");
    if (!C.samples.some(function (s) { return s.r280 != null || s.r230 != null; })) N.push('<li class="note info">No 260/280 or 260/230 in this data' + (/Qubit/.test(C.p.format) ? " — a Qubit reads one dye, so it has no purity ratios. Check purity on a NanoDrop if it matters for the next step." : ".") + "</li>");
    var ext = C.used.length - (C.plate ? C.used.filter(function (s) { return s.well; }).length : C.used.length);
    if (ext > 0) N.push('<li class="note"><b>' + ext + " sample" + (ext === 1 ? " doesn't" : "s don't") + " fit</b> on the plate from " + esc(state.start) + ".</li>");
    $("notes").innerHTML = N.join("");
  }

  function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function renderPrintHead(C) {
    var o = C.o;
    $("printHead").innerHTML = '<div class="na-ph-top"><span>LABMATE.TOOLS · DNA/RNA NORMALIZATION</span><span>' + today() + (state.who ? " · " + esc(state.who) : "") + "</span></div>" +
      "<h3>" + esc(state.title || "Normalization sheet") + "</h3>" +
      '<p class="na-ph-line">' + (o.ok ? "<b>" + esc(targetSay(o)) + "</b> per " + (C.plate ? "well" : "tube") + " · make up with <b>" + esc(state.dil.toLowerCase()) + "</b> · " : "") +
      "add the " + esc(shortDil()) + " first, then the sample · tick each " + (C.plate ? "well" : "tube") + " as you go</p>" +
      '<p class="na-ph-key"><span class="na-pur is-g">G</span> pure <span class="na-pur is-y">A</span> check <span class="na-pur is-r">R</span> likely contaminated <span class="na-pur is-q">·</span> too dilute to judge</p>';
  }

  // ---------- exports ----------
  function tableRows(plain) {
    var C = last, o = C.o, u = plain ? "uL" : "µL";
    var head = [C.plate ? "Well" : "#", "Sample", "Type", "ng/" + u, "260/280", "260/230", "Pre-dilution", "Sample (" + u + ")", shortDil() + " (" + u + ")", "Total (" + u + ")", "Gives (ng)", "Status", "Note"];
    var rows = [];
    C.samples.forEach(function (s) {
      if (s.skip) return;
      var r = s.res;
      var pre = r.pre ? "1:" + r.k + " (" + LM.fmtPlain(r.pre.sample) + " + " + LM.fmtPlain(r.pre.diluent) + " " + u + ")" : "";
      var why = [];
      if (s.p280.c !== "g" && s.p280.why) why.push("260/280 " + s.p280.why);
      if (s.p230.c !== "g" && s.p230.why) why.push("260/230 " + s.p230.why);
      if (r.status === "nodata") why.unshift(s.note || "no concentration");
      rows.push({ cells: [s.pos || "", s.key, s.kind, s.conc != null ? round(s.conc, 2) : "", s.r280 != null ? round(s.r280, 2) : "", s.r230 != null ? round(s.r230, 2) : "", pre,
        r.sv != null ? r.sv : "", r.water != null ? r.water : "", r.sv != null ? round(r.sv + r.water, 4) : "", r.gives != null ? round(r.gives, 1) : "",
        { ok: "OK", predil: "PRE-DILUTE", dilute: "TOO DILUTE", small: "UNDER MIN VOLUME", nodata: "NO VALUE" }[r.status] || "", why.join("; ")], s: s });
    });
    return { head: head, rows: rows, meta: [
      ["DNA/RNA normalization — labmate.tools"],
      [state.title ? state.title : "", today() + (state.who ? " · " + state.who : "")],
      ["Target", targetSay(o, plain) + " per " + (C.plate ? "well" : "tube"), "Make up with", state.dil, "Smallest volume", LM.fmtPlain(o.minVol) + " " + u],
      ["Add the " + shortDil() + " first, then the sample."]
    ] };
  }
  function round(x, d) { var p = Math.pow(10, d); return Math.round(x * p) / p; }
  function fileBase() {
    var t = (state.title || "normalization").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "normalization";
    return t + "-" + today();
  }
  function download(name, data, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    say("SAVED " + name);
  }
  function say(t) { $("copied").textContent = t; clearTimeout(say.t); say.t = setTimeout(function () { $("copied").textContent = ""; }, 3000); }

  function doCopy() {
    var T = tableRows(true);
    var text = T.meta.map(function (r) { return r.filter(Boolean).join("  "); }).join("\n") + "\n\n" + NA.tsv([T.head].concat(T.rows.map(function (r) { return r.cells; })));
    LM.copy(text, function (ok) { say(ok ? "COPIED ✓ — pastes into Excel or your notebook" : "Copy failed"); });
  }
  function doCsv() {
    var T = tableRows(false);
    download(fileBase() + ".csv", "﻿" + NA.csv(T.meta.concat([[]], [T.head], T.rows.map(function (r) { return r.cells; }))), "text/csv;charset=utf-8");
  }
  function doXlsx() {
    var T = tableRows(false), S = NA.STYLE;
    var sheet = [];
    sheet.push([{ v: T.meta[0][0], s: S.title }]);
    sheet.push([{ v: state.title || "", s: S.bold }, "", "", "", "", "", "", "", "", "", "", { v: T.meta[1][1], s: S.note }]);
    sheet.push([{ v: "Target", s: S.note }, T.meta[2][1], "", { v: "Make up with", s: S.note }, state.dil, "", { v: "Smallest volume", s: S.note }, T.meta[2][5]]);
    sheet.push([{ v: T.meta[3][0], s: S.note }]);
    sheet.push([]);
    sheet.push(["Done"].concat(T.head).map(function (h) { return { v: h, s: S.head }; }));
    var colour = { g: S.g, y: S.y, r: S.r };
    T.rows.forEach(function (r) {
      var c = r.cells.slice(), s = r.s;
      var row = ["☐"].concat(c.map(function (v, i) {
        if (i === 4 && v !== "") return { v: v, s: colour[s.p280.c] || S.num };
        if (i === 5 && v !== "") return { v: v, s: colour[s.p230.c] || S.num };
        if ((i === 7 || i === 8) && v !== "") return { v: v, s: S.bold };
        if ((i === 3 || i === 9) && v !== "") return { v: v, s: S.num };
        if (i === 11 && v && v !== "OK") return { v: v, s: v === "PRE-DILUTE" ? S.y : S.r };
        return v;
      }));
      sheet.push(row);
    });
    var totW = 0;
    T.rows.forEach(function (r) { if (typeof r.cells[8] === "number") totW += r.cells[8]; if (r.s.res.pre) totW += r.s.res.pre.diluent; });
    sheet.push([]);
    sheet.push(["", "", { v: shortDil() + " in all (µL, incl. pre-dilutions)", s: S.note }, "", "", "", "", "", "", { v: round(totW, 2), s: S.bold }, { v: "+10%: " + LM.fmtPlain(totW * 1.1, 4), s: S.note }]);
    var sheets = [{ name: "Normalization", rows: sheet, widths: [6, 7, 18, 7, 10, 9, 9, 18, 12, 12, 11, 11, 14, 40], freeze: 6, print: true }];
    if (last.plate) {
      var dim = NA.PLATES[state.lay], R = dim[0], Cc = dim[1], grid = function (title, fn) {
        var out = [[{ v: title, s: S.bold }], [""].concat(Array.from({ length: Cc }, function (_, i) { return { v: i + 1, s: S.head }; }))];
        for (var r = 0; r < R; r++) {
          var line = [{ v: "ABCDEFGHIJKLMNOP"[r], s: S.head }];
          for (var c = 0; c < Cc; c++) { var s = cellAt(r, c); line.push(s ? fn(s) : ""); }
          out.push(line);
        }
        return out.concat([[]]);
      };
      var cellAt = function (r, c) { for (var i = 0; i < last.used.length; i++) { var w = last.used[i].well; if (w && w.r === r && w.c === c) return last.used[i]; } return null; };
      var rowsP = grid("Samples", function (s) { return s.key; })
        .concat(grid("Sample µL", function (s) { return { v: s.res.sv, s: s.res.k > 1 ? S.y : S.num }; }))
        .concat(grid(shortDil() + " µL", function (s) { return { v: s.res.water, s: S.num }; }));
      sheets.push({ name: "Plate map", rows: rowsP, widths: [4].concat(Array.from({ length: Cc }, function () { return state.lay === "384" ? 7 : 11; })), print: true });
    }
    download(fileBase() + ".xlsx", new Blob([NA.xlsx(sheets)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }
  // source: the file's well column, else A1, B1… (or A1, A2…); destination: the plate map, else A1, B1… of a rack
  function robotItems() {
    var C = last, n = C.used.length, big = n > 96 ? "384" : "96";
    var srcW = NA.wells(n, big, state.srcOrder === "row" ? "row" : "col", "A1", false);
    var rack = NA.wells(n, big, "col", "A1", false);
    var idx = function (w, plate) { var p = NA.parseWell(w); return p ? p[1] * NA.PLATES[plate][0] + p[0] + 1 : ""; };
    var items = [];
    C.used.forEach(function (s, i) {
      if (s.res.sv == null) return;
      var src = state.srcOrder === "file" && s.filePos ? s.filePos : srcW[i] ? srcW[i].well : "";
      var dest = C.plate ? (s.well ? s.well.well : "") : rack[i] ? rack[i].well : "";
      items.push({ name: s.key, src: src, dest: dest, srcPos: idx(src, big), destPos: idx(dest, C.plate ? state.lay : big), sv: s.res.sv, water: s.res.water, k: s.res.k });
    });
    return items;
  }
  function doWorklist() {
    var rows = [["Sample", "SourceLabware", "SourceWell", "DestLabware", "DestWell", "SampleVolume_uL", "DiluentVolume_uL", "PreDilution"]];
    robotItems().forEach(function (it) { rows.push([it.name, "Source", it.src, "Destination", it.dest, it.sv, it.water, it.k > 1 ? "1:" + it.k : ""]); });
    download(fileBase() + "-worklist.csv", NA.csv(rows), "text/csv;charset=utf-8");
  }
  function doGwl() { download(fileBase() + ".gwl", NA.gwl(robotItems()), "text/plain"); }

  // ---------- inputs → state ----------
  function setTargetNg(x) {
    state.preset = "";
    if (state.mode === "conc") state.target = LM.fmtPlain(x / LM.parse(state.vf), 3);
    else if (x >= 1000 && state.amountUnit === "µg") state.amount = LM.fmtPlain(x / 1000, 3);
    else { state.amountUnit = "ng"; state.amount = LM.fmtPlain(x, 4); }
    fillInputs(); render();
  }
  function fillInputs() {
    $("src").value = state.src;
    $("amount").value = state.amount; $("amountUnit").value = state.amountUnit; $("target").value = state.target;
    $("vf").value = state.vf; $("minv").value = state.minv; $("dil").value = state.dil;
    $("predil").checked = state.predil; $("merge").checked = state.merge; $("step").value = state.step;
    $("startWell").value = state.start; $("skipEdge").checked = state.skipEdge;
    $("title").value = state.title; $("who").value = state.who; $("srcOrder").value = state.srcOrder;
    document.querySelectorAll("[data-l]").forEach(function (inp) { inp.value = getL(inp.dataset.l); });
    $("exChips").querySelectorAll(".chip").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.ex === state.example)); });
  }
  function syncSegs() {
    [["typeSeg", "type"], ["modeSeg", "mode"], ["laySeg", "lay"], ["ordSeg", "ord"]].forEach(function (p) {
      $(p[0]).querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === state[p[1]])); });
    });
  }
  function getL(path) { var o = state.limits; path.split(".").forEach(function (k) { o = o == null ? null : o[k]; }); return o == null ? "" : String(o); }
  function setL(path, v) {
    var ks = path.split("."), o = state.limits;
    for (var i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = v;
  }

  $("src").addEventListener("input", function () { state.src = $("src").value; state.example = ""; state.out = []; $("exChips").querySelectorAll(".chip").forEach(function (b) { b.setAttribute("aria-pressed", "false"); }); render(); });
  [["amount", "amount"], ["target", "target"], ["vf", "vf"], ["minv", "minv"], ["title", "title"], ["who", "who"]].forEach(function (p) {
    $(p[0]).addEventListener("input", function () { state[p[1]] = $(p[0]).value; if (p[0] !== "title" && p[0] !== "who") state.preset = ""; render(); });
  });
  $("startWell").addEventListener("input", function () { var w = $("startWell").value.trim().toUpperCase(); if (NA.parseWell(w)) { state.start = w; render(); } });
  [["amountUnit", "amountUnit"], ["dil", "dil"], ["step", "step"], ["srcOrder", "srcOrder"]].forEach(function (p) {
    $(p[0]).addEventListener("change", function () { state[p[1]] = $(p[0]).value; render(); });
  });
  [["predil", "predil"], ["merge", "merge"], ["skipEdge", "skipEdge"]].forEach(function (p) {
    $(p[0]).addEventListener("change", function () { state[p[1]] = $(p[0]).checked; render(); });
  });
  [["typeSeg", "type"], ["modeSeg", "mode"], ["laySeg", "lay"], ["ordSeg", "ord"]].forEach(function (p) {
    $(p[0]).addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (p[1] === "mode" && b.dataset.v !== state.mode) {
        // carry the amount over: ng ↔ ng/µL
        var o = opts();
        if (o.vf > 0) {
          if (b.dataset.v === "conc" && o.amount > 0) state.target = LM.fmtPlain(o.amount / o.vf, 3);
          if (b.dataset.v === "mass" && o.target > 0) { var m = o.target * o.vf; if (m >= 1000) { state.amountUnit = "µg"; state.amount = LM.fmtPlain(m / 1000, 3); } else { state.amountUnit = "ng"; state.amount = LM.fmtPlain(m, 4); } }
        }
        state.preset = "";
      }
      state[p[1]] = b.dataset.v;
      fillInputs(); render();
    });
  });
  $("presets").addEventListener("click", function (e) {
    var b = e.target.closest(".chip"); if (!b) return;
    var P = PRESETS[b.dataset.p];
    Object.keys(P).forEach(function (k) { if (k !== "type") state[k] = P[k]; });
    state.guess = P.type; state.preset = b.dataset.p;
    fillInputs(); render();
  });
  $("exChips").addEventListener("click", function (e) {
    var b = e.target.closest(".chip"); if (!b) return;
    var X = EX[b.dataset.ex];
    state.src = X.src(); state.example = b.dataset.ex; state.out = []; state.done = {}; state.type = X.type;
    var P = PRESETS[X.preset];
    Object.keys(P).forEach(function (k) { if (k !== "type") state[k] = P[k]; });
    state.guess = P.type; state.preset = X.preset;
    fillInputs(); render();
  });
  $("limitsBox").addEventListener("input", function (e) {
    var inp = e.target.closest("[data-l]"); if (!inp) return;
    var v = LM.parse(inp.value);
    inp.classList.toggle("is-bad", !(v > 0));
    if (v > 0) { setL(inp.dataset.l, v); render(); }
  });
  $("limitsReset").addEventListener("click", function () { state.limits = clone(NA.LIMITS); fillInputs(); render(); });

  // sheet interactions
  $("rows").addEventListener("change", function (e) {
    var t = e.target.closest(".na-tick"); if (!t) return;
    var k = t.closest("tr").dataset.k;
    if (t.checked) state.done[k] = true; else delete state.done[k];
    render();
  });
  $("rows").addEventListener("click", function (e) {
    var x = e.target.closest(".mm-x"); if (!x) return;
    state.out.push(x.closest("tr").dataset.k); render();
  });
  $("leftOut").addEventListener("click", function (e) {
    var b = e.target.closest(".na-back"); if (!b) return;
    state.out = state.out.filter(function (k) { return k !== b.dataset.k; }); render();
  });
  $("plate").addEventListener("click", function (e) {
    var w = e.target.closest(".na-w[data-k]"); if (!w) return;
    var k = w.dataset.k;
    if (state.done[k]) delete state.done[k]; else state.done[k] = true;
    render();
  });
  $("clear").addEventListener("click", function () {
    var keep = { limits: state.limits, dil: state.dil, minv: state.minv, step: state.step, lay: state.lay, ord: state.ord, who: state.who };
    state = Object.assign(clone(DEFAULTS), keep, { src: "", example: "", preset: "" });
    fillInputs(); render(); $("src").focus();
  });

  $("print").addEventListener("click", function () { window.print(); });
  $("copy").addEventListener("click", doCopy);
  $("csv").addEventListener("click", doCsv);
  $("xlsx").addEventListener("click", doXlsx);
  $("worklist").addEventListener("click", doWorklist);
  $("gwl").addEventListener("click", doGwl);
  $("toMix").addEventListener("click", function () {
    var n = last.used.length;
    if (!window.LMH) { location.href = "../master-mix/"; return; }
    LMH.send("master-mix", { reactions: n, note: n + " samples from DNA/RNA Normalization" }, "../master-mix/");
  });
  $("toLabels").addEventListener("click", function () {
    var ids = last.used.map(function (s) { return s.key; });
    if (!window.LMH) { location.href = "../cryo-labels/"; return; }
    LMH.send("cryo-labels", { ids: ids, from: "DNA/RNA Normalization" }, "../cryo-labels/");
  });

  // ---------- files ----------
  function decode(u) {
    var enc = "utf-8", start = 0;
    if (u[0] === 0xFF && u[1] === 0xFE) { enc = "utf-16le"; start = 2; }
    else if (u[0] === 0xFE && u[1] === 0xFF) { enc = "utf-16be"; start = 2; }
    else if (u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF) start = 3;
    else if (u.length > 4 && u[1] === 0 && u[3] === 0 && u[0] !== 0) enc = "utf-16le";
    try { return new TextDecoder(enc, { fatal: enc === "utf-8" }).decode(u.subarray(start)); }
    catch (e) { return new TextDecoder("windows-1252").decode(u.subarray(start)); }
  }
  function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("This browser can't open .xlsx files — save the export as CSV or text, or copy the cells and paste them."));
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function unzip(u) {
    var dv = new DataView(u.buffer, u.byteOffset, u.byteLength), eocd = -1, files = {};
    for (var i = u.length - 22; i >= Math.max(0, u.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("Not a readable .xlsx file.");
    var n = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true);
    for (var k = 0; k < n; k++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      var method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
      var nlen = dv.getUint16(off + 28, true), xlen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true), lho = dv.getUint32(off + 42, true);
      var name = new TextDecoder().decode(u.subarray(off + 46, off + 46 + nlen));
      var dstart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      (function (method, data) { files[name] = function () { return method === 0 ? Promise.resolve(data) : method === 8 ? inflateRaw(data) : Promise.reject(new Error("Unsupported .xlsx compression.")); }; })(method, u.subarray(dstart, dstart + csize));
      off += 46 + nlen + xlen + clen;
    }
    return files;
  }
  function xmlDoc(b) { return new DOMParser().parseFromString(new TextDecoder().decode(b), "application/xml"); }
  function kids(el, name) { var out = []; if (!el) return out; for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) out.push(c); return out; }
  function readXlsx(files) { // → grid of the first sheet with cells
    var get = function (p) { return files[p] ? files[p]() : Promise.resolve(null); };
    return Promise.all([get("xl/workbook.xml"), get("xl/_rels/workbook.xml.rels"), get("xl/sharedStrings.xml")]).then(function (r) {
      if (!r[0]) throw new Error("No worksheet found in this .xlsx file.");
      var ss = [];
      if (r[2]) kids(xmlDoc(r[2]).documentElement, "si").forEach(function (si) {
        var t = si.getElementsByTagNameNS("*", "t"), s = "";
        for (var i = 0; i < t.length; i++) if (t[i].parentNode.localName !== "rPh") s += t[i].textContent;
        ss.push(s);
      });
      var rel = {};
      if (r[1]) kids(xmlDoc(r[1]).documentElement, "Relationship").forEach(function (x) { rel[x.getAttribute("Id")] = x.getAttribute("Target"); });
      var wb = xmlDoc(r[0]), sheetsEl = kids(wb.documentElement, "sheets")[0];
      var paths = kids(sheetsEl, "sheet").map(function (sh, i) {
        var rid = sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || sh.getAttribute("r:id");
        return "xl/" + String(rel[rid] || "worksheets/sheet" + (i + 1) + ".xml").replace(/^\/?xl\//, "").replace(/^\//, "");
      });
      return Promise.all(paths.map(get)).then(function (bs) {
        for (var b = 0; b < bs.length; b++) {
          if (!bs[b]) continue;
          var doc = xmlDoc(bs[b]), rows = doc.getElementsByTagNameNS("*", "row"), grid = [];
          for (var i = 0; i < rows.length; i++) {
            var line = [];
            kids(rows[i], "c").forEach(function (c, ci) {
              var ref = c.getAttribute("r"), col = ci;
              if (ref) { var m = /^([A-Z]+)/.exec(ref), v = 0; for (var j = 0; j < m[1].length; j++) v = v * 26 + m[1].charCodeAt(j) - 64; col = v - 1; }
              var t = c.getAttribute("t"), vEl = kids(c, "v")[0], val;
              if (t === "s") val = ss[+(vEl ? vEl.textContent : 0)] || "";
              else if (t === "inlineStr") val = (kids(c, "is")[0] || {}).textContent || "";
              else val = vEl ? vEl.textContent : "";
              line[col] = String(val).trim();
            });
            for (var q = 0; q < line.length; q++) if (line[q] == null) line[q] = "";
            grid.push(line);
          }
          if (grid.some(function (l) { return l.join("") !== ""; })) return grid;
        }
        throw new Error("The workbook is empty.");
      });
    });
  }
  function openFile(file) {
    if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      var u = new Uint8Array(rd.result);
      var done = function (text) { state.src = text; state.example = ""; state.out = []; state.done = {}; fillInputs(); render(); say("OPENED " + file.name); };
      if (u[0] === 0x50 && u[1] === 0x4B) {
        Promise.resolve().then(function () { return readXlsx(unzip(u)); })
          .then(function (grid) { done(grid.map(function (r) { return r.join("\t"); }).join("\n")); })
          .catch(function (e) { $("readInfo").innerHTML = '<p class="na-warn">' + esc(e.message || String(e)) + "</p>"; });
      } else if (u[0] === 0xD0 && u[1] === 0xCF) {
        $("readInfo").innerHTML = '<p class="na-warn">Old Excel .xls format — save it as .xlsx or .csv, or copy the cells and paste them.</p>';
      } else done(decode(u));
    };
    rd.readAsArrayBuffer(file);
  }
  $("openBtn").addEventListener("click", function () { $("file").click(); });
  $("file").addEventListener("change", function () { openFile($("file").files[0]); $("file").value = ""; });
  var drop = $("drop");
  ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0) { e.preventDefault(); drop.classList.add("is-over"); } }); });
  ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove("is-over"); }); });
  drop.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); openFile(e.dataTransfer.files[0]); } });

  window.LMT_NA_TEST = { get last() { return last; }, state: function () { return state; } };
  fillInputs();
  render();
})();
