/* labmate.tools — 7.2 Antibody Titration and 7.3 Staining Cocktail: pure calculations (no DOM).
 * window.LMF in the browser, require() in Node. Algorithm id: labmate-flow-1.
 * Units inside: volumes in µL, stock concentration in mg/mL (= µg/µL), antibody amount in µg per test
 * or µL of stock per test, final concentration in µg/mL.
 */
(function (root) {
  "use strict";
  var F = {};
  F.ALGO = "labmate-flow-1";
  var G = root && root.LMG ? root.LMG : (typeof require === "function" ? require("./grid-core.js") : null);

  F.MIN_UL = 0.5;      // below this a pipetted volume is flagged
  F.TARGET_UL = 2;     // a predilution aims for at least this much per pipetting
  F.NICE = [1, 2, 2.5, 4, 5];

  function nice(v) { // smallest 1/2/2.5/4/5 × 10^k ≥ v
    var e = Math.floor(Math.log10(v));
    for (var k = e; k <= e + 1; k++) for (var i = 0; i < F.NICE.length; i++) {
      var c = +(F.NICE[i] * Math.pow(10, k)).toPrecision(6);
      if (c >= v * (1 - 1e-9)) return c;
    }
    return Math.pow(10, e + 1);
  }
  F.nice = nice;

  // How to pipette `ul` µL of stock accurately: as is, or after a 1:d predilution.
  // Returns { ul, d, use, make: { stock, buffer } } — use = µL of the predilution to take.
  F.predilute = function (ul, needTotal) {
    if (!(ul > 0)) return null;
    if (ul >= F.MIN_UL) return { ul: ul, d: 1, use: ul };
    var d = nice(F.TARGET_UL / ul), use = ul * d;
    var total = Math.max(use * (needTotal || 1) * 1.1, 10), stock = total / d;
    if (stock < F.TARGET_UL) { stock = F.TARGET_UL; total = stock * d; }
    stock = Math.ceil(stock * 10 - 1e-9) / 10;
    return { ul: ul, d: d, use: use, make: { stock: stock, buffer: stock * (d - 1), total: stock * d } };
  };

  // ------------------------------------------------------------------
  // 1. Titration series
  // o: { stock (mg/mL, or null when the vendor gives only µL/test), rec (µg/test, or µL/test when stock is null),
  //      finalVol, cellVol, top (× rec), factor, points, mode ("serial" | "direct"), extra (fraction) }
  // ------------------------------------------------------------------
  F.series = function (o) {
    var err = [];
    var byUl = !(o.stock > 0);
    if (!(o.rec > 0)) err.push("rec");
    if (!(o.finalVol > 0)) err.push("finalVol");
    if (!(o.cellVol >= 0) || o.cellVol >= o.finalVol) err.push("cellVol");
    if (!(o.top > 0)) err.push("top");
    if (!(o.factor > 1)) err.push("factor");
    if (!(o.points >= 2 && o.points <= 16 && o.points === Math.round(o.points))) err.push("points");
    if (!(o.extra >= 0)) err.push("extra");
    if (err.length) return { ok: false, err: err };

    var vMix = o.finalVol - o.cellVol;                 // antibody mix added per tube
    var conc = o.finalVol / vMix;                      // mix is this many × the final concentration
    var tubes = [];
    for (var i = 0; i < o.points; i++) {
      var mult = o.top / Math.pow(o.factor, i);        // × the vendor recommendation
      var amt = o.rec * mult;                          // µg/test, or µL of stock/test
      var ulStock = byUl ? amt : amt / o.stock;        // µL of stock per test
      tubes.push({
        n: i + 1, mult: mult, amount: amt, ulStock: ulStock,
        dil: o.finalVol / ulStock,                     // 1:dil of stock in the final staining volume
        finalUgMl: byUl ? null : amt / o.finalVol * 1000,
        mixUgMl: byUl ? null : amt / o.finalVol * 1000 * conc
      });
    }
    var keep = Math.ceil(vMix * (1 + o.extra) - 1e-9); // µL each tube must hold before cells go in
    var r = { ok: true, mode: o.mode, byUl: byUl, vMix: vMix, conc: conc, keep: keep, tubes: tubes, warn: [] };

    if (o.mode === "serial") {
      // every tube ends with `keep`: tube 1 is made at keep × f/(f − 1), each tube passes keep/(f − 1) on,
      // the last tube discards that much so all hold the same volume
      var T = keep / (o.factor - 1);
      var first = keep + T;
      var abUl = first * tubes[0].ulStock / vMix;     // stock in tube 1's mix
      r.transfer = T;
      r.first = { total: first, stock: abUl, buffer: first - abUl, pre: F.predilute(abUl) };
      if (r.first.pre && r.first.pre.d > 1) { r.first.stockUse = r.first.pre.use; r.first.buffer = first - r.first.pre.use; }
      r.buffer = keep;                                // buffer in tubes 2…n before the transfer
      r.discard = T;
      if (abUl > first) r.warn.push({ k: "tooConc", need: abUl });
    } else {
      // one predilution serves every tube under 0.5 µL, set by the smallest; per-tube factors only if it won't fit
      var small = tubes.filter(function (t) { return t.ulStock < F.MIN_UL; });
      var d = small.length ? nice(F.TARGET_UL / small[small.length - 1].ulStock) : 1;
      var shared = small.length && small[0].ulStock * d <= vMix;
      if (shared) {
        var need = small.reduce(function (a, t) { return a + t.ulStock * d; }, 0) * 1.2;
        var stockUl = Math.max(F.TARGET_UL, Math.ceil(need / d * 10 - 1e-9) / 10);
        r.pre = { d: d, stock: stockUl, buffer: stockUl * (d - 1), total: stockUl * d };
      }
      tubes.forEach(function (t) {
        if (t.ulStock < F.MIN_UL) t.pre = shared ? { ul: t.ulStock, d: d, use: t.ulStock * d } : F.predilute(t.ulStock, o.points);
        else t.pre = { ul: t.ulStock, d: 1, use: t.ulStock };
        t.add = t.pre.use;
        t.buffer = vMix - t.add;
        if (t.buffer < 0) r.warn.push({ k: "over", n: t.n });
      });
    }
    return r;
  };

  // ------------------------------------------------------------------
  // 2. Stain index and the concentration to use
  // rows: [{ x (amount per test, > 0), pos, neg, sd (negative-population SD or rSD), p84 (negative 84th percentile) }]
  // method: "si" (Maecker 2004: (pos − neg) / (2 × SD neg)), "sep" (84th percentile: (pos − neg) / ((p84 − neg) / 0.995)),
  //         "sn" (pos / neg). "auto" = si when every row has a SD, else sep when every row has p84, else sn.
  // ------------------------------------------------------------------
  F.index = function (row, method) {
    var d = row.pos - row.neg;
    if (method === "si") return row.sd > 0 ? d / (2 * row.sd) : NaN;
    if (method === "sep") return row.p84 > row.neg ? d / ((row.p84 - row.neg) / 0.995) : NaN;
    return row.neg > 0 ? row.pos / row.neg : NaN;
  };
  F.pickMethod = function (rows) {
    if (rows.length && rows.every(function (r) { return r.sd > 0; })) return "si";
    if (rows.length && rows.every(function (r) { return r.p84 > r.neg; })) return "sep";
    return "sn";
  };
  F.analyse = function (rows, method, keepFrac) {
    keepFrac = keepFrac == null ? 0.9 : keepFrac;
    var ok = rows.filter(function (r) { return r.x > 0 && isFinite(r.pos) && isFinite(r.neg); });
    if (ok.length < 2) return { ok: false, err: "rows" };
    if (!method || method === "auto") method = F.pickMethod(ok);
    var pts = ok.map(function (r) { return { x: r.x, label: r.label, pos: r.pos, neg: r.neg, sd: r.sd, p84: r.p84, v: F.index(r, method) }; })
      .sort(function (a, b) { return a.x - b.x; });
    var good = pts.filter(function (p) { return isFinite(p.v); });
    if (good.length < 2) return { ok: false, err: method };
    var best = good.reduce(function (a, b) { return b.v > a.v ? b : a; });
    var thr = best.v * keepFrac;
    var lean = good.filter(function (p) { return p.v >= thr - 1e-12; })[0];   // lowest x reaching the threshold
    var flags = [];
    var lowNeg = pts[0].neg;
    pts.forEach(function (p) { p.bgUp = lowNeg > 0 && p.neg > 2 * lowNeg; });
    if (pts.some(function (p) { return p.bgUp; })) flags.push("bgUp");
    if (best === good[good.length - 1]) flags.push("topBest");      // still rising at the top: titrate higher
    if (best === good[0] && good.length > 2) flags.push("lowBest");  // best at the lowest: titrate lower
    return { ok: true, method: method, pts: pts, best: best, lean: lean, keepFrac: keepFrac, flags: flags };
  };

  // "1:200", "1/200", "1-200" → { kind: "dil", v: 200 }; "0.25 ug", "0.25µg" → ug; "2 uL" → ul; "4x" → mult
  F.labelAmount = function (s) {
    s = String(s || "");
    var m = s.match(/(?:^|[^\d.])1\s*[:\/]\s*(\d+(?:[.,]\d+)?)/) || s.match(/(?:^|[^\d.])1-(\d{2,6})(?![\d.])/);
    if (m) return { kind: "dil", v: parseFloat(m[1].replace(",", ".")) };
    m = s.match(/(\d+(?:[.,]\d+)?|\.\d+)\s*(µg|ug|mcg|μg|ng)\b/i);
    if (m) return { kind: "ug", v: parseFloat(m[1].replace(",", ".")) / (/ng/i.test(m[2]) ? 1000 : 1) };
    m = s.match(/(\d+(?:[.,]\d+)?|\.\d+)\s*(µl|ul|μl)\b/i);
    if (m) return { kind: "ul", v: parseFloat(m[1].replace(",", ".")) };
    m = s.match(/(\d+(?:[.,]\d+)?|\.\d+)\s*[x×]\b/i);
    if (m) return { kind: "mult", v: parseFloat(m[1].replace(",", ".")) };
    return null;
  };

  // A pasted statistics table (FlowJo table editor, FCS Express, Diva, Kaluza…) → columns and a guess.
  // Returns { head: [names], rows: [[cells]], guess: { name, pos, neg, sd, p84 } (column indexes or -1) }
  F.readTable = function (text) {
    var grid = G.textGrid(text).filter(function (r) { return r.some(function (c) { return c; }); });
    if (!grid.length) return { ok: false, err: "empty" };
    var numeric = function (r) { return r.filter(function (c) { return G.num(c) != null; }).length; };
    // header = the last row before the first mostly numeric row
    var hi = -1;
    for (var i = 0; i < grid.length; i++) { if (numeric(grid[i]) >= 2) break; hi = i; }
    var width = grid.reduce(function (a, r) { return Math.max(a, r.length); }, 0);
    var head = hi >= 0 ? grid[hi].slice() : [];
    while (head.length < width) head.push("Column " + (head.length + 1));
    var rows = grid.slice(hi + 1).filter(function (r) { return numeric(r) >= 1; })
      .filter(function (r) { return !/^(mean|sd|median|cv|min|max|average)$/i.test(r[0] || ""); });
    var g = { name: -1, pos: -1, neg: -1, sd: -1, p84: -1 };
    var isNum = head.map(function (_, c) { return rows.length && rows.filter(function (r) { return G.num(r[c]) != null; }).length >= rows.length / 2; });
    head.forEach(function (h, c) { if (g.name < 0 && !isNum[c]) g.name = c; });
    var neg = function (h) { return /\bneg(ative)?\b|unstained|[^\s|]-\s*(\||$|\))/i.test(h); };
    var stat = function (h, re) { return re.test(h); };
    head.forEach(function (h, c) {
      if (!isNum[c]) return;
      if (stat(h, /84|percentile/i)) { if (g.p84 < 0) g.p84 = c; return; }
      if (stat(h, /\brsd\b|robust\s*sd|robust\s*s\.?d|\bsd\b|std\.?\s*dev|standard deviation/i)) { if (g.sd < 0) g.sd = c; return; }
      if (stat(h, /median|mfi|\bmean\b|geo/i)) {
        if (neg(h)) { if (g.neg < 0) g.neg = c; }
        else if (g.pos < 0) g.pos = c;
        else if (g.neg < 0) g.neg = c;
      }
    });
    // no stat names at all: name, pos, neg, sd in that order
    if (g.pos < 0 && g.neg < 0) {
      var nums = head.map(function (_, c) { return c; }).filter(function (c) { return isNum[c]; });
      if (nums.length >= 2) { g.pos = nums[0]; g.neg = nums[1]; if (nums.length >= 3) g.sd = nums[2]; }
    }
    return { ok: rows.length > 0, err: rows.length ? null : "rows", head: head, rows: rows, guess: g };
  };

  // ------------------------------------------------------------------
  // 3. Staining cocktail
  // o: { tubes, overMode ("pct" | "tubes"), over, finalVol (staining volume per tube), cocktailVol (µL added per tube),
  //      abs: [{ name, fluor, use: "ul" | "dil" | "ug", value, stock (mg/mL, for "ug"), viability (bool) }],
  //      bsb (µL/test or 0), fc (µL/test or 0) }
  // ------------------------------------------------------------------
  F.BRILLIANT = /^(BV|BUV|BB|BYG|RB|Super ?Bright|SB)\s?\d/i;
  F.perTest = function (a, finalVol) {
    if (!(a.value > 0)) return NaN;
    if (a.use === "ul") return a.value;
    if (a.use === "dil") return finalVol / a.value;
    if (a.use === "ug") return a.stock > 0 ? a.value / a.stock : NaN;
    return NaN;
  };
  F.cocktail = function (o) {
    var err = [];
    if (!(o.tubes >= 1 && o.tubes === Math.round(o.tubes))) err.push("tubes");
    if (!(o.over >= 0)) err.push("over");
    if (!(o.finalVol > 0)) err.push("finalVol");
    if (!(o.cocktailVol > 0) || o.cocktailVol > o.finalVol) err.push("cocktailVol");
    if (err.length) return { ok: false, err: err };
    var n = o.overMode === "tubes" ? o.tubes + o.over : o.tubes * (1 + o.over / 100);
    n = Math.round(n * 1000) / 1000;
    var lines = [], live = [], bad = [];
    (o.abs || []).forEach(function (a, i) {
      var pt = F.perTest(a, o.finalVol);
      var l = { i: i, name: a.name, fluor: a.fluor, perTest: pt, total: pt * n, ug: a.use === "ug" ? a.value * n : (a.stock > 0 ? pt * a.stock * n : null),
        brilliant: F.BRILLIANT.test(a.fluor || ""), viability: !!a.viability };
      if (!isFinite(pt)) { bad.push(i); return; }
      if (l.total < F.MIN_UL) {
        l.small = true;
        l.minTubes = Math.ceil(F.MIN_UL / pt / (n / o.tubes) - 1e-9);   // tubes at this overage that reach 0.5 µL
        l.pre = F.predilute(l.total);
      }
      (l.viability ? live : lines).push(l);
    });
    var sum = lines.reduce(function (a, l) { return a + l.perTest; }, 0);
    var bsb = o.bsb > 0 ? o.bsb : 0, fc = o.fc > 0 ? o.fc : 0;
    var nBril = lines.filter(function (l) { return l.brilliant; }).length;
    var buf = o.cocktailVol - sum - bsb - fc;
    var r = { ok: true, n: n, lines: lines, live: live, bad: bad, sumPerTest: sum, bsb: bsb, fc: fc,
      bufferPerTest: buf, bufferTotal: buf * n, cocktailTotal: o.cocktailVol * n, cellVol: o.finalVol - o.cocktailVol,
      minCocktail: sum + bsb + fc, nBrilliant: nBril, warn: [] };
    if (buf < -1e-9) r.warn.push("tooMuch");
    if (nBril >= 2 && !bsb) r.warn.push("needBsb");
    if (lines.some(function (l) { return l.small; })) r.warn.push("small");
    return r;
  };

  // ------------------------------------------------------------------
  // 4. Antibody library (stored by the page; these only shape the data)
  // ------------------------------------------------------------------
  F.LIB_KEY = "labmate.antibodies.v1";
  F.libKey = function (a) { return [a.target, a.fluor, a.clone].map(function (s) { return String(s || "").trim().toLowerCase(); }).join("|"); };
  F.libFind = function (lib, target, fluor) {
    var t = String(target || "").trim().toLowerCase(), f = String(fluor || "").trim().toLowerCase().replace(/[\s-]+/g, "");
    var hits = (lib || []).filter(function (a) { return String(a.target || "").trim().toLowerCase() === t; });
    var exact = hits.filter(function (a) { return String(a.fluor || "").toLowerCase().replace(/[\s-]+/g, "") === f; });
    return exact[0] || null;
  };
  F.libValid = function (obj) {
    return !!(obj && obj.kind === "labmate.antibodies" && obj.v === 1 && Array.isArray(obj.items));
  };

  if (typeof module !== "undefined" && module.exports) module.exports = F;
  if (root) root.LMF = F;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
