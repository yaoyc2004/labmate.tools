// labmate.tools — 2.3 Molarity (m = c × V × M) + concentration converter
(function () {
  "use strict";
  var LM = window.LM;
  var KEY = "lm-molarity-v1";

  // Formula weights, g/mol
  var PRESETS = [
    ["NaCl", 58.44], ["KCl", 74.55], ["Tris base", 121.14], ["Tris-HCl", 157.60],
    ["Na₂EDTA·2H₂O", 372.24], ["MgCl₂·6H₂O", 203.30], ["CaCl₂·2H₂O", 147.01], ["NaOH", 40.00],
    ["HEPES", 238.30], ["Glucose", 180.16], ["Sucrose", 342.30], ["SDS", 288.38], ["DTT", 154.25]
  ];
  var MW_UNITS = [["g/mol", 1], ["kDa", 1000]];
  var PCT = [["% w/v", 10]]; // g/L
  var MASSC_ALL = LM.MASSC.concat(PCT);
  var TERMS = ["c", "v", "m"];
  var NAMES = { c: "concentration", v: "volume", m: "mass" };
  var EXAMPLE = { mw: "58.44", mwu: "g/mol", name: "NaCl", solve: "m", c: ["1", "M"], v: ["500", "mL"], m: ["", "g"], x: ["1", "mg/mL"] };

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  ["c", "v", "m", "x"].forEach(function (t) {
    el[t] = { box: document.querySelector('[data-term="' + t + '"]'), inp: $(t), unit: $(t + "u"), msg: $(t + "m") };
  });
  LM.fillSelect(el.c.unit, [["", LM.MOLAR]]);
  LM.fillSelect(el.v.unit, [["", LM.VOL]]);
  LM.fillSelect(el.m.unit, [["", LM.MASS]]);
  LM.fillSelect(el.x.unit, [["Mass / volume", MASSC_ALL], ["Molar", LM.MOLAR]]);
  var TABLE = { c: LM.MOLAR, v: LM.VOL, m: LM.MASS };

  // presets
  var presetBox = $("presets");
  PRESETS.forEach(function (p) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "chip";
    b.setAttribute("aria-pressed", "false");
    b.innerHTML = LM.esc(p[0]) + "<small>" + p[1].toFixed(2) + "</small>";
    b.addEventListener("click", function () {
      $("mw").value = p[1].toFixed(2); $("mwu").value = "g/mol"; $("name").value = p[0];
      update();
    });
    presetBox.appendChild(b);
  });

  var state = LM.load(KEY);
  if (!state || TERMS.indexOf(state.solve) < 0) state = JSON.parse(JSON.stringify(EXAMPLE));
  var unitLocked = false;
  var lastRecipe = "";

  function setUnit(sel, u) {
    if (Array.prototype.some.call(sel.options, function (o) { return o.value === u; })) sel.value = u;
  }
  function applyState() {
    $("mw").value = state.mw || ""; setUnit($("mwu"), state.mwu || "g/mol"); $("name").value = state.name || "";
    ["c", "v", "m", "x"].forEach(function (t) {
      var s = state[t] || EXAMPLE[t];
      el[t].inp.value = s[0]; setUnit(el[t].unit, s[1]);
    });
    setSolve(state.solve);
  }

  function setSolve(t) {
    state.solve = t; unitLocked = false;
    document.querySelectorAll("#solveSeg button").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-solve") === t ? "true" : "false");
    });
    TERMS.forEach(function (k) {
      var solved = k === t;
      el[k].box.classList.toggle("is-solved", solved);
      el[k].inp.readOnly = solved;
      el[k].inp.tabIndex = solved ? -1 : 0;
      el[k].inp.placeholder = solved ? "?" : "";
      var base = { c: "CONCENTRATION", v: "FINAL VOLUME", m: k === "m" && t === "m" ? "MASS TO WEIGH" : "MASS" }[k];
      el[k].box.querySelector(".term-name").textContent = solved ? "SOLVING · " + base : base;
    });
    el[t].inp.value = "";
    update();
  }

  function setMsg(t, text) {
    var m = t === "mw" ? $("mwm") : el[t].msg;
    var box = t === "mw" ? document.querySelector('[data-term="mw"]') : el[t].box;
    m.textContent = text || "";
    box.classList.toggle("is-bad", !!text);
  }

  // returns g/mol, or null (empty) / NaN (bad)
  function readMW() {
    var v = LM.parse($("mw").value);
    setMsg("mw", "");
    if (v == null) return null;
    if (isNaN(v)) { setMsg("mw", "Not a number"); return NaN; }
    if (v <= 0) { setMsg("mw", "Must be above zero"); return NaN; }
    return v * LM.factor(MW_UNITS, $("mwu").value);
  }

  function syncPresets() {
    var mw = $("mw").value.trim(), name = $("name").value.trim();
    presetBox.querySelectorAll(".chip").forEach(function (b, i) {
      var p = PRESETS[i];
      b.setAttribute("aria-pressed", String(p[0] === name && LM.parse(mw) === p[1] && $("mwu").value === "g/mol"));
    });
  }

  function update() {
    syncPresets();
    var mw = readMW();
    solveMain(mw);
    convert(mw);
    save();
  }

  // ---------- main: m = c × V × M ----------
  function solveMain(mw) {
    var solve = state.solve, vals = {}, missing = [], bad = false;
    TERMS.forEach(function (t) { setMsg(t, ""); });
    TERMS.forEach(function (t) {
      if (t === solve) return;
      var raw = LM.parse(el[t].inp.value);
      vals[t] = raw == null || isNaN(raw) ? raw : raw * LM.factor(TABLE[t], el[t].unit.value);
      if (raw == null) missing.push(t);
      else if (isNaN(raw)) { setMsg(t, "Not a number"); bad = true; }
      else if (raw <= 0) { setMsg(t, "Must be above zero"); bad = true; }
    });
    if (mw == null) missing.unshift("mw");
    if (bad || (mw !== null && isNaN(mw))) return showError("Check the highlighted value.");
    if (missing.length) return showEmpty(missing);

    var c = vals.c, v = vals.v, m = vals.m;
    if (solve === "m") m = c * v * mw;
    if (solve === "c") c = m / (v * mw);
    if (solve === "v") v = m / (c * mw);

    var r = { c: c, v: v, m: m };
    if (!unitLocked) el[solve].unit.value = LM.best(r[solve], TABLE[solve])[0];
    el[solve].inp.value = LM.fmtPlain(r[solve] / LM.factor(TABLE[solve], el[solve].unit.value));
    showResult(r, mw);
  }

  function showResult(r, mw) {
    var solve = state.solve, name = $("name").value.trim();
    var what = name ? LM.esc(name) : "the compound";
    var mT = LM.show(r.m, LM.MASS), vT = LM.show(r.v, LM.VOL), cT = LM.show(r.c, LM.MOLAR);
    var mwT = LM.fmt(mw, 5) + " g/mol";
    $("ans").classList.remove("is-empty", "is-error");
    $("copy").disabled = false;
    $("ansBig").innerHTML = '<span class="eq">' + ({ m: "m", c: "c", v: "V" })[solve] + "</span> = " + LM.show(r[solve], TABLE[solve]);
    if (solve === "m") $("ansSay").innerHTML = "Weigh <b>" + mT + "</b> of " + what + " and make up to <b>" + vT + "</b> for " + cT + ".";
    if (solve === "c") $("ansSay").innerHTML = mT + " of " + what + " in " + vT + " is <b>" + cT + "</b>.";
    if (solve === "v") $("ansSay").innerHTML = "Dissolve " + mT + " of " + what + " and make up to <b>" + vT + "</b> for " + cT + ".";

    $("slip").classList.remove("is-empty");
    $("slipName").textContent = (name ? name.toUpperCase() + " · " : "") + mwT;
    $("rMass").textContent = mT;
    $("rDissolve").textContent = "~" + LM.show(r.v * 0.8, LM.VOL, 2);
    $("rVol").textContent = vT;
    $("rConc").textContent = cT;

    var notes = [];
    if (r.m < 1e-3) {
      notes.push('<li class="note"><b>' + LM.esc(LM.showPlain(r.m, LM.MASS)) + " is too little to weigh accurately on most balances.</b> " +
        "Weigh more into a larger volume (for example, " + LM.esc(LM.showPlain(r.c * 1000, LM.MOLAR)) + " — 1000× stronger) and dilute it with the <a href=\"../dilution/\">Dilution</a> tool.</li>");
    } else if (r.m < 10e-3) {
      notes.push('<li class="note info">Under 10 mg: use an analytical balance and weigh by difference.</li>');
    }
    if (r.m > 0 && r.v > 0 && r.m / (r.v * 1000) > 0.5) {
      notes.push('<li class="note">That is over 500 g per litre — check that it will dissolve, and that the MW and units are right.</li>');
    }
    $("notes").innerHTML = notes.join("");

    lastRecipe = [
      "Molarity — labmate.tools",
      (name || "Compound") + ", MW " + LM.fmtPlain(mw, 5) + " g/mol",
      "Weigh:       " + LM.showPlain(r.m, LM.MASS),
      "Dissolve in: ~" + LM.showPlain(r.v * 0.8, LM.VOL, 2),
      "Make up to:  " + LM.showPlain(r.v, LM.VOL),
      "Gives:       " + LM.showPlain(r.c, LM.MOLAR)
    ].join("\n");
  }

  function showEmpty(missing) {
    $("ans").classList.add("is-empty"); $("ans").classList.remove("is-error");
    $("copy").disabled = true;
    el[state.solve].inp.value = "";
    var names = missing.map(function (t) { return t === "mw" ? "molecular weight" : NAMES[t]; });
    $("ansBig").textContent = "Waiting for " + names.join(", ").replace(/, ([^,]*)$/, " and $1");
    $("ansSay").textContent = "Fill in the molecular weight and the other two boxes to solve for " + NAMES[state.solve] + ".";
    clearSlip();
  }
  function showError(title) {
    $("ans").classList.add("is-error"); $("ans").classList.remove("is-empty");
    $("copy").disabled = true;
    el[state.solve].inp.value = "";
    $("ansBig").textContent = title;
    $("ansSay").textContent = "";
    clearSlip();
  }
  function clearSlip() {
    $("slip").classList.add("is-empty");
    ["rMass", "rDissolve", "rVol", "rConc"].forEach(function (id) { $(id).textContent = "—"; });
    $("slipName").textContent = "";
    $("notes").innerHTML = "";
    lastRecipe = "";
  }

  // ---------- converter ----------
  var MOLAR_ROWS = LM.MOLAR;
  var MASS_ROWS = [["mg/mL", 1, "mg/mL · g/L"], ["µg/mL", 1e-3, "µg/mL · ng/µL"], ["ng/mL", 1e-6, "ng/mL"], ["% w/v", 10, "% w/v"]];

  function convert(mw) {
    setMsg("x", "");
    var raw = LM.parse(el.x.inp.value), unit = el.x.unit.value;
    var isMolar = !!LM.factor(LM.MOLAR, unit);
    var molar = null, mass = null; // mol/L and g/L
    var say = "";
    if (raw != null && isNaN(raw)) setMsg("x", "Not a number");
    else if (raw != null && raw < 0) setMsg("x", "Can't be negative");
    else if (raw != null) {
      if (isMolar) molar = raw * LM.factor(LM.MOLAR, unit);
      else mass = raw * LM.factor(MASSC_ALL, unit);
      if (mw && !isNaN(mw)) {
        if (isMolar) mass = molar * mw; else molar = mass / mw;
      }
      if (!mw || isNaN(mw)) say = "Enter the molecular weight above to convert between molar and mass units.";
      else say = LM.fmt(raw) + " " + unit + " = <b>" + (isMolar ? LM.show(mass, LM.MASSC) : LM.show(molar, LM.MOLAR)) + "</b> at " + LM.fmt(mw, 5) + " g/mol.";
    }
    $("convSay").innerHTML = say;
    $("convMolar").innerHTML = MOLAR_ROWS.map(function (u) {
      return row(molar == null ? null : molar / u[1], u[0], isMolar && u[0] === unit);
    }).join("");
    $("convMass").innerHTML = MASS_ROWS.map(function (u) {
      var src = !isMolar && (u[0] === unit || (u[0] === "mg/mL" && unit === "µg/µL") || (u[0] === "µg/mL" && unit === "ng/µL"));
      return row(mass == null ? null : mass / u[1], u[2], src);
    }).join("");
  }
  function row(v, label, src) {
    return '<tr' + (src ? ' class="is-src"' : "") + '><td class="v">' + (v == null ? "—" : LM.fmt(v)) + '</td><td class="u">' + LM.esc(label) + "</td></tr>";
  }

  function save() {
    var s = { mw: $("mw").value, mwu: $("mwu").value, name: $("name").value, solve: state.solve };
    ["c", "v", "m", "x"].forEach(function (t) { s[t] = [t === state.solve ? "" : el[t].inp.value, el[t].unit.value]; });
    LM.save(KEY, s);
  }

  // ---------- events ----------
  document.querySelectorAll("#solveSeg button").forEach(function (b) {
    b.addEventListener("click", function () { setSolve(b.getAttribute("data-solve")); });
  });
  ["mw", "name"].forEach(function (id) { $(id).addEventListener("input", update); });
  $("mwu").addEventListener("change", update);
  ["c", "v", "m", "x"].forEach(function (t) {
    el[t].inp.addEventListener("input", update);
    el[t].unit.addEventListener("change", function () { if (t === state.solve) unitLocked = true; update(); });
  });
  $("clear").addEventListener("click", function () {
    ["mw", "name"].forEach(function (id) { $(id).value = ""; });
    ["c", "v", "m", "x"].forEach(function (t) { el[t].inp.value = ""; });
    update();
    $("mw").focus();
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
