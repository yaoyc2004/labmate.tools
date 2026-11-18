// labmate.tools — 2.5 qPCR Relative Quantification (page)
(function () {
  "use strict";
  var LM = window.LM, Q = window.LMQ;
  var KEY = "labmate.qpcr.v1";
  var $ = function (id) { return document.getElementById(id); };
  var esc = LM.esc;
  var PAL = ["#2E9E5B", "#17403D", "#B7791F", "#6B4FA0", "#A3341F", "#2C6E9B", "#8A918C", "#C05A8B", "#4F7A28", "#7A5A3A"];
  var BAR = ["#D3E6DD", "#9CC7B6", "#6FA595", "#3F7A6B", "#2B5C53", "#17403D"];
  var REQ = "mailto:hello@labmate.tools?subject=" + encodeURIComponent("qPCR analyser: please support my instrument") +
    "&body=" + encodeURIComponent("Instrument and software version:\n\nExport menu I used:\n\nWhat went wrong (no columns found, wrong genes, …):\n\nIf you can, attach the exported file — sample names can be replaced with codes.\n");

  // ---------------------------------------------------------------- state
  function fresh() {
    return { files: [], nextId: 1, samples: {}, targets: {}, excluded: {}, control: "", calSample: "", err: "sem", scale: "log", sdMax: "0.3", cqMax: "35", pvals: true, onlyFlagged: false, example: false };
  }
  var state = LM.load(KEY);
  if (!state || !Array.isArray(state.files)) state = fresh();
  var res = null, selRow = null, lastErr = "";

  function save() {
    // grids can be large; keep them only while they fit
    var copy = JSON.parse(JSON.stringify(state));
    LM.save(KEY, copy);
  }

  // ---------------------------------------------------------------- loading
  function allWells() {
    var out = [];
    state.files.forEach(function (f) {
      (f.wells || []).forEach(function (w) {
        out.push({ uid: f.id + ":" + w.row, file: f.id, fileName: f.name, well: w.well, sample: w.sample, target: w.target, cq: w.cq, und: w.und, cqRaw: w.cqRaw, task: w.task, qty: w.qty, omit: w.omit, group: w.group });
      });
    });
    return out;
  }
  function fileStem(n) { return String(n || "").replace(/\.[^.]+$/, "").replace(/[_\s-]+(results?|export|cq|ct|cp)$/i, ""); }

  function addParsed(name, p) {
    var f = { id: state.nextId++, name: name, instrument: p.instrument, format: p.format || "", sheet: p.sheet || "" };
    if (p.wells) { // RDML
      f.wells = p.wells.map(function (w, i) { w.row = i; return w; });
    } else {
      f.grid = p.grid; f.det = p.det;
      if (f.det.kind === "long" && f.det.map.target == null && f.det.map.fluor == null) f.fileTarget = fileStem(name);
      f.wells = Q.extract(f.grid, f.det, { fileTarget: f.fileTarget });
    }
    if (!f.wells.length) throw new Error("Columns were found, but no rows with a sample and a Cq value.");
    state.files.push(f);
    adopt();
    return f;
  }
  function reextract(f) {
    if (!f.grid) return;
    f.wells = Q.extract(f.grid, f.det, { fileTarget: f.fileTarget });
    adopt();
  }
  // fill sample and gene tables with anything new; guess groups, references and the control
  function adopt() {
    var W = allWells(), seenS = {}, seenT = {}, newS = [];
    W.forEach(function (w) {
      if (w.target) seenT[w.target] = 1;
      if (w.task !== "unknown" || !w.sample) return;
      seenS[w.sample] = 1;
      if (!state.samples[w.sample]) {
        var sp = Q.splitName(w.sample);
        state.samples[w.sample] = { group: w.group || sp.group, rep: w.group ? "" : sp.rep, use: true, auto: !w.group };
        newS.push(w.sample);
      }
    });
    // one group for everything is useless: fall back to one group per sample name
    var autos = Object.keys(state.samples).filter(function (s) { return state.samples[s].auto; });
    var gs = {};
    autos.forEach(function (s) { gs[state.samples[s].group] = 1; });
    if (autos.length > 1 && Object.keys(gs).length === 1 && newS.length) {
      autos.forEach(function (s) { state.samples[s].group = s; state.samples[s].rep = ""; });
    }
    Object.keys(state.samples).forEach(function (s) { if (!seenS[s]) delete state.samples[s]; });
    Object.keys(seenT).forEach(function (t) {
      if (state.targets[t]) return;
      var std = W.filter(function (w) { return w.target === t && w.task === "standard" && w.qty > 0 && w.cq != null; });
      state.targets[t] = { role: Q.REF_NAMES.test(t.replace(/\s+/g, "")) || Q.REF_NAMES.test(t) ? "ref" : "goi", eff: std.length >= 3 ? "curve" : "auto", typed: "" };
    });
    Object.keys(state.targets).forEach(function (t) { if (!seenT[t]) delete state.targets[t]; });
    var groups = groupList();
    if (groups.indexOf(state.control) < 0) {
      state.control = groups.filter(function (g) { return Q.CTRL_NAMES.test(g.trim()); })[0] || groups[0] || "";
    }
    if (state.calSample && !state.samples[state.calSample]) state.calSample = "";
  }
  function groupList() {
    var out = [];
    Object.keys(state.samples).forEach(function (s) { var o = state.samples[s]; if (o.use !== false && o.group && out.indexOf(o.group) < 0) out.push(o.group); });
    return out;
  }

  function readFiles(list) {
    var arr = Array.prototype.slice.call(list), msgs = [];
    var chain = Promise.resolve();
    arr.forEach(function (file) {
      chain = chain.then(function () {
        return file.arrayBuffer().then(function (buf) { return Q.readAny(file.name, buf); }).then(function (p) {
          if (p.record) { openRecord(p.record, file.name); msgs.push(file.name + ": record opened"); return; }
          if (state.example) { state = fresh(); }
          var f = addParsed(file.name, p);
          msgs.push(file.name + ": " + f.instrument + ", " + f.wells.length + " wells");
        }).catch(function (e) { msgs.push("✗ " + file.name + ": " + e.message); });
      });
    });
    return chain.then(function () { loadMsg(msgs); render(); });
  }
  function loadMsg(msgs) {
    var bad = msgs.some(function (m) { return m.charAt(0) === "✗"; });
    $("loadMsg").innerHTML = msgs.map(function (m) { return "<span" + (m.charAt(0) === "✗" ? ' class="bad"' : "") + ">" + esc(m) + "</span>"; }).join("") +
      (bad ? ' <span>Your instrument not recognised? <a href="' + REQ + '">Ask for it to be added</a>.</span>' : "");
  }
  function usePaste() {
    var t = $("pasteText").value;
    if (!t.trim()) return;
    try {
      var grid = Q.textGrid(t), det = Q.detect(grid);
      if (!det) throw new Error("No column of Cq / Ct values was found. Include the header row.");
      if (state.example) state = fresh();
      var f = addParsed("Pasted table", { grid: grid, det: det, instrument: Q.instrument(grid, det), format: "paste" });
      loadMsg(["Pasted table: " + f.instrument + ", " + f.wells.length + " wells"]);
      $("pasteText").value = "";
    } catch (e) { loadMsg(["✗ Pasted table: " + e.message]); }
    render();
  }
  function loadExample() {
    return fetch("example-quantstudio.txt").then(function (r) { if (!r.ok) throw new Error("not found"); return r.text(); }).then(function (t) {
      state = fresh();
      var grid = Q.textGrid(t), det = Q.detect(grid);
      addParsed("example-quantstudio.txt", { grid: grid, det: det, instrument: Q.instrument(grid, det), format: "text" });
      state.example = true;
      render();
    }).catch(function () { loadMsg(["✗ The example file could not be loaded."]); });
  }

  // ---------------------------------------------------------------- analysis
  function coreInput() {
    var targets = {};
    Object.keys(state.targets).forEach(function (t) {
      var o = state.targets[t];
      targets[t] = { role: o.role, eff: o.eff === "typed" ? (o.typed || "auto") : o.eff };
    });
    var samples = {};
    Object.keys(state.samples).forEach(function (s) { samples[s] = { group: (state.samples[s].group || "").trim(), use: state.samples[s].use !== false }; });
    return {
      wells: allWells(), samples: samples, targets: targets, excluded: state.excluded,
      control: state.control, calSample: state.calSample, sdMax: LM.parse(state.sdMax) || 0.3, cqMax: LM.parse(state.cqMax) || 35, conf: 0.95
    };
  }

  // ---------------------------------------------------------------- formatting
  function f2(x) { return x == null || !isFinite(x) ? "—" : x.toFixed(2); }
  function fc(x) { return x == null || !isFinite(x) ? "—" : LM.fmt(x, 3); }
  function pFmt(p) { if (p == null || !isFinite(p)) return "—"; return p < 0.001 ? "< 0.001" : p < 0.01 ? p.toFixed(3) : p.toFixed(2); }
  function errName() { return { sem: "SEM", sd: "SD", ci: "95% CI" }[state.err]; }
  function flagHtml(fl) { return '<span class="pp-flag" title="' + esc(fl[1]) + '">' + esc(fl[0]) + "</span>"; }
  function tcolor(t) { var ts = Object.keys(state.targets).sort(); return PAL[ts.indexOf(t) % PAL.length]; }

  // ---------------------------------------------------------------- render
  function render() {
    var has = state.files.length > 0;
    document.body.classList.toggle("qp-empty", !has);
    renderFiles();
    if (has) {
      try { res = Q.analyze(coreInput()); lastErr = ""; }
      catch (e) { res = null; lastErr = e.message; }
    } else res = null;
    renderDesign();
    renderQC();
    renderResults();
    $("exampleNote").hidden = !state.example;
    save();
  }

  function renderFiles() {
    var box = $("files");
    if (!state.files.length) { box.innerHTML = ""; return; }
    box.innerHTML = state.files.map(function (f) {
      var ts = {}, ss = {}, std = 0, ntc = 0;
      f.wells.forEach(function (w) { if (w.target) ts[w.target] = 1; if (w.task === "unknown") ss[w.sample] = 1; if (w.task === "standard") std++; if (w.task === "ntc" || w.task === "nrt") ntc++; });
      var h = '<div class="qp-file" data-f="' + f.id + '"><div class="qp-file-h"><b>' + esc(f.name) + "</b>" +
        '<span class="qp-inst">' + esc(f.instrument) + (f.sheet ? " · sheet “" + esc(f.sheet) + "”" : "") + "</span>" +
        '<button type="button" class="c-x" data-rm="' + f.id + '" aria-label="Remove ' + esc(f.name) + '">×</button></div>' +
        '<div class="qp-file-s">' + f.wells.length + " wells · " + Object.keys(ss).length + " samples · " + Object.keys(ts).length + " genes" +
        (std ? " · " + std + " standards" : "") + (ntc ? " · " + ntc + " NTC/NRT" : "") + "</div>";
      if (f.grid && f.det && f.det.kind === "long") {
        var opts = function (role) {
          var cur = f.det.map[role];
          return '<option value="">—</option>' + f.det.header.map(function (c, i) { return c ? '<option value="' + i + '"' + (cur === i ? " selected" : "") + ">" + esc(c) + "</option>" : ""; }).join("");
        };
        var roles = [["sample", "SAMPLE"], ["target", "GENE"], ["cq", "Cq"], ["well", "WELL"], ["task", "TYPE"], ["qty", "STD QUANTITY"]];
        h += '<details class="qp-map"><summary>COLUMNS USED</summary><div class="qp-map-g">' + roles.map(function (r) {
          return '<label><span>' + r[1] + '</span><select data-map="' + r[0] + '" data-f="' + f.id + '">' + opts(r[0]) + "</select></label>";
        }).join("") + "</div></details>";
        if (f.det.map.target == null) {
          h += '<label class="qp-ft">No gene column in this file — gene name for all its wells: <input type="text" class="pp-in" data-ft="' + f.id + '" value="' + esc(f.fileTarget || "") + '"></label>';
        }
      } else if (f.det && f.det.kind === "wide") {
        h += '<div class="qp-file-s">Read as a table of samples (rows) × genes (columns); repeated sample rows are technical replicates.</div>';
      }
      return h + "</div>";
    }).join("");
  }

  function renderDesign() {
    var sNames = Object.keys(state.samples);
    var groups = groupList();
    $("sampleRows").innerHTML = sNames.map(function (s) {
      var o = state.samples[s];
      return "<tr" + (o.use === false ? ' class="is-off"' : "") + '><td class="nm">' + esc(s) + "</td>" +
        '<td><input type="text" class="pp-in" data-sg="' + esc(s) + '" value="' + esc(o.group || "") + '" aria-label="Group of ' + esc(s) + '"></td>' +
        '<td class="u"><input type="checkbox" data-su="' + esc(s) + '"' + (o.use !== false ? " checked" : "") + ' aria-label="Use ' + esc(s) + '"></td></tr>';
    }).join("");
    $("sampleCount").textContent = sNames.length ? sNames.length + " samples · " + groups.length + " groups" : "";
    var W = allWells();
    $("targetRows").innerHTML = Object.keys(state.targets).sort().map(function (t) {
      var o = state.targets[t], e = res && res.eff[t];
      var hasStd = W.some(function (w) { return w.target === t && w.task === "standard"; });
      var effSay = e ? "E = " + e.E.toFixed(3) + " · " + e.pct.toFixed(1) + "%" : "";
      return '<tr><td class="nm"><i class="qp-dot" style="background:' + tcolor(t) + '"></i>' + esc(t) + "</td>" +
        '<td><select data-tr="' + esc(t) + '" aria-label="Role of ' + esc(t) + '">' +
        [["goi", "Target gene"], ["ref", "Reference gene"], ["skip", "Leave out"]].map(function (x) { return '<option value="' + x[0] + '"' + (o.role === x[0] ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select></td>" +
        '<td><select data-te="' + esc(t) + '" aria-label="Efficiency of ' + esc(t) + '">' +
        '<option value="auto"' + (o.eff === "auto" ? " selected" : "") + ">100% (E = 2)</option>" +
        '<option value="curve"' + (o.eff === "curve" ? " selected" : "") + (hasStd ? "" : " disabled") + ">From standard wells</option>" +
        '<option value="typed"' + (o.eff === "typed" ? " selected" : "") + ">Enter value</option></select>" +
        (o.eff === "typed" ? ' <input type="text" class="pp-in qp-eff" data-tt="' + esc(t) + '" value="' + esc(o.typed || "") + '" placeholder="95 or 1.95" inputmode="decimal" aria-label="Efficiency value for ' + esc(t) + '">' : "") +
        "</td>" +
        '<td class="n">' + (o.role === "skip" ? "" : esc(effSay)) + (e && e.flags.length && o.role !== "skip" ? " " + e.flags.map(flagHtml).join(" ") : "") + "</td></tr>";
    }).join("");

    var ctl = $("control");
    ctl.innerHTML = groups.map(function (g) { return '<option value="' + esc(g) + '"' + (g === state.control ? " selected" : "") + ">" + esc(g) + "</option>"; }).join("");
    var cs = $("calSample");
    cs.innerHTML = '<option value="">Mean of the control group</option>' + sNames.filter(function (s) { return state.samples[s].use !== false; }).map(function (s) {
      return '<option value="' + esc(s) + '"' + (s === state.calSample ? " selected" : "") + ">One sample: " + esc(s) + "</option>";
    }).join("");
    setSeg("errSeg", state.err); setSeg("scaleSeg", state.scale);
    $("sdMax").value = state.sdMax; $("cqMax").value = state.cqMax; $("pvals").checked = !!state.pvals;
  }
  function setSeg(id, v) { Array.prototype.forEach.call($(id).querySelectorAll("button"), function (b) { b.setAttribute("aria-pressed", b.dataset.v === v ? "true" : "false"); }); }

  // ---------- QC
  function renderQC() {
    if (!res) { ["plates", "repRows", "effBox", "refBox", "ntcBox"].forEach(function (id) { $(id).innerHTML = ""; }); $("qcSum").textContent = ""; return; }
    // plate maps
    var flaggedUid = {};
    res.reps.forEach(function (r) { if (r.suggest) flaggedUid[r.suggest] = 1; });
    var W = allWells();
    $("plates").innerHTML = state.files.map(function (f) {
      var ws = W.filter(function (w) { return w.file === f.id && /^[A-P]\d{1,2}$/.test(w.well); });
      if (!ws.length) return "";
      var big = ws.some(function (w) { return w.well.charCodeAt(0) > 72 || +w.well.slice(1) > 12; });
      var R = big ? 16 : 8, C = big ? 24 : 12, at = {};
      ws.forEach(function (w) { (at[w.well] = at[w.well] || []).push(w); });
      var h = '<div class="qp-plate-k">' + esc(f.name) + (big ? " · 384" : " · 96") + '</div><div class="mm-wrap"><table class="qp-plate' + (big ? " is-384" : "") + '"><thead><tr><th></th>';
      for (var c = 1; c <= C; c++) h += "<th>" + c + "</th>";
      h += "</tr></thead><tbody>";
      for (var r = 0; r < R; r++) {
        var L = String.fromCharCode(65 + r);
        h += "<tr><th>" + L + "</th>";
        for (c = 1; c <= C; c++) {
          var list = at[L + c];
          if (!list) { h += '<td class="e"></td>'; continue; }
          var w0 = list[0], ex = list.every(function (w) { return w.omit || state.excluded[w.uid]; });
          var tip = list.map(function (w) { return L + c + " · " + (w.sample || "—") + " · " + (w.target || "—") + " · " + (w.task === "unknown" ? "" : w.task.toUpperCase() + " · ") + "Cq " + (w.cq == null ? (w.cqRaw || "none") : w.cq.toFixed(2)) + (w.omit ? " · omitted in instrument" : ""); }).join("\n");
          var mark = w0.task === "standard" ? "S" : w0.task === "ntc" ? "N" : w0.task === "nrt" ? "R" : "";
          h += '<td><button type="button" class="qp-w' + (ex ? " is-ex" : "") + (list.some(function (w) { return flaggedUid[w.uid]; }) ? " is-flag" : "") + (w0.cq == null ? " is-und" : "") +
            '" data-well="' + esc(f.id + "|" + L + c) + '" title="' + esc(tip) + '" style="border-top-color:' + tcolor(w0.target) + '">' +
            (mark ? "<i>" + mark + "</i>" : "") + (big ? "" : (w0.cq == null ? "–" : w0.cq.toFixed(1))) + "</button></td>";
        }
        h += "</tr>";
      }
      return h + "</tbody></table></div>";
    }).join("");
    $("plateLegend").innerHTML = Object.keys(state.targets).sort().map(function (t) { return '<span><i class="qp-dot" style="background:' + tcolor(t) + '"></i>' + esc(t) + "</span>"; }).join("") +
      '<span><b>S</b> standard</span><span><b>N</b> NTC</span><span><b>R</b> no-RT</span><span class="qp-lg-ex">excluded</span><span class="qp-lg-fl">suggested outlier</span>';

    // replicate table
    var reps = res.reps.filter(function (r) { return !state.onlyFlagged || r.flags.length || r.nEx; });
    var nFlag = res.reps.filter(function (r) { return r.flags.length; }).length;
    $("repRows").innerHTML = reps.map(function (r) {
      var chips = r.wells.map(function (w) {
        var ex = w.omit || state.excluded[w.uid];
        return '<button type="button" class="qp-chip' + (ex ? " is-ex" : "") + (r.suggest === w.uid ? " is-flag" : "") + (w.cq == null ? " is-und" : "") + '" data-uid="' + esc(w.uid) + '"' +
          (w.omit ? " disabled" : "") + ' title="' + esc((w.well ? w.well + " · " : "") + (ex ? (w.omit ? "omitted in the instrument software" : "excluded — click to use again") : "click to exclude this well")) + '">' +
          (w.cq == null ? "und." : w.cq.toFixed(2)) + "</button>";
      }).join("");
      return '<tr class="' + (r.flags.length ? "is-warn" : "") + '"><td class="nm" data-l="SAMPLE">' + esc(r.sample) + '</td><td class="nm" data-l="GENE"><i class="qp-dot" style="background:' + tcolor(r.target) + '"></i>' + esc(r.target) + "</td>" +
        '<td class="qp-chips" data-l="WELLS">' + chips + (r.suggest ? ' <span class="qp-sug">drop the red one?</span>' : "") + "</td>" +
        '<td class="n" data-l="MEAN">' + f2(r.mean) + '</td><td class="n" data-l="SD">' + (isFinite(r.sd) ? r.sd.toFixed(3) : "—") + "</td>" +
        '<td class="ck" data-l="CHECK">' + (r.flags.length ? r.flags.map(flagHtml).join(" ") : '<span class="dt-ok">✓</span>') + "</td></tr>";
    }).join("") || '<tr><td colspan="6" class="qp-none">' + (state.onlyFlagged ? "No flagged replicates." : "No sample wells.") + "</td></tr>";
    var nEx = Object.keys(state.excluded).length;
    $("qcSum").textContent = res.reps.length + " sample × gene sets · " + nFlag + " flagged · " + nEx + " well" + (nEx === 1 ? "" : "s") + " excluded by you";
    $("onlyFlagged").checked = !!state.onlyFlagged;

    // efficiency curves
    var effT = Object.keys(res.eff).filter(function (t) { return res.eff[t].curve && res.eff[t].curve.points.length >= 3; });
    $("effBox").innerHTML = effT.length ? effT.map(function (t) {
      var c = res.eff[t].curve, fit = c.fit;
      return '<div class="qp-curve"><div class="qp-curve-h"><b>' + esc(t) + "</b> " + (isFinite(c.E) ? "slope " + fit.slope.toFixed(3) + " · E = " + c.E.toFixed(3) + " · <b>" + c.pct.toFixed(1) + "%</b> · R² " + fit.r2.toFixed(4) + " · " + c.levels + " levels" : "no usable slope") +
        (state.targets[t] && state.targets[t].eff !== "curve" ? ' <span class="pp-flag is-info">NOT USED</span>' : "") + "</div>" + curveSvg(c, t) +
        (res.eff[t].flags.length ? '<div class="qp-curve-f">' + res.eff[t].flags.map(flagHtml).join(" ") + "</div>" : "") + "</div>";
    }).join("") : '<p class="cs-hint">No standard-curve wells in the file. Efficiencies are 100% unless you enter measured values in step 2.</p>';

    // reference stability
    var rb = "";
    if (res.genorm) {
      rb += '<table class="pp-table qp-small"><thead><tr><th>REFERENCE</th><th class="n">geNorm M</th><th>READS AS</th></tr></thead><tbody>' + res.genorm.map(function (g) {
        return '<tr><td class="nm">' + esc(g.target) + '</td><td class="n">' + g.M.toFixed(3) + "</td><td>" + (g.M < 0.5 ? "stable (≤ 0.5, homogeneous samples)" : g.M < 1 ? "acceptable for tissue (< 1)" : "unstable — check this gene") + "</td></tr>";
      }).join("") + '</tbody></table><p class="cs-hint">M from ' + res.genormN + " samples (Vandesompele 2002). With two references both get the same M.</p>";
    } else if (res.refs.length === 1) rb += '<p class="cs-hint">One reference gene: stability can\'t be checked against another reference. MIQE recommends two or more, validated for your samples.</p>';
    if (res.refShift) {
      rb += '<p class="cs-hint">Reference level by group (mean log₂ of the reference quantities): ' + res.refShift.groups.map(function (g) { return esc(g.group) + " " + (g.mean >= 0 ? "+" : "") + g.mean.toFixed(2); }).join(" · ") +
        " — spread " + res.refShift.range.toFixed(2) + (res.refShift.range > 0.5 ? ' <span class="pp-flag">REFERENCE SHIFT</span>' : " ✓") + "</p>";
    }
    $("refBox").innerHTML = rb;

    // NTC
    $("ntcBox").innerHTML = res.ntc.length ? '<table class="pp-table qp-small"><thead><tr><th>WELL</th><th>GENE</th><th>TYPE</th><th class="n">Cq</th><th>CHECK</th></tr></thead><tbody>' + res.ntc.map(function (o) {
      return '<tr><td>' + esc(o.well || o.sample || "") + '</td><td class="nm">' + esc(o.target) + "</td><td>" + o.task.toUpperCase() + '</td><td class="n">' + (o.cq == null ? "none" : o.cq.toFixed(2)) + "</td><td>" +
        (o.verdict === "clean" ? '<span class="dt-ok">✓ no amplification</span>' : o.verdict === "warn" ? '<span class="pp-flag">WITHIN 5 CYCLES</span>' : '<span class="pp-flag is-info">LATE</span> ' + (isFinite(o.gap) ? o.gap.toFixed(1) + " cycles after the latest sample" : "")) + "</td></tr>";
    }).join("") + "</tbody></table>" : '<p class="cs-hint">No NTC or no-RT wells marked in the file.</p>';
  }

  function curveSvg(c, t) {
    var W = 360, H = 170, ml = 40, mr = 10, mt = 10, mb = 30;
    var xs = c.points.map(function (p) { return Math.log10(p.qty); }), ys = c.points.map(function (p) { return p.cq; });
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs)); if (x1 === x0) x1++;
    var y0 = Math.floor(Math.min.apply(null, ys) - 0.5), y1 = Math.ceil(Math.max.apply(null, ys) + 0.5);
    var X = function (v) { return ml + (v - x0) / (x1 - x0) * (W - ml - mr); }, Y = function (v) { return mt + (y1 - v) / (y1 - y0) * (H - mt - mb); };
    var s = '<svg class="qp-cv" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Standard curve for ' + esc(t) + '">';
    for (var k = x0; k <= x1; k++) s += '<line x1="' + X(k) + '" x2="' + X(k) + '" y1="' + mt + '" y2="' + (H - mb) + '" class="g"/><text x="' + X(k) + '" y="' + (H - mb + 14) + '" text-anchor="middle">10' + supNum(k) + "</text>";
    var step = y1 - y0 > 12 ? 4 : 2;
    for (k = Math.ceil(y0 / step) * step; k <= y1; k += step) s += '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + Y(k) + '" y2="' + Y(k) + '" class="g"/><text x="' + (ml - 5) + '" y="' + (Y(k) + 4) + '" text-anchor="end">' + k + "</text>";
    s += '<text x="' + (W / 2 + ml / 2) + '" y="' + (H - 3) + '" text-anchor="middle" class="ax">quantity (log scale)</text><text x="10" y="' + (mt + 8) + '" class="ax">Cq</text>';
    if (isFinite(c.fit.slope)) s += '<line x1="' + X(x0) + '" y1="' + Y(c.fit.intercept + c.fit.slope * x0) + '" x2="' + X(x1) + '" y2="' + Y(c.fit.intercept + c.fit.slope * x1) + '" class="fit"/>';
    c.points.forEach(function (p) { s += '<circle cx="' + X(Math.log10(p.qty)) + '" cy="' + Y(p.cq) + '" r="3.5" class="pt"/>'; });
    return s + "</svg>";
  }
  function supNum(n) { return String(n).split("").map(function (ch) { return { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" }[ch] || ch; }).join(""); }

  // ---------- results
  function renderResults() {
    var warnBox = $("warnings");
    if (!res) {
      $("chart").innerHTML = state.files.length ? "" : '<p class="qp-wait">Open an export file, paste a table, or try the example — the results appear here.</p>';
      $("resRows").innerHTML = ""; $("perRows").innerHTML = ""; $("work").innerHTML = ""; warnBox.innerHTML = lastErr ? "<li>" + esc(lastErr) + "</li>" : "";
      setExport(false); return;
    }
    var notes = res.warnings.map(function (w) { return "<li><b>" + esc(w[0]) + "</b> " + esc(w[1]) + "</li>"; });
    if (res.assumed.length && res.gois.length && res.refs.length) notes.push('<li class="info"><b>EFFICIENCY 100%</b> Assumed for ' + esc(res.assumed.join(", ")) + " — this is the 2<sup>−ΔΔCq</sup> (Livak) method. Enter measured efficiencies in step 2 if you have them.</li>");
    var oneRep = res.groups.filter(function (g) { return g.n === 1; }).length;
    if (oneRep) notes.push('<li class="info"><b>ONE SAMPLE PER GROUP</b> Error bars show only the technical error of the wells — they say nothing about biological variation, and no p-values are given.</li>');
    if (res.groupNames.length < 2 && res.gois.length) notes.push("<li><b>ONE GROUP</b> Put the samples into at least two groups in step 2 to compare them.</li>");
    warnBox.innerHTML = notes.join("");

    var ok = res.groups.some(function (g) { return g.n > 0; });
    $("chart").innerHTML = ok ? chartSvg() : '<p class="qp-wait">Nothing to plot yet — see the notes above.</p>';
    setExport(ok);

    // group table
    $("resRows").innerHTML = res.groups.map(function (g) {
      var b = Q.bar(g, state.err);
      if (!g.n) return '<tr class="is-err"><td class="nm">' + esc(g.target) + '</td><td class="nm">' + esc(g.group) + '</td><td class="n">0</td><td colspan="5">no usable samples</td></tr>';
      return "<tr" + (g.isControl ? ' class="is-ctl"' : "") + '><td class="nm"><i>' + esc(g.target) + '</i></td><td class="nm">' + esc(g.group) + (g.isControl ? ' <small>control</small>' : "") + '</td><td class="n">' + g.n + "</td>" +
        '<td class="n"><b>' + fc(g.fc) + "</b></td>" +
        '<td class="n">' + (b && isFinite(b.h) ? fc(b.lo) + "–" + fc(b.hi) : "—") + "</td>" +
        '<td class="n">' + (Math.abs(g.mean) < 0.005 ? "" : g.mean > 0 ? "+" : "−") + Math.abs(g.mean).toFixed(2) + (b && isFinite(b.h) ? " ± " + b.h.toFixed(2) : "") + "</td>" +
        '<td class="n">' + (g.isControl ? "" : pFmt(g.pAdj)) + "</td></tr>";
    }).join("");
    $("errHead").textContent = g1(errName());
    function g1(s) { return (res.groups.some(function (g) { return g.n === 1; }) ? s + " / tech. SE" : s); }

    // per sample
    $("perRows").innerHTML = res.perSample.map(function (r, i) {
      if (r.skip) return '<tr class="is-err"><td class="nm">' + esc(r.sample) + '</td><td class="nm">' + esc(r.group) + '</td><td class="nm"><i>' + esc(r.target) + '</i></td><td class="n">' + f2(r.cq) + '</td><td colspan="4">not calculated: ' + esc(r.skip) + "</td></tr>";
      return '<tr data-i="' + i + '"' + (selRow === i ? ' class="is-sel"' : "") + '><td class="nm">' + esc(r.sample) + '</td><td class="nm">' + esc(r.group) + '</td><td class="nm"><i>' + esc(r.target) + '</i></td><td class="n">' + f2(r.cq) + '</td><td class="n">' + r.dq.toFixed(3) + '</td><td class="n">' + r.nf.toFixed(3) + '</td><td class="n">' + r.log2.toFixed(3) + '</td><td class="n"><b>' + fc(r.nrq) + "</b></td></tr>";
    }).join("");
    drawWork();
    $("methods").textContent = methodsText();
  }
  function setExport(on) { ["copy", "csv", "png", "svg", "json", "copyMethods", "print"].forEach(function (id) { $(id).disabled = !on; }); }

  function drawWork() {
    var box = $("work");
    var rows = res.perSample;
    var r = rows[selRow];
    if (!r || r.skip) { selRow = null; r = rows.filter(function (x) { return !x.skip; })[0]; if (r) selRow = rows.indexOf(r); }
    if (!r) { box.innerHTML = ""; return; }
    var e = res.eff[r.target], rep = res.repMap[r.sample][r.target];
    var l = function (t) { return Math.log(res.eff[t].E) / Math.LN2; };
    var refParts = res.refs.map(function (t) {
      var rr = res.repMap[r.sample][t];
      return "<tr><td><i>" + esc(t) + "</i></td><td>" + res.eff[t].E.toFixed(3) + "</td><td>" + res.cal[t].toFixed(3) + "</td><td>" + rr.mean.toFixed(3) + "</td><td>" + l(t).toFixed(4) + " × (" + res.cal[t].toFixed(3) + " − " + rr.mean.toFixed(3) + ") = <b>" + (l(t) * (res.cal[t] - rr.mean)).toFixed(4) + "</b></td></tr>";
    }).join("");
    box.innerHTML = '<div class="dt-work-h"><span>WORKING</span><b>' + esc(r.sample) + " · " + esc(r.target) + '</b><span class="dt-work-note">tap another row in the table above</span></div>' +
      '<div class="mm-wrap"><table class="qp-wt"><thead><tr><th>GENE</th><th>E</th><th>Cq CALIBRATOR</th><th>Cq SAMPLE</th><th>log₂ RQ = log₂E × (Cq cal − Cq sample)</th></tr></thead><tbody>' +
      '<tr class="goi"><td><i>' + esc(r.target) + "</i></td><td>" + e.E.toFixed(3) + "</td><td>" + res.cal[r.target].toFixed(3) + "</td><td>" + rep.mean.toFixed(3) + "</td><td>" + l(r.target).toFixed(4) + " × (" + res.cal[r.target].toFixed(3) + " − " + rep.mean.toFixed(3) + ") = <b>" + r.dq.toFixed(4) + "</b></td></tr>" +
      refParts + "</tbody></table></div>" +
      '<dl class="dt-dl"><dt>normalisation factor</dt><dd>log₂ NF = mean of the reference log₂ RQ = <b>' + r.nf.toFixed(4) + "</b>" + (res.refs.length > 1 ? " (geometric mean of " + res.refs.length + " references)" : "") + "</dd>" +
      "<dt>relative expression</dt><dd>log₂ NRQ = " + r.dq.toFixed(4) + " − " + r.nf.toFixed(4) + " = <b>" + r.log2.toFixed(4) + "</b> → NRQ = 2^" + r.log2.toFixed(4) + " = <b>" + LM.fmt(r.nrq, 4) + "</b></dd>" +
      "<dt>technical SE</dt><dd>" + (isFinite(r.se) ? r.se.toFixed(4) + " log₂ units, from the SD of the replicate wells" : "— (single wells)") + "</dd>" +
      "<dt>calibrator</dt><dd>" + (state.calSample ? "sample " + esc(state.calSample) : "mean Cq of the " + esc(res.control) + " group (" + res.calSamples.length + " samples)") + "</dd></dl>" +
      '<p class="dt-work-say">With every E = 2 this is exactly −ΔΔCq. Group fold change = 2 ^ (mean of the samples\' log₂ NRQ) — a geometric mean.</p>';
  }

  // ---------- chart
  function chartSvg(forExport) {
    var gois = res.gois.filter(function (t) { return res.groups.some(function (g) { return g.target === t && g.n; }); });
    var G = res.groupNames, log = state.scale === "log";
    var box = $("chart"), narrow = !forExport && box && box.clientWidth > 0 && box.clientWidth < 620;
    var cols = Math.min(gois.length, narrow ? 1 : 3), rows = Math.ceil(gois.length / cols);
    var pw = Math.max(280, 92 * G.length + 90), ph = 320, W = Math.max(pw * cols, narrow ? 300 : 560), H = ph * rows + 40;
    // shared y range per panel
    function panel(t, px, py) {
      var gs = G.map(function (g) { return res.groups.filter(function (x) { return x.target === t && x.group === g; })[0]; });
      var lo = Infinity, hi = -Infinity;
      gs.forEach(function (g) {
        if (!g || !g.n) return;
        var b = Q.bar(g, state.err);
        var vals = g.values.map(function (v) { return log ? v : Math.pow(2, v); }).concat(b && isFinite(b.h) ? [log ? g.mean - b.h : b.lo, log ? g.mean + b.h : b.hi] : [log ? g.mean : g.fc]);
        vals.forEach(function (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); });
      });
      var y0, y1, ticks = [];
      if (log) {
        y0 = Math.floor(Math.min(lo, 0) - 0.15); y1 = Math.ceil(Math.max(hi, 0) + 0.15);
        if (y1 - y0 < 2) { y1 = y0 + 2; }
        var st = y1 - y0 > 10 ? 2 : 1;
        for (var k = y0; k <= y1; k += st) ticks.push(k);
      } else {
        y0 = 0; var top = Math.max(hi, 1) * 1.12, mag = Math.pow(10, Math.floor(Math.log10(top))), step = top / mag > 5 ? mag : top / mag > 2 ? mag / 2 : mag / 5;
        y1 = Math.ceil(top / step) * step;
        for (k = 0; k <= y1 + 1e-9; k += step) ticks.push(+k.toPrecision(6));
      }
      var ml = 56, mr = 12, mt = 34, mb = 50, iw = pw - ml - mr, ih = ph - mt - mb;
      var Y = function (v) { return py + mt + (y1 - v) / (y1 - y0) * ih; };
      var bw = Math.min(46, iw / G.length * 0.62), X = function (i) { return px + ml + (i + 0.5) * iw / G.length; };
      var s = '<text x="' + (px + ml) + '" y="' + (py + 18) + '" class="qt">' + esc(t) + "</text>";
      ticks.forEach(function (k) {
        s += '<line x1="' + (px + ml) + '" x2="' + (px + pw - mr) + '" y1="' + Y(k) + '" y2="' + Y(k) + '" class="' + ((log && k === 0) || (!log && k === 1) ? "one" : "g") + '"/>' +
          '<text x="' + (px + ml - 6) + '" y="' + (Y(k) + 4) + '" text-anchor="end" class="tk">' + (log ? tickLog(k) : LM.fmtPlain(k, 3)) + "</text>";
      });
      s += '<line x1="' + (px + ml) + '" x2="' + (px + ml) + '" y1="' + (py + mt) + '" y2="' + (py + mt + ih) + '" class="ax"/>';
      var base = log ? 0 : 0;
      gs.forEach(function (g, i) {
        var cx = X(i), lab = G[i].length > 11 ? G[i].slice(0, 10) + "…" : G[i];
        s += '<text x="' + cx + '" y="' + (py + mt + ih + 18) + '" text-anchor="middle" class="gl">' + esc(lab) + "</text>";
        if (!g || !g.n) { s += '<text x="' + cx + '" y="' + Y((y0 + y1) / 2) + '" text-anchor="middle" class="tk">n/a</text>'; return; }
        s += '<text x="' + cx + '" y="' + (py + mt + ih + 32) + '" text-anchor="middle" class="tk">n = ' + g.n + "</text>";
        var v = log ? g.mean : g.fc, ya = Y(v), yb = Y(base);
        s += '<rect x="' + (cx - bw / 2) + '" y="' + Math.min(ya, yb) + '" width="' + bw + '" height="' + Math.max(1, Math.abs(yb - ya)) + '" fill="' + BAR[i % BAR.length] + '" class="bar"/>';
        var b = Q.bar(g, state.err), top = Math.min(ya, yb);
        if (b && isFinite(b.h) && b.h > 0) {
          var e1 = Y(log ? g.mean - b.h : b.lo), e2 = Y(log ? g.mean + b.h : b.hi);
          s += '<line x1="' + cx + '" x2="' + cx + '" y1="' + e1 + '" y2="' + e2 + '" class="eb"/><line x1="' + (cx - 7) + '" x2="' + (cx + 7) + '" y1="' + e1 + '" y2="' + e1 + '" class="eb"/><line x1="' + (cx - 7) + '" x2="' + (cx + 7) + '" y1="' + e2 + '" y2="' + e2 + '" class="eb"/>';
          top = Math.min(top, e2);
        }
        g.values.forEach(function (val, j) {
          var dx = (j - (g.values.length - 1) / 2) * Math.min(7, bw / Math.max(1, g.values.length));
          var yy = Y(log ? val : Math.pow(2, val));
          s += '<circle cx="' + (cx + dx) + '" cy="' + yy + '" r="3.3" class="dot"><title>' + esc(g.samples[j]) + ": " + LM.fmtPlain(Math.pow(2, val), 4) + "</title></circle>";
          top = Math.min(top, yy);
        });
        if (state.pvals && !g.isControl && g.pAdj != null && isFinite(g.pAdj)) {
          s += '<text x="' + cx + '" y="' + (top - 7) + '" text-anchor="middle" class="pv">p ' + (g.pAdj < 0.001 ? "&lt; 0.001" : "= " + pFmt(g.pAdj)) + "</text>";
        }
      });
      return s;
    }
    var body = "";
    gois.forEach(function (t, i) { body += panel(t, (i % cols) * pw, Math.floor(i / cols) * ph); });
    var yl = "Fold change vs " + (state.calSample ? state.calSample : res.control) + (log ? " (log scale)" : "");
    var foot = "Bars: geometric mean · error bars: " + errName() + " · dots: biological replicates" + (state.pvals ? " · p: Welch t-test vs " + res.control + ", Holm-adjusted" : "");
    var lines = [yl], cur = "", maxc = narrow ? 52 : 110;
    foot.split(" · ").forEach(function (part) { if (cur && (cur + " · " + part).length > maxc) { lines.push(cur); cur = part; } else cur = cur ? cur + " · " + part : part; });
    lines.push(cur);
    H += (lines.length - 2) * 15;
    var css = "text{font-family:'IBM Plex Sans',Helvetica,Arial,sans-serif;fill:#1B2224}.qt{font-size:15px;font-style:italic;font-weight:600}.tk{font-size:11px;fill:#4A5655}.gl{font-size:12px}.pv{font-size:11px;font-family:'IBM Plex Mono',monospace}.g{stroke:#E2DED2;stroke-width:1}.one{stroke:#1B2224;stroke-width:1.2}.ax{stroke:#1B2224;stroke-width:1.2}.bar{stroke:#1B2224;stroke-width:1.2}.eb{stroke:#1B2224;stroke-width:1.4}.dot{fill:#fff;stroke:#1B2224;stroke-width:1.2}.yl{font-size:11px;fill:#4A5655}.ft{font-size:10.5px;fill:#4A5655}";
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Fold change chart"><style>' + css + "</style>" +
      (forExport ? '<rect width="100%" height="100%" fill="#ffffff"/>' : "") + body +
      lines.map(function (l, i) { return '<text x="4" y="' + (H - 8 - (lines.length - 1 - i) * 15) + '" class="ft">' + esc(l) + "</text>"; }).join("") + "</svg>";
    return s;
  }
  function tickLog(k) { var v = Math.pow(2, k); return k >= 0 ? String(v) : k >= -3 ? String(v) : "1/" + Math.pow(2, -k); }

  // ---------- methods text
  function methodsText() {
    if (!res || !res.gois.length || !res.refs.length) return "";
    var inst = state.files.map(function (f) { return f.instrument; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(", ");
    var effs = res.refs.concat(res.gois).map(function (t) {
      var e = res.eff[t];
      if (e.src === "curve") return t + " " + e.pct.toFixed(1) + "% (standard curve, " + e.curve.levels + " levels, R² = " + e.curve.fit.r2.toFixed(3) + ")";
      if (e.src === "value") return t + " " + e.pct.toFixed(1) + "% (entered)";
      return t + " 100% (assumed)";
    }).join("; ");
    var nEx = Object.keys(state.excluded).length;
    var ks = res.reps.map(function (r) { return r.wells.length; }), kmin = Math.min.apply(null, ks), kmax = Math.max.apply(null, ks);
    var ns = res.groups.filter(function (g) { return g.n; }).map(function (g) { return g.n; }), nmin = Math.min.apply(null, ns), nmax = Math.max.apply(null, ns);
    var t = "Relative expression was calculated from quantification cycle (Cq) values" + (inst ? " exported from " + inst : "") + ". " +
      "Technical replicate wells (" + (kmin === kmax ? kmin : kmin + "–" + kmax) + " per sample and gene) were averaged" +
      (nEx ? "; " + nEx + " well" + (nEx > 1 ? "s were" : " was") + " excluded after inspection (replicate SD > " + state.sdMax + " cycles)" : "") + ". " +
      "Amplification efficiencies: " + effs + ". Relative quantities were corrected for these efficiencies and normalised to the " + (res.refs.length > 1 ? "geometric mean of " + res.refs.length + " reference genes (" + res.refs.join(", ") + ")" : "reference gene " + res.refs[0]) +
      " (Hellemans et al., 2007" + (res.assumed.length === res.refs.length + res.gois.length ? "; with all efficiencies at 100% this equals the 2^−ΔΔCq method, Livak & Schmittgen, 2001" : "") + "). " +
      "The calibrator was " + (state.calSample ? "sample " + state.calSample : "the mean of the " + res.control + " group") + ". " +
      "Fold changes are geometric means of " + (nmin === nmax ? "n = " + nmin : "n = " + nmin + "–" + nmax) + " biological replicates per group; error bars show " + errName() + " calculated on the log₂ scale." +
      (state.pvals ? " Groups were compared with " + res.control + " by Welch's t-test on log₂ relative quantities, with Holm correction across groups for each gene." : "") +
      (res.genorm ? " Reference gene stability (geNorm M): " + res.genorm.map(function (g) { return g.target + " " + g.M.toFixed(2); }).join(", ") + "." : "") +
      (res.ntc.length ? " No-template controls: " + (res.ntc.every(function (o) { return o.verdict === "clean"; }) ? "no amplification." : "amplification in " + res.ntc.filter(function (o) { return o.cq != null; }).map(function (o) { return o.target + " " + o.task.toUpperCase() + " (Cq " + o.cq.toFixed(1) + (isFinite(o.gap) ? ", " + o.gap.toFixed(1) + " cycles after the latest sample" : "") + ")"; }).join(", ") + ".") : "") +
      " Calculated with the labmate.tools qPCR Relative Quantification tool (algorithm " + Q.ALGO + ").";
    return t;
  }

  // ---------------------------------------------------------------- export
  function csvCell(v) { v = String(v == null ? "" : v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function download(name, data, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function stamp() { var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; }; return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }
  function flash(t) { $("copied").textContent = t; setTimeout(function () { $("copied").textContent = ""; }, 2400); }
  function n6(x) { return x == null || !isFinite(x) ? "" : Math.abs(x) < 1e-12 ? "0" : LM.fmtPlain(x, 6); }
  function groupTable() {
    var head = ["gene", "group", "n", "fold_change", "low_" + state.err, "high_" + state.err, "mean_log2", "sd_log2", "sem_log2", "ci95_half_log2", "p_welch", "p_holm"];
    var rows = res.groups.filter(function (g) { return g.n; }).map(function (g) {
      var b = Q.bar(g, state.err);
      return [g.target, g.group + (g.isControl ? " (control)" : ""), g.n, n6(g.fc), b ? n6(b.lo) : "", b ? n6(b.hi) : "", n6(g.mean), n6(g.sd), n6(g.sem), n6(g.ci), g.p != null ? n6(g.p) : "", g.pAdj != null ? n6(g.pAdj) : ""];
    });
    return [head].concat(rows);
  }
  $("copy").addEventListener("click", function () {
    LM.copy(groupTable().map(function (r) { return r.join("\t"); }).join("\n"), function (ok) { flash(ok ? "COPIED ✓" : "Copy failed"); });
  });
  $("csv").addEventListener("click", function () {
    var L = ["# qPCR relative quantification — labmate.tools, algorithm " + Q.ALGO + ", " + stamp()];
    L.push("# GROUPS");
    groupTable().forEach(function (r) { L.push(r.map(csvCell).join(",")); });
    L.push("", "# SAMPLES (biological replicates)");
    L.push(["sample", "group", "gene", "mean_cq", "log2_rq", "log2_nf", "log2_nrq", "nrq", "technical_se_log2", "note"].join(","));
    res.perSample.forEach(function (r) { L.push([r.sample, r.group, r.target, n6(r.cq), n6(r.dq), n6(r.nf), n6(r.log2), n6(r.nrq), n6(r.se), r.skip || ""].map(csvCell).join(",")); });
    L.push("", "# EFFICIENCY");
    L.push("gene,role,E,efficiency_percent,source,slope,r2,levels");
    Object.keys(res.eff).forEach(function (t) { var e = res.eff[t]; L.push([t, state.targets[t].role, n6(e.E), n6(e.pct), e.src, e.curve ? n6(e.curve.fit.slope) : "", e.curve ? n6(e.curve.fit.r2) : "", e.curve ? e.curve.levels : ""].map(csvCell).join(",")); });
    L.push("", "# WELLS");
    L.push("file,well,sample,gene,type,cq,used,excluded_reason");
    allWells().forEach(function (w) {
      L.push([w.fileName, w.well, w.sample, w.target, w.task, w.cq == null ? (w.cqRaw || "") : w.cq, w.omit || state.excluded[w.uid] ? "no" : "yes", w.omit ? "omitted in instrument software" : state.excluded[w.uid] || ""].map(csvCell).join(","));
    });
    download("qpcr-" + stamp() + ".csv", L.join("\n"), "text/csv");
  });
  $("svg").addEventListener("click", function () { download("qpcr-fold-change-" + stamp() + ".svg", chartSvg(true), "image/svg+xml"); });
  $("png").addEventListener("click", function () {
    var svg = chartSvg(true), m = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg), W = +m[1], H = +m[2], sc = 3;
    var img = new Image();
    img.onload = function () {
      var c = document.createElement("canvas"); c.width = W * sc; c.height = H * sc;
      var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(function (b) { download("qpcr-fold-change-" + stamp() + ".png", b); }, "image/png");
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
  $("copyMethods").addEventListener("click", function () { LM.copy(methodsText(), function (ok) { flash(ok ? "METHODS COPIED ✓" : "Copy failed"); }); });
  $("print").addEventListener("click", function () { window.print(); });
  function summary() {
    return res.groups.filter(function (g) { return g.n; }).map(function (g) { return { gene: g.target, group: g.group, n: g.n, mean_log2: g.mean, sd_log2: isFinite(g.sd) ? g.sd : null, p_holm: g.pAdj == null ? null : g.pAdj }; });
  }
  $("json").addEventListener("click", function () {
    var rec = {
      tool: "labmate.tools qPCR Relative Quantification", algorithm: Q.ALGO, saved: new Date().toISOString(),
      files: state.files.map(function (f) { return { id: f.id, name: f.name, instrument: f.instrument, wells: f.wells }; }),
      samples: state.samples, targets: state.targets, excluded: state.excluded,
      settings: { control: state.control, calSample: state.calSample, err: state.err, scale: state.scale, sdMax: state.sdMax, cqMax: state.cqMax, pvals: state.pvals },
      results: summary()
    };
    download("qpcr-" + stamp() + ".qpcr.json", JSON.stringify(rec, null, 1), "application/json");
  });
  function openRecord(rec, name) {
    if (!rec || !Array.isArray(rec.files)) throw new Error("Not a labmate qPCR record.");
    var st = fresh();
    var idMap = {};
    rec.files.forEach(function (f) { var id = st.nextId++; idMap[f.id != null ? f.id : id] = id; st.files.push({ id: id, name: f.name, instrument: f.instrument, wells: f.wells || [] }); });
    st.samples = rec.samples || {}; st.targets = rec.targets || {}; st.excluded = {};
    Object.keys(rec.excluded || {}).forEach(function (k) {
      var p = k.split(":");
      if (idMap[p[0]] != null) st.excluded[idMap[p[0]] + ":" + p.slice(1).join(":")] = rec.excluded[k];
    });
    var s = rec.settings || {};
    ["control", "calSample", "err", "scale", "sdMax", "cqMax", "pvals"].forEach(function (k) { if (s[k] != null) st[k] = s[k]; });
    state = st;
    adopt();
    res = Q.analyze(coreInput());
    var now = summary(), old = rec.results || [], diff = 0;
    old.forEach(function (o) {
      var m = now.filter(function (x) { return x.gene === o.gene && x.group === o.group; })[0];
      if (!m || m.n !== o.n || Math.abs(m.mean_log2 - o.mean_log2) > 1e-9) diff++;
    });
    if (now.length !== old.length) diff++;
    setTimeout(function () {
      $("loadMsg").innerHTML = "<span" + (diff ? ' class="bad"' : "") + ">" + esc(name) + (rec.algorithm && rec.algorithm !== Q.ALGO ? " (saved with " + esc(rec.algorithm) + ")" : "") + ": " +
        (diff ? diff + " result" + (diff > 1 ? "s" : "") + " differ from the saved values — check the settings." : "recalculated; every result matches the saved values ✓") + "</span>";
    }, 0);
  }

  // ---------------------------------------------------------------- events
  var drop = $("drop");
  ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-over"); }); });
  ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("is-over"); }); });
  drop.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files.length) readFiles(e.dataTransfer.files); });
  $("fileIn").addEventListener("change", function () { if (this.files.length) readFiles(this.files).then(function () { $("fileIn").value = ""; }); });
  $("pasteUse").addEventListener("click", usePaste);
  $("example").addEventListener("click", loadExample);
  $("clear").addEventListener("click", function () { state = fresh(); selRow = null; $("loadMsg").innerHTML = ""; render(); });

  $("files").addEventListener("click", function (e) {
    var b = e.target.closest("[data-rm]");
    if (!b) return;
    var id = +b.dataset.rm;
    state.files = state.files.filter(function (f) { return f.id !== id; });
    Object.keys(state.excluded).forEach(function (k) { if (k.split(":")[0] === String(id)) delete state.excluded[k]; });
    if (!state.files.length) state = fresh(); else adopt();
    render();
  });
  $("files").addEventListener("change", function (e) {
    var t = e.target, f;
    if (t.dataset.map) {
      f = state.files.filter(function (x) { return x.id === +t.dataset.f; })[0];
      if (t.value === "") delete f.det.map[t.dataset.map]; else f.det.map[t.dataset.map] = +t.value;
      if (f.det.map.target == null && !f.fileTarget) f.fileTarget = fileStem(f.name);
      reextract(f); render();
    } else if (t.dataset.ft) {
      f = state.files.filter(function (x) { return x.id === +t.dataset.ft; })[0];
      f.fileTarget = t.value.trim() || fileStem(f.name);
      reextract(f); render();
    }
  });
  $("sampleRows").addEventListener("change", function (e) {
    var t = e.target;
    if (t.dataset.sg != null) { var o = state.samples[t.dataset.sg]; o.group = t.value.trim(); o.auto = false; }
    if (t.dataset.su != null) state.samples[t.dataset.su].use = t.checked;
    if (groupList().indexOf(state.control) < 0) state.control = groupList()[0] || "";
    render();
  });
  $("targetRows").addEventListener("change", function (e) {
    var t = e.target;
    if (t.dataset.tr) state.targets[t.dataset.tr].role = t.value;
    if (t.dataset.te) state.targets[t.dataset.te].eff = t.value;
    if (t.dataset.tt) state.targets[t.dataset.tt].typed = t.value.trim();
    render();
    if (t.dataset.te === undefined || t.value !== "typed") return;
    var inp = document.querySelector('[data-tt="' + CSS.escape(t.dataset.te) + '"]'); if (inp) inp.focus();
  });
  $("control").addEventListener("change", function () { state.control = this.value; render(); });
  $("calSample").addEventListener("change", function () { state.calSample = this.value; render(); });
  $("sdMax").addEventListener("change", function () { var v = LM.parse(this.value); state.sdMax = v > 0 ? String(v) : "0.3"; render(); });
  $("cqMax").addEventListener("change", function () { var v = LM.parse(this.value); state.cqMax = v > 0 ? String(v) : "35"; render(); });
  $("pvals").addEventListener("change", function () { state.pvals = this.checked; render(); });
  $("onlyFlagged").addEventListener("change", function () { state.onlyFlagged = this.checked; render(); });
  $("errSeg").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { state.err = b.dataset.v; render(); } });
  $("scaleSeg").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { state.scale = b.dataset.v; render(); } });
  function toggle(uids) {
    var anyIn = uids.some(function (u) { return !state.excluded[u]; });
    uids.forEach(function (u) { if (anyIn) state.excluded[u] = "excluded by user"; else delete state.excluded[u]; });
    state.example = state.example && true;
    render();
  }
  $("repRows").addEventListener("click", function (e) { var b = e.target.closest("[data-uid]"); if (b && !b.disabled) toggle([b.dataset.uid]); });
  $("plates").addEventListener("click", function (e) {
    var b = e.target.closest("[data-well]");
    if (!b) return;
    var p = b.dataset.well.split("|");
    toggle(allWells().filter(function (w) { return String(w.file) === p[0] && w.well === p[1] && !w.omit; }).map(function (w) { return w.uid; }));
  });
  $("perRows").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-i]");
    if (!tr) return;
    selRow = +tr.dataset.i;
    Array.prototype.forEach.call($("perRows").querySelectorAll("tr"), function (x) { x.classList.toggle("is-sel", x === tr); });
    drawWork();
  });
  Array.prototype.forEach.call(document.querySelectorAll("a.qp-req"), function (a) { a.href = REQ; });

  var rt = null;
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { if (res && res.groups.some(function (g) { return g.n; })) $("chart").innerHTML = chartSvg(); }, 200); });

  // first visit: show the example
  if (!state.files.length && !LM.load(KEY + ".seen")) { LM.save(KEY + ".seen", 1); loadExample(); }
  else render();
  window.LMQ.debug = { state: function () { return state; }, res: function () { return res; }, render: render, readFiles: readFiles, chartSvg: chartSvg };
})();
