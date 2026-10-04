// labmate.tools — 2.1 Master Mix
(function () {
  "use strict";
  var LM = window.LM;
  var KEY = "lm-mastermix-v1";

  var PRESETS = {
    qpcr: { vol: "20", topup: true, rows: [
      ["2X qPCR master mix", "10", true], ["Forward primer (10 µM)", "0.8", true],
      ["Reverse primer (10 µM)", "0.8", true], ["Template (cDNA)", "2", false]] },
    pcr: { vol: "25", topup: true, rows: [
      ["10X reaction buffer", "2.5", true], ["dNTPs (10 mM)", "0.5", true],
      ["Forward primer (10 µM)", "0.5", true], ["Reverse primer (10 µM)", "0.5", true],
      ["Taq polymerase", "0.125", true], ["Template DNA", "1", false]] },
    blank: { vol: "", topup: false, rows: [["", "", true], ["", "", true], ["", "", true]] }
  };
  var DEFAULT = { n: "24", over: "10", overMode: "pct", vol: "20", topup: true, rows: PRESETS.qpcr.rows };

  var $ = function (id) { return document.getElementById(id); };
  var tbody = $("rows");
  var lastTable = "";

  var state = LM.load(KEY);
  if (!state || !Array.isArray(state.rows)) state = JSON.parse(JSON.stringify(DEFAULT));

  // ---------- rows ----------
  function rowHTML(r, i) {
    return '<tr data-i="' + i + '">' +
      '<td class="c-name"><label class="sr" for="nm' + i + '">Reagent ' + (i + 1) + '</label><input id="nm' + i + '" class="mm-name" type="text" maxlength="60" autocomplete="off" placeholder="Reagent" value="' + LM.esc(r[0]) + '"></td>' +
      '<td class="c-num"><label class="sr" for="pv' + i + '">Volume per reaction, µL</label><input id="pv' + i + '" class="mm-per" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="' + LM.esc(r[1]) + '"></td>' +
      '<td class="c-in"><input class="mm-in" type="checkbox" aria-label="In mix"' + (r[2] ? " checked" : "") + "></td>" +
      '<td class="c-num c-tot mm-out">—</td>' +
      '<td class="c-x"><button type="button" class="mm-x" aria-label="Remove row">×</button></td></tr>';
  }
  function waterHTML() {
    return '<tr class="mm-water" id="waterRow"><td class="c-name">Water <small>(to volume)</small></td><td class="c-num" id="waterPer">—</td>' +
      '<td class="c-in">✓</td><td class="c-num c-tot" id="waterMix">—</td><td class="c-x"></td></tr>';
  }
  function render() {
    tbody.innerHTML = state.rows.map(rowHTML).join("") + (state.topup ? waterHTML() : "");
    update();
  }
  function readRows() {
    state.rows = Array.prototype.map.call(tbody.querySelectorAll("tr[data-i]"), function (tr) {
      return [tr.querySelector(".mm-name").value, tr.querySelector(".mm-per").value, tr.querySelector(".mm-in").checked];
    });
  }

  function setMsg(id, text) {
    $(id + "m").textContent = text || "";
    document.querySelector('[data-term="' + id + '"]').classList.toggle("is-bad", !!text);
  }
  function num(id, opts) {
    var v = LM.parse($(id).value);
    if (v == null) return opts.optional ? null : (setMsg(id, "Required"), NaN);
    if (isNaN(v)) { setMsg(id, "Not a number"); return NaN; }
    if (v < 0 || (!opts.zero && v === 0)) { setMsg(id, opts.zero ? "Can't be negative" : "Must be above zero"); return NaN; }
    if (opts.int && Math.round(v) !== v) { setMsg(id, "Whole number"); return NaN; }
    return v;
  }
  function ul(x) { return LM.fmt(x, 4); }
  function ulShow(x) { return x >= 1000 ? LM.show(x * 1e-6, LM.VOL) : ul(x) + " µL"; }

  // ---------- compute ----------
  function update() {
    readRows();
    ["n", "over", "vol"].forEach(function (id) { setMsg(id, ""); });
    var n = num("n", { int: true });
    var over = num("over", { zero: true, optional: true });
    if (over == null) over = 0;
    var vol = num("vol", { optional: true });
    var mode = $("overMode").value;
    state.n = $("n").value; state.over = $("over").value; state.overMode = mode; state.vol = $("vol").value; state.topup = $("topup").checked;
    if (mode === "rxn" && !isNaN(over) && Math.round(over) !== over) { setMsg("over", "Whole number"); over = NaN; }
    LM.save(KEY, state);

    var nEff = isNaN(n) || isNaN(over) ? NaN : mode === "pct" ? n * (1 + over / 100) : n + over;
    $("totHead").textContent = isNaN(nEff) ? "FOR MIX (µL)" : "× " + LM.fmt(nEff, 4) + " (µL)";

    var trs = tbody.querySelectorAll("tr[data-i]");
    var sumPer = 0, sumMix = 0, perWell = 0, sep = [], bad = false, small = [];
    state.rows.forEach(function (r, i) {
      var tr = trs[i], out = tr.querySelector(".mm-out"), per = LM.parse(r[1]);
      tr.classList.remove("is-bad", "is-out");
      if (per == null) { out.textContent = "—"; return; }
      if (isNaN(per) || per < 0) { tr.classList.add("is-bad"); out.textContent = "?"; bad = true; return; }
      sumPer += per;
      if (r[2]) {
        perWell += per;
        var tot = per * nEff;
        sumMix += tot;
        out.textContent = isNaN(tot) ? "—" : ul(tot);
        if (per > 0 && tot < 1) small.push((r[0] || "Row " + (i + 1)) + " (" + ul(tot) + " µL)");
      } else {
        tr.classList.add("is-out");
        out.textContent = "each well";
        if (per > 0) sep.push([r[0] || "Row " + (i + 1), per]);
      }
    });

    var water = null, notes = [];
    if (state.topup) {
      if (vol == null || isNaN(vol)) {
        $("waterPer").textContent = "—"; $("waterMix").textContent = "—";
        if (vol == null) setMsg("vol", "Needed to top up with water");
      } else {
        water = vol - sumPer;
        if (water < -1e-9) {
          $("waterPer").textContent = "—"; $("waterMix").textContent = "—";
          setMsg("vol", "Reagents add up to " + ul(sumPer) + " µL");
          bad = true;
          notes.push('<li class="note"><b>The reagents add up to ' + ul(sumPer) + " µL, more than the " + ul(vol) + " µL reaction.</b> Raise the reaction volume or lower a reagent.</li>");
        } else {
          water = Math.max(0, water);
          $("waterPer").textContent = ul(water);
          $("waterMix").textContent = isNaN(nEff) ? "—" : ul(water * nEff);
          sumPer += water; perWell += water; sumMix += water * nEff;
        }
      }
    } else if (vol != null && !isNaN(vol) && sumPer > 0 && Math.abs(sumPer - vol) > 1e-6) {
      notes.push('<li class="note info">Rows add up to ' + ul(sumPer) + " µL, not the " + ul(vol) + " µL reaction volume. Tick <b>Top up with water</b> to fill the difference.</li>");
    }
    $("sumPer").textContent = sumPer ? ul(sumPer) : "—";
    $("sumMix").textContent = sumMix && !isNaN(nEff) ? ul(sumMix) : "—";

    if (small.length) notes.push('<li class="note">Under 1 µL in the whole mix: ' + LM.esc(small.join(", ")) + ". Hard to pipette accurately — make mix for more reactions, or dilute that reagent first.</li>");
    $("notes").innerHTML = notes.join("");

    if (isNaN(nEff) || bad) return showEmpty(bad ? "Check the highlighted value." : "Waiting for the number of reactions", bad);
    if (perWell <= 0) return showEmpty("Add your reagents", false, "Type each reagent and its volume per reaction in the table.");
    showResult(n, nEff, mode, over, sumMix, perWell, sep, water);
  }

  function showResult(n, nEff, mode, over, sumMix, perWell, sep, water) {
    $("ans").classList.remove("is-empty", "is-error");
    $("copy").disabled = false; $("print").disabled = false;
    var overT = over ? (mode === "pct" ? " + " + LM.fmt(over) + "%" : " + " + over + " extra") : "";
    $("ansBig").textContent = ulShow(sumMix) + " of mix";
    var sepT = sep.map(function (s) { return ul(s[1]) + " µL " + s[0]; }).join(" and ");
    $("ansSay").innerHTML = "Mix for " + LM.fmt(nEff, 4) + " reactions (" + n + overT + "). Dispense <b>" + ul(perWell) + " µL</b> into each well" +
      (sep.length ? ", then add <b>" + LM.esc(sepT) + "</b>." : ".");
    $("slip").classList.remove("is-empty");
    $("slipN").textContent = n + " RXNS" + overT.toUpperCase();
    $("rEff").textContent = LM.fmt(nEff, 4) + " rxns";
    $("rMix").textContent = ulShow(sumMix);
    $("rWell").textContent = ul(perWell) + " µL";
    $("rSepRow").hidden = !sep.length;
    $("rSep").textContent = sep.map(function (s) { return ul(s[1]) + " µL"; }).join(" + ");
    $("printMeta").textContent = "· " + n + " reactions" + overT + " · mix for " + LM.fmt(nEff, 4) + " · " + new Date().toLocaleDateString();

    var lines = ["Master mix — labmate.tools", n + " reactions" + overT + " → mix for " + LM.fmtPlain(nEff, 4), "", "Reagent\tPer rxn (µL)\tFor mix (µL)"];
    state.rows.forEach(function (r) {
      var per = LM.parse(r[1]);
      if (per == null || isNaN(per)) return;
      lines.push((r[0] || "—") + "\t" + LM.fmtPlain(per) + "\t" + (r[2] ? LM.fmtPlain(per * nEff) : "add to each well"));
    });
    if (water != null) lines.push("Water\t" + LM.fmtPlain(water) + "\t" + LM.fmtPlain(water * nEff));
    lines.push("Total mix\t" + LM.fmtPlain(perWell) + "\t" + LM.fmtPlain(sumMix));
    lines.push("", "Dispense " + LM.fmtPlain(perWell) + " µL mix per well" + (sep.length ? ", then add " + sepT.replace(/ /g, "") : "") + ".");
    lastTable = lines.join("\n");
  }
  function showEmpty(title, isErr, say) {
    $("ans").classList.toggle("is-error", !!isErr); $("ans").classList.toggle("is-empty", !isErr);
    $("copy").disabled = true; $("print").disabled = true;
    $("ansBig").textContent = title;
    $("ansSay").textContent = say || "";
    $("slip").classList.add("is-empty");
    ["rEff", "rMix", "rWell", "rSep"].forEach(function (id) { $(id).textContent = "—"; });
    $("slipN").textContent = "";
    lastTable = "";
  }

  // ---------- events ----------
  tbody.addEventListener("input", update);
  tbody.addEventListener("change", update);
  tbody.addEventListener("click", function (e) {
    var x = e.target.closest(".mm-x");
    if (!x) return;
    readRows();
    var i = +x.closest("tr").getAttribute("data-i");
    state.rows.splice(i, 1);
    if (!state.rows.length) state.rows.push(["", "", true]);
    render();
  });
  $("addRow").addEventListener("click", function () {
    readRows();
    state.rows.push(["", "", true]);
    render();
    var last = tbody.querySelectorAll("tr[data-i]");
    last[last.length - 1].querySelector(".mm-name").focus();
  });
  ["n", "over", "vol"].forEach(function (id) { $(id).addEventListener("input", update); });
  $("overMode").addEventListener("change", update);
  $("topup").addEventListener("change", function () { readRows(); state.topup = $("topup").checked; render(); });
  document.querySelectorAll("[data-preset]").forEach(function (b) {
    b.addEventListener("click", function () {
      var p = PRESETS[b.getAttribute("data-preset")];
      state.rows = JSON.parse(JSON.stringify(p.rows));
      state.topup = p.topup; $("topup").checked = p.topup; $("vol").value = p.vol;
      render();
    });
  });
  $("clear").addEventListener("click", function () {
    state.rows = [["", "", true], ["", "", true], ["", "", true]];
    $("n").value = ""; $("vol").value = ""; $("topup").checked = false; state.topup = false;
    render(); $("n").focus();
  });
  $("copy").addEventListener("click", function () {
    if (!lastTable) return;
    LM.copy(lastTable, function (ok) {
      $("copied").textContent = ok ? "COPIED ✓ — pastes into Excel" : "Copy failed";
      setTimeout(function () { $("copied").textContent = ""; }, 2400);
    });
  });
  $("print").addEventListener("click", function () { window.print(); });

  $("n").value = state.n || ""; $("over").value = state.over == null ? "10" : state.over;
  $("overMode").value = state.overMode === "rxn" ? "rxn" : "pct";
  $("vol").value = state.vol || ""; $("topup").checked = !!state.topup;
  render();
})();
