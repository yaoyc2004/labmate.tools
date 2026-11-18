// labmate.tools — 2.5 qPCR Relative Quantification: maths and file readers.
// No page code here: everything takes plain data and returns plain data, so it can be checked on its own.
(function () {
  "use strict";
  var Q = (window.LMQ = {});
  Q.ALGO = "labmate-qpcr-1";

  // ===================================================================
  // 1. Small statistics
  // ===================================================================
  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : NaN; }
  function sd(a) {
    if (a.length < 2) return NaN;
    var m = mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / (a.length - 1));
  }
  function median(a) {
    var b = a.slice().sort(function (x, y) { return x - y; }), n = b.length;
    return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : NaN;
  }
  Q.mean = mean; Q.sd = sd; Q.median = median;

  // log Γ (Lanczos)
  function lgamma(x) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var y = x, t = x + 5.5, s = 1.000000000190015;
    t -= (x + 0.5) * Math.log(t);
    for (var j = 0; j < 6; j++) s += c[j] / ++y;
    return -t + Math.log(2.5066282746310005 * s / x);
  }
  function betacf(a, b, x) {
    var MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
    var qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d; var h = d;
    for (var m = 1; m <= MAXIT; m++) {
      var m2 = 2 * m, aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; var del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  // regularised incomplete beta I_x(a, b)
  function ibeta(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  // two-sided p for Student t with df degrees of freedom
  Q.tTwoSided = function (t, df) {
    if (!isFinite(t) || !(df > 0)) return NaN;
    return ibeta(df / 2, 0.5, df / (df + t * t));
  };
  // t such that P(|T| < t) = conf (e.g. 0.95)
  Q.tCrit = function (conf, df) {
    if (!(df > 0)) return NaN;
    var target = 1 - conf, lo = 0, hi = 1e4;
    for (var i = 0; i < 200; i++) {
      var mid = (lo + hi) / 2;
      if (Q.tTwoSided(mid, df) > target) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  Q.welch = function (a, b) {
    var n1 = a.length, n2 = b.length;
    if (n1 < 2 || n2 < 2) return null;
    var v1 = Math.pow(sd(a), 2), v2 = Math.pow(sd(b), 2), q1 = v1 / n1, q2 = v2 / n2, se2 = q1 + q2;
    if (!(se2 > 0)) return null;
    var t = (mean(a) - mean(b)) / Math.sqrt(se2);
    var df = se2 * se2 / (q1 * q1 / (n1 - 1) + q2 * q2 / (n2 - 1));
    return { t: t, df: df, p: Q.tTwoSided(t, df) };
  };
  // Holm step-down adjustment; NaN stays NaN
  Q.holm = function (ps) {
    var idx = [], out = ps.map(function () { return NaN; });
    ps.forEach(function (p, i) { if (isFinite(p)) idx.push(i); });
    idx.sort(function (x, y) { return ps[x] - ps[y]; });
    var m = idx.length, run = 0;
    idx.forEach(function (i, j) { run = Math.max(run, Math.min(1, (m - j) * ps[i])); out[i] = run; });
    return out;
  };
  // least-squares line y = a + b x
  Q.linfit = function (xs, ys) {
    var n = xs.length;
    if (n < 2) return null;
    var mx = mean(xs), my = mean(ys), sxx = 0, sxy = 0, syy = 0;
    for (var i = 0; i < n; i++) { sxx += (xs[i] - mx) * (xs[i] - mx); sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) * (ys[i] - my); }
    if (!(sxx > 0)) return null;
    var b = sxy / sxx, a = my - b * mx, ssr = 0;
    for (i = 0; i < n; i++) { var r = ys[i] - a - b * xs[i]; ssr += r * r; }
    return { slope: b, intercept: a, r2: syy > 0 ? 1 - ssr / syy : 1, seSlope: n > 2 ? Math.sqrt(ssr / (n - 2) / sxx) : NaN, n: n };
  };

  // ===================================================================
  // 2. Efficiency
  // ===================================================================
  // "1.95" → 1.95 ; "95" or "95%" → 1.95. Returns NaN when out of 1.5–2.5.
  Q.parseEff = function (s) {
    var t = String(s == null ? "" : s).replace("%", "").trim().replace(",", ".");
    if (!t) return null;
    var v = parseFloat(t);
    if (!isFinite(v) || !/^[0-9.]+$/.test(t)) return NaN;
    var E = v > 3 ? 1 + v / 100 : v;
    return E >= 1.5 && E <= 2.5 ? E : NaN;
  };
  Q.curveEff = function (points) { // points: [{qty, cq}]
    var pts = points.filter(function (p) { return p.qty > 0 && isFinite(p.cq); });
    var fit = Q.linfit(pts.map(function (p) { return Math.log10(p.qty); }), pts.map(function (p) { return p.cq; }));
    if (!fit || !(fit.slope < 0)) return fit ? { fit: fit, E: NaN, points: pts } : null;
    var E = Math.pow(10, -1 / fit.slope);
    var levels = {};
    pts.forEach(function (p) { levels[p.qty] = 1; });
    return {
      fit: fit, E: E, pct: (E - 1) * 100,
      seE: E * Math.LN10 * fit.seSlope / (fit.slope * fit.slope),
      levels: Object.keys(levels).length, points: pts
    };
  };

  // ===================================================================
  // 3. The analysis
  // ===================================================================
  // input: { wells:[{uid, file, well, sample, target, cq, und, task, qty, omit}],
  //          samples:{name:{group, use}}, targets:{name:{role:'goi'|'ref'|'skip', eff:'auto'|'2'|'<number>'}},
  //          excluded:{uid:reason}, control, calSample (optional), sdMax, cqMax, conf }
  Q.analyze = function (inp) {
    var sdMax = inp.sdMax > 0 ? inp.sdMax : 0.3, cqMax = inp.cqMax > 0 ? inp.cqMax : 35;
    var excluded = inp.excluded || {}, warnings = [];
    var res = { eff: {}, reps: [], repMap: {}, cal: {}, perSample: [], groups: [], genorm: null, nf: {}, ntc: [], warnings: warnings, refShift: null };
    var tnames = Object.keys(inp.targets || {});
    var refs = tnames.filter(function (t) { return inp.targets[t].role === "ref"; });
    var gois = tnames.filter(function (t) { return inp.targets[t].role === "goi"; });
    res.refs = refs; res.gois = gois;

    // --- efficiency per target
    tnames.forEach(function (t) {
      var cfg = inp.targets[t], std = inp.wells.filter(function (w) {
        return w.target === t && w.task === "standard" && !w.omit && !excluded[w.uid] && w.qty > 0 && w.cq != null;
      }).map(function (w) { return { qty: w.qty, cq: w.cq, uid: w.uid }; });
      var curve = std.length >= 3 ? Q.curveEff(std) : null;
      var o = { E: 2, src: "default", curve: curve, flags: [] };
      var typed = cfg.eff && cfg.eff !== "auto" && cfg.eff !== "curve" ? Q.parseEff(cfg.eff) : null;
      if (cfg.eff === "curve") {
        if (curve && isFinite(curve.E)) { o.E = curve.E; o.src = "curve"; }
        else { o.src = "default"; o.flags.push(["NO CURVE", "No usable standard wells for " + t + " — 100% assumed."]); }
      } else if (typed != null && isFinite(typed)) { o.E = typed; o.src = "value"; }
      else if (typed != null && !isFinite(typed)) { o.bad = true; o.flags.push(["BAD EFFICIENCY", "Efficiency for " + t + " must be 90–110% style (e.g. 95 or 1.95) — 100% used."]); }
      if (curve && isFinite(curve.E)) {
        if (curve.pct < 90 || curve.pct > 110) o.flags.push(["EFFICIENCY " + Math.round(curve.pct) + "%", "Standard curve gives " + curve.pct.toFixed(1) + "% — outside 90–110%."]);
        if (curve.fit.r2 < 0.98) o.flags.push(["R² " + curve.fit.r2.toFixed(3), "Standard curve R² below 0.98."]);
        if (curve.levels < 5) o.flags.push(["FEW POINTS", "Standard curve has " + curve.levels + " dilution levels; MIQE asks for at least 5."]);
      }
      o.pct = (o.E - 1) * 100;
      res.eff[t] = o;
    });

    // --- technical replicates
    var byKey = {};
    inp.wells.forEach(function (w) {
      if (w.task !== "unknown") return;
      var s = inp.samples[w.sample];
      if (!s || s.use === false || !inp.targets[w.target] || inp.targets[w.target].role === "skip") return;
      var k = w.sample + "\u0001" + w.target;
      (byKey[k] = byKey[k] || { sample: w.sample, target: w.target, wells: [] }).wells.push(w);
    });
    Object.keys(byKey).forEach(function (k) {
      var r = byKey[k], used = [], nUnd = 0, nEx = 0;
      r.wells.forEach(function (w) {
        if (w.omit || excluded[w.uid]) { nEx++; return; }
        if (w.cq == null) { nUnd++; return; }
        used.push(w.cq);
      });
      r.k = used.length; r.nUnd = nUnd; r.nEx = nEx;
      r.mean = used.length ? mean(used) : null;
      r.sd = used.length > 1 ? sd(used) : NaN;
      r.flags = [];
      if (!used.length) r.flags.push(["NOT DETECTED", nUnd ? "No amplification in any well." : "Every well excluded."]);
      else {
        if (used.length > 1 && r.sd > sdMax) r.flags.push(["HIGH SD", "SD " + r.sd.toFixed(2) + " > " + sdMax + " cycles" + (used.length === 2 ? " (duplicates " + Math.abs(used[0] - used[1]).toFixed(2) + " apart)." : ".")]);
        if (nUnd) r.flags.push(["NO AMP " + nUnd + "/" + (used.length + nUnd), "Some wells did not amplify; they are left out of the mean."]);
        if (r.mean > cqMax) r.flags.push(["LATE Cq", "Mean Cq " + r.mean.toFixed(2) + " > " + cqMax + ": low copy number, results less reliable."]);
        if (used.length === 1) r.flags.push(["SINGLE WELL", "Only one usable well."]);
      }
      // outlier suggestion for three or more wells: drop the one furthest from the median, only if that fixes the SD
      if (used.length >= 3 && r.sd > sdMax) {
        var live = r.wells.filter(function (w) { return !w.omit && !excluded[w.uid] && w.cq != null; });
        var med = median(used), far = null;
        live.forEach(function (w) { if (!far || Math.abs(w.cq - med) > Math.abs(far.cq - med)) far = w; });
        var rest = live.filter(function (w) { return w !== far; }).map(function (w) { return w.cq; });
        if (far && sd(rest) < 0.2) r.suggest = far.uid;
      }
      res.reps.push(r);
      (res.repMap[r.sample] = res.repMap[r.sample] || {})[r.target] = r;
    });
    res.reps.sort(function (a, b) { return a.sample < b.sample ? -1 : a.sample > b.sample ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : 0; });

    // --- samples with a group
    var sampleNames = Object.keys(inp.samples).filter(function (s) { var o = inp.samples[s]; return o.use !== false && o.group; });
    var groupNames = [];
    sampleNames.forEach(function (s) { var g = inp.samples[s].group; if (groupNames.indexOf(g) < 0) groupNames.push(g); });
    res.groupNames = groupNames;
    var control = inp.control && groupNames.indexOf(inp.control) >= 0 ? inp.control : groupNames[0];
    res.control = control;

    if (!refs.length) { warnings.push(["NO REFERENCE", "Mark at least one gene as a reference gene."]); }
    if (!gois.length) { warnings.push(["NO TARGET GENE", "Mark at least one gene as a target gene."]); }

    // --- calibrator Cq per target
    var calSamples = inp.calSample && inp.samples[inp.calSample] && inp.samples[inp.calSample].use !== false ? [inp.calSample]
      : sampleNames.filter(function (s) { return inp.samples[s].group === control; });
    res.calSamples = calSamples;
    refs.concat(gois).forEach(function (t) {
      var v = calSamples.map(function (s) { return res.repMap[s] && res.repMap[s][t] && res.repMap[s][t].mean; }).filter(function (x) { return x != null; });
      res.cal[t] = v.length ? mean(v) : null;
      if (!v.length) warnings.push(["NO CALIBRATOR", t + " has no value in the calibrator (" + (inp.calSample ? inp.calSample : control) + "), so it can't be compared."]);
    });

    function l2(t) { return Math.log(res.eff[t].E) / Math.LN2; }
    function dq(s, t) { // log2 relative quantity, and its technical variance
      var r = res.repMap[s] && res.repMap[s][t];
      if (!r || r.mean == null || res.cal[t] == null) return null;
      var v = r.k > 1 ? Math.pow(l2(t), 2) * r.sd * r.sd / r.k : NaN;
      return { v: l2(t) * (res.cal[t] - r.mean), var: v, cq: r.mean };
    }

    // --- normalisation factor per sample (log2 of geometric mean of reference RQs)
    sampleNames.forEach(function (s) {
      if (!refs.length) return;
      var parts = refs.map(function (t) { return dq(s, t); });
      if (parts.some(function (p) { return !p; })) {
        res.nf[s] = { missing: refs.filter(function (t, i) { return !parts[i]; }) };
        return;
      }
      var n = refs.length;
      res.nf[s] = {
        v: mean(parts.map(function (p) { return p.v; })),
        var: parts.reduce(function (a, p) { return a + p.var; }, 0) / (n * n),
        parts: parts
      };
    });

    // --- per sample, per target gene
    sampleNames.forEach(function (s) {
      var nf = res.nf[s];
      gois.forEach(function (t) {
        var g = dq(s, t), row = { sample: s, group: inp.samples[s].group, target: t };
        var rep = res.repMap[s] && res.repMap[s][t];
        if (!rep) { row.skip = "no wells"; }
        else if (!g) { row.skip = rep.mean == null ? "not detected" : "no calibrator"; }
        else if (!nf || nf.missing) { row.skip = "reference missing" + (nf && nf.missing ? " (" + nf.missing.join(", ") + ")" : ""); }
        if (row.skip) { row.cq = rep && rep.mean; res.perSample.push(row); return; }
        row.cq = g.cq; row.dq = g.v; row.nf = nf.v;
        row.log2 = g.v - nf.v; row.nrq = Math.pow(2, row.log2);
        row.se = Math.sqrt(g.var + nf.var);
        res.perSample.push(row);
      });
    });

    // --- groups
    var conf = inp.conf || 0.95;
    gois.forEach(function (t) {
      var rows = res.perSample.filter(function (r) { return r.target === t && r.log2 != null; });
      var ctrl = rows.filter(function (r) { return r.group === control; }).map(function (r) { return r.log2; });
      var list = groupNames.map(function (g) {
        var rs = rows.filter(function (r) { return r.group === g; }), v = rs.map(function (r) { return r.log2; });
        var o = { target: t, group: g, n: v.length, values: v, samples: rs.map(function (r) { return r.sample; }), isControl: g === control };
        if (!v.length) return o;
        o.mean = mean(v); o.sd = sd(v); o.sem = o.sd / Math.sqrt(v.length);
        o.tc = v.length > 1 ? Q.tCrit(conf, v.length - 1) : NaN;
        o.ci = o.tc * o.sem;
        o.fc = Math.pow(2, o.mean);
        if (v.length === 1) o.techSe = rs[0].se;
        if (!o.isControl && v.length >= 3 && ctrl.length >= 3) {
          var w = Q.welch(v, ctrl);
          if (w) { o.t = w.t; o.df = w.df; o.p = w.p; }
        }
        return o;
      });
      var adj = Q.holm(list.map(function (o) { return o.p == null ? NaN : o.p; }));
      list.forEach(function (o, i) { if (o.p != null) o.pAdj = adj[i]; });
      res.groups = res.groups.concat(list);
    });

    // --- reference stability: geNorm M and shift of the normalisation factor between groups
    if (refs.length >= 2) {
      var full = sampleNames.filter(function (s) { return res.nf[s] && !res.nf[s].missing; });
      if (full.length >= 2) {
        var V = {};
        refs.forEach(function (a, i) {
          refs.forEach(function (b, j) {
            if (j <= i) return;
            var d = full.map(function (s) { return res.nf[s].parts[i].v - res.nf[s].parts[j].v; });
            V[a + "\u0001" + b] = V[b + "\u0001" + a] = sd(d);
          });
        });
        res.genorm = refs.map(function (a) {
          var vs = refs.filter(function (b) { return b !== a; }).map(function (b) { return V[a + "\u0001" + b]; });
          return { target: a, M: mean(vs) };
        });
        res.genormN = full.length;
      }
    }
    if (refs.length) {
      var gm = groupNames.map(function (g) {
        var v = sampleNames.filter(function (s) { return inp.samples[s].group === g && res.nf[s] && !res.nf[s].missing; }).map(function (s) { return res.nf[s].v; });
        return { group: g, n: v.length, mean: v.length ? mean(v) : NaN };
      }).filter(function (o) { return o.n; });
      if (gm.length > 1) {
        var ms = gm.map(function (o) { return o.mean; });
        res.refShift = { groups: gm, range: Math.max.apply(null, ms) - Math.min.apply(null, ms) };
        if (res.refShift.range > 0.5) warnings.push(["REFERENCE SHIFT", "The reference genes differ by " + res.refShift.range.toFixed(2) + " log₂ units between groups — they may respond to the treatment."]);
      }
    }

    // --- no-template and no-RT controls
    inp.wells.forEach(function (w) {
      if (w.task !== "ntc" && w.task !== "nrt") return;
      if (w.omit || excluded[w.uid]) return;
      var sm = res.reps.filter(function (r) { return r.target === w.target && r.mean != null; }).map(function (r) { return r.mean; });
      var o = { uid: w.uid, well: w.well, sample: w.sample, target: w.target, task: w.task, cq: w.cq };
      if (w.cq == null) o.verdict = "clean";
      else if (sm.length && w.cq - Math.max.apply(null, sm) < 5) {
        o.verdict = "warn"; o.gap = w.cq - Math.max.apply(null, sm);
        warnings.push([w.task.toUpperCase() + " AMPLIFIED", w.target + " " + w.task.toUpperCase() + " (" + (w.well || w.sample || "") + ") Cq " + w.cq.toFixed(2) + " — within 5 cycles of the latest sample."]);
      } else { o.verdict = "late"; o.gap = sm.length ? w.cq - Math.max.apply(null, sm) : NaN; }
      res.ntc.push(o);
    });

    var assumed = refs.concat(gois).filter(function (t) { return res.eff[t].src === "default"; });
    res.assumed = assumed;
    return res;
  };

  // error bar ends in fold-change units for one group summary
  Q.bar = function (o, kind) {
    if (o.mean == null || isNaN(o.mean)) return null;
    var h = kind === "sd" ? o.sd : kind === "ci" ? o.ci : o.sem;
    if (o.n === 1) h = o.techSe;
    if (!isFinite(h)) return { lo: o.fc, hi: o.fc, h: NaN };
    return { lo: Math.pow(2, o.mean - h), hi: Math.pow(2, o.mean + h), h: h };
  };

  // ===================================================================
  // 4. Reading instrument exports
  // ===================================================================
  // --- text → grid
  Q.decode = function (bytes) {
    var u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var enc = "utf-8", start = 0;
    if (u[0] === 0xFF && u[1] === 0xFE) { enc = "utf-16le"; start = 2; }
    else if (u[0] === 0xFE && u[1] === 0xFF) { enc = "utf-16be"; start = 2; }
    else if (u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF) start = 3;
    else if (u.length > 4 && u[1] === 0 && u[3] === 0 && u[0] !== 0) enc = "utf-16le";
    var txt;
    try { txt = new TextDecoder(enc, { fatal: enc === "utf-8" }).decode(u.subarray(start)); }
    catch (e) { txt = new TextDecoder("windows-1252").decode(u.subarray(start)); }
    return txt;
  };
  function splitLine(line, d) {
    if (d !== "," && d !== ";") return line.split(d);
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === d) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }
  Q.textGrid = function (text) {
    var lines = String(text).replace(/^﻿/, "").split(/\r\n|\r|\n/);
    var sample = lines.filter(function (l) { return l.trim(); }).slice(0, 120);
    var count = function (ch) { return sample.reduce(function (a, l) { return a + (l.split(ch).length - 1); }, 0); };
    var tabs = count("\t"), commas = count(","), semis = count(";");
    var semiLines = sample.filter(function (l) { return l.indexOf(";") >= 0; }).length;
    var d = tabs >= commas && tabs >= semis && tabs > 0 ? "\t"
      : semis > commas || (semis && tabs === 0 && semiLines >= 0.8 * sample.length) ? ";" // decimal commas don't outvote ;
      : commas > 0 ? "," : "\t";
    return lines.map(function (l) { return splitLine(l, d).map(function (c) { return c.trim(); }); });
  };

  // --- zip (xlsx, rdml) with the browser's own inflate
  function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("This browser can't open zipped files — save the export as CSV or text."));
    var ds = new DecompressionStream("deflate-raw");
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  Q.unzip = function (buf) {
    var u = new Uint8Array(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    var eocd = -1;
    for (var i = u.length - 22; i >= Math.max(0, u.length - 66000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return Promise.reject(new Error("Not a readable zip file."));
    var n = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true), files = {};
    var jobs = [];
    for (var k = 0; k < n; k++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      var method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
      var nlen = dv.getUint16(off + 28, true), xlen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
      var lho = dv.getUint32(off + 42, true);
      var name = new TextDecoder().decode(u.subarray(off + 46, off + 46 + nlen));
      var dstart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      var data = u.subarray(dstart, dstart + csize);
      (function (name, method, data) {
        files[name] = function () {
          if (method === 0) return Promise.resolve(data);
          if (method === 8) return inflateRaw(data);
          return Promise.reject(new Error("Unsupported zip compression."));
        };
      })(name, method, data);
      off += 46 + nlen + xlen + clen;
    }
    return Promise.resolve(files);
  };
  function xmlDoc(bytes) { return new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml"); }
  function kids(el, name) { var out = []; if (!el) return out; for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) out.push(c); return out; }
  function kid(el, name) { return kids(el, name)[0] || null; }
  function txt(el) { return el ? el.textContent.trim() : ""; }

  // xlsx → [{name, grid}]
  Q.readXlsx = function (files) {
    var get = function (p) { return files[p] ? files[p]() : Promise.resolve(null); };
    return Promise.all([get("xl/workbook.xml"), get("xl/_rels/workbook.xml.rels"), get("xl/sharedStrings.xml")]).then(function (r) {
      if (!r[0]) throw new Error("No worksheet found in this .xlsx file.");
      var wb = xmlDoc(r[0]), rels = r[1] ? xmlDoc(r[1]) : null, ss = [];
      if (r[2]) {
        kids(xmlDoc(r[2]).documentElement, "si").forEach(function (si) {
          var t = si.getElementsByTagNameNS("*", "t"), s = "";
          for (var i = 0; i < t.length; i++) if (t[i].parentNode.localName !== "rPh") s += t[i].textContent;
          ss.push(s);
        });
      }
      var relMap = {};
      if (rels) kids(rels.documentElement, "Relationship").forEach(function (x) { relMap[x.getAttribute("Id")] = x.getAttribute("Target"); });
      var sheets = kids(kid(wb.documentElement, "sheets"), "sheet").map(function (sh, i) {
        var rid = sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || sh.getAttribute("r:id");
        var t = relMap[rid] || ("worksheets/sheet" + (i + 1) + ".xml");
        t = t.replace(/^\/?xl\//, "").replace(/^\//, "");
        return { name: sh.getAttribute("name"), path: "xl/" + t };
      });
      return Promise.all(sheets.map(function (sh) {
        return get(sh.path).then(function (b) {
          if (!b) return null;
          var doc = xmlDoc(b), grid = [];
          var rows = doc.getElementsByTagNameNS("*", "row");
          for (var i = 0; i < rows.length; i++) {
            var rn = +rows[i].getAttribute("r") || (i + 1), line = [];
            kids(rows[i], "c").forEach(function (c, ci) {
              var ref = c.getAttribute("r"), col = ci;
              if (ref) { var m = /^([A-Z]+)/.exec(ref), v = 0; for (var j = 0; j < m[1].length; j++) v = v * 26 + m[1].charCodeAt(j) - 64; col = v - 1; }
              var t = c.getAttribute("t"), val;
              if (t === "s") val = ss[+txt(kid(c, "v"))] || "";
              else if (t === "inlineStr") val = txt(kid(c, "is"));
              else val = txt(kid(c, "v"));
              line[col] = val;
            });
            for (var k = 0; k < line.length; k++) if (line[k] == null) line[k] = "";
            grid[rn - 1] = line;
          }
          for (var g = 0; g < grid.length; g++) if (!grid[g]) grid[g] = [];
          return { name: sh.name, grid: grid };
        });
      })).then(function (list) { return list.filter(Boolean); });
    });
  };

  // RDML → wells
  Q.readRdml = function (files) {
    var name = Object.keys(files).filter(function (n) { return /\.xml$/i.test(n); })[0];
    if (!name) return Promise.reject(new Error("No rdml_data.xml inside this RDML file."));
    return files[name]().then(function (b) { return Q.parseRdmlXml(xmlDoc(b)); });
  };
  Q.parseRdmlXml = function (doc) {
    var root = doc.documentElement, samples = {}, wells = [];
    kids(root, "sample").forEach(function (s) {
      var q = kid(s, "quantity");
      samples[s.getAttribute("id")] = { type: txt(kid(s, "type")), qty: q ? parseFloat(txt(kid(q, "value"))) : NaN };
    });
    kids(root, "experiment").forEach(function (ex) {
      kids(ex, "run").forEach(function (run) {
        var fmt = kid(run, "pcrFormat"), cols = fmt ? +txt(kid(fmt, "columns")) || 12 : 12;
        var rowLab = fmt ? txt(kid(fmt, "rowLabel")) : "ABC";
        kids(run, "react").forEach(function (re) {
          var id = +re.getAttribute("id"), sref = kid(re, "sample"), sid = sref ? sref.getAttribute("id") : "";
          var well = id > 0 && rowLab !== "123" ? String.fromCharCode(65 + Math.floor((id - 1) / cols)) + (((id - 1) % cols) + 1) : String(id);
          kids(re, "data").forEach(function (d) {
            var tar = kid(d, "tar"), cqs = txt(kid(d, "cq")), cq = cqs === "" ? NaN : parseFloat(cqs);
            var si = samples[sid] || {}, ty = (kid(d, "sampleType") ? txt(kid(d, "sampleType")) : si.type) || "unkn";
            wells.push({
              well: well, sample: sid, target: tar ? tar.getAttribute("id") : "",
              cq: isFinite(cq) && cq > 0 ? cq : null, und: !(isFinite(cq) && cq > 0),
              task: ty === "std" ? "standard" : ty === "ntc" || ty === "nac" || ty === "ntp" ? "ntc" : ty === "nrt" ? "nrt" : ty === "unkn" ? "unknown" : "other",
              qty: ty === "std" ? si.qty : NaN, omit: (kid(d, "excl") && txt(kid(d, "excl"))) ? true : false
            });
          });
        });
      });
    });
    return wells;
  };

  // --- header recognition
  function norm(h) { return String(h || "").toLowerCase().replace(/т/g, "t").replace(/[^a-z0-9]/g, ""); }
  var ROLES = {
    well: ["wellposition", "well", "pos", "position", "no", "wellid"],
    sample: ["samplename", "sample", "name", "sampleid", "biologicalsample"],
    target: ["targetname", "target", "detectorname", "detector", "genename", "gene", "assayname", "assay", "targetid", "primer", "primers"],
    cq: ["cq", "ct", "cp", "crt", "ctvalue", "cqvalue", "cpvalue"],
    task: ["task", "content", "sampletype", "type", "welltype", "role"],
    qty: ["startingquantitysq", "quantity", "qty", "sq", "standard", "givenconccopiesreaction", "givenconc", "startingquantity", "copies"],
    omit: ["omit", "include", "excluded", "exclude"],
    group: ["biologicalsetname", "biogroup", "group", "condition", "treatment"],
    fluor: ["fluor", "reporter", "dye", "channel"]
  };
  Q.ROLES = Object.keys(ROLES);
  function roleOf(h) {
    var n = norm(h);
    if (!n) return null;
    for (var r in ROLES) {
      var list = ROLES[r];
      for (var i = 0; i < list.length; i++) if (n === list[i]) return { role: r, rank: i };
    }
    if (/^givenconc/.test(n)) return { role: "qty", rank: 7 };
    return null;
  }
  function mapRow(row) {
    var map = {}, rank = {};
    row.forEach(function (h, i) {
      var r = roleOf(h);
      if (!r) return;
      if (map[r.role] == null || r.rank < rank[r.role]) { map[r.role] = i; rank[r.role] = r.rank; }
    });
    return map;
  }
  // pick the block of a grid that holds results: QuantStudio text exports have [Sample Setup], [Results]… sections
  function resultsBlock(grid) {
    var sec = [];
    grid.forEach(function (r, i) { var c = (r[0] || "").trim(); if (/^\[[^\]]+\]$/.test(c) && r.slice(1).every(function (x) { return !x; })) sec.push({ i: i, name: c.slice(1, -1).toLowerCase() }); });
    if (!sec.length) return { grid: grid, offset: 0 };
    var res = sec.filter(function (s) { return /^results?$/.test(s.name); })[0];
    if (!res) return { grid: grid, offset: 0 };
    var next = sec.filter(function (s) { return s.i > res.i; })[0];
    return { grid: grid.slice(res.i + 1, next ? next.i : grid.length), offset: res.i + 1 };
  }
  function looksNum(s) { return /^-?\d+([.,]\d+)?(e[+-]?\d+)?$/i.test(String(s).trim()); }
  function num(s) {
    s = String(s == null ? "" : s).trim();
    if (!s) return NaN;
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
    else s = s.replace(",", ".");
    return looksNum(s) ? parseFloat(s) : NaN;
  }
  Q.num = num;
  // a Cq is never 1000 or more, so a single comma is always a decimal comma
  function cqNum(s) {
    s = String(s == null ? "" : s).trim();
    if ((s.match(/,/g) || []).length === 1 && s.indexOf(".") < 0) s = s.replace(",", ".");
    return num(s);
  }
  Q.cqNum = cqNum;

  // find the header row (or a wide samples × genes table)
  Q.detect = function (grid0) {
    var blk = resultsBlock(grid0), grid = blk.grid, best = null;
    for (var i = 0; i < Math.min(grid.length, 120); i++) {
      var row = grid[i] || [];
      if (row.filter(function (c) { return c; }).length < 2) continue;
      var m = mapRow(row), score = Object.keys(m).length;
      if (m.cq == null || m.sample == null && m.well == null) continue;
      if (!best || score > best.score) best = { row: i + blk.offset, map: m, score: score };
    }
    if (best) {
      best.header = grid0[best.row];
      best.kind = "long";
      return best;
    }
    // wide: a header with a name column and ≥ 1 column of Cq-like numbers
    for (i = 0; i < Math.min(grid.length, 40); i++) {
      var h = grid[i] || [], body = grid.slice(i + 1).filter(function (r) { return r && r.some(function (c) { return c; }); });
      if (h.filter(function (c) { return c; }).length < 2 || body.length < 1) continue;
      var numCols = [];
      h.forEach(function (c, j) {
        if (!c || j === 0) return;
        var vals = body.map(function (r) { return r[j] || ""; }).filter(function (x) { return x; });
        var okv = vals.filter(function (x) { var v = cqNum(x); return (v >= 5 && v <= 50) || /^(undetermined|nan|n\/?a|no ?ct|-)$/i.test(x); });
        if (vals.length && okv.length / vals.length >= 0.8 && vals.some(function (x) { return looksNum(x); })) numCols.push(j);
      });
      var nameNum = body.filter(function (r) { return looksNum(r[0] || ""); }).length;
      if (numCols.length >= 1 && nameNum < body.length / 2) return { kind: "wide", row: i + blk.offset, header: h, cols: numCols, map: { sample: 0 }, score: 1 };
    }
    return null;
  };

  Q.instrument = function (grid, det) {
    var head = grid.slice(0, Math.min(grid.length, (det ? det.row : 0) + 1)).map(function (r) { return (r || []).join(" "); }).join("\n");
    var H = det && det.header ? det.header.map(norm) : [];
    var has = function (x) { return H.indexOf(x) >= 0; };
    if (/^\* /m.test(head) || has("wellposition") || has("targetname") && has("task") || has("detector") || /^SDS /m.test(head)) {
      if (/QuantStudio|ViiA/i.test(head)) return "Thermo QuantStudio / ViiA 7";
      if (/7500|^SDS /m.test(head)) return "Applied Biosystems 7500";
      if (/StepOne/i.test(head)) return "Applied Biosystems StepOne";
      return "Applied Biosystems / QuantStudio";
    }
    if (has("content") && has("fluor")) return "Bio-Rad CFX";
    if (/^Experiment:/m.test(head) || has("pos") && has("cp")) return "Roche LightCycler 480";
    if (has("genename") && has("cq")) return "Roche LightCycler 96";
    if (has("colour") || /Rotor-?Gene/i.test(head) || has("givenconccopiesreaction")) return "Qiagen Rotor-Gene";
    if (/AriaMx|Mx3005|MxPro/i.test(head)) return "Agilent AriaMx / Mx";
    return det && det.kind === "wide" ? "Table (samples × genes)" : "Table";
  };

  var UND = /^(undetermined|undet\.?|nan|n\/?a|na|no ?ct|no ?cq|no ?amp|neg|negative|-+|>?\s*40\+?|)$/i;
  function normTask(s, qtyNum) {
    var t = String(s || "").toLowerCase();
    if (/^std|standard/.test(t)) return "standard";
    if (/ntc|no.?template|^nac|^ntp|negative|^neg/.test(t)) return "ntc";
    if (/nrt|no.?rt|^-rt|minus.?rt|^nort/.test(t)) return "nrt";
    if (/pos|positive|^opt/.test(t)) return "other";
    if (/empty|^none$/.test(t)) return "empty";
    if (!t && isFinite(qtyNum) && qtyNum > 0) return "standard";
    return "unknown";
  }
  function wellLabel(s, cols) {
    s = String(s || "").trim();
    var m = /^([A-Pa-p])\s*0*(\d{1,2})$/.exec(s);
    if (m) return m[1].toUpperCase() + (+m[2]);
    if (/^\d+$/.test(s) && cols) { var n = +s - 1; return String.fromCharCode(65 + Math.floor(n / cols)) + ((n % cols) + 1); }
    return s;
  }
  Q.wellLabel = wellLabel;

  // grid + mapping → wells. opts: {fileTarget}
  Q.extract = function (grid, det, opts) {
    opts = opts || {};
    var out = [], m = det.map, start = det.row + 1;
    if (det.kind === "wide") {
      for (var i = start; i < grid.length; i++) {
        var r = grid[i] || [], s = (r[0] || "").trim();
        if (!s) continue;
        if (/^\[.*\]$/.test(s)) break;
        det.cols.forEach(function (j) {
          var raw = (r[j] || "").trim(), v = cqNum(raw);
          if (!raw) return;
          out.push({ row: i, well: "", sample: s, target: det.header[j], cq: v > 0 ? v : null, und: !(v > 0), cqRaw: raw, task: "unknown", qty: NaN, omit: false });
        });
      }
      return out;
    }
    // QuantStudio "Well" is a number when no "Well Position" column exists
    var maxCol = 12;
    for (var a = start; a < grid.length; a++) {
      var wl = grid[a] && m.well != null ? String(grid[a][m.well] || "") : "";
      var mm = /^[A-Pa-p]0*(\d{1,2})$/.exec(wl);
      if (mm && +mm[1] > 12) maxCol = 24;
      if (/^\d+$/.test(wl) && +wl > 96) maxCol = 24;
    }
    var wellNum = m.well != null && norm(det.header[m.well]) === "well"; // tube numbers (Rotor-Gene "No.") are not plate wells
    for (i = start; i < grid.length; i++) {
      r = grid[i] || [];
      if (!r.some(function (c) { return c; })) continue;
      if (/^\[.*\]$/.test((r[0] || "").trim())) break;
      var get = function (k) { return m[k] != null ? String(r[m[k]] == null ? "" : r[m[k]]).trim() : ""; };
      var sample = get("sample"), target = get("target") || opts.fileTarget || get("fluor"), cqRaw = get("cq");
      if (!sample && !cqRaw) continue;
      if (norm(sample) === norm(det.header[m.sample])) continue; // repeated header
      var qty = num(get("qty"));
      var task = normTask(get("task"), m.task == null ? qty : NaN);
      if (m.task == null && task === "unknown") {
        if (/^(ntc|no.?template|h2o|water|blank|neg(ative)?( ?control)?)$/i.test(sample)) task = "ntc";
        else if (/^(nrt|no.?rt|-rt|minus.?rt)$/i.test(sample)) task = "nrt";
      }
      if (task === "empty") continue;
      if (!sample && task === "unknown") continue;
      var cq = cqNum(cqRaw), und = !(cq > 0);
      if (und && !UND.test(cqRaw)) { /* unreadable text: keep as not detected but mark */ }
      var om = get("omit").toLowerCase(), omit = false;
      if (m.omit != null) {
        var head = norm(det.header[m.omit]);
        omit = head === "include" ? /^(false|no|0)$/.test(om) : /^(true|yes|1|x)$/.test(om);
      }
      out.push({ row: i, well: wellLabel(get("well"), wellNum ? maxCol : 0), sample: sample, target: target, cq: und ? null : cq, und: und, cqRaw: cqRaw, task: task, qty: task === "standard" ? qty : NaN, omit: omit, group: get("group") });
    }
    return out;
  };

  // one file → {instrument, sheets:[{name, grid, det}], chosen}
  Q.readAny = function (name, buf) {
    var u = new Uint8Array(buf);
    var isZip = u[0] === 0x50 && u[1] === 0x4B;
    if (/\.json$/i.test(name) || (!isZip && /^\s*\{/.test(Q.decode(u.subarray(0, 200))))) {
      return Promise.resolve({ record: JSON.parse(Q.decode(u)) });
    }
    if (isZip) {
      return Q.unzip(buf).then(function (files) {
        var names = Object.keys(files);
        if (names.some(function (n) { return /^xl\/workbook\.xml$/.test(n); })) {
          return Q.readXlsx(files).then(function (sheets) { return pickSheet(sheets, "Excel"); });
        }
        if (/\.rdml$/i.test(name) || names.some(function (n) { return /rdml_data\.xml$/i.test(n); })) {
          return Q.readRdml(files).then(function (wells) { return { instrument: "RDML", wells: wells }; });
        }
        if (names.some(function (n) { return /\.eds$|apldbio|run\.json/i.test(n); }) || /\.eds$/i.test(name)) {
          throw new Error("This is a run file (.eds). In the instrument software, export the results as .xlsx or .txt and open that.");
        }
        throw new Error("Zip file not recognised. Open the exported results table (.csv, .txt or .xlsx).");
      });
    }
    if (u[0] === 0xD0 && u[1] === 0xCF) return Promise.reject(new Error("Old Excel .xls format — open it in Excel and save as .xlsx or .csv."));
    var text = Q.decode(u);
    if (/<rdml[\s>]/i.test(text.slice(0, 2000))) return Promise.resolve({ instrument: "RDML", wells: Q.parseRdmlXml(new DOMParser().parseFromString(text, "application/xml")) });
    return Promise.resolve(pickSheet([{ name: "", grid: Q.textGrid(text) }], ""));
  };
  function pickSheet(sheets, label) {
    var best = null;
    sheets.forEach(function (s) {
      var det = Q.detect(s.grid);
      if (!det) return;
      var sc = det.score + (det.kind === "long" ? 10 : 0) + (/result/i.test(s.name) ? 3 : 0);
      if (!best || sc > best.sc) best = { sheet: s, det: det, sc: sc };
    });
    if (!best) {
      var e = new Error("No column of Cq / Ct values was found." + (sheets.length > 1 ? " Sheets checked: " + sheets.map(function (s) { return s.name; }).join(", ") + "." : ""));
      throw e;
    }
    return { instrument: Q.instrument(best.sheet.grid, best.det), grid: best.sheet.grid, det: best.det, sheet: best.sheet.name, format: label || "text" };
  }

  // sample name → group + replicate: "Ctrl_1", "KO-2", "WT 3", "LPS rep2"
  Q.splitName = function (s) {
    var m = /^(.*?\S)[\s_\-.#]*(?:rep|bio|br|r|n|#)?[\s_\-.]*(\d{1,3})$/i.exec(String(s).trim());
    if (m && m[1] && /\D/.test(m[1])) return { group: m[1].replace(/[\s_\-.#]+$/, ""), rep: m[2] };
    return { group: String(s).trim(), rep: "" };
  };
  Q.REF_NAMES = /^(gapdh|actb|b-?actin|beta-?actin|β-?actin|b2m|18s|18s ?rrna|rn18s|rplp0|rpl13a|rpl19|rps18|hprt1?|tbp|ppia|ywhaz|gusb|sdha|ubc|hmbs|pgk1|tfrc|ef1a|eef1a1|gadph|tubb|tuba1b|alas1|rpl32|rpl37a|36b4|cyclophilin|u6|rnu6|snord\d+)$/i;
  Q.CTRL_NAMES = /^(ctrl|control|con|ctl|wt|wild ?type|veh|vehicle|mock|untreated|untr|naive|sham|scr|scramble|scrambled|nc|sinc|si-?nc|sictrl|shctrl|shnc|dmso|pbs|empty ?vector|ev|baseline|day ?0|d0|0 ?h|t0)$/i;
})();
