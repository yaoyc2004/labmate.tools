// labmate.tools — 7.3 Staining Cocktail: the page. Maths in assets/flow-core.js (window.LMF).
(function () {
  "use strict";
  var LM = window.LM, F = window.LMF, Lib = window.LMLib;
  var KEY = "lm-cocktail-v1";
  var $ = function (id) { return document.getElementById(id); };

  function row(target, fluor, use, value, stock, viability) {
    return { target: target || "", fluor: fluor || "", use: use || "ul", value: value == null ? "" : String(value), stock: stock == null ? "" : String(stock), viability: !!viability };
  }
  var DEF = { name: "", tubes: "12", overMode: "pct", over: "10", finalVol: "100", cocktailVol: "50", bsbKind: "none", bsb: "", fc: "",
    rows: [row("CD3", "BV421", "ul", "1"), row("CD4", "PE", "ug", "0.125", "0.2"), row("CD8", "APC", "dil", "200"), row("Live/Dead", "Zombie NIR", "dil", "1000", "", true)] };
  var st = LM.load(KEY);
  if (!st || !Array.isArray(st.rows)) st = JSON.parse(JSON.stringify(DEF));
  Object.keys(DEF).forEach(function (k) { if (st[k] === undefined) st[k] = JSON.parse(JSON.stringify(DEF[k])); });

  // Brilliant Stain Buffer presets: µL per test. Check your own datasheet; the field stays editable.
  var BSB = { none: "", bsb: "50", plus: "10", custom: null };
  var FIELDS = ["name", "tubes", "over", "finalVol", "cocktailVol", "bsb", "fc"];

  function fill() {
    FIELDS.forEach(function (k) { $(k).value = st[k]; });
    $("bsbKind").value = st.bsbKind; $("overMode").value = st.overMode;
    renderRows();
  }
  function hint(r) {
    var hit = Lib.find(r.target, r.fluor);
    var info = hit && hit.titer && hit.titer.amount > 0 ? "titered " + Lib.titerText(hit) : hit ? "in my antibodies, not titrated" : "";
    if (info && hit.titer && hit.titer.lot && hit.lot && hit.titer.lot !== hit.lot) info += " · new lot since titration";
    if (info) return LM.esc(info);
    return r.target ? '<a href="../antibody-titration/?target=' + encodeURIComponent(r.target) + '&amp;fluor=' + encodeURIComponent(r.fluor) + '">titrate →</a>' : "";
  }
  function renderRows() {
    $("rows").innerHTML = st.rows.map(function (r, i) {
      return '<tr data-i="' + i + '">' +
        '<td class="c-wide" data-l="TARGET"><label class="sr" for="rt' + i + '">Target, row ' + (i + 1) + '</label><input type="text" id="rt' + i + '" data-k="target" value="' + LM.esc(r.target) + '" placeholder="CD4" autocomplete="off" spellcheck="false"><small data-hint>' + hint(r) + '</small></td>' +
        '<td data-l="FLUOR"><label class="sr" for="rf' + i + '">Fluorochrome, row ' + (i + 1) + '</label><input type="text" id="rf' + i + '" data-k="fluor" value="' + LM.esc(r.fluor) + '" placeholder="PE" autocomplete="off" spellcheck="false"></td>' +
        '<td data-l="AMOUNT"><label class="sr" for="rv' + i + '">Amount, row ' + (i + 1) + '</label><input type="text" class="num" id="rv' + i + '" data-k="value" inputmode="decimal" value="' + LM.esc(r.value) + '" autocomplete="off"></td>' +
        '<td data-l="UNIT"><label class="sr" for="ru' + i + '">Unit, row ' + (i + 1) + '</label><select id="ru' + i + '" data-k="use"><option value="ul">µL/test</option><option value="dil">1:X</option><option value="ug">µg/test</option></select></td>' +
        '<td data-l="STOCK mg/mL"><label class="sr" for="rs' + i + '">Stock mg/mL, row ' + (i + 1) + '</label><input type="text" class="num" id="rs' + i + '" data-k="stock" inputmode="decimal" value="' + LM.esc(r.stock) + '" placeholder="' + (r.use === "ug" ? "needed" : "") + '" autocomplete="off"></td>' +
        '<td data-l="VIABILITY" class="c-num"><label class="fl-chk" style="min-height:34px"><input type="checkbox" data-k="viability"' + (r.viability ? " checked" : "") + '><span class="sr">Fixable viability dye, row ' + (i + 1) + '</span></label></td>' +
        '<td class="c-x"><button type="button" class="rc-x" data-act="rm" aria-label="Remove row ' + (i + 1) + '">×</button></td></tr>';
    }).join("");
    Array.prototype.forEach.call($("rows").querySelectorAll("select[data-k=use]"), function (s, i) { s.value = st.rows[i].use; });
  }
  function read() {
    FIELDS.forEach(function (k) { st[k] = $(k).value; });
    st.bsbKind = $("bsbKind").value; st.overMode = $("overMode").value;
    Array.prototype.forEach.call($("rows").querySelectorAll("tr"), function (tr) {
      var r = st.rows[+tr.getAttribute("data-i")]; if (!r) return;
      Array.prototype.forEach.call(tr.querySelectorAll("[data-k]"), function (el) { r[el.getAttribute("data-k")] = el.type === "checkbox" ? el.checked : el.value; });
    });
  }
  function setMsg(id, text) {
    var m = $(id + "m"); if (m) m.textContent = text || "";
    var t = document.querySelector('[data-term="' + id + '"]'); if (t) t.classList.toggle("is-bad", !!text);
  }
  var ul = function (v) { return v == null || !isFinite(v) ? "—" : LM.fmt(v, v >= 1000 ? 5 : v >= 100 ? 4 : 3) + " µL"; };

  var res = null;
  function compute() {
    ["tubes", "over", "finalVol", "cocktailVol", "bsb", "fc"].forEach(function (k) { setMsg(k, ""); });
    var p = function (k) { var v = LM.parse(st[k]); return v == null ? null : v; };
    var o = { tubes: p("tubes"), overMode: st.overMode, over: p("over") == null ? 0 : p("over"), finalVol: p("finalVol"), cocktailVol: p("cocktailVol"),
      bsb: st.bsbKind === "none" ? 0 : (p("bsb") || 0), fc: p("fc") || 0 };
    o.abs = st.rows.filter(function (r) { return r.target.trim() || r.fluor.trim() || r.value.trim(); }).map(function (r) {
      return { name: r.target.trim(), fluor: r.fluor.trim(), use: r.use, value: LM.parse(r.value), stock: LM.parse(r.stock), viability: r.viability, src: r };
    });
    res = F.cocktail(o);
    if (!res.ok) {
      var M = { tubes: "Whole number, 1 or more", over: "Can't be negative", finalVol: "Must be above zero", cocktailVol: "Above zero, at most the staining volume" };
      res.err.forEach(function (k) { setMsg(k, M[k]); });
    }
    if (st.bsbKind !== "none" && !(LM.parse(st.bsb) > 0)) setMsg("bsb", "Enter µL per test");
    res.o = o;
    render();
    LM.save(KEY, st);
    writeHash();
  }

  function render() {
    var ans = $("ans");
    // row-level marks
    Array.prototype.forEach.call($("rows").querySelectorAll("tr"), function (tr) { tr.classList.remove("is-bad"); });
    if (!res.ok) {
      ans.className = "ans is-empty"; $("ansBig").textContent = "—"; $("ansSay").textContent = "Fill in the number of tubes and the volumes.";
      $("out").innerHTML = ""; $("live").innerHTML = ""; $("notes").innerHTML = ""; return;
    }
    res.bad.forEach(function (i) { var r = res.o.abs[i].src, k = st.rows.indexOf(r); var tr = $("rows").querySelector('tr[data-i="' + k + '"]'); if (tr) tr.classList.add("is-bad"); });
    var n = res.n, o = res.o;
    var over = res.warn.indexOf("tooMuch") >= 0;
    ans.className = over ? "ans is-error" : "ans";
    $("ansBig").innerHTML = over ? "Doesn't fit" : ul(res.cocktailTotal) + ' <span class="eq">cocktail</span>';
    $("ansSay").innerHTML = over
      ? "The antibodies" + (res.bsb || res.fc ? " and buffers" : "") + " take <b>" + ul(res.minCocktail) + "</b> per tube but the cocktail is " + ul(o.cocktailVol) + ". Raise the cocktail volume to at least " + ul(Math.ceil(res.minCocktail)) + " or lower the amounts."
      : "Enough for <b>" + LM.fmt(n, 4) + "</b> tubes (" + o.tubes + (o.overMode === "pct" ? " + " + LM.fmt(o.over, 3) + "%" : " + " + LM.fmt(o.over, 3)) + "). Add <b>" + ul(o.cocktailVol) + "</b> to each tube" +
        (res.cellVol > 0 ? " with " + ul(res.cellVol) + " of cells" : "") + " for " + ul(o.finalVol) + " in all.";

    var lines = [];
    if (res.bufferPerTest > 0) lines.push({ name: "Staining buffer", sub: "first", per: res.bufferPerTest, tot: res.bufferTotal });
    if (res.bsb) lines.push({ name: st.bsbKind === "plus" ? "Brilliant Stain Buffer Plus" : "Brilliant Stain Buffer", sub: "before the antibodies", per: res.bsb, tot: res.bsb * n });
    if (res.fc) lines.push({ name: "Fc block", per: res.fc, tot: res.fc * n });
    res.lines.forEach(function (l) {
      var src = o.abs[l.i].src;
      lines.push({ name: (l.name || "?") + " " + (l.fluor || ""), sub: src.use === "dil" ? "1:" + src.value + " in " + LM.fmt(o.finalVol, 4) + " µL" : src.use === "ug" ? src.value + " µg/test" : "",
        per: l.perTest, tot: l.total, ug: l.ug, small: l.small, pre: l.pre, minTubes: l.minTubes, ab: true });
    });
    var body = lines.map(function (l) {
      return '<tr class="' + (l.small ? "is-warn" : "") + '"><td class="c-chk"><input type="checkbox" aria-label="' + LM.esc(l.name) + ' added"></td>' +
        '<td class="c-wide" data-l="COMPONENT"><b>' + LM.esc(l.name) + '</b>' + (l.sub ? '<small>' + LM.esc(l.sub) + '</small>' : "") + '</td>' +
        '<td class="c-num" data-l="PER TUBE">' + ul(l.per) + '</td>' +
        '<td class="c-num c-add" data-l="TOTAL">' + ul(l.tot) + (l.small && l.pre ? '<small>or ' + ul(l.pre.use) + ' of 1:' + LM.fmt(l.pre.d, 3) + '</small>' : "") + '</td>' +
        '<td class="c-num" data-l="ANTIBODY USED">' + (l.ug != null && isFinite(l.ug) ? LM.fmt(l.ug, 3) + " µg" : "") + '</td></tr>';
    }).join("");
    body += '<tr class="is-total"><td></td><td class="c-wide" data-l="">COCKTAIL</td><td class="c-num" data-l="PER TUBE">' + ul(o.cocktailVol) + '</td><td class="c-num" data-l="TOTAL">' + ul(res.cocktailTotal) + '</td><td></td></tr>';
    $("out").innerHTML = '<thead><tr><th class="c-chk"><span class="sr">Added</span></th><th>IN THIS ORDER</th><th class="c-num">PER TUBE</th><th class="c-num">TOTAL</th><th class="c-num">ANTIBODY USED</th></tr></thead><tbody>' + body + "</tbody>";

    if (res.live.length) {
      $("liveBox").hidden = false;
      $("live").innerHTML = '<thead><tr><th class="c-chk"><span class="sr">Added</span></th><th>VIABILITY DYE</th><th class="c-num">PER TUBE</th><th class="c-num">TOTAL</th><th class="c-num">IN PBS</th></tr></thead><tbody>' +
        res.live.map(function (l) {
          return '<tr class="' + (l.small ? "is-warn" : "") + '"><td class="c-chk"><input type="checkbox" aria-label="' + LM.esc(l.name || l.fluor) + ' added"></td><td class="c-wide" data-l="DYE"><b>' + LM.esc((l.name || "") + " " + (l.fluor || "")) + '</b></td>' +
            '<td class="c-num" data-l="PER TUBE">' + ul(l.perTest) + '</td><td class="c-num c-add" data-l="TOTAL">' + ul(l.total) + (l.small && l.pre ? '<small>or ' + ul(l.pre.use) + ' of 1:' + LM.fmt(l.pre.d, 3) + '</small>' : "") + '</td>' +
            '<td class="c-num" data-l="IN PBS">' + ul((o.finalVol - l.perTest) * n) + '</td></tr>';
        }).join("") + "</tbody>";
    } else { $("liveBox").hidden = true; $("live").innerHTML = ""; }

    var notes = [];
    res.lines.concat(res.live).filter(function (l) { return l.small; }).forEach(function (l) {
      notes.push('<li class="note"><b>' + LM.esc((l.name || "") + " " + (l.fluor || "")) + '</b>: only ' + ul(l.total) + ' in all, under the ' + F.MIN_UL + ' µL a pipette measures well. ' +
        (l.pre ? 'Predilute 1:' + LM.fmt(l.pre.d, 3) + ' (' + ul(l.pre.make.stock) + ' + ' + ul(l.pre.make.buffer) + ' buffer) and add ' + ul(l.pre.use) + ' of it, taking that much less buffer, ' : "") +
        'or make the cocktail for ' + l.minTubes + ' tubes.</li>');
    });
    if (res.warn.indexOf("needBsb") >= 0) notes.push('<li class="note">' + res.nBrilliant + ' Brilliant polymer dyes (BV, BUV, BB…) in one cocktail can stick to each other. Add Brilliant Stain Buffer (or Plus) and check its volume on the datasheet.</li>');
    if (res.bad.length) notes.push('<li class="note">' + res.bad.length + ' row' + (res.bad.length > 1 ? "s have" : " has") + ' no usable amount' + (res.o.abs.some(function (a) { return a.use === "ug" && !(a.stock > 0); }) ? " (µg per test needs the stock in mg/mL)" : "") + ' and ' + (res.bad.length > 1 ? "are" : "is") + ' left out.</li>');
    if (res.live.length) notes.push('<li class="note info">Fixable viability dyes bind protein: stain with them in protein-free PBS before the antibody cocktail, then wash.</li>');
    if (o.overMode === "pct" && o.over < 5) notes.push('<li class="note info">Less than 5% extra: the last tube may come up short.</li>');
    $("notes").innerHTML = notes.join("");
    $("printHead").textContent = "Staining cocktail" + (st.name ? " · " + st.name : "") + " · " + o.tubes + " tubes · " + new Date().toISOString().slice(0, 10) + " · operator ______  ";
  }

  // ---------------- share link ----------------
  function writeHash() {
    try {
      var s = btoa(unescape(encodeURIComponent(JSON.stringify({ v: 1, st: st })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      writeHash.last = "#c=" + s;
    } catch (e) { writeHash.last = ""; }
  }
  function readHash() {
    var m = location.hash.match(/^#c=([\w-]+)/); if (!m) return false;
    try {
      var o = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, "+").replace(/_/g, "/")))));
      if (o && o.v === 1 && o.st && Array.isArray(o.st.rows)) { st = Object.assign(JSON.parse(JSON.stringify(DEF)), o.st); return true; }
    } catch (e) { /* bad link */ }
    return false;
  }

  // ---------------- library → rows ----------------
  function fromLib(a) {
    var fv = LM.parse(st.finalVol) > 0 ? LM.parse(st.finalVol) : 100;
    var t = a.titer;
    if (t && t.amount > 0) {
      var scale = t.finalVol > 0 ? fv / t.finalVol : 1;
      return row(a.target, a.fluor, t.unit === "ug" ? "ug" : "ul", LM.fmtPlain(t.amount * scale, 4), a.stock > 0 ? LM.fmtPlain(a.stock, 4) : "", /viab|live|dead|zombie|fixable/i.test(a.target + " " + a.fluor));
    }
    if (a.rec > 0) return row(a.target, a.fluor, a.recUnit === "ug" ? "ug" : "ul", LM.fmtPlain(a.rec, 4), a.stock > 0 ? LM.fmtPlain(a.stock, 4) : "");
    return row(a.target, a.fluor, "ul", "", a.stock > 0 ? LM.fmtPlain(a.stock, 4) : "");
  }
  function fillLibSelect() {
    var items = Lib.all();
    $("libAdd").innerHTML = '<option value="">+ FROM MY ANTIBODIES' + (items.length ? "" : " (none saved)") + '</option>' + items.map(function (a) {
      return '<option value="' + LM.esc(a.id) + '">' + LM.esc(Lib.label(a)) + " — " + LM.esc(Lib.titerText(a)) + '</option>';
    }).join("");
  }

  // ---------------- events ----------------
  document.addEventListener("input", function (e) {
    if (e.target.closest("#lib") || e.target.closest("#out") || e.target.closest("#live") || e.target.id === "libAdd") return;
    if (e.target.id === "bsbKind") { var v = BSB[e.target.value]; if (v != null) $("bsb").value = v; }
    read(); compute();
  });
  // re-mark library hints only when a row's identity changes (not on every keystroke)
  // (only the hint and placeholder are touched, so a click on × right after typing still lands)
  $("rows").addEventListener("change", function (e) {
    var k = e.target.getAttribute("data-k"), tr = e.target.closest("tr"); if (!tr) return;
    var r = st.rows[+tr.getAttribute("data-i")]; if (!r) return;
    if (k === "target" || k === "fluor") { var h = hint(r), el = tr.querySelector("[data-hint]"); if (el.innerHTML !== h) el.innerHTML = h; }
    if (k === "use") tr.querySelector("[data-k=stock]").placeholder = r.use === "ug" ? "needed" : "";
  });
  $("rows").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act=rm]"); if (!b) return;
    read(); st.rows.splice(+b.closest("tr").getAttribute("data-i"), 1); renderRows(); compute();
  });
  $("addRow").addEventListener("click", function () { read(); st.rows.push(row()); renderRows(); compute(); var el = $("rt" + (st.rows.length - 1)); if (el) el.focus(); });
  $("libAdd").addEventListener("change", function () {
    var a = Lib.get(this.value); this.value = ""; if (!a) return;
    read(); st.rows = st.rows.filter(function (r) { return r.target || r.fluor || r.value; }); st.rows.push(fromLib(a)); renderRows(); compute();
  });
  ["out", "live"].forEach(function (id) { $(id).addEventListener("change", function (e) { if (e.target.type === "checkbox") e.target.closest("tr").classList.toggle("is-done", e.target.checked); }); });
  $("print").addEventListener("click", function () { window.print(); });
  $("share").addEventListener("click", function () {
    var url = location.origin + location.pathname + (writeHash.last || "");
    LM.copy(url, function (ok) { $("copied").textContent = ok ? "LINK COPIED" : "COPY FAILED"; setTimeout(function () { $("copied").textContent = ""; }, 2500); });
  });
  function csvCell(v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  $("csv").addEventListener("click", function () {
    if (!res || !res.ok) return;
    var L = [["component", "fluor", "uL per tube", "uL total", "ug used"].join(",")];
    if (res.bufferPerTest > 0) L.push(["Staining buffer", "", res.bufferPerTest, res.bufferTotal, ""].map(csvCell).join(","));
    if (res.bsb) L.push(["Brilliant Stain Buffer", "", res.bsb, res.bsb * res.n, ""].map(csvCell).join(","));
    if (res.fc) L.push(["Fc block", "", res.fc, res.fc * res.n, ""].map(csvCell).join(","));
    res.lines.forEach(function (l) { L.push([l.name, l.fluor, l.perTest, l.total, l.ug == null ? "" : l.ug].map(csvCell).join(",")); });
    L.push(["Cocktail", "", res.o.cocktailVol, res.cocktailTotal, ""].map(csvCell).join(","));
    res.live.forEach(function (l) { L.push([l.name + " (viability, in PBS)", l.fluor, l.perTest, l.total, ""].map(csvCell).join(",")); });
    L.push(""); L.push(csvCell($("printHead").textContent.replace(/ · operator.*/, "") + " · " + LM.fmtPlain(res.n, 4) + " tubes with extra · labmate.tools " + F.ALGO));
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + L.join("\r\n")], { type: "text/csv" }));
    a.download = ("cocktail-" + (st.name || "panel")).replace(/[^\w.-]+/g, "-").toLowerCase() + ".csv";
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });
  $("clear").addEventListener("click", function () { st = JSON.parse(JSON.stringify(DEF)); history.replaceState(null, "", location.pathname); fill(); compute(); });

  Lib.mount($("lib"), { pick: "ADD", empty: "Titrate antibodies on the Antibody Titration page and save them.", onPick: function (a) {
    read(); st.rows = st.rows.filter(function (r) { return r.target || r.fluor || r.value; }); st.rows.push(fromLib(a)); renderRows(); compute();
    $("rows").scrollIntoView({ block: "nearest" });
  } });
  Lib.on(function () { fillLibSelect(); renderRows(); });

  // ---------------- start ----------------
  var fromLink = readHash();
  var inbound = window.LMH && window.LMH.take("staining-cocktail");
  if (inbound && Array.isArray(inbound.rows)) {
    var found = 0;
    st.rows = inbound.rows.filter(function (r) { return r.marker || r.fluor; }).map(function (r) {
      var hit = Lib.find(r.marker, r.fluor);
      if (hit) { found++; return fromLib(hit); }
      return row(r.marker, r.fluor, "ul", "", "", /viab|live|dead|zombie/i.test((r.marker || "") + " " + (r.fluor || "")));
    });
    if (!st.rows.length) st.rows.push(row());
    if (inbound.name) st.name = inbound.name;
    setTimeout(function () {
      window.LMH.note("Imported " + st.rows.length + " markers from Panel Designer" + (found ? "; " + found + " with amounts from your antibodies" : "") + ". Fill in the missing amounts.", document.querySelector(".lm-page"));
    }, 0);
  }
  fill(); fillLibSelect(); compute();
  if (fromLink) setTimeout(function () { window.LMH && window.LMH.note("Opened a shared cocktail. Your own last cocktail is replaced here; RESET starts fresh.", document.querySelector(".lm-page")); }, 0);

  if (window.LMT_FLOW_TEST) window.LMT_FLOW_TEST.cocktail = { state: function () { return st; }, result: function () { return res; } };
})();
