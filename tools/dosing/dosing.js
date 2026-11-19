/* labmate.tools — 9.1 Rodent Dosing Sheet (UI). Maths in dosing-core.js (window.LMD). */
(function () {
  "use strict";
  var D = window.LMD, LM = window.LM;
  var KEY = "labmate.dosing.v1";
  var $ = function (id) { return document.getElementById(id); };
  var esc = LM.esc;

  var EXAMPLE = "ID\tCage\tGroup\tWeight (g)\n" +
    "M01\tC1\tTamoxifen\t24.6\nM02\tC1\tTamoxifen\t25.0\nM03\tC1\tTamoxifen\t22.8\nM04\tC1\tTamoxifen\t26.3\nM05\tC1\tTamoxifen\t23.9\n" +
    "M06\tC2\tVehicle\t24.1\nM07\tC2\tVehicle\t21.7\nM08\tC2\tVehicle\t25.5\nM09\tC2\tVehicle\t23.2\nM10\tC2\tVehicle\t27.4";

  function defaults() {
    return {
      species: "mouse", route: "ip", limitSet: "diehl", custom: {},
      mode: "conc", doseUnit: "mgkg", groups: {}, volKg: 10,
      syringe: "tb1", step: 0.01, cap: 1,
      vehicleKey: "corn", vehicle: [["Corn oil", 100]],
      stock: { on: false, conc: null, solvent: 0 },
      days: 1, perDay: 1, overage: 20, dead: 0, salt: 1, purity: 100,
      fields: { study: "", proto: "", drug: "", date: "", op: "" }, pageEach: false
    };
  }
  function exampleState() {
    var s = defaults();
    s.groups = { "Tamoxifen": { dose: 75, conc: 20 }, "Vehicle": { dose: 0, conc: null } };
    s.days = 5;
    s.fields = { study: "Cre induction", proto: "", drug: "Tamoxifen", date: "", op: "" };
    return s;
  }

  var st, animalsText, parsed, res, workRow = 0;
  var saved = LM.load(KEY);
  if (saved && saved.state) { st = Object.assign(defaults(), saved.state); animalsText = ""; }
  else { st = exampleState(); animalsText = EXAMPLE; $("exampleNote").hidden = false; }

  // ---------- build static controls ----------
  function segFill(el, items, cur, onPick) {
    el.innerHTML = items.map(function (it) { return '<button type="button" data-v="' + it.k + '">' + esc(it.name.toUpperCase()) + "</button>"; }).join("");
    segBind(el, cur, onPick);
  }
  function segBind(el, cur, onPick) {
    Array.prototype.forEach.call(el.querySelectorAll("button"), function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-v") === cur));
      b.onclick = function () { onPick(b.getAttribute("data-v")); };
    });
  }
  function opts(sel, items, cur) {
    sel.innerHTML = items.map(function (it) { return '<option value="' + it.k + '">' + esc(it.name) + "</option>"; }).join("");
    sel.value = cur;
  }

  function syncControls() {
    segFill($("spSeg"), D.SPECIES.map(function (s) { return { k: s.k, name: s.k === "other" ? "Other" : s.name }; }), st.species, function (v) { st.species = v; if (v === "other") st.limitSet = "custom"; ensureCustom(); go(); });
    opts($("route"), D.ROUTES, st.route);
    segBind($("modeSeg"), st.mode, function (v) { st.mode = v; go(); });
    segFill($("limSeg"), D.LIMIT_SETS.map(function (l) { return { k: l.k, name: l.name }; }), st.limitSet, function (v) {
      if (st.species === "other" && v !== "custom") return;
      st.limitSet = v; ensureCustom(); go(); if (v === "custom") $("limBox").open = true;
    });
    opts($("syringe"), D.SYRINGES, st.syringe);
    opts($("vehicle"), D.VEHICLES, st.vehicleKey);
    $("doseUnit").value = st.doseUnit;
    $("volKg").value = numStr(st.volKg);
    $("step").value = numStr(st.step); $("cap").value = numStr(st.cap);
    ["days", "perDay", "overage", "dead", "salt", "purity"].forEach(function (k) { $(k).value = numStr(st[k]); });
    $("stockOn").checked = !!st.stock.on;
    $("stockConc").value = numStr(st.stock.conc);
    $("fStudy").value = st.fields.study || ""; $("fProto").value = st.fields.proto || "";
    $("fDrug").value = st.fields.drug || ""; $("fDate").value = st.fields.date || ""; $("fOp").value = st.fields.op || "";
    $("pageEach").checked = !!st.pageEach;
    $("animals").value = animalsText;
  }
  function numStr(x) { return x == null || isNaN(x) ? "" : LM.fmtPlain(x, 6); }
  function ensureCustom() {
    if (!st.custom[st.species]) st.custom[st.species] = D.copyLimits(st.species === "other" ? "mouse" : st.species);
  }

  // ---------- events ----------
  $("animals").addEventListener("input", function () { animalsText = this.value; $("exampleNote").hidden = true; go(); });
  $("route").addEventListener("change", function () { st.route = this.value; go(); });
  $("doseUnit").addEventListener("change", function () { st.doseUnit = this.value; go(); });
  $("volKg").addEventListener("input", function () { st.volKg = LM.parse(this.value); go(); });
  $("syringe").addEventListener("change", function () {
    st.syringe = this.value;
    var s = D.SYRINGES.filter(function (x) { return x.k === st.syringe; })[0];
    if (s && s.step) { st.step = s.step; st.cap = s.cap; $("step").value = numStr(s.step); $("cap").value = numStr(s.cap); }
    go();
  });
  $("step").addEventListener("input", function () { st.step = LM.parse(this.value); st.syringe = "custom"; $("syringe").value = "custom"; go(); });
  $("cap").addEventListener("input", function () { st.cap = LM.parse(this.value); st.syringe = "custom"; $("syringe").value = "custom"; go(); });
  ["days", "perDay", "overage", "dead", "salt", "purity"].forEach(function (k) {
    $(k).addEventListener("input", function () { st[k] = LM.parse(this.value); go(); });
  });
  $("vehicle").addEventListener("change", function () {
    st.vehicleKey = this.value;
    var v = D.VEHICLES.filter(function (x) { return x.k === st.vehicleKey; })[0];
    if (v && v.parts) st.vehicle = v.parts.map(function (p) { return [p[0], p[1]]; });
    st.stock.solvent = 0;
    go();
  });
  $("vehAdd").addEventListener("click", function () { st.vehicle.push(["", 0]); st.vehicleKey = "custom"; go(); setTimeout(function () { var ins = document.querySelectorAll("#vehRows input.ds-vname"); if (ins.length) ins[ins.length - 1].focus(); }, 0); });
  $("stockOn").addEventListener("change", function () { st.stock.on = this.checked; go(); });
  $("stockConc").addEventListener("input", function () { st.stock.conc = LM.parse(this.value); go(); });
  $("stockSolv").addEventListener("change", function () { st.stock.solvent = parseInt(this.value, 10); go(); });
  [["fStudy", "study"], ["fProto", "proto"], ["fDrug", "drug"], ["fDate", "date"], ["fOp", "op"]].forEach(function (p) {
    $(p[0]).addEventListener("input", function () { st.fields[p[1]] = this.value; renderSheet(); renderPreps(); persist(); });
  });
  $("pageEach").addEventListener("change", function () { st.pageEach = this.checked; renderSheet(); persist(); });
  $("example").addEventListener("click", function () { st = exampleState(); animalsText = EXAMPLE; $("exampleNote").hidden = false; syncControls(); go(); });
  $("clear").addEventListener("click", function () {
    var keep = st.custom;
    st = defaults(); st.custom = keep; animalsText = ""; $("exampleNote").hidden = true; syncControls(); go();
  });
  $("fileIn").addEventListener("change", function () {
    var f = this.files && this.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () { animalsText = String(rd.result || ""); $("animals").value = animalsText; $("exampleNote").hidden = true; go(); };
    rd.readAsText(f);
    this.value = "";
  });

  // ---------- main ----------
  function stateForCore() {
    var groups = parsedGroupNames().map(function (n) {
      var g = st.groups[n] || {};
      return { name: n, dose: g.dose, conc: g.conc };
    });
    return {
      species: st.species, route: st.route, limitSet: st.species === "other" ? "custom" : st.limitSet, custom: st.custom,
      mode: st.mode, doseUnit: st.doseUnit, groups: groups, volKg: st.volKg,
      step: st.step, cap: st.cap, overage: st.overage, dead: st.dead, days: st.days, perDay: st.perDay,
      salt: st.salt, purity: st.purity, stock: st.stock, vehicle: st.vehicle
    };
  }
  function parsedGroupNames() {
    var out = [];
    (parsed ? parsed.rows : []).forEach(function (a) { if (out.indexOf(a.group) < 0) out.push(a.group); });
    return out;
  }

  function go() {
    if (st.species === "other") { st.limitSet = "custom"; ensureCustom(); }
    if (st.limitSet === "custom") ensureCustom();
    parsed = D.parseAnimals(animalsText);
    parsedGroupNames().forEach(function (n) { if (!st.groups[n]) st.groups[n] = { dose: null, conc: null }; });
    res = D.compute(stateForCore(), parsed.rows);
    renderParse(); renderDose(); renderLimits(); renderVehicle(); renderResults(); renderPreps(); renderWork(); renderSheet();
    persist();
  }

  function persist() {
    var copy = JSON.parse(JSON.stringify(st));
    LM.save(KEY, { state: copy });
  }

  // ---------- render: parse ----------
  function renderParse() {
    var m = $("parseMsg"), rows = parsed.rows;
    if (!rows.length) { m.innerHTML = animalsText.trim() ? '<span class="bad">' + esc(parsed.msg.join(" ") || "Nothing read.") + "</span>" : ""; return; }
    var ok = rows.filter(function (r) { return r.w > 0; }).length;
    var parts = [rows.length + " animal" + (rows.length === 1 ? "" : "s") + " read" + (parsed.header ? " (header row found)" : "")];
    if (ok < rows.length) parts.push((rows.length - ok) + " without a usable weight");
    var html = "<span>" + esc(parts.join(" · ")) + "</span>";
    var ws = rows.filter(function (r) { return r.w > 0; }).map(function (r) { return r.w; });
    if (ws.length && Math.max.apply(null, ws) < 1.5 && st.species !== "other") {
      html += '<span class="bad">All weights are under 1.5 — were they typed in kg? <button type="button" class="lm-link" id="toGrams">TREAT AS kg</button></span>';
    }
    m.innerHTML = html;
    var b = $("toGrams");
    if (b) b.onclick = function () {
      var lines = animalsText.replace(/\r\n?/g, "\n").split("\n");
      var col = parsed.cols.w, hdr = parsed.header, sep = /\t/.test(animalsText) ? "\t" : (/;/.test(animalsText) ? ";" : (/,/.test(animalsText) ? "," : null));
      var di = 0;
      animalsText = lines.map(function (l, i) {
        if (!l.trim()) return l;
        if (hdr && di++ === 0) return l;
        if (!hdr) di++;
        var cs = sep ? l.split(sep) : l.trim().split(/\s+/);
        var v = LM.parse(String(cs[col] || "").replace(/\s*k?g\s*$/i, ""));
        if (v > 0) cs[col] = LM.fmtPlain(v * 1000, 6);
        return cs.join(sep || " ");
      }).join("\n");
      $("animals").value = animalsText; go();
    };
  }

  // ---------- render: dose ----------
  function renderDose() {
    segBind($("spSeg"), st.species, function (v) { st.species = v; if (v === "other") st.limitSet = "custom"; ensureCustom(); go(); });
    segBind($("modeSeg"), st.mode, function (v) { st.mode = v; go(); });
    segBind($("limSeg"), st.limitSet, function (v) {
      if (st.species === "other" && v !== "custom") return;
      st.limitSet = v; ensureCustom(); go(); if (v === "custom") $("limBox").open = true;
    });
    Array.prototype.forEach.call($("limSeg").querySelectorAll("button"), function (b) { b.disabled = st.species === "other" && b.getAttribute("data-v") !== "custom"; });
    $("volKgBox").hidden = st.mode !== "vol";
    $("concHead").textContent = st.mode === "vol" ? "MAKE mg/mL" : "CONC. mg/mL";
    $("synCustom").hidden = st.syringe !== "custom";
    var names = parsedGroupNames();
    $("groupCount").textContent = names.length ? names.length + (names.length === 1 ? " group" : " groups") : "";
    var tb = $("groupRows");
    var focusId = document.activeElement && document.activeElement.getAttribute("data-g") != null ? document.activeElement.id : null;
    if (!names.length) { tb.innerHTML = '<tr><td colspan="5" class="pp-empty">Paste animals in step 1</td></tr>'; return; }
    tb.innerHTML = names.map(function (n, i) {
      var g = st.groups[n] || {}, cg = res.groups[i] || {};
      var count = parsed.rows.filter(function (a) { return a.group === n; }).length;
      var concCell = st.mode === "vol"
        ? '<td class="n"><b>' + (cg.conc != null ? LM.fmt(cg.conc, 4) : "—") + "</b></td>"
        : (g.dose === 0 ? '<td class="n ds-vehcell">vehicle only</td>'
          : '<td class="n"><input type="text" class="pp-in ds-num" id="gc' + i + '" data-g="' + i + '" data-k="conc" inputmode="decimal" value="' + esc(numStr(g.conc)) + '" aria-label="Concentration for ' + esc(n || "all animals") + '"></td>');
      return "<tr><td>" + (n ? esc(n) : '<span class="ds-muted">All animals</span>') + '</td><td class="n">' + count + "</td>" +
        '<td class="n"><input type="text" class="pp-in ds-num" id="gd' + i + '" data-g="' + i + '" data-k="dose" inputmode="decimal" value="' + esc(numStr(g.dose)) + '" aria-label="Dose for ' + esc(n || "all animals") + '"></td>' +
        concCell + '<td class="n">' + (cg.rate != null ? LM.fmt(cg.rate, 3) : "—") + "</td></tr>";
    }).join("");
    Array.prototype.forEach.call(tb.querySelectorAll("input"), function (inp) {
      inp.addEventListener("input", function () {
        var n = names[+inp.getAttribute("data-g")];
        st.groups[n] = st.groups[n] || {};
        st.groups[n][inp.getAttribute("data-k")] = LM.parse(inp.value);
        var pos = inp.selectionStart;
        go();
        var again = $(inp.id); if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } }
      });
    });
    if (focusId && $(focusId)) $(focusId).focus();
  }

  // ---------- render: limits ----------
  function renderLimits() {
    var set = D.LIMIT_SETS.filter(function (l) { return l.k === (st.species === "other" ? "custom" : st.limitSet); })[0];
    var custom = set.k === "custom";
    var lim = res.limit;
    $("limSay").textContent = lim ? (D.ROUTES.filter(function (r) { return r.k === st.route; })[0].short + ": " + limText(lim) + " · " + set.name) : "none set for this route";
    $("limRows").innerHTML = D.ROUTES.map(function (r) {
      var l = D.limitFor(set.k, st.species, r.k, st.custom) || { good: null, max: null, unit: r.k === "im" ? "site" : "kg" };
      var cur = r.k === st.route ? ' class="is-cur"' : "";
      if (custom) {
        return "<tr" + cur + "><td>" + esc(r.name) + '</td><td class="n"><input type="text" class="pp-in ds-num" data-r="' + r.k + '" data-k="good" inputmode="decimal" value="' + esc(numStr(l.good)) + '" aria-label="Good practice, ' + esc(r.name) + '"></td>' +
          '<td class="n"><input type="text" class="pp-in ds-num" data-r="' + r.k + '" data-k="max" inputmode="decimal" value="' + esc(numStr(l.max)) + '" aria-label="Maximum, ' + esc(r.name) + '"></td>' +
          '<td><select class="ds-mini-sel" data-r="' + r.k + '" aria-label="Unit, ' + esc(r.name) + '"><option value="kg"' + (l.unit === "kg" ? " selected" : "") + '>mL/kg</option><option value="site"' + (l.unit === "site" ? " selected" : "") + ">mL/site</option></select></td></tr>";
      }
      return "<tr" + cur + "><td>" + esc(r.name) + '</td><td class="n">' + (l.good != null ? l.good : "—") + '</td><td class="n">' + (l.max != null ? l.max : "—") + "</td><td>" + (l.unit === "site" ? "mL/site" : "mL/kg") + "</td></tr>";
    }).join("");
    $("limNote").textContent = custom
      ? "Type your institution's values. Leave a cell empty for no limit. Kept in this browser and printed on the sheet."
      : set.long + ". Above good practice is marked amber, above the maximum red.";
    if (custom) {
      Array.prototype.forEach.call($("limRows").querySelectorAll("input,select"), function (el) {
        el.addEventListener(el.tagName === "SELECT" ? "change" : "change", function () {
          var c = st.custom[st.species][el.getAttribute("data-r")];
          if (el.tagName === "SELECT") c.unit = el.value;
          else { var v = LM.parse(el.value); c[el.getAttribute("data-k")] = v > 0 ? v : null; }
          go();
        });
      });
    }
  }
  function limText(l) {
    var u = l.unit === "site" ? " mL/site" : " mL/kg";
    if (l.good != null && l.max != null && l.good !== l.max) return l.good + " (max " + l.max + ")" + u;
    if (l.max != null) return "max " + l.max + u;
    if (l.good != null) return l.good + u;
    return "no limit";
  }

  // ---------- render: vehicle ----------
  function renderVehicle() {
    var tb = $("vehRows");
    var focus = document.activeElement && document.activeElement.closest && document.activeElement.closest("#vehRows") ? document.activeElement.id : null;
    tb.innerHTML = st.vehicle.map(function (p, i) {
      return '<tr><td><input type="text" class="pp-in ds-vname" id="vn' + i + '" data-i="' + i + '" value="' + esc(p[0]) + '" aria-label="Component ' + (i + 1) + '"></td>' +
        '<td class="n"><input type="text" class="pp-in ds-num" id="vp' + i + '" data-i="' + i + '" inputmode="decimal" value="' + esc(numStr(p[1])) + '" aria-label="Percent of component ' + (i + 1) + '"></td>' +
        '<td class="x"><button type="button" class="c-x" data-i="' + i + '" aria-label="Remove component ' + (i + 1) + '">×</button></td></tr>';
    }).join("");
    Array.prototype.forEach.call(tb.querySelectorAll("input"), function (inp) {
      inp.addEventListener("input", function () {
        var i = +inp.getAttribute("data-i");
        if (inp.classList.contains("ds-vname")) st.vehicle[i][0] = inp.value; else st.vehicle[i][1] = LM.parse(inp.value);
        st.vehicleKey = "custom"; $("vehicle").value = "custom";
        var id = inp.id, pos = inp.selectionStart;
        go();
        var again = $(id); if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } }
      });
    });
    Array.prototype.forEach.call(tb.querySelectorAll(".c-x"), function (b) {
      b.addEventListener("click", function () {
        st.vehicle.splice(+b.getAttribute("data-i"), 1);
        if (st.stock.solvent >= st.vehicle.length) st.stock.solvent = 0;
        st.vehicleKey = "custom"; $("vehicle").value = "custom"; go();
      });
    });
    if (focus && $(focus)) $(focus).focus();
    var sum = st.vehicle.reduce(function (s, p) { return s + (p[1] > 0 ? p[1] : 0); }, 0);
    var sumEl = $("vehSum");
    sumEl.textContent = "TOTAL " + LM.fmt(sum, 4) + "%";
    sumEl.classList.toggle("is-bad", Math.abs(sum - 100) > 0.01);
    $("stockBox").hidden = !st.stock.on;
    var so = st.vehicle.map(function (p, i) { return '<option value="' + i + '">' + esc(p[0] || "component " + (i + 1)) + "</option>"; }).join("") + '<option value="-1">Something not in the vehicle</option>';
    $("stockSolv").innerHTML = so;
    $("stockSolv").value = String(st.stock.solvent);
  }

  // ---------- render: results ----------
  var LEVEL_CLASS = { err: "is-err", warn: "is-warn", info: "is-info", ok: "" };
  function renderResults() {
    var rows = res.animals;
    var gBy = {};
    res.groups.forEach(function (g) { gBy[g.name] = g; });
    var tb = $("resRows");
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="9" class="pp-empty">No animals yet</td></tr>';
      $("sumLine").textContent = "";
    } else {
      tb.innerHTML = rows.map(function (r) {
        var g = gBy[r.group];
        var flags = r.flags.map(function (f) { return '<span class="pp-flag ' + LEVEL_CLASS[f.level] + '" title="' + esc(f.say) + '">' + esc(f.code) + "</span>"; }).join(" ");
        if (!flags && r.vol != null) flags = '<span class="dt-ok">OK</span>';
        if (!flags && g && g.problem) flags = '<span class="ds-muted">' + esc(g.problem) + "</span>";
        return '<tr data-i="' + r.i + '" class="' + (r.level === "err" ? "is-err" : r.level === "warn" ? "is-warn" : "") + (r.i === workRow ? " is-sel" : "") + '">' +
          '<td class="ds-id" data-l="ID">' + esc(r.id) + '</td><td class="ds-o" data-l="CAGE">' + esc(r.cage) + '</td><td class="ds-o" data-l="GROUP">' + esc(r.group) + "</td>" +
          '<td class="n" data-l="WEIGHT g">' + (r.w > 0 ? LM.fmt(r.w, 4) : "—") + '</td><td class="n ds-o" data-l="DOSE mg">' + (r.mg != null ? LM.fmt(r.mg, 3) : "—") + "</td>" +
          '<td class="n ds-o" data-l="EXACT mL">' + (r.exact != null ? LM.fmt(r.exact, 3) : "—") + '</td><td class="n ds-give" data-l="GIVE mL">' + (r.vol != null ? volStr(r.vol) : "—") + "</td>" +
          '<td class="n ds-o" data-l="mL/kg">' + (r.mlkg != null ? LM.fmt(r.mlkg, 3) : "—") + '</td><td class="ds-ck">' + flags + (r.dev && Math.abs(r.dev) >= 0.0005 ? ' <span class="ds-dev">' + D.pct(r.dev) + "</span>" : "") + "</td></tr>";
      }).join("");
      Array.prototype.forEach.call(tb.querySelectorAll("tr[data-i]"), function (tr) {
        tr.addEventListener("click", function () { workRow = +tr.getAttribute("data-i"); renderResults(); renderWork(); });
      });
      var ok = rows.filter(function (r) { return r.vol != null; }).length;
      var nErr = rows.filter(function (r) { return r.level === "err"; }).length, nWarn = rows.filter(function (r) { return r.level === "warn"; }).length;
      $("sumLine").textContent = ok + " OF " + rows.length + " ANIMALS" + (nErr ? " · " + nErr + " RED" : "") + (nWarn ? " · " + nWarn + " AMBER" : "");
    }
    // batch-level warnings
    var w = [];
    res.errors.forEach(function (e) { w.push({ level: "err", code: "VEHICLE", say: e }); });
    res.notes.forEach(function (n) { w.push(n); });
    res.groups.forEach(function (g) {
      var label = g.name ? "Group " + g.name + ": " : "";
      if (g.problem && g.n) w.push({ level: "warn", code: "DOSE", say: label + g.problem });
      if (g.flags["ABOVE MAX"] || g.flags["ABOVE GOOD PRACTICE"]) {
        var lim = res.limit;
        if (lim && lim.unit === "kg" && g.dose > 0) {
          var target = lim.good || lim.max;
          var cmin = g.dose / target;
          w.push({ level: g.flags["ABOVE MAX"] ? "err" : "warn", code: "VOLUME", say: label + "every animal gets " + LM.fmt(g.rate, 3) + " mL/kg. A working solution of at least " + LM.fmt(cmin, 3) + " mg/mL keeps it at " + target + " mL/kg" + (st.mode === "vol" ? " — lower the mL/kg." : ".") });
        } else if (lim && lim.unit === "kg" && g.vehicleOnly) {
          w.push({ level: "warn", code: "VOLUME", say: label + LM.fmt(g.rate, 3) + " mL/kg is above the limit for this route." });
        }
      }
      if ((g.flags["TOO SMALL"] || g.flags["ROUNDING"]) && g.conc > 0) {
        var small = res.animals.filter(function (r) { return r.group === g.name && r.vol != null; }).reduce(function (m, r) { return Math.min(m, r.exact); }, Infinity);
        var tenSteps = 10 * (st.step || 0.01);
        var dil = g.conc * small / tenSteps;
        w.push({ level: "warn", code: g.flags["TOO SMALL"] ? "TOO SMALL" : "ROUNDING", say: label + "the smallest dose is " + LM.fmt(small * 1000, 3) + " µL. Use a finer syringe, or dilute to " + LM.fmt(dil, 3) + " mg/mL so it fills at least 10 graduations." });
      }
    });
    var hasSplit = res.animals.some(function (r) { return r.flags.some(function (f) { return f.code === "SPLIT SITES"; }); });
    if (hasSplit) w.push({ level: "info", code: "SC SITES", say: "Diehl 2001: no more than 2–3 SC sites per day." });
    if (st.route === "im") w.push({ level: "info", code: "IM", say: "Diehl 2001: no more than 2 IM sites per day." });
    if ((st.days > 1 || st.perDay > 1) && res.animals.length) w.push({ level: "info", code: "RE-WEIGH", say: "Weigh again on each dosing day and print a new sheet — the recipe uses today's weights plus " + LM.fmt(st.overage || 0, 3) + "% overage." });
    $("warnings").innerHTML = w.map(function (x) { return '<li class="' + (x.level === "info" ? "info" : x.level === "err" ? "err" : "") + '"><b>' + esc(x.code) + "</b>" + esc(x.say) + "</li>"; }).join("");
  }
  function volStr(mL) {
    return D.volFix(mL, st.step) + (mL < 1 ? ' <small>' + LM.fmt(mL * 1000, 4) + " µL</small>" : "");
  }
  function mlStr(mL) { return mL < 1 ? LM.fmt(mL * 1000, 3) + " µL" : LM.fmt(mL, 3) + " mL"; }
  function mgStr(mg) { return mg < 1 ? LM.fmt(mg * 1000, 3) + " µg" : (mg >= 1000 ? LM.fmt(mg / 1000, 4) + " g" : LM.fmt(mg, 3) + " mg"); }

  // ---------- render: preparation ----------
  function recipeLines(g) {
    var rec = g.recipe, out = [];
    if (!rec) return out;
    if (rec.error) return [{ err: rec.error }];
    rec.steps.forEach(function (s) {
      if (s.kind === "weigh") out.push({ k: "WEIGH", v: mgStr(s.mg), say: (st.fields.drug || "drug") + (st.salt > 1 || st.purity < 100 ? " (corrected for salt/purity)" : "") });
      else if (s.kind === "stock") out.push({ k: "STOCK", v: mlStr(s.vol), say: LM.fmt(rec.stock.conc, 4) + " mg/mL in " + rec.stock.solvent + " (contains " + mgStr(rec.stock.mg) + ")" });
      else out.push({ k: "ADD", v: mlStr(s.vol), say: s.name + (s.topUp ? " (to make up " + s.pct + "% with the stock)" : " (" + s.pct + "%)") });
    });
    return out;
  }
  function renderPreps() {
    var el = $("preps");
    var gs = res.groups.filter(function (g) { return g.recipe; });
    if (!gs.length) { el.innerHTML = ""; return; }
    el.innerHTML = gs.map(function (g) {
      var head = (g.name ? esc(g.name) : "All animals") + " · " + (g.vehicleOnly ? "vehicle only" : LM.fmt(g.conc, 4) + " mg/mL");
      var lines = recipeLines(g);
      var body = lines.map(function (l) {
        if (l.err) return '<li class="ds-rec-err">' + esc(l.err) + "</li>";
        return '<li><span class="k">' + l.k + '</span><span class="ds-say">' + esc(l.say) + '</span><span class="lead"></span><span class="v">' + esc(l.v) + "</span></li>";
      }).join("");
      var makes = '<li class="total"><span class="k">MAKES</span><span class="ds-say">' + g.nOk + " animal" + (g.nOk === 1 ? "" : "s") + " × " + g.doses + " dose" + (g.doses === 1 ? "" : "s") + " + " + LM.fmt(st.overage || 0, 3) + "%" + (st.dead > 0 ? " + dead volume" : "") + '</span><span class="lead"></span><span class="v">' + mlStr(g.prep) + "</span></li>";
      return '<section class="slip ds-slip"><div class="slip-title"><span>PREPARE · ' + head + "</span><span>" + mlStr(g.sumV) + " per dose</span></div><ol>" + body + makes + "</ol></section>";
    }).join("");
  }

  // ---------- render: working ----------
  function renderWork() {
    var el = $("work");
    var r = res.animals[workRow] || res.animals.filter(function (x) { return x.vol != null; })[0];
    if (!r || r.vol == null) { el.innerHTML = ""; return; }
    var g = res.groups.filter(function (x) { return x.name === r.group; })[0];
    var kg = r.w / 1000;
    var rows = [
      ["Weight", LM.fmt(r.w, 4) + " g = " + LM.fmt(kg, 4) + " kg"],
      ["Dose", g.vehicleOnly ? "vehicle only" : LM.fmt(g.dose, 4) + " mg/kg × " + LM.fmt(kg, 4) + " kg = <b>" + LM.fmt(r.mg, 4) + " mg</b>"]
    ];
    if (st.mode === "vol") rows.push(["Concentration", g.vehicleOnly ? "—" : LM.fmt(g.dose, 4) + " mg/kg ÷ " + LM.fmt(st.volKg, 4) + " mL/kg = <b>" + LM.fmt(g.conc, 4) + " mg/mL</b>"]);
    rows.push(["Volume", g.vehicleOnly ? LM.fmt(g.rate, 4) + " mL/kg × " + LM.fmt(kg, 4) + " kg = " + LM.fmt(r.exact, 4) + " mL"
      : (st.mode === "vol" ? LM.fmt(st.volKg, 4) + " mL/kg × " + LM.fmt(kg, 4) + " kg" : LM.fmt(r.mg, 4) + " mg ÷ " + LM.fmt(g.conc, 4) + " mg/mL") + " = " + LM.fmt(r.exact, 4) + " mL"]);
    if (st.step > 0) rows.push(["On the syringe", "nearest " + LM.fmtPlain(st.step, 4) + " mL → <b>" + D.volFix(r.vol, st.step) + " mL</b> (" + D.pct(r.dev) + " of the dose)"]);
    rows.push(["Check", LM.fmtPlain(r.vol, 6) + " mL ÷ " + LM.fmt(kg, 4) + " kg = " + LM.fmt(r.mlkg, 4) + " mL/kg" + (res.limit ? " · limit " + limText(res.limit) : "")]);
    el.innerHTML = '<div class="dt-work-h"><span>WORKING</span><b>' + esc(r.id) + '</b><span class="dt-work-note">tap another animal to see its numbers</span></div><dl class="dt-dl">' +
      rows.map(function (x) { return "<dt>" + x[0] + "</dt><dd>" + x[1] + "</dd>"; }).join("") + "</dl>";
  }

  // ---------- print sheet ----------
  function renderSheet() {
    var el = $("sheet");
    if (!res.animals.length) { el.innerHTML = ""; return; }
    var sp = D.SPECIES.filter(function (s) { return s.k === st.species; })[0];
    var route = D.ROUTES.filter(function (r) { return r.k === st.route; })[0];
    var set = D.LIMIT_SETS.filter(function (l) { return l.k === (st.species === "other" ? "custom" : st.limitSet); })[0];
    var syr = D.SYRINGES.filter(function (s) { return s.k === st.syringe; })[0];
    var doses = (res.days || 1) * (res.perDay || 1);
    var checks = doses > 1 && doses <= 10 ? doses : 1;
    var f = st.fields;
    var vehicle = st.vehicle.filter(function (p) { return p[0]; }).map(function (p) { return p[1] + "% " + p[0]; }).join(" + ");
    function fld(k, v) { return '<div class="ds-f"><span>' + k + "</span><b>" + (v ? esc(v) : "&nbsp;") + "</b></div>"; }
    var head = '<div class="ds-sh-head"><div class="ds-sh-title">DOSING SHEET</div>' +
      fld("STUDY", f.study) + fld("PROTOCOL", f.proto) + fld("COMPOUND · LOT", f.drug) + fld("DATE", f.date) + fld("OPERATOR", f.op) + "</div>" +
      '<p class="ds-sh-par">' + esc(sp.name) + " · " + esc(route.name) + " · " + esc(vehicle) + " · syringe " + esc(syr && syr.step ? syr.name : LM.fmtPlain(st.step, 4) + " mL graduations") + " · limits: " + esc(set.name) + (res.limit ? " (" + esc(limText(res.limit)) + ")" : "") +
      (doses > 1 ? " · " + res.days + " day" + (res.days === 1 ? "" : "s") + " × " + res.perDay + " per day" : "") + "</p>";
    var gBy = {};
    res.groups.forEach(function (g) { gBy[g.name] = g; });
    var blocks = res.groups.map(function (g) {
      var rows = res.animals.filter(function (r) { return r.group === g.name; });
      var chk = "";
      for (var c = 1; c <= checks; c++) chk += "<th class=\"c\">" + (checks > 1 ? "D" + c : "✓") + "</th>";
      var body = rows.map(function (r) {
        var flag = r.level === "err" || r.level === "warn";
        var cells = "";
        for (var c2 = 1; c2 <= checks; c2++) cells += '<td class="c"><i></i></td>';
        return "<tr" + (flag ? ' class="is-flag"' : "") + "><td>" + esc(r.id) + "</td><td>" + esc(r.cage) + '</td><td class="n">' + (r.w > 0 ? LM.fmt(r.w, 4) : "") + '</td><td class="n">' + (r.mg != null ? LM.fmt(r.mg, 3) : "") +
          '</td><td class="n v">' + (r.vol != null ? D.volFix(r.vol, st.step) : "") + (flag ? " ⚠" : "") + "</td>" + cells + "<td></td><td></td><td class=\"note\">" + esc(r.flags.filter(function (x) { return x.level !== "ok"; }).map(function (x) { return x.code; }).join(", ")) + "</td></tr>";
      }).join("");
      var title = (g.name ? esc(g.name) : "All animals") + " — " + (g.vehicleOnly ? "vehicle only" : (g.dose != null ? LM.fmt(g.dose, 4) + " mg/kg" : "") + (g.conc ? " · " + LM.fmt(g.conc, 4) + " mg/mL" : "")) + (g.rate ? " · " + LM.fmt(g.rate, 3) + " mL/kg" : "");
      var rec = recipeLines(g).map(function (l) { return l.err ? "<li>" + esc(l.err) + "</li>" : "<li><span>" + l.k + "</span> " + esc(l.v) + " — " + esc(l.say) + "</li>"; }).join("");
      var prep = g.recipe ? '<div class="ds-sh-rec"><b>PREPARE ' + (g.prep ? mlStr(g.prep) : "") + "</b><ol>" + rec + '</ol><div class="ds-sign"><span>Prepared by</span><span>Checked by</span><span>Time</span></div></div>' : "";
      return '<section class="ds-sh-group' + (st.pageEach ? " is-break" : "") + '"><h3>' + title + "</h3>" +
        '<table class="ds-sh-t"><thead><tr><th>ID</th><th>CAGE</th><th class="n">WEIGHT g</th><th class="n">DOSE mg</th><th class="n v">VOLUME mL</th>' + chk + "<th>TIME</th><th>INIT.</th><th>NOTES</th></tr></thead><tbody>" + body + "</tbody></table>" + prep + "</section>";
    }).join("");
    var foot = '<p class="ds-sh-foot">labmate.tools/tools/dosing · ' + D.ALGO + " · volumes rounded to the syringe; ⚠ = check before dosing · limits: " + esc(set.long) + ". Your approved protocol takes precedence.</p>";
    el.innerHTML = head + blocks + foot;
  }

  // ---------- outputs ----------
  function tableRows() {
    var head = ["ID", "Cage", "Group", "Weight_g", "Dose_mg_per_kg", "Conc_mg_per_mL", "Dose_mg", "Volume_exact_mL", "Volume_mL", "mL_per_kg", "Rounding_pct", "Flags"];
    var gBy = {};
    res.groups.forEach(function (g) { gBy[g.name] = g; });
    var rows = res.animals.map(function (r) {
      var g = gBy[r.group] || {};
      return [r.id, r.cage, r.group, r.w > 0 ? r.w : "", g.dose != null ? +g.dose.toPrecision(6) : "", g.conc != null ? +g.conc.toPrecision(6) : "",
        r.mg != null ? +r.mg.toPrecision(6) : "", r.exact != null ? +r.exact.toPrecision(6) : "", r.vol != null ? r.vol : "",
        r.mlkg != null ? +r.mlkg.toPrecision(4) : "", r.dev != null ? +(r.dev * 100).toFixed(2) : "", r.flags.map(function (f) { return f.code; }).join("; ")];
    });
    return [head].concat(rows);
  }
  function flash(t) { $("copied").textContent = t; setTimeout(function () { $("copied").textContent = ""; }, 2500); }
  $("copy").addEventListener("click", function () {
    LM.copy(tableRows().map(function (r) { return r.join("\t"); }).join("\n"), function (ok) { flash(ok ? "Copied" : "Copy failed"); });
  });
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function stamp() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  $("csv").addEventListener("click", function () {
    var csv = tableRows().map(function (r) { return r.map(function (c) { c = String(c); return /[",\n;]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(","); }).join("\r\n");
    download("dosing-" + stamp() + ".csv", "﻿" + csv, "text/csv");
  });
  $("json").addEventListener("click", function () {
    var rec = { tool: "labmate.tools/tools/dosing", algorithm: D.ALGO, saved: new Date().toISOString(), animals: animalsText, state: st,
      volumes: res.animals.map(function (r) { return { id: r.id, volume_mL: r.vol == null ? null : r.vol }; }) };
    download("dosing-" + stamp() + ".dosing.json", JSON.stringify(rec, null, 2), "application/json");
  });
  $("jsonIn").addEventListener("change", function () {
    var f = this.files && this.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var rec = JSON.parse(String(rd.result));
        if (!rec || !rec.state || typeof rec.animals !== "string") throw new Error("not a dosing record");
        st = Object.assign(defaults(), rec.state); animalsText = rec.animals; $("exampleNote").hidden = true;
        syncControls(); go();
        var diff = 0;
        (rec.volumes || []).forEach(function (v, i) { var r = res.animals[i]; if (!r || String(r.id) !== String(v.id) || (r.vol == null ? null : r.vol) !== v.volume_mL) diff++; });
        flash(diff ? diff + " volume(s) differ from the saved record — check the settings" : "Record opened · every volume matches (" + (rec.algorithm || "?") + ")");
      } catch (e) { flash("Couldn't read that file as a dosing record"); }
    };
    rd.readAsText(f);
    this.value = "";
  });
  $("print").addEventListener("click", function () { renderSheet(); window.print(); });

  syncControls();
  go();
})();
