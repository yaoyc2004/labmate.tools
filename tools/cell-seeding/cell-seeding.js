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
  var EXAMPLE = { mode: "hemo", live: "52 48 50 55", dead: "3 5 2 4", df: "2", conc: "", concu: "1e6", via: "", have: "",
    vessel: "96", dens: "1e4", densu: "well", wells: "60", wv: "100", wvu: "µL", over: "10" };
  var FIELDS = ["live", "dead", "df", "conc", "concu", "via", "have", "vessel", "dens", "densu", "wells", "wv", "wvu", "over"];

  var $ = function (id) { return document.getElementById(id); };
  VESSELS.forEach(function (v) {
    var o = document.createElement("option"); o.value = v[0]; o.textContent = v[1]; $("vessel").appendChild(o);
  });
  var state = LM.load(KEY) || JSON.parse(JSON.stringify(EXAMPLE));
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
  function list(id) {
    var raw = $(id).value.trim();
    if (!raw) return null;
    var parts = raw.split(/[\s,;]+/).filter(Boolean).map(LM.parse);
    if (parts.some(function (x) { return x == null || isNaN(x) || x < 0; })) { setMsg(id, "Numbers only, one per square"); return NaN; }
    return parts;
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
  function count() {
    ["live", "dead", "df", "conc", "via"].forEach(function (id) { setMsg(id, ""); });
    var out = { conc: null, via: null };
    if (state.mode === "hemo") {
      var live = list("live"), dead = list("dead"), df = num("df");
      if (live && live === live && dead && dead === dead && dead.length !== live.length) setMsg("dead", "Count the same " + live.length + " squares");
      if (!live || live !== live || df == null || isNaN(df)) {
        $("countOut").innerHTML = '<span class="cs-wait">' + (live == null ? "Type your square counts above." : "Check the highlighted value.") + "</span>";
        return out;
      }
      var meanL = live.reduce(function (a, b) { return a + b; }, 0) / live.length;
      out.conc = meanL * df * 1e4;
      var said = live.length + " square" + (live.length > 1 ? "s" : "") + " · mean " + LM.fmt(meanL, 4) + " · ×" + LM.fmt(df) + " · ×10⁴";
      if (dead && dead === dead && dead.length === live.length) {
        var sl = live.reduce(function (a, b) { return a + b; }, 0), sd = dead.reduce(function (a, b) { return a + b; }, 0);
        out.via = sl + sd > 0 ? sl / (sl + sd) : null;
        out.total = (sl + sd) / live.length * df * 1e4;
      }
      out.meanL = meanL;
      out.said = said;
    } else {
      var c = num("conc"), via = num("via", { max: 100, maxMsg: "100% at most" });
      if (c == null || isNaN(c)) {
        $("countOut").innerHTML = '<span class="cs-wait">' + (c == null ? "Type your live cell count above." : "Check the highlighted value.") + "</span>";
        return out;
      }
      out.conc = c * parseFloat($("concu").value);
      if (via != null && !isNaN(via)) out.via = via / 100;
      out.said = "from your count";
    }
    var html = '<div class="cs-big"><b>' + cells(out.conc) + "</b> live cells/mL</div>";
    if (out.via != null) html += '<div class="cs-via' + (out.via < 0.8 ? " is-low" : "") + '"><b>' + LM.fmt(out.via * 100, 3) + "%</b> viable</div>";
    html += '<div class="cs-said">' + out.said + "</div>";
    var have = num("have");
    if (have && !isNaN(have)) { out.have = have; html += '<div class="cs-said">' + cells(out.conc * have) + " live cells in " + LM.fmt(have) + " mL</div>"; }
    $("countOut").innerHTML = html;
    out.notes = [];
    if (out.meanL != null && (out.meanL < 20 || out.meanL > 100))
      out.notes.push('<li class="note info">' + LM.fmt(out.meanL, 3) + " cells per square is " + (out.meanL < 20 ? "low" : "high") +
        " — counts are most reliable around 20–100 per square. Consider " + (out.meanL < 20 ? "concentrating" : "diluting") + " and recounting.</li>");
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
    LM.save(KEY, state);
    seed(count());
  }
  function setMode(m) {
    state.mode = m;
    $("hemo").hidden = m !== "hemo"; $("direct").hidden = m !== "direct";
    $("modeSeg").querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-v") === m)); });
    update();
  }

  // ---------- events ----------
  $("modeSeg").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) setMode(b.getAttribute("data-v")); });
  FIELDS.forEach(function (id) { $(id).addEventListener("input", update); $(id).addEventListener("change", update); });
  $("vessel").addEventListener("change", function () {
    var v = vessel();
    // fill the usual medium volume for the new vessel
    if (v[3] < 1) { $("wv").value = LM.fmtPlain(v[3] * 1000); $("wvu").value = "µL"; } else { $("wv").value = LM.fmtPlain(v[3]); $("wvu").value = "mL"; }
    update();
  });
  $("clear").addEventListener("click", function () {
    ["live", "dead", "conc", "via", "have", "dens", "wells"].forEach(function (id) { $(id).value = ""; });
    update(); (state.mode === "hemo" ? $("live") : $("conc")).focus();
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
  if (!$("vessel").value) $("vessel").value = "96";
  setMode(state.mode === "direct" ? "direct" : "hemo");
})();
