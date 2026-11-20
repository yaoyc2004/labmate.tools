/* labmate.tools — 2.6 Cloning Reaction (UI). Maths in cloning-core.js (window.LMC). */
(function () {
  "use strict";
  var C = window.LMC, LM = window.LM;
  var KEY = "labmate.cloning.v1";
  var $ = function (id) { return document.getElementById(id); };
  var esc = LM.esc;
  var fx = C.fx, fx4 = C.fx4;

  function defaults() {
    return {
      system: "gibson", kit: "hifi", totalVol: 20, step: 0.1, bpDa: 650,
      basis: "vector", vectorNg: 50, totalPmol: 0.1,
      reactions: 1, overage: 10,
      frags: [
        { name: "", role: "vector", bp: null, conc: null, unit: "ng/uL", unpure: false, ratio: null },
        { name: "", role: "insert", bp: null, conc: null, unit: "ng/uL", unpure: false, ratio: null }
      ]
    };
  }
  function example() {
    var s = defaults();
    s.frags = [
      { name: "pET backbone", role: "vector", bp: 5200, conc: 50, unit: "ng/uL", unpure: false, ratio: null },
      { name: "GOI insert (PCR)", role: "insert", bp: 1100, conc: 25, unit: "ng/uL", unpure: true, ratio: null }
    ];
    return s;
  }

  var st, res, workRow = 0, isExample = false;
  var saved = LM.load(KEY);
  if (saved && saved.state && Array.isArray(saved.state.frags) && saved.state.frags.length) {
    st = Object.assign(defaults(), saved.state);
  } else {
    st = example(); isExample = true;
  }

  // ---------- static controls ----------
  function segFill(el, items, cur, onPick) {
    el.innerHTML = items.map(function (it) {
      return '<button type="button" data-v="' + it.k + '">' + esc(it.name.toUpperCase()) + "</button>";
    }).join("");
    segBind(el, cur, onPick);
  }
  function segBind(el, cur, onPick) {
    Array.prototype.forEach.call(el.querySelectorAll("button"), function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-v") === cur));
      b.onclick = function () { onPick(b.getAttribute("data-v")); };
    });
  }
  function opts(sel, items, cur) {
    sel.innerHTML = items.map(function (it) {
      return '<option value="' + esc(String(it.k)) + '">' + esc(it.name) + "</option>";
    }).join("");
    sel.value = String(cur);
  }

  function syncControls() {
    segFill($("sysSeg"), C.SYSTEMS, st.system, function (v) {
      if (v === st.system) return;
      st.system = v;
      st.kit = C.KITS[v][0].k;
      if (v === "gg" && st.basis === "vector") st.vectorNg = C.GG_VECTOR_NG;
      if (v !== "gg" && st.vectorNg === C.GG_VECTOR_NG) st.vectorNg = 50;
      syncControls(); go();
    });
    opts($("kit"), C.KITS[st.system], st.kit);
    $("kit").disabled = C.KITS[st.system].length < 2;
    opts($("totalVol"), C.VOLUMES.map(function (v) { return { k: v, name: String(v) }; }), st.totalVol);
    opts($("step"), C.STEPS.map(function (s) { return { k: s.v, name: s.name }; }), st.step);
    segBind($("basisSeg"), st.basis, function (v) { st.basis = v; syncControls(); go(); });
    $("vecBox").hidden = st.basis !== "vector";
    $("totBox").hidden = st.basis !== "total";
    $("vectorNg").value = numStr(st.vectorNg);
    $("totalPmol").value = numStr(st.totalPmol);
    $("reactions").value = numStr(st.reactions);
    $("overage").value = numStr(st.overage);
    $("bpDaSay").textContent = String(st.bpDa);
    $("bpDaBtn").textContent = st.bpDa === 650 ? "USE 660" : "USE 650";
  }
  function numStr(x) { return x == null || isNaN(x) ? "" : LM.fmtPlain(x, 6); }
  // Only touch the DOM when the markup really changed: a re-render between mousedown and
  // mouseup would otherwise swallow a click on a button inside it.
  function setHTML(el, html) { if (el.innerHTML !== html) el.innerHTML = html; }

  // ---------- the fragment table ----------
  function rowHTML(f, i) {
    var roleSel = '<select class="cl-mini-sel" data-f="role" aria-label="Role">' +
      '<option value="vector"' + (f.role === "vector" ? " selected" : "") + ">VECTOR</option>" +
      '<option value="insert"' + (f.role === "insert" ? " selected" : "") + ">INSERT</option></select>";
    var unitSel = '<select class="cl-mini-sel" data-f="unit" aria-label="Concentration unit">' +
      C.UNITS.map(function (u) { return '<option value="' + u.k + '"' + (f.unit === u.k ? " selected" : "") + ">" + u.name + "</option>"; }).join("") + "</select>";
    return '<tr data-i="' + i + '">' +
      '<td data-k="FRAGMENT"><span class="cl-stack"><input type="text" class="pp-in cl-name" data-f="name" maxlength="40" autocomplete="off" spellcheck="false" aria-label="Fragment name" value="' + esc(f.name || "") + '" placeholder="' + (f.role === "vector" ? "vector" : "insert " + (i + 1)) + '">' + roleSel + "</span></td>" +
      '<td class="n" data-k="LENGTH bp"><input type="text" class="pp-in cl-num" data-f="bp" inputmode="numeric" aria-label="Length in bp" value="' + numStr(f.bp) + '"></td>' +
      '<td class="n" data-k="CONC."><span class="cl-stack is-conc"><input type="text" class="pp-in cl-num" data-f="conc" inputmode="decimal" aria-label="Concentration" value="' + numStr(f.conc) + '">' + unitSel + "</span></td>" +
      '<td class="n" data-k="RATIO ×">' + (f.role === "vector" ? '<span class="cl-muted">1</span>' :
        '<input type="text" class="pp-in cl-num cl-ratio" data-f="ratio" inputmode="decimal" aria-label="Insert to vector molar ratio" value="' + numStr(f.ratio) + '">') + "</td>" +
      '<td class="c" data-k="UNPURIFIED PCR"><input type="checkbox" data-f="unpure" aria-label="Unpurified PCR product"' + (f.unpure ? " checked" : "") + "></td>" +
      '<td class="n cl-o cl-out" data-k="pmol/µL" data-o="pmol">—</td>' +
      '<td class="n cl-o cl-out" data-k="nM" data-o="nm">—</td>' +
      '<td class="n cl-out cl-take" data-k="TAKE µL" data-o="vol">—</td>' +
      '<td class="x"><button type="button" class="mm-x" data-act="del" aria-label="Remove fragment ' + (i + 1) + '">×</button></td>' +
      "</tr>";
  }
  function buildRows() {
    $("fragRows").innerHTML = st.frags.map(rowHTML).join("");
  }
  function readRows() {
    st.frags = Array.prototype.map.call($("fragRows").querySelectorAll("tr[data-i]"), function (tr) {
      function val(f) { var el = tr.querySelector('[data-f="' + f + '"]'); return el ? el.value : ""; }
      var ratioEl = tr.querySelector('[data-f="ratio"]');
      var pcr = tr.querySelector('[data-f="unpure"]');
      return {
        name: val("name").trim(),
        role: val("role") === "vector" ? "vector" : "insert",
        bp: LM.parse(val("bp")),
        conc: LM.parse(val("conc")),
        unit: val("unit") === "nM" ? "nM" : "ng/uL",
        ratio: ratioEl ? LM.parse(ratioEl.value) : null,
        unpure: !!(pcr && pcr.checked)
      };
    });
  }

  // ---------- events ----------
  $("fragRows").addEventListener("input", function () { isExample = false; hideExample(); readRows(); go(); });
  $("fragRows").addEventListener("change", function (e) {
    isExample = false; hideExample(); readRows();
    var f = e.target.getAttribute && e.target.getAttribute("data-f");
    if (f === "role" || f === "unit") buildRows();
    go();
  });
  $("fragRows").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest('[data-act="del"]');
    if (!b) {
      var tr = e.target.closest && e.target.closest("tr[data-i]");
      if (tr) { workRow = +tr.getAttribute("data-i"); paintWork(); }
      return;
    }
    var i = +b.closest("tr").getAttribute("data-i");
    readRows();
    st.frags.splice(i, 1);
    if (!st.frags.length) st.frags = defaults().frags;
    isExample = false; hideExample(); buildRows(); go();
  });
  $("addFrag").addEventListener("click", function () {
    readRows();
    st.frags.push({ name: "", role: "insert", bp: null, conc: null, unit: "ng/uL", unpure: false, ratio: null });
    isExample = false; hideExample(); buildRows(); go();
  });
  $("example").addEventListener("click", function () {
    var keep = { system: st.system, kit: st.kit, totalVol: st.totalVol, step: st.step };
    st = Object.assign(example(), keep);
    isExample = true; syncControls(); buildRows(); go();
    $("exampleNote").hidden = false;
  });
  $("kit").addEventListener("change", function () { st.kit = this.value; go(); });
  $("totalVol").addEventListener("change", function () { st.totalVol = LM.parse(this.value); go(); });
  $("step").addEventListener("change", function () { st.step = LM.parse(this.value); go(); });
  $("vectorNg").addEventListener("input", function () { st.vectorNg = LM.parse(this.value); go(); });
  $("totalPmol").addEventListener("input", function () { st.totalPmol = LM.parse(this.value); go(); });
  $("reactions").addEventListener("input", function () { st.reactions = LM.parse(this.value); go(); });
  $("overage").addEventListener("input", function () { st.overage = LM.parse(this.value); go(); });
  $("bpDaBtn").addEventListener("click", function () { st.bpDa = st.bpDa === 650 ? 660 : 650; syncControls(); go(); });
  $("clear").addEventListener("click", function () {
    st = defaults(); isExample = false;
    try { window.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    syncControls(); buildRows(); go(); hideExample();
  });
  $("copy").addEventListener("click", function () {
    LM.copy(recipeText(), function (ok) {
      $("copied").textContent = ok ? "COPIED" : "PRESS ⌘C";
      setTimeout(function () { $("copied").textContent = ""; }, 1800);
    });
  });
  $("print").addEventListener("click", function () { buildSheet(); window.print(); });
  $("pasteGo").addEventListener("click", applyPaste);
  function hideExample() { $("exampleNote").hidden = true; }

  // ---------- paste a list ----------
  function applyPaste() {
    var text = $("pasteIn").value || "";
    var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) { $("pasteMsg").innerHTML = '<span class="bad">Nothing to read.</span>'; return; }
    var out = [], skipped = 0;
    lines.forEach(function (line, idx) {
      var cells = line.split(/\t|;|,(?![0-9]{3}\b)/).map(function (c) { return c.trim(); });
      var nums = [], texts = [];
      cells.forEach(function (c) {
        var v = LM.parse(c.replace(/\s*(bp|kb|ng\/?µ?u?l|nm)\s*$/i, ""));
        if (v != null && !isNaN(v)) nums.push({ v: v, raw: c }); else if (c) texts.push(c);
      });
      if (nums.length < 2) { if (idx > 0 || !/bp|length|conc|name/i.test(line)) skipped++; return; }
      var bp = nums[0].v, conc = nums[1].v;
      if (/kb/i.test(nums[0].raw) && bp < 100) bp = bp * 1000;
      var nM = /nm/i.test(nums[1].raw);
      var name = texts.length ? texts[0] : "";
      var role = /vector|backbone|plasmid/i.test(line) ? "vector" : "insert";
      out.push({ name: name, role: role, bp: bp, conc: conc, unit: nM ? "nM" : "ng/uL", unpure: false, ratio: null });
    });
    if (!out.length) { $("pasteMsg").innerHTML = '<span class="bad">No row had both a length and a concentration.</span>'; return; }
    if (!out.some(function (f) { return f.role === "vector"; })) out[0].role = "vector";
    st.frags = out;
    isExample = false; hideExample(); buildRows(); go();
    $("pasteMsg").textContent = "READ " + out.length + " FRAGMENT" + (out.length > 1 ? "S" : "") + (skipped ? " · SKIPPED " + skipped + " LINE" + (skipped > 1 ? "S" : "") : "");
    $("pasteBox").open = false;
  }

  // ---------- render ----------
  function go() {
    res = C.compute(st);
    paintRows();
    paintRule();
    paintFlags();
    paintAnswer();
    paintMix();
    paintWork();
    LM.save(KEY, { v: 1, state: st });
  }

  function paintRows() {
    var trs = $("fragRows").querySelectorAll("tr[data-i]");
    Array.prototype.forEach.call(trs, function (tr, i) {
      var r = res.rows[i];
      var cell = function (o) { return tr.querySelector('[data-o="' + o + '"]'); };
      tr.classList.toggle("is-vec", r && r.role === "vector");
      if (!r || r.bad) {
        cell("pmol").textContent = "—"; cell("nm").textContent = "—";
        cell("vol").innerHTML = r && r.bad ? '<span class="pp-flag is-err">' + r.bad + "</span>" : "—";
        return;
      }
      cell("pmol").textContent = fx4(r.pmolPerUl);
      cell("nm").textContent = fx(r.nM);
      if (r.vol == null) { cell("vol").textContent = "—"; return; }
      var small = r.vol < C.MIN_VOL;
      cell("vol").innerHTML = '<b>' + fx(r.vol) + "</b>" + (small ? ' <span class="pp-flag">SMALL</span>' : "") +
        '<small>' + fx4(r.gotPmol) + " pmol · " + fx(r.gotNg) + " ng</small>";
      var ri = tr.querySelector('[data-f="ratio"]');
      if (ri && r.ratioAuto != null) ri.placeholder = String(r.ratioAuto);
    });
    var n = res.rows.filter(function (r) { return !r.bad; }).length;
    $("fragCount").textContent = n ? n + " FRAGMENT" + (n > 1 ? "S" : "") + " · " + res.nInsert + " INSERT" + (res.nInsert === 1 ? "" : "S") : "";
  }

  function paintRule() {
    var r = res.rule;
    var bits = [r.source, r.band, "ratio " + r.ratioSay];
    if (r.range) bits.push(r.rangeSay);
    $("ruleSay").textContent = bits.join(" · ");
  }

  function paintFlags() {
    var order = { err: 0, warn: 1, info: 2 };
    var fl = res.flags.slice().sort(function (a, b) { return order[a.kind] - order[b.kind]; });
    setHTML($("flags"), fl.map(function (f) {
      var cls = f.kind === "err" ? "err" : f.kind === "info" ? "info" : "";
      return '<li class="' + cls + '"><b>' + esc(f.k) + "</b>" + esc(f.say) + "</li>";
    }).join(""));
    setHTML($("fixes"), res.fixes.map(function (f, i) {
      return '<li><b>' + esc(f.k) + "</b><span>" + esc(f.say) + "</span>" +
        (f.act ? ' <button type="button" class="lm-link" data-fix="' + i + '">DO IT</button>' : "") + "</li>";
    }).join(""));
    Array.prototype.forEach.call($("fixes").querySelectorAll("[data-fix]"), function (b) {
      b.onclick = function () {
        var act = res.fixes[+b.getAttribute("data-fix")].act;
        if (!act) return;
        if (act.type === "totalVol") st.totalVol = act.vol;
        else if (act.type === "basisTotal") { st.basis = "total"; st.totalPmol = act.pmol; }
        else if (act.type === "vectorNg") { st.basis = "vector"; st.vectorNg = act.ng; }
        syncControls(); go();
      };
    });
  }

  function paintAnswer() {
    var ans = $("ans"), big = $("ansBig"), say = $("ansSay");
    ans.classList.remove("is-empty", "is-error");
    if (!res.ok) {
      var err = res.flags.filter(function (f) { return f.kind === "err"; })[0];
      ans.classList.add(res.rows.every(function (r) { return r.bad; }) ? "is-empty" : "is-error");
      big.textContent = res.rows.every(function (r) { return r.bad; }) ? "Add your fragments" : "Fix the reaction";
      say.textContent = err ? err.say : "Give every fragment a length in bp and a concentration.";
      $("sumLine").textContent = err ? err.k : "";
      return;
    }
    var parts = res.rows.filter(function (r) { return !r.bad; }).map(function (r) {
      return fx(r.vol) + " µL " + (r.name || (r.role === "vector" ? "vector" : "insert"));
    });
    if (res.water > 0.0001) parts.push(fx(res.water) + " µL water");
    res.mix.forEach(function (m) { parts.push(fx(m.vol) + " µL " + shortMix(m)); });
    big.textContent = parts.join("  +  ");
    var ratios = res.rows.filter(function (r) { return !r.bad && r.role === "insert"; }).map(function (r) { return fx(r.ratioGot) + "×"; });
    say.textContent = "Total DNA " + fx4(res.totalPmol) + " pmol (" + fx(res.totalNg) + " ng) in " + res.totalVol +
      " µL. Inserts at " + ratios.join(", ") + " the vector in moles. " + res.incubation.say + ".";
    $("sumLine").textContent = res.totalVol + " µL · " + fx4(res.totalPmol) + " pmol DNA · " + fx(res.water) + " µL water";
  }
  function shortMix(m) {
    if (m.k === "mm") return "master mix";
    if (m.k === "buf") return "10X T4 buffer";
    return m.name.indexOf("Golden Gate") >= 0 ? "Golden Gate mix" : m.name;
  }

  function paintMix() {
    if (!res.ok) { $("mixRows").innerHTML = ""; $("slip").classList.add("is-empty"); $("incub").innerHTML = ""; return; }
    $("slip").classList.remove("is-empty");
    var sc = C.scale(res, st.reactions, st.overage);
    $("nHead").textContent = sc.n > 1 ? "× " + sc.n + (st.overage > 0 ? " + " + fx(st.overage) + "%" : "") + " µL" : "— µL";
    setHTML($("mixRows"), sc.lines.map(function (l) {
      return "<tr" + (l.dna ? ' class="is-dna"' : "") + "><td>" + esc(l.name) + '</td><td class="n">' + fx(l.per) +
        '</td><td class="n">' + (sc.n > 1 ? fx(l.tot) : '<span class="cl-muted">—</span>') + "</td></tr>";
    }).join("") +
      '<tr class="total"><td>Total</td><td class="n">' + fx(sc.perTube) + '</td><td class="n">' + (sc.n > 1 ? fx(sc.total) : '<span class="cl-muted">—</span>') + "</td></tr>");
    $("slipName").textContent = res.rule.source;
    var inc = res.incubation;
    setHTML($("incub"), '<div class="cl-incub-k">INCUBATION</div><div class="cl-incub-b">' +
      inc.steps.map(function (s) { return "<span><b>" + esc(s.t) + "</b>" + esc(s.d) + "</span>"; }).join("") +
      '</div><p class="cs-hint">' + esc(inc.note) + "</p>");
  }

  function paintWork() {
    if (!res.ok) { $("work").innerHTML = ""; return; }
    var good = res.rows.filter(function (r) { return !r.bad; });
    if (!good.length) { $("work").innerHTML = ""; return; }
    var r = res.rows[workRow] && !res.rows[workRow].bad ? res.rows[workRow] : good[0];
    var dl = [
      ["pmol per µL", "(" + fx(r.ngPerUl) + " ng/µL × 1000) ÷ (" + r.bp + " bp × " + res.bpDa + ") = <b>" + fx4(r.pmolPerUl) + " pmol/µL</b>"],
      ["wanted", r.role === "vector" ? fx4(r.wantPmol) + " pmol (" + fx(r.wantNg) + " ng) of vector" :
        fx4(res.vecPmol) + " pmol vector × " + fx(r.ratio) + " = <b>" + fx4(r.wantPmol) + " pmol</b> (" + fx(r.wantNg) + " ng)"],
      ["volume", fx4(r.wantPmol) + " ÷ " + fx4(r.pmolPerUl) + " = " + fx(r.volRaw) + " µL, rounded to <b>" + fx(r.vol) + " µL</b>"],
      ["that gives", fx4(r.gotPmol) + " pmol · " + fx(r.gotNg) + " ng · " + fx(r.ratioGot) + "× the vector"]
    ];
    setHTML($("work"), '<div class="dt-work-h"><span>WORKING</span><b>' + esc(C.nameOf(r)) + "</b>" +
      '<span class="dt-work-note">' + r.bp + " bp · tap another row to switch</span></div>" +
      '<dl class="dt-dl">' + dl.map(function (d) { return "<dt>" + d[0] + "</dt><dd>" + d[1] + "</dd>"; }).join("") + "</dl>");
  }

  // ---------- copy & print ----------
  function recipeText() {
    if (!res.ok) return "";
    var sc = C.scale(res, st.reactions, st.overage);
    var out = ["Cloning reaction — " + res.rule.source + " · " + res.totalVol + " µL"];
    out.push("");
    sc.lines.forEach(function (l) {
      out.push(pad(l.name, 42) + rpad(fx(l.per) + " µL", 10) + (sc.n > 1 ? fx(l.tot) + " µL" : ""));
    });
    out.push(pad("TOTAL", 42) + rpad(fx(sc.perTube) + " µL", 10) + (sc.n > 1 ? fx(sc.total) + " µL" : ""));
    out.push("");
    out.push("Total DNA " + fx4(res.totalPmol) + " pmol (" + fx(res.totalNg) + " ng). " +
      res.rows.filter(function (r) { return !r.bad && r.role === "insert"; }).map(function (r) {
        return C.nameOf(r) + " at " + fx(r.ratioGot) + "× the vector";
      }).join("; ") + ".");
    out.push("Incubation: " + res.incubation.say + ". " + res.incubation.note);
    if (sc.n > 1) out.push("Master mix for " + sc.n + " reactions" + (st.overage > 0 ? " plus " + fx(st.overage) + "% overage" : "") + ".");
    res.flags.forEach(function (f) { out.push("[" + f.k + "] " + f.say); });
    out.push("");
    out.push("labmate.tools/tools/cloning/ · " + C.ALGO);
    return out.join("\n");
  }
  function pad(s, n) { s = String(s); while (s.length < n) s += " "; return s; }
  function rpad(s, n) { s = String(s); while (s.length < n) s += " "; return s; }

  function buildSheet() {
    if (!res.ok) { $("sheet").innerHTML = ""; return; }
    var sc = C.scale(res, st.reactions, st.overage);
    var head = '<div class="cl-sh-head"><div class="cl-sh-title">CLONING REACTION</div>' +
      f("SYSTEM", res.rule.source) + f("REACTION", res.totalVol + " µL") +
      f("REACTIONS", String(sc.n) + (st.overage > 0 ? " +" + fx(st.overage) + "%" : "")) +
      f("TOTAL DNA", fx4(res.totalPmol) + " pmol") + f("DATE", "") + "</div>";
    var rows = sc.lines.map(function (l) {
      return "<tr><td>" + esc(l.name) + '</td><td class="n v">' + fx(l.per) + '</td><td class="n">' + (sc.n > 1 ? fx(l.tot) : "") + '</td><td class="c"><i></i></td></tr>';
    }).join("");
    var tab = '<table class="cl-sh-t"><thead><tr><th>COMPONENT</th><th class="n">1 RXN µL</th><th class="n">' +
      (sc.n > 1 ? "× " + sc.n : "") + '</th><th class="c">✓</th></tr></thead><tbody>' + rows +
      '<tr><th>TOTAL</th><th class="n">' + fx(sc.perTube) + '</th><th class="n">' + (sc.n > 1 ? fx(sc.total) : "") + '</th><th class="c"></th></tr></tbody></table>';
    var frag = '<table class="cl-sh-t"><thead><tr><th>FRAGMENT</th><th class="n">bp</th><th class="n">ng/µL</th><th class="n">µL</th><th class="n">pmol</th><th class="n">× VECTOR</th></tr></thead><tbody>' +
      res.rows.filter(function (r) { return !r.bad; }).map(function (r) {
        return "<tr><td>" + esc(C.nameOf(r)) + (r.role === "vector" ? " (vector)" : "") + '</td><td class="n">' + r.bp +
          '</td><td class="n">' + fx(r.ngPerUl) + '</td><td class="n">' + fx(r.vol) + '</td><td class="n">' + fx4(r.gotPmol) +
          '</td><td class="n">' + fx(r.ratioGot) + "</td></tr>";
      }).join("") + "</tbody></table>";
    var inc = '<div class="cl-sh-rec"><b>INCUBATION</b> ' + esc(res.incubation.say) + ". " + esc(res.incubation.note) + "</div>";
    var warn = res.flags.length ? '<div class="cl-sh-rec"><b>CHECKS</b> ' + res.flags.map(function (x) { return esc(x.k + ": " + x.say); }).join(" ") + "</div>" : "";
    var sign = '<div class="cl-sign"><span>PREPARED BY / DATE</span><span>CHECKED BY</span><span>TUBE ID</span></div>';
    $("sheet").innerHTML = head + '<p class="cl-sh-par">Set up on ice. ' +
      (st.system === "lig" ? "Add the ligase last." : st.system === "gg" ? "Add the enzyme mix last." : "Add the master mix last.") +
      " Volumes are rounded to " + fx(res.step) + " µL.</p>" + tab + frag + inc + warn + sign +
      '<div class="cl-sh-foot">labmate.tools/tools/cloning/ · ' + C.ALGO +
      " · a calculator, not a protocol: the vendor's current protocol takes precedence.</div>";
    function f(k, v) { return '<div class="cl-f"><span>' + k + "</span><b>" + esc(v) + "</b></div>"; }
  }

  // ---------- start ----------
  syncControls();
  buildRows();
  go();
  if (isExample) $("exampleNote").hidden = false;
})();
