/* labmate.tools — 2.6 Cloning Reaction: pure calculations (no DOM).
 * window.LMC. Algorithm id: labmate-cloning-1.
 * Units inside: length in bp, concentration in ng/µL, amount in pmol, volume in µL.
 *
 * Vendor values (checked 2026-11-20):
 *  - NEBuilder HiFi / Gibson total DNA and molar ratios, 20 µL reaction with 10 µL master mix,
 *    unpurified PCR ≤ 20% of the reaction, 5-fold excess for inserts under 200 bp,
 *    50–100 ng vector, pmol = ng × 1000 / (bp × 650).
 *  - Golden Gate (NEBridge, BsaI-HFv2 / BsmBI-v2): 75 ng destination plasmid, insert:vector 2:1,
 *    2 µL 10X T4 DNA Ligase Buffer, 1 µL enzyme mix (2 µL for more than 10 inserts), 20 µL.
 *  - Ligation: no vendor-fixed amounts. NEB's ligation-module guidance is 1:3 vector:insert
 *    (1:1 for similar sizes, ~1:10 for inserts ≤ 100 bp, ~1:20 for a few dozen bp) and a total
 *    DNA concentration of 1–10 µg/mL.
 */
(function () {
  "use strict";
  var C = (window.LMC = {});
  C.ALGO = "labmate-cloning-1";
  C.BP_DA = 650;

  C.SYSTEMS = [
    { k: "lig", name: "Ligation", flow: "T4 DNA ligase" },
    { k: "gibson", name: "Gibson / HiFi", flow: "overlap assembly" },
    { k: "gg", name: "Golden Gate", flow: "Type IIS, one tube" }
  ];
  C.KITS = {
    lig: [{ k: "t4", name: "T4 DNA Ligase" }],
    gibson: [{ k: "hifi", name: "NEBuilder HiFi" }, { k: "gibson", name: "Gibson Assembly" }],
    gg: [{ k: "bsai", name: "BsaI-HFv2 (37 °C)" }, { k: "bsmbi", name: "BsmBI-v2 (42 °C)" }]
  };
  C.VOLUMES = [10, 15, 20, 25, 30, 50];
  C.STEPS = [
    { k: "0.1", v: 0.1, name: "0.1 µL" },
    { k: "0.25", v: 0.25, name: "0.25 µL" },
    { k: "0.5", v: 0.5, name: "0.5 µL" }
  ];
  C.UNITS = [{ k: "ng/uL", name: "ng/µL" }, { k: "nM", name: "nM" }];
  C.MIN_VOL = 0.5;          // below this a pipetted volume is called out as too small
  C.GG_VECTOR_NG = 75;      // NEBridge Golden Gate: 75 ng destination plasmid
  C.LIG_TOTAL_UGML = [1, 10]; // NEB FAQ: optimal total DNA 1–10 µg/mL

  // ---------- small helpers ----------
  function num(x) { return typeof x === "number" && isFinite(x) ? x : null; }
  function roundTo(v, step) {
    if (!(step > 0)) return v;
    return Math.round(Math.round((v / step) * 1e6) / 1e6) * step;
  }
  function clean(v) { return Math.round(v * 1e6) / 1e6; }
  C.roundTo = function (v, step) { return clean(roundTo(v, step)); };

  // pmol of a dsDNA fragment: pmol = ng × 1000 / (bp × 650)
  C.ngToPmol = function (ng, bp, bpDa) {
    if (!(bp > 0)) return null;
    return (ng * 1000) / (bp * (bpDa || C.BP_DA));
  };
  C.pmolToNg = function (pmol, bp, bpDa) {
    if (!(bp > 0)) return null;
    return (pmol * bp * (bpDa || C.BP_DA)) / 1000;
  };
  // nM (nmol/L) = pmol/mL, so pmol/µL = nM / 1000
  C.nmToPmolPerUl = function (nm) { return nm / 1000; };
  C.pmolPerUlToNm = function (p) { return p * 1000; };

  // ---------- the rules ----------
  // Recommended total DNA (pmol) and insert:vector molar ratio, by system and fragment count.
  // nFrag counts the vector plus every insert, the way the NEB tables do.
  C.rule = function (system, kit, nFrag, insertBp) {
    var r = { ratio: 3, ratioSay: "1:3", range: null, rangeSay: "", band: "", source: "" };
    if (system === "gibson") {
      var few = nFrag <= 3;
      if (kit === "gibson") {
        r.ratio = few ? 2 : 1;
        r.range = few ? [0.02, 0.5] : [0.2, 1.0];
        r.band = few ? "2–3 fragments" : (nFrag <= 6 ? "4–6 fragments" : "more than 6 fragments");
        r.ratioSay = few ? "1:2 (2–3 fold excess of each insert)" : "1:1";
        r.source = "Gibson Assembly";
      } else {
        r.ratio = few ? 2 : 1;
        r.range = few ? [0.03, 0.2] : [0.2, 0.5];
        r.band = few ? "2–3 fragments" : (nFrag <= 6 ? "4–6 fragments" : "more than 6 fragments");
        r.ratioSay = few ? "1:2 (2-fold excess of each insert)" : "1:1";
        r.source = "NEBuilder HiFi";
      }
      r.rangeSay = r.range[0] + "–" + r.range[1] + " pmol total";
      r.smallInsert = 5; // inserts under 200 bp: 5-fold molar excess
    } else if (system === "gg") {
      r.ratio = 2;
      r.ratioSay = "1:2 (2:1 insert:vector)";
      r.band = "any number of inserts";
      r.source = "NEBridge Golden Gate";
    } else {
      // ligation
      r.ratio = 3;
      r.ratioSay = "1:3";
      r.band = "restriction cloning";
      r.source = "T4 DNA ligase, common practice";
      if (insertBp != null && insertBp > 0) {
        if (insertBp <= 30) { r.ratio = 20; r.ratioSay = "1:20 (very short insert)"; }
        else if (insertBp <= 100) { r.ratio = 10; r.ratioSay = "1:10 (short insert)"; }
      }
    }
    return r;
  };

  // Default insert:vector molar ratio for one insert, given the system and the whole reaction.
  C.autoRatio = function (system, kit, nFrag, insertBp) {
    var r = C.rule(system, kit, nFrag, insertBp);
    if (system === "gibson" && insertBp != null && insertBp > 0 && insertBp < 200) return r.smallInsert;
    return r.ratio;
  };

  // Fixed (non-DNA) components of the reaction.
  C.mixOf = function (system, kit, totalVol, nInsert) {
    var out = [];
    if (system === "gibson") {
      out.push({ k: "mm", name: (kit === "gibson" ? "Gibson Assembly Master Mix (2X)" : "NEBuilder HiFi DNA Assembly Master Mix (2X)"), vol: clean(totalVol / 2) });
    } else if (system === "gg") {
      out.push({ k: "buf", name: "T4 DNA Ligase Buffer (10X)", vol: clean(totalVol / 10) });
      out.push({ k: "enz", name: (kit === "bsmbi" ? "NEBridge Golden Gate Enzyme Mix (BsmBI-v2)" : "NEBridge Golden Gate Assembly Mix (BsaI-HFv2)"), vol: nInsert > 10 ? 2 : 1 });
    } else {
      out.push({ k: "buf", name: "T4 DNA Ligase Buffer (10X)", vol: clean(totalVol / 10) });
      out.push({ k: "enz", name: "T4 DNA Ligase", vol: 1 });
    }
    return out;
  };

  // Incubation, as the protocols give it.
  C.incubation = function (system, kit, nFrag, nInsert) {
    if (system === "gibson") {
      var mins = nFrag <= 3 ? 15 : 60;
      return {
        say: "50 °C for " + mins + " min",
        note: nFrag <= 3
          ? "15 min for 2–3 fragments; up to 60 min can help a stubborn assembly."
          : "60 min for 4–6 fragments.",
        steps: [{ t: "50 °C", d: mins + " min" }, { t: "4 °C or ice", d: "then transform 2 µL" }]
      };
    }
    if (system === "gg") {
      var hot = kit === "bsmbi" ? "42 °C" : "37 °C";
      if (nInsert <= 1) {
        return {
          say: hot + " 5 min → 60 °C 5 min",
          note: "For a library, hold at " + hot + " for 1 h instead of 5 min.",
          steps: [{ t: hot, d: "5 min (1 h for a library)" }, { t: "60 °C", d: "5 min" }]
        };
      }
      if (kit === "bsai" && nInsert <= 4) {
        return {
          say: "37 °C 1 h → 60 °C 5 min",
          note: "2–4 inserts: a single 1 h digestion-ligation step.",
          steps: [{ t: "37 °C", d: "1 h" }, { t: "60 °C", d: "5 min" }]
        };
      }
      var long = nInsert > 10;
      var d = long ? "5 min" : "1 min";
      return {
        say: "(" + hot + " " + d + " → 16 °C " + d + ") × 30 → 60 °C 5 min",
        note: long ? "More than 10 inserts: 5 min steps." : (kit === "bsmbi" ? "2–10 inserts: 1 min steps." : "5–10 inserts: 1 min steps."),
        steps: [{ t: hot + " / 16 °C", d: d + " each, 30 cycles" }, { t: "60 °C", d: "5 min" }]
      };
    }
    return {
      say: "16 °C overnight, or 25 °C for 10 min",
      note: "That is for cohesive ends; blunt ends or a single-base overhang take 16 °C overnight or 2 h at room temperature. Heat-inactivate at 65 °C for 10 min, chill on ice, then transform 1–5 µL.",
      steps: [{ t: "16 °C", d: "overnight (or 25 °C, 10 min)" }, { t: "65 °C", d: "10 min, then ice" }]
    };
  };

  // ---------- the calculation ----------
  C.compute = function (st) {
    var bpDa = num(st.bpDa) || C.BP_DA;
    var totalVol = num(st.totalVol) || 20;
    var step = num(st.step) || 0.1;
    var system = st.system || "gibson";
    var kit = st.kit || (system === "gibson" ? "hifi" : system === "gg" ? "bsai" : "t4");

    var out = {
      algo: C.ALGO, system: system, kit: kit, totalVol: totalVol, step: step, bpDa: bpDa,
      rows: [], mix: [], flags: [], fixes: [], ok: false,
      dnaVol: 0, water: 0, avail: 0, fixedVol: 0,
      totalPmol: 0, totalNg: 0, unpureVol: 0, unpureCap: clean(totalVol * 0.2)
    };

    // 1 · read the fragment rows
    var frags = (st.frags || []).map(function (f, i) {
      var row = {
        i: i, name: (f.name || "").trim(), role: f.role === "vector" ? "vector" : "insert",
        bp: num(f.bp), conc: num(f.conc), unit: f.unit === "nM" ? "nM" : "ng/uL",
        unpure: !!f.unpure, ratioSet: num(f.ratio), bad: null,
        pmolPerUl: null, ngPerUl: null, nM: null
      };
      if (row.bp == null || row.bp <= 0) row.bad = "LENGTH";
      else if (row.conc == null || row.conc <= 0) row.bad = "CONC.";
      else {
        if (row.unit === "nM") {
          row.pmolPerUl = C.nmToPmolPerUl(row.conc);
          row.ngPerUl = C.pmolToNg(row.pmolPerUl, row.bp, bpDa);
        } else {
          row.ngPerUl = row.conc;
          row.pmolPerUl = C.ngToPmol(row.conc, row.bp, bpDa);
        }
        row.nM = C.pmolPerUlToNm(row.pmolPerUl);
      }
      return row;
    });
    out.rows = frags;

    var good = frags.filter(function (f) { return !f.bad; });
    var vectors = good.filter(function (f) { return f.role === "vector"; });
    var inserts = good.filter(function (f) { return f.role === "insert"; });
    out.nFrag = good.length;
    out.nInsert = inserts.length;

    // 2 · the rule in force
    var firstInsertBp = inserts.length ? inserts[0].bp : null;
    var rule = C.rule(system, kit, good.length, inserts.length === 1 ? firstInsertBp : null);
    out.rule = rule;
    out.incubation = C.incubation(system, kit, good.length, inserts.length);
    out.mix = C.mixOf(system, kit, totalVol, inserts.length);
    out.fixedVol = clean(out.mix.reduce(function (a, m) { return a + m.vol; }, 0));
    out.avail = clean(totalVol - out.fixedVol);

    frags.forEach(function (f) {
      if (f.bad || f.role === "vector") return;
      f.ratioAuto = C.autoRatio(system, kit, good.length, f.bp);
      f.ratio = f.ratioSet != null && f.ratioSet > 0 ? f.ratioSet : f.ratioAuto;
    });

    // 3 · row-level problems that stop the calculation
    if (!vectors.length) out.flags.push({ kind: "err", k: "NO VECTOR", say: "Mark one row as the vector (backbone)." });
    if (vectors.length > 1) out.flags.push({ kind: "err", k: "TWO VECTORS", say: "Only one row can be the vector; make the others inserts." });
    if (!inserts.length) out.flags.push({ kind: "err", k: "NO INSERT", say: "Add at least one insert." });
    frags.forEach(function (f) {
      if (f.bad) out.flags.push({ kind: "err", k: f.bad, say: "Row " + (f.i + 1) + (f.name ? " (" + f.name + ")" : "") + " needs a " + (f.bad === "LENGTH" ? "length in bp" : "concentration") + "." });
    });
    if (out.flags.some(function (f) { return f.kind === "err"; })) return out;

    var vec = vectors[0];

    // 4 · how much vector, and so how much of everything
    var ratioSum = inserts.reduce(function (a, f) { return a + f.ratio; }, 0);
    var vecPmol;
    if (st.basis === "total") {
      var tp = num(st.totalPmol);
      if (tp == null || tp <= 0) tp = rule.range ? (rule.range[0] + rule.range[1]) / 2 : 0.05;
      vecPmol = tp / (1 + ratioSum);
    } else {
      var vng = num(st.vectorNg);
      if (vng == null || vng <= 0) vng = system === "gg" ? C.GG_VECTOR_NG : 50;
      vecPmol = C.ngToPmol(vng, vec.bp, bpDa);
    }
    out.vecPmol = vecPmol;

    // 5 · per-fragment target, volume, and what that volume really delivers
    good.forEach(function (f) {
      f.wantPmol = f.role === "vector" ? vecPmol : vecPmol * f.ratio;
      f.wantNg = C.pmolToNg(f.wantPmol, f.bp, bpDa);
      f.volRaw = f.wantPmol / f.pmolPerUl;
      f.vol = clean(roundTo(f.volRaw, step));
      if (f.vol < step) f.vol = step; // never print 0 µL for a fragment that has to go in
      f.gotPmol = f.vol * f.pmolPerUl;
      f.gotNg = f.vol * f.ngPerUl;
    });
    out.totalPmol = good.reduce(function (a, f) { return a + f.gotPmol; }, 0);
    out.totalNg = good.reduce(function (a, f) { return a + f.gotNg; }, 0);
    out.dnaVol = clean(good.reduce(function (a, f) { return a + f.vol; }, 0));
    out.water = clean(out.avail - out.dnaVol);
    out.unpureVol = clean(good.reduce(function (a, f) { return a + (f.unpure ? f.vol : 0); }, 0));
    out.vecGotPmol = vec.gotPmol;
    good.forEach(function (f) {
      f.ratioGot = f.role === "vector" ? 1 : f.gotPmol / vec.gotPmol;
    });

    // 6 · checks, each with the fix that follows from it
    if (out.water < 0) {
      var over = clean(-out.water);
      out.flags.push({
        kind: "err", k: "WON'T FIT",
        say: "The fragments need " + fx(out.dnaVol) + " µL but only " + fx(out.avail) + " µL is left after the mix — " + fx(over) + " µL too much."
      });
      // (a) a bigger reaction
      var bigger = null;
      for (var i = 0; i < C.VOLUMES.length; i++) {
        var v = C.VOLUMES[i];
        if (v <= totalVol) continue;
        var fixed = C.mixOf(system, kit, v, inserts.length).reduce(function (a, m) { return a + m.vol; }, 0);
        if (v - fixed >= out.dnaVol) { bigger = v; break; }
      }
      if (bigger) out.fixes.push({ k: "VOLUME", say: "Run it in " + bigger + " µL instead of " + totalVol + " µL.", act: { type: "totalVol", vol: bigger } });
      // (b) less DNA, if the smaller amount is still inside the recommended range
      var factor = out.avail / out.dnaVol;
      var lowered = out.totalPmol * factor;
      if (!rule.range || lowered >= rule.range[0]) {
        out.fixes.push({
          k: "LESS DNA",
          say: "Scale every fragment to " + Math.round(factor * 100) + "% — " + fx4(lowered) + " pmol total" + (rule.range ? ", still inside " + rule.rangeSay : "") + ".",
          act: { type: "basisTotal", pmol: clean3(lowered) }
        });
      }
      // (c) concentrate the fragment that takes the most room
      var worst = good.slice().sort(function (a, b) { return b.vol - a.vol; })[0];
      if (worst && worst.vol - over > step) {
        var need = worst.ngPerUl * worst.vol / (worst.vol - over);
        out.fixes.push({ k: "CONCENTRATE", say: "Or concentrate " + nameOf(worst) + " from " + fx(worst.ngPerUl) + " to " + fx(need) + " ng/µL." });
      } else {
        var fold = out.dnaVol / out.avail;
        out.fixes.push({ k: "CONCENTRATE", say: "Or concentrate every fragment at least " + fx(fold) + "-fold — no single one has enough room to give back " + fx(over) + " µL." });
      }
    }

    good.forEach(function (f) {
      if (f.vol < C.MIN_VOL) {
        var target = C.MIN_VOL * 2; // aim for 1 µL, which every pipette can manage
        var dil = f.ngPerUl * f.vol / target;
        out.flags.push({
          kind: "warn", k: "TOO SMALL",
          say: nameOf(f) + " is only " + fx(f.vol) + " µL. Dilute it to " + fx(dil) + " ng/µL and pipette " + fx(target) + " µL instead."
        });
      }
    });

    if (out.unpureVol > out.unpureCap + 1e-9) {
      out.flags.push({
        kind: "err", k: "PCR > 20%",
        say: "Unpurified PCR product comes to " + fx(out.unpureVol) + " µL, over the " + fx(out.unpureCap) + " µL (20% of the reaction) NEB allows. Clean up a fragment, or use less."
      });
    }

    if (rule.range) {
      if (out.totalPmol < rule.range[0] * 0.995 || out.totalPmol > rule.range[1] * 1.005) {
        var mid = (rule.range[0] + rule.range[1]) / 2;
        var vecAt = C.pmolToNg(mid / (1 + ratioSum), vec.bp, bpDa);
        out.flags.push({
          kind: "warn", k: "TOTAL DNA",
          say: "Total DNA is " + fx4(out.totalPmol) + " pmol; " + rule.source + " recommends " + rule.rangeSay + " for " + rule.band + "."
        });
        out.fixes.push({ k: "RETARGET", say: "Use " + fx(vecAt) + " ng of vector (" + fx4(mid) + " pmol total).", act: { type: "vectorNg", ng: clean3(vecAt) } });
      }
    }

    if (system === "gibson") {
      if (vec.gotNg < 40 || vec.gotNg > 120) {
        out.flags.push({ kind: "info", k: "VECTOR ng", say: "Vector is " + fx(vec.gotNg) + " ng. NEB's optimised range is 50–100 ng." });
      }
      inserts.forEach(function (f) {
        if (f.bp < 200 && f.ratio < 5 - 1e-9) {
          out.flags.push({ kind: "info", k: "SHORT INSERT", say: nameOf(f) + " is " + f.bp + " bp. NEB asks for a 5-fold excess of inserts under 200 bp; this one is at " + fx(f.ratio) + "×." });
        }
      });
      if (good.length > 6) {
        out.flags.push({ kind: "info", k: "> 6 FRAGMENTS", say: "Beyond the protocol's 6 fragments: NEB says to scale the reaction up and add master mix in proportion. Pick a larger reaction volume." });
      }
      if (good.length === 4) {
        out.flags.push({ kind: "info", k: "RULE CHANGED", say: "At 4 fragments the recommendation changes to a 1:1 ratio and " + rule.rangeSay + "." });
      }
    }

    if (system === "gg") {
      if (Math.abs(vec.gotNg - C.GG_VECTOR_NG) > C.GG_VECTOR_NG * 0.2) {
        out.flags.push({ kind: "info", k: "VECTOR ng", say: "Vector is " + fx(vec.gotNg) + " ng. The NEBridge protocol uses 75 ng of destination plasmid." });
      }
      if (inserts.length > 10) {
        out.flags.push({ kind: "info", k: "ENZYME 2 µL", say: "More than 10 inserts, so the enzyme mix goes up to 2 µL." });
      }
    }

    if (system === "lig") {
      var ugml = out.totalNg / totalVol; // 1 ng/µL is 1 µg/mL
      out.ugml = ugml;
      if (ugml < C.LIG_TOTAL_UGML[0] || ugml > C.LIG_TOTAL_UGML[1]) {
        out.flags.push({
          kind: "info", k: "TOTAL DNA",
          say: "Total DNA works out to " + fx(ugml) + " µg/mL; NEB's optimal range for a ligation is 1–10 µg/mL (" + fx(C.LIG_TOTAL_UGML[0] * totalVol) + "–" + fx(C.LIG_TOTAL_UGML[1] * totalVol) + " ng in " + totalVol + " µL)."
        });
      }
      inserts.forEach(function (f) {
        var want = C.autoRatio("lig", kit, good.length, f.bp);
        if (want > f.ratio + 1e-9) {
          out.flags.push({ kind: "info", k: "SHORT INSERT", say: nameOf(f) + " is " + f.bp + " bp; a short insert usually needs about " + want + "× the vector in moles, not " + fx(f.ratio) + "×." });
        }
      });
    }

    good.forEach(function (f) {
      if (f.unit === "nM" && f.conc > 10000) out.flags.push({ kind: "info", k: "CHECK UNIT", say: nameOf(f) + " is " + fx(f.conc) + " nM — that is " + fx(f.ngPerUl) + " ng/µL. Did you mean ng/µL?" });
      if (f.unit === "ng/uL" && f.conc > 2000) out.flags.push({ kind: "info", k: "CHECK UNIT", say: nameOf(f) + " is " + fx(f.conc) + " ng/µL. Did you mean nM?" });
      var dev = Math.abs(f.gotPmol - f.wantPmol) / f.wantPmol;
      if (dev > 0.1 && f.vol >= C.MIN_VOL) {
        out.flags.push({ kind: "info", k: "ROUNDING", say: nameOf(f) + " rounds to " + fx(f.vol) + " µL, which is " + Math.round(dev * 100) + "% " + (f.gotPmol > f.wantPmol ? "over" : "under") + " the target. A finer step or a dilution would land closer." });
      }
    });

    out.ok = !out.flags.some(function (f) { return f.kind === "err"; });
    return out;
  };

  // ---------- scaling for several reactions ----------
  C.scale = function (res, reactions, overage) {
    var n = reactions > 0 ? Math.floor(reactions) : 1;
    var f = n * (1 + (overage > 0 ? overage : 0) / 100);
    var lines = [];
    res.rows.forEach(function (r) {
      if (r.bad || r.vol == null) return;
      lines.push({ name: nameOf(r), per: r.vol, tot: clean(r.vol * f), dna: true });
    });
    res.mix.forEach(function (m) { lines.push({ name: m.name, per: m.vol, tot: clean(m.vol * f) }); });
    lines.push({ name: "Nuclease-free water", per: clean(Math.max(0, res.water)), tot: clean(Math.max(0, res.water) * f), water: true });
    return { n: n, factor: f, lines: lines, total: clean(res.totalVol * f), perTube: res.totalVol };
  };

  // ---------- naming / formatting used in messages ----------
  function nameOf(f) { return f.name || (f.role === "vector" ? "the vector" : "insert " + (f.i + 1)); }
  C.nameOf = nameOf;
  function fx(x) {
    if (x == null || !isFinite(x)) return "—";
    var a = Math.abs(x);
    var d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
    return trim(x.toFixed(d));
  }
  function fx4(x) {
    if (x == null || !isFinite(x)) return "—";
    return trim(x.toFixed(Math.abs(x) < 0.1 ? 4 : 3));
  }
  function trim(s) { return s.indexOf(".") >= 0 ? s.replace(/0+$/, "").replace(/\.$/, "") : s; }
  function clean3(x) { return Math.round(x * 1000) / 1000; }
  C.fx = fx; C.fx4 = fx4;
})();
