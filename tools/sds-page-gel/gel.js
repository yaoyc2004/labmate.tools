// labmate.tools — 5.6 SDS-PAGE Gel Recipe
(function () {
  "use strict";
  var LM = window.LM, R = window.LMR;
  var KEY = "lm-gel-v1", SKEY = "lm-gel-stocks-v1";
  var $ = function (id) { return document.getElementById(id); };

  var DEF = { sys: "mp100", dw: "8.3", dh: "7.3", dt: "1.0", over: "10", step: "0.5", stk: "4", frac: "75",
    res: [{ pct: "10", gels: "2" }, { pct: "12", gels: "2" }] };
  function defStocks() {
    return { acryl: "30", ratio: "37.5:1", resTris: "1.5", stkTris: "0.5", sds: "10", aps: "10", water: "strict",
      finals: { resolving: { tris: "0.375", sds: "0.1", aps: "0.05", temed: "0.05" }, stacking: { tris: "0.125", sds: "0.1", aps: "0.05", temed: "0.1" } } };
  }
  var st = LM.load(KEY), sk = LM.load(SKEY);
  if (!st || !Array.isArray(st.res)) st = JSON.parse(JSON.stringify(DEF));
  if (!sk || !sk.finals) sk = defStocks();

  var NAMES = {
    water: function () { return ["Water", "deionised"]; },
    tris: function (kind) { return kind === "stacking" ? ["Tris-HCl pH 6.8", fmtC(sk.stkTris) + " M stock"] : ["Tris-HCl pH 8.8", fmtC(sk.resTris) + " M stock"]; },
    acryl: function () { return ["Acrylamide/bis " + sk.ratio, fmtC(sk.acryl) + "% stock"]; },
    sds: function () { return ["SDS", fmtC(sk.sds) + "% stock"]; },
    aps: function () { return ["APS", fmtC(sk.aps) + "%, fresh"]; },
    temed: function () { return ["TEMED", "neat"]; }
  };
  function fmtC(s) { var v = LM.parse(s); return v == null || isNaN(v) ? "?" : LM.fmt(v, 4); }

  // volume in mL → bench text: ≥ 1 mL as mL (2 dp), below as µL
  function vol(mL) {
    if (mL >= 1 - 1e-9) return (Math.round(mL * 100) / 100).toFixed(2) + " mL";
    var ul = mL * 1000;
    if (ul >= 10) return Math.round(ul) + " µL";
    return (Math.round(ul * 10) / 10) + " µL";
  }
  R.fmtVol = vol;

  // ---------- inputs ----------
  function fillSys() {
    $("sys").innerHTML = R.SYSTEMS.map(function (s) {
      return '<option value="' + s.k + '">' + LM.esc(s.name) + (s.cassette ? " — " + s.cassette + " mL" : "") + "</option>";
    }).join("");
  }
  function renderRes() {
    $("resRows").innerHTML = st.res.map(function (r, i) {
      return '<tr data-i="' + i + '"><td><label class="sr" for="rp' + i + '">Resolving gel %, row ' + (i + 1) + '</label><input id="rp' + i + '" class="num rp" type="text" inputmode="decimal" autocomplete="off" value="' + LM.esc(r.pct) + '"></td>' +
        '<td class="c-num"><label class="sr" for="rg' + i + '">Gels, row ' + (i + 1) + '</label><input id="rg' + i + '" class="num rg" type="text" inputmode="numeric" autocomplete="off" value="' + LM.esc(r.gels) + '"></td>' +
        '<td class="c-out" data-out="' + i + '">—</td>' +
        '<td class="c-x"><button type="button" class="rc-x" aria-label="Remove this percentage"' + (st.res.length < 2 ? " disabled" : "") + '>×</button></td></tr>';
    }).join("");
    $("addRes").disabled = st.res.length >= 4;
  }
  function fillInputs() {
    $("sys").value = st.sys; $("dw").value = st.dw; $("dh").value = st.dh; $("dt").value = st.dt;
    $("over").value = st.over; $("step").value = st.step; $("stk").value = st.stk; $("frac").value = st.frac;
    ["acryl", "resTris", "stkTris", "sds", "aps"].forEach(function (k) { $(k).value = sk[k]; });
    $("ratio").value = sk.ratio;
    Array.prototype.forEach.call(document.querySelectorAll("#finals input"), function (inp) {
      var p = inp.getAttribute("data-f").split("."); inp.value = sk.finals[p[0]][p[1]];
    });
    renderRes();
  }
  function readInputs() {
    st.sys = $("sys").value; st.dw = $("dw").value; st.dh = $("dh").value; st.dt = $("dt").value;
    st.over = $("over").value; st.step = $("step").value; st.stk = $("stk").value; st.frac = $("frac").value;
    st.res = Array.prototype.map.call(document.querySelectorAll("#resRows tr"), function (tr) {
      return { pct: tr.querySelector(".rp").value, gels: tr.querySelector(".rg").value };
    });
    ["acryl", "resTris", "stkTris", "sds", "aps"].forEach(function (k) { sk[k] = $(k).value; });
    sk.ratio = $("ratio").value;
    Array.prototype.forEach.call(document.querySelectorAll("#finals input"), function (inp) {
      var p = inp.getAttribute("data-f").split("."); sk.finals[p[0]][p[1]] = inp.value;
    });
  }

  function setMsg(id, text) {
    var m = $(id + "m"); if (m) m.textContent = text || "";
    var t = document.querySelector('[data-term="' + id + '"]'); if (t) t.classList.toggle("is-bad", !!text);
  }
  function num(id, s, o) {
    var v = LM.parse(s);
    if (v == null) { if (o.optional) return o.def; setMsg(id, "Required"); return NaN; }
    if (isNaN(v)) { setMsg(id, "Not a number"); return NaN; }
    if (v < 0 || (!o.zero && v === 0)) { setMsg(id, o.zero ? "Can't be negative" : "Must be above zero"); return NaN; }
    if (o.max != null && v >= o.max) { setMsg(id, o.maxMsg); return NaN; }
    return v;
  }

  // ---------- compute ----------
  var last = null;
  function update() {
    readInputs();
    LM.save(KEY, st); LM.save(SKEY, sk);
    ["sys", "over", "step", "stk", "frac", "acryl", "resTris", "stkTris", "sds"].forEach(function (k) { setMsg(k, ""); });
    var bad = false;
    var sys = R.system(st.sys), cassette;
    $("dims").hidden = st.sys !== "custom";
    if (st.sys === "custom") {
      var w = LM.parse(st.dw), h = LM.parse(st.dh), t = LM.parse(st.dt);
      if (!(w > 0 && h > 0 && t > 0)) { setMsg("sys", "Enter width, height and spacer"); bad = true; }
      else cassette = R.cassetteVolume(w, h, t);
    } else cassette = sys.cassette;
    var over = num("over", st.over, { zero: true, optional: true, def: 0 });
    var frac = num("frac", st.frac, { max: 100, maxMsg: "Must be under 100%" });
    var stocks = {
      acryl: num("acryl", sk.acryl, {}), ratio: sk.ratio,
      resTris: num("resTris", sk.resTris, {}), stkTris: num("stkTris", sk.stkTris, {}),
      sds: num("sds", sk.sds, {}), aps: LM.parse(sk.aps), temed: 100
    };
    if (!(stocks.aps > 0)) { setMsg("sds", "APS stock must be above zero"); bad = true; }
    var stk = num("stk", st.stk, { max: isNaN(stocks.acryl) ? null : stocks.acryl, maxMsg: "Must be below the acrylamide stock" });
    var finals = { resolving: {}, stacking: {} };
    Array.prototype.forEach.call(document.querySelectorAll("#finals input"), function (inp) {
      var p = inp.getAttribute("data-f").split("."), v = LM.parse(inp.value);
      var ok = v != null && !isNaN(v) && v >= 0;
      inp.parentNode.classList.toggle("is-bad", !ok);
      if (!ok) bad = true;
      finals[p[0]][p[1]] = ok ? v : NaN;
    });
    var res = [];
    var rows = document.querySelectorAll("#resRows tr");
    st.res.forEach(function (r, i) {
      var p = LM.parse(r.pct), g = LM.parse(r.gels);
      var okP = p != null && !isNaN(p) && p > 0 && !(stocks.acryl > 0 && p >= stocks.acryl);
      var okG = g != null && !isNaN(g) && g >= 0 && Math.round(g) === g;
      rows[i].querySelector(".rp").parentNode.classList.toggle("is-bad", !okP);
      rows[i].querySelector(".rg").parentNode.classList.toggle("is-bad", !okG);
      if (!okP || !okG) bad = true;
      res.push({ pct: p, gels: g });
    });
    [over, frac, stk, stocks.acryl, stocks.resTris, stocks.stkTris, stocks.sds].forEach(function (v) { if (isNaN(v)) bad = true; });

    var water = sk.water === "nominal" ? "nominal" : "strict";
    Array.prototype.forEach.call(document.querySelectorAll("#waterSeg button"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-water") === water)); });
    $("waterHint").textContent = water === "strict"
      ? "EXACT TOTAL: water = volume minus every component, so the mix is exactly the volume shown."
      : "AS PRINTED: water leaves out APS and TEMED, like most printed recipes; the mix ends a little over the volume shown.";
    $("stocksSum").textContent = fmtC(sk.acryl) + "% acrylamide (" + sk.ratio + ") · " + fmtC(sk.resTris) + " M / " + fmtC(sk.stkTris) + " M Tris · " + fmtC(sk.sds) + "% SDS · " + fmtC(sk.aps) + "% APS";

    if (cassette > 0 && frac > 0 && frac < 100) {
      $("perGel").innerHTML = "Per gel: <b>" + vol(cassette * frac / 100) + "</b> resolving + <b>" + vol(cassette * (1 - frac / 100)) + "</b> stacking, of a " + LM.fmt(cassette, 3) + " mL cassette.";
    } else $("perGel").textContent = "";

    if (bad) return empty("Check the highlighted value.", true);
    var total = res.reduce(function (a, r) { return a + r.gels; }, 0);
    if (!total) return empty("How many gels?", false, "Enter the number of gels next to each percentage.");
    var plan = R.gelPlan({ cassette: cassette, frac: frac / 100, overage: over, step: parseFloat(st.step) || 0,
      resolving: res, stackPct: stk, stocks: stocks, finals: finals, water: water });
    last = { plan: plan, stocks: stocks, finals: finals, water: water, cassette: cassette, over: over, frac: frac };
    show(plan);
  }

  function empty(big, isErr, say) {
    last = null;
    $("ans").classList.add(isErr ? "is-error" : "is-empty"); $("ans").classList.remove(isErr ? "is-empty" : "is-error");
    $("ansBig").textContent = big; $("ansSay").textContent = say || "";
    $("copy").disabled = true; $("print").disabled = true;
    $("out").innerHTML = ""; $("notes").innerHTML = "";
    Array.prototype.forEach.call(document.querySelectorAll("[data-out]"), function (td) { td.textContent = "—"; });
  }

  function cardHTML(m, id) {
    var title = m.kind === "stacking" ? m.pct + "% stacking gel" : m.pct + "% resolving gel";
    var h = '<section class="rc-card" data-mix="' + id + '"><div class="rc-card-h"><b>' + LM.esc(title) + '</b><span>' + vol(m.volume) + " · " + m.gels + " GEL" + (m.gels === 1 ? "" : "S") + "</span></div>";
    if (!m.ok) {
      var why = m.errors.indexOf("no-room") >= 0 ? "The components add up to more than the volume — lower a final concentration or use stronger stocks."
        : m.errors.indexOf("pct-over-stock") >= 0 ? "The gel percentage must be below the acrylamide stock."
        : m.errors.indexOf("tris-over-stock") >= 0 ? "The Tris final concentration must be below the stock."
        : "Check the stocks and final concentrations.";
      return h + '<p class="rc-card-foot" style="color:var(--err)">' + why + "</p></section>";
    }
    h += '<ol class="rc-steps">';
    m.rows.forEach(function (r, i) {
      if (r.k === "aps") h += '<li class="sep">MIX · DEGAS IF YOU DO · THEN, JUST BEFORE POURING</li>';
      var nm = NAMES[r.k](m.kind);
      h += '<li data-k="' + r.k + '"><input type="checkbox" aria-label="Added ' + LM.esc(nm[0]) + '"><span class="n">' + LM.esc(nm[0]) + "<small>" + LM.esc(nm[1]) + '</small></span><span class="v">' + vol(r.v) + "</span></li>";
    });
    h += '<li class="total"><span></span><span class="n">TOTAL</span><span class="v">' + vol(m.total) + "</span></li></ol>";
    var per = m.kind === "stacking" ? last.plan.perStk : last.plan.perRes;
    h += '<p class="rc-card-foot">Pour <b>' + vol(per) + "</b> per gel" + (m.kind === "stacking" ? ", then insert the comb." : ", then overlay with water or isopropanol.") + "</p></section>";
    return h;
  }

  function show(plan) {
    $("ans").classList.remove("is-empty", "is-error");
    $("copy").disabled = !plan.ok; $("print").disabled = !plan.ok;
    var mixes = plan.resolving.filter(function (m) { return m.gels > 0; });
    var resTot = mixes.reduce(function (a, m) { return a + m.volume; }, 0);
    $("ansBig").textContent = plan.totalGels + " gel" + (plan.totalGels === 1 ? "" : "s") + " · " + vol(resTot + plan.stacking.volume);
    $("ansSay").innerHTML = "Make " + mixes.map(function (m) { return "<b>" + vol(m.volume) + " of " + LM.fmt(m.pct, 3) + "%</b> resolving gel"; }).join(" and ") +
      " and <b>" + vol(plan.stacking.volume) + " of " + LM.fmt(plan.stacking.pct, 3) + "%</b> stacking gel" +
      (last.over ? " (" + LM.fmt(last.over, 3) + "% extra" + (parseFloat(st.step) ? ", rounded up to " + st.step + " mL" : "") + ")." : ".");
    $("out").innerHTML = mixes.map(function (m) { return cardHTML(m, "r" + m.index); }).join("") + cardHTML(plan.stacking, "s");
    Array.prototype.forEach.call(document.querySelectorAll("[data-out]"), function (td) {
      var m = plan.resolving[+td.getAttribute("data-out")];
      td.textContent = m && m.gels > 0 && m.ok ? vol(m.volume) : "—";
    });
    $("printHead").innerHTML = "<b>SDS-PAGE gels</b> · " + LM.esc(R.system(st.sys).short) + " · " + plan.totalGels + " gels · " + new Date().toLocaleDateString() + " · labmate.tools/tools/sds-page-gel";

    var notes = [], tiny = [];
    plan.resolving.concat([plan.stacking]).forEach(function (m) {
      if (!m.ok || !m.gels) return;
      m.rows.forEach(function (r) { if (r.v > 0 && r.v < 0.002) tiny.push(NAMES[r.k](m.kind)[0] + " " + vol(r.v) + " (" + LM.fmt(m.pct, 3) + "% " + m.kind + ")"); });
    });
    if (tiny.length) notes.push('<li class="note"><b>Under 2 µL: ' + LM.esc(tiny.join(", ")) + ".</b> Hard to pipette accurately — make more gels at once or round the mix up to a larger volume.</li>");
    mixes.forEach(function (m) {
      if (m.pct > 20) notes.push('<li class="note">' + LM.fmt(m.pct, 3) + "% is very high for a Tris-glycine gel; check the percentage.</li>");
      if (plan.stacking.pct >= m.pct) notes.push('<li class="note">The stacking gel (' + LM.fmt(plan.stacking.pct, 3) + "%) is not below the " + LM.fmt(m.pct, 3) + "% resolving gel. Stacking gels are usually 4–5%.</li>");
    });
    if (last.finals.resolving.sds === 0 && last.finals.stacking.sds === 0) notes.push('<li class="note info">No SDS in either gel: a native gel. Run it in a buffer without SDS as well.</li>');
    if (last.water === "nominal") notes.push('<li class="note info">Water AS PRINTED: each mix ends ' + vol(plan.stacking.total - plan.stacking.volume) + " over its volume in the stacking gel, and likewise in the resolving gels.</li>");
    notes.push('<li class="note info">Make the 10% APS fresh (or use frozen single-use aliquots). APS and TEMED start polymerisation: add them last and pour within a few minutes.</li>');
    $("notes").innerHTML = notes.join("");
  }

  function recipeText() {
    if (!last || !last.plan.ok) return "";
    var p = last.plan, lines = ["SDS-PAGE gels — " + R.system(st.sys).short + ", " + p.totalGels + " gels (" + LM.fmt(last.over, 3) + "% overage)", ""];
    p.resolving.filter(function (m) { return m.gels > 0; }).concat([p.stacking]).forEach(function (m) {
      lines.push(LM.fmt(m.pct, 3) + "% " + m.kind + " gel — " + vol(m.volume) + " for " + m.gels + " gel" + (m.gels === 1 ? "" : "s") + " (pour " + vol(m.kind === "stacking" ? p.perStk : p.perRes) + " per gel)");
      m.rows.forEach(function (r) { var nm = NAMES[r.k](m.kind); lines.push("  " + nm[0] + " (" + nm[1] + ")\t" + vol(r.v)); });
      lines.push("  Total\t" + vol(m.total), "");
    });
    lines.push("Add APS and TEMED last. labmate.tools/tools/sds-page-gel");
    return lines.join("\n");
  }

  // ---------- events ----------
  fillSys(); fillInputs();
  var allChips = [8, 10, 12, 15];
  $("pctChips").insertAdjacentHTML("beforeend", allChips.map(function (p) { return '<button type="button" class="chip" data-pct="' + p + '">' + p + "%</button>"; }).join(""));
  function mine(e) { return e.target.closest(".rc-input"); }
  document.addEventListener("input", function (e) { if (mine(e)) update(); });
  document.addEventListener("change", function (e) { if (mine(e)) update(); });
  $("resRows").addEventListener("click", function (e) {
    var b = e.target.closest(".rc-x"); if (!b) return;
    readInputs(); st.res.splice(+b.closest("tr").getAttribute("data-i"), 1); renderRes(); update();
  });
  $("addRes").addEventListener("click", function () {
    readInputs(); if (st.res.length >= 4) return;
    st.res.push({ pct: "", gels: "1" }); renderRes(); update();
    var inp = document.querySelectorAll("#resRows .rp"); inp[inp.length - 1].focus();
  });
  $("pctChips").addEventListener("click", function (e) {
    var b = e.target.closest("[data-pct]"); if (!b) return;
    readInputs();
    var target = document.activeElement && document.activeElement.classList.contains("rp") ? document.activeElement : null;
    var rows = document.querySelectorAll("#resRows .rp");
    var inp = target || Array.prototype.filter.call(rows, function (x) { return !x.value; })[0] || rows[rows.length - 1];
    inp.value = b.getAttribute("data-pct"); update();
  });
  $("out").addEventListener("change", function (e) {
    if (e.target.type === "checkbox") e.target.closest("li").classList.toggle("is-done", e.target.checked);
  });
  $("waterSeg").addEventListener("click", function (e) {
    var b = e.target.closest("[data-water]"); if (!b) return;
    sk.water = b.getAttribute("data-water"); LM.save(SKEY, sk); update();
  });
  $("resetStocks").addEventListener("click", function () { var w = sk.water; sk = defStocks(); sk.water = w; fillInputs(); update(); });
  $("clear").addEventListener("click", function () { st = JSON.parse(JSON.stringify(DEF)); fillInputs(); update(); });
  $("copy").addEventListener("click", function () {
    LM.copy(recipeText(), function (ok) { $("copied").textContent = ok ? "Copied" : "Copy failed"; setTimeout(function () { $("copied").textContent = ""; }, 2000); });
  });
  $("print").addEventListener("click", function () { window.print(); });
  if (!LM.load(SKEY)) $("stocksBox").open = false;
  update();
  window.LMT_GEL = { state: function () { return st; }, stocks: function () { return sk; }, last: function () { return last; }, text: recipeText };
})();
