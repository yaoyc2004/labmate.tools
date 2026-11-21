/* labmate.tools — recipe calculations shared by 5.6 SDS-PAGE Gel Recipe and 2.7 Buffer Recipe.
 * Pure functions, no DOM. Browser: window.LMR. Node: module.exports.
 * Algorithm id: labmate-recipe-1.
 * Units inside: volumes in mL, masses in g, molar concentrations in M, percentages as % (w/v or v/v).
 */
(function (root) {
  "use strict";
  var R = {};
  R.ALGO = "labmate-recipe-1";

  // ---------------------------------------------------------------- gels
  // Casting systems: total volume of one cassette (glass plates + spacer), mL.
  // Bio-Rad Mini-PROTEAN Tetra Cell manual (10007296), Table 4.
  R.SYSTEMS = [
    { k: "mp075", name: "Bio-Rad Mini-PROTEAN · 0.75 mm", short: "Mini-PROTEAN 0.75 mm", cassette: 4.2 },
    { k: "mp100", name: "Bio-Rad Mini-PROTEAN · 1.0 mm", short: "Mini-PROTEAN 1.0 mm", cassette: 5.6 },
    { k: "mp150", name: "Bio-Rad Mini-PROTEAN · 1.5 mm", short: "Mini-PROTEAN 1.5 mm", cassette: 8.4 },
    { k: "custom", name: "Other plates (enter size)", short: "Custom plates", cassette: null }
  ];
  R.system = function (k) {
    for (var i = 0; i < R.SYSTEMS.length; i++) if (R.SYSTEMS[i].k === k) return R.SYSTEMS[i];
    return null;
  };
  // inner width (cm) × height (cm) × spacer (mm) → mL
  R.cassetteVolume = function (wCm, hCm, spacerMm) { return wCm * hCm * spacerMm / 10; };

  // Default stocks and final concentrations (Laemmli 1970 as written in the Bio-Rad manual).
  R.GEL_STOCKS = {
    acryl: 30,        // % (w/v) acrylamide/bis
    ratio: "37.5:1",  // label only, does not change volumes
    resTris: 1.5,     // M Tris-HCl pH 8.8
    stkTris: 0.5,     // M Tris-HCl pH 6.8
    sds: 10,          // % (w/v)
    aps: 10,          // % (w/v), made fresh
    temed: 100        // % (v/v) — neat TEMED
  };
  R.GEL_FINALS = {
    resolving: { tris: 0.375, sds: 0.1, aps: 0.05, temed: 0.05 },
    stacking: { tris: 0.125, sds: 0.1, aps: 0.05, temed: 0.1 }
  };

  // One gel mix. o = { kind: "resolving"|"stacking", volume (mL), pct, stocks, finals, water: "strict"|"nominal" }
  // "strict": water = volume − every other component (total is exactly `volume`).
  // "nominal": water leaves out APS and TEMED, the way most printed recipes are written
  //            (Bio-Rad: 10 mL of 10% → 4.1 mL water); the total ends a little over `volume`.
  R.gelMix = function (o) {
    var s = o.stocks || R.GEL_STOCKS, f = o.finals || R.GEL_FINALS[o.kind], V = o.volume;
    var errs = [];
    if (!(V > 0)) errs.push("volume");
    if (!(o.pct > 0)) errs.push("pct");
    if (o.pct >= s.acryl) errs.push("pct-over-stock");
    var trisStock = o.kind === "stacking" ? s.stkTris : s.resTris;
    if (f.tris > 0 && f.tris >= trisStock) errs.push("tris-over-stock");
    if (f.sds > 0 && f.sds >= s.sds) errs.push("sds-over-stock");
    if (errs.length) return { ok: false, errors: errs };
    var c = [
      { k: "tris", v: f.tris > 0 ? V * f.tris / trisStock : 0 },
      { k: "acryl", v: V * o.pct / s.acryl },
      { k: "sds", v: f.sds > 0 ? V * f.sds / s.sds : 0 },
      { k: "aps", v: f.aps > 0 ? V * f.aps / s.aps : 0 },
      { k: "temed", v: f.temed > 0 ? V * f.temed / s.temed : 0 }
    ];
    var by = {};
    c.forEach(function (x) { by[x.k] = x.v; });
    var others = by.tris + by.acryl + by.sds + (o.water === "nominal" ? 0 : by.aps + by.temed);
    var water = V - others;
    if (water < -1e-9) return { ok: false, errors: ["no-room"], over: -water };
    water = Math.max(0, water);
    var total = water + by.tris + by.acryl + by.sds + by.aps + by.temed;
    // order of addition: water, buffer, acrylamide, SDS — degas — APS, TEMED
    var rows = [
      { k: "water", v: water },
      { k: "tris", v: by.tris },
      { k: "acryl", v: by.acryl },
      { k: "sds", v: by.sds },
      { k: "aps", v: by.aps },
      { k: "temed", v: by.temed }
    ].filter(function (r) { return r.k === "water" || r.v > 0; });
    return { ok: true, kind: o.kind, pct: o.pct, volume: V, rows: rows, by: by, water: water, total: total };
  };

  // Batch volume: gels × per-gel volume × (1 + overage), rounded up to `step` mL (0 = no rounding).
  R.batchVolume = function (gels, perGel, overagePct, step) {
    var v = gels * perGel * (1 + (overagePct || 0) / 100);
    if (step > 0) v = Math.ceil(v / step - 1e-9) * step;
    return v;
  };

  // Whole plan. p = { cassette (mL), frac (resolving share of the cassette, 0–1), overage (%), step (mL),
  //   resolving: [{ pct, gels }], stackPct, stocks, finals: {resolving, stacking}, water }
  R.gelPlan = function (p) {
    var errs = [];
    if (!(p.cassette > 0)) errs.push("cassette");
    if (!(p.frac > 0 && p.frac < 1)) errs.push("frac");
    var groups = (p.resolving || []).filter(function (g) { return g && g.gels > 0; });
    if (!groups.length) errs.push("gels");
    if (errs.length) return { ok: false, errors: errs };
    var perRes = p.cassette * p.frac, perStk = p.cassette * (1 - p.frac);
    var finals = p.finals || R.GEL_FINALS;
    var totalGels = 0, out = [], bad = [];
    groups.forEach(function (g, i) {
      totalGels += g.gels;
      var V = R.batchVolume(g.gels, perRes, p.overage, p.step);
      var m = R.gelMix({ kind: "resolving", volume: V, pct: g.pct, stocks: p.stocks, finals: finals.resolving, water: p.water });
      m.gels = g.gels; m.index = i;
      if (!m.ok) bad.push(m);
      out.push(m);
    });
    var Vs = R.batchVolume(totalGels, perStk, p.overage, p.step);
    var stk = R.gelMix({ kind: "stacking", volume: Vs, pct: p.stackPct, stocks: p.stocks, finals: finals.stacking, water: p.water });
    stk.gels = totalGels;
    return { ok: !bad.length && stk.ok, perRes: perRes, perStk: perStk, totalGels: totalGels, resolving: out, stacking: stk };
  };

  // ---------------------------------------------------------------- buffers
  // A component: { name, c (amount at 1×), u ("M"|"mM"|"µM"|"w/v"|"v/v"), form ("powder"|"liquid"|"stock"),
  //   mw (g/mol, powder + molar), stock (stock concentration, same unit family as u: M for molar, % for w/v or v/v),
  //   atUse (true = left out of the concentrated stock, added when the working solution is made), note }
  // "liquid" = a neat liquid measured by volume: v/v (methanol, Tween-20, NP-40) or molar with a stock
  //   molarity of the neat liquid (glacial acetic acid ≈ 17.4 M).
  var MOLAR = { M: 1, mM: 1e-3, "µM": 1e-6 };
  R.isMolar = function (u) { return MOLAR[u] != null; };
  R.toM = function (c, u) { return c * MOLAR[u]; };

  // Amount of one component for `V` mL at strength `x` (× of the 1× composition).
  // Returns { kind: "mass", g } or { kind: "volume", mL } or { error }.
  R.componentAmount = function (cmp, x, V) {
    var molar = R.isMolar(cmp.u);
    if (!(cmp.c >= 0)) return { error: "c" };
    if (cmp.form === "powder") {
      if (molar) {
        if (!(cmp.mw > 0)) return { error: "mw" };
        return { kind: "mass", g: R.toM(cmp.c, cmp.u) * x * (V / 1000) * cmp.mw };
      }
      if (cmp.u === "w/v") return { kind: "mass", g: cmp.c / 100 * x * V };
      return { error: "form" }; // a v/v component can't be a powder
    }
    // liquid or stock: volume = final × V / stock
    var final = molar ? R.toM(cmp.c, cmp.u) * x : cmp.c * x;
    var stock = cmp.form === "liquid" && cmp.u === "v/v" ? 100 : cmp.stock;
    if (!(stock > 0)) return { error: "stock" };
    if (final > stock + 1e-12) return { error: "over-stock", need: final, stock: stock };
    return { kind: "volume", mL: final * V / stock };
  };

  // Make a solution from its components (powders, liquids, stock solutions).
  // o = { components, x (strength to make, e.g. 10 for 10×), V (mL), includeAtUse (bool) }
  R.makeFromComponents = function (o) {
    var rows = [], liq = 0, errs = [];
    o.components.forEach(function (cmp, i) {
      if (cmp.atUse && !o.includeAtUse) { rows.push({ i: i, cmp: cmp, skipped: true }); return; }
      var a = R.componentAmount(cmp, o.x, o.V);
      if (a.error) errs.push({ i: i, error: a.error, need: a.need, stock: a.stock });
      else if (a.kind === "volume") liq += a.mL;
      rows.push({ i: i, cmp: cmp, amount: a });
    });
    if (errs.length) return { ok: false, errors: errs, rows: rows };
    if (liq > o.V + 1e-9) return { ok: false, errors: [{ error: "no-room", over: liq - o.V }], rows: rows };
    return { ok: true, rows: rows, liquids: liq, V: o.V, x: o.x };
  };

  // Dilute a stock of strength `from` × to `to` × in `V` mL; at-use components are added at `to` ×.
  R.diluteStock = function (o) {
    if (!(o.from > 0) || !(o.to > 0) || !(o.V > 0)) return { ok: false, errors: [{ error: "input" }] };
    if (o.to > o.from) return { ok: false, errors: [{ error: "to-over-from" }] };
    var stockV = o.V * o.to / o.from, adds = [], addV = 0, errs = [];
    (o.components || []).forEach(function (cmp, i) {
      if (!cmp.atUse) return;
      var a = R.componentAmount(cmp, o.to, o.V);
      if (a.error) errs.push({ i: i, error: a.error });
      else { adds.push({ i: i, cmp: cmp, amount: a }); if (a.kind === "volume") addV += a.mL; }
    });
    if (errs.length) return { ok: false, errors: errs };
    var water = o.V - stockV - addV;
    if (water < -1e-9) return { ok: false, errors: [{ error: "no-room", over: -water }] };
    return { ok: true, stockV: stockV, adds: adds, water: Math.max(0, water), V: o.V };
  };

  // ---------------------------------------------------------------- buffer presets
  function C(name, c, u, form, extra) {
    var o = { name: name, c: c, u: u, form: form };
    for (var k in extra || {}) o[k] = extra[k];
    return o;
  }
  // MWs: Tris base 121.14, glycine 75.07, SDS 288.38, NaCl 58.44, KCl 74.55, Na2HPO4 141.96,
  // KH2PO4 136.09, boric acid 61.83, Na2EDTA·2H2O 372.24, sodium deoxycholate 414.55, APS 228.20.
  R.PRESETS = [
    { k: "tgs", group: "Protein gels & blots", name: "Tris-glycine-SDS running buffer", short: "Running buffer (TGS)", usual: 10,
      ph: "Do not adjust the pH; it is about 8.3.",
      comps: [C("Tris base", 25, "mM", "powder", { mw: 121.14 }), C("Glycine", 192, "mM", "powder", { mw: 75.07 }), C("SDS", 0.1, "w/v", "powder")] },
    { k: "towbin", group: "Protein gels & blots", name: "Towbin transfer buffer", short: "Transfer buffer (Towbin)", usual: 10,
      ph: "Do not adjust the pH; it is about 8.3. Methanol goes in when you dilute to 1×; chill before use.",
      comps: [C("Tris base", 25, "mM", "powder", { mw: 121.14 }), C("Glycine", 192, "mM", "powder", { mw: 75.07 }), C("Methanol", 20, "v/v", "liquid", { atUse: true })] },
    { k: "tbs", group: "Protein gels & blots", name: "TBS (Tris-buffered saline)", short: "TBS", usual: 10,
      ph: "Adjust to pH 7.6 with HCl before making up to volume.",
      comps: [C("Tris base", 20, "mM", "powder", { mw: 121.14 }), C("NaCl", 150, "mM", "powder", { mw: 58.44 })] },
    { k: "tbst", group: "Protein gels & blots", name: "TBST (TBS + 0.1% Tween-20)", short: "TBST", usual: 10,
      ph: "Adjust to pH 7.6 with HCl before making up to volume. Tween-20 goes in when you dilute to 1×.",
      comps: [C("Tris base", 20, "mM", "powder", { mw: 121.14 }), C("NaCl", 150, "mM", "powder", { mw: 58.44 }), C("Tween-20", 0.1, "v/v", "liquid", { atUse: true })] },
    { k: "pbs", group: "Saline & general", name: "PBS (phosphate-buffered saline)", short: "PBS", usual: 10,
      ph: "Adjust to pH 7.4 with HCl or NaOH before making up to volume.",
      comps: [C("NaCl", 137, "mM", "powder", { mw: 58.44 }), C("KCl", 2.7, "mM", "powder", { mw: 74.55 }),
        C("Na₂HPO₄ (anhydrous)", 10, "mM", "powder", { mw: 141.96, note: "·2H₂O 177.99 · ·7H₂O 268.07 · ·12H₂O 358.14 g/mol" }),
        C("KH₂PO₄", 1.8, "mM", "powder", { mw: 136.09 })] },
    { k: "pbst", group: "Saline & general", name: "PBST (PBS + 0.1% Tween-20)", short: "PBST", usual: 10,
      ph: "Adjust to pH 7.4 before making up to volume. Tween-20 goes in when you dilute to 1×.",
      comps: [C("NaCl", 137, "mM", "powder", { mw: 58.44 }), C("KCl", 2.7, "mM", "powder", { mw: 74.55 }),
        C("Na₂HPO₄ (anhydrous)", 10, "mM", "powder", { mw: 141.96, note: "·2H₂O 177.99 · ·7H₂O 268.07 · ·12H₂O 358.14 g/mol" }),
        C("KH₂PO₄", 1.8, "mM", "powder", { mw: 136.09 }), C("Tween-20", 0.1, "v/v", "liquid", { atUse: true })] },
    { k: "ripa", group: "Saline & general", name: "RIPA lysis buffer", short: "RIPA", usual: 1,
      ph: "Tris comes from a pH 8.0 stock. Add protease and phosphatase inhibitors just before use; keep on ice.",
      comps: [C("Tris-HCl pH 8.0", 50, "mM", "stock", { stock: 1 }), C("NaCl", 150, "mM", "powder", { mw: 58.44 }),
        C("NP-40 (IGEPAL CA-630)", 1, "v/v", "liquid"), C("Sodium deoxycholate", 0.5, "w/v", "powder"), C("SDS", 0.1, "w/v", "stock", { stock: 10 })] },
    { k: "tae", group: "DNA gels", name: "TAE (Tris-acetate-EDTA)", short: "TAE", usual: 50,
      ph: "Do not adjust the pH; it is about 8.3.",
      comps: [C("Tris base", 40, "mM", "powder", { mw: 121.14 }), C("Glacial acetic acid", 20, "mM", "liquid", { stock: 17.5, note: "neat liquid ≈ 17.5 M" }),
        C("EDTA (0.5 M, pH 8.0)", 1, "mM", "stock", { stock: 0.5 })] },
    { k: "tbe", group: "DNA gels", name: "TBE (Tris-borate-EDTA)", short: "TBE", usual: 5,
      ph: "Do not adjust the pH; it is about 8.3. Keep the stock at 5×: 10× TBE precipitates on storage.",
      comps: [C("Tris base", 89, "mM", "powder", { mw: 121.14 }), C("Boric acid", 89, "mM", "powder", { mw: 61.83 }),
        C("EDTA (0.5 M, pH 8.0)", 2, "mM", "stock", { stock: 0.5 })] },
    { k: "tris88", group: "Gel stocks", name: "1.5 M Tris-HCl pH 8.8 (resolving gel buffer)", short: "1.5 M Tris pH 8.8", usual: 1,
      ph: "Adjust to pH 8.8 with HCl before making up to volume.",
      comps: [C("Tris base", 1.5, "M", "powder", { mw: 121.14 })] },
    { k: "tris68", group: "Gel stocks", name: "0.5 M Tris-HCl pH 6.8 (stacking gel buffer)", short: "0.5 M Tris pH 6.8", usual: 1,
      ph: "Adjust to pH 6.8 with HCl before making up to volume.",
      comps: [C("Tris base", 0.5, "M", "powder", { mw: 121.14 })] },
    { k: "sds10", group: "Gel stocks", name: "10% SDS", short: "10% SDS", usual: 1,
      ph: "Dissolve with gentle warming; do not shake (it foams). Wear a mask when weighing the powder.",
      comps: [C("SDS", 10, "w/v", "powder")] },
    { k: "aps10", group: "Gel stocks", name: "10% ammonium persulfate (APS)", short: "10% APS", usual: 1,
      ph: "Make fresh, or freeze single-use aliquots.",
      comps: [C("Ammonium persulfate", 10, "w/v", "powder")] },
    { k: "edta", group: "Gel stocks", name: "0.5 M EDTA pH 8.0", short: "0.5 M EDTA pH 8.0", usual: 1,
      ph: "EDTA dissolves only near pH 8: add NaOH (pellets or 10 M) while stirring until it clears at pH 8.0.",
      comps: [C("Na₂EDTA·2H₂O", 0.5, "M", "powder", { mw: 372.24 })] },
    { k: "custom", group: "Your own", name: "Custom recipe", short: "Custom", usual: 1, ph: "",
      comps: [C("", "", "mM", "powder", {}), C("", "", "mM", "powder", {})] }
  ];
  R.preset = function (k) {
    for (var i = 0; i < R.PRESETS.length; i++) if (R.PRESETS[i].k === k) return R.PRESETS[i];
    return null;
  };
  R.clonePreset = function (k) { var p = R.preset(k); return p ? JSON.parse(JSON.stringify(p)) : null; };

  if (typeof module !== "undefined" && module.exports) module.exports = R;
  else root.LMR = R;
})(typeof window !== "undefined" ? window : this);
