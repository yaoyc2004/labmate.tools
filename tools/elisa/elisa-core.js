// labmate.tools — 5.5 ELISA Standard Curve Analyzer: maths and plate-file readers.
// No page code here: everything takes plain data and returns plain data, so it can be checked on its own
// (in the browser as window.LME, in Node with require()).
(function (root) {
  "use strict";
  var E = {};
  E.ALGO = "labmate-elisa-1";
  E.ROWS = "ABCDEFGH".split("");
  E.COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

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
  function cv(a) { var m = mean(a); return a.length > 1 && m !== 0 ? 100 * sd(a) / Math.abs(m) : NaN; }
  E.mean = mean; E.sd = sd; E.cv = cv;

  function lgamma(x) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var y = x, t = x + 5.5, s = 1.000000000190015;
    t -= (x + 0.5) * Math.log(t);
    for (var j = 0; j < 6; j++) s += c[j] / ++y;
    return -t + Math.log(2.5066282746310005 * s / x);
  }
  function betacf(a, b, x) {
    var EPS = 3e-14, FPMIN = 1e-300, qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d; var h = d;
    for (var m = 1; m <= 300; m++) {
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
  function ibeta(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  // upper-tail p of the F distribution
  E.pF = function (f, d1, d2) {
    if (!(f >= 0) || !(d1 > 0) || !(d2 > 0)) return NaN;
    return ibeta(d2 / 2, d1 / 2, d2 / (d2 + d1 * f));
  };

  // ===================================================================
  // 2. The 4PL / 5PL model
  //    y = D + (A − D) / (1 + (x / C)^B)^G      (4PL: G = 1)
  //    A = response at zero concentration, D = response at infinite concentration,
  //    C = inflection (4PL: the EC50), B > 0 = slope, G > 0 = asymmetry.
  //    Sandwich assays: A < D (signal rises). Competitive: A > D (signal falls).
  // ===================================================================
  E.f = function (p, x) {
    var A = p.A, B = p.B, C = p.C, D = p.D, G = p.G == null ? 1 : p.G;
    if (!(x > 0)) return A;
    return D + (A - D) / Math.pow(1 + Math.pow(x / C, B), G);
  };
  // inverse: response → concentration. {x} inside the curve, or {x:null, side:"low"|"high"} beyond an asymptote.
  // "low" = at or past the zero-concentration end (A); "high" = at or past the saturation end (D).
  E.inv = function (p, y) {
    var A = p.A, B = p.B, C = p.C, D = p.D, G = p.G == null ? 1 : p.G;
    if (!isFinite(y)) return { x: null, side: null };
    var t = (y - D) / (A - D); // 1 at x = 0, → 0 as x → ∞
    if (t >= 1) return { x: null, side: "low" };
    if (t <= 0) return { x: null, side: "high" };
    var x = C * Math.pow(Math.pow(t, -1 / G) - 1, 1 / B);
    if (!isFinite(x)) return { x: null, side: t > 0.5 ? "low" : "high" };
    if (x <= 0) return { x: null, side: "low" };
    return { x: x, side: null };
  };
  // d(conc)/d(response) — for the precision profile
  E.dxdy = function (p, y) {
    var h = 1e-6 * Math.max(Math.abs(p.D - p.A), 1e-9);
    var a = E.inv(p, y - h), b = E.inv(p, y + h);
    if (a.x == null || b.x == null) return NaN;
    return (b.x - a.x) / (2 * h);
  };

  // theta = [A, ln B, ln C, D, ln G]
  function toP(th, five) { return { A: th[0], B: Math.exp(th[1]), C: Math.exp(th[2]), D: th[3], G: five ? Math.exp(th[4]) : 1 }; }
  // value and gradient w.r.t. theta
  function fGrad(th, x, five) {
    var A = th[0], B = Math.exp(th[1]), C = Math.exp(th[2]), D = th[3], G = five ? Math.exp(th[4]) : 1;
    if (!(x > 0)) return { y: A, g: five ? [1, 0, 0, 0, 0] : [1, 0, 0, 0] };
    var lr = Math.log(x) - th[2], u = Math.exp(B * lr), s = 1 + u, h = Math.pow(s, -G);
    var k = (A - D) * G * Math.pow(s, -G - 1) * u * B; // = −(A−D)·dh/du·u·B
    var g = [h, -k * lr, k, 1 - h];
    if (five) g.push(-(A - D) * h * Math.log(s) * G);
    return { y: D + (A - D) * h, g: g };
  }

  // Solve (M) x = v for a small symmetric positive matrix; returns null when singular.
  function solve(M, v) {
    var n = v.length, a = M.map(function (r, i) { return r.slice().concat([v[i]]); });
    for (var c = 0; c < n; c++) {
      var piv = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
      if (!(Math.abs(a[piv][c]) > 1e-300)) return null;
      var tmp = a[c]; a[c] = a[piv]; a[piv] = tmp;
      for (r = c + 1; r < n; r++) {
        var m = a[r][c] / a[c][c];
        for (var k = c; k <= n; k++) a[r][k] -= m * a[c][k];
      }
    }
    var x = new Array(n);
    for (var i = n - 1; i >= 0; i--) {
      var s = a[i][n];
      for (var j = i + 1; j < n; j++) s -= a[i][j] * x[j];
      x[i] = s / a[i][i];
    }
    return x;
  }
  function invert(M) {
    var n = M.length, out = [];
    for (var i = 0; i < n; i++) {
      var e = []; for (var j = 0; j < n; j++) e.push(i === j ? 1 : 0);
      var col = solve(M, e);
      if (!col) return null;
      out.push(col);
    }
    // out[i] is column i
    return M.map(function (_, r) { return out.map(function (c) { return c[r]; }); });
  }

  // Weighted Levenberg–Marquardt from one start. pts: [{x, y, w}]
  function lm(pts, th0, five, bounds) {
    var np = five ? 5 : 4, th = th0.slice(0, np), lambda = 1e-3, it = 0, converged = false;
    function clamp(t) {
      for (var i = 0; i < np; i++) if (bounds[i]) t[i] = Math.min(bounds[i][1], Math.max(bounds[i][0], t[i]));
      return t;
    }
    function ssr(t) {
      var s = 0;
      for (var i = 0; i < pts.length; i++) { var r = pts[i].y - fGrad(t, pts[i].x, five).y; s += pts[i].w * r * r; }
      return s;
    }
    th = clamp(th);
    var S = ssr(th);
    if (!isFinite(S)) return null;
    for (it = 0; it < 1000; it++) {
      var JtJ = [], Jtr = [];
      for (var a = 0; a < np; a++) { JtJ.push(new Array(np).fill(0)); Jtr.push(0); }
      for (var i = 0; i < pts.length; i++) {
        var fg = fGrad(th, pts[i].x, five), r = pts[i].y - fg.y, w = pts[i].w;
        for (a = 0; a < np; a++) {
          Jtr[a] += w * fg.g[a] * r;
          for (var b = 0; b <= a; b++) JtJ[a][b] += w * fg.g[a] * fg.g[b];
        }
      }
      for (a = 0; a < np; a++) for (b = a + 1; b < np; b++) JtJ[a][b] = JtJ[b][a];
      var improved = false;
      for (var tries = 0; tries < 40; tries++) {
        var M = JtJ.map(function (row, k) { var c = row.slice(); c[k] += lambda * (row[k] > 0 ? row[k] : 1e-12); return c; });
        var step = solve(M, Jtr);
        if (!step) { lambda *= 10; continue; }
        var tn = clamp(th.map(function (v, k) { return v + step[k]; }));
        var Sn = ssr(tn);
        if (isFinite(Sn) && Sn <= S) {
          var dS = S - Sn, dth = 0;
          for (var k = 0; k < np; k++) dth = Math.max(dth, Math.abs(tn[k] - th[k]) / (Math.abs(th[k]) + 1e-8));
          th = tn; S = Sn; lambda = Math.max(lambda / 10, 1e-12); improved = true;
          if (dS <= 1e-12 * (S + 1e-30) && dth < 1e-7) converged = true;
          break;
        }
        lambda *= 10;
        if (lambda > 1e16) break;
      }
      if (!improved) { converged = gradSmall(); break; }
      if (converged) break;
    }
    function gradSmall() {
      // no step lowers the sum of squares: a minimum if the gradient is ~0 relative to the curvature
      var g = 0, h = 0;
      for (var i = 0; i < pts.length; i++) {
        var fg = fGrad(th, pts[i].x, five), r = pts[i].y - fg.y;
        for (var a = 0; a < np; a++) { g += Math.abs(pts[i].w * fg.g[a] * r); h += pts[i].w * fg.g[a] * fg.g[a]; }
      }
      return g <= 1e-6 * Math.sqrt(h * (S + 1e-30)) + 1e-14;
    }
    return { th: th, ssr: S, iter: it + 1, converged: converged };
  }

  // Starting values from the data
  function starts(pts, five) {
    var lv = levels(pts), pos = lv.filter(function (l) { return l.x > 0; });
    var ys = lv.map(function (l) { return l.y; });
    var lo = lv[0].y, hi = lv[lv.length - 1].y, span = Math.abs(hi - lo) || 1e-3;
    var dir = hi >= lo ? 1 : -1;
    var A0 = lo - dir * 0.05 * span, D0 = hi + dir * 0.05 * span;
    // inflection: where the mean response crosses the middle, on log x
    var mid = (A0 + D0) / 2, lnC = Math.log(Math.sqrt(pos[0].x * pos[pos.length - 1].x));
    for (var i = 1; i < pos.length; i++) {
      var a = pos[i - 1], b = pos[i];
      if ((a.y - mid) * (b.y - mid) <= 0 && a.y !== b.y) {
        var t = (mid - a.y) / (b.y - a.y);
        lnC = Math.log(a.x) + t * (Math.log(b.x) - Math.log(a.x));
        break;
      }
    }
    // slope from the logit of the inner points
    var sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
    pos.forEach(function (l) {
      var q = (l.y - A0) / (D0 - l.y);
      if (q > 0 && isFinite(q)) { var X = Math.log(l.x), Y = Math.log(q); sx += X; sy += Y; sxx += X * X; sxy += X * Y; n++; }
    });
    var B0 = n >= 2 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : 1;
    if (!(B0 > 0.05 && B0 < 20)) B0 = 1;
    var out = [];
    [B0, 1, 0.6, 2].forEach(function (B) {
      [[A0, D0], [lo, hi], [lo - dir * 0.3 * span, hi + dir * 0.5 * span]].forEach(function (ad) {
        [0, 0.7, -0.7].forEach(function (dc) {
          out.push([ad[0], Math.log(B), lnC + dc, ad[1], 0]);
        });
      });
    });
    void ys; void five;
    return out;
  }
  function levels(pts) {
    var m = {};
    pts.forEach(function (p) { (m[p.x] = m[p.x] || []).push(p.y); });
    return Object.keys(m).map(Number).sort(function (a, b) { return a - b; }).map(function (x) { return { x: x, y: mean(m[x]), n: m[x].length }; });
  }

  // weights: w = 1 / max(|mean response of the standard level|, 1% of the span)^k   (k = 0, 1 or 2)
  E.weights = function (pts, kind) {
    var k = kind === "1/y2" ? 2 : kind === "1/y" ? 1 : 0;
    if (!k) return pts.map(function () { return 1; });
    var lv = levels(pts), ys = lv.map(function (l) { return l.y; });
    var span = Math.max.apply(null, ys) - Math.min.apply(null, ys), floor = Math.max(0.01 * span, 1e-6);
    var byX = {};
    lv.forEach(function (l) { byX[l.x] = 1 / Math.pow(Math.max(Math.abs(l.y), floor), k); });
    return pts.map(function (p) { return byX[p.x]; });
  };

  // Fit one model. pts: [{x, y}] (x ≥ 0, every replicate well), opts: {five, weight}
  E.fit = function (pts, opts) {
    opts = opts || {};
    var five = !!opts.five, np = five ? 5 : 4;
    pts = pts.filter(function (p) { return isFinite(p.x) && p.x >= 0 && isFinite(p.y); });
    var lv = levels(pts), pos = lv.filter(function (l) { return l.x > 0; });
    if (pos.length < 3 || lv.length < np) return { ok: false, five: five, why: "few", nLevels: lv.length };
    var ws = E.weights(pts, opts.weight);
    var P = pts.map(function (p, i) { return { x: p.x, y: p.y, w: ws[i] }; });
    // normalise the weights so Sy.x stays in response units for unweighted fits and comparable otherwise
    var wm = mean(P.map(function (p) { return p.w; }));
    P.forEach(function (p) { p.w /= wm; });
    var xmin = pos[0].x, xmax = pos[pos.length - 1].x;
    var ys = lv.map(function (l) { return l.y; }), span = Math.max.apply(null, ys) - Math.min.apply(null, ys) || 1;
    var bounds = [
      [Math.min.apply(null, ys) - 10 * span, Math.max.apply(null, ys) + 10 * span],
      [Math.log(0.05), Math.log(20)],
      [Math.log(xmin) - Math.log(1e4), Math.log(xmax) + Math.log(1e4)],
      [Math.min.apply(null, ys) - 10 * span, Math.max.apply(null, ys) + 10 * span],
      [Math.log(0.02), Math.log(50)]
    ];
    var list = opts.from ? [opts.from] : [];
    if (five && opts.from4) {
      [0, Math.log(0.5), Math.log(2), Math.log(0.25), Math.log(4)].forEach(function (lg) {
        var t = opts.from4.slice(0, 4); t.push(lg); list.push(t);
      });
    }
    starts(P, five).forEach(function (s) { list.push(s); });
    var best = null, nConv = 0, sols = [];
    list.forEach(function (s) {
      var r = lm(P, s, five, bounds);
      if (!r) return;
      if (r.converged) { nConv++; sols.push(r); }
      if (!best || (r.converged && !best.converged) || (r.converged === best.converged && r.ssr < best.ssr - 1e-15)) best = r;
    });
    if (!best) return { ok: false, five: five, why: "nofit" };
    var th = best.th, p = toP(th, five);
    // agreement between starts: how many converged runs reached the same minimum (within 0.1%)
    var same = sols.filter(function (r) { return Math.abs(r.ssr - best.ssr) <= 1e-3 * best.ssr + 1e-14; }).length;
    // statistics
    var n = P.length, df = n - np, J = [], res = [];
    var JtJ = []; for (var a = 0; a < np; a++) JtJ.push(new Array(np).fill(0));
    P.forEach(function (q) {
      var fg = fGrad(th, q.x, five);
      res.push(q.y - fg.y);
      for (var a = 0; a < np; a++) for (var b = 0; b < np; b++) JtJ[a][b] += q.w * fg.g[a] * fg.g[b];
      J.push(fg.g);
    });
    var s2 = df > 0 ? best.ssr / df : NaN;
    var cov = invert(JtJ), se = null, corrMax = NaN;
    if (cov && df > 0) {
      se = cov.map(function (r, i) { return Math.sqrt(Math.max(0, r[i] * s2)); });
      corrMax = 0;
      for (var i = 0; i < np; i++) for (var j = 0; j < i; j++) {
        var c = cov[i][j] / Math.sqrt(cov[i][i] * cov[j][j]);
        if (isFinite(c)) corrMax = Math.max(corrMax, Math.abs(c));
      }
    }
    // standard errors in the reported parametrisation (delta method for the logged ones)
    var seP = se ? { A: se[0], B: se[1] * p.B, C: se[2] * p.C, D: se[3], G: five ? se[4] * p.G : 0 } : null;
    // weighted R²
    var wsum = 0, wy = 0; P.forEach(function (q) { wsum += q.w; wy += q.w * q.y; });
    var ybar = wy / wsum, sst = 0; P.forEach(function (q) { sst += q.w * (q.y - ybar) * (q.y - ybar); });
    var r2 = sst > 0 ? 1 - best.ssr / sst : NaN;
    var aicc = n * Math.log(best.ssr / n) + 2 * (np + 1) + (2 * (np + 1) * (np + 2)) / Math.max(1, n - np - 2);
    var atBound = [];
    var names = ["A", "B", "C", "D", "G"];
    for (i = 0; i < np; i++) if (Math.abs(th[i] - bounds[i][0]) < 1e-9 || Math.abs(th[i] - bounds[i][1]) < 1e-9) atBound.push(names[i]);
    var out = {
      ok: true, five: five, p: p, th: th, se: seP, ssr: best.ssr, df: df, n: n, s2: s2, syx: Math.sqrt(s2), r2: r2, aicc: aicc,
      converged: best.converged, iter: best.iter, starts: list.length, nConverged: nConv, sameMin: same,
      corrMax: corrMax, atBound: atBound, weight: opts.weight || "none", xmin: xmin, xmax: xmax, cov: cov
    };
    out.checks = E.checkFit(out);
    return out;
  };

  // Validation of a fit: returns [{code, bad}] — bad = do not trust this model
  E.checkFit = function (f) {
    var c = [];
    if (!f.converged) c.push({ code: "noconv", bad: true });
    if (f.atBound.length) c.push({ code: "bound", bad: true, what: f.atBound.join(", ") });
    if (!f.se) c.push({ code: "singular", bad: true });
    if (f.se && f.five && f.p.G > 0 && f.se.G / f.p.G > 1) c.push({ code: "gwide", bad: true });
    if (f.se && f.se.C / f.p.C > 1) c.push({ code: "cwide", bad: !f.five ? false : true });
    if (f.p.C < f.xmin / 10 || f.p.C > f.xmax * 10) c.push({ code: "coutside", bad: false });
    if (f.corrMax > 0.9999) c.push({ code: "corr", bad: !!f.five });
    if (f.sameMin < 2 && f.nConverged >= 2) c.push({ code: "starts", bad: !!f.five });
    if (f.df < 2) c.push({ code: "df", bad: !!f.five });
    return c;
  };
  E.trusted = function (f) { return f && f.ok && !f.checks.some(function (c) { return c.bad; }); };

  // Fit 4PL and 5PL and pick one. choice: "4pl" | "5pl" | "auto"
  E.fitBoth = function (pts, choice, weight) {
    var f4 = E.fit(pts, { five: false, weight: weight });
    var f5 = f4.ok ? E.fit(pts, { five: true, weight: weight, from4: f4.th }) : E.fit(pts, { five: true, weight: weight });
    var test = null;
    if (f4.ok && f5.ok && f5.df > 0) {
      var F = Math.max(0, (f4.ssr - f5.ssr) / (f4.df - f5.df)) / (f5.ssr / f5.df);
      test = { F: F, d1: f4.df - f5.df, d2: f5.df, p: E.pF(F, f4.df - f5.df, f5.df) };
    }
    var pick = null, why = "";
    if (choice === "5pl") { pick = f5.ok ? f5 : f4; why = f5.ok ? (E.trusted(f5) ? "chosen" : "chosen-untrusted") : "5pl-failed"; }
    else if (choice === "4pl") { pick = f4; why = "chosen"; }
    else {
      if (f5.ok && E.trusted(f5) && test && test.p < 0.05) { pick = f5; why = "ftest5"; }
      else if (f5.ok && !E.trusted(f5)) { pick = f4; why = "5pl-untrusted"; }
      else { pick = f4; why = "ftest4"; }
    }
    if (!pick || !pick.ok) return { ok: false, f4: f4, f5: f5, test: test };
    return { ok: true, fit: pick, f4: f4, f5: f5, test: test, why: why };
  };

  // ===================================================================
  // 3. The whole analysis
  //   plate: {od: 8×12 numbers|null, sat: 8×12 booleans, ref: 8×12|null}
  //   wells: {"A1": {t: "std"|"smp"|"ctl"|"blk", id}}, groups: {id: {t, name, conc, dil}}
  //   set: {model, weight, blank: "none"|"blk"|"zero", zeroFit, cvMax, range: "recovery"|"standards", format: "auto"|"sandwich"|"competitive", excluded: {well:1}}
  // ===================================================================
  E.wellName = function (r, c) { return E.ROWS[r] + (c + 1); };
  E.parseWell = function (w) {
    var m = /^([A-Ha-h])\s*0?(\d{1,2})$/.exec(String(w).trim());
    if (!m) return null;
    var c = +m[2]; if (c < 1 || c > 12) return null;
    return { r: m[1].toUpperCase().charCodeAt(0) - 65, c: c - 1 };
  };
  E.NICE = (function () {
    var out = [], base = [1, 2, 2.5, 4, 5];
    for (var e = 0; e <= 6; e++) base.forEach(function (b) { out.push(b * Math.pow(10, e)); });
    return out;
  })();
  E.niceUp = function (v) { for (var i = 0; i < E.NICE.length; i++) if (E.NICE[i] >= v * (1 - 1e-9)) return E.NICE[i]; return E.NICE[E.NICE.length - 1]; };
  E.niceDown = function (v) { var o = 1; for (var i = 0; i < E.NICE.length; i++) if (E.NICE[i] <= v * (1 + 1e-9)) o = E.NICE[i]; return o; };

  E.analyse = function (plate, wells, groups, set) {
    set = set || {};
    var ex = set.excluded || {};
    var cvMax = isFinite(+set.cvMax) && +set.cvMax > 0 ? +set.cvMax : 15;
    var out = { warnings: [], wells: {}, std: [], smp: [], ctl: [], blank: null, zero: null };
    // raw value per well (signal − reference)
    var raw = {};
    E.ROWS.forEach(function (R, r) {
      E.COLS.forEach(function (C, c) {
        var w = R + C, v = plate.od && plate.od[r] ? plate.od[r][c] : null;
        var sat = !!(plate.sat && plate.sat[r] && plate.sat[r][c]);
        if (v != null && plate.ref && plate.ref[r] && plate.ref[r][c] != null) v = v - plate.ref[r][c];
        raw[w] = { v: v == null || !isFinite(v) ? null : v, sat: sat };
      });
    });
    function live(w) { return wells[w] && !ex[w] && raw[w].v != null && !raw[w].sat; }
    function wellsOf(id) { return Object.keys(wells).filter(function (w) { return wells[w].id === id; }).sort(wellOrder); }
    // blank / zero standard
    var blankW = Object.keys(wells).filter(function (w) { return wells[w].t === "blk" && live(w); });
    var stdIds = Object.keys(groups).filter(function (g) { return groups[g].t === "std"; });
    var zeroIds = stdIds.filter(function (g) { return +groups[g].conc === 0 && String(groups[g].conc).trim() !== ""; });
    var zeroW = []; zeroIds.forEach(function (g) { wellsOf(g).forEach(function (w) { if (live(w)) zeroW.push(w); }); });
    var sub = 0, subWhat = "none";
    if (set.blank === "blk" && blankW.length) { sub = mean(blankW.map(function (w) { return raw[w].v; })); subWhat = "blk"; }
    else if (set.blank === "zero" && zeroW.length) { sub = mean(zeroW.map(function (w) { return raw[w].v; })); subWhat = "zero"; }
    else if (set.blank === "blk" || set.blank === "zero") out.warnings.push({ code: "noblank", what: set.blank });
    out.subtract = { what: subWhat, value: sub };
    Object.keys(raw).forEach(function (w) { out.wells[w] = { raw: raw[w].v, sat: raw[w].sat, v: raw[w].v == null ? null : raw[w].v - sub, ex: !!ex[w] }; });
    var V = function (w) { return out.wells[w].v; };
    if (blankW.length) out.blank = { wells: blankW, mean: mean(blankW.map(function (w) { return raw[w].v; })), sd: sd(blankW.map(function (w) { return raw[w].v; })) };

    // standards → points
    var pts = [], stdLv = [];
    stdIds.forEach(function (g) {
      var conc = parseFloat(groups[g].conc);
      var ws = wellsOf(g), lw = ws.filter(live);
      if (!ws.length) return;
      var row = { id: g, name: groups[g].name || g, conc: isFinite(conc) ? conc : null, wells: ws, live: lw, sat: ws.filter(function (w) { return raw[w].sat && !ex[w]; }) };
      row.ys = lw.map(V); row.mean = mean(row.ys); row.sd = sd(row.ys); row.cv = cv(row.ys);
      row.isZero = row.conc === 0;
      row.inFit = row.conc != null && lw.length > 0 && (row.conc > 0 || set.zeroFit !== false);
      if (row.inFit) lw.forEach(function (w) { pts.push({ x: row.conc, y: V(w), w: w }); });
      stdLv.push(row);
    });
    stdLv.sort(function (a, b) { return (b.conc == null ? -1 : b.conc) - (a.conc == null ? -1 : a.conc); });
    out.std = stdLv;
    out.nStdLevels = stdLv.filter(function (s) { return s.inFit; }).length;
    if (stdLv.some(function (s) { return s.conc == null && s.wells.length; })) out.warnings.push({ code: "noconc" });
    if (stdLv.some(function (s) { return s.sat.length; })) out.warnings.push({ code: "stdsat" });

    var fb = E.fitBoth(pts, set.model || "auto", set.weight || "1/y2");
    out.fitAll = fb;
    if (!fb.ok) { out.ok = false; out.why = fb.f4 && fb.f4.why === "few" ? "few" : "nofit"; return out; }
    var fit = fb.fit, p = fit.p;
    out.ok = true; out.fit = fit; out.p = p;
    out.dir = p.D > p.A ? "up" : "down";
    var fmt = set.format === "sandwich" || set.format === "competitive" ? set.format : (out.dir === "up" ? "sandwich" : "competitive");
    out.format = fmt;
    if ((fmt === "sandwich" && out.dir === "down") || (fmt === "competitive" && out.dir === "up")) out.warnings.push({ code: "dir", format: fmt });

    // back-calculated standards
    stdLv.forEach(function (s) {
      s.back = s.live.map(function (w) { return E.inv(p, V(w)); });
      var xs = s.back.filter(function (b) { return b.x != null; }).map(function (b) { return b.x; });
      s.backMean = s.conc > 0 && isFinite(s.mean) ? E.inv(p, s.mean).x : null;
      s.backCv = xs.length > 1 ? cv(xs) : NaN;
      s.rec = s.backMean != null && s.conc > 0 ? 100 * s.backMean / s.conc : null;
      s.resid = s.live.map(function (w) { return V(w) - E.f(p, s.conc); });
    });

    // quantification range from recovery (FDA/ICH M10 ligand-binding: ±20%, ±25% at the ends; CV ≤ 20%, ≤ 25% at the ends)
    var lv = stdLv.filter(function (s) { return s.conc > 0 && s.inFit; }).sort(function (a, b) { return a.conc - b.conc; });
    lv.forEach(function (s) {
      var rc = s.rec, c = isFinite(s.backCv) ? s.backCv : 0;
      s.passIn = rc != null && rc >= 80 && rc <= 120 && c <= 20;
      s.passEdge = rc != null && rc >= 75 && rc <= 125 && c <= 25;
    });
    var lloq = null, uloq = null;
    if (set.range === "standards") {
      if (lv.length) { lloq = lv[0]; uloq = lv[lv.length - 1]; }
    } else {
      var bestRun = null, i = 0;
      while (i < lv.length) {
        if (!lv[i].passIn) { i++; continue; }
        var j = i; while (j + 1 < lv.length && lv[j + 1].passIn) j++;
        if (!bestRun || j - i > bestRun[1] - bestRun[0]) bestRun = [i, j];
        i = j + 1;
      }
      if (bestRun) {
        var a = bestRun[0], b = bestRun[1];
        if (a > 0 && lv[a - 1].passEdge) a--;
        if (b < lv.length - 1 && lv[b + 1].passEdge) b++;
        lloq = lv[a]; uloq = lv[b];
      } else {
        var edges = lv.filter(function (s) { return s.passEdge; });
        if (edges.length) { lloq = edges[0]; uloq = edges[edges.length - 1]; }
      }
    }
    lv.forEach(function (s) { s.inRange = !!(lloq && s.conc >= lloq.conc && s.conc <= uloq.conc); });
    out.lloq = lloq ? lloq.conc : null; out.uloq = uloq ? uloq.conc : null;
    if (!lloq) out.warnings.push({ code: "norange" });
    else if (lloq === uloq) out.warnings.push({ code: "onelevel" });
    out.topStd = lv.length ? lv[lv.length - 1].conc : null;
    out.lowStd = lv.length ? lv[0].conc : null;
    var mid = out.lloq && out.uloq ? Math.sqrt(out.lloq * out.uloq) : null;
    out.mid = mid;

    // LOD from the zero standard (or blanks): mean ± 3 SD
    var zsrc = zeroW.length >= 2 ? zeroW : blankW.length >= 2 ? blankW : null;
    if (zsrc) {
      var zv = zsrc.map(V), zm = mean(zv), zs = sd(zv);
      var yl = out.dir === "up" ? zm + 3 * zs : zm - 3 * zs;
      var li = E.inv(p, yl);
      out.lod = { from: zsrc === zeroW ? "zero" : "blk", n: zv.length, mean: zm, sd: zs, y: yl, x: li.x };
    }
    // %B/B0 reference
    var b0 = zeroW.length ? mean(zeroW.map(V)) : null;
    out.b0 = b0;

    // samples and controls
    function doGroup(g) {
      var G = groups[g], ws = wellsOf(g), lw = ws.filter(live);
      var dil = parseFloat(G.dil); if (!(dil > 0)) dil = 1;
      var o = { id: g, t: G.t, name: G.name || g, wells: ws, live: lw, dil: dil, flags: [] };
      o.sat = ws.filter(function (w) { return raw[w].sat && !ex[w]; });
      o.ys = lw.map(V); o.mean = mean(o.ys); o.sd = sd(o.ys); o.cv = cv(o.ys);
      o.per = lw.map(function (w) { return E.inv(p, V(w)); });
      var xs = o.per.filter(function (b) { return b.x != null; }).map(function (b) { return b.x; });
      o.concCv = xs.length > 1 && xs.length === o.per.length ? cv(xs) : NaN;
      if (fmt === "competitive" && b0) o.bb0 = 100 * o.mean / b0;
      if (!ws.length) return null;
      if (!lw.length) {
        if (o.sat.length) { o.status = "above"; o.flags.push("sat"); }
        else { o.status = "nodata"; }
      } else {
        var inv = E.inv(p, o.mean);
        o.well = inv.x;
        if (o.sat.length) o.flags.push("sat");
        if (inv.x == null) o.status = inv.side === "high" ? "above" : "below";
        else if (out.uloq != null && inv.x > out.uloq * (1 + 1e-9)) o.status = "high";
        else if (out.lloq != null && inv.x < out.lloq * (1 - 1e-9)) o.status = "low";
        else if (out.lloq == null) o.status = "norange";
        else o.status = "ok";
        if (o.sat.length && o.status !== "above") o.status = "above"; // a saturated replicate means the true value is unknown
        if (o.well != null) o.final = o.well * dil;
        if (isFinite(o.cv) && o.cv > cvMax) o.flags.push("cv");
        if (o.ys.length === 1) o.flags.push("single");
        if (out.lod && out.lod.x != null && o.well != null && o.well < out.lod.x) o.flags.push("lod");
      }
      // what to do next
      o.advice = E.advice(o, out);
      if (G.t === "ctl") {
        var exp = parseFloat(G.conc);
        o.expected = isFinite(exp) && exp > 0 ? exp : null;
        if (o.expected != null && o.final != null) {
          o.rec = 100 * o.final / o.expected;
          var lo = isFinite(+set.recLo) ? +set.recLo : 80, hi = isFinite(+set.recHi) ? +set.recHi : 120;
          if (o.rec < lo || o.rec > hi) o.flags.push("rec");
        }
      }
      return o;
    }
    Object.keys(groups).sort(idOrder).forEach(function (g) {
      var t = groups[g].t;
      if (t !== "smp" && t !== "ctl") return;
      var o = doGroup(g);
      if (o) (t === "smp" ? out.smp : out.ctl).push(o);
    });
    out.cvMax = cvMax;
    out.nFlag = out.smp.concat(out.ctl).filter(function (o) { return o.status !== "ok" || o.flags.length; }).length;
    return out;
  };

  // advice for one sample: {kind: "dilute"|"less"|"repeat"|"none", fold, newDil, atLeast}
  E.advice = function (o, a) {
    if (a.lloq == null || a.uloq == null) return null;
    var width = a.uloq / a.lloq, mid = a.mid;
    if (o.status === "high" && o.well != null) {
      var n = E.niceUp(o.well / mid);
      if (n < 2) n = 2;
      return { kind: "dilute", fold: n, newDil: o.dil * n };
    }
    if (o.status === "above") {
      var m = E.niceUp(Math.max(width, 4));
      return { kind: "dilute", fold: m, newDil: o.dil * m, atLeast: true };
    }
    if (o.status === "low" || o.status === "below") {
      if (o.dil <= 1) return { kind: "none" };
      var want = o.well != null && o.well > 0 ? mid / o.well : width;
      var nd = o.dil / want;
      nd = nd <= 1 ? 1 : E.niceDown(nd);
      if (nd >= o.dil) nd = o.dil / 2 >= 1 ? E.niceDown(o.dil / 2) : 1;
      return { kind: "less", newDil: nd, fold: o.dil / nd };
    }
    if (o.flags && o.flags.indexOf("cv") >= 0) return { kind: "repeat" };
    return null;
  };

  function wellOrder(a, b) {
    var A = E.parseWell(a), B = E.parseWell(b);
    return A.r - B.r || A.c - B.c;
  }
  function idOrder(a, b) {
    var ma = /^(\D*)(\d*)$/.exec(a), mb = /^(\D*)(\d*)$/.exec(b);
    if (ma && mb && ma[1] === mb[1]) return (+ma[2] || 0) - (+mb[2] || 0);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  E.idOrder = idOrder; E.wellOrder = wellOrder;

  // ===================================================================
  // 4. Reading plate-reader exports
  // ===================================================================
  E.decode = function (bytes) {
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
  E.textGrid = function (text) {
    var lines = String(text).replace(/^﻿/, "").split(/\r\n|\r|\n/);
    var sample = lines.filter(function (l) { return l.trim(); }).slice(0, 200);
    var count = function (ch) { return sample.reduce(function (a, l) { return a + (l.split(ch).length - 1); }, 0); };
    var tabs = count("\t"), commas = count(","), semis = count(";");
    var d;
    if (tabs > 0 && tabs >= commas && tabs >= semis) d = "\t";
    else if (semis > 0 && semis >= commas * 0.5) d = ";";
    else if (commas > 0) d = ",";
    else d = null; // whitespace-separated (pasted from some viewers)
    return lines.map(function (l) {
      var cells = d ? splitLine(l, d) : l.trim().split(/\s+/);
      return cells.map(function (c) { return c.trim(); });
    });
  };

  function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("zip"));
    var ds = new DecompressionStream("deflate-raw");
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  E.unzip = function (buf) {
    var u = new Uint8Array(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength), eocd = -1;
    for (var i = u.length - 22; i >= Math.max(0, u.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return Promise.reject(new Error("badzip"));
    var n = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true), files = {};
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
          return Promise.reject(new Error("badzip"));
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
  E.readXlsx = function (files) {
    var get = function (p) { return files[p] ? files[p]() : Promise.resolve(null); };
    return Promise.all([get("xl/workbook.xml"), get("xl/_rels/workbook.xml.rels"), get("xl/sharedStrings.xml")]).then(function (r) {
      if (!r[0]) throw new Error("nosheet");
      var wb = xmlDoc(r[0]), rels = r[1] ? xmlDoc(r[1]) : null, ss = [];
      if (r[2]) kids(xmlDoc(r[2]).documentElement, "si").forEach(function (si) {
        var t = si.getElementsByTagNameNS("*", "t"), s = "";
        for (var i = 0; i < t.length; i++) if (t[i].parentNode.localName !== "rPh") s += t[i].textContent;
        ss.push(s);
      });
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
          var doc = xmlDoc(b), grid = [], rows = doc.getElementsByTagNameNS("*", "row");
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
      })).then(function (l) { return l.filter(Boolean); });
    });
  };

  // a cell → number, or {sat:true} for overflow markers, or null
  var SAT = /^(ovrflw|overflow|over|ovfl|sat|saturated|range\?|\*+|>\s*[\d.]+|\+?inf(inity)?|high|out of range|oor\s*>|e\+?)$/i;
  E.cellVal = function (s) {
    s = String(s == null ? "" : s).trim();
    if (!s) return null;
    if (SAT.test(s) || /^#+$/.test(s) || /^\?{3,}$/.test(s)) return { sat: true };
    var t = s.replace(/\s/g, "");
    if (/^-?\d+,\d+$/.test(t)) t = t.replace(",", ".");
    if (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return parseFloat(t);
    return null;
  };
  function isNumCell(s) { var v = E.cellVal(s); return typeof v === "number"; }
  function isValCell(s) { var v = E.cellVal(s); return typeof v === "number" || (v && v.sat); }

  // Find every 8×12 plate in a grid. Returns [{label, od, sat, kind, at}]
  E.findPlates = function (grid) {
    var found = [], used = {};
    function rowText(r) { return (grid[r] || []).join(" ").trim(); }
    function labelNear(r, c, kind) {
      var bits = [];
      // same row, before the "1" header or as the corner cell
      for (var k = 0; k < c; k++) { var s = (grid[r] || [])[k]; if (s && !/^<>$/.test(s) && !/^\d+$/.test(s)) bits.push(s); }
      // up to 4 rows above
      for (var u = r - 1; u >= Math.max(0, r - 4); u--) {
        var t = rowText(u);
        if (!t) { if (bits.length) break; continue; }
        if (used[u]) break;
        bits.unshift(t);
        if (/\b\d{3}\s*nm\b|read\s*\d|wavelength|raw data|abs|od|\b[3-9]\d{2}\b/i.test(t)) break;
      }
      return bits.join(" · ").replace(/\s+/g, " ").slice(0, 120);
    }
    // Gen5 writes the read name ("450", "Read 1:450") after the 12th column of every row
    function trailingLabel(rows, c) {
      var labs = {}, n = 0;
      rows.forEach(function (r) { var s = String((grid[r] || [])[c + 12] || "").trim(); if (s) { labs[s] = 1; n++; } });
      var k = Object.keys(labs);
      if (k.length !== 1 || n < rows.length) return "";
      return !isValCell(k[0]) || /^[3-9]\d{2}$/.test(k[0]) ? k[0] : "";
    }
    for (var r = 0; r < grid.length; r++) {
      var row = grid[r] || [];
      for (var c = 0; c + 11 < row.length; c++) {
        var ok = true;
        for (var k = 0; k < 12; k++) if (!(+row[c + k] === k + 1 && /^0?\d{1,2}$/.test(row[c + k]))) { ok = false; break; }
        if (!ok) continue;
        if (+row[c + 12] === 13) continue; // a 384-well header
        // rows A..H with letters in column c−1; unlabelled value rows right under a letter are extra reads (Gen5 puts 450 and 630 on alternate lines)
        var hasVals = function (q) { for (var k3 = 0; k3 < 12; k3++) if (isValCell((grid[q] || [])[c + k3])) return true; return false; };
        var sets = [], rr = r + 1, L = 0;
        if (c > 0) {
          for (; rr < grid.length; rr++) {
            var lab = String((grid[rr] || [])[c - 1] || "").trim().toUpperCase();
            if (L < 8 && lab === E.ROWS[L]) { sets.push([rr]); L++; }
            else if (lab === "" && sets.length && hasVals(rr)) sets[sets.length - 1].push(rr);
            else if (lab === "" && !hasVals(rr) && (L === 0 ? rr - r < 3 : L < 8)) continue;
            else break;
          }
        }
        var reads = [];
        if (sets.length === 8 && sets.every(function (s) { return s.length === sets[0].length; })) {
          for (var j = 0; j < sets[0].length; j++) reads.push(sets.map(function (s) { return s[j]; }));
        } else {
          // no row letters (SoftMax Pro plate format): the next 8 rows with values under the header
          var rowsAt = []; rr = r + 1;
          for (; rowsAt.length < 8 && rr < grid.length && rr <= r + 9; rr++) {
            if (hasVals(rr)) rowsAt.push(rr); else if (rowsAt.length) break;
          }
          if (rowsAt.length !== 8) continue;
          reads.push(rowsAt);
        }
        reads.forEach(function (rowsAt) { addBlock(r, c, rowsAt); });
        c += 11;
      }
    }
    function addBlock(r, c, rowsAt) {
        var od = [], sat = [], nv = 0;
        rowsAt.forEach(function (rr2) {
          var o = [], s = [];
          for (var k2 = 0; k2 < 12; k2++) {
            var v = E.cellVal((grid[rr2] || [])[c + k2]);
            if (typeof v === "number") { o.push(v); s.push(false); nv++; }
            else if (v && v.sat) { o.push(null); s.push(true); nv++; }
            else { o.push(null); s.push(false); }
          }
          od.push(o); sat.push(s);
        });
        if (!nv) return;
        var tl = trailingLabel(rowsAt, c);
        found.push({ label: tl || labelNear(r, c), od: od, sat: sat, kind: "matrix", at: r, col: c, n: nv });
        rowsAt.forEach(function (x) { used[x] = 1; });
    }
    // SoftMax Pro: several wavelengths side by side under one "Plate:" line listing them ("450 570")
    var byRow = {};
    found.forEach(function (f) { (byRow[f.at] = byRow[f.at] || []).push(f); });
    Object.keys(byRow).forEach(function (k) {
      var fs = byRow[k]; if (fs.length < 2) return;
      for (var u = +k - 1; u >= Math.max(0, +k - 3); u--) {
        var cell = (grid[u] || []).filter(function (s) { return /^\d{3}(\s+\d{3})+$/.test(String(s).trim()); })[0];
        if (cell) {
          var wl = String(cell).trim().split(/\s+/);
          if (wl.length === fs.length) fs.forEach(function (f, i) { f.label = wl[i] + " nm"; });
          break;
        }
      }
    });
    // bare 8 × 12 numbers (pasted values only)
    if (!found.length) {
      for (r = 0; r + 7 < grid.length; r++) {
        var rowsN = [];
        for (var q = r; q < grid.length && rowsN.length < 8; q++) {
          var vals = (grid[q] || []).filter(function (s) { return s !== ""; });
          if (vals.length >= 12 && vals.slice(-12).every(isValCell)) rowsN.push(vals.slice(-12));
          else break;
        }
        if (rowsN.length === 8) {
          var od2 = [], sat2 = [];
          rowsN.forEach(function (v) {
            od2.push(v.map(function (s) { var x = E.cellVal(s); return typeof x === "number" ? x : null; }));
            sat2.push(v.map(function (s) { var x = E.cellVal(s); return !!(x && x.sat); }));
          });
          found.push({ label: "", od: od2, sat: sat2, kind: "bare", at: r, n: 96 });
          break;
        }
      }
    }
    // list format: a well column (A1 / A01) or row-letter + column-number columns, then value columns
    var lists = E.findList(grid);
    lists.forEach(function (l) { found.push(l); });
    return found;
  };

  E.findList = function (grid) {
    var out = [];
    // find header row + well column
    var best = null;
    for (var c = 0; c < 40; c++) {
      var hits = 0, first = -1;
      for (var r = 0; r < grid.length; r++) {
        if (E.parseWell((grid[r] || [])[c] || "")) { hits++; if (first < 0) first = r; }
      }
      if (hits >= 8 && (!best || hits > best.hits)) best = { c: c, hits: hits, first: first, split: false };
    }
    // BMG-style "Well Row" + "Well Col"
    if (!best) {
      for (c = 0; c < 39; c++) {
        var h2 = 0, f2 = -1;
        for (r = 0; r < grid.length; r++) {
          var a = String((grid[r] || [])[c] || "").trim(), b = String((grid[r] || [])[c + 1] || "").trim();
          if (/^[A-Ha-h]$/.test(a) && /^0?([1-9]|1[0-2])$/.test(b)) { h2++; if (f2 < 0) f2 = r; }
        }
        if (h2 >= 8 && (!best || h2 > best.hits)) best = { c: c, hits: h2, first: f2, split: true };
      }
    }
    if (!best) return out;
    var hdr = best.first - 1 >= 0 ? (grid[best.first - 1] || []) : [];
    var width = 0;
    for (r = best.first; r < grid.length; r++) width = Math.max(width, (grid[r] || []).length);
    var wc = best.split ? best.c + 2 : best.c + 1;
    for (c = 0; c < width; c++) {
      if (c === best.c || (best.split && c === best.c + 1)) continue;
      var od = E.ROWS.map(function () { return new Array(12).fill(null); });
      var sat = E.ROWS.map(function () { return new Array(12).fill(false); });
      var nNum = 0, nInt = 0, seen = 0, nonInt = false;
      for (r = best.first; r < grid.length; r++) {
        var row = grid[r] || [], pw;
        if (best.split) pw = E.parseWell(String(row[best.c] || "") + String(row[best.c + 1] || ""));
        else pw = E.parseWell(row[best.c] || "");
        if (!pw) continue;
        seen++;
        var v = E.cellVal(row[c]);
        if (typeof v === "number") { od[pw.r][pw.c] = v; nNum++; if (Math.round(v) === v) nInt++; else nonInt = true; }
        else if (v && v.sat) { sat[pw.r][pw.c] = true; nNum++; nonInt = true; }
      }
      if (nNum < Math.max(8, 0.5 * seen)) continue;
      var head = String(hdr[c] || "").trim();
      // skip index-like integer columns (plate number, repeat, column number) unless the header says it's a reading
      var isRead = /abs|od|raw|result|value|signal|mean|\d{3}|nm|lum|fluor|rfu|count|meas/i.test(head);
      if (!nonInt && !isRead) continue;
      if (/^(plate|repeat|row|col|column|index|no\.?|#|well ?col|well ?row|time|temp)/i.test(head) && !isRead) continue;
      out.push({ label: head || ("column " + (c + 1)), od: od, sat: sat, kind: "list", at: best.first, n: nNum, col: c });
      void nInt; void wc;
    }
    return out;
  };

  // Which instrument wrote this?
  E.instrument = function (grid, sheetNames) {
    var head = grid.slice(0, 80).map(function (r) { return (r || []).join(" "); }).join("\n") + "\n" + (sheetNames || []).join(" ");
    var all = grid.map(function (r) { return (r || []).join(" "); }).join("\n");
    var t = head + "\n" + all.slice(0, 20000);
    if (/Gen5|BioTek|Synergy|Epoch|ELx808|ELx800|Cytation|Agilent BioTek/i.test(t)) return "BioTek Gen5";
    if (/##BLOCKS|SoftMax|SpectraMax|PlateFormat|Plate:\s|Temperature\(.?C\)/i.test(t)) return "Molecular Devices SoftMax Pro";
    if (/Magellan|i-?control|Tecan|Infinite|Sunrise|Spark|Wavelength:.*nm[\s\S]*<>/i.test(t) || /(^|\t|,)<>(\t|,|$)/m.test(t)) return "Tecan (i-control / Magellan / SparkControl)";
    if (/MARS|BMG|CLARIOstar|FLUOstar|POLARstar|SPECTROstar|PHERAstar|Omega|Raw Data \(/i.test(t)) return "BMG LABTECH (MARS)";
    if (/SkanIt|Multiskan|Varioskan|Fluoroskan|Thermo/i.test(t)) return "Thermo Scientific SkanIt";
    if (/EnVision|VICTOR|EnSpire|Wallac|PerkinElmer|Revvity/i.test(t)) return "PerkinElmer / Revvity (EnVision, VICTOR)";
    if (/iMark|Microplate Manager|Bio-?Rad|xMark/i.test(t)) return "Bio-Rad (iMark / Microplate Manager)";
    if (/Biochrom|Asys|UVM/i.test(t)) return "Biochrom";
    if (/BioTek|Molecular Devices|FilterMax|Paradigm/i.test(t)) return "Molecular Devices";
    if (/Hidex/i.test(t)) return "Hidex";
    if (/Rayto|RT-?\d{4}/i.test(t)) return "Rayto";
    if (/DNM-?9602|Perlong|普朗/i.test(t)) return "Perlong DNM-9602";
    if (/Kehua|科华|ST-?360/i.test(t)) return "Kehua ST-360";
    return "";
  };

  // one file (bytes) → {plates:[...], instrument, sheets}
  E.readAny = function (name, buf) {
    var u = new Uint8Array(buf);
    var isZip = u[0] === 0x50 && u[1] === 0x4B;
    if (/\.json$/i.test(name) || (!isZip && /^\s*\{/.test(E.decode(u.subarray(0, 200))))) {
      return Promise.resolve({ record: JSON.parse(E.decode(u)) });
    }
    if (isZip) {
      return E.unzip(buf).then(function (files) {
        if (!files["xl/workbook.xml"]) throw new Error("zipother");
        return E.readXlsx(files).then(function (sheets) {
          var plates = [], inst = "";
          sheets.forEach(function (s) {
            var ps = E.findPlates(s.grid);
            ps.forEach(function (p) { p.sheet = s.name; p.label = (sheets.length > 1 ? s.name + (p.label ? " · " : "") : "") + p.label; plates.push(p); });
            inst = inst || E.instrument(s.grid, [s.name]);
          });
          return { plates: plates, instrument: inst, format: "xlsx", sheets: sheets.map(function (s) { return { name: s.name, grid: s.grid.slice(0, 80) }; }) };
        });
      });
    }
    if (u[0] === 0xD0 && u[1] === 0xCF) return Promise.reject(new Error("xls"));
    return Promise.resolve(E.readText(E.decode(u)));
  };
  E.readText = function (text) {
    var grid = E.textGrid(text);
    return { plates: E.findPlates(grid), instrument: E.instrument(grid), format: "text", grid: grid, sheets: [{ name: "", grid: grid.slice(0, 80) }] };
  };

  // The layout of a file for a format report: the first rows, every digit replaced by 9 so readings are not sent
  // (decimal separators, overflow marks, labels and column positions stay). Sample names stay — the user sees and can edit it.
  E.skeleton = function (sheets, maxRows, maxChars) {
    maxRows = maxRows || 60; maxChars = maxChars || 6000;
    var out = [];
    (sheets || []).forEach(function (sh) {
      if (sheets.length > 1 || sh.name) out.push("=== sheet: " + sh.name);
      var rows = sh.grid.slice(0, maxRows);
      while (rows.length && !rows[rows.length - 1].some(function (c) { return String(c).trim(); })) rows.pop();
      rows.forEach(function (r) { out.push((r || []).map(function (c) { return String(c == null ? "" : c).replace(/\d/g, "9"); }).join("\t").replace(/\t+$/, "")); });
    });
    var t = out.join("\n");
    return t.length > maxChars ? t.slice(0, maxChars) + "\n[…cut]" : t;
  };

  // the wavelength in a label, if any ("Read 1:450" → 450)
  E.wavelength = function (label) {
    var m = /(?:^|[^\d])([3-9]\d{2})(?:\s*nm)?(?:[^\d]|$)/.exec(String(label || ""));
    return m ? +m[1] : null;
  };
  // pick the signal block and a reference block (570/600/620/630/650/690 nm) when both are there
  E.guessBlocks = function (plates) {
    if (!plates.length) return { sig: -1, ref: -1 };
    var wl = plates.map(function (p) { return E.wavelength(p.label); });
    var sig = 0, ref = -1;
    var i450 = wl.indexOf(450);
    if (i450 >= 0) sig = i450;
    else {
      // otherwise the first block that isn't a typical reference
      for (var i = 0; i < wl.length; i++) if (!(wl[i] >= 540 && wl[i] <= 700) || i === wl.length - 1) { sig = i; break; }
    }
    for (var j = 0; j < wl.length; j++) if (j !== sig && wl[j] >= 540 && wl[j] <= 700 && (!wl[sig] || wl[sig] < 540)) { ref = j; break; }
    // a "corrected" / "delta" block already has the reference taken off
    if (plates[sig] && /corr|delta|−|-\s*\d{3}|blank/i.test(plates[sig].label) && /\d{3}\s*[-−]\s*\d{3}/.test(plates[sig].label)) ref = -1;
    return { sig: sig, ref: ref };
  };

  // ===================================================================
  // 5. Layout presets  (wells → {t, id}); groups get created by the page
  // ===================================================================
  E.preset = function (kind, nStd) {
    nStd = nStd || 8;
    var wells = {}, ids = { std: [], smp: [] }, s = 0;
    function put(w, t, id) { wells[w] = { t: t, id: id }; }
    if (kind === "cols12") { // standards duplicate in columns 1–2, samples in pairs across
      for (var r = 0; r < Math.min(8, nStd); r++) { put(E.ROWS[r] + 1, "std", "STD" + (r + 1)); put(E.ROWS[r] + 2, "std", "STD" + (r + 1)); }
      for (r = 0; r < 8; r++) for (var c = 3; c <= 11; c += 2) { s++; put(E.ROWS[r] + c, "smp", "S" + s); put(E.ROWS[r] + (c + 1), "smp", "S" + s); }
    } else if (kind === "cols12down") { // standards in columns 1–2, samples in vertical pairs
      for (r = 0; r < Math.min(8, nStd); r++) { put(E.ROWS[r] + 1, "std", "STD" + (r + 1)); put(E.ROWS[r] + 2, "std", "STD" + (r + 1)); }
      for (c = 3; c <= 12; c++) for (r = 0; r < 8; r += 2) { s++; put(E.ROWS[r] + c, "smp", "S" + s); put(E.ROWS[r + 1] + c, "smp", "S" + s); }
    } else if (kind === "cols123") { // triplicates
      for (r = 0; r < Math.min(8, nStd); r++) for (c = 1; c <= 3; c++) put(E.ROWS[r] + c, "std", "STD" + (r + 1));
      for (r = 0; r < 8; r++) for (c = 4; c <= 12; c += 3) { s++; for (var k = 0; k < 3; k++) put(E.ROWS[r] + (c + k), "smp", "S" + s); }
    } else if (kind === "rowsAB") { // standards across rows A–B
      for (c = 1; c <= Math.min(12, nStd); c++) { put("A" + c, "std", "STD" + c); put("B" + c, "std", "STD" + c); }
      for (r = 2; r < 8; r++) for (c = 1; c <= 11; c += 2) { s++; put(E.ROWS[r] + c, "smp", "S" + s); put(E.ROWS[r] + (c + 1), "smp", "S" + s); }
    }
    return wells;
  };

  // standard series: top, fold, n levels (the last one 0 when zeroLast)
  E.series = function (top, fold, n, zeroLast) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(zeroLast && i === n - 1 ? 0 : top / Math.pow(fold, i));
    return out;
  };

  if (typeof module !== "undefined" && module.exports) module.exports = E;
  if (root) root.LME = E;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
