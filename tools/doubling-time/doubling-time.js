// labmate.tools — 5.4 Doubling Time & Growth Rate
(function () {
  "use strict";
  var LM = window.LM;
  var KEY = "labmate.doublingTime.v1";
  var ALGO = "labmate-dt-1";
  var MAX_ROWS = 300;
  var LN2 = Math.LN2;
  var $ = function (id) { return document.getElementById(id); };

  var EXAMPLE = {
    time: "interval", unit: "h", basis: "total", example: true,
    rows: [
      { name: "HEK293 · P14", n0: "2e5", n1: "1.6e6", split: "", t: "72", t0: "", t1: "", note: "T25, 10% FBS" },
      { name: "HEK293 · P15", n0: "2.5e5", n1: "1.8e6", split: "", t: "70", t0: "", t1: "", note: "new FBS lot" },
      { name: "MSC donor 2 · P4", n0: "1.5e5", n1: "3.1e5", split: "", t: "72", t0: "", t1: "", note: "T75" },
      { name: "MSC donor 2 · P5", n0: "1.5e5", n1: "2.6e5", split: "", t: "72", t0: "", t1: "", note: "" },
      { name: "Jurkat · flask 3", n0: "3e5", n1: "4.2e5", split: "4", t: "48", t0: "", t1: "", note: "split 1:4 at 24 h" }
    ]
  };
  function blankRow() { return { name: "", n0: "", n1: "", split: "", t: "", t0: "", t1: "", note: "" }; }

  var state = LM.load(KEY);
  if (!state || !Array.isArray(state.rows)) state = JSON.parse(JSON.stringify(EXAMPLE));
  if (!state.rows.length) state.rows.push(blankRow());
  var sel = 0;          // row whose working is shown
  var results = [];     // computed per row
  var groups = [];

  // ---------- formatting ----------
  function sup(n) { return String(n).split("").map(function (c) { return { "-": "⁻" }[c] || "⁰¹²³⁴⁵⁶⁷⁸⁹"[+c]; }).join(""); }
  function cells(x) {
    if (!isFinite(x)) return "—";
    if (x < 1e4) return LM.fmt(x, 4);
    var e = Math.floor(Math.log10(x)), m = x / Math.pow(10, e);
    if (+m.toFixed(3) >= 10) { e++; m /= 10; }
    return LM.fmt(m, 4) + " × 10" + sup(e);
  }
  function cellsPlain(x) { return !isFinite(x) ? "" : (x < 1e4 ? LM.fmtPlain(x, 6) : x.toExponential(3).replace(/\.?0+e/, "e").replace("e+", "e")); }
  function f(x, sig) { return LM.fmt(x, sig); }
  function fp(x, sig) { return LM.fmtPlain(x, sig); }
  function hrs(h) { // "24 h" or "68.8 h (2.87 d)"
    if (!isFinite(h)) return "—";
    return f(h, 3) + " h" + (h >= 48 ? ' <small>(' + f(h / 24, 3) + " d)</small>" : "");
  }
  var esc = LM.esc;

  // ---------- time helpers ----------
  function unitH() { return state.unit === "d" ? 24 : 1; }
  function parseDT(s) { // "2026-11-10T09:30" (local) → ms, or null
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(String(s).trim());
    if (!m) return NaN;
    var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    return isNaN(d.getTime()) ? NaN : d.getTime();
  }
  function toLocalDT(ms) {
    var d = new Date(ms), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function datesHours(r) { // hours from start/end time, null if not both, NaN if bad
    var a = parseDT(r.t0), b = parseDT(r.t1);
    if (a == null || b == null) return null;
    if (isNaN(a) || isNaN(b)) return NaN;
    return (b - a) / 3.6e6;
  }

  // ---------- the arithmetic ----------
  function compute(r, i) {
    var o = { i: i, name: r.name.trim(), bad: {}, flags: [], empty: false };
    if (!r.name.trim() && !r.n0.trim() && !r.n1.trim() && !String(r.t).trim() && !r.t0 && !r.t1 && !r.split.trim()) { o.empty = true; return o; }
    var n0 = LM.parse(r.n0), n1 = LM.parse(r.n1), s = LM.parse(r.split);
    if (n0 == null) o.bad.n0 = "missing"; else if (isNaN(n0) || n0 <= 0) o.bad.n0 = "above 0";
    if (n1 == null) o.bad.n1 = "missing"; else if (isNaN(n1) || n1 <= 0) o.bad.n1 = "above 0";
    if (s == null) s = 1; else if (isNaN(s) || s < 1) { o.bad.split = "1 or more"; }
    var h = null, fromDates = false;
    var dh = datesHours(r);
    if (dh !== null) {
      fromDates = true;
      if (isNaN(dh)) o.bad.t0 = o.bad.t1 = "date?";
      else if (dh <= 0) o.bad.t1 = "after start";
      else h = dh;
    } else {
      var tv = LM.parse(r.t);
      if (tv == null) o.bad.t = "missing";
      else if (isNaN(tv) || tv <= 0) o.bad.t = "above 0";
      else h = tv * unitH();
    }
    o.fromDates = fromDates;
    if (Object.keys(o.bad).length) { o.err = true; return o; }
    o.n0 = n0; o.n1 = n1; o.s = s; o.h = h;
    o.fold = n1 * s / n0;
    o.lnf = Math.log(o.fold);
    o.pd = o.lnf / LN2;
    o.mu = o.lnf / h;            // per hour
    o.pdph = o.pd / h;           // doublings per hour (not μ)
    if (o.fold > 1) {
      o.dt = h * LN2 / o.lnf;
      // if each count is off by 10% in the unlucky directions
      var fl = (n1 * 0.9 * s) / (n0 * 1.1), fh = (n1 * 1.1 * s) / (n0 * 0.9);
      o.dtHi = fl > 1 ? h * LN2 / Math.log(fl) : Infinity;
      o.dtLo = h * LN2 / Math.log(fh);
    } else o.dt = NaN;
    // flags
    if (o.fold <= 1) o.flags.push(["NO NET GROWTH", "warn", "The end count is not above the start count, so there is no doubling time. Doublings and μ are shown as they are" + (o.fold < 1 ? " (negative)" : "") + "."]);
    else if (o.fold < 1.5) o.flags.push(["SMALL CHANGE", "warn", "Less than 1.5-fold: a 10% counting error moves the doubling time a lot (see the range)."]);
    if (h < 12) o.flags.push(["SHORT INTERVAL", "warn", "Under 12 h between counts — counting error dominates."]);
    if (h > 168) o.flags.push(["LONG INTERVAL", "info", "Over 7 days — likely to include lag or plateau. Check the cells stayed sub-confluent and fed."]);
    if (o.dt < 10) o.flags.push(["VERY FAST", "warn", "Doubling time under 10 h is faster than nearly all mammalian lines — check the counts and the time unit."]);
    if (s > 1) o.flags.push(["SPLIT ×" + fp(s, 4), "info", "End count multiplied by " + fp(s, 4) + " for the split. Assumes the split was exact and no cells were lost."]);
    return o;
  }

  // "HEK293 · P14" and "HEK293 P15" belong to the same line: a trailing passage number is ignored
  function lineName(n) {
    return n.replace(/[\s·,;:\/\-–_]*(?:p|p\.|passage)\s*\d+\s*$/i, "").replace(/[\s·,;:\/\-–_]+$/, "").replace(/\s+/g, " ").trim() || n.trim();
  }
  function groupRows() {
    var map = {}, out = [];
    results.forEach(function (o) {
      if (o.empty || o.err || !o.name) return;
      var base = lineName(o.name), k = base.toLowerCase();
      if (!map[k]) { map[k] = { name: base, rows: [], h: 0, lnf: 0, pd: 0, dts: [] }; out.push(map[k]); }
      var g = map[k];
      g.rows.push(o.i + 1); g.h += o.h; g.lnf += o.lnf; g.pd += o.pd;
      if (isFinite(o.dt)) g.dts.push(o.dt);
    });
    out.forEach(function (g) { g.dt = g.lnf > 0 ? g.h * LN2 / g.lnf : NaN; g.mu = g.lnf / g.h; });
    return out.filter(function (g) { return g.rows.length > 1; });
  }

  // ---------- input table ----------
  var COLS = ["name", "n0", "n1", "split", "t0", "t1", "t", "note"];
  function inRow(r, i) {
    var inp = function (k, cls, extra) {
      return '<input class="pp-in ' + cls + '" data-k="' + k + '" value="' + esc(r[k] || "") + '" autocomplete="off" spellcheck="false"' + (extra || "") + ">";
    };
    return '<tr data-i="' + i + '">' +
      '<td class="i">' + (i + 1) + "</td>" +
      '<td class="nm" data-l="CELL LINE / BATCH">' + inp("name", "pp-name", ' aria-label="Row ' + (i + 1) + ' cell line or batch" placeholder="name"') + "</td>" +
      '<td class="c" data-l="START N₀">' + inp("n0", "dt-num", ' inputmode="decimal" aria-label="Row ' + (i + 1) + ' start count" placeholder="2e5"') + "</td>" +
      '<td class="c" data-l="END N">' + inp("n1", "dt-num", ' inputmode="decimal" aria-label="Row ' + (i + 1) + ' end count" placeholder="8e5"') + "</td>" +
      '<td class="sp" data-l="SPLIT ×">' + inp("split", "dt-num", ' inputmode="decimal" aria-label="Row ' + (i + 1) + ' split factor" placeholder="–"') + "</td>" +
      '<td class="dt dt-date" data-l="START TIME"><input class="pp-in dt-when" type="datetime-local" data-k="t0" value="' + esc(r.t0 || "") + '" aria-label="Row ' + (i + 1) + ' start time"></td>' +
      '<td class="dt dt-date" data-l="END TIME"><input class="pp-in dt-when" type="datetime-local" data-k="t1" value="' + esc(r.t1 || "") + '" aria-label="Row ' + (i + 1) + ' end time"></td>' +
      '<td class="t" data-l="INTERVAL">' + inp("t", "dt-num", ' inputmode="decimal" aria-label="Row ' + (i + 1) + ' interval" placeholder="48"') + "</td>" +
      '<td class="nt" data-l="NOTE">' + inp("note", "dt-note", ' aria-label="Row ' + (i + 1) + ' note" placeholder="optional"') + "</td>" +
      '<td class="x"><button type="button" class="c-x" data-del="' + i + '" aria-label="Remove row ' + (i + 1) + '">×</button></td></tr>';
  }
  function drawInputs() {
    $("rows").innerHTML = state.rows.map(inRow).join("");
  }

  // ---------- render ----------
  function render() {
    results = state.rows.map(compute);
    groups = groupRows();
    var dates = state.time === "dates";
    document.body.classList.toggle("dt-dates", dates);
    $("tHead").textContent = "INTERVAL " + (state.unit === "d" ? "days" : "h");
    $("basisNote").hidden = state.basis !== "permL";
    $("exampleNote").hidden = !state.example;
    $("rowCount").textContent = state.rows.length + (state.rows.length === 1 ? " ROW" : " ROWS") + (state.rows.length >= MAX_ROWS ? " · MAX" : "");
    $("addRow").disabled = state.rows.length >= MAX_ROWS;

    // input-side marks and computed intervals
    var trs = document.querySelectorAll("#rows tr");
    results.forEach(function (o, i) {
      var tr = trs[i]; if (!tr) return;
      ["n0", "n1", "split", "t", "t0", "t1"].forEach(function (k) {
        var el = tr.querySelector('[data-k="' + k + '"]');
        el.classList.toggle("is-bad", !!o.bad[k]);
        el.title = o.bad[k] ? (o.bad[k] === "missing" ? "Needed" : "Must be " + o.bad[k]) : "";
      });
      var t = tr.querySelector('[data-k="t"]');
      if (o.fromDates && isFinite(o.h)) {
        t.readOnly = true; t.classList.add("is-calc");
        var v = fp(o.h / unitH(), 4);
        if (t.value !== v) t.value = v;
        state.rows[i].t = v;
        t.title = "From the start and end times";
      } else { t.readOnly = false; t.classList.remove("is-calc"); }
    });

    // results table
    var any = false;
    $("outRows").innerHTML = results.map(function (o) {
      if (o.empty) return "";
      var nm = esc(o.name || "row " + (o.i + 1));
      var cls = (o.i === sel ? "is-sel" : "");
      if (o.err) {
        return '<tr class="' + cls + ' is-err" data-i="' + o.i + '" tabindex="0"><td class="i">' + (o.i + 1) + '</td><td class="nm">' + nm +
          '</td><td class="n" colspan="4"><span class="dt-wait">' + esc(firstProblem(o)) + '</span></td><td class="ck"></td></tr>';
      }
      any = true;
      var ck = o.flags.map(function (fl) { return '<span class="pp-flag' + (fl[1] === "info" ? " is-info" : "") + '">' + esc(fl[0]) + "</span>"; }).join(" ");
      return '<tr class="' + cls + '" data-i="' + o.i + '" tabindex="0"><td class="i">' + (o.i + 1) + '</td><td class="nm">' + nm +
        '</td><td class="n" data-l="FOLD">×' + f(o.fold, 3) +
        '</td><td class="n" data-l="DOUBLINGS">' + f(o.pd, 3) +
        '</td><td class="n dtc" data-l="DOUBLING TIME">' + (isFinite(o.dt) ? "<b>" + hrs(o.dt) + "</b>" : "—") +
        '</td><td class="n" data-l="μ /h">' + f(o.mu, 4) +
        '</td><td class="ck">' + (ck || '<span class="dt-ok">✓</span>') + "</td></tr>";
    }).join("") || '<tr><td colspan="7" class="pp-empty">Fill in a row above.</td></tr>';

    // summary per line
    $("sumWrap").hidden = !groups.length;
    $("sumRows").innerHTML = groups.map(function (g) {
      var lo = Math.min.apply(null, g.dts), hi = Math.max.apply(null, g.dts);
      return "<tr><td class=\"nm\">" + esc(g.name) + ' <small class="dt-rows">rows ' + g.rows.join(", ") + "</small></td>" +
        '<td class="n" data-l="ROWS">' + g.rows.length +
        '</td><td class="n" data-l="TOTAL TIME">' + hrs(g.h) +
        '</td><td class="n" data-l="CUMULATIVE DOUBLINGS"><b>' + f(g.pd, 3) +
        '</b></td><td class="n" data-l="OVERALL DT">' + (isFinite(g.dt) ? "<b>" + hrs(g.dt) + "</b>" : "no net growth") +
        '</td><td class="n" data-l="RANGE">' + (g.dts.length > 1 ? f(lo, 3) + "–" + f(hi, 3) + " h" : "—") + "</td></tr>";
    }).join("");

    drawWork();
    drawNotes();
    $("copy").disabled = $("csv").disabled = $("print").disabled = !any;
    $("json").disabled = !state.rows.some(function (r, i) { return !results[i].empty; });
    buildPrint();
    LM.save(KEY, state);
  }

  function firstProblem(o) {
    var names = { n0: "start count", n1: "end count", split: "split", t: "interval", t0: "start time", t1: "end time" };
    var k = Object.keys(o.bad)[0], why = o.bad[k];
    if (why === "missing") return "Needs " + (k === "t" && state.time === "dates" ? "the interval or both times" : "the " + names[k]) + ".";
    if (why === "after start") return "End time must be after the start time.";
    if (why === "date?") return "Check the date and time.";
    return "The " + names[k] + " must be " + why + ".";
  }

  function drawWork() {
    var o = results[sel];
    if (!o || o.empty) { o = results.filter(function (x) { return !x.empty && !x.err; })[0]; if (o) sel = o.i; }
    var box = $("work");
    if (!o || o.err || o.empty) { box.innerHTML = ""; box.hidden = true; return; }
    box.hidden = false;
    var r = state.rows[o.i];
    var head = '<div class="dt-work-h"><span>WORKING · ROW ' + (o.i + 1) + "</span><b>" + esc(o.name || "unnamed") + "</b>" +
      (r.note ? '<span class="dt-work-note">' + esc(r.note) + "</span>" : "") + "</div>";
    var tline = o.fromDates
      ? "t = " + esc(r.t0.replace("T", " ")) + " → " + esc(r.t1.replace("T", " ")) + " = <b>" + f(o.h, 4) + " h</b>"
      : "t = " + esc(r.t) + (state.unit === "d" ? " d × 24 = <b>" + f(o.h, 4) + " h</b>" : " h");
    var L = [
      ["N₀ → N", cells(o.n0) + " → " + cells(o.n1) + (o.s > 1 ? " · split ×" + f(o.s, 4) + " → N × s = " + cells(o.n1 * o.s) : "") + (state.basis === "permL" ? " cells/mL" : " cells")],
      ["interval", tline],
      ["fold", (o.s > 1 ? "N × s ÷ N₀" : "N ÷ N₀") + " = <b>" + f(o.fold, 4) + "</b>"],
      ["doublings", "log₂(" + f(o.fold, 4) + ") = ln(" + f(o.fold, 4) + ") ÷ ln 2 = " + f(o.lnf, 4) + " ÷ 0.6931 = <b>" + f(o.pd, 4) + "</b>"],
      ["doubling time", isFinite(o.dt) ? "t × ln 2 ÷ ln(fold) = " + f(o.h, 4) + " × 0.6931 ÷ " + f(o.lnf, 4) + " = <b>" + f(o.dt, 4) + " h</b>" + (o.dt >= 24 ? " = " + f(o.dt / 24, 4) + " d" : "") : "<b>none</b> — the cells did not increase"],
      ['<span class="mu">μ</span>', "ln(fold) ÷ t = " + f(o.lnf, 4) + " ÷ " + f(o.h, 4) + " h = <b>" + f(o.mu, 4) + " /h</b> = " + f(o.mu * 24, 4) + " /day"],
      ["doublings per hour", f(o.pd, 4) + " ÷ " + f(o.h, 4) + " = " + f(o.pdph, 4) + " /h — <i>not μ</i> (μ = this × ln 2)"]
    ];
    if (isFinite(o.dt)) L.push(["if counts are ±10%", "doubling time between " + f(o.dtLo, 3) + " and " + (isFinite(o.dtHi) ? f(o.dtHi, 3) + " h" : "∞ (no growth within the error)")]);
    box.innerHTML = head + '<dl class="dt-dl">' + L.map(function (l) { return "<dt>" + l[0] + "</dt><dd>" + l[1] + "</dd>"; }).join("") + "</dl>" +
      (o.flags.length ? '<ul class="dt-work-flags">' + o.flags.map(function (fl) { return '<li class="' + fl[1] + '"><b>' + esc(fl[0]) + "</b> " + esc(fl[2]) + "</li>"; }).join("") + "</ul>" : "") +
      '<p class="dt-work-say">Average over this interval. Two counts can\'t show whether the cells were in log phase the whole time.</p>';
  }

  function drawNotes() {
    var n = [];
    var bad = results.filter(function (o) { return o.err; }).length;
    if (bad) n.push('<li class="note">' + bad + (bad === 1 ? " row is" : " rows are") + " not calculated — check the highlighted boxes.</li>");
    if (state.basis === "permL") n.push('<li class="note info">Counts are cells/mL: results are only right if the culture volume was the same at both counts.</li>');
    $("notes").innerHTML = n.join("");
  }

  // ---------- export ----------
  function tableRows() {
    return results.filter(function (o) { return !o.empty; }).map(function (o) {
      var r = state.rows[o.i];
      return {
        row: o.i + 1, name: r.name.trim(), start_count: r.n0.trim(), end_count: r.n1.trim(), split: r.split.trim(),
        start_time: r.t0 || "", end_time: r.t1 || "", interval_h: o.err ? "" : fp(o.h, 6),
        fold: o.err ? "" : fp(o.fold, 6), population_doublings: o.err ? "" : fp(o.pd, 6),
        doubling_time_h: o.err || !isFinite(o.dt) ? "" : fp(o.dt, 6), doubling_time_d: o.err || !isFinite(o.dt) ? "" : fp(o.dt / 24, 6),
        mu_per_h: o.err ? "" : fp(o.mu, 6), mu_per_day: o.err ? "" : fp(o.mu * 24, 6),
        doublings_per_h: o.err ? "" : fp(o.pdph, 6),
        flags: o.err ? "NOT CALCULATED: " + firstProblem(o) : o.flags.map(function (x) { return x[0]; }).join("; "),
        note: r.note.trim()
      };
    });
  }
  var HEAD = ["row", "name", "start_count", "end_count", "split", "start_time", "end_time", "interval_h", "fold", "population_doublings",
    "doubling_time_h", "doubling_time_d", "mu_per_h", "mu_per_day", "doublings_per_h", "flags", "note"];
  function csvCell(v) { v = String(v == null ? "" : v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function stamp() { return toLocalDT(Date.now()).slice(0, 10); }
  function flash(t) { $("copied").textContent = t; setTimeout(function () { $("copied").textContent = ""; }, 2400); }

  $("csv").addEventListener("click", function () {
    var rows = tableRows();
    var lines = [HEAD.join(",")].concat(rows.map(function (r) { return HEAD.map(function (k) { return csvCell(r[k]); }).join(","); }));
    lines.push("", "# counts are " + (state.basis === "permL" ? "cells/mL (same volume assumed)" : "total cells") + "; values are averages over each interval; " + ALGO + "; labmate.tools/tools/doubling-time/");
    download("growth-" + stamp() + ".csv", "﻿" + lines.join("\r\n"), "text/csv;charset=utf-8");
    flash("CSV SAVED ✓");
  });
  $("json").addEventListener("click", function () {
    var rec = {
      tool: "labmate.tools/doubling-time", version: 1, algorithm: ALGO, saved: new Date().toISOString(),
      settings: { time: state.time, unit: state.unit, basis: state.basis },
      rows: state.rows.filter(function (r, i) { return !results[i].empty; }).map(function (r) { return { name: r.name, n0: r.n0, n1: r.n1, split: r.split, t: r.t, t0: r.t0, t1: r.t1, note: r.note }; }),
      results: tableRows(),
      by_line: groups.map(function (g) { return { name: g.name, rows: g.rows, total_h: +fp(g.h, 6), cumulative_doublings: +fp(g.pd, 6), overall_doubling_time_h: isFinite(g.dt) ? +fp(g.dt, 6) : null }; })
    };
    download("growth-" + stamp() + ".growth.json", JSON.stringify(rec, null, 2), "application/json");
    flash("RECORD SAVED ✓");
  });
  $("copy").addEventListener("click", function () {
    var cols = ["row", "name", "start_count", "end_count", "split", "interval_h", "fold", "population_doublings", "doubling_time_h", "mu_per_h", "flags", "note"];
    var t = [cols.join("\t")].concat(tableRows().map(function (r) { return cols.map(function (k) { return String(r[k]).replace(/\t/g, " "); }).join("\t"); })).join("\n");
    LM.copy(t, function (ok) { flash(ok ? "COPIED ✓" : "Copy failed"); });
  });
  $("print").addEventListener("click", function () { buildPrint(); window.print(); });

  function buildPrint() {
    var rows = results.filter(function (o) { return !o.empty; });
    var d = new Date();
    var h = '<div class="dtp-head"><div><b>GROWTH WORKSHEET</b> · DOUBLING TIME &amp; GROWTH RATE</div><div>labmate.tools · 5.4 · printed ' + esc(toLocalDT(d.getTime()).replace("T", " ")) + "</div></div>";
    h += '<p class="dtp-sub">Counts are ' + (state.basis === "permL" ? "cells/mL (same volume at both counts)" : "total live cells") + ". Every value is the average over its interval; two counts can't show the growth phase.</p>";
    h += '<table class="dtp-t"><thead><tr><th>#</th><th>Cell line / batch</th><th>N₀</th><th>N</th><th>Split</th><th>Interval</th><th>Fold</th><th>Doublings</th><th>Doubling time</th><th>μ /h</th><th>Check</th><th>Note</th></tr></thead><tbody>';
    h += rows.map(function (o) {
      var r = state.rows[o.i];
      var tt = o.err ? "" : f(o.h, 4) + " h" + (o.fromDates ? "<br><small>" + esc(r.t0.replace("T", " ")) + " →<br>" + esc(r.t1.replace("T", " ")) + "</small>" : "");
      return "<tr><td>" + (o.i + 1) + "</td><td>" + esc(r.name) + "</td><td>" + esc(r.n0) + "</td><td>" + esc(r.n1) + "</td><td>" + esc(r.split || "–") + "</td><td>" + tt + "</td>" +
        (o.err ? '<td colspan="5">' + esc(firstProblem(o)) + "</td>" :
          "<td>" + f(o.fold, 4) + "</td><td>" + f(o.pd, 4) + "</td><td><b>" + (isFinite(o.dt) ? f(o.dt, 4) + " h" : "—") + "</b></td><td>" + f(o.mu, 4) + "</td><td>" + esc(o.flags.map(function (x) { return x[0]; }).join(", ") || "✓") + "</td>") +
        "<td>" + esc(r.note) + "</td></tr>";
    }).join("");
    h += "</tbody></table>";
    if (groups.length) {
      h += '<table class="dtp-t dtp-sum"><thead><tr><th>Cell line</th><th>Rows</th><th>Total time</th><th>Cumulative doublings</th><th>Overall doubling time</th></tr></thead><tbody>' +
        groups.map(function (g) { return "<tr><td>" + esc(g.name) + "</td><td>" + g.rows.join(", ") + "</td><td>" + f(g.h, 4) + " h</td><td>" + f(g.pd, 4) + "</td><td>" + (isFinite(g.dt) ? f(g.dt, 4) + " h" : "—") + "</td></tr>"; }).join("") + "</tbody></table>";
    }
    h += '<div class="dtp-f">doublings = log₂(N·s ÷ N₀) · doubling time = t × ln 2 ÷ ln(N·s ÷ N₀) · μ = ln(N·s ÷ N₀) ÷ t · s = split factor (1 if none) · ' + ALGO + "</div>";
    h += '<div class="dtp-sign"><span>Counted by ____________________</span><span>Checked by ____________________</span><span>Date ____________</span></div>';
    $("printSheet").innerHTML = h;
  }

  // ---------- import ----------
  function splitLine(line, delim) {
    if (delim !== ",") return line.split(delim);
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
    }
    out.push(cur); return out;
  }
  function normDate(s) { // accepts 2026-11-10 09:30, 2026/11/10T9:30 → datetime-local value
    var m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[T ]+(\d{1,2}):(\d{2})/.exec(String(s).trim());
    if (!m) return "";
    var p = function (n) { n = +n; return (n < 10 ? "0" : "") + n; };
    return m[1] + "-" + p(m[2]) + "-" + p(m[3]) + "T" + p(m[4]) + ":" + m[5];
  }
  function parseTable(text) {
    var lines = String(text).replace(/^﻿/, "").split(/\r?\n/).filter(function (l) { return l.trim() && !/^\s*#/.test(l); });
    if (!lines.length) return { rows: [] };
    var delim = /\t/.test(lines[0]) ? "\t" : (/;/.test(lines[0]) && !/,/.test(lines[0]) ? ";" : ",");
    var grid = lines.map(function (l) { return splitLine(l, delim).map(function (c) { return c.trim(); }); });
    var head = grid[0].map(function (c) { return c.toLowerCase(); });
    var isHead = head.some(function (c) { return /[a-z]/.test(c); }) && !(LM.parse(grid[0][1]) > 0);
    var idx = { name: 0, n0: 1, n1: 2, t: 3, note: 4, split: -1, t0: -1, t1: -1 }, days = false;
    if (isHead) {
      idx = { name: -1, n0: -1, n1: -1, t: -1, note: -1, split: -1, t0: -1, t1: -1 };
      head.forEach(function (c, i) {
        var has = function (re) { return re.test(c); };
        if (has(/start.*(time|date)|(time|date).*start|^t0$|seeded at|counted at.*start/)) idx.t0 = i;
        else if (has(/end.*(time|date)|(time|date).*end|^t1$|harvest/)) idx.t1 = i;
        else if (has(/^split/)) idx.split = i;
        else if (has(/note|comment|remark/)) idx.note = i;
        else if (has(/^(start|initial|n0|n₀|seed)|start count|start_count/)) idx.n0 = i;
        else if (has(/^(end|final|n$|n1|harvest)|end count|end_count/)) idx.n1 = i;
        else if (has(/^(interval|hours?|h|time|duration|t)\b|interval_h/)) { if (idx.t < 0) idx.t = i; }
        else if (has(/^days?\b|interval_d/)) { idx.t = i; days = true; }
        else if (has(/name|line|batch|sample|culture|flask/)) { if (idx.name < 0) idx.name = i; }
      });
      grid.shift();
    }
    var get = function (row, k) { return idx[k] >= 0 && row[idx[k]] != null ? row[idx[k]] : ""; };
    var conv = days !== (state.unit === "d"); // file unit differs from table unit
    var out = grid.map(function (row) {
      var t = get(row, "t"), tv = LM.parse(t);
      if (conv && tv > 0) t = fp(days ? tv * 24 : tv / 24, 6);
      return { name: get(row, "name"), n0: get(row, "n0"), n1: get(row, "n1"), split: get(row, "split"), t: t,
        t0: normDate(get(row, "t0")), t1: normDate(get(row, "t1")), note: get(row, "note") };
    }).filter(function (r) { return r.name || r.n0 || r.n1; });
    return { rows: out, header: isHead, days: days, dates: out.some(function (r) { return r.t0 || r.t1; }) };
  }
  function previewPaste() {
    var p = parseTable($("pasteText").value);
    $("pasteAdd").disabled = $("pasteReplace").disabled = !p.rows.length;
    $("pasteMsg").innerHTML = !$("pasteText").value.trim() ? "" : p.rows.length
      ? "Read <b>" + p.rows.length + "</b> row" + (p.rows.length > 1 ? "s" : "") + (p.header ? " (header found)" : " (no header: name, start, end, interval, note)") + (p.days ? " · interval in days" : "") + "."
      : "No rows found.";
    return p;
  }
  function useRows(p, replace, from) {
    var base = replace ? [] : state.rows.filter(function (r, i) { return !results[i] || !results[i].empty; });
    var room = MAX_ROWS - base.length, add = p.rows.slice(0, Math.max(0, room));
    state.rows = base.concat(add);
    if (!state.rows.length) state.rows.push(blankRow());
    if (p.dates) state.time = "dates";
    state.example = false;
    sel = base.length;
    drawInputs(); syncSegs(); render();
    $("pasteMsg").innerHTML = "Added <b>" + add.length + "</b> row" + (add.length === 1 ? "" : "s") + (from ? " from " + esc(from) : "") + (p.rows.length > add.length ? " — table is full at " + MAX_ROWS + " rows." : ".");
  }
  $("pasteText").addEventListener("input", previewPaste);
  $("pasteAdd").addEventListener("click", function () { useRows(previewPaste(), false); $("pasteText").value = ""; previewPaste(); });
  $("pasteReplace").addEventListener("click", function () { useRows(previewPaste(), true); $("pasteText").value = ""; previewPaste(); });
  $("fileIn").addEventListener("change", function () {
    var file = this.files && this.files[0]; if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      var text = String(rd.result);
      if (/\.json$/i.test(file.name) || /^\s*\{/.test(text)) {
        try {
          var rec = JSON.parse(text);
          if (!rec || !Array.isArray(rec.rows)) throw new Error("no rows");
          var s = rec.settings || {};
          state.time = s.time === "dates" ? "dates" : "interval";
          state.unit = s.unit === "d" ? "d" : "h";
          state.basis = s.basis === "permL" ? "permL" : "total";
          var rows = rec.rows.map(function (r) { var b = blankRow(); Object.keys(b).forEach(function (k) { b[k] = r[k] == null ? "" : String(r[k]); }); return b; });
          useRows({ rows: rows }, true, file.name);
          var again = tableRows(), same = Array.isArray(rec.results) && rec.results.length === again.length && rec.results.every(function (r, i) {
            return ["fold", "population_doublings", "doubling_time_h", "mu_per_h"].every(function (k) { return String(r[k]) === String(again[i][k]); });
          });
          $("pasteMsg").innerHTML += Array.isArray(rec.results) ? (same ? " Recalculated: <b>every value matches</b> the saved record." : " <b>Recalculated values differ from the saved record</b> — the record may have been edited, or saved by another version (" + esc(rec.algorithm || "?") + ").") : "";
        } catch (e) { $("pasteMsg").textContent = "That file isn't a labmate growth record."; }
      } else {
        var p = parseTable(text);
        if (!p.rows.length) $("pasteMsg").textContent = "No rows found in " + file.name + ".";
        else useRows(p, false, file.name);
      }
      $("fileIn").value = "";
    };
    rd.readAsText(file);
  });

  // ---------- events ----------
  function syncSegs() {
    [["timeSeg", state.time], ["unitSeg", state.unit], ["basisSeg", state.basis]].forEach(function (p) {
      $(p[0]).querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-v") === p[1])); });
    });
  }
  $("timeSeg").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; state.time = b.getAttribute("data-v"); syncSegs(); render(); });
  $("basisSeg").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; state.basis = b.getAttribute("data-v"); syncSegs(); render(); });
  $("unitSeg").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var u = b.getAttribute("data-v"); if (u === state.unit) return;
    // keep the same real interval: convert typed numbers
    state.rows.forEach(function (r) { var v = LM.parse(r.t); if (v > 0) r.t = fp(u === "d" ? v / 24 : v * 24, 6); });
    state.unit = u; drawInputs(); syncSegs(); render();
  });
  function onEdit(e) {
    var el = e.target, tr = el.closest("tr"); if (!tr || !el.dataset.k) return;
    var i = +tr.dataset.i;
    if (state.rows[i][el.dataset.k] === el.value) return;
    state.rows[i][el.dataset.k] = el.value;
    state.example = false;
    sel = i; render();
  }
  $("rows").addEventListener("input", onEdit);
  $("rows").addEventListener("change", onEdit);
  $("rows").addEventListener("focusin", function (e) { var tr = e.target.closest("tr"); if (tr && +tr.dataset.i !== sel) { sel = +tr.dataset.i; render(); } });
  $("rows").addEventListener("click", function (e) {
    var b = e.target.closest("[data-del]"); if (!b) return;
    state.rows.splice(+b.dataset.del, 1);
    if (!state.rows.length) state.rows.push(blankRow());
    sel = Math.min(sel, state.rows.length - 1);
    drawInputs(); render();
  });
  $("rows").addEventListener("keydown", function (e) { // Enter on the last row adds a row
    if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
    var tr = e.target.closest("tr"), i = +tr.dataset.i, k = e.target.dataset.k;
    e.preventDefault();
    if (i === state.rows.length - 1) addRow(state.rows[i].name);
    var next = document.querySelector('#rows tr[data-i="' + (i + 1) + '"] [data-k="' + k + '"]');
    if (next) next.focus();
  });
  function addRow(prevName) {
    if (state.rows.length >= MAX_ROWS) return;
    var r = blankRow();
    var m = /^(.*?)(\d+)\s*$/.exec(prevName || ""); // HEK P14 → HEK P15
    if (m) r.name = m[1] + (+m[2] + 1);
    state.rows.push(r); state.example = false; drawInputs(); render();
  }
  $("addRow").addEventListener("click", function () {
    addRow(state.rows[state.rows.length - 1].name);
    var last = document.querySelectorAll("#rows tr"); last[last.length - 1].querySelector('[data-k="n0"]').focus();
  });
  $("outRows").addEventListener("click", function (e) { var tr = e.target.closest("tr[data-i]"); if (tr) { sel = +tr.dataset.i; render(); $("work").scrollIntoView({ block: "nearest", behavior: "smooth" }); } });
  $("outRows").addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { var tr = e.target.closest("tr[data-i]"); if (tr) { e.preventDefault(); sel = +tr.dataset.i; render(); } } });
  $("clear").addEventListener("click", function () {
    state.rows = [blankRow()]; state.example = false; sel = 0;
    drawInputs(); render(); document.querySelector('#rows [data-k="name"]').focus();
  });

  // ---------- hand-off from Cell Count & Seeding ----------
  function takeHandoff() {
    if (!window.LMH) return;
    var d = LMH.take("doubling-time");
    if (!d || !(d.cells > 0)) return;
    var at = toLocalDT(d.at || Date.now()), msg;
    if (state.example) { state.rows = []; state.example = false; }
    state.rows = state.rows.filter(function (r) { return compute(r, 0).empty === false; });
    // an open row: has a start count but no end count yet
    var open = -1;
    for (var i = state.rows.length - 1; i >= 0; i--) { if (state.rows[i].n0.trim() && !state.rows[i].n1.trim()) { open = i; break; } }
    var v = cellsPlain(d.cells);
    if (open >= 0) {
      var r = state.rows[open];
      r.n1 = v; r.t1 = at;
      sel = open;
      msg = "End count " + v + " cells added to row " + (open + 1) + (r.name ? " (" + r.name + ")" : "") + " from Cell Count";
    } else {
      if (state.rows.length >= MAX_ROWS) return;
      state.rows.push({ name: d.name || "", n0: v, n1: "", split: "", t: "", t0: at, t1: "", note: d.note || "" });
      sel = state.rows.length - 1;
      msg = "Start count " + v + " cells added as row " + state.rows.length + ". Count again later and log it here to finish the row";
    }
    if (!state.rows.length) state.rows.push(blankRow());
    state.time = "dates";
    LMH.note(msg + ".");
    setTimeout(function () {
      var nm = document.querySelector('#rows tr[data-i="' + sel + '"] [data-k="name"]');
      if (nm && !nm.value) nm.focus();
    }, 50);
  }

  takeHandoff();
  drawInputs(); syncSegs(); render();
})();
