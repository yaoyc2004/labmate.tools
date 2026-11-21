// labmate.tools — 2.7 Buffer Recipe
(function () {
  "use strict";
  var LM = window.LM, R = window.LMR;
  var KEY = "lm-buffer-v1";
  var $ = function (id) { return document.getElementById(id); };
  var UNITS = [["M", "M"], ["mM", "mM"], ["µM", "µM"], ["w/v", "% w/v"], ["v/v", "% v/v"]];
  var FORMS = [["powder", "powder"], ["liquid", "neat liquid"], ["stock", "stock solution"]];

  function fresh(k) {
    var p = R.clonePreset(k) || R.clonePreset("tgs");
    return { k: p.k, comps: p.comps.map(function (c) { return toRow(c); }), ph: p.ph };
  }
  function toRow(c) {
    return { name: c.name, c: String(c.c), u: c.u, form: c.form, mw: c.mw != null ? String(c.mw) : "", stock: c.stock != null ? String(c.stock) : "", atUse: !!c.atUse, note: c.note || "" };
  }
  function defaults(k) {
    var p = R.preset(k) || R.preset("tgs");
    return { mode: "make", x: String(p.usual), to: "1", v: "1", vu: "1000", recipes: {}, cur: p.k };
  }

  var st = LM.load(KEY);
  if (!st || !st.recipes) st = defaults("tgs");
  var q = new URLSearchParams(location.search);
  if (q.get("preset") && R.preset(q.get("preset"))) { st.cur = q.get("preset"); st.x = String(R.preset(st.cur).usual); st.mode = "make"; }
  function cur() { if (!st.recipes[st.cur]) st.recipes[st.cur] = fresh(st.cur); return st.recipes[st.cur]; }
  function edited(k) {
    var r = st.recipes[k]; if (!r || k === "custom") return false;
    return JSON.stringify(r.comps) !== JSON.stringify(fresh(k).comps);
  }

  // ---------- presets ----------
  function renderPresets() {
    var groups = [];
    R.PRESETS.forEach(function (p) {
      var g = groups.filter(function (x) { return x.name === p.group; })[0];
      if (!g) groups.push(g = { name: p.group, items: [] });
      g.items.push(p);
    });
    $("presets").innerHTML = groups.map(function (g) {
      return '<div class="rc-group"><span class="rc-k">' + LM.esc(g.name.toUpperCase()) + "</span>" + g.items.map(function (p) {
        return '<button type="button" class="chip' + (edited(p.k) ? " is-edited" : "") + '" data-preset="' + p.k + '" aria-pressed="' + (p.k === st.cur) + '" title="' + LM.esc(p.name) + '">' + LM.esc(p.short) + "</button>";
      }).join("") + "</div>";
    }).join("");
  }

  // ---------- component rows ----------
  function opts(list, val) {
    return list.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === val ? " selected" : "") + ">" + o[1] + "</option>"; }).join("");
  }
  function rowHTML(r, i) {
    var molar = R.isMolar(r.u);
    var needMW = r.form === "powder" && molar, needStock = r.form === "stock" || (r.form === "liquid" && molar);
    var ph = needMW ? "MW g/mol" : needStock ? (molar ? "stock M" : "stock %") : "";
    var val = needMW ? r.mw : needStock ? r.stock : "";
    return '<tr data-i="' + i + '" data-shape="' + shapeKey(r) + '">' +
      '<td class="c-name" data-l="COMPONENT"><label class="sr" for="cn' + i + '">Component ' + (i + 1) + '</label><input id="cn' + i + '" class="cn" type="text" maxlength="60" autocomplete="off" placeholder="Name" value="' + LM.esc(r.name) + '">' + (r.note ? '<span class="c-note">' + LM.esc(r.note) + "</span>" : "") + "</td>" +
      '<td data-l="AT 1×"><div class="cell2"><label class="sr" for="cc' + i + '">Concentration at 1×</label><input id="cc' + i + '" class="num cc" type="text" inputmode="decimal" autocomplete="off" value="' + LM.esc(r.c) + '"><label class="sr" for="cu' + i + '">Unit</label><select id="cu' + i + '" class="cu">' + opts(UNITS, r.u) + "</select></div></td>" +
      '<td data-l="FORM"><label class="sr" for="cf' + i + '">Form</label><select id="cf' + i + '" class="cf">' + opts(FORMS, r.form) + "</select></td>" +
      '<td data-l="MW · STOCK">' + (ph ? '<label class="sr" for="cm' + i + '">' + ph + '</label><input id="cm' + i + '" class="num cm" data-role="' + (needMW ? "mw" : "stock") + '" type="text" inputmode="decimal" autocomplete="off" placeholder="' + ph + '" value="' + LM.esc(val) + '">' : '<span class="muted">—</span>') + "</td>" +
      '<td class="c-use" data-l="AT USE"><input type="checkbox" class="cuse" aria-label="Add at use"' + (r.atUse ? " checked" : "") + "></td>" +
      '<td class="c-out" data-l="AMOUNT">—</td>' +
      '<td class="c-x"><button type="button" class="rc-x" aria-label="Remove component">×</button></td></tr>';
  }
  function renderComps() {
    var r = cur();
    $("comps").innerHTML = r.comps.map(rowHTML).join("");
    $("presetName").textContent = "· " + R.preset(st.cur).name.toUpperCase();
    $("restore").hidden = st.cur === "custom" || !edited(st.cur);
  }
  function readComps() {
    var r = cur();
    Array.prototype.forEach.call(document.querySelectorAll("#comps tr"), function (tr, i) {
      var c = r.comps[i];
      c.name = tr.querySelector(".cn").value; c.c = tr.querySelector(".cc").value;
      c.u = tr.querySelector(".cu").value; c.form = tr.querySelector(".cf").value;
      c.atUse = tr.querySelector(".cuse").checked;
      var m = tr.querySelector(".cm");
      if (m) { if (m.getAttribute("data-role") === "mw") c.mw = m.value; else c.stock = m.value; }
    });
  }
  // a row's shape changed (unit or form) → re-render it so the MW / stock box follows
  function shapeKey(c) { var molar = R.isMolar(c.u); return (c.form === "powder" && molar) + "|" + (c.form === "stock" || (c.form === "liquid" && molar)); }

  // ---------- compute ----------
  function setMsg(id, text) {
    $(id + "m").textContent = text || "";
    document.querySelector('[data-term="' + id + '"]').classList.toggle("is-bad", !!text);
  }
  function pos(id) {
    var v = LM.parse($(id).value);
    if (v == null) { setMsg(id, "Required"); return NaN; }
    if (isNaN(v)) { setMsg(id, "Not a number"); return NaN; }
    if (v <= 0) { setMsg(id, "Must be above zero"); return NaN; }
    return v;
  }
  function amountText(a) {
    if (a.kind === "mass") return a.g >= 1 ? LM.fmt(a.g, 4) + " g" : LM.show(a.g, LM.MASS, 3);
    return LM.show(a.mL / 1000, LM.VOL, 4);
  }
  function volText(mL) { return LM.show(mL / 1000, LM.VOL, 4); }
  function strength(x) { return LM.fmt(x, 3) + "×"; }

  var last = null;
  function parsedComps(markBad) {
    var r = cur(), bad = false;
    var list = r.comps.map(function (c, i) {
      var tr = document.querySelectorAll("#comps tr")[i];
      var cv = LM.parse(c.c), mw = LM.parse(c.mw), sv = LM.parse(c.stock);
      var o = { name: c.name || "Component " + (i + 1), c: cv, u: c.u, form: c.form, mw: mw, stock: sv, atUse: c.atUse };
      var blank = cv == null && !c.name;
      var cOk = blank || (cv != null && !isNaN(cv) && cv >= 0);
      var formOk = blank || !(c.form === "powder" && c.u === "v/v");
      if (tr && markBad) {
        tr.querySelector(".cc").closest("td").classList.toggle("is-bad", !cOk);
        tr.querySelector(".cf").closest("td").classList.toggle("is-bad", !formOk);
      }
      if (!cOk || !formOk) bad = true;
      if (blank) o.blank = true;
      return o;
    }).filter(function (o) { return !o.blank; });
    return { list: list, bad: bad };
  }

  function update() {
    readComps();
    st.mode = st.mode === "dilute" ? "dilute" : "make";
    st.x = $("x").value; st.to = $("to").value; st.v = $("v").value; st.vu = $("vu").value;
    LM.save(KEY, st);
    ["x", "to", "v"].forEach(function (k) { setMsg(k, ""); });
    Array.prototype.forEach.call(document.querySelectorAll("#modeSeg button"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-mode") === st.mode)); });
    var dil = st.mode === "dilute";
    $("toTerm").hidden = !dil;
    $("xName").textContent = dil ? "STOCK YOU HAVE" : "STRENGTH TO MAKE";
    $("outHead").textContent = dil ? "AT USE" : "AMOUNT";
    $("toDilute").hidden = dil;
    $("restore").hidden = st.cur === "custom" || !edited(st.cur);
    Array.prototype.forEach.call(document.querySelectorAll("#presets .chip"), function (b) { b.classList.toggle("is-edited", edited(b.getAttribute("data-preset"))); });

    var pc = parsedComps(true);
    var x = pos("x"), V = pos("v"), to = dil ? pos("to") : 1;
    Array.prototype.forEach.call(document.querySelectorAll("#comps .c-out"), function (td) { td.textContent = "—"; td.classList.remove("is-bad"); });
    if (pc.bad || isNaN(x) || isNaN(V) || isNaN(to)) return empty("Check the highlighted value.", true);
    if (!pc.list.length) return empty("Add a component", false, "Type a name and its concentration at 1×.");
    V = V * parseFloat(st.vu);
    if (dil) {
      if (to > x) { setMsg("to", "Above the stock strength"); return empty("Check the highlighted value.", true); }
      var d = R.diluteStock({ from: x, to: to, V: V, components: pc.list });
      if (!d.ok) return empty(d.errors[0].error === "no-room" ? "The additions don't fit" : "Check the at-use rows.", true);
      last = { mode: "dilute", d: d, x: x, to: to, V: V, list: pc.list };
      showDilute(d, x, to, V, pc.list);
    } else {
      var m = R.makeFromComponents({ components: pc.list, x: x, V: V, includeAtUse: x === 1 });
      if (!m.ok) {
        var rows = document.querySelectorAll("#comps tr");
        m.errors.forEach(function (e) {
          var real = cur().comps.map(function (c, i) { return i; }).filter(function (i) { var c = cur().comps[i]; return !(LM.parse(c.c) == null && !c.name); });
          if (e.i != null && rows[real[e.i]]) rows[real[e.i]].querySelector(".c-out").textContent = e.error === "mw" ? "MW?" : e.error === "stock" ? "stock?" : e.error === "over-stock" ? "stock too weak" : "?";
        });
        var e0 = m.errors[0];
        return empty(e0.error === "no-room" ? "The liquids add up to more than the volume" : e0.error === "over-stock" ? "A stock is weaker than the strength you want" : "Fill in the MW or stock for each row", true,
          e0.error === "no-room" ? "Make a weaker stock or use more concentrated stock solutions." : e0.error === "over-stock" ? "Use a stronger stock solution, weigh it as a powder, or make a lower strength." : "");
      }
      last = { mode: "make", m: m, x: x, V: V, list: pc.list };
      showMake(m, x, V);
    }
  }

  function empty(big, isErr, say) {
    last = null;
    $("ans").classList.toggle("is-error", !!isErr); $("ans").classList.toggle("is-empty", !isErr);
    $("ansBig").textContent = big; $("ansSay").textContent = say || "";
    ["copy", "print", "toDilute"].forEach(function (id) { $(id).disabled = true; });
    $("out").innerHTML = ""; $("notes").innerHTML = "";
  }
  function name() { var p = R.preset(st.cur); return st.cur === "custom" ? "custom buffer" : p.short; }
  function phStep() { return R.preset(st.cur).ph || ""; }
  function li(label, v, sub) {
    return '<li><input type="checkbox" aria-label="Done: ' + LM.esc(label) + '"><span class="n">' + LM.esc(label) + (sub ? "<small>" + LM.esc(sub) + "</small>" : "") + '</span><span class="v">' + LM.esc(v) + "</span></li>";
  }
  function subFor(c) {
    if (c.form === "powder") return R.isMolar(c.u) ? LM.fmt(c.c, 4) + " " + c.u + " at 1× · MW " + LM.fmt(c.mw, 6) : LM.fmt(c.c, 4) + "% w/v at 1×";
    if (c.form === "stock") return "from " + LM.fmt(c.stock, 4) + (R.isMolar(c.u) ? " M" : "%") + " stock";
    return R.isMolar(c.u) ? "neat, " + LM.fmt(c.stock, 4) + " M" : "neat";
  }
  function done() { ["copy", "print"].forEach(function (id) { $(id).disabled = false; }); $("ans").classList.remove("is-empty", "is-error"); }

  function showMake(m, x, V) {
    done(); $("toDilute").disabled = x <= 1;
    var rows = document.querySelectorAll("#comps tr"), idx = 0, notes = [];
    var real = cur().comps.map(function (c, i) { return i; }).filter(function (i) { var c = cur().comps[i]; return !(LM.parse(c.c) == null && !c.name); });
    m.rows.forEach(function (r, j) {
      var td = rows[real[j]] && rows[real[j]].querySelector(".c-out");
      if (td) td.textContent = r.skipped ? "at use" : amountText(r.amount);
    });
    var title = strength(x) + " " + name();
    $("ansBig").textContent = volText(V) + " of " + title;
    var weigh = m.rows.filter(function (r) { return !r.skipped; });
    var skipped = m.rows.filter(function (r) { return r.skipped; });
    $("ansSay").innerHTML = weigh.map(function (r) { return "<b>" + LM.esc(amountText(r.amount)) + "</b> " + LM.esc(r.cmp.name); }).join(", ") + ", made up to " + LM.esc(volText(V)) + "." +
      (skipped.length ? " " + LM.esc(skipped.map(function (r) { return r.cmp.name; }).join(" and ")) + " go in when you dilute it." : "");
    var h = '<section class="rc-card"><div class="rc-card-h"><b>' + LM.esc(title) + "</b><span>" + LM.esc(volText(V)) + "</span></div><ol class=\"rc-steps\">";
    h += '<li class="sep">DISSOLVE IN ABOUT ' + LM.esc(volText(V * 0.8)).toUpperCase() + " WATER</li>";
    weigh.forEach(function (r) { h += li(r.cmp.name, amountText(r.amount), subFor(r.cmp)); });
    var ph = phStep();
    if (ph) h += '<li class="sep">' + LM.esc(ph.toUpperCase()) + "</li>";
    h += '<li class="total"><span></span><span class="n">MAKE UP TO</span><span class="v">' + LM.esc(volText(V)) + "</span></li></ol>";
    if (skipped.length) h += '<p class="rc-card-foot">At use, per 1× litre: ' + skipped.map(function (r) { var a = R.componentAmount(r.cmp, 1, 1000); return LM.esc(r.cmp.name) + " " + (a.error ? "?" : LM.esc(amountText(a))); }).join(", ") + ". <b>NOW DILUTE IT →</b> works it out for your volume.</p>";
    h += "</section>";
    $("out").innerHTML = h;
    var pre = R.preset(st.cur);
    if (pre && pre.usual > 1 && x > pre.usual) notes.push('<li class="note">Stronger than the usual ' + pre.usual + "× stock for " + LM.esc(pre.short) + ". Check that it dissolves and stays in solution.</li>");
    weigh.forEach(function (r) {
      if (r.amount.kind === "mass" && r.amount.g > 0 && r.amount.g < 0.01) notes.push('<li class="note">' + LM.esc(r.cmp.name) + ": " + LM.esc(amountText(r.amount)) + " is hard to weigh well. Make more, or add it from a stock solution.</li>");
      if (r.amount.kind === "volume" && r.amount.mL > 0 && r.amount.mL < 0.002) notes.push('<li class="note">' + LM.esc(r.cmp.name) + ": " + LM.esc(amountText(r.amount)) + " is hard to pipette accurately.</li>");
    });
    if (m.liquids > V * 0.5) notes.push('<li class="note info">Liquids take ' + Math.round(m.liquids / V * 100) + "% of the volume; dissolve the powders in the water left.</li>");
    $("notes").innerHTML = notes.join("");
    $("printHead").innerHTML = "<b>" + LM.esc(title) + "</b> · " + LM.esc(volText(V)) + " · " + new Date().toLocaleDateString() + " · labmate.tools/tools/buffer-recipes";
  }

  function showDilute(d, x, to, V, list) {
    done();
    var rows = document.querySelectorAll("#comps tr");
    var real = cur().comps.map(function (c, i) { return i; }).filter(function (i) { var c = cur().comps[i]; return !(LM.parse(c.c) == null && !c.name); });
    d.adds.forEach(function (a) { var td = rows[real[a.i]] && rows[real[a.i]].querySelector(".c-out"); if (td) td.textContent = amountText(a.amount); });
    var title = strength(to) + " " + name();
    $("ansBig").textContent = volText(d.stockV) + " of " + strength(x) + " in " + volText(V);
    $("ansSay").innerHTML = "Take <b>" + LM.esc(volText(d.stockV)) + "</b> of the " + strength(x) + " stock" +
      d.adds.map(function (a) { return ", <b>" + LM.esc(amountText(a.amount)) + "</b> " + LM.esc(a.cmp.name); }).join("") +
      " and <b>" + LM.esc(volText(d.water)) + "</b> water for " + LM.esc(volText(V)) + " of " + LM.esc(title) + ".";
    var h = '<section class="rc-card"><div class="rc-card-h"><b>' + LM.esc(title) + "</b><span>" + LM.esc(volText(V)) + " FROM " + strength(x) + "</span></div><ol class=\"rc-steps\">";
    h += li("Water", volText(d.water), "");
    h += li(strength(x) + " " + name() + " stock", volText(d.stockV), "1 part in " + LM.fmt(x / to, 4));
    d.adds.forEach(function (a) { h += li(a.cmp.name, amountText(a.amount), subFor(a.cmp)); });
    h += '<li class="total"><span></span><span class="n">TOTAL</span><span class="v">' + LM.esc(volText(V)) + "</span></li></ol></section>";
    $("out").innerHTML = h;
    var notes = [];
    if (list.some(function (c) { return c.atUse && /methanol/i.test(c.name); })) notes.push('<li class="note info">Add methanol to the diluted buffer, not to the stock; mixing warms it, so chill before use.</li>');
    if (list.some(function (c) { return c.atUse && /tween|triton|np-40/i.test(c.name); })) notes.push('<li class="note info">Detergents are viscous: cut the pipette tip or weigh it (Tween-20 is about 1.1 g/mL), and rinse the tip in the buffer.</li>');
    $("notes").innerHTML = notes.join("");
    $("printHead").innerHTML = "<b>" + LM.esc(title) + "</b> · " + LM.esc(volText(V)) + " · " + new Date().toLocaleDateString() + " · labmate.tools/tools/buffer-recipes";
  }

  function recipeText() {
    if (!last) return "";
    var L = [];
    if (last.mode === "make") {
      var m = last.m;
      L.push(volText(last.V) + " of " + strength(last.x) + " " + R.preset(st.cur).name);
      m.rows.forEach(function (r) { if (!r.skipped) L.push("  " + r.cmp.name + "\t" + amountText(r.amount)); });
      if (phStep()) L.push("  " + phStep());
      L.push("  Make up to " + volText(last.V) + " with water.");
      var sk = m.rows.filter(function (r) { return r.skipped; });
      if (sk.length) L.push("  At use: " + sk.map(function (r) { return r.cmp.name; }).join(", ") + ".");
    } else {
      var d = last.d;
      L.push(volText(last.V) + " of " + strength(last.to) + " " + R.preset(st.cur).name + " from " + strength(last.x));
      L.push("  Water\t" + volText(d.water));
      L.push("  " + strength(last.x) + " stock\t" + volText(d.stockV));
      d.adds.forEach(function (a) { L.push("  " + a.cmp.name + "\t" + amountText(a.amount)); });
    }
    L.push("labmate.tools/tools/buffer-recipes");
    return L.join("\n");
  }

  // ---------- events ----------
  function choose(k) {
    readComps(); st.cur = k;
    var p = R.preset(k); st.x = String(st.mode === "dilute" ? p.usual : p.usual); $("x").value = st.x;
    renderPresets(); renderComps(); update();
  }
  $("x").value = st.x; $("to").value = st.to; $("v").value = st.v; $("vu").value = st.vu;
  renderPresets(); renderComps();
  $("presets").addEventListener("click", function (e) { var b = e.target.closest("[data-preset]"); if (b) choose(b.getAttribute("data-preset")); });
  $("comps").addEventListener("input", update);
  $("comps").addEventListener("change", function (e) {
    var tr = e.target.closest("tr"); if (!tr) return;
    var c = cur().comps[+tr.getAttribute("data-i")];
    readComps();
    if (shapeKey(c) !== tr.getAttribute("data-shape")) renderComps();
    update();
  });
  $("comps").addEventListener("click", function (e) {
    var b = e.target.closest(".rc-x"); if (!b) return;
    readComps(); cur().comps.splice(+b.closest("tr").getAttribute("data-i"), 1); renderComps(); update();
  });
  $("addComp").addEventListener("click", function () {
    readComps(); cur().comps.push({ name: "", c: "", u: "mM", form: "powder", mw: "", stock: "", atUse: false, note: "" });
    renderComps(); update(); var n = document.querySelectorAll("#comps .cn"); n[n.length - 1].focus();
  });
  $("restore").addEventListener("click", function () { st.recipes[st.cur] = fresh(st.cur); renderPresets(); renderComps(); update(); });
  ["x", "to", "v", "vu"].forEach(function (id) { $(id).addEventListener("input", update); $(id).addEventListener("change", update); });
  $("modeSeg").addEventListener("click", function (e) {
    var b = e.target.closest("[data-mode]"); if (!b) return;
    st.mode = b.getAttribute("data-mode"); update();
  });
  $("toDilute").addEventListener("click", function () {
    st.mode = "dilute"; $("to").value = "1"; update();
    $("modeSeg").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  $("out").addEventListener("change", function (e) { if (e.target.type === "checkbox") e.target.closest("li").classList.toggle("is-done", e.target.checked); });
  $("clear").addEventListener("click", function () { st = defaults("tgs"); $("x").value = st.x; $("to").value = st.to; $("v").value = st.v; $("vu").value = st.vu; renderPresets(); renderComps(); update(); });
  $("copy").addEventListener("click", function () {
    LM.copy(recipeText(), function (ok) { $("copied").textContent = ok ? "Copied" : "Copy failed"; setTimeout(function () { $("copied").textContent = ""; }, 2000); });
  });
  $("print").addEventListener("click", function () { window.print(); });
  update();
  window.LMT_BUF = { state: function () { return st; }, last: function () { return last; }, text: recipeText };
})();
