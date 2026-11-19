/* labmate.tools — 9.1 Dosing Sheet: pure calculations (no DOM).
 * window.LMD. Algorithm id: labmate-dosing-1.
 * Units inside: weight in g, dose in mg/kg, concentration in mg/mL, volume in mL.
 */
(function () {
  "use strict";
  var D = (window.LMD = {});
  D.ALGO = "labmate-dosing-1";

  // ---------- reference volume limits ----------
  // good = good-practice volume, max = possible maximum. unit "kg" = mL/kg, "site" = mL per site.
  D.ROUTES = [
    { k: "po", name: "Oral gavage (PO)", short: "PO" },
    { k: "ip", name: "Intraperitoneal (IP)", short: "IP" },
    { k: "sc", name: "Subcutaneous (SC)", short: "SC" },
    { k: "ivb", name: "Intravenous bolus (IV)", short: "IV bolus" },
    { k: "ivs", name: "Intravenous, slow injection", short: "IV slow" },
    { k: "im", name: "Intramuscular (IM)", short: "IM" }
  ];
  D.SPECIES = [
    { k: "mouse", name: "Mouse", wMin: 5, wMax: 70 },
    { k: "rat", name: "Rat", wMin: 20, wMax: 1000 },
    { k: "other", name: "Other species", wMin: 0, wMax: Infinity }
  ];
  function L(good, max, unit) { return { good: good, max: max, unit: unit || "kg" }; }
  // Diehl et al. 2001, J Appl Toxicol 21:15–23 — "Administration volumes considered good practice (and possible maximal dose volumes)".
  var DIEHL = {
    mouse: { po: L(10, 50), sc: L(10, 40), ip: L(20, 80), ivb: L(5, 5), ivs: L(null, 25), im: L(0.05, 0.1, "site") },
    rat: { po: L(10, 40), sc: L(5, 10), ip: L(10, 20), ivb: L(5, 5), ivs: L(null, 20), im: L(0.1, 0.2, "site") }
  };
  // ULAM-based tables used by Wayne State and WVU IACUCs: "best practice per administration (maximum)".
  var ULAM = {
    mouse: { po: L(10, 20), sc: L(10, 40), ip: L(20, 80), ivb: L(5, 5), ivs: L(null, 25), im: L(0.05, 0.1, "site") },
    rat: { po: L(10, 20), sc: L(5, 20), ip: L(10, 20), ivb: L(5, 5), ivs: L(null, 20), im: L(0.1, 0.2, "site") }
  };
  function lower(a, b) {
    if (a == null) return b;
    if (b == null) return a;
    return Math.min(a, b);
  }
  var CONS = {};
  ["mouse", "rat"].forEach(function (s) {
    CONS[s] = {};
    D.ROUTES.forEach(function (r) {
      var a = DIEHL[s][r.k], b = ULAM[s][r.k];
      CONS[s][r.k] = L(lower(a.good, b.good), lower(a.max, b.max), a.unit);
    });
  });
  D.LIMIT_SETS = [
    { k: "diehl", name: "Diehl 2001", long: "Diehl et al. 2001 (J Appl Toxicol 21:15–23), good practice (possible maximum)", table: DIEHL },
    { k: "cons", name: "Conservative", long: "Lower of Diehl 2001 and the ULAM-based tables (Wayne State, WVU) in every cell", table: CONS },
    { k: "custom", name: "My institution", long: "Your own limits, typed on this page", table: null }
  ];
  D.copyLimits = function (species) {
    var src = DIEHL[species] || DIEHL.mouse, out = {};
    D.ROUTES.forEach(function (r) { var x = src[r.k]; out[r.k] = L(x.good, x.max, x.unit); });
    return out;
  };
  // the limit object for species/route under a limit set (custom: from state.custom)
  D.limitFor = function (setKey, species, route, custom) {
    if (setKey === "custom" || species === "other") {
      var c = custom && custom[species] && custom[species][route];
      return c ? L(c.good, c.max, c.unit) : null;
    }
    var set = D.LIMIT_SETS.filter(function (s) { return s.k === setKey; })[0] || D.LIMIT_SETS[0];
    var t = set.table[species];
    return t ? t[route] : null;
  };

  // ---------- syringes ----------
  D.SYRINGES = [
    { k: "ins03", name: "0.3 mL insulin", step: 0.005, cap: 0.3 },
    { k: "ins05", name: "0.5 mL insulin", step: 0.01, cap: 0.5 },
    { k: "tb1", name: "1 mL", step: 0.01, cap: 1 },
    { k: "s3", name: "3 mL", step: 0.1, cap: 3 },
    { k: "s5", name: "5 mL", step: 0.2, cap: 5 },
    { k: "ham100", name: "100 µL Hamilton", step: 0.001, cap: 0.1 },
    { k: "custom", name: "Other", step: null, cap: null }
  ];

  // ---------- vehicles (v/v %) ----------
  D.VEHICLES = [
    { k: "saline", name: "Saline", parts: [["Saline (0.9% NaCl)", 100]] },
    { k: "pbs", name: "PBS", parts: [["PBS", 100]] },
    { k: "corn", name: "Corn oil", parts: [["Corn oil", 100]] },
    { k: "cmc", name: "0.5% CMC-Na", parts: [["0.5% CMC-Na in water", 100]] },
    { k: "dpts", name: "DMSO / PEG300 / Tween-80 / saline", parts: [["DMSO", 10], ["PEG300", 40], ["Tween-80", 5], ["Saline (0.9% NaCl)", 45]] },
    { k: "dcorn", name: "10% DMSO in corn oil", parts: [["DMSO", 10], ["Corn oil", 90]] },
    { k: "dsbe", name: "10% DMSO in 20% SBE-β-CD", parts: [["DMSO", 10], ["20% SBE-β-CD in saline", 90]] },
    { k: "custom", name: "Custom", parts: null }
  ];

  // ---------- numbers ----------
  function num(s) {
    if (window.LM && LM.parse) return LM.parse(s);
    s = String(s == null ? "" : s).trim().replace(",", ".");
    if (!s) return null;
    var x = Number(s);
    return isFinite(x) ? x : NaN;
  }
  D.num = num;

  // ---------- parse the animal list ----------
  var H_ID = /^(id|animal|mouse|rat|ear ?tag|tag|no\.?|#|number|subject|name)\b/i;
  var H_CAGE = /^(cage|box)\b/i;
  var H_GROUP = /^(group|grp|treatment|arm|cohort|condition|dose ?group)\b/i;
  var H_W = /^(weight|wt|bw|body ?weight|mass)\b|^(g|grams?|kg)$/i;

  function splitLines(text) {
    return String(text || "").replace(/\r\n?/g, "\n").split("\n").filter(function (l) { return l.trim() !== ""; });
  }
  function pickSep(lines) {
    var joined = lines.join("\n");
    if (joined.indexOf("\t") >= 0) return "\t";
    if (joined.indexOf(";") >= 0) return ";";
    // decimal commas: every comma sits inside a plain number like 25,3 (not "M1,25")
    var commaNum = lines.every(function (l) {
      var c = (l.match(/,/g) || []).length;
      if (!c) return true;
      return c === 1 && /(^|\s)\d+,\d{1,3}(\s|$|g\b|kg\b)/i.test(l) && !/\d{4},/.test(l);
    });
    if (joined.indexOf(",") >= 0 && !commaNum) {
      // "M1, 25,3" can't be told apart from three columns; treat as columns
      return ",";
    }
    return "ws";
  }
  function cells(line, sep) {
    var out = sep === "ws" ? line.trim().split(/\s+/) : line.split(sep);
    return out.map(function (c) { return c.trim().replace(/^"(.*)"$/, "$1").trim(); });
  }
  // weight cell → {g, kg: unit was kg}
  function weightCell(s) {
    var t = String(s || "").trim();
    if (!t) return { v: null };
    var kg = /kg\s*$/i.test(t);
    t = t.replace(/\s*(kg|g|grams?)\s*$/i, "");
    var v = num(t);
    if (v == null || isNaN(v)) return { v: NaN };
    return { v: kg ? v * 1000 : v, kg: kg };
  }
  function isNumCell(s) { var w = weightCell(s); return w.v != null && !isNaN(w.v); }

  D.parseAnimals = function (text) {
    var lines = splitLines(text);
    var res = { rows: [], cols: null, header: false, msg: [] };
    if (!lines.length) return res;
    var sep = pickSep(lines);
    var table = lines.map(function (l) { return cells(l, sep); });
    var width = Math.max.apply(null, table.map(function (r) { return r.length; }));
    var first = table[0];
    var map = { id: -1, cage: -1, group: -1, w: -1 };
    var hdr = first.some(function (c) { return H_W.test(c) || H_ID.test(c) || H_CAGE.test(c) || H_GROUP.test(c); });
    if (hdr) {
      first.forEach(function (c, i) {
        if (map.w < 0 && H_W.test(c)) map.w = i;
        else if (map.cage < 0 && H_CAGE.test(c)) map.cage = i;
        else if (map.group < 0 && H_GROUP.test(c)) map.group = i;
        else if (map.id < 0 && H_ID.test(c)) map.id = i;
      });
      if (/kg/i.test(first[map.w] || "")) res.kgHeader = true;
      table = table.slice(1);
      res.header = true;
    }
    if (map.w < 0) {
      // weight = the right-most column where most cells are numbers
      for (var j = width - 1; j >= 0; j--) {
        if (j === map.id || j === map.cage || j === map.group) continue;
        var n = 0, tot = 0;
        table.forEach(function (r) { if (r[j] != null && r[j] !== "") { tot++; if (isNumCell(r[j])) n++; } });
        if (tot && n / tot >= 0.6) { map.w = j; break; }
      }
    }
    if (map.w < 0) { res.msg.push("No column of weights found."); return res; }
    if (!hdr) {
      var others = [];
      for (var k = 0; k < width; k++) if (k !== map.w) others.push(k);
      if (others.length >= 1) map.id = others[0];
      if (others.length === 2) map.group = others[1];
      if (others.length >= 3) { map.cage = others[1]; map.group = others[2]; }
    }
    res.cols = map;
    table.forEach(function (r, i) {
      var w = weightCell(r[map.w]);
      var g = w.v;
      if (res.kgHeader && g != null && !isNaN(g) && !w.kg) g = g * 1000;
      res.rows.push({
        id: map.id >= 0 && r[map.id] ? r[map.id] : String(i + 1),
        cage: map.cage >= 0 ? (r[map.cage] || "") : "",
        group: map.group >= 0 ? (r[map.group] || "") : "",
        w: g,
        raw: r[map.w] == null ? "" : r[map.w]
      });
    });
    return res;
  };

  // ---------- the calculation ----------
  // round to the nearest graduation; tiny epsilon so 0.0925 → 0.093 with step 0.001 as on paper
  D.roundTo = function (v, step) {
    if (!step || !(step > 0)) return v;
    var n = Math.round(v / step + 1e-9);
    return +(n * step).toFixed(6);
  };

  /* state:
   *  species, route, limitSet, custom{species:{route:{good,max,unit}}}
   *  mode: "conc" (known working concentration) | "vol" (fixed mL/kg)
   *  doseUnit: "mgkg" | "ugkg"
   *  groups: [{name, dose, conc}]   conc only used in mode "conc"
   *  volKg: mL/kg (mode "vol")
   *  step, cap: syringe graduation and capacity (mL)
   *  overage (%), dead (mL per animal), days, perDay
   *  salt (factor ≥ 1), purity (%)
   *  stock: {on, conc, solvent: index into vehicle or -1}
   *  vehicle: [[name, pct], ...]
   * animals: [{id, cage, group, w}]
   */
  D.compute = function (st, animals) {
    var out = { animals: [], groups: [], notes: [], errors: [], limit: null };
    var lim = D.limitFor(st.limitSet, st.species, st.route, st.custom);
    out.limit = lim;
    var sp = D.SPECIES.filter(function (s) { return s.k === st.species; })[0] || D.SPECIES[0];
    var doseF = st.doseUnit === "ugkg" ? 1e-3 : 1;
    var step = st.step > 0 ? st.step : null;
    var cap = st.cap > 0 ? st.cap : null;

    // groups present in the animal list, in order of first appearance
    var gNames = [];
    animals.forEach(function (a) { if (gNames.indexOf(a.group) < 0) gNames.push(a.group); });
    var gIndex = {};
    (st.groups || []).forEach(function (g) { gIndex[g.name] = g; });

    // in mode "conc", vehicle-only groups get the largest mL/kg used by a dosed group
    var vehRate = null;
    if (st.mode === "conc") {
      gNames.forEach(function (n) {
        var g = gIndex[n];
        if (g && g.dose > 0 && g.conc > 0) vehRate = Math.max(vehRate || 0, g.dose * doseF / g.conc);
      });
    }

    // duplicate ids
    var seen = {}, dup = {};
    animals.forEach(function (a) { var k = String(a.id).trim().toLowerCase(); if (seen[k]) dup[k] = 1; seen[k] = 1; });

    var groups = gNames.map(function (n) {
      var g = gIndex[n] || { name: n, dose: null, conc: null };
      var dose = g.dose == null || isNaN(g.dose) ? null : g.dose * doseF; // mg/kg
      var conc = null, rate = null, vehicleOnly = false, problem = null;
      if (dose == null) problem = "Enter a dose for this group.";
      else if (dose < 0) problem = "The dose can't be negative.";
      else if (st.mode === "vol") {
        if (!(st.volKg > 0)) problem = "Enter the dose volume in mL/kg.";
        else { rate = st.volKg; conc = dose / st.volKg; vehicleOnly = dose === 0; }
      } else {
        if (dose === 0) {
          vehicleOnly = true;
          if (vehRate) { rate = vehRate; conc = 0; }
          else problem = "Vehicle group: give a dosed group a concentration first, or switch to a fixed mL/kg.";
        } else if (!(g.conc > 0)) problem = "Enter the working concentration (mg/mL).";
        else { conc = g.conc; rate = dose / conc; }
      }
      return { name: n, dose: dose, conc: conc, rate: rate, vehicleOnly: vehicleOnly, problem: problem,
        n: 0, nOk: 0, sumV: 0, sumExact: 0, sumMg: 0, flags: {} };
    });
    var gBy = {};
    groups.forEach(function (g) { gBy[g.name] = g; });

    animals.forEach(function (a, i) {
      var g = gBy[a.group];
      var r = { i: i, id: a.id, cage: a.cage, group: a.group, w: a.w, flags: [], level: "ok" };
      g.n++;
      function flag(code, level, say) {
        r.flags.push({ code: code, level: level, say: say });
        var rank = { ok: 0, info: 1, warn: 2, err: 3 };
        if (rank[level] > rank[r.level]) r.level = level;
        g.flags[code] = (g.flags[code] || 0) + 1;
      }
      if (dup[String(a.id).trim().toLowerCase()]) flag("DUPLICATE ID", "warn", "This ID appears more than once.");
      if (a.w == null || isNaN(a.w) || a.w <= 0) {
        flag("NO WEIGHT", "err", "No usable weight — left blank on the sheet.");
        out.animals.push(r); return;
      }
      if (a.w < sp.wMin || a.w > sp.wMax) flag("CHECK WEIGHT", "warn", "Unusual for a " + sp.name.toLowerCase() + " (" + sp.wMin + "–" + sp.wMax + " g). Is the unit right?");
      if (g.problem) { out.animals.push(r); return; }
      var kg = a.w / 1000;
      r.mg = g.dose * kg;
      r.exact = g.rate * kg;
      r.vol = step ? D.roundTo(r.exact, step) : r.exact;
      r.dev = r.exact > 0 ? (r.vol - r.exact) / r.exact : 0;
      r.mlkg = r.vol / kg;
      r.mgGiven = (g.conc || 0) * r.vol;
      if (step && r.exact > 0 && r.vol < 2 * step - 1e-12) {
        flag("TOO SMALL", "warn", "Only " + Math.round(r.vol / step) + " graduation" + (Math.round(r.vol / step) === 1 ? "" : "s") + " on this syringe; rounding changes the dose by " + pct(r.dev) + ".");
      } else if (step && r.exact > 0 && Math.abs(r.dev) > 0.05) {
        flag("ROUNDING", "warn", "Rounding to the syringe changes the dose by " + pct(r.dev) + ".");
      }
      if (cap && r.vol > cap + 1e-12) flag("OVER SYRINGE", "warn", "More than the syringe holds — draw twice or use a bigger syringe.");
      // limits are checked on the intended volume; rounding to the syringe is reported on its own
      if (lim) {
        if (lim.unit === "site") {
          var good = lim.good, max = lim.max;
          if (max && r.exact > max + 1e-12) {
            r.sites = Math.ceil(r.exact / max - 1e-9);
            flag("ABOVE MAX", "err", "Above " + max + " mL per site; would need " + r.sites + " sites.");
          } else if (good && r.exact > good + 1e-12) flag("ABOVE GOOD PRACTICE", "warn", "Above " + good + " mL per site (good practice).");
        } else {
          var rate = r.exact / kg;
          if (lim.max && rate > lim.max + 1e-9) flag("ABOVE MAX", "err", "Above the maximum of " + lim.max + " mL/kg.");
          else if (lim.good && rate > lim.good + 1e-9) flag("ABOVE GOOD PRACTICE", "warn", "Above the good-practice volume of " + lim.good + " mL/kg.");
        }
      }
      if (st.route === "sc" && st.species === "mouse" && r.vol > 1 + 1e-12) {
        r.sites = Math.ceil(r.vol - 1e-9);
        flag("SPLIT SITES", "info", "More than 1 mL SC in a mouse — split over " + r.sites + " sites.");
      }
      g.nOk++;
      g.sumV += r.vol;
      g.sumExact += r.exact;
      g.sumMg += r.mg;
      out.animals.push(r);
    });

    // preparation per group
    var days = st.days > 0 ? Math.round(st.days) : 1;
    var perDay = st.perDay > 0 ? Math.round(st.perDay) : 1;
    var over = st.overage >= 0 ? st.overage / 100 : 0;
    var dead = st.dead > 0 ? st.dead : 0;
    var salt = st.salt > 0 ? st.salt : 1;
    var purity = st.purity > 0 ? st.purity / 100 : 1;
    var veh = (st.vehicle || []).filter(function (p) { return p && p[0] !== "" && p[1] != null && !isNaN(p[1]); });
    var vehSum = veh.reduce(function (s, p) { return s + p[1]; }, 0);
    if (veh.length && Math.abs(vehSum - 100) > 0.01) out.errors.push("The vehicle adds up to " + round(vehSum, 3) + "%, not 100%.");

    groups.forEach(function (g) {
      if (g.problem || !g.nOk) return;
      var doses = days * perDay;
      g.doses = doses;
      g.prep = (g.sumV + g.nOk * dead) * doses * (1 + over);
      g.drugPure = (g.conc || 0) * g.prep; // mg of active (as dosed form)
      g.weigh = g.drugPure * salt / purity; // mg of powder
      g.recipe = recipe(g, st, veh, vehSum);
    });

    out.groups = groups;
    out.days = days; out.perDay = perDay;
    out.totalPrep = groups.reduce(function (s, g) { return s + (g.prep || 0); }, 0);
    out.totalWeigh = groups.reduce(function (s, g) { return s + (g.weigh || 0); }, 0);
    // whole-batch notes
    if (st.route === "ivb" || st.route === "ivs") {
      if (veh.some(function (p) { return /oil|cmc|suspen/i.test(p[0]); })) out.notes.push({ level: "err", code: "NOT FOR IV", say: "Oil or suspension vehicles must not be given intravenously." });
    }
    var dm = veh.filter(function (p) { return /dmso/i.test(p[0]); }).reduce(function (s, p) { return s + p[1]; }, 0);
    if ((st.route === "ip" || st.route === "ivb" || st.route === "ivs") && dm > 10 + 1e-9) out.notes.push({ level: "warn", code: "DMSO", say: "Vehicle has " + round(dm, 3) + "% DMSO; many guidelines keep it at or below 10% for IP and IV." });
    return out;
  };

  function recipe(g, st, veh, vehSum) {
    var V = g.prep;
    var rec = { total: V, steps: [], error: null, stock: null };
    if (!veh.length || Math.abs(vehSum - 100) > 0.01) { rec.error = "Set up the vehicle (components must add up to 100%)."; return rec; }
    var vols = veh.map(function (p) { return { name: p[0], pct: p[1], vol: p[1] / 100 * V }; });
    var useStock = st.stock && st.stock.on && g.conc > 0;
    if (useStock) {
      var S = st.stock.conc;
      if (!(S > 0)) { rec.error = "Enter the stock concentration."; return rec; }
      if (S < g.conc - 1e-12) { rec.error = "The stock (" + round(S, 4) + " mg/mL) is weaker than the working solution (" + round(g.conc, 4) + " mg/mL)."; return rec; }
      var vs = g.conc * V / S;
      var j = st.stock.solvent;
      rec.stock = { conc: S, vol: vs, solvent: j >= 0 && vols[j] ? vols[j].name : (st.stock.solventName || "stock solvent"), mg: g.conc * V };
      if (j >= 0 && vols[j]) {
        if (vs > vols[j].vol + 1e-9) {
          var need = g.conc * 100 / vols[j].pct;
          rec.error = "The stock alone is " + round(vs / V * 100, 3) + "% of the volume, more than the " + vols[j].pct + "% " + vols[j].name + " in the vehicle. Use a stock of at least " + round(need, 4) + " mg/mL.";
          return rec;
        }
        vols[j].vol -= vs;
        vols[j].fromStock = vs;
      } else {
        // stock solvent is not part of the vehicle: the rest of the vehicle fills up to V
        var rest = V - vs;
        vols.forEach(function (p) { p.vol = p.pct / 100 * rest; });
        rec.extraPct = vs / V * 100;
      }
      rec.steps.push({ kind: "stock", vol: vs });
      vols.forEach(function (p, i) { if (p.vol > 1e-12 || i === j) rec.steps.push({ kind: "add", name: p.name, vol: Math.max(0, p.vol), pct: p.pct, topUp: !!p.fromStock }); });
    } else {
      if (g.conc > 0) rec.steps.push({ kind: "weigh", mg: g.weigh });
      vols.forEach(function (p) { rec.steps.push({ kind: "add", name: p.name, vol: p.vol, pct: p.pct }); });
    }
    return rec;
  }

  // decimals needed to show a volume at the syringe's resolution
  D.decimals = function (step) {
    if (!(step > 0)) return 3;
    for (var d = 0; d < 6; d++) if (Math.abs(Math.round(step * Math.pow(10, d)) - step * Math.pow(10, d)) < 1e-9) return d;
    return 6;
  };
  D.volFix = function (v, step) { return v.toFixed(D.decimals(step)); };

  function round(x, sig) { return +Number(x).toPrecision(sig); }
  function pct(x) { var s = (x * 100).toFixed(1); return (x > 0 ? "+" : "") + s + "%"; }
  D.pct = pct;
})();
