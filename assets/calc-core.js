// labmate.tools — shared helpers for the calculator pages
(function () {
  "use strict";
  var LM = (window.LM = {});

  // Units. Each value is the factor to the kind's base unit.
  LM.VOL = [["L", 1], ["mL", 1e-3], ["µL", 1e-6], ["nL", 1e-9]];
  LM.MASS = [["g", 1], ["mg", 1e-3], ["µg", 1e-6], ["ng", 1e-9]];
  LM.MOLAR = [["M", 1], ["mM", 1e-3], ["µM", 1e-6], ["nM", 1e-9], ["pM", 1e-12]];
  // mass concentration, base g/L (= mg/mL)
  LM.MASSC = [["mg/mL", 1], ["µg/µL", 1], ["µg/mL", 1e-3], ["ng/µL", 1e-3], ["ng/mL", 1e-6]];

  LM.factor = function (table, unit) {
    for (var i = 0; i < table.length; i++) if (table[i][0] === unit) return table[i][1];
    return null;
  };

  // Pick the unit that shows the value between 1 and 1000 (largest unit with value >= 1).
  LM.best = function (base, table) {
    var list = table.filter(function (u, i) {
      // skip aliases with the same factor as an earlier unit
      for (var j = 0; j < i; j++) if (table[j][1] === u[1]) return false;
      return true;
    });
    var a = Math.abs(base);
    for (var i = 0; i < list.length; i++) {
      if (a / list[i][1] >= 0.9995) return list[i];
    }
    return list[list.length - 1];
  };

  // Parse what people type: "1.5", "1,5", ".5", "1e-3", "2 000". Empty → null, junk → NaN.
  LM.parse = function (s) {
    s = String(s == null ? "" : s).trim().replace(/[\s  ']/g, "");
    if (!s) return null;
    s = s.replace(/[×x]10\^?/i, "e").replace(/^\+/, "");
    if (s.indexOf(".") < 0 && (s.match(/,/g) || []).length === 1 && !/,\d{3}$/.test(s)) s = s.replace(",", ".");
    else s = s.replace(/,/g, "");
    if (!/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return NaN;
    return parseFloat(s);
  };

  // Format to `sig` significant figures, no trailing zeros, thin grouping above 9999.
  LM.fmt = function (x, sig) {
    sig = sig || 4;
    if (x == null || !isFinite(x)) return "—";
    if (x === 0) return "0";
    var a = Math.abs(x);
    if (a >= 1e7 || a < 1e-4) {
      var e = x.toExponential(sig - 1).split("e");
      var m = e[0].indexOf(".") >= 0 ? e[0].replace(/0+$/, "").replace(/\.$/, "") : e[0];
      return m + " × 10" + sup(e[1].replace("+", ""));
    }
    var d = Math.max(0, sig - 1 - Math.floor(Math.log10(a) + 1e-12));
    var s = x.toFixed(Math.min(d, 12));
    if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    var parts = s.split(".");
    if (Math.abs(parseFloat(parts[0])) >= 10000) parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return parts.join(".");
  };
  // Plain version for inputs and copied text (no thin spaces, no superscripts).
  LM.fmtPlain = function (x, sig) {
    sig = sig || 4;
    if (x == null || !isFinite(x)) return "";
    var a = Math.abs(x);
    if (x !== 0 && (a >= 1e7 || a < 1e-4)) return x.toExponential(sig - 1).replace(/\.?0+e/, "e").replace("e+", "e");
    return LM.fmt(x, sig).replace(/ /g, "");
  };
  function sup(n) {
    var map = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
    return n.split("").map(function (c) { return map[c] || c; }).join("");
  }

  // value in base unit → "12.5 µL" using the best unit of the table
  LM.show = function (base, table, sig) {
    var u = LM.best(base, table);
    return LM.fmt(base / u[1], sig) + " " + u[0];
  };
  LM.showPlain = function (base, table, sig) {
    var u = LM.best(base, table);
    return LM.fmtPlain(base / u[1], sig) + " " + u[0];
  };

  // Fill a <select> from unit tables: [[label, table], ...] gives optgroups.
  LM.fillSelect = function (sel, groups) {
    sel.innerHTML = "";
    groups.forEach(function (g) {
      var parent = sel;
      if (g[0]) { parent = document.createElement("optgroup"); parent.label = g[0]; sel.appendChild(parent); }
      g[1].forEach(function (u) {
        var o = document.createElement("option");
        o.value = u[0]; o.textContent = u[0];
        parent.appendChild(o);
      });
    });
  };

  // Browser storage — optional; the page works without it.
  LM.load = function (key) {
    try { var s = window.localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  };
  LM.save = function (key, obj) {
    try { window.localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* private mode etc. */ }
  };

  LM.copy = function (text, done) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      done(ok);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else fallback();
  };

  LM.esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  };
})();
