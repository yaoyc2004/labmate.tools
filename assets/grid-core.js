// labmate.tools — reading pasted or exported tables, shared by tool pages.
// No page code here: text in, a grid of trimmed strings out (window.LMG in the browser, require() in Node).
// Used by 5.5 ELISA (tools/elisa/elisa-core.js) and 7.2 Antibody Titration (assets/flow-core.js).
(function (root) {
  "use strict";
  var G = {};

  // bytes of a file → text: UTF-8 (with or without BOM), UTF-16 LE/BE, else Windows-1252
  G.decode = function (bytes) {
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
  G.splitLine = splitLine;

  // text → rows of cells. The separator is sniffed: tab, then semicolon (European CSV), then comma, else spaces.
  G.textGrid = function (text) {
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

  // a cell → number or null. Accepts a single decimal comma (12,5), spaces as thousands separators, exponents, a trailing %.
  G.num = function (s) {
    var t = String(s == null ? "" : s).replace(/[\s  ]/g, "").replace(/%$/, "");
    if (!t) return null;
    if (/^-?\d+,\d+$/.test(t)) t = t.replace(",", ".");
    if (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return parseFloat(t);
    return null;
  };

  // nice decade ticks for a log axis between lo and hi (both > 0): [{v, major}]
  G.logTicks = function (lo, hi) {
    var out = [], e0 = Math.floor(Math.log10(lo)), e1 = Math.ceil(Math.log10(hi));
    for (var e = e0; e <= e1; e++) [1, 2, 5].forEach(function (k) {
      var v = k * Math.pow(10, e);
      if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)) out.push({ v: +v.toPrecision(3), major: k === 1 });
    });
    return out;
  };

  if (typeof module !== "undefined" && module.exports) module.exports = G;
  if (root) root.LMG = G;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
