// labmate.tools — 2.2 Dilution (C1V1 = C2V2)
(function () {
  "use strict";
  var LM = window.LM;
  var KEY = "lm-dilution-v1";

  var CONC_GROUPS = [["Molar", LM.MOLAR], ["Mass / volume", LM.MASSC], ["Other", [["%", 1], ["X", 1]]]];
  var CONC_KIND = {};
  LM.MOLAR.forEach(function (u) { CONC_KIND[u[0]] = "molar"; });
  LM.MASSC.forEach(function (u) { CONC_KIND[u[0]] = "mass"; });
  CONC_KIND["%"] = "pct"; CONC_KIND["X"] = "x";
  var KIND_TABLE = { molar: LM.MOLAR, mass: LM.MASSC, pct: [["%", 1]], x: [["X", 1]] };
  var KIND_NAME = { molar: "molar (M, mM, µM…)", mass: "mass per volume (mg/mL, ng/µL…)", pct: "percent", x: "X (fold)" };
  function cf(unit) { return LM.factor(KIND_TABLE[CONC_KIND[unit]], unit); }
  function vf(unit) { return LM.factor(LM.VOL, unit); }
  function isConc(t) { return t === "c1" || t === "c2"; }

  var EXAMPLE = { solve: "v1", c1: ["1", "mM"], v1: ["", "µL"], c2: ["10", "µM"], v2: ["1", "mL"] };
  var TERMS = ["c1", "v1", "c2", "v2"];
  var SYM = { c1: "C<sub>1</sub>", v1: "V<sub>1</sub>", c2: "C<sub>2</sub>", v2: "V<sub>2</sub>" };

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  TERMS.forEach(function (t) {
    el[t] = { box: document.querySelector('[data-term="' + t + '"]'), inp: $(t), unit: $(t + "u"), msg: $(t + "m") };
  });
  LM.fillSelect(el.c1.unit, CONC_GROUPS);
  LM.fillSelect(el.c2.unit, CONC_GROUPS);
  LM.fillSelect(el.v1.unit, [["", LM.VOL]]);
  LM.fillSelect(el.v2.unit, [["", LM.VOL]]);

  var state = LM.load(KEY);
  if (!state || TERMS.indexOf(state.solve) < 0) state = JSON.parse(JSON.stringify(EXAMPLE));
  var unitLocked = false; // user picked the unit of the solved field by hand
  var lastRecipe = "";

  function applyState() {
    TERMS.forEach(function (t) {
      var s = state[t] || EXAMPLE[t];
      el[t].inp.value = s[0];
      if (Array.prototype.some.call(el[t].unit.options, function (o) { return o.value === s[1]; })) el[t].unit.value = s[1];
    });
    setSolve(state.solve, true);
  }

  function setSolve(t, quiet) {
    // the previous answer stays in its box as a known value
    state.solve = t;
    unitLocked = false;
    document.querySelectorAll("#solveSeg button").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-solve") === t ? "true" : "false");
    });
    TERMS.forEach(function (k) {
      var solved = k === t;
      el[k].box.classList.toggle("is-solved", solved);
      el[k].inp.readOnly = solved;
      el[k].inp.tabIndex = solved ? -1 : 0;
      el[k].inp.placeholder = solved ? "?" : "";
      el[k].box.querySelector(".term-name").textContent = labelFor(k, solved);
    });
    if (!quiet) { el[t].inp.value = ""; }
    update();
  }

  function labelFor(k, solved) {
    var base = { c1: "STOCK CONC.", v1: "STOCK TO ADD", c2: "FINAL CONC.", v2: "FINAL VOLUME" }[k];
    return solved ? "SOLVING · " + base : base;
  }

  function read(t) {
    var v = LM.parse(el[t].inp.value);
    var u = el[t].unit.value;
    var base = v == null || isNaN(v) ? v : v * (isConc(t) ? cf(u) : vf(u));
    return { raw: v, unit: u, base: base };
  }

  function setMsg(t, text) {
    el[t].msg.textContent = text || "";
    el[t].box.classList.toggle("is-bad", !!text);
  }

  function update() {
    var solve = state.solve;
    var known = TERMS.filter(function (t) { return t !== solve; });
    var vals = {};
    var missing = [];
    var bad = false;
    TERMS.forEach(function (t) { setMsg(t, ""); });

    known.forEach(function (t) {
      var r = read(t);
      vals[t] = r;
      if (r.raw == null) missing.push(t);
      else if (isNaN(r.raw)) { setMsg(t, "Not a number"); bad = true; }
      else if (r.raw <= 0) { setMsg(t, "Must be above zero"); bad = true; }
    });

    // the solved concentration takes the kind of the known one
    if (isConc(solve)) {
      var other = solve === "c1" ? "c2" : "c1";
      var ok = CONC_KIND[el[other].unit.value];
      if (CONC_KIND[el[solve].unit.value] !== ok) el[solve].unit.value = el[other].unit.value;
    }

    save();
    if (bad) return showError("Check the highlighted value.");
    if (missing.length) return showEmpty(missing);

    if (!isConc(solve)) {
      var k1 = CONC_KIND[vals.c1.unit], k2 = CONC_KIND[vals.c2.unit];
      if (k1 !== k2) {
        setMsg("c2", "Different kind from C₁");
        return showError("C₁ and C₂ must be the same kind of unit.",
          "C₁ is " + KIND_NAME[k1] + ", C₂ is " + KIND_NAME[k2] + ". To convert between molar and mass units you need the molecular weight — use the <a href=\"../molarity/\">Molarity tool</a>.");
      }
    }

    var c1 = solve === "c1" ? null : vals.c1.base;
    var v1 = solve === "v1" ? null : vals.v1.base;
    var c2 = solve === "c2" ? null : vals.c2.base;
    var v2 = solve === "v2" ? null : vals.v2.base;
    if (solve === "v1") v1 = (c2 * v2) / c1;
    if (solve === "v2") v2 = (c1 * v1) / c2;
    if (solve === "c1") c1 = (c2 * v2) / v1;
    if (solve === "c2") c2 = (c1 * v1) / v2;

    // write the answer into the solved field
    var t = solve, table = isConc(t) ? KIND_TABLE[CONC_KIND[el[t].unit.value]] : LM.VOL;
    var baseVal = { c1: c1, v1: v1, c2: c2, v2: v2 }[t];
    if (!unitLocked) el[t].unit.value = LM.best(baseVal, table)[0];
    var f = LM.factor(table, el[t].unit.value);
    el[t].inp.value = LM.fmtPlain(baseVal / f);

    var rel = 1e-9;
    if (c2 > c1 * (1 + rel)) {
      var why = solve === "v1" ? "Stock needed would be more than the final volume."
        : solve === "v2" ? "Final volume would be less than the stock you add."
        : solve === "c1" ? "The stock volume is larger than the final volume."
        : "";
      return showError("Final can't be stronger than the stock.",
        (why ? why + " " : "") + "A dilution only lowers concentration — check C₂ against C₁ and V₁ against V₂.");
    }

    showResult({ c1: c1, v1: v1, c2: c2, v2: v2 });
  }

  function concText(base, unitRef) {
    var table = KIND_TABLE[CONC_KIND[unitRef]];
    if (table.length === 1) return LM.fmt(base) + (unitRef === "%" ? "%" : "X");
    return LM.show(base, table);
  }
  function concPlain(base, unitRef) {
    var table = KIND_TABLE[CONC_KIND[unitRef]];
    if (table.length === 1) return LM.fmtPlain(base) + (unitRef === "%" ? "%" : "X");
    return LM.showPlain(base, table);
  }

  function showResult(r) {
    var ans = $("ans"), solve = state.solve;
    ans.classList.remove("is-empty", "is-error");
    $("copy").disabled = false;
    var cu = el.c1.unit.value;
    var solvedText = isConc(solve) ? concText(r[solve], el[solve].unit.value) : LM.show(r[solve], LM.VOL);
    $("ansBig").innerHTML = '<span class="eq">' + SYM[solve] + "</span> = " + solvedText;

    var dil = r.v2 - r.v1;
    if (dil < r.v2 * 1e-9) dil = 0;
    var F = r.c1 / r.c2;
    var stockT = LM.show(r.v1, LM.VOL), dilT = dil === 0 ? "0" : showDistinct(dil, r.v2), totalT = LM.show(r.v2, LM.VOL);
    var c1T = concText(r.c1, cu), c2T = concText(r.c2, el.c2.unit.value);
    var factorT = Math.abs(F - 1) < 1e-9 ? "no dilution" : "1:" + LM.fmt(F, F >= 1000 ? 4 : 3);

    $("ansSay").innerHTML = dil === 0
      ? "C₁ and C₂ are the same — use the stock as it is."
      : "Add <b>" + stockT + "</b> of " + c1T + " stock to <b>" + dilT + "</b> of diluent for " + totalT + " at " + c2T + ".";
    $("slip").classList.remove("is-empty");
    $("rStock").textContent = stockT + " @ " + c1T;
    $("rDil").textContent = dilT;
    $("rTotal").textContent = totalT + " @ " + c2T;
    $("slipFactor").textContent = factorT === "no dilution" ? "NO DILUTION" : "DILUTION " + factorT + " (" + LM.fmt(F, 3) + "×)";

    var notes = [];
    var UL = 1e-6;
    if (r.v1 < 1 * UL && dil > 0) notes.push(intermediateNote(r, F));
    else if (r.v1 < 2 * UL && dil > 0) {
      notes.push('<li class="note">' + LM.esc(LM.showPlain(r.v1, LM.VOL)) + " is near the bottom of a P2 or P10. Use the smallest pipette that covers it, and pipette into the diluent, not onto the tube wall.</li>");
    }
    if (dil > 0 && r.v1 / r.v2 > 0.5) {
      notes.push('<li class="note info">More than half the final volume is stock — a gentle dilution (' + LM.esc(factorT) + ").</li>");
    }
    $("notes").innerHTML = notes.join("");

    lastRecipe = [
      "Dilution — labmate.tools",
      concPlain(r.c1, cu) + " stock → " + concPlain(r.c2, el.c2.unit.value) + ", " + LM.showPlain(r.v2, LM.VOL) + " total" + (dil === 0 ? "" : " (" + factorT + ")"),
      "Stock:   " + LM.showPlain(r.v1, LM.VOL),
      "Diluent: " + (dil === 0 ? "0" : showDistinct(dil, r.v2).replace(/\u2009/g, "")),
      "Total:   " + LM.showPlain(r.v2, LM.VOL),
    ].join("\n");
    lastIntermediate && (lastRecipe += "\n" + lastIntermediate);
    lastIntermediate = "";
  }

  var lastIntermediate = "";
  // Diluent shown with enough digits that it doesn't look equal to the total (199.98 µL, not 200 µL).
  function showDistinct(a, b) {
    var sig = 4;
    while (sig < 7 && LM.show(a, LM.VOL, sig) === LM.show(b, LM.VOL, sig)) sig++;
    return LM.show(a, LM.VOL, sig);
  }
  // Stock volume under 1 µL: plan a 1:10 / 1:100 / 1:1000 intermediate so every step is ≥ 2 µL.
  function intermediateNote(r, F) {
    var UL = 1e-6, MIN = 2 * UL;
    var plan = null;
    [10, 100, 1000].some(function (f) {
      if (f >= F) return true; // intermediate must stay stronger than the final
      var take = r.v1 * f; // volume of intermediate needed
      if (take < MIN) return false;
      if (take > r.v2 * 0.9) return true;
      var stockPart = niceUp(Math.max(MIN, (take * 1.25) / f));
      plan = { f: f, take: take, stockPart: stockPart, total: stockPart * f };
      return true;
    });
    var head = "<b>" + LM.esc(LM.showPlain(r.v1, LM.VOL)) + " is too small to pipette accurately.</b> ";
    if (!plan) {
      return '<li class="note">' + head + "Make a larger final volume, or dilute the stock first so you take at least 2 µL.</li>";
    }
    var cu = el.c1.unit.value;
    var inter = r.c1 / plan.f;
    var s1 = "Make a 1:" + plan.f + " intermediate: " + LM.showPlain(plan.stockPart, LM.VOL) + " stock + " + LM.showPlain(plan.total - plan.stockPart, LM.VOL) + " diluent → " + concPlain(inter, cu) + ".";
    var s2 = "Then add " + LM.showPlain(plan.take, LM.VOL) + " of the intermediate to " + LM.showPlain(r.v2 - plan.take, LM.VOL) + " diluent → " + LM.showPlain(r.v2, LM.VOL) + " at " + concPlain(r.c2, el.c2.unit.value) + ".";
    lastIntermediate = "Two-step plan:\n  1. " + s1 + "\n  2. " + s2;
    return '<li class="note">' + head + "Do it in two steps:<ol class=\"steps\"><li>" + LM.esc(s1) + "</li><li>" + LM.esc(s2) + "</li></ol></li>";
  }
  function niceUp(x) {
    // round up to 1, 2, 2.5, 5 × 10^n
    var p = Math.pow(10, Math.floor(Math.log10(x)));
    var m = x / p;
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (m <= steps[i] + 1e-9) return steps[i] * p;
    return 10 * p;
  }

  function showEmpty(missing) {
    var ans = $("ans");
    ans.classList.add("is-empty"); ans.classList.remove("is-error");
    $("copy").disabled = true;
    el[state.solve].inp.value = "";
    var names = missing.map(function (t) { return { c1: "C₁", v1: "V₁", c2: "C₂", v2: "V₂" }[t]; });
    $("ansBig").textContent = "Waiting for " + names.join(", ").replace(/, ([^,]*)$/, " and $1");
    $("ansSay").textContent = "Fill in the other three values to solve for " + { c1: "C₁", v1: "V₁", c2: "C₂", v2: "V₂" }[state.solve] + ".";
    clearSlip();
  }
  function showError(title, detail) {
    var ans = $("ans");
    ans.classList.add("is-error"); ans.classList.remove("is-empty");
    $("copy").disabled = true;
    el[state.solve].inp.value = "";
    $("ansBig").textContent = title;
    $("ansSay").innerHTML = detail || "";
    clearSlip();
  }
  function clearSlip() {
    $("slip").classList.add("is-empty");
    $("rStock").textContent = "—"; $("rDil").textContent = "—"; $("rTotal").textContent = "—";
    $("slipFactor").textContent = "";
    $("notes").innerHTML = "";
    lastRecipe = ""; lastIntermediate = "";
  }

  function save() {
    var s = { solve: state.solve };
    TERMS.forEach(function (t) { s[t] = [t === state.solve ? "" : el[t].inp.value, el[t].unit.value]; });
    LM.save(KEY, s);
  }

  // ---------- events ----------
  document.querySelectorAll("#solveSeg button").forEach(function (b) {
    b.addEventListener("click", function () { setSolve(b.getAttribute("data-solve")); });
  });
  TERMS.forEach(function (t) {
    el[t].inp.addEventListener("input", update);
    el[t].unit.addEventListener("change", function () {
      if (t === state.solve) unitLocked = true;
      // keep the two concentrations the same kind when the user switches kind
      if (isConc(t) && t !== state.solve) {
        var other = t === "c1" ? "c2" : "c1";
        if (other === state.solve && CONC_KIND[el[other].unit.value] !== CONC_KIND[el[t].unit.value]) {
          el[other].unit.value = el[t].unit.value; unitLocked = false;
        }
      }
      update();
    });
    // clicking the solved box's header switches nothing; clicking a known box's symbol is just focus
  });
  $("clear").addEventListener("click", function () {
    TERMS.forEach(function (t) { el[t].inp.value = ""; });
    update();
    var first = TERMS.filter(function (t) { return t !== state.solve; })[0];
    el[first].inp.focus();
  });
  $("copy").addEventListener("click", function () {
    if (!lastRecipe) return;
    LM.copy(lastRecipe, function (ok) {
      $("copied").textContent = ok ? "COPIED ✓" : "Copy failed — select the text instead";
      setTimeout(function () { $("copied").textContent = ""; }, 2200);
    });
  });

  applyState();
})();
