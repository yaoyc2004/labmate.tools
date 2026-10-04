// labmate.tools — 5.1 Cell Count & Seeding
(function () {
  "use strict";
  var LM = window.LM;
  var KEY = "lm-cellseed-v1";

  // typical growth area (cm²) and working volume (mL); unit = what to call one of them
  var VESSELS = [
    ["96", "96-well plate", 0.32, 0.1, "wells"], ["48", "48-well plate", 0.95, 0.3, "wells"],
    ["24", "24-well plate", 1.9, 0.5, "wells"], ["12", "12-well plate", 3.8, 1, "wells"],
    ["6", "6-well plate", 9.5, 2, "wells"], ["d35", "35 mm dish", 9, 2, "dishes"],
    ["d60", "60 mm dish", 21, 4, "dishes"], ["d100", "100 mm dish", 55, 10, "dishes"],
    ["t25", "T25 flask", 25, 5, "flasks"], ["t75", "T75 flask", 75, 15, "flasks"], ["t175", "T175 flask", 175, 35, "flasks"]
  ];
  var EXAMPLE = { mode: "hemo", l1: "52", l2: "48", l3: "", l4: "", d1: "3", d2: "5", d3: "", d4: "",
    pre: false, pc: "10", pd: "90", tc: "10", td: "10", conc: "", concu: "1e6", via: "", have: "",
    vessel: "96", dens: "1e4", densu: "well", wells: "60", wv: "100", wvu: "µL", over: "10" };
  var Q = [1, 2, 3, 4];
  var FIELDS = ["l1", "l2", "l3", "l4", "d1", "d2", "d3", "d4", "pc", "pd", "tc", "td",
    "conc", "concu", "via", "have", "vessel", "dens", "densu", "wells", "wv", "wvu", "over"];

  var $ = function (id) { return document.getElementById(id); };
  VESSELS.forEach(function (v) {
    var o = document.createElement("option"); o.value = v[0]; o.textContent = v[1]; $("vessel").appendChild(o);
  });
  var state = LM.load(KEY) || JSON.parse(JSON.stringify(EXAMPLE));
  if (state.live != null && state.l1 == null) { // saved by the old one-box version
    var oldL = String(state.live).trim().split(/[\s,;]+/), oldD = String(state.dead || "").trim().split(/[\s,;]+/);
    Q.forEach(function (q) { state["l" + q] = oldL[q - 1] || ""; state["d" + q] = oldD[q - 1] || ""; });
    var oldDf = LM.parse(state.df);
    state.tc = "10"; state.td = oldDf && oldDf >= 1 ? LM.fmtPlain(10 * (oldDf - 1)) : "10";
    state.pre = false; state.pc = "10"; state.pd = "90";
    delete state.live; delete state.dead; delete state.df;
  }
  var lastText = "";
  function vessel() { var id = $("vessel").value; return VESSELS.filter(function (v) { return v[0] === id; })[0]; }

  // 1.025e6 → "1.03 × 10⁶"
  function cells(x) {
    if (!isFinite(x)) return "—";
    if (x < 1e4) return LM.fmt(Math.round(x), 4);
    var e = Math.floor(Math.log10(x)), m = x / Math.pow(10, e);
    var sup = String(e).split("").map(function (c) { return "⁰¹²³⁴⁵⁶⁷⁸⁹"[+c]; }).join("");
    return LM.fmt(m, 4) + " × 10" + sup;
  }
  function cellsPlain(x) { return x < 1e4 ? String(Math.round(x)) : (x.toExponential(2)).replace("e+", "e"); }
  function vol(mL) { return LM.show(mL * 1e-3, LM.VOL); }
  function volPlain(mL) { return LM.showPlain(mL * 1e-3, LM.VOL); }

  function setMsg(id, t) {
    var m = $(id + "m"); if (!m) return;
    m.textContent = t || "";
    document.querySelector('[data-term="' + id + '"]').classList.toggle("is-bad", !!t);
  }
  function num(id, o) {
    o = o || {};
    var v = LM.parse($(id).value);
    if (v == null) return null;
    if (isNaN(v)) { setMsg(id, "Not a number"); return NaN; }
    if (v < 0 || (!o.zero && v === 0)) { setMsg(id, o.zero ? "Can't be negative" : "Must be above zero"); return NaN; }
    if (o.max != null && v > o.max) { setMsg(id, o.maxMsg); return NaN; }
    if (o.int && Math.round(v) !== v) { setMsg(id, "Whole number"); return NaN; }
    return v;
  }

  // ---------- 1 · count ----------
  function corner(q) { // → {live, dead} numbers, null when empty, NaN when not a number
    var r = {};
    ["l", "d"].forEach(function (k) {
      var v = LM.parse($(k + q).value);
      r[k] = v == null ? null : (isNaN(v) || v < 0 ? NaN : v);
    });
    return r;
  }
  function vv(a, b) { // "a µL + b µL" → fold, or NaN; marks bad boxes
    var x = LM.parse($(a).value), y = LM.parse($(b).value);
    var badX = x == null || isNaN(x) || x <= 0, badY = y == null || isNaN(y) || y < 0;
    $(a).classList.toggle("is-bad", badX); $(b).classList.toggle("is-bad", badY);
    return badX || badY ? NaN : (x + y) / x;
  }
  function markChips(attr, a, b) {
    document.querySelectorAll("[data-" + attr + "]").forEach(function (btn) {
      var v = btn.getAttribute("data-" + attr).split(",");
      btn.setAttribute("aria-pressed", String(LM.parse($(a).value) === +v[0] && LM.parse($(b).value) === +v[1]));
    });
  }
  function hemo() {
    var out = { conc: null, via: null };
    var sumL = 0, n = 0, vL = 0, vD = 0, bad = false;
    Q.forEach(function (q) {
      var c = corner(q), el = document.querySelector('.hc-corner[data-q="' + q + '"]');
      var isBad = (c.l !== c.l) || (c.d !== c.d), filled = c.l != null && c.l === c.l;
      el.classList.toggle("is-bad", isBad); el.classList.toggle("is-filled", filled && !isBad);
      $("st" + q).textContent = isBad ? "NUMBER?" : (filled ? "COUNTED ✓" : (q === 1 ? "START HERE" : "OPTIONAL"));
      if (isBad) { bad = true; return; }
      if (filled) {
        n++; sumL += c.l;
        if (c.d != null) { vL += c.l; vD += c.d; } // viability only from squares with both counts
      }
    });
    // dilution: optional pre-dilution × trypan blue mix
    var pre = 1;
    $("preBody").hidden = !state.pre;
    if (state.pre) pre = vv("pc", "pd"); else { $("pc").classList.remove("is-bad"); $("pd").classList.remove("is-bad"); }
    var tb = vv("tc", "td");
    var total = pre * tb;
    $("preX").textContent = state.pre ? (pre === pre ? "×" + LM.fmt(pre, 4) : "—") : "OFF";
    $("preX").classList.toggle("is-on", !!state.pre);
    $("tbX").textContent = tb === tb ? "×" + LM.fmt(tb, 4) : "—";
    $("totX").textContent = total === total ? "×" + LM.fmt(total, 4) : "—";
    $("totWhy").textContent = state.pre && total === total ? "= " + LM.fmt(pre, 4) + " × " + LM.fmt(tb, 4) : "";
    markChips("pre", "pc", "pd"); markChips("tb", "tc", "td");

    var mean = n ? sumL / n : NaN;
    $("meanTxt").innerHTML = "<b>" + n + " of 4 squares</b>" + (n ? " · mean <b>" + LM.fmt(mean, 4) + "</b> live per square" : "");
    $("meanMark").hidden = !n;
    if (n) $("meanMark").style.left = (Math.min(mean, 150) / 150 * 100).toFixed(2) + "%";
    var dn = $("densNote");
    if (n && mean > 100) { dn.hidden = false; dn.innerHTML = "<b>Too dense to count well.</b> Over 100 cells per square: dilute the cells 1:10, recount, and turn on <b>Pre-dilution</b>."; }
    else if (n && mean < 20) { dn.hidden = false; dn.innerHTML = "<b>Few cells per square.</b> Count all four corners, or spin the cells down and resuspend in less medium."; }
    else dn.hidden = true;

    if (bad || total !== total || !n) {
      out.wait = bad || (n && total !== total) ? "Check the highlighted value." : "Type the live count in square 1.";
      return out;
    }
    out.conc = mean * total * 1e4;
    if (vL + vD > 0) out.via = vL / (vL + vD);
    out.said = "= " + LM.fmt(mean, 4) + " × " + LM.fmt(total, 4) + " × 10⁴";
    return out;
  }

  function count() {
    ["conc", "via"].forEach(function (id) { setMsg(id, ""); });
    var out;
    if (state.mode === "hemo") out = hemo();
    else {
      out = { conc: null, via: null };
      var c = num("conc"), via = num("via", { max: 100, maxMsg: "100% at most" });
      if (c == null || isNaN(c)) out.wait = c == null ? "Type your live cell count." : "Check the highlighted value.";
      else {
        out.conc = c * parseFloat($("concu").value);
        if (via != null && !isNaN(via)) out.via = via / 100;
        out.said = "from your count";
      }
    }
    if (out.conc == null) {
      $("countOut").innerHTML = '<span class="cs-k">LIVE CELLS</span><span class="cs-wait">' + out.wait + "</span>";
      return out;
    }
    var html = '<span class="cs-k">LIVE CELLS</span><div class="cs-big"><b>' + cells(out.conc) + "</b> /mL</div><div class=\"cs-line\">";
    if (out.via != null) html += '<span class="cs-via' + (out.via < 0.8 ? " is-low" : "") + '">VIABILITY <b>' + LM.fmt(out.via * 100, 3) + "%</b></span>";
    else if (state.mode === "hemo") html += '<span class="cs-via">VIABILITY <b>—</b> add dead counts</span>';
    html += '<span class="cs-said">' + out.said + "</span></div>";
    var have = num("have");
    if (have && !isNaN(have)) { out.have = have; html += '<div class="cs-said">' + cells(out.conc * have) + " live cells in " + LM.fmt(have) + " mL</div>"; }
    $("countOut").innerHTML = html;
    out.notes = [];
    if (out.via != null && out.via < 0.8) out.notes.push('<li class="note">Viability is ' + LM.fmt(out.via * 100, 3) + "% — below the ~80–90% many protocols expect for seeding.</li>");
    return out;
  }

  // ---------- 2 · seed ----------
  function seed(ct) {
    ["dens", "wells", "wv", "over"].forEach(function (id) { setMsg(id, ""); });
    var v = vessel();
    $("vesselInfo").textContent = "≈ " + LM.fmt(v[2]) + " cm² · usually " + vol(v[3]) + " per " + v[4].replace(/s$/, "").replace("dishe", "dish");
    $("wellsU").textContent = v[4];
    var dens = num("dens"), n = num("wells", { int: true }), wv = num("wv"), over = num("over", { zero: true });
    if (over == null) over = 0;
    var notes = (ct.notes || []).slice();
    if ([dens, n, wv, over].some(function (x) { return x !== null && isNaN(x); })) return empty("Check the highlighted value.", true, notes);
    if (dens == null || n == null || wv == null) return empty("Fill in cells to seed, number of wells and volume per well.", false, notes);
    if (!ct.conc) return empty("Count first — step 1.", false, notes);

    var wvmL = $("wvu").value === "mL" ? wv : wv / 1000;
    var perWell = $("densu").value === "cm2" ? dens * v[2] : dens;
    var nEff = n * (1 + over / 100);
    var totalVol = wvmL * nEff;               // mL
    var totalCells = perWell * nEff;
    var susp = totalCells / ct.conc;          // mL of cell suspension
    var medium = totalVol - susp;

    $("ans").classList.remove("is-empty", "is-error");
    $("copy").disabled = false; $("print").disabled = false;
    $("slip").classList.remove("is-empty");
    $("slipN").textContent = n + " " + v[4].toUpperCase() + (over ? " + " + LM.fmt(over) + "%" : "");
    $("rCells").textContent = cells(perWell);
    $("rWell").textContent = vol(wvmL);

    if (medium < 0) {
      // too dilute: spin and resuspend
      var target = totalCells / totalVol; // cells/mL needed
      var resusp = (ct.have ? ct.conc * ct.have : null);
      $("ansBig").textContent = "Cells too dilute";
      $("ansSay").innerHTML = "You'd need " + vol(susp) + " of suspension but the whole mix is only " + vol(totalVol) +
        ". Spin the cells down and resuspend at <b>" + cells(target) + " cells/mL</b> or more" +
        (resusp ? " — e.g. all " + cells(resusp) + " cells in " + vol(resusp / target) : "") + ".";
      $("rSusp").textContent = vol(susp); $("rMed").textContent = "—"; $("rTot").textContent = vol(totalVol);
      notes.unshift( '<li class="note"><b>Not enough cells per mL to reach ' + cells(perWell) + " cells in " + LM.esc(volPlain(wvmL)) + ".</b> Concentrate the cells first.</li>");
      $("notes").innerHTML = notes.join("");
      lastText = "";
      $("copy").disabled = true;
      return;
    }
    $("ansBig").textContent = vol(susp) + " cells + " + vol(medium) + " medium";
    $("ansSay").innerHTML = "Mix <b>" + vol(susp) + "</b> of cell suspension with <b>" + vol(medium) + "</b> of medium (" + vol(totalVol) +
      " total), then put <b>" + vol(wvmL) + "</b> in each of " + n + " " + v[4] + " — " + cells(perWell) + " cells each.";
    $("rSusp").textContent = vol(susp); $("rMed").textContent = vol(medium); $("rTot").textContent = vol(totalVol);

    if (susp < 0.002) notes.push('<li class="note">Only ' + LM.esc(volPlain(susp)) + " of cell suspension — hard to pipette accurately. Dilute the cells 1:10 in medium first and use 10× the volume.</li>");
    if (ct.have && susp > ct.have) notes.push('<li class="note"><b>You need ' + LM.esc(volPlain(susp)) + " of suspension but have " + LM.fmt(ct.have) + " mL.</b> Seed fewer wells or fewer cells per well.</li>");
    if ($("densu").value === "well" && perWell / v[2] > 3e5) notes.push('<li class="note info">That is ' + cells(perWell / v[2]) + " cells/cm² — dense for most adherent lines. Check it's what you intend.</li>");
    $("notes").innerHTML = notes.join("");

    lastText = ["Cell seeding — labmate.tools",
      "Count: " + cellsPlain(ct.conc) + " live cells/mL" + (ct.via != null ? ", " + LM.fmtPlain(ct.via * 100, 3) + "% viable" : ""),
      v[1] + ": " + n + " " + v[4] + (over ? " + " + LM.fmtPlain(over) + "% extra" : "") + ", " + cellsPlain(perWell) + " cells in " + volPlain(wvmL) + " each",
      "", "Cell suspension\t" + volPlain(susp), "Medium\t" + volPlain(medium), "Total\t" + volPlain(totalVol), "Per well\t" + volPlain(wvmL)].join("\n");
  }

  function empty(title, isErr, notes) {
    $("ans").classList.toggle("is-error", !!isErr); $("ans").classList.toggle("is-empty", !isErr);
    $("copy").disabled = true; $("print").disabled = true;
    $("ansBig").textContent = title; $("ansSay").textContent = "";
    $("slip").classList.add("is-empty");
    ["rSusp", "rMed", "rTot", "rWell", "rCells"].forEach(function (id) { $(id).textContent = "—"; });
    $("slipN").textContent = "";
    $("notes").innerHTML = (notes || []).join("");
    lastText = "";
  }

  function update() {
    FIELDS.forEach(function (id) { state[id] = $(id).value; });
    state.pre = $("preOn").checked;
    LM.save(KEY, state);
    seed(count());
  }
  function setMode(m) {
    state.mode = m;
    $("hemo").hidden = m !== "hemo"; $("direct").hidden = m !== "direct"; $("hemoDil").hidden = m !== "hemo";
    $("modeSeg").querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-v") === m)); });
    update();
  }

  // ---------- events ----------
  $("modeSeg").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) setMode(b.getAttribute("data-v")); });
  FIELDS.forEach(function (id) { $(id).addEventListener("input", update); $(id).addEventListener("change", update); });
  $("preOn").addEventListener("change", function () { update(); if (state.pre) $("pc").focus(); });
  document.querySelectorAll("[data-pre], [data-tb]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var isPre = btn.hasAttribute("data-pre"), v = btn.getAttribute(isPre ? "data-pre" : "data-tb").split(",");
      $(isPre ? "pc" : "tc").value = v[0]; $(isPre ? "pd" : "td").value = v[1];
      update();
    });
  });
  $("vessel").addEventListener("change", function () {
    var v = vessel();
    // fill the usual medium volume for the new vessel
    if (v[3] < 1) { $("wv").value = LM.fmtPlain(v[3] * 1000); $("wvu").value = "µL"; } else { $("wv").value = LM.fmtPlain(v[3]); $("wvu").value = "mL"; }
    update();
  });
  $("clear").addEventListener("click", function () {
    ["l1", "l2", "l3", "l4", "d1", "d2", "d3", "d4", "conc", "via", "have", "dens", "wells"].forEach(function (id) { $(id).value = ""; });
    $("preOn").checked = false;
    update(); (state.mode === "hemo" ? $("l1") : $("conc")).focus();
  });
  $("copy").addEventListener("click", function () {
    if (!lastText) return;
    LM.copy(lastText, function (ok) {
      $("copied").textContent = ok ? "COPIED ✓" : "Copy failed";
      setTimeout(function () { $("copied").textContent = ""; }, 2200);
    });
  });
  $("print").addEventListener("click", function () { window.print(); });

  FIELDS.forEach(function (id) { if (state[id] != null) $(id).value = state[id]; });
  $("preOn").checked = !!state.pre;
  if (!$("vessel").value) $("vessel").value = "96";
  setMode(state.mode === "direct" ? "direct" : "hemo");
})();
