// labmate.tools — 2.8 DNA/RNA Normalization: reading NanoDrop / Qubit exports, purity flags,
// normalization volumes, plate positions and the export files (CSV, Excel, liquid-handler worklists).
// No page code here: plain data in, plain data out (window.LMNA in the browser, require() in Node).
(function (root) {
  "use strict";
  var NA = {};
  NA.VERSION = "labmate-na-1";

  // ===================================================================
  // 1. Reading text
  // ===================================================================

  // one line → cells; commas and semicolons respect "quoted, fields"
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

  // text → rows of trimmed cells; the separator is sniffed (tab, semicolon, comma, else runs of spaces)
  NA.textGrid = function (text) {
    var lines = String(text || "").replace(/^﻿/, "").split(/\r\n|\r|\n/);
    var sample = lines.filter(function (l) { return l.trim(); }).slice(0, 200);
    var count = function (ch) { return sample.reduce(function (a, l) { return a + (l.split(ch).length - 1); }, 0); };
    var tabs = count("\t"), commas = count(","), semis = count(";");
    var d = null;
    // "S1 704,98 2,07" (decimal commas, spaces between) is not comma-separated
    var spaced = sample.length && sample.every(function (l) { return l.trim().split(/\s+/).length >= 2 && !/[^\d],|,[^\d]/.test(l); });
    if (tabs > 0 && tabs >= commas * 0.5 && tabs >= semis) d = "\t";
    else if (semis > 0 && semis >= commas * 0.5) d = ";";
    else if (commas > 0 && !spaced) d = ",";
    var wide = !d && sample.some(function (l) { return /\S\s{2,}\S/.test(l); });
    return { delim: d, rows: lines.map(function (l) {
      var cells = d ? splitLine(l, d) : l.trim().split(wide && /\S\s{2,}\S/.test(l) ? /\s{2,}/ : /\s+/);
      return cells.map(function (c) { return String(c == null ? "" : c).replace(/\u00A0/g, " ").trim(); });
    }) };
  };

  // Does this file write 1,85 for 1.85? Looks at every cell that is a number with one comma.
  function sniffDecimalComma(rows, delim) {
    if (delim === ",") return false;
    var dc = 0, th = 0;
    rows.forEach(function (r) {
      r.forEach(function (c) {
        if (/^-?\d+,\d+$/.test(c)) { if (/^-?\d{1,3},\d{3}$/.test(c)) th++; else dc++; }
        else if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(c)) dc++;
        else if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(c)) th += 5;
      });
    });
    return dc > 0 && dc >= th;
  }

  // a cell → number, or null when it isn't one. Accepts units after the number ("125.3 ng/µL").
  NA.num = function (s, decimalComma) {
    var t = String(s == null ? "" : s).replace(/[\s  ']/g, "");
    if (!t) return null;
    t = t.replace(/(ng|µg|ug|μg|mg|pg)\/(µl|ul|μl|ml|l)$/i, "");
    if (decimalComma) t = t.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    else t = t.replace(/,(?=\d{3}(\D|$))/g, "");
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return parseFloat(t);
    return null;
  };

  // ===================================================================
  // 2. Units and sample types
  // ===================================================================

  // factor to ng/µL
  NA.unitFactor = function (u) {
    var s = String(u || "").toLowerCase().replace(/\s/g, "").replace(/μ/g, "µ").replace(/^\(|\)$/g, "");
    if (!s) return null;
    if (/^(ng\/µl|ng\/ul|µg\/ml|ug\/ml|mg\/l)$/.test(s)) return 1;
    if (/^(ng\/ml|pg\/µl|pg\/ul)$/.test(s)) return 1e-3;
    if (/^(µg\/µl|ug\/ul|mg\/ml|g\/l)$/.test(s)) return 1e3;
    if (/^(pg\/ml)$/.test(s)) return 1e-6;
    return null;
  };

  // instrument wording → "DNA" | "RNA" | "ssDNA" | "protein" | null
  NA.typeOf = function (s) {
    var t = String(s || "").toLowerCase();
    if (!t) return null;
    if (/protein|a280|bca|bradford/.test(t)) return "protein";
    if (/ssdna|oligo/.test(t)) return "ssDNA";
    if (/rna/.test(t)) return "RNA";
    if (/dna/.test(t)) return "DNA";
    return null;
  };

  // ===================================================================
  // 3. Finding the columns
  // ===================================================================
  function norm(h) { return String(h || "").toLowerCase().replace(/[®™]/g, "").replace(/μ/g, "µ").replace(/\s+/g, " ").trim(); }

  var CONC_RX = [
    [/^original sample conc/, 9],                    // Qubit 4 / Flex: the sample, not the assay tube
    [/^nucleic acid ?(\(|conc|$)/, 8],                // NanoDrop One / 2000
    [/^(mass )?conc(entration)?\.? ?(\(.*\))?$/, 7], // NanoDrop 8000, generic
    [/^(ng|µg|ug)\/(µl|ul|ml)$/, 7],                  // NanoDrop Eight: "ng/µL"
    [/^(dna|rna|ssdna|dsdna) ?(conc|concentration)/, 7],
    [/conc(entration)?\.? ?\((ng|µg|ug|mg|pg)\/(µl|ul|ml)\)/, 6],
    [/^qubit tube conc/, 2],                          // only if the sample's own conc. is missing
    [/(^| )conc(entration)?\.?( |$)/, 3]
  ];
  var NAME_RX = [[/^sample name$/, 9], [/^test name$/, 8], [/^sample$/, 7], [/^sample id$/, 6], [/^name$/, 6], [/^sample ?(id|name|label)/, 5], [/^(id|label|tube|sample #|#)$/, 3]];

  function bestCol(heads, rxs, avoid) {
    var best = -1, score = 0;
    heads.forEach(function (h, i) {
      if (avoid && avoid.indexOf(i) >= 0) return;
      if (/corrected|factor|%cv|impurity|unit/.test(h) && rxs === CONC_RX) return;
      for (var k = 0; k < rxs.length; k++) if (rxs[k][0].test(h)) { if (rxs[k][1] > score) { best = i; score = rxs[k][1]; } break; }
    });
    return { i: best, score: score };
  }

  function findHeader(rows) {
    for (var r = 0; r < Math.min(rows.length, 60); r++) {
      var heads = rows[r].map(norm);
      var textCells = heads.filter(function (h) { return h && NA.num(h) == null; }).length;
      if (textCells < 2) continue;
      var c = bestCol(heads, CONC_RX);
      if (c.i < 0) continue;
      // a header is followed by data: the next filled row has something in that column that isn't a unit
      var nx = rows[r + 1];
      if (!nx || NA.unitFactor(nx[c.i]) != null) continue;
      return { row: r, heads: heads, conc: c.i };
    }
    return null;
  }

  // ===================================================================
  // 4. Parse an export (or a plain list) into samples
  // ===================================================================
  // returns { format, rows: [{name, conc (ng/µL)|null, r280, r230, a260, type, pos, flag, note, src}], skipped, warnings }
  NA.parse = function (text, grid) {
    var g = grid ? { rows: grid, delim: "\t" } : NA.textGrid(text);
    var rows = g.rows.filter(function (r) { return r.some(function (c) { return c !== ""; }); });
    // (blank lines dropped, so "the next row" in findHeader is the next filled row)
    var dc = sniffDecimalComma(rows, g.delim);
    var num = function (c) { return NA.num(c, dc); };
    var out = { format: "", rows: [], skipped: 0, warnings: [], decimalComma: dc, fileType: null };

    // metadata lines before the table ("Application: RNA", NanoDrop Eight)
    var hdr = findHeader(rows);
    var start = hdr ? hdr.row : 0;
    for (var m = 0; m < start; m++) {
      var k = norm(rows[m][0]);
      if (/^application:?$|^assay:?$|^sample type:?$/.test(k)) out.fileType = NA.typeOf(rows[m][1]);
    }

    if (hdr) {
      var H = hdr.heads, ci = hdr.conc;
      var name = bestCol(H, NAME_RX, [ci]);
      var nameI = name.i;
      // a "Sample Id" made of UUIDs is not a name (NanoDrop Eight): prefer "Sample Name"
      var col = function (rx) { for (var i = 0; i < H.length; i++) if (rx.test(H[i])) return i; return -1; };
      var unitI = -1;
      for (var u = ci + 1; u < Math.min(H.length, ci + 3); u++) if (/^units?\.?$|conc\.? units$|^original sample conc\.? units$/.test(H[u])) { unitI = u; break; }
      var headUnit = (H[ci].match(/\(([^)]+)\)/) || [])[1] || (/^(ng|µg|ug)\/(µl|ul|ml)$/.test(H[ci]) ? H[ci] : null);
      var i280 = col(/(^|[^\d])260 ?\/ ?a?280/), i230 = col(/(^|[^\d])260 ?\/ ?a?230/);
      var i260 = col(/^a260( \(?10 ?mm\)?)?$|^a260 10mm$/);
      var iType = col(/^sample type$|^assay name$|^assay$|^application$|^type$|^experiment type$/);
      var formulas = [];
      H.forEach(function (h, i) { var m = /^formula name ?(\d+)$/.exec(h); if (m) { var vi = H.indexOf("formula value " + m[1]); if (vi >= 0) formulas.push([i, vi]); } });
      var iPos = col(/^well$|^location$|^position$|^pos\.?$/);
      var fmt = H.some(function (h) { return /^original sample conc/.test(h); }) ? (H.some(function (h) { return /^test name$/.test(h); }) ? "Qubit 4" : "Qubit (Flex)")
        : H.some(function (h) { return /^nucleic acid ?\(ng\/ul\)/.test(h); }) ? "NanoDrop One"
        : H.some(function (h) { return /^nucleic acid conc/.test(h); }) ? "NanoDrop 2000 / Lite"
        : H.some(function (h) { return /^plate id$/.test(h); }) ? "NanoDrop 8000"
        : out.fileType || H.some(function (h) { return /^ng\/µl$/.test(h); }) ? "NanoDrop Eight"
        : "Table with headers";
      out.format = fmt;
      out.columns = { name: nameI >= 0 ? rows[start][nameI] : null, conc: rows[start][ci], unit: unitI >= 0 ? rows[start][unitI] : headUnit, r280: i280 >= 0 ? rows[start][i280] : null, r230: i230 >= 0 ? rows[start][i230] : null };
      if (/qubit tube/.test(H[ci])) out.warnings.push("Only the Qubit tube concentration was found. That is the concentration in the assay tube, not in your sample — check the dilution.");

      for (var r = start + 1; r < rows.length; r++) {
        var row = rows[r];
        if (row.join("").trim() === "") continue;
        var nm = nameI >= 0 ? row[nameI] : "";
        if (nameI >= 0 && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(nm || "")) {
          var alt = col(/^sample name$|^sample$/);
          if (alt >= 0 && alt !== nameI && row[alt]) nm = row[alt];
        }
        var rawC = row[ci] == null ? "" : row[ci];
        var v280 = i280 >= 0 ? row[i280] : "", v230 = i230 >= 0 ? row[i230] : "";
        // NanoDrop 8000 custom methods: "Formula Name 1" = 260/280, "Formula Value 1" = the ratio
        formulas.forEach(function (fx) {
          var what = norm(row[fx[0]]);
          if (/260 ?\/ ?a?280|a\(260\)\/a\(280\)/.test(what) && v280 === "") v280 = row[fx[1]];
          if (/260 ?\/ ?a?230|a\(260\)\/a\(230\)/.test(what) && v230 === "") v230 = row[fx[1]];
        });
        var s = makeRow(nm, rawC, unitI >= 0 ? row[unitI] : headUnit, v280, v230, i260 >= 0 ? row[i260] : "", iType >= 0 ? row[iType] : "", iPos >= 0 ? row[iPos] : "", num);
        if (!s) { out.skipped++; continue; }
        s.src = r + 1;
        out.rows.push(s);
      }
    } else {
      // plain list, one sample per line: name, then ng/µL, then optional 260/280 and 260/230
      out.format = "List";
      var isRatio = function (v) { return v != null && v >= 0.3 && v <= 4; };
      rows.forEach(function (row, r) {
        var cells = row.filter(function (c) { return c !== ""; });
        if (!g.delim) cells = cells.join(" ").split(/\s+/);
        if (!cells.length) return;
        var unit = null, flagTxt = "", vals = [], names = [];
        cells = cells.filter(function (c) {
          if (NA.unitFactor(c) != null) { unit = c; return false; }
          var uf = String(c).match(/(ng|µg|ug|μg|mg|pg)\/(µl|ul|μl|ml)$/i);
          if (uf && !unit) unit = uf[0];
          if (/^[<>]/.test(c) || /^(too (low|high)|out of range|n\/?a|error)$/i.test(c)) { flagTxt = c; return false; }
          return true;
        });
        if (g.delim) {
          // separated cells: text first, numbers after; a lone leading number before more numbers is a sample number
          cells.forEach(function (c, j) {
            var v = num(c);
            if (v != null && !(j === 0 && cells.length > 1 && num(cells[1]) != null && /^\d{1,4}$/.test(c))) vals.push(v);
            else if (!vals.length) names.push(c);
          });
        } else {
          // spaces only: the numbers at the end are the values ("Sample 1 250.3" is Sample 1 at 250.3)
          var T = [];
          for (var j = cells.length - 1; j >= 0 && num(cells[j]) != null; j--) T.unshift(num(cells[j]));
          var take = 1;
          if (T.length >= 3 && isRatio(T[T.length - 1]) && isRatio(T[T.length - 2]) && T.length - 3 + (cells.length - T.length) >= 1) take = 3;
          else if (T.length >= 2 && isRatio(T[T.length - 1]) && T[T.length - 2] > 4 && cells.length - 2 >= 1) take = 2;
          if (T.length) { vals = T.slice(T.length - take); names = cells.slice(0, cells.length - take); }
          else names = cells;
          if (!names.length && vals.length > 1) names = [String(vals.shift())];
        }
        if (!vals.length && !flagTxt) { if (r === 0 || !names.length) { if (r > 0) out.skipped++; return; } out.skipped++; return; }
        var s = makeRow(names.join(" "), flagTxt || vals[0], unit || "ng/µL", vals[1], vals[2], "", "", "", num);
        if (!s) { out.skipped++; return; }
        s.src = r + 1;
        out.rows.push(s);
      });
    }
    out.rows.forEach(function (s, i) { if (!s.name) s.name = "Sample " + (i + 1); });
    if (!out.rows.length) out.warnings.push("No concentrations found. Paste the table with its header row, or one sample per line: name, then ng/µL.");
    return out;
  };

  function makeRow(name, rawC, unit, r280, r230, a260, type, pos, num) {
    var s = { name: String(name == null ? "" : name).trim(), conc: null, r280: null, r230: null, a260: null, type: NA.typeOf(type), pos: String(pos || "").trim().toUpperCase(), flag: "", note: "" };
    var raw = String(rawC == null ? "" : rawC).trim();
    var v = typeof rawC === "number" ? rawC : num(raw);
    if (v == null) {
      if (/^</.test(raw) || /too low|below/i.test(raw)) { s.flag = "low"; s.note = raw; }
      else if (/^>/.test(raw) || /too high|above|saturat/i.test(raw)) { s.flag = "high"; s.note = raw; }
      else if (/out of range|error|n\/?a|nan/i.test(raw)) { s.flag = "bad"; s.note = raw; }
      else if (!raw && s.name) { s.flag = "bad"; s.note = "no value"; }
      else return null;
    } else {
      var f = NA.unitFactor(unit);
      if (f == null) f = 1;
      s.conc = v * f;
      if (s.conc <= 0) { s.flag = "neg"; s.conc = null; s.note = "≤ 0 (below detection)"; }
    }
    var p = function (x) { var n = typeof x === "number" ? x : num(x); return n == null || !isFinite(n) ? null : n; };
    s.r280 = p(r280); s.r230 = p(r230); s.a260 = p(a260);
    if (!s.name && s.conc == null && !s.flag) return null;
    return s;
  }

  // Readings with the same name → one sample (mean), with the spread between them.
  NA.mergeRepeats = function (rows) {
    var map = {}, out = [];
    rows.forEach(function (s) {
      var k = s.name.trim().toLowerCase();
      if (!map[k]) { map[k] = { name: s.name, list: [] }; out.push(map[k]); }
      map[k].list.push(s);
    });
    return out.map(function (g) {
      var L = g.list;
      if (L.length === 1) return Object.assign({ n: 1, cv: null }, L[0]);
      var good = L.filter(function (s) { return s.conc != null; });
      var mean = function (key) { var v = good.map(function (s) { return s[key]; }).filter(function (x) { return x != null; }); return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null; };
      var m = mean("conc"), cv = null;
      if (good.length > 1) {
        var sd = Math.sqrt(good.reduce(function (a, s) { return a + Math.pow(s.conc - m, 2); }, 0) / (good.length - 1));
        cv = sd / m * 100;
      }
      return Object.assign({}, L[0], { conc: m, r280: mean("r280"), r230: mean("r230"), a260: mean("a260"), n: good.length || L.length, cv: cv, flag: good.length ? "" : L[0].flag, note: good.length ? "" : L[0].note, readings: good.map(function (s) { return s.conc; }) });
    });
  };

  // ===================================================================
  // 5. Purity
  // ===================================================================
  // Default limits (editable on the page). Sources: Thermo Fisher T042 / TN52646 (260/280 ~1.8 DNA, ~2.0 RNA;
  // 260/230 usually 2.0–2.2, lower means co-purified contaminants).
  NA.LIMITS = {
    DNA: { g280: [1.75, 2.05], y280: [1.6, 2.2], g230: 1.8, y230: 1.5 },
    RNA: { g280: [1.9, 2.2], y280: [1.8, 2.3], g230: 1.8, y230: 1.5 }
  };
  NA.LOW_CONC = 10; // ng/µL: below this, absorbance ratios are too noisy to read much into

  // → { c: "g" | "y" | "r" | "n" (no data) | "q" (too dilute to judge), why: short cause }
  NA.purity = function (s, kind, type, limits) {
    var L = (limits || NA.LIMITS)[type === "RNA" ? "RNA" : "DNA"];
    var v = kind === "280" ? s.r280 : s.r230;
    if (v == null) return { c: "n", why: "" };
    if (s.conc != null && s.conc < NA.LOW_CONC) return { c: "q", why: "under " + NA.LOW_CONC + " ng/µL, ratio unreliable" };
    if (kind === "280") {
      if (v >= L.g280[0] && v <= L.g280[1]) return { c: "g", why: "" };
      var low = v < L.g280[0];
      var why = low ? "protein or phenol?" : (type === "RNA" ? "high — check the blank" : "RNA in the DNA?");
      if (v >= L.y280[0] && v <= L.y280[1]) return { c: "y", why: why };
      return { c: "r", why: why };
    }
    if (v >= L.g230) return { c: v > 2.6 ? "y" : "g", why: v > 2.6 ? "unusually high — check the blank" : "" };
    if (v >= L.y230) return { c: "y", why: "salt, guanidine or carbohydrate?" };
    return { c: "r", why: "guanidine, phenol or EDTA carry-over?" };
  };

  // ===================================================================
  // 6. Normalization
  // ===================================================================
  NA.PREDIL = [2, 4, 5, 10, 20, 25, 50, 100, 200, 500, 1000];

  function roundTo(x, step) { return step > 0 ? Math.round(x / step + 1e-9) * step : x; }
  function clean(x) { return Math.round(x * 1e6) / 1e6; }

  // Pipetting resolution. "auto" follows what a P2 / P10–P20 / P200 / P1000 can set.
  NA.stepFor = function (v, step) {
    if (step !== "auto") return +step || 0;
    return v < 2 ? 0.01 : v < 20 ? 0.1 : v < 200 ? 0.5 : 1;
  };

  // opts: { mode: "mass"|"conc", amount (ng), target (ng/µL), vf (µL), minVol (µL), step (µL), predil (bool), maxSample (µL, default vf) }
  // returns per sample { status, sv, water, gives, needed, k (pre-dilution), pre: {sample, diluent}, err (% from target) }
  NA.normalize = function (samples, opts) {
    var vf = opts.vf, step = opts.step == null ? "auto" : opts.step, minVol = opts.minVol || 0;
    var needed = opts.mode === "conc" ? opts.target * vf : opts.amount;
    var maxS = opts.maxSample > 0 ? Math.min(opts.maxSample, vf) : vf;
    var comfy = Math.max(minVol * 2, 1); // aim for at least this after a pre-dilution
    return samples.map(function (s) {
      var r = { status: "", sv: null, water: null, gives: null, needed: needed, k: 1, pre: null, err: 0 };
      if (s.skip) { r.status = "skip"; return r; }
      if (s.conc == null || !(s.conc > 0)) { r.status = "nodata"; return r; }
      var sv = needed / s.conc;
      if (sv > maxS * (1 + 1e-9)) {
        r.status = "dilute";
        var st0 = NA.stepFor(maxS, step);
        r.sv = clean(st0 ? Math.floor(maxS / st0 + 1e-9) * st0 : maxS);
        r.water = clean(vf - r.sv);
        r.gives = r.sv * s.conc;
        r.err = (r.gives / needed - 1) * 100;
        return r;
      }
      var conc = s.conc;
      if (sv < minVol - 1e-9) {
        if (opts.predil) {
          var k = 0;
          for (var i = 0; i < NA.PREDIL.length; i++) if (sv * NA.PREDIL[i] >= comfy - 1e-9) { k = NA.PREDIL[i]; break; }
          if (!k) k = NA.PREDIL[NA.PREDIL.length - 1];
          if (sv * k > maxS) { // the comfy target doesn't fit: take the largest factor that does
            for (var j = NA.PREDIL.length - 1; j >= 0; j--) if (sv * NA.PREDIL[j] <= maxS && sv * NA.PREDIL[j] >= minVol) { k = NA.PREDIL[j]; break; }
          }
          r.k = k; conc = s.conc / k; sv = sv * k;
          // pre-dilution: enough for the transfer plus a margin, never below the smallest volume you pipette
          var take = k >= 50 ? Math.max(1, minVol) : Math.max(2, minVol);
          r.pre = { sample: take, diluent: clean(take * (k - 1)), total: clean(take * k) };
          r.status = "predil";
        } else r.status = "small";
      } else r.status = "ok";
      var st = NA.stepFor(sv, step);
      var svr = st ? roundTo(sv, st) : sv;
      if (svr <= 0) svr = st || sv;
      if (svr > vf) svr = vf;
      r.sv = clean(svr);
      r.water = clean(Math.max(0, vf - r.sv));
      r.gives = r.sv * conc;
      r.err = (r.gives / needed - 1) * 100;
      return r;
    });
  };

  // The largest equal amount every (used) sample can give in vf, rounded down to a tidy number.
  NA.maxEqual = function (samples, vf, maxSample) {
    var cap = maxSample > 0 ? Math.min(maxSample, vf) : vf;
    var cs = samples.filter(function (s) { return !s.skip && s.conc > 0; }).map(function (s) { return s.conc; });
    if (!cs.length) return null;
    return NA.tidyDown(Math.min.apply(null, cs) * cap);
  };
  NA.tidyDown = function (x) {
    if (!(x > 0)) return 0;
    var p = Math.pow(10, Math.floor(Math.log10(x)));
    var steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    var m = x / p, best = 1;
    steps.forEach(function (s) { if (s <= m + 1e-9) best = s; });
    return clean(best * p);
  };

  // ===================================================================
  // 7. Plate positions
  // ===================================================================
  NA.PLATES = { "96": [8, 12], "384": [16, 24], "48": [6, 8], "24": [4, 6] };
  var LETTERS = "ABCDEFGHIJKLMNOP";
  NA.wellName = function (r, c) { return LETTERS[r] + (c + 1); };
  NA.parseWell = function (w) {
    var m = /^([A-P])\s*0?(\d{1,2})$/i.exec(String(w || "").trim());
    return m ? [m[1].toUpperCase().charCodeAt(0) - 65, +m[2] - 1] : null;
  };
  // n wells from `start`, down the columns ("col") or along the rows ("row"), optionally skipping edge wells
  NA.wells = function (n, plate, order, start, skipEdge) {
    var dim = NA.PLATES[plate] || NA.PLATES["96"], R = dim[0], C = dim[1];
    var list = [];
    if (order === "row") { for (var r = 0; r < R; r++) for (var c = 0; c < C; c++) list.push([r, c]); }
    else { for (var c2 = 0; c2 < C; c2++) for (var r2 = 0; r2 < R; r2++) list.push([r2, c2]); }
    if (skipEdge) list = list.filter(function (p) { return p[0] > 0 && p[0] < R - 1 && p[1] > 0 && p[1] < C - 1; });
    var st = NA.parseWell(start), i0 = 0;
    if (st) for (var i = 0; i < list.length; i++) if (list[i][0] === st[0] && list[i][1] === st[1]) { i0 = i; break; }
    var out = [];
    for (var k = 0; k < n; k++) {
      var p = list[i0 + k];
      if (!p) { out.push(null); continue; }
      out.push({ r: p[0], c: p[1], well: NA.wellName(p[0], p[1]), idx: p[1] * R + p[0] + 1 }); // idx: Tecan numbering, down columns
    }
    return out;
  };

  // ===================================================================
  // 8. Files
  // ===================================================================
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  NA.csv = function (rows) { return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n"; };
  NA.tsv = function (rows) { return rows.map(function (r) { return r.map(function (v) { return String(v == null ? "" : v).replace(/[\t\r\n]+/g, " "); }).join("\t"); }).join("\n"); };

  // Tecan Freedom EVOware / Fluent worklist (.gwl): A = aspirate, D = dispense, W = wash/replace tip.
  // items: [{name, srcPos, destPos, sv, water}] — diluent first (one tip per transfer), then each sample.
  NA.gwl = function (items, labels) {
    var L = Object.assign({ src: "Source", dest: "Destination", dil: "Diluent" }, labels || {});
    var f = function (v) { return (Math.round(v * 100) / 100).toFixed(2); };
    var out = ["C;labmate.tools DNA/RNA normalization — diluent first, then sample"];
    items.forEach(function (it) {
      if (!(it.water > 0)) return;
      out.push("A;" + L.dil + ";;;1;;" + f(it.water));
      out.push("D;" + L.dest + ";;;" + it.destPos + ";;" + f(it.water));
      out.push("W;");
    });
    items.forEach(function (it) {
      if (!(it.sv > 0)) return;
      out.push("A;" + L.src + ";;;" + it.srcPos + ";;" + f(it.sv));
      out.push("D;" + L.dest + ";;;" + it.destPos + ";;" + f(it.sv));
      out.push("W;");
    });
    return out.join("\r\n") + "\r\n";
  };

  // ---- a small .xlsx writer (stored zip, no compression) ----
  var CRC_T = null;
  NA.crc32 = function (u8) {
    if (!CRC_T) { CRC_T = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) crc = CRC_T[(crc ^ u8[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };
  function utf8(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    return new Uint8Array(Buffer.from(s, "utf8")); // Node without TextEncoder
  }
  NA.zip = function (files) { // files: [{name, data (string|Uint8Array)}] → Uint8Array
    var parts = [], central = [], off = 0;
    var le16 = function (v) { return [v & 255, (v >>> 8) & 255]; };
    var le32 = function (v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; };
    files.forEach(function (f) {
      var name = utf8(f.name), data = typeof f.data === "string" ? utf8(f.data) : f.data, crc = NA.crc32(data);
      var head = [].concat([0x50, 0x4B, 0x03, 0x04], le16(20), le16(0x0800), le16(0), le16(0), le16(0x21), le32(crc), le32(data.length), le32(data.length), le16(name.length), le16(0));
      parts.push(new Uint8Array(head), name, data);
      central.push(new Uint8Array([].concat([0x50, 0x4B, 0x01, 0x02], le16(20), le16(20), le16(0x0800), le16(0), le16(0), le16(0x21), le32(crc), le32(data.length), le32(data.length), le16(name.length), le16(0), le16(0), le16(0), le16(0), le32(0), le32(off))), name);
      off += head.length + name.length + data.length;
    });
    var csize = central.reduce(function (a, p) { return a + p.length; }, 0);
    var end = new Uint8Array([].concat([0x50, 0x4B, 0x05, 0x06], le16(0), le16(0), le16(files.length), le16(files.length), le32(csize), le32(off), le16(0)));
    var all = parts.concat(central, [end]), len = all.reduce(function (a, p) { return a + p.length; }, 0);
    var out = new Uint8Array(len), o = 0;
    all.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  };
  function xesc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ""); }
  function colName(i) { var s = ""; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  // Styles: 0 plain, 1 bold header, 2 title, 3 green, 4 amber, 5 red, 6 grey note, 7 number 0.00, 8 bold number
  NA.STYLE = { plain: 0, head: 1, title: 2, g: 3, y: 4, r: 5, note: 6, num: 7, bold: 8 };
  // sheets: [{name, rows: [[cell]], widths: [chars]}]; a cell is a value or {v, s: style index}
  NA.xlsx = function (sheets) {
    var files = [];
    files.push({ name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join("") + "</Types>" });
    files.push({ name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
    files.push({ name: "xl/workbook.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map(function (s, i) { return '<sheet name="' + xesc(String(s.name).replace(/[\\\/?*\[\]:]/g, " ").slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join("") + "</sheets></workbook>" });
    files.push({ name: "xl/_rels/workbook.xml.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join("") +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' });
    files.push({ name: "xl/styles.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts>' +
      '<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF4A5655"/><name val="Calibri"/></font></fonts>' +
      '<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFD7EEDF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF6E7C8"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF5D5CC"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8E4D6"/></patternFill></fill></fills>' +
      '<borders count="2"><border/><border><bottom style="thin"/></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="9">' +
      '<xf/><xf fontId="1" fillId="5" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/><xf fontId="2" applyFont="1"/>' +
      '<xf fillId="2" numFmtId="164" applyFill="1" applyNumberFormat="1"/><xf fillId="3" numFmtId="164" applyFill="1" applyNumberFormat="1"/><xf fillId="4" numFmtId="164" applyFill="1" applyNumberFormat="1"/>' +
      '<xf fontId="3" applyFont="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf fontId="1" numFmtId="164" applyFont="1" applyNumberFormat="1"/></cellXfs></styleSheet>' });
    sheets.forEach(function (sh, si) {
      var x = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'];
      if (sh.freeze) x.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + sh.freeze + '" topLeftCell="A' + (sh.freeze + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
      if (sh.widths) x.push("<cols>" + sh.widths.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join("") + "</cols>");
      x.push("<sheetData>");
      sh.rows.forEach(function (row, ri) {
        x.push('<row r="' + (ri + 1) + '">');
        row.forEach(function (cell, ci) {
          if (cell == null || cell === "") return;
          var v = cell, s = 0;
          if (typeof cell === "object") { v = cell.v; s = cell.s || 0; }
          if (v == null || v === "") { if (s) x.push('<c r="' + colName(ci) + (ri + 1) + '" s="' + s + '"/>'); return; }
          var ref = colName(ci) + (ri + 1);
          if (typeof v === "number" && isFinite(v)) x.push('<c r="' + ref + '"' + (s ? ' s="' + s + '"' : "") + "><v>" + v + "</v></c>");
          else x.push('<c r="' + ref + '" t="inlineStr"' + (s ? ' s="' + s + '"' : "") + '><is><t xml:space="preserve">' + xesc(v) + "</t></is></c>");
        });
        x.push("</row>");
      });
      x.push("</sheetData>");
      if (sh.print) x.push('<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>');
      x.push("</worksheet>");
      files.push({ name: "xl/worksheets/sheet" + (si + 1) + ".xml", data: x.join("") });
    });
    return NA.zip(files);
  };

  if (typeof module !== "undefined" && module.exports) module.exports = NA;
  if (root) root.LMNA = NA;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
