// labmate.tools — 5.2 Protein Loading (BCA / Bradford curve → Western loading table)
(function () {
  "use strict";
  var LM = window.LM;
  var KEY = "lm-protein-v1";
  var C_STD = "#2E9E5B", C_SMP = "#B7791F";

  var EXAMPLE = {
    src: "assay", fit: "linear", example: true,
    stds: [["2000", "1.760"], ["1500", "1.430"], ["1000", "1.050"], ["750", "0.840"], ["500", "0.610"], ["250", "0.360"], ["125", "0.230"], ["25", "0.125"], ["0", "0.098"]],
    samples: [["Control", "0.712 0.698", "5", ""], ["Knockout 1", "0.821 0.806", "5", ""], ["Knockout 2", "0.552 0.571", "5", ""], ["Treated", "0.664 0.650", "5", ""]],
    ug: "20", lv: "20", buf: "4", extra: "0"
  };

  var $ = function (id) { return document.getElementById(id); };
  var state = LM.load(KEY);
  if (!state || !Array.isArray(state.stds)) state = JSON.parse(JSON.stringify(EXAMPLE));
  var lastText = "";

  function mean(str) {
    var parts = String(str || "").trim().split(/[\s,;]+/).filter(Boolean).map(LM.parse);
    if (!parts.length) return null;
    if (parts.some(function (x) { return x == null || isNaN(x); })) return NaN;
    return parts.reduce(function (a, b) { return a + b; }, 0) / parts.length;
  }
  function f3(x) { return LM.fmt(x, 3); }

  // ---------- rows ----------
  function stdRow(r, i) {
    return '<tr data-i="' + i + '"><td><input class="pp-in" data-k="0" inputmode="decimal" value="' + LM.esc(r[0]) + '" aria-label="Standard ' + (i + 1) + ' concentration"></td>' +
      '<td><input class="pp-in" data-k="1" inputmode="decimal" value="' + LM.esc(r[1]) + '" aria-label="Standard ' + (i + 1) + ' absorbance"></td>' +
      '<td class="x"><button type="button" class="mm-x" aria-label="Remove standard">×</button></td></tr>';
  }
  function sRow(r, i) {
    var known = state.src === "known";
    return '<tr data-i="' + i + '"><td><input class="pp-in pp-name" data-k="0" value="' + LM.esc(r[0]) + '" placeholder="Sample ' + (i + 1) + '" aria-label="Sample name"></td>' +
      (known ? '<td class="a" hidden></td><td class="d" hidden></td><td class="n"><input class="pp-in" data-k="3" inputmode="decimal" value="' + LM.esc(r[3]) + '" aria-label="Protein µg/µL"></td>'
        : '<td class="a"><input class="pp-in" data-k="1" inputmode="decimal" value="' + LM.esc(r[1]) + '" aria-label="Absorbance"></td>' +
          '<td class="d"><input class="pp-in pp-dil" data-k="2" inputmode="decimal" value="' + LM.esc(r[2]) + '" aria-label="Dilution before assay"></td>' +
          '<td class="n pp-out">—</td>') +
      '<td class="x"><button type="button" class="mm-x" aria-label="Remove sample">×</button></td></tr>';
  }
  function render() {
    $("stdRows").innerHTML = state.stds.map(stdRow).join("");
    $("sRows").innerHTML = state.samples.map(sRow).join("");
    var known = state.src === "known";
    $("curveBox").hidden = known;
    document.querySelectorAll("#sTable th.a, #sTable th.d").forEach(function (th) { th.hidden = known; });
    $("dilHint").hidden = known;
    $("samplesSub").textContent = known ? "TYPE µg/µL (= mg/mL)" : "ABSORBANCE → µg/µL";
    update();
  }
  function readRows() {
    document.querySelectorAll("#stdRows tr").forEach(function (tr, i) {
      tr.querySelectorAll(".pp-in").forEach(function (inp) { state.stds[i][+inp.dataset.k] = inp.value; });
    });
    document.querySelectorAll("#sRows tr").forEach(function (tr, i) {
      tr.querySelectorAll(".pp-in").forEach(function (inp) { state.samples[i][+inp.dataset.k] = inp.value; });
    });
  }

  // ---------- fit ----------
  function fitCurve() {
    var pts = [], blank = null, bad = false;
    state.stds.forEach(function (r) {
      var c = LM.parse(r[0]), a = mean(r[1]);
      if (c == null && a == null) return;
      if (c == null || a == null || isNaN(c) || isNaN(a) || c < 0) { bad = true; return; }
      if (c === 0) blank = blank == null ? a : (blank + a) / 2; else pts.push([c, a]);
    });
    if (bad) return { error: "A standard row has a missing or non-numeric value." };
    var b0 = blank || 0;
    pts = pts.map(function (p) { return [p[0], p[1] - b0]; }).sort(function (x, y) { return x[0] - y[0]; });
    var withZero = blank != null ? [[0, 0]].concat(pts) : pts;
    if (pts.length < (state.fit === "quad" ? 3 : 2)) return { error: "Enter at least " + (state.fit === "quad" ? 3 : 2) + " standards above zero." };
    var coef = state.fit === "quad" ? polyfit(withZero, 2) : polyfit(withZero, 1);
    if (!coef) return { error: "Couldn't fit these standards — check the numbers." };
    var f = function (c) { return coef.reduce(function (s, k, i) { return s + k * Math.pow(c, i); }, 0); };
    var my = withZero.reduce(function (s, p) { return s + p[1]; }, 0) / withZero.length;
    var ssr = 0, sst = 0;
    withZero.forEach(function (p) { ssr += Math.pow(p[1] - f(p[0]), 2); sst += Math.pow(p[1] - my, 2); });
    var maxC = pts[pts.length - 1][0], minC = pts[0][0];
    return {
      coef: coef, f: f, r2: sst ? 1 - ssr / sst : 1, pts: pts, blank: blank, maxC: maxC, minC: minC,
      maxA: f(maxC), minA: f(minC),
      inv: function (y) { // absorbance (blank-subtracted) → µg/mL
        if (coef.length === 2) return (y - coef[0]) / coef[1];
        var a = coef[2], b = coef[1], c0 = coef[0] - y;
        if (Math.abs(a) < 1e-15) return -c0 / b;
        var disc = b * b - 4 * a * c0;
        if (disc < 0) return NaN;
        var r1 = (-b + Math.sqrt(disc)) / (2 * a), r2 = (-b - Math.sqrt(disc)) / (2 * a);
        var ok = [r1, r2].filter(function (r) { return r >= -0.05 * maxC && r <= 3 * maxC; }).sort(function (p, q) { return p - q; });
        return ok.length ? ok[0] : NaN;
      }
    };
  }
  // least squares polynomial (degree 1 or 2) via normal equations
  function polyfit(pts, deg) {
    var n = deg + 1, A = [], B = [];
    for (var i = 0; i < n; i++) {
      A.push([]); B.push(0);
      for (var j = 0; j < n; j++) A[i].push(pts.reduce(function (s, p) { return s + Math.pow(p[0], i + j); }, 0));
      B[i] = pts.reduce(function (s, p) { return s + p[1] * Math.pow(p[0], i); }, 0);
    }
    // gaussian elimination
    for (var k = 0; k < n; k++) {
      var piv = k;
      for (var r = k + 1; r < n; r++) if (Math.abs(A[r][k]) > Math.abs(A[piv][k])) piv = r;
      if (Math.abs(A[piv][k]) < 1e-18) return null;
      var t = A[k]; A[k] = A[piv]; A[piv] = t; var tb = B[k]; B[k] = B[piv]; B[piv] = tb;
      for (r = k + 1; r < n; r++) {
        var m = A[r][k] / A[k][k];
        for (var c = k; c < n; c++) A[r][c] -= m * A[k][c];
        B[r] -= m * B[k];
      }
    }
    var x = new Array(n);
    for (k = n - 1; k >= 0; k--) {
      var s = B[k];
      for (c = k + 1; c < n; c++) s -= A[k][c] * x[c];
      x[k] = s / A[k][k];
    }
    return x;
  }

  // ---------- chart ----------
  function niceMax(v) {
    var p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }
  function drawChart(fit, samples) {
    var svg = $("chart"), W = 480, H = 320, L = 56, R = 16, T = 16, Bm = 44;
    var parts = ['<title id="chartTitle">Standard curve</title>'];
    if (!fit || fit.error) {
      parts.push('<text x="240" y="160" text-anchor="middle" class="pp-ax">' + LM.esc(fit ? fit.error : "") + "</text>");
      svg.innerHTML = parts.join(""); $("fitInfo").innerHTML = ""; return;
    }
    var xs = fit.pts.map(function (p) { return p[0]; }).concat(samples.map(function (s) { return s.cWell || 0; }));
    var ys = fit.pts.map(function (p) { return p[1]; }).concat(samples.map(function (s) { return s.net || 0; }));
    var xMax = niceMax(Math.max.apply(null, xs) * 1.05), yMax = niceMax(Math.max.apply(null, ys) * 1.08);
    var X = function (v) { return L + (v / xMax) * (W - L - R); }, Y = function (v) { return H - Bm - (v / yMax) * (H - T - Bm); };
    for (var i = 0; i <= 4; i++) {
      var yv = yMax * i / 4, xv = xMax * i / 4;
      parts.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(yv) + '" y2="' + Y(yv) + '" class="pp-grid"/>');
      parts.push('<text x="' + (L - 8) + '" y="' + (Y(yv) + 4) + '" text-anchor="end" class="pp-ax">' + LM.fmt(yv, 3) + "</text>");
      parts.push('<text x="' + X(xv) + '" y="' + (H - Bm + 18) + '" text-anchor="middle" class="pp-ax">' + LM.fmt(xv, 4) + "</text>");
    }
    parts.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(0) + '" y2="' + Y(0) + '" class="pp-axis"/>');
    parts.push('<text x="' + ((L + W - R) / 2) + '" y="' + (H - 6) + '" text-anchor="middle" class="pp-ax">µg/mL</text>');
    parts.push('<text x="14" y="' + ((T + H - Bm) / 2) + '" text-anchor="middle" class="pp-ax" transform="rotate(-90 14 ' + ((T + H - Bm) / 2) + ')">absorbance − blank</text>');
    // fit line, drawn across the standards' range only
    var d = "";
    for (i = 0; i <= 60; i++) {
      var c = fit.maxC * i / 60, a = fit.f(c);
      d += (i ? "L" : "M") + X(c).toFixed(1) + " " + Y(Math.max(0, Math.min(yMax, a))).toFixed(1);
    }
    parts.push('<path d="' + d + '" class="pp-fit"/>');
    fit.pts.forEach(function (p) {
      parts.push('<circle cx="' + X(p[0]) + '" cy="' + Y(p[1]) + '" r="5" fill="' + C_STD + '" class="pp-dot"><title>Standard ' + LM.fmt(p[0]) + " µg/mL · A " + LM.fmt(p[1], 3) + "</title></circle>");
    });
    samples.forEach(function (s) {
      if (s.cWell == null || !isFinite(s.cWell) || s.net == null) return;
      var cx = X(Math.min(s.cWell, xMax)), cy = Y(Math.min(s.net, yMax));
      parts.push('<path d="M' + cx + " " + (cy - 7) + " L" + (cx + 7) + " " + cy + " L" + cx + " " + (cy + 7) + " L" + (cx - 7) + " " + cy + 'Z" fill="' + C_SMP + '" class="pp-dot"><title>' +
        LM.esc(s.name) + " · A " + LM.fmt(s.net, 3) + " → " + LM.fmt(s.cWell, 4) + " µg/mL in the well</title></path>");
    });
    svg.innerHTML = parts.join("");
    var eq = fit.coef.length === 2
      ? "A = " + LM.fmt(fit.coef[1], 3) + "·c " + (fit.coef[0] < 0 ? "− " : "+ ") + LM.fmt(Math.abs(fit.coef[0]), 3)
      : "A = " + LM.fmt(fit.coef[2], 3) + "·c² " + (fit.coef[1] < 0 ? "− " : "+ ") + LM.fmt(Math.abs(fit.coef[1]), 3) + "·c " + (fit.coef[0] < 0 ? "− " : "+ ") + LM.fmt(Math.abs(fit.coef[0]), 3);
    $("fitInfo").innerHTML = '<span class="pp-key"><i class="dot" style="background:' + C_STD + '"></i>Standards</span>' +
      '<span class="pp-key"><i class="dia" style="background:' + C_SMP + '"></i>Samples</span>' +
      '<span class="pp-r2' + (fit.r2 < 0.98 ? " is-low" : "") + '">R² = ' + fit.r2.toFixed(4) + "</span>" +
      '<span class="pp-eq">' + eq + (fit.blank != null ? " · blank " + LM.fmt(fit.blank, 3) : "") + "</span>";
  }

  // ---------- main ----------
  function update() {
    readRows();
    LM.save(KEY, Object.assign({}, state, { ug: $("ug").value, lv: $("lv").value, buf: $("buf").value, extra: $("extra").value }));
    $("exampleNote").hidden = !(state.example && state.src === "assay");
    var known = state.src === "known";
    var fit = known ? null : fitCurve();
    var notes = [];

    // samples
    var trs = document.querySelectorAll("#sRows tr");
    var samples = state.samples.map(function (r, i) {
      var s = { name: r[0] || "Sample " + (i + 1), conc: null, flag: "" };
      var out = trs[i].querySelector(".pp-out");
      if (known) {
        var c = LM.parse(r[3]);
        if (c != null && !isNaN(c) && c > 0) s.conc = c; else if (c != null) s.flag = "bad";
        return s;
      }
      var a = mean(r[1]), dil = LM.parse(r[2]);
      if (dil == null) dil = 1;
      if (a == null) { out.textContent = "—"; return s; }
      if (isNaN(a) || isNaN(dil) || dil <= 0) { out.textContent = "?"; s.flag = "bad"; return s; }
      if (!fit || fit.error) { out.textContent = "—"; return s; }
      s.net = a - (fit.blank || 0);
      s.cWell = fit.inv(s.net);
      if (!isFinite(s.cWell) || s.cWell <= 0) { out.innerHTML = '<span class="pp-flag">below blank</span>'; s.flag = "low"; return s; }
      s.conc = s.cWell * dil / 1000;
      if (s.net > fit.maxA * 1.0001) s.flag = "high";
      else if (s.net < fit.minA) s.flag = "lowstd";
      out.innerHTML = "<b>" + f3(s.conc) + "</b>" + (s.flag === "high" ? ' <span class="pp-flag">above top std</span>' : s.flag === "lowstd" ? ' <span class="pp-flag">below lowest std</span>' : "");
      return s;
    });
    drawChart(fit, samples);
    if (fit && !fit.error && fit.r2 < 0.98) notes.push('<li class="note">R² is ' + fit.r2.toFixed(3) + " — the fit is loose. Check for a misread standard, or try the other fit.</li>");
    var high = samples.filter(function (s) { return s.flag === "high"; }).map(function (s) { return s.name; });
    if (high.length) notes.push('<li class="note"><b>' + LM.esc(high.join(", ")) + "</b> read" + (high.length === 1 ? "s" : "") + " above the top standard. The value is extrapolated — dilute more and read again.</li>");

    // loading
    ["ug", "lv", "extra"].forEach(function (id) { $(id + "m").textContent = ""; document.querySelector('[data-term="' + id + '"]').classList.remove("is-bad"); });
    var ug = LM.parse($("ug").value), lv = LM.parse($("lv").value), X = +$("buf").value, extra = LM.parse($("extra").value);
    if (extra == null) extra = 0;
    var badIn = false;
    [["ug", ug], ["lv", lv]].forEach(function (p) { if (p[1] == null || isNaN(p[1]) || p[1] <= 0) { badIn = true; if (p[1] != null) { $(p[0] + "m").textContent = "Must be above zero"; document.querySelector('[data-term="' + p[0] + '"]').classList.add("is-bad"); } } });
    if (isNaN(extra) || extra < 0) { badIn = true; $("extram").textContent = "0 or more"; }
    var k = 1 + extra / 100;
    var rows = [], tsv = ["Lane\tSample\tug/uL\tSample (uL)\tBuffer (uL)\tWater (uL)\tTotal (uL)"];
    var lane = 0, tooDilute = [];
    samples.forEach(function (s) {
      if (s.conc == null) return;
      lane++;
      if (badIn) { rows.push(["" + lane, s.name, f3(s.conc), "—", "—", "—", "—", ""]); return; }
      var sv = ug / s.conc, bv = lv / X, wv = lv - sv - bv;
      if (wv < -1e-9) {
        var maxUg = (lv - bv) * s.conc;
        tooDilute.push(s.name + " (max " + LM.fmt(maxUg, 3) + " µg)");
        rows.push(["" + lane, s.name, f3(s.conc), f3(sv * k), f3(bv * k), "—", f3(lv * k), "over"]);
        tsv.push([lane, s.name, LM.fmtPlain(s.conc, 3), LM.fmtPlain(sv * k, 3), LM.fmtPlain(bv * k, 3), "TOO DILUTE", LM.fmtPlain(lv * k, 3)].join("\t"));
        return;
      }
      rows.push(["" + lane, s.name, f3(s.conc), f3(sv * k), f3(bv * k), f3(Math.max(0, wv) * k), f3(lv * k), sv * k < 1 ? "small" : ""]);
      tsv.push([lane, s.name, LM.fmtPlain(s.conc, 3), LM.fmtPlain(sv * k, 3), LM.fmtPlain(bv * k, 3), LM.fmtPlain(Math.max(0, wv) * k, 3), LM.fmtPlain(lv * k, 3)].join("\t"));
    });
    $("lRows").innerHTML = rows.length ? rows.map(function (r) {
      return '<tr class="' + (r[7] === "over" ? "is-over" : "") + '"><td class="lane">' + r[0] + "</td><td>" + LM.esc(r[1]) + '</td><td class="n">' + r[2] + '</td><td class="n' + (r[7] === "small" ? " is-small" : "") + '">' + r[3] +
        '</td><td class="n">' + r[4] + '</td><td class="n">' + (r[7] === "over" ? '<span class="pp-flag">too dilute</span>' : r[5]) + '</td><td class="n t">' + r[6] + "</td></tr>";
    }).join("") : '<tr><td colspan="7" class="pp-empty">' + (known ? "Type each sample's concentration above." : "Enter standards and sample readings above.") + "</td></tr>";
    if (tooDilute.length) notes.push('<li class="note"><b>Too dilute for ' + LM.fmt(ug) + " µg in " + LM.fmt(lv) + " µL:</b> " + LM.esc(tooDilute.join(", ")) + ". Load less protein in every lane, or raise the lane volume.</li>");
    if (rows.some(function (r) { return r[7] === "small"; })) notes.push('<li class="note info">Sample volumes under 1 µL are hard to pipette — dilute those lysates in lysis buffer first, then recalculate.</li>');
    $("notes").innerHTML = notes.join("");
    var ok = rows.length && !badIn;
    $("copy").disabled = !ok; $("print").disabled = !ok;
    $("loadSay").textContent = ok ? LM.fmt(ug) + " µg in " + LM.fmt(lv) + " µL per lane · " + X + "X buffer" + (extra ? " · +" + LM.fmt(extra) + "% extra" : "") : "";
    lastText = ok ? "Protein loading — labmate.tools\n" + LM.fmtPlain(ug) + " ug in " + LM.fmtPlain(lv) + " uL per lane, " + X + "X sample buffer" + (extra ? ", +" + LM.fmtPlain(extra) + "% extra" : "") + "\n\n" + tsv.join("\n") : "";
  }

  // ---------- events ----------
  function seg(id, key) {
    $(id).addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      readRows(); state[key] = b.getAttribute("data-v"); sync(); render();
    });
  }
  function sync() {
    [["srcSeg", "src"], ["fitSeg", "fit"]].forEach(function (p) {
      $(p[0]).querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-v") === state[p[1]])); });
    });
  }
  seg("srcSeg", "src"); seg("fitSeg", "fit");
  ["stdRows", "sRows"].forEach(function (id) {
    $(id).addEventListener("input", function (e) {
      if (id === "stdRows" || (e.target.dataset && e.target.dataset.k === "1")) state.example = false;
      update();
    });
    $(id).addEventListener("click", function (e) {
      var x = e.target.closest(".mm-x"); if (!x) return;
      readRows();
      var list = id === "stdRows" ? state.stds : state.samples;
      list.splice(+x.closest("tr").dataset.i, 1);
      if (!list.length) list.push(id === "stdRows" ? ["", ""] : ["", "", "1", ""]);
      render();
    });
  });
  $("addStd").addEventListener("click", function () { readRows(); state.stds.push(["", ""]); render(); });
  $("addSample").addEventListener("click", function () {
    readRows(); state.samples.push(["", "", state.samples.length ? state.samples[state.samples.length - 1][2] : "1", ""]); render();
    var last = document.querySelectorAll("#sRows tr"); last[last.length - 1].querySelector(".pp-name").focus();
  });
  ["ug", "lv", "extra"].forEach(function (id) { $(id).addEventListener("input", update); });
  $("buf").addEventListener("change", update);
  $("clear").addEventListener("click", function () {
    state.stds = [["2000", ""], ["1500", ""], ["1000", ""], ["750", ""], ["500", ""], ["250", ""], ["125", ""], ["25", ""], ["0", ""]];
    state.samples = [["", "", "1", ""], ["", "", "1", ""], ["", "", "1", ""]];
    state.example = false;
    render();
  });
  $("copy").addEventListener("click", function () {
    if (!lastText) return;
    LM.copy(lastText, function (ok) {
      $("copied").textContent = ok ? "COPIED ✓ — pastes into Excel" : "Copy failed";
      setTimeout(function () { $("copied").textContent = ""; }, 2400);
    });
  });
  $("print").addEventListener("click", function () { window.print(); });

  $("ug").value = state.ug || "20"; $("lv").value = state.lv || "20"; $("buf").value = state.buf || "4"; $("extra").value = state.extra == null ? "0" : state.extra;
  sync();
  render();
})();
