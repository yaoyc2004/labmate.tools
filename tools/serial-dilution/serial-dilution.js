// labmate.tools — 2.4 Serial Dilution
(function () {
  "use strict";
  var LM = window.LM;
  var KEY = "lm-serial-v1";
  var OTHER = [["%", 1], ["X", 1], ["cells/mL", 1], ["CFU/mL", 1], ["copies/µL", 1], ["U/mL", 1]];
  var EXAMPLE = { top: "1000", topu: "ng/mL", fold: "2", n: "8", vol: "100", volu: "µL", stock: "", discard: true, blank: true };

  var $ = function (id) { return document.getElementById(id); };
  LM.fillSelect($("topu"), [["Mass / volume", LM.MASSC.concat([["ng/mL", 1e-6], ["pg/mL", 1e-9]].filter(function (u) {
    return !LM.MASSC.some(function (m) { return m[0] === u[0]; });
  }))], ["Molar", LM.MOLAR], ["Other", OTHER]]);
  LM.fillSelect($("volu"), [["", [["mL", 1e-3], ["µL", 1e-6]]]]);

  var state = LM.load(KEY) || JSON.parse(JSON.stringify(EXAMPLE));
  var lastText = "";
  var FIELDS = ["top", "topu", "fold", "n", "vol", "volu", "stock"];

  function setMsg(id, t) {
    $(id + "m").textContent = t || "";
    document.querySelector('[data-term="' + id + '"]').classList.toggle("is-bad", !!t);
  }
  function num(id, o) {
    o = o || {};
    var v = LM.parse($(id).value);
    if (v == null) { if (!o.optional) return null; return undefined; }
    if (isNaN(v)) { setMsg(id, "Not a number"); return NaN; }
    if (v <= 0) { setMsg(id, "Must be above zero"); return NaN; }
    if (o.int && Math.round(v) !== v) { setMsg(id, "Whole number"); return NaN; }
    if (o.min != null && v < o.min) { setMsg(id, o.minMsg); return NaN; }
    if (o.max != null && v > o.max) { setMsg(id, o.maxMsg); return NaN; }
    return v;
  }
  function vol(x) { return LM.show(x * 1e-6, [["mL", 1e-3], ["µL", 1e-6]]); } // x in µL
  function volPlain(x) { return LM.showPlain(x * 1e-6, [["mL", 1e-3], ["µL", 1e-6]]); }
  function conc(x) { return LM.fmt(x) + " " + $("topu").value; }
  function concPlain(x) { return LM.fmtPlain(x) + " " + $("topu").value; }

  function update() {
    ["top", "fold", "n", "vol", "stock"].forEach(function (id) { setMsg(id, ""); });
    FIELDS.forEach(function (id) { state[id] = $(id).value; });
    state.discard = $("discard").checked; state.blank = $("blank").checked;
    LM.save(KEY, state);
    $("stocku").textContent = $("topu").value;

    var top = num("top"), F = num("fold", { min: 1.0001, minMsg: "Must be more than 1" }),
      n = num("n", { int: true, min: 2, minMsg: "At least 2 tubes", max: 48, maxMsg: "48 tubes at most" }),
      V = num("vol"), S = num("stock", { optional: true });
    var volF = $("volu").value === "mL" ? 1000 : 1; // to µL
    if ([top, F, n, V].some(function (x) { return x !== null && isNaN(x); }) || (S !== undefined && isNaN(S))) return empty("Check the highlighted value.", true);
    if ([top, F, n, V].some(function (x) { return x === null; })) return empty("Fill in the top concentration, fold, tubes and volume.");
    V = V * volF;
    if (S !== undefined && S < top * (1 - 1e-9)) { setMsg("stock", "Weaker than the top tube"); return empty("The stock is weaker than the top concentration.", true); }

    var T = V / (F - 1);         // transfer, µL
    var tubes = [];
    for (var k = 0; k < n; k++) {
      var last = k === n - 1;
      var t = { label: String(k + 1), c: top / Math.pow(F, k) };
      if (k === 0) {
        var need = V + T;
        if (S !== undefined && S > top * (1 + 1e-9)) { t.stockVol = need * top / S; t.dil = need - t.stockVol; t.add = "stock"; }
        else { t.dil = 0; t.add = "top"; t.topVol = need; }
      } else { t.dil = V; t.add = T; }
      t.end = last && !state.discard ? V + T : V;
      tubes.push(t);
    }
    if (state.blank) tubes.push({ label: "Blank", c: 0, dil: V, add: 0, end: V, blank: true });

    // table
    $("rows").innerHTML = tubes.map(function (t) {
      var add = t.blank ? "—" : t.add === "stock" ? vol(t.stockVol) + " stock" : t.add === "top" ? vol(t.topVol) + " top" : vol(t.add) + " ← " + (+t.label - 1);
      return "<tr><td class=\"c-name\"><b>" + LM.esc(t.label) + "</b></td><td class=\"c-num\">" + (t.blank ? "0" : conc(t.c)) + "</td><td class=\"c-num\">" +
        (t.dil ? vol(t.dil) : "—") + "</td><td class=\"c-num\">" + add + "</td><td class=\"c-num c-tot\">" + vol(t.end) + "</td></tr>";
    }).join("");

    // strip
    $("strip").innerHTML = tubes.map(function (t, i) {
      var frac = t.blank ? 0 : 0.12 + 0.88 * Math.log(t.c / tubes[n - 1].c) / Math.log(top / tubes[n - 1].c);
      var shade = t.blank ? "#fff" : mix(frac);
      return '<div class="sd-tube"><span class="sd-glass"><i style="background:' + shade + '"></i></span><b>' + LM.esc(t.label) + "</b><small>" + (t.blank ? "0" : LM.fmt(t.c, 3)) + "</small></div>" +
        (i < tubes.length - 1 && !tubes[i + 1].blank ? '<span class="sd-arrow">→</span>' : "");
    }).join("");

    // steps
    var totalDil = tubes.reduce(function (s, t) { return s + (t.dil || 0); }, 0);
    var steps = [];
    steps.push("Put <b>" + vol(V) + "</b> of diluent into tubes 2–" + n + (state.blank ? " and the blank" : "") + ".");
    if (tubes[0].add === "stock") steps.push("Tube 1: <b>" + vol(tubes[0].stockVol) + "</b> of the " + conc(S) + " stock + <b>" + vol(tubes[0].dil) + "</b> diluent → " + conc(top) + ". Mix.");
    else steps.push("Tube 1: <b>" + vol(tubes[0].topVol) + "</b> of " + conc(top) + ".");
    steps.push("Move <b>" + vol(T) + "</b> from tube 1 to tube 2, mix well, then 2 → 3, and so on to tube " + n + ". New tip each time.");
    if (state.discard) steps.push("Take <b>" + vol(T) + "</b> out of tube " + n + " and discard it, so every tube has " + vol(V) + ".");
    $("steps").innerHTML = steps.map(function (s) { return "<li>" + s + "</li>"; }).join("");
    $("ansBig").textContent = n + " tubes, " + LM.fmt(F) + "-fold";
    $("ans").classList.remove("is-empty", "is-error");
    $("copy").disabled = false; $("print").disabled = false;

    $("slip").classList.remove("is-empty");
    $("slipF").textContent = "1:" + LM.fmt(F) + " PER STEP";
    $("rHi").textContent = conc(top);
    $("rLo").textContent = conc(tubes[n - 1].c);
    $("rT").textContent = vol(T);
    $("rD").textContent = vol(totalDil);

    var notes = [];
    if (T < 1) notes.push('<li class="note"><b>A ' + LM.esc(volPlain(T)) + " transfer is too small to pipette well.</b> Raise the volume left in each tube, or use a smaller fold.</li>");
    if (tubes[0].add === "stock" && tubes[0].stockVol < 1) notes.push('<li class="note">Only ' + LM.esc(volPlain(tubes[0].stockVol)) + " of stock goes into tube 1. Make an intermediate dilution first with the <a href=\"../dilution/\">Dilution</a> tool.</li>");
    $("notes").innerHTML = notes.join("");

    var lines = ["Serial dilution — labmate.tools", n + " tubes, " + LM.fmtPlain(F) + "-fold, " + volPlain(V) + " left in each", "",
      "Tube\tConcentration\tDiluent\tAdd\tEnds with"];
    tubes.forEach(function (t) {
      var add = t.blank ? "" : t.add === "stock" ? volPlain(t.stockVol) + " stock" : t.add === "top" ? volPlain(t.topVol) + " top" : volPlain(t.add) + " from tube " + (+t.label - 1);
      lines.push([t.label, t.blank ? "0" : concPlain(t.c), t.dil ? volPlain(t.dil) : "", add, volPlain(t.end)].join("\t"));
    });
    lastText = lines.join("\n");
  }

  // dark teal → pale mint
  function mix(f) {
    var a = [0xD3, 0xE6, 0xDD], b = [0x17, 0x40, 0x3D];
    return "rgb(" + a.map(function (x, i) { return Math.round(x + (b[i] - x) * f); }).join(",") + ")";
  }

  function empty(title, isErr) {
    $("ans").classList.toggle("is-error", !!isErr); $("ans").classList.toggle("is-empty", !isErr);
    $("copy").disabled = true; $("print").disabled = true;
    $("ansBig").textContent = title; $("steps").innerHTML = "";
    $("rows").innerHTML = ""; $("strip").innerHTML = ""; $("notes").innerHTML = "";
    $("slip").classList.add("is-empty");
    ["rHi", "rLo", "rT", "rD"].forEach(function (id) { $(id).textContent = "—"; });
    $("slipF").textContent = "";
    lastText = "";
  }

  FIELDS.forEach(function (id) {
    $(id).addEventListener("input", update);
    $(id).addEventListener("change", update);
  });
  ["discard", "blank"].forEach(function (id) { $(id).addEventListener("change", update); });
  $("foldQuick").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    $("fold").value = b.getAttribute("data-v"); update();
  });
  $("clear").addEventListener("click", function () {
    ["top", "fold", "n", "vol", "stock"].forEach(function (id) { $(id).value = ""; });
    update(); $("top").focus();
  });
  $("copy").addEventListener("click", function () {
    if (!lastText) return;
    LM.copy(lastText, function (ok) {
      $("copied").textContent = ok ? "COPIED ✓ — pastes into Excel" : "Copy failed";
      setTimeout(function () { $("copied").textContent = ""; }, 2400);
    });
  });
  $("print").addEventListener("click", function () { window.print(); });

  FIELDS.forEach(function (id) { if (state[id] != null) $(id).value = state[id]; });
  if (!$("topu").value) $("topu").value = "ng/mL";
  $("discard").checked = state.discard !== false;
  $("blank").checked = !!state.blank;
  update();
})();
