// labmate.tools — 5.5 ELISA Standard Curve Analyzer (page)
(function () {
  "use strict";
  var LM = window.LM, E = window.LME;
  var KEY = "labmate.elisa.v1", LKEY = "labmate.lang";
  var $ = function (id) { return document.getElementById(id); };
  var esc = LM.esc;
  var REQ = "../../contact/?topic=elisa&about=reader";
  var PRE = { std: "STD", smp: "S", ctl: "C" };

  // ---------------------------------------------------------------- language
  var lang = document.documentElement.getAttribute("data-lang") === "zh" ? "zh" : "en";
  function L(en, zh) { return lang === "zh" ? zh : en; }
  function applyLang() {
    document.documentElement.setAttribute("data-lang", lang);
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    Array.prototype.forEach.call(document.querySelectorAll("[data-zh]"), function (el) {
      if (el.getAttribute("data-en") == null) el.setAttribute("data-en", el.innerHTML);
      el.innerHTML = lang === "zh" ? el.getAttribute("data-zh") : el.getAttribute("data-en");
    });
    Array.prototype.forEach.call(document.querySelectorAll("#langSeg button"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-v") === lang)); });
    document.title = lang === "zh" ? "ELISA 标准曲线与浓度分析（4PL / 5PL）| labmate.tools" : "ELISA Standard Curve Analyzer — 4PL / 5PL fit, concentrations, QC flags | labmate.tools";
  }

  // ---------------------------------------------------------------- state
  function fresh() {
    return {
      plates: [], src: null, sig: 0, ref: -1,
      wells: {}, groups: {}, ex: {},
      brush: "std", rep: 2, dir: "across", next: { std: 1, smp: 1, ctl: 1 },
      set: { model: "auto", weight: "1/y2", blank: "auto", zeroFit: true, format: "auto", range: "recovery", cvMax: "15", unit: "pg/mL" },
      ser: { top: "", fold: "2", zero: true },
      meta: { assay: "", lot: "", op: "", date: "", notes: "" },
      preset: "cols12", example: false
    };
  }
  var state = LM.load(KEY);
  if (!state || !Array.isArray(state.plates) || !state.set) state = fresh();
  (function fill() { var f = fresh(); Object.keys(f).forEach(function (k) { if (state[k] == null) state[k] = f[k]; }); Object.keys(f.set).forEach(function (k) { if (state.set[k] == null) state.set[k] = f.set[k]; }); })();
  var res = null, selRow = null, lastMsgs = null, recordCheck = null;
  function save() { LM.save(KEY, state); }

  // ---------------------------------------------------------------- plate data
  function plateInput() {
    var p = state.plates[state.sig];
    if (!p) return null;
    var r = state.ref >= 0 && state.ref !== state.sig ? state.plates[state.ref] : null;
    return { od: p.od, sat: p.sat, ref: r ? r.od : null };
  }
  function wellOD(w) {
    var p = plateInput(); if (!p) return null;
    var q = E.parseWell(w), v = p.od[q.r][q.c];
    if (v != null && p.ref && p.ref[q.r][q.c] != null) v -= p.ref[q.r][q.c];
    return v;
  }
  function wellSat(w) { var p = plateInput(); if (!p) return false; var q = E.parseWell(w); return !!(p.sat && p.sat[q.r][q.c]); }

  function takeParsed(p, name) {
    if (p.record) { openRecord(p.record, name); return; }
    if (!p.plates || !p.plates.length) throw new Error("noplate");
    var keepLayout = !state.example && Object.keys(state.wells).length > 0;
    if (state.example) { var keepLang = state.set; state = fresh(); state.set.unit = keepLang.unit; }
    state.plates = p.plates.map(function (b) { return { label: b.label || "", od: b.od, sat: b.sat, kind: b.kind }; });
    var g = E.guessBlocks(state.plates);
    state.sig = g.sig; state.ref = g.ref;
    state.src = { name: name, instrument: p.instrument || "", format: p.format || "" };
    state.example = false; recordCheck = null;
    if (!keepLayout) applyPreset(state.preset || "cols12", true);
    var n = state.plates[state.sig].od.reduce(function (a, r) { return a + r.filter(function (v) { return v != null; }).length; }, 0);
    lastMsgs = [{ ok: true, en: name + ": " + (p.instrument || L("plate", "板")) + " — " + state.plates.length + " " + (state.plates.length === 1 ? "read" : "reads") + ", " + n + " wells with values" + (keepLayout ? " (layout kept)" : ""),
      zh: name + "：" + (p.instrument || "板数据") + " — " + state.plates.length + " 个读数，" + n + " 个孔有数值" + (keepLayout ? "（保留了原布局）" : "") }];
  }
  function errMsg(e, name) {
    var m = String(e && e.message || e);
    var map = {
      noplate: ["No 8×12 plate or well list was found in this file.", "这个文件里没有找到 8×12 板数据或孔号列表。"],
      xls: ["Old Excel .xls format — open it in Excel and save as .xlsx or .csv.", "旧版 Excel .xls 格式——请在 Excel 里另存为 .xlsx 或 .csv。"],
      zipother: ["Zip file not recognised. Open the exported plate (.csv, .txt or .xlsx).", "无法识别这个压缩文件。请打开导出的板数据（.csv、.txt 或 .xlsx）。"],
      zip: ["This browser can't open .xlsx files — save the export as CSV or text.", "这个浏览器无法打开 .xlsx，请把导出另存为 CSV 或文本。"],
      badzip: ["Not a readable .xlsx file.", "无法读取这个 .xlsx 文件。"],
      nosheet: ["No worksheet found in this .xlsx file.", "这个 .xlsx 文件里没有工作表。"]
    }[m] || [m, m];
    return { ok: false, en: (name ? name + ": " : "") + map[0], zh: (name ? name + "：" : "") + map[1] };
  }
  function readFile(file) {
    return file.arrayBuffer().then(function (buf) { return E.readAny(file.name, buf); }).then(function (p) {
      takeParsed(p, file.name);
    }).catch(function (e) { lastMsgs = [errMsg(e, file.name)]; }).then(function () { render(); });
  }
  function usePaste() {
    var t = $("pasteText").value;
    if (!t.trim()) return;
    try {
      var p = E.readText(t);
      takeParsed(p, L("Pasted readings", "粘贴的读数"));
      $("pasteText").value = "";
      $("pasteBox").open = false;
    } catch (e) { lastMsgs = [errMsg(e, L("Pasted readings", "粘贴的读数"))]; }
    render();
  }
  function loadExample() {
    return fetch("example-gen5.txt").then(function (r) { if (!r.ok) throw new Error("x"); return r.text(); }).then(function (t) {
      var u = state.set.unit;
      state = fresh();
      var p = E.readText(t);
      state.plates = p.plates.map(function (b) { return { label: b.label, od: b.od, sat: b.sat, kind: b.kind }; });
      var g = E.guessBlocks(state.plates); state.sig = g.sig; state.ref = g.ref;
      state.src = { name: "example-gen5.txt", instrument: p.instrument, format: "text" };
      exampleLayout();
      state.example = true; lastMsgs = null; recordCheck = null;
      void u;
      render();
    }).catch(function () { lastMsgs = [{ ok: false, en: "The example file could not be loaded.", zh: "示例文件加载失败。" }]; render(); });
  }
  // the example: kit layout, IL-6 standards 500 → 7.8 pg/mL + 0, serum 1:2, supernatants 1:10, two kit controls
  var EX_NAMES = ["Serum 01", "Serum 02", "Serum 03", "Serum 04", "Serum 05", "Serum 06", "Serum 07", "Serum 08", "Serum 09", "Serum 10",
    "Serum 11", "Serum 12", "Serum 13", "Serum 14", "Serum 15", "Serum 16", "Serum 17", "Serum 18", "Serum 19", "Serum 20",
    "Sup ctrl 0h", "Sup ctrl 4h", "Sup LPS 1h", "Sup LPS 2h", "Sup LPS 4h", "Sup LPS 8h", "Sup LPS 24h", "Sup LPS+Dex 4h", "Sup LPS+Dex 24h", "Sup medium",
    "Plasma A", "Plasma B", "Plasma C", "Plasma D", "Plasma E", "Plasma F", "Plasma G", "Plasma H"];
  function exampleLayout() {
    applyPreset("cols12", true);
    // H9–H10 and H11–H12 → kit controls
    ["H9", "H10"].forEach(function (w) { state.wells[w] = { t: "ctl", id: "C1" }; });
    ["H11", "H12"].forEach(function (w) { state.wells[w] = { t: "ctl", id: "C2" }; });
    syncGroups();
    var conc = E.series(500, 2, 8, true);
    for (var i = 1; i <= 8; i++) state.groups["STD" + i].conc = fmtIn(conc[i - 1]);
    for (i = 1; i <= 38; i++) {
      var g = state.groups["S" + i]; if (!g) continue;
      g.name = EX_NAMES[i - 1];
      g.dil = i <= 20 ? "2" : i <= 30 ? "10" : "2";
    }
    state.groups.C1.name = "Kit control low"; state.groups.C1.conc = "40"; state.groups.C1.dil = "1";
    state.groups.C2.name = "Kit control high"; state.groups.C2.conc = "200"; state.groups.C2.dil = "1";
    state.ser = { top: "500", fold: "2", zero: true };
    state.next = { std: 9, smp: 39, ctl: 3 };
    state.meta = { assay: "Human IL-6 (simulated example)", lot: "", op: "", date: "", notes: "" };
  }
  function fmtIn(x) { return x == null ? "" : LM.fmtPlain(x, 6); }

  // ---------------------------------------------------------------- layout
  function applyPreset(kind, quiet) {
    state.wells = E.preset(kind, 8);
    state.ex = {};
    syncGroups();
    state.next = { std: nextFree("std"), smp: nextFree("smp"), ctl: nextFree("ctl") };
    if (!quiet) recordCheck = null;
  }
  function nextFree(t) {
    var n = 0;
    Object.keys(state.groups).forEach(function (g) { if (state.groups[g].t === t) { var m = /(\d+)$/.exec(g); if (m) n = Math.max(n, +m[1]); } });
    return n + 1;
  }
  // make groups match the wells: new ids get a group; ids without wells are kept (so typed values survive) but unused
  function syncGroups() {
    Object.keys(state.wells).forEach(function (w) {
      var o = state.wells[w];
      if (!state.groups[o.id]) state.groups[o.id] = { t: o.t, name: o.t === "blk" ? "Blank" : o.id, conc: "", dil: o.t === "smp" || o.t === "ctl" ? "1" : "" };
      state.groups[o.id].t = o.t;
    });
  }
  function usedIds(t) {
    var s = {};
    Object.keys(state.wells).forEach(function (w) { if (state.wells[w].t === t) s[state.wells[w].id] = 1; });
    return Object.keys(s).sort(E.idOrder);
  }
  function wellsOfId(id) { return Object.keys(state.wells).filter(function (w) { return state.wells[w].id === id; }).sort(E.wellOrder); }

  function paint(w) {
    var q = E.parseWell(w), b = state.brush;
    if (b === "off") { if (state.ex[w]) delete state.ex[w]; else state.ex[w] = 1; return; }
    var list = [];
    for (var k = 0; k < (b === "clr" ? 1 : state.rep); k++) {
      var r = q.r + (state.dir === "down" ? k : 0), c = q.c + (state.dir === "across" ? k : 0);
      if (r < 8 && c < 12) list.push(E.wellName(r, c));
    }
    if (b === "clr") { list.forEach(function (x) { delete state.wells[x]; delete state.ex[x]; }); return; }
    var id = b === "blk" ? "BLK" : PRE[b] + state.next[b];
    list.forEach(function (x) { state.wells[x] = { t: b, id: id }; });
    syncGroups();
    if (b !== "blk") state.next[b]++;
  }

  // ---------------------------------------------------------------- analysis
  function settings() {
    var s = state.set, hasBlk = Object.keys(state.wells).some(function (w) { return state.wells[w].t === "blk"; });
    return {
      model: s.model, weight: s.weight, blank: s.blank === "auto" ? (hasBlk ? "blk" : "none") : s.blank, zeroFit: s.zeroFit !== false,
      cvMax: LM.parse(s.cvMax) > 0 ? LM.parse(s.cvMax) : 15, range: s.range, format: s.format, excluded: state.ex
    };
  }
  function analyse() {
    var p = plateInput();
    if (!p) return null;
    var groups = {};
    Object.keys(state.groups).forEach(function (g) {
      var o = state.groups[g];
      groups[g] = { t: o.t, name: o.name, conc: o.conc === "" || o.conc == null ? "" : LM.parse(o.conc), dil: LM.parse(o.dil) || 1 };
      if (groups[g].conc !== "" && !isFinite(groups[g].conc)) groups[g].conc = "";
    });
    return E.analyse(p, state.wells, groups, settings());
  }

  // ---------------------------------------------------------------- formatting
  function f3(x) { return x == null || !isFinite(x) ? "—" : x.toFixed(3); }
  function fc(x, sig) { return x == null || !isFinite(x) ? "—" : LM.fmt(x, sig || 4); }
  function fp(x) { return x == null || !isFinite(x) ? "—" : (Math.round(x * 10) / 10).toFixed(1); }
  function unit() { return state.set.unit || ""; }
  var STATUS = {
    ok: ["IN RANGE", "范围内"], high: ["> ULOQ", "> ULOQ"], low: ["< LLOQ", "< LLOQ"], above: ["ABOVE CURVE", "高于曲线"],
    below: ["BELOW CURVE", "低于曲线"], norange: ["NO RANGE", "无定量范围"], nodata: ["NO DATA", "无数据"]
  };
  var FLAG = { cv: ["HIGH CV", "CV 偏高"], sat: ["SATURATED", "饱和"], single: ["1 WELL", "单孔"], lod: ["< LOD", "< LOD"], rec: ["RECOVERY", "回收率"] };
  function flagHtml(code, kind) {
    var t = (kind === "s" ? STATUS : FLAG)[code];
    var cls = code === "ok" ? "el-ok" : code === "single" || code === "lod" ? "pp-flag is-info" : "pp-flag";
    return code === "ok" ? '<span class="el-ok">' + L(t[0], t[1]) + "</span>" : '<span class="' + cls + '">' + L(t[0], t[1]) + "</span>";
  }
  function adviceText(o) {
    var a = o.advice;
    if (!a) return "";
    if (a.kind === "dilute") return a.atLeast
      ? L("Dilute at least " + LM.fmt(a.fold) + "× more — re-run at 1:" + LM.fmt(a.newDil), "至少再稀释 " + LM.fmt(a.fold) + " 倍，按 1:" + LM.fmt(a.newDil) + " 重测")
      : L("Dilute " + LM.fmt(a.fold) + "× more — re-run at 1:" + LM.fmt(a.newDil), "再稀释 " + LM.fmt(a.fold) + " 倍，按 1:" + LM.fmt(a.newDil) + " 重测");
    if (a.kind === "less") return a.newDil <= 1
      ? L("Re-run undiluted", "用原液（不稀释）重测")
      : L("Re-run less diluted, at 1:" + LM.fmt(a.newDil), "降低稀释，按 1:" + LM.fmt(a.newDil) + " 重测");
    if (a.kind === "none") return L("Below the range undiluted — report < LLOQ", "原液仍低于定量下限——报告 < LLOQ");
    if (a.kind === "repeat") return L("Replicates disagree — check the wells or repeat", "复孔不一致——检查各孔或重测");
    return "";
  }
  // value to report
  function reportable(o) {
    if (!res || !res.ok) return "";
    var u = unit();
    if (o.status === "ok" || o.status === "norange") return LM.fmt(o.final, 4);
    if ((o.status === "high" || o.status === "above") && res.uloq != null) return "> " + LM.fmt(res.uloq * o.dil, 4);
    if ((o.status === "low" || o.status === "below") && res.lloq != null) return "< " + LM.fmt(res.lloq * o.dil, 4);
    void u;
    return "—";
  }

  // ---------------------------------------------------------------- render
  function render() {
    var has = state.plates.length > 0 && !!state.plates[state.sig];
    document.body.classList.toggle("el-empty", !has);
    $("exampleNote").hidden = !state.example;
    renderMsgs();
    if (!has) { $("wait").hidden = false; renderWarnings([]); save(); return; }
    $("wait").hidden = true;
    renderBlocks();
    renderControls();
    res = analyse();
    renderPlate();
    renderGroups();
    renderFit();
    renderResults();
    renderMeta();
    save();
  }
  function renderMsgs() {
    var box = $("loadMsg");
    if (!lastMsgs && !recordCheck) { box.innerHTML = ""; return; }
    var h = (lastMsgs || []).map(function (m) { return "<span" + (m.ok ? "" : ' class="bad"') + ">" + (m.ok ? "" : "✗ ") + esc(L(m.en, m.zh)) + "</span>"; }).join("");
    if (lastMsgs && lastMsgs.some(function (m) { return !m.ok; })) h += ' <span>' + L("Reader not recognised? ", "读不出你的酶标仪？") + '<a href="' + REQ + '">' + L("Ask for it to be added", "告诉我们型号") + "</a>.</span>";
    if (recordCheck) h += "<span" + (recordCheck.ok ? "" : ' class="bad"') + ">" + esc(L(recordCheck.en, recordCheck.zh)) + "</span>";
    box.innerHTML = h;
  }
  function renderBlocks() {
    var opts = state.plates.map(function (p, i) {
      var wl = E.wavelength(p.label);
      return '<option value="' + i + '">' + esc((i + 1) + ". " + (p.label || (wl ? wl + " nm" : L("Read", "读数") + " " + (i + 1))).slice(0, 70)) + "</option>";
    }).join("");
    $("sigSel").innerHTML = opts; $("sigSel").value = String(state.sig);
    $("refSel").innerHTML = '<option value="-1">' + L("none", "不减") + "</option>" + opts; $("refSel").value = String(state.ref);
    $("refSel").parentNode.hidden = state.plates.length < 2;
    $("sigSel").parentNode.hidden = state.plates.length < 2;
    var s = state.src || {};
    $("srcInfo").innerHTML = s.name ? "<b>" + esc(s.name) + "</b>" + (s.instrument ? " · " + esc(s.instrument) : "") : "";
  }
  function segSet(id, v) {
    Array.prototype.forEach.call($(id).querySelectorAll("button"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-v") === String(v))); });
  }
  function renderControls() {
    segSet("brushSeg", state.brush); segSet("repSeg", state.rep); segSet("dirSeg", state.dir);
    segSet("modelSeg", state.set.model); segSet("weightSeg", state.set.weight); segSet("fmtSeg", state.set.format); segSet("rangeSeg", state.set.range);
    var b = state.brush, showNext = b === "std" || b === "smp" || b === "ctl";
    $("nextPre").textContent = showNext ? PRE[b] : b === "blk" ? "BLK" : "—";
    $("nextNum").value = showNext ? state.next[b] : "";
    $("nextNum").disabled = !showNext;
    $("repSeg").parentNode.classList.toggle("is-off", b === "off" || b === "clr");
    $("dirSeg").parentNode.classList.toggle("is-off", b === "off" || b === "clr");
    $("blankSel").value = state.set.blank;
    $("zeroFit").checked = state.set.zeroFit !== false;
    if (document.activeElement !== $("cvMax")) $("cvMax").value = state.set.cvMax;
    $("unitSel").value = state.set.unit;
    $("presetSel").value = state.preset || "cols12";
    if (document.activeElement !== $("serTop")) $("serTop").value = state.ser.top;
    if (document.activeElement !== $("serFold")) $("serFold").value = state.ser.fold;
    $("serZero").checked = !!state.ser.zero;
    ["unitStd", "unitRes"].forEach(function (id) { $(id).textContent = unit(); });
  }

  var TYPE_NAME = { std: ["Standard", "标准品"], smp: ["Sample", "样本"], ctl: ["Control", "质控"], blk: ["Blank", "空白"] };
  function renderPlate() {
    var h = '<span class="el-corner"></span>';
    E.COLS.forEach(function (c) { h += '<span class="el-ch">' + c + "</span>"; });
    var statusOf = {};
    if (res && res.ok) res.smp.concat(res.ctl).forEach(function (o) { o.wells.forEach(function (w) { statusOf[w] = o; }); });
    var cvBad = {};
    if (res && res.ok) {
      res.smp.concat(res.ctl).forEach(function (o) { if (o.flags.indexOf("cv") >= 0) o.wells.forEach(function (w) { cvBad[w] = 1; }); });
      res.std.forEach(function (s) { if (isFinite(s.cv) && s.cv > res.cvMax) s.wells.forEach(function (w) { cvBad[w] = 1; }); });
    }
    E.ROWS.forEach(function (R) {
      h += '<span class="el-rh">' + R + "</span>";
      E.COLS.forEach(function (C) {
        var w = R + C, o = state.wells[w], v = wellOD(w), sat = wellSat(w);
        var cls = "el-w" + (o ? " t-" + o.t : "") + (state.ex[w] ? " is-ex" : "") + (sat ? " is-sat" : "") + (cvBad[w] && !state.ex[w] ? " is-cv" : "");
        var st = statusOf[w];
        if (st && st.status !== "ok" && st.status !== "norange") cls += " is-out";
        var lab = o ? o.id : "";
        var title = w + (o ? " · " + L(TYPE_NAME[o.t][0], TYPE_NAME[o.t][1]) + " " + o.id + (state.groups[o.id] && state.groups[o.id].name && state.groups[o.id].name !== o.id ? " (" + state.groups[o.id].name + ")" : "") : "") + " · OD " + (sat ? L("saturated", "饱和") : f3(v)) + (state.ex[w] ? " · " + L("excluded", "已排除") : "");
        h += '<button type="button" class="' + cls + '" data-w="' + w + '" title="' + esc(title) + '" aria-label="' + esc(title) + '"><i>' + esc(lab) + "</i><b>" + (sat ? "OVR" : v == null ? "" : v.toFixed(v >= 10 ? 1 : 3)) + "</b></button>";
      });
    });
    $("plate").innerHTML = h;
    $("legend").innerHTML =
      '<span class="el-lg t-std">' + L("standard", "标准品") + '</span><span class="el-lg t-smp">' + L("sample", "样本") + '</span><span class="el-lg t-ctl">' + L("control", "质控") + '</span><span class="el-lg t-blk">' + L("blank", "空白") + "</span>" +
      '<span class="qp-lg-ex">' + L("excluded", "已排除") + '</span><span class="el-lg-cv">' + L("high CV", "CV 偏高") + '</span><span class="el-lg-out">' + L("outside range", "超出范围") + "</span>" +
      '<span class="el-lg-sat">' + L("saturated (OVR)", "饱和 (OVR)") + "</span>";
  }

  function renderGroups() {
    var std = usedIds("std"), smp = usedIds("smp"), ctl = usedIds("ctl");
    $("stdCount").textContent = std.length ? std.length + L(" levels", " 个浓度点") : "";
    $("smpCount").textContent = smp.length ? String(smp.length) : "";
    var sm = {};
    if (res && res.ok) res.std.forEach(function (s) { sm[s.id] = s; });
    $("stdRows").innerHTML = std.length ? std.map(function (g) {
      var G = state.groups[g], bad = G.conc !== "" && !(LM.parse(G.conc) >= 0);
      return '<tr' + (bad ? ' class="is-bad"' : "") + '><td class="nm">' + esc(g) + '</td><td class="el-wl">' + wellsOfId(g).join(" ") + '</td><td class="n"><input type="text" class="pp-in" data-g="' + esc(g) + '" data-k="conc" inputmode="decimal" value="' + esc(G.conc) + '" aria-label="' + esc(g) + ' concentration"></td></tr>';
    }).join("") : '<tr><td colspan="3" class="qp-none">' + L("No standards yet — choose STANDARD and tap the wells, or apply a common layout.", "还没有标准品——选“标准品”再点孔位，或套用常用布局。") + "</td></tr>";
    $("smpRows").innerHTML = smp.length ? smp.map(function (g) {
      var G = state.groups[g];
      return '<tr><td class="nm">' + esc(g) + '</td><td><input type="text" class="pp-in pp-name" data-g="' + esc(g) + '" data-k="name" value="' + esc(G.name) + '" aria-label="' + esc(g) + ' name"></td><td class="el-wl">' + wellsOfId(g).join(" ") + '</td><td class="n d"><input type="text" class="pp-in" data-g="' + esc(g) + '" data-k="dil" inputmode="decimal" value="' + esc(G.dil) + '" aria-label="' + esc(g) + ' dilution"></td></tr>';
    }).join("") : '<tr><td colspan="4" class="qp-none">' + L("No samples yet.", "还没有样本。") + "</td></tr>";
    $("ctlWrap").hidden = !ctl.length;
    $("ctlRows").innerHTML = ctl.map(function (g) {
      var G = state.groups[g];
      return '<tr><td class="nm">' + esc(g) + '</td><td><input type="text" class="pp-in pp-name" data-g="' + esc(g) + '" data-k="name" value="' + esc(G.name) + '"></td><td class="el-wl">' + wellsOfId(g).join(" ") + '</td><td class="n"><input type="text" class="pp-in" data-g="' + esc(g) + '" data-k="conc" inputmode="decimal" value="' + esc(G.conc) + '" placeholder="' + esc(unit()) + '"></td><td class="n d"><input type="text" class="pp-in" data-g="' + esc(g) + '" data-k="dil" inputmode="decimal" value="' + esc(G.dil) + '"></td></tr>';
    }).join("");
    void sm;
  }

  // ---- curve chart
  function chartSvg(forExport) {
    if (!res || !res.ok) return "";
    var p = res.p, W = 640, H = 400, m = { l: 62, r: 18, t: 16, b: 50 };
    var pos = res.std.filter(function (s) { return s.conc > 0; }).map(function (s) { return s.conc; });
    var xs = pos.slice();
    var showS = res.smp.concat(res.ctl).filter(function (o) { return o.well != null; });
    showS.forEach(function (o) { xs.push(o.well); });
    var lo = Math.min.apply(null, xs), hi = Math.max.apply(null, xs);
    var lx0 = Math.floor(Math.log10(lo / 1.5) * 2) / 2, lx1 = Math.ceil(Math.log10(hi * 1.5) * 2) / 2;
    var zero = res.std.filter(function (s) { return s.conc === 0 && s.live.length; })[0];
    var zw = zero ? 46 : 0;
    var X = function (x) { return m.l + zw + (Math.log10(x) - lx0) / (lx1 - lx0) * (W - m.l - m.r - zw); };
    var ys = [];
    res.std.forEach(function (s) { s.ys.forEach(function (y) { ys.push(y); }); });
    showS.forEach(function (o) { ys.push(o.mean); });
    for (var i = 0; i <= 60; i++) ys.push(E.f(p, Math.pow(10, lx0 + i / 60 * (lx1 - lx0))));
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys), pad = (y1 - y0) * 0.06 || 0.1;
    y0 -= pad; y1 += pad;
    var Y = function (y) { return m.t + (1 - (y - y0) / (y1 - y0)) * (H - m.t - m.b); };
    var css = forExport ? '<style>text{font-family:"IBM Plex Mono",Menlo,monospace;font-size:11px;fill:#4A5655}.g{stroke:#E2DED2}.ax{stroke:#1B2224;stroke-width:1.2}.fit{fill:none;stroke:#1F7A45;stroke-width:2}.pt{fill:#fff;stroke:#1B2224;stroke-width:1.4}.px{fill:none;stroke:#A9ADA3;stroke-width:1.2}.sm{fill:#17403D}.so{fill:#A3341F}.rng{fill:#9CC7B6;fill-opacity:.18}.lim{stroke:#17403D;stroke-dasharray:4 3}</style>' : "";
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(L("Standard curve", "标准曲线")) + '">' + css;
    if (forExport) s += '<rect width="' + W + '" height="' + H + '" fill="#fff"/>';
    // range band
    if (res.lloq != null && res.uloq != null) s += '<rect class="rng" x="' + X(res.lloq).toFixed(1) + '" y="' + m.t + '" width="' + (X(res.uloq) - X(res.lloq)).toFixed(1) + '" height="' + (H - m.t - m.b) + '"/>';
    // grid + x ticks
    for (var e = Math.ceil(lx0); e <= Math.floor(lx1); e++) {
      for (var k = 1; k <= 9; k++) {
        var lv = e + Math.log10(k); if (lv < lx0 || lv > lx1) continue;
        var gx = X(Math.pow(10, lv)).toFixed(1);
        s += '<line class="g" x1="' + gx + '" x2="' + gx + '" y1="' + m.t + '" y2="' + (H - m.b) + '"' + (k === 1 ? "" : ' stroke-opacity=".5"') + "/>";
        if (k === 1) s += '<text x="' + gx + '" y="' + (H - m.b + 16) + '" text-anchor="middle">' + LM.fmt(Math.pow(10, e)) + "</text>";
      }
    }
    var yt = niceTicks(y0, y1, 6);
    yt.forEach(function (t) { var gy = Y(t).toFixed(1); s += '<line class="g" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + gy + '" y2="' + gy + '"/><text x="' + (m.l - 6) + '" y="' + (+gy + 4) + '" text-anchor="end">' + LM.fmtPlain(t, 3) + "</text>"; });
    s += '<line class="ax" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + (H - m.b) + '" y2="' + (H - m.b) + '"/><line class="ax" x1="' + m.l + '" x2="' + m.l + '" y1="' + m.t + '" y2="' + (H - m.b) + '"/>';
    if (zero) {
      var zx = m.l + zw / 2;
      s += '<text x="' + zx + '" y="' + (H - m.b + 16) + '" text-anchor="middle">0</text>';
      s += '<path class="ax" d="M' + (m.l + zw - 6) + " " + (H - m.b + 4) + " l4 -8 M" + (m.l + zw - 2) + " " + (H - m.b + 4) + ' l4 -8" fill="none"/>';
      if (set().zeroFit) s += '<line class="fit" x1="' + (zx - 8) + '" x2="' + (zx + 8) + '" y1="' + Y(p.A).toFixed(1) + '" y2="' + Y(p.A).toFixed(1) + '" stroke-dasharray="3 2"/>';
      zero.wells.forEach(function (w) {
        var v = res.wells[w].v, exd = state.ex[w];
        if (v == null) return;
        s += '<circle class="' + (exd ? "px" : "pt") + '" cx="' + zx + '" cy="' + Y(v).toFixed(1) + '" r="4"/>';
      });
    }
    // limits
    [["lloq", "LLOQ"], ["uloq", "ULOQ"]].forEach(function (q) {
      if (res[q[0]] == null) return;
      var lx = X(res[q[0]]).toFixed(1);
      s += '<line class="lim" x1="' + lx + '" x2="' + lx + '" y1="' + m.t + '" y2="' + (H - m.b) + '"/><text x="' + (+lx + (q[0] === "lloq" ? 4 : -4)) + '" y="' + (m.t + 12) + '" text-anchor="' + (q[0] === "lloq" ? "start" : "end") + '">' + q[1] + "</text>";
    });
    // curve
    var d = "";
    for (i = 0; i <= 200; i++) {
      var lx2 = lx0 + i / 200 * (lx1 - lx0), yy = E.f(p, Math.pow(10, lx2));
      d += (i ? "L" : "M") + X(Math.pow(10, lx2)).toFixed(1) + " " + Y(yy).toFixed(1);
    }
    s += '<path class="fit" d="' + d + '"/>';
    // standards
    res.std.forEach(function (st) {
      if (!(st.conc > 0)) return;
      st.wells.forEach(function (w) {
        var v = res.wells[w].v; if (v == null) return;
        s += '<circle class="' + (state.ex[w] ? "px" : "pt") + '" cx="' + X(st.conc).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="4"><title>' + esc(st.id + " " + w + " · " + f3(v)) + "</title></circle>";
      });
    });
    // samples on the curve
    showS.forEach(function (o) {
      var cx = X(o.well), cy = Y(o.mean);
      s += '<path class="' + (o.status === "ok" ? "sm" : "so") + '" d="M' + cx.toFixed(1) + " " + (cy - 4).toFixed(1) + " l4 4 l-4 4 l-4 -4z" + '"><title>' + esc(o.id + " " + o.name + " · " + f3(o.mean)) + "</title></path>";
    });
    s += '<text x="' + ((W + m.l) / 2) + '" y="' + (H - 10) + '" text-anchor="middle">' + esc(L("concentration in the well", "孔内浓度") + " (" + unit() + ", log)") + "</text>";
    s += '<text transform="translate(14 ' + ((H - m.b + m.t) / 2) + ') rotate(-90)" text-anchor="middle">' + esc(res.subtract.what !== "none" ? L("OD − blank", "OD − 本底") : "OD") + "</text>";
    s += "</svg>";
    return s;
  }
  function niceTicks(a, b, n) {
    var step = Math.pow(10, Math.floor(Math.log10((b - a) / n))), err = (b - a) / n / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    var out = [];
    for (var t = Math.ceil(a / step) * step; t <= b + 1e-12; t += step) out.push(Math.round(t / step) * step);
    return out;
  }
  function set() { return settings(); }

  var CHECK = {
    noconv: ["did not converge", "未收敛"], bound: ["a parameter sits on its limit", "有参数卡在边界上"], singular: ["parameters can't all be determined", "参数无法全部确定"],
    gwide: ["asymmetry G is poorly determined (SE > G)", "不对称因子 G 估计不稳（SE > G）"], cwide: ["C is poorly determined (SE > C)", "C 估计不稳（SE > C）"],
    coutside: ["the inflection lies outside the standards", "拐点在标准品范围之外"], corr: ["parameters are almost perfectly correlated", "参数之间几乎完全相关"],
    starts: ["different starting values end in different fits", "不同初值得到不同结果"], df: ["too few points for this model", "数据点太少"]
  };
  function renderFit() {
    if (!res) return;
    if (!res.ok) {
      $("chart").innerHTML = '<p class="el-chart-wait">' + (res.why === "few"
        ? L("Needs at least 3 standards with a concentration above 0 (4 levels in all; 5 for 5PL) and readings.", "至少需要 3 个浓度大于 0 且有读数的标准品（总共 4 个浓度点；5PL 需要 5 个）。")
        : L("The curve could not be fitted. Check the standard concentrations and the layout.", "无法拟合曲线。请检查标准品浓度和板布局。")) + "</p>";
      $("fitBox").innerHTML = ""; $("stdRes").innerHTML = ""; $("fitSum").textContent = "";
      return;
    }
    $("chart").innerHTML = chartSvg(false) + '<figcaption><span class="el-k-pt">' + L("standard wells", "标准品孔") + '</span><span class="el-k-sm">' + L("samples in range", "范围内样本") + '</span><span class="el-k-so">' + L("outside range", "范围外") + '</span><span class="el-k-rng">' + L("quantification range", "定量范围") + "</span></figcaption>";
    var f = res.fit, p = res.p, fa = res.fitAll, u = unit();
    $("fitSum").textContent = (f.five ? "5PL" : "4PL") + " · " + L("WEIGHT ", "加权 ") + wName(f.weight) + " · R² " + (isFinite(f.r2) ? f.r2.toFixed(4) : "—");
    var why = {
      ftest5: L("5PL fits significantly better (F-test p = " + pFmt(fa.test.p) + ") and its parameters are well determined.", "5PL 拟合明显更好（F 检验 p = " + pFmt(fa.test.p) + "），且参数估计稳定。"),
      ftest4: L("5PL is not significantly better" + (fa.test ? " (F-test p = " + pFmt(fa.test.p) + ")" : "") + ", so the simpler 4PL is used.", "5PL 没有明显更好" + (fa.test ? "（F 检验 p = " + pFmt(fa.test.p) + "）" : "") + "，所以采用更简单的 4PL。"),
      "5pl-untrusted": L("5PL is not trusted here (" + badList(fa.f5) + "), so 4PL is used.", "5PL 在这里不可信（" + badList(fa.f5) + "），所以采用 4PL。"),
      chosen: L("Model chosen by you.", "模型由你指定。"),
      "chosen-untrusted": L("You chose 5PL, but it is not trusted here (" + badList(fa.f5) + "). Consider 4PL.", "你选择了 5PL，但它在这里不可信（" + badList(fa.f5) + "），建议用 4PL。"),
      "5pl-failed": L("5PL could not be fitted; 4PL is shown.", "5PL 无法拟合，改为显示 4PL。")
    }[fa.why] || "";
    var row = function (k, v, se) { return "<tr><td>" + k + '</td><td class="n">' + v + '</td><td class="n el-se">' + (se == null ? "" : "± " + se) + "</td></tr>"; };
    var se = f.se || {};
    var h = '<div class="el-model"><b>' + (f.five ? "5PL" : "4PL") + "</b> " + esc(why) + "</div>";
    h += '<table class="el-ptab"><thead><tr><th></th><th class="n">' + L("VALUE", "数值") + '</th><th class="n">SE</th></tr></thead><tbody>' +
      row("A <small>" + L("zero end", "零点端") + "</small>", f3(p.A), f.se ? f3(se.A) : null) +
      row("B <small>" + L("slope", "斜率") + "</small>", fc(p.B, 4), f.se ? fc(se.B, 2) : null) +
      row("C <small>" + esc(u) + "</small>", fc(p.C, 4), f.se ? fc(se.C, 2) : null) +
      row("D <small>" + L("saturation", "饱和端") + "</small>", f3(p.D), f.se ? f3(se.D) : null) +
      (f.five ? row("G <small>" + L("asymmetry", "不对称") + "</small>", fc(p.G, 4), f.se ? fc(se.G, 2) : null) : "") +
      "</tbody></table>";
    h += '<dl class="el-dl">' +
      "<dt>R² / S<sub>y.x</sub></dt><dd>" + (isFinite(f.r2) ? f.r2.toFixed(4) : "—") + " / " + (isFinite(f.syx) ? LM.fmt(f.syx, 3) : "—") + (f.weight !== "none" ? " <small>(" + L("weighted", "加权") + ")</small>" : "") + "</dd>" +
      "<dt>" + L("Fit", "拟合") + "</dt><dd>" + L(f.n + " wells, " + res.nStdLevels + " levels · " + (f.converged ? "converged" : "NOT converged") + " in " + f.iter + " iterations · " + f.sameMin + "/" + f.starts + " starts agree",
        f.n + " 个孔，" + res.nStdLevels + " 个浓度点 · " + (f.converged ? "已收敛" : "未收敛") + "（" + f.iter + " 次迭代）· " + f.starts + " 组初值中 " + f.sameMin + " 组一致") + "</dd>" +
      "<dt>" + L("Range", "定量范围") + "</dt><dd>" + (res.lloq != null ? "<b>" + fc(res.lloq) + " – " + fc(res.uloq) + "</b> " + esc(u) + " <small>LLOQ – ULOQ</small>" : '<span class="pp-flag">' + L("NONE", "无") + "</span>") + "</dd>" +
      (res.lod ? "<dt>LOD</dt><dd>" + (res.lod.x != null ? fc(res.lod.x, 3) + " " + esc(u) : "—") + " <small>" + L("mean " + (res.lod.from === "zero" ? "zero std" : "blank") + (res.dir === "up" ? " + " : " − ") + "3 SD, n = " + res.lod.n, (res.lod.from === "zero" ? "零浓度标准品" : "空白") + "均值" + (res.dir === "up" ? " + " : " − ") + "3 SD，n = " + res.lod.n) + "</small></dd>" : "") +
      "<dt>" + L("Assay", "方法") + "</dt><dd>" + (res.format === "competitive" ? L("competitive (signal falls)", "竞争法（信号随浓度下降）") : L("sandwich / indirect (signal rises)", "夹心 / 间接法（信号随浓度上升）")) + "</dd>" +
      "<dt>" + L("Subtracted", "扣除本底") + "</dt><dd>" + (res.subtract.what === "none" ? L("nothing", "无") : f3(res.subtract.value) + " <small>" + (res.subtract.what === "blk" ? L("blank wells' mean", "空白孔均值") : L("zero standard's mean", "零浓度标准品均值")) + "</small>") + (state.ref >= 0 ? " <small>· " + L("reference read subtracted per well", "每孔已减去参比波长") + "</small>" : "") + "</dd>" +
      "</dl>";
    // the other model, for comparison
    var other = f.five ? fa.f4 : fa.f5;
    if (other && other.ok) {
      h += '<p class="el-other">' + L("Other model", "另一个模型") + ": " + (other.five ? "5PL" : "4PL") + " — " + L("weighted SS ", "加权残差平方和 ") + LM.fmt(other.ssr, 3) + " " + L("vs", "对比") + " " + LM.fmt(f.ssr, 3) + (other.checks.some(function (c) { return c.bad; }) ? " · " + L("not trusted: ", "不可信：") + esc(badList(other)) : "") + "</p>";
    }
    var notes = f.checks.filter(function (c) { return !c.bad; });
    if (notes.length) h += '<p class="el-other">' + L("Note: ", "注意：") + notes.map(function (c) { return esc(L(CHECK[c.code][0], CHECK[c.code][1])); }).join("; ") + "</p>";
    $("fitBox").innerHTML = h;

    $("stdRes").innerHTML = res.std.map(function (s) {
      var rec = s.rec, recCls = rec == null ? "" : (s.inRange ? "" : (rec < 80 || rec > 120 ? " class=\"el-bad\"" : ""));
      var wellsH = s.wells.map(function (w) {
        var W = res.wells[w];
        return '<button type="button" class="qp-chip' + (state.ex[w] ? " is-ex" : "") + (W.sat ? " is-flag" : "") + '" data-ex="' + w + '" title="' + esc(w + " — " + L("tap to exclude / use again", "点击排除或恢复")) + '">' + (W.sat ? "OVR" : f3(W.v)) + "</button>";
      }).join("");
      var rng = s.conc === 0 ? '<span class="el-dim">' + (s.inFit ? L("zero, in fit", "零点，参与拟合") : L("zero, not fitted", "零点，未参与拟合")) + "</span>"
        : s.conc == null ? '<span class="pp-flag">' + L("NO CONC.", "缺浓度") + "</span>"
        : s.inRange ? '<span class="el-ok">' + (res.lloq === s.conc ? "LLOQ" : res.uloq === s.conc ? "ULOQ" : L("in range", "范围内")) + "</span>"
        : '<span class="pp-flag">' + L("OUT", "范围外") + "</span>";
      var cvF = isFinite(s.cv) && s.cv > res.cvMax;
      return "<tr" + (s.inRange ? "" : ' class="is-dim"') + '><td class="nm">' + esc(s.id) + '</td><td class="n">' + (s.conc == null ? "—" : fc(s.conc)) + '</td><td class="qp-chips">' + wellsH + '</td><td class="n">' + f3(s.mean) + '</td><td class="n' + (cvF ? " el-bad" : "") + '">' + fp(s.cv) + '</td><td class="n">' + (s.conc > 0 ? fc(s.backMean) : "—") + "</td><td class=\"n\"" + "><span" + recCls + ">" + (rec == null ? "—" : fp(rec) + "%") + "</span></td><td>" + rng + "</td></tr>";
    }).join("");
  }
  function wName(w) { return w === "1/y2" ? "1/Y²" : w === "1/y" ? "1/Y" : L("none", "无"); }
  function pFmt(p) { return !isFinite(p) ? "—" : p < 0.001 ? "< 0.001" : p.toFixed(3); }
  function badList(f) { return f && f.checks ? f.checks.filter(function (c) { return c.bad; }).map(function (c) { return L(CHECK[c.code][0], CHECK[c.code][1]); }).join("; ") : ""; }

  var WARN = {
    noblank: ["No wells to subtract — nothing was subtracted.", "没有可扣除的孔——未扣除本底。"],
    noconc: ["Some standards have no concentration and are left out of the fit.", "部分标准品没有填浓度，未参与拟合。"],
    stdsat: ["A standard well is saturated and left out of the fit.", "有标准品孔饱和，未参与拟合。"],
    norange: ["No standards recover within 75–125% — there is no quantification range. Check the standard concentrations and the fit.", "没有标准品回收率在 75–125% 之内——无法确定定量范围。请检查标准品浓度和拟合。"],
    onelevel: ["Only one standard recovers within limits; the range is a single level.", "只有一个标准品回收率合格，定量范围只有一个浓度点。"],
    dir: ["The standards' signal runs the other way from the assay type you chose.", "标准品信号方向与所选的方法类型相反。"]
  };
  function renderWarnings(list) {
    $("warnings").innerHTML = list.map(function (w) { return "<li><b>" + L("CHECK", "检查") + "</b>" + esc(L(w[0], w[1])) + "</li>"; }).join("");
  }
  function renderResults() {
    if (!res || !res.ok) { renderWarnings(res ? (res.warnings || []).map(function (w) { return WARN[w.code]; }) : []); $("smpRes").innerHTML = ""; $("summary").innerHTML = ""; $("rerunBox").innerHTML = ""; $("work").innerHTML = ""; $("methods").textContent = ""; $("algo").textContent = ""; return; }
    var ws = res.warnings.map(function (w) { return WARN[w.code]; });
    var f5 = res.fitAll.f5;
    if (state.set.model === "5pl" && f5 && f5.ok && !E.trusted(f5)) ws.push(["5PL is not trusted for these standards — see the curve section.", "5PL 对这组标准品不可信——见标准曲线部分。"]);
    var badStd = res.std.filter(function (s) { return s.conc > 0 && s.rec != null && !s.inRange; });
    if (badStd.length) ws.push(["Standards outside the range: " + badStd.map(function (s) { return s.id + " (" + fp(s.rec) + "%)"; }).join(", ") + ".", "超出定量范围的标准品：" + badStd.map(function (s) { return s.id + "（" + fp(s.rec) + "%）"; }).join("，") + "。"]);
    renderWarnings(ws);
    var all = res.smp.concat(res.ctl), u = unit();
    var n = { ok: 0, high: 0, low: 0, cv: 0 };
    all.forEach(function (o) {
      if (o.status === "ok") n.ok++;
      if (o.status === "high" || o.status === "above") n.high++;
      if (o.status === "low" || o.status === "below") n.low++;
      if (o.flags.indexOf("cv") >= 0) n.cv++;
    });
    $("summary").innerHTML = '<span><b>' + n.ok + "</b> " + L("in range", "在范围内") + '</span><span class="' + (n.high ? "is-w" : "") + '"><b>' + n.high + "</b> " + L("above", "高于范围") + '</span><span class="' + (n.low ? "is-w" : "") + '"><b>' + n.low + "</b> " + L("below", "低于范围") + '</span><span class="' + (n.cv ? "is-w" : "") + '"><b>' + n.cv + "</b> " + L("high CV", "CV 偏高") + "</span>" +
      (res.lloq != null ? '<span class="el-sum-r">' + L("range ", "定量范围 ") + fc(res.lloq) + " – " + fc(res.uloq) + " " + esc(u) + " " + L("in the well", "（孔内）") + "</span>" : "");
    var rows = "";
    var sec = function (title, list) {
      if (!list.length) return;
      rows += '<tr class="el-sec"><td colspan="9">' + title + "</td></tr>";
      list.forEach(function (o) {
        var inR = o.status === "ok" || o.status === "norange";
        var st = flagHtml(o.status, "s") + o.flags.map(function (fl) { return " " + flagHtml(fl, "f"); }).join("");
        if (o.t === "ctl" && o.rec != null) st += ' <span class="el-rec' + (o.flags.indexOf("rec") >= 0 ? " el-bad" : "") + '">' + L("rec. ", "回收 ") + fp(o.rec) + "%</span>";
        if (o.bb0 != null) st += ' <span class="el-dim">B/B0 ' + fp(o.bb0) + "%</span>";
        var conc = o.final != null ? (inR ? "<b>" + fc(o.final) + "</b>" : '<span class="el-dim" title="' + esc(L("extrapolated — not for reporting", "外推值，不应报告")) + '">(' + fc(o.final) + ")</span>") : "";
        var rep = inR ? "" : '<span class="el-rep">' + esc(reportable(o)) + "</span>";
        rows += '<tr data-id="' + esc(o.id) + '" class="' + (selRow === o.id ? "is-sel " : "") + (inR && !o.flags.length ? "" : "is-warn") + '"><td class="nm">' + esc(o.id) + '</td><td class="el-name">' + esc(o.name) + '</td><td class="n">' + (o.sat.length && !o.live.length ? "OVR" : f3(o.mean)) + '</td><td class="n' + (o.flags.indexOf("cv") >= 0 ? " el-bad" : "") + '">' + fp(o.cv) + '</td><td class="n">' + (o.well != null ? '<span class="' + (inR ? "" : "el-dim") + '">' + fc(o.well) + "</span>" : "—") + '</td><td class="n">' + LM.fmt(o.dil) + '</td><td class="n">' + (rep && conc ? rep + "<br>" + conc : (conc || rep || "—")) + "</td><td>" + st + '</td><td class="el-adv">' + esc(adviceText(o)) + "</td></tr>";
      });
    };
    sec(L("SAMPLES", "样本"), res.smp);
    sec(L("CONTROLS", "质控"), res.ctl);
    $("smpRes").innerHTML = rows || '<tr><td colspan="9" class="qp-none">' + L("No samples on the layout yet.", "布局里还没有样本。") + "</td></tr>";
    renderWork();
    // re-run list
    var rr = all.filter(function (o) { return o.advice && (o.advice.kind === "dilute" || o.advice.kind === "less" || o.advice.kind === "repeat"); });
    $("rerunBox").innerHTML = rr.length ? '<div class="presets-k">' + L("RE-RUN LIST", "重测清单") + ' <span class="dt-count">' + rr.length + '</span> <button type="button" class="lm-link" id="copyRerun">' + L("COPY", "复制") + "</button></div><ol>" +
      rr.map(function (o) { return "<li><b>" + esc(o.id) + "</b> " + esc(o.name !== o.id ? o.name : "") + " — " + esc(adviceText(o)) + "</li>"; }).join("") + "</ol>" : "";
    $("methods").textContent = methods();
    $("algo").textContent = algoLine();
  }
  function algoLine() {
    var f = res.fit;
    return L("Calculated with labmate.tools 5.5 ELISA Standard Curve Analyzer, algorithm " + E.ALGO + ", " + new Date().toISOString().slice(0, 10) + ". " + (f.five ? "5PL" : "4PL") + ", weighting " + wName(f.weight) + ".",
      "由 labmate.tools 5.5 ELISA 标准曲线分析器计算，算法 " + E.ALGO + "，" + new Date().toISOString().slice(0, 10) + "。" + (f.five ? "5PL" : "4PL") + "，加权 " + wName(f.weight) + "。");
  }

  function renderWork() {
    var box = $("work");
    var o = selRow && res && res.ok ? res.smp.concat(res.ctl).filter(function (x) { return x.id === selRow; })[0] : null;
    if (!o) { box.innerHTML = ""; return; }
    var p = res.p, u = unit();
    var h = '<div class="dt-work-h"><span>' + L("WORKING", "计算过程") + "</span><b>" + esc(o.id + (o.name !== o.id ? " · " + o.name : "")) + '</b><span class="dt-work-note">' + (res.fit.five ? "5PL" : "4PL") + "</span></div><dl class=\"dt-dl\">";
    h += "<dt>" + L("wells", "孔") + "</dt><dd>" + o.wells.map(function (w) {
      var W = res.wells[w];
      return w + " " + (W.sat ? "OVR" : f3(W.raw)) + (state.ex[w] ? " (" + L("excluded", "已排除") + ")" : "");
    }).join(" · ") + "</dd>";
    if (res.subtract.what !== "none") h += "<dt>" + L("minus", "减去") + "</dt><dd>" + f3(res.subtract.value) + " → " + o.live.map(function (w) { return f3(res.wells[w].v); }).join(" · ") + "</dd>";
    h += "<dt>" + L("mean OD", "平均 OD") + "</dt><dd>y = " + f3(o.mean) + (isFinite(o.sd) ? " · SD " + LM.fmt(o.sd, 3) + " · CV " + fp(o.cv) + "%" : "") + "</dd>";
    if (o.well != null) {
      var t = (p.A - p.D) / (o.mean - p.D);
      h += "<dt>(A − D) ÷ (y − D)</dt><dd>(" + f3(p.A) + " − " + f3(p.D) + ") ÷ (" + f3(o.mean) + " − " + f3(p.D) + ") = " + LM.fmt(t, 5) + "</dd>";
      if (res.fit.five) h += "<dt>^(1/G) − 1</dt><dd>" + LM.fmt(t, 5) + "^(1/" + LM.fmt(p.G, 4) + ") − 1 = " + LM.fmt(Math.pow(t, 1 / p.G) - 1, 5) + "</dd>";
      else h += "<dt>− 1</dt><dd>" + LM.fmt(t - 1, 5) + "</dd>";
      var q = res.fit.five ? Math.pow(t, 1 / p.G) - 1 : t - 1;
      h += "<dt>x = C · (…)^(1/B)</dt><dd>" + LM.fmt(p.C, 5) + " × " + LM.fmt(q, 5) + "^(1/" + LM.fmt(p.B, 4) + ") = <b>" + fc(o.well) + " " + esc(u) + "</b></dd>";
      h += "<dt>× " + L("dilution", "稀释") + "</dt><dd>" + fc(o.well) + " × " + LM.fmt(o.dil) + " = <b>" + fc(o.final) + " " + esc(u) + "</b></dd>";
      if (o.per.length > 1) h += "<dt>" + L("each well", "各孔") + "</dt><dd>" + o.per.map(function (b, i) { return o.live[i] + " " + (b.x != null ? fc(b.x * o.dil) : "—"); }).join(" · ") + (isFinite(o.concCv) ? " · CV " + fp(o.concCv) + "%" : "") + "</dd>";
    } else {
      h += "<dt>" + L("result", "结果") + "</dt><dd>" + (o.status === "above" ? L("OD at or beyond the saturation end of the curve (D = " + f3(p.D) + ") — no concentration can be read.", "OD 达到或超过曲线饱和端（D = " + f3(p.D) + "）——无法读出浓度。") : L("OD at or beyond the zero end of the curve (A = " + f3(p.A) + ").", "OD 达到或超过曲线零点端（A = " + f3(p.A) + "）。")) + "</dd>";
    }
    if (res.lloq != null) h += "<dt>" + L("range", "范围") + "</dt><dd>" + fc(res.lloq) + " – " + fc(res.uloq) + " " + esc(u) + L(" in the well → ", "（孔内）→ ") + fc(res.lloq * o.dil) + " – " + fc(res.uloq * o.dil) + " " + esc(u) + L(" at 1:", "（1:") + LM.fmt(o.dil) + L("", "）") + "</dd>";
    if (o.advice && (o.advice.kind === "dilute" || o.advice.kind === "less")) {
      var tgt = res.mid;
      h += "<dt>" + L("next", "下一步") + "</dt><dd>" + esc(adviceText(o)) + (o.well != null && tgt ? " <small>" + L("(aims for the middle of the range, " + fc(tgt, 3) + " " + u + ", rounded to a pipettable fold)", "（目标是定量范围中点 " + fc(tgt, 3) + " " + u + "，倍数取整到方便移液的值）") + "</small>" : "") + "</dd>";
    }
    h += "</dl>";
    box.innerHTML = h;
  }

  function methods() {
    if (!res || !res.ok) return "";
    var f = res.fit, s = state.src || {}, u = unit(), p = plateInput(), zh = lang === "zh";
    var sigL = state.plates[state.sig] ? state.plates[state.sig].label : "", refL = state.ref >= 0 && state.plates[state.ref] ? state.plates[state.ref].label : "";
    var wl = E.wavelength(sigL), wr = refL ? E.wavelength(refL) : null;
    var stdC = res.std.filter(function (x) { return x.inFit && x.conc > 0; }).map(function (x) { return x.conc; });
    var nLv = res.nStdLevels;
    var reps = res.std.length ? Math.round(mean(res.std.map(function (x) { return x.live.length; }))) : 0;
    var rec = res.std.filter(function (x) { return x.inRange && x.rec != null; }).map(function (x) { return x.rec; });
    var ex = Object.keys(state.ex).filter(function (w) { return state.wells[w]; }).sort(E.wellOrder);
    void p;
    if (zh) {
      return (state.meta.assay ? state.meta.assay + "。" : "") + "在" + (s.instrument || "酶标仪") + "上读取" + (wl ? " " + wl + " nm " : "") + "吸光度" + (wr ? "，并逐孔减去 " + wr + " nm 参比读数" : "") + "。" +
        (res.subtract.what === "blk" ? "所有孔减去空白孔平均 OD（" + f3(res.subtract.value) + "）。" : res.subtract.what === "zero" ? "所有孔减去零浓度标准品平均 OD（" + f3(res.subtract.value) + "）。" : "") +
        "用加权最小二乘法（权重 " + wName(f.weight) + "，按每个标准品浓度点的平均 OD 计算；Levenberg–Marquardt 算法）将" + (f.five ? "五参数（5PL）" : "四参数（4PL）") + "logistic 曲线拟合到 " + nLv + " 个标准品浓度点（" + fc(Math.min.apply(null, stdC)) + "–" + fc(Math.max.apply(null, stdC)) + " " + u + "，" + (reps > 1 ? reps + " 复孔" : "单孔") + (res.std.some(function (x) { return x.conc === 0 && x.inFit; }) ? "，含零浓度点" : "") + "），R² = " + f.r2.toFixed(4) + "。" +
        (res.fitAll.test ? "4PL 与 5PL 的额外平方和 F 检验 p = " + pFmt(res.fitAll.test.p) + "。" : "") +
        (res.lloq != null ? "定量范围（LLOQ–ULOQ）为 " + fc(res.lloq) + "–" + fc(res.uloq) + " " + u + "（标准品回算回收率 80–120%、CV ≤ 20%，两端 75–125%、25%）" + (rec.length ? "，范围内标准品回收率 " + fp(Math.min.apply(null, rec)) + "–" + fp(Math.max.apply(null, rec)) + "%" : "") + "。" : "") +
        "样本浓度由复孔平均 OD 经曲线反算，再乘以各自的稀释倍数；超出定量范围的样本不报告具体数值。复孔 CV 超过 " + res.cvMax + "% 的样本已标记。" +
        (ex.length ? "排除的孔：" + ex.join("、") + "。" : "") + "计算使用 labmate.tools ELISA 标准曲线分析器（算法 " + E.ALGO + "）。";
    }
    return (state.meta.assay ? state.meta.assay + ". " : "") + "Absorbance" + (wl ? " at " + wl + " nm" : "") + " was read on a " + (s.instrument || "microplate reader") + (wr ? ", and the " + wr + " nm reference reading was subtracted from each well" : "") + ". " +
      (res.subtract.what === "blk" ? "The mean OD of the blank wells (" + f3(res.subtract.value) + ") was subtracted from every well. " : res.subtract.what === "zero" ? "The mean OD of the zero standard (" + f3(res.subtract.value) + ") was subtracted from every well. " : "") +
      "A " + (f.five ? "five-parameter (5PL)" : "four-parameter (4PL)") + " logistic curve was fitted to " + nLv + " standard levels (" + fc(Math.min.apply(null, stdC)) + "–" + fc(Math.max.apply(null, stdC)) + " " + u + ", " + (reps > 1 ? "in " + (reps === 2 ? "duplicate" : reps === 3 ? "triplicate" : reps + " replicates") : "single wells") + (res.std.some(function (x) { return x.conc === 0 && x.inFit; }) ? ", including the zero standard" : "") + ") by weighted least squares (weights " + wName(f.weight) + " from the mean OD of each level; Levenberg–Marquardt), R² = " + f.r2.toFixed(4) + ". " +
      (res.fitAll.test ? "Extra-sum-of-squares F-test 4PL vs 5PL: p = " + pFmt(res.fitAll.test.p) + ". " : "") +
      (res.lloq != null ? "The quantification range (LLOQ–ULOQ) was " + fc(res.lloq) + "–" + fc(res.uloq) + " " + u + " (back-calculated standards recovering 80–120% with CV ≤ 20%; 75–125% and 25% at the ends)" + (rec.length ? "; standards in range recovered " + fp(Math.min.apply(null, rec)) + "–" + fp(Math.max.apply(null, rec)) + "%" : "") + ". " : "") +
      "Sample concentrations were interpolated from the mean OD of replicate wells and multiplied by each sample's dilution factor; values outside the quantification range are reported as below or above it. Samples with a replicate CV above " + res.cvMax + "% were flagged. " +
      (ex.length ? "Excluded wells: " + ex.join(", ") + ". " : "") + "Calculated with the labmate.tools ELISA Standard Curve Analyzer (algorithm " + E.ALGO + ").";
  }
  function mean(a) { return E.mean(a); }

  function renderMeta() {
    var m = state.meta;
    [["mAssay", "assay"], ["mLot", "lot"], ["mOp", "op"], ["mDate", "date"], ["mNotes", "notes"]].forEach(function (q) { if (document.activeElement !== $(q[0])) $(q[0]).value = m[q[1]] || ""; });
  }

  // ---------------------------------------------------------------- exports
  function csvCell(v) { v = v == null ? "" : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function tableRows() {
    var u = unit(), out = [[L("Type", "类型"), "ID", L("Name", "名称"), L("Wells", "孔位"), L("OD per well", "各孔 OD"), L("Mean OD", "平均 OD"), "CV %", L("In well (" + u + ")", "孔内浓度 (" + u + ")"), L("Dilution", "稀释倍数"), L("Concentration (" + u + ")", "浓度 (" + u + ")"), L("Reportable", "可报告值"), L("Status", "状态"), L("Flags", "标记"), L("Expected", "预期值"), L("Recovery %", "回收率 %"), L("Next step", "下一步")]];
    res.std.forEach(function (s) {
      out.push([L("standard", "标准品"), s.id, "", s.wells.join(" "), s.wells.map(function (w) { return res.wells[w].sat ? "OVR" : LM.fmtPlain(res.wells[w].v, 4) + (state.ex[w] ? "(x)" : ""); }).join(" "), LM.fmtPlain(s.mean, 4), isFinite(s.cv) ? s.cv.toFixed(1) : "", s.backMean != null ? LM.fmtPlain(s.backMean, 5) : "", "", s.conc != null ? LM.fmtPlain(s.conc, 6) : "", "", s.inRange ? L("in range", "范围内") : s.conc === 0 ? L("zero", "零点") : L("out of range", "范围外"), "", s.conc != null ? LM.fmtPlain(s.conc, 6) : "", s.rec != null ? s.rec.toFixed(1) : "", ""]);
    });
    res.smp.concat(res.ctl).forEach(function (o) {
      out.push([o.t === "ctl" ? L("control", "质控") : L("sample", "样本"), o.id, o.name, o.wells.join(" "), o.wells.map(function (w) { return res.wells[w].sat ? "OVR" : LM.fmtPlain(res.wells[w].v, 4) + (state.ex[w] ? "(x)" : ""); }).join(" "), LM.fmtPlain(o.mean, 4), isFinite(o.cv) ? o.cv.toFixed(1) : "", o.well != null ? LM.fmtPlain(o.well, 5) : "", LM.fmtPlain(o.dil, 6), o.final != null ? LM.fmtPlain(o.final, 5) : "", reportable(o).replace(/ /g, ""), L(STATUS[o.status][0], STATUS[o.status][1]), o.flags.map(function (f) { return L(FLAG[f][0], FLAG[f][1]); }).join("; "), o.expected != null ? LM.fmtPlain(o.expected, 6) : "", o.rec != null ? o.rec.toFixed(1) : "", adviceText(o)]);
    });
    return out;
  }
  function download(name, blob) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function stem() { return (state.meta.assay || (state.src && state.src.name) || "elisa").replace(/\.[^.]+$/, "").replace(/[^\w\-]+/g, "_").slice(0, 40) || "elisa"; }
  function flash(msg) { $("copied").textContent = msg; setTimeout(function () { $("copied").textContent = ""; }, 1800); }
  function record() {
    return {
      tool: "labmate.tools 5.5 ELISA Standard Curve Analyzer", url: "https://labmate.tools/tools/elisa/", algorithm: E.ALGO, saved: new Date().toISOString(),
      source: state.src, plates: state.plates, signal: state.sig, reference: state.ref,
      wells: state.wells, groups: state.groups, excluded: state.ex, settings: state.set, meta: state.meta,
      results: res && res.ok ? {
        model: res.fit.five ? "5PL" : "4PL", weight: res.fit.weight, params: res.p, se: res.fit.se, r2: res.fit.r2, lloq: res.lloq, uloq: res.uloq, lod: res.lod ? res.lod.x : null,
        subtracted: res.subtract, unit: unit(),
        samples: res.smp.concat(res.ctl).map(function (o) { return { id: o.id, name: o.name, meanOD: o.mean, inWell: o.well, dilution: o.dil, concentration: o.final, status: o.status, flags: o.flags }; })
      } : null
    };
  }
  function openRecord(r, name) {
    if (!r || !Array.isArray(r.plates) || !r.wells) throw new Error(L("This .json file is not an ELISA record from this tool.", "这个 .json 不是本工具保存的 ELISA 记录。"));
    var s = fresh();
    s.plates = r.plates; s.sig = r.signal || 0; s.ref = r.reference == null ? -1 : r.reference; s.src = r.source || { name: name };
    s.wells = r.wells; s.groups = r.groups || {}; s.ex = r.excluded || {};
    Object.keys(r.settings || {}).forEach(function (k) { s.set[k] = r.settings[k]; });
    s.meta = r.meta || s.meta;
    s.next = { std: 1, smp: 1, ctl: 1 };
    state = s;
    state.next = { std: nextFree("std"), smp: nextFree("smp"), ctl: nextFree("ctl") };
    res = analyse();
    lastMsgs = [{ ok: true, en: name + ": record opened (" + (r.saved || "").slice(0, 10) + ", " + (r.algorithm || "?") + ")", zh: name + "：已打开记录（" + (r.saved || "").slice(0, 10) + "，" + (r.algorithm || "?") + "）" }];
    // recalculate and compare
    if (r.results && res && res.ok) {
      var diff = [];
      var same = function (a, b) { return (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= 1e-6 * Math.max(Math.abs(a), Math.abs(b), 1e-12)); };
      if (!same(r.results.lloq, res.lloq) || !same(r.results.uloq, res.uloq)) diff.push("LLOQ/ULOQ");
      (r.results.samples || []).forEach(function (q) {
        var o = res.smp.concat(res.ctl).filter(function (x) { return x.id === q.id; })[0];
        if (!o || !same(q.concentration, o.final) || q.status !== o.status) diff.push(q.id);
      });
      recordCheck = diff.length
        ? { ok: false, en: "Recalculated: " + diff.length + " result(s) differ from the record (" + diff.slice(0, 8).join(", ") + (diff.length > 8 ? ", …" : "") + ")" + (r.algorithm !== E.ALGO ? " — the record was made with " + r.algorithm : "") + ".", zh: "重新计算：" + diff.length + " 个结果与记录不同（" + diff.slice(0, 8).join("、") + (diff.length > 8 ? "…" : "") + "）" + (r.algorithm !== E.ALGO ? "——该记录由 " + r.algorithm + " 生成" : "") + "。" }
        : { ok: true, en: "Recalculated: every result matches the record.", zh: "重新计算：所有结果与记录一致。" };
    } else recordCheck = null;
  }

  // ---------------------------------------------------------------- events
  function on(id, ev, fn) { $(id).addEventListener(ev, fn); }
  function segHandler(id, fn) {
    on(id, "click", function (e) { var b = e.target.closest("button[data-v]"); if (!b) return; fn(b.getAttribute("data-v")); render(); });
  }
  segHandler("langSeg", function (v) { lang = v; try { localStorage.setItem(LKEY, v); } catch (e) {} applyLang(); });
  segHandler("brushSeg", function (v) { state.brush = v; });
  segHandler("repSeg", function (v) { state.rep = +v; });
  segHandler("dirSeg", function (v) { state.dir = v; });
  segHandler("modelSeg", function (v) { state.set.model = v; });
  segHandler("weightSeg", function (v) { state.set.weight = v; });
  segHandler("fmtSeg", function (v) { state.set.format = v; });
  segHandler("rangeSeg", function (v) { state.set.range = v; });
  on("plate", "click", function (e) {
    var b = e.target.closest("button[data-w]"); if (!b) return;
    paint(b.getAttribute("data-w")); state.example = false; render();
    var nb = $("plate").querySelector('[data-w="' + b.getAttribute("data-w") + '"]'); if (nb) nb.focus();
  });
  on("nextNum", "change", function () { var v = parseInt($("nextNum").value, 10); if (v > 0 && state.next[state.brush] != null) state.next[state.brush] = v; render(); });
  on("presetSel", "change", function () { state.preset = $("presetSel").value; save(); });
  on("presetUse", "click", function () { state.preset = $("presetSel").value; applyPreset(state.preset); state.example = false; render(); });
  on("fileIn", "change", function () { if (this.files && this.files[0]) readFile(this.files[0]); this.value = ""; });
  var drop = $("drop");
  ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-over"); }); });
  ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove("is-over"); }); });
  drop.addEventListener("drop", function (e) { e.preventDefault(); var f = e.dataTransfer && e.dataTransfer.files; if (f && f[0]) readFile(f[0]); });
  on("example", "click", loadExample);
  on("pasteUse", "click", usePaste);
  on("sigSel", "change", function () { state.sig = +this.value; if (state.ref === state.sig) state.ref = -1; render(); });
  on("refSel", "change", function () { state.ref = +this.value; render(); });
  on("blankSel", "change", function () { state.set.blank = this.value; render(); });
  on("zeroFit", "change", function () { state.set.zeroFit = this.checked; render(); });
  on("cvMax", "change", function () { state.set.cvMax = this.value; render(); });
  on("unitSel", "change", function () { state.set.unit = this.value; render(); });
  // group inputs (standards, samples, controls)
  function groupInput(e) {
    var t = e.target; if (!t.getAttribute || !t.getAttribute("data-g")) return;
    var g = state.groups[t.getAttribute("data-g")]; if (!g) return;
    var k = t.getAttribute("data-k"), v = t.value;
    if (k === "dil") v = v.replace(/^\s*1\s*[:：]\s*/, "");
    g[k] = v; state.example = false;
    res = analyse(); renderFit(); renderResults(); renderPlate(); save();
  }
  ["stdRows", "smpRows", "ctlRows"].forEach(function (id) { on(id, "change", groupInput); });
  on("serUse", "click", function () {
    var top = LM.parse($("serTop").value), fold = LM.parse($("serFold").value), zero = $("serZero").checked;
    state.ser = { top: $("serTop").value, fold: $("serFold").value, zero: zero };
    var ids = usedIds("std");
    if (!(top > 0) || !(fold > 1) || !ids.length) { render(); return; }
    var c = E.series(top, fold, ids.length, zero);
    ids.forEach(function (g, i) { state.groups[g].conc = fmtIn(c[i]); });
    state.example = false; render();
  });
  on("dilAllUse", "click", function () {
    var v = LM.parse(String($("dilAll").value).replace(/^\s*1\s*[:：]\s*/, ""));
    if (!(v > 0)) return;
    usedIds("smp").forEach(function (g) { state.groups[g].dil = fmtIn(v); });
    state.example = false; render();
  });
  on("namesOpen", "click", function () { $("namesBox").hidden = !$("namesBox").hidden; });
  on("namesUse", "click", function () {
    var lines = $("namesText").value.split(/\r?\n/).filter(function (l) { return l.trim(); });
    var ids = usedIds("smp");
    lines.forEach(function (l, i) {
      if (!ids[i]) return;
      var parts = l.split(/\t|;|,(?=\s*(?:1\s*[:：]\s*)?\d[\d.]*\s*$)/);
      var g = state.groups[ids[i]];
      g.name = parts[0].trim();
      if (parts[1] != null) { var d = LM.parse(parts[1].replace(/^\s*1\s*[:：]\s*/, "")); if (d > 0) g.dil = fmtIn(d); }
    });
    $("namesBox").hidden = true; state.example = false; render();
  });
  on("stdRes", "click", function (e) {
    var b = e.target.closest("[data-ex]"); if (!b) return;
    var w = b.getAttribute("data-ex"); if (state.ex[w]) delete state.ex[w]; else state.ex[w] = 1;
    render();
  });
  on("smpRes", "click", function (e) {
    var tr = e.target.closest("tr[data-id]"); if (!tr) return;
    selRow = selRow === tr.getAttribute("data-id") ? null : tr.getAttribute("data-id");
    renderResults();
  });
  on("rerunBox", "click", function (e) {
    if (!e.target.closest("#copyRerun")) return;
    var all = res.smp.concat(res.ctl).filter(function (o) { return o.advice && o.advice.kind !== "none"; });
    LM.copy(all.map(function (o) { return o.id + "\t" + o.name + "\t" + adviceText(o); }).join("\n"), function (ok) { flash(ok ? L("Copied", "已复制") : L("Copy failed", "复制失败")); });
  });
  on("copy", "click", function () {
    if (!res || !res.ok) return;
    LM.copy(tableRows().map(function (r) { return r.join("\t"); }).join("\n"), function (ok) { flash(ok ? L("Copied — paste into Excel", "已复制，可粘贴到 Excel") : L("Copy failed", "复制失败")); });
  });
  on("csv", "click", function () {
    if (!res || !res.ok) return;
    var csv = "﻿" + tableRows().map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n";
    download(stem() + "_elisa.csv", new Blob([csv], { type: "text/csv;charset=utf-8" }));
  });
  on("svg", "click", function () { if (res && res.ok) download(stem() + "_curve.svg", new Blob([chartSvg(true)], { type: "image/svg+xml" })); });
  on("png", "click", function () {
    if (!res || !res.ok) return;
    var img = new Image(), url = URL.createObjectURL(new Blob([chartSvg(true)], { type: "image/svg+xml" }));
    img.onload = function () {
      var c = document.createElement("canvas"); c.width = 1280; c.height = 800;
      var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(function (b) { download(stem() + "_curve.png", b); });
    };
    img.src = url;
  });
  on("copyMethods", "click", function () { LM.copy(methods(), function (ok) { flash(ok ? L("Copied", "已复制") : L("Copy failed", "复制失败")); }); });
  on("json", "click", function () { if (res) download(stem() + ".elisa.json", new Blob([JSON.stringify(record(), null, 1)], { type: "application/json" })); });
  on("print", "click", function () { window.print(); });
  [["mAssay", "assay"], ["mLot", "lot"], ["mOp", "op"], ["mDate", "date"], ["mNotes", "notes"]].forEach(function (q) {
    on(q[0], "input", function () { state.meta[q[1]] = $(q[0]).value; if (res && res.ok) $("methods").textContent = methods(); save(); });
  });
  on("clear", "click", function () {
    var u = state.set.unit;
    state = fresh(); state.set.unit = u; res = null; selRow = null; lastMsgs = null; recordCheck = null;
    try { localStorage.removeItem(KEY); } catch (e) {}
    render();
  });
  // print header (only on paper)
  window.addEventListener("beforeprint", function () {
    var old = $("printHead"); if (old) old.remove();
    var m = state.meta, s = state.src || {};
    var d = document.createElement("div"); d.id = "printHead"; d.className = "el-printhead";
    d.innerHTML = "<h2>" + esc(L("ELISA report", "ELISA 检测报告")) + (m.assay ? " — " + esc(m.assay) : "") + "</h2><dl>" +
      [[L("Data file", "数据文件"), (s.name || "") + (s.instrument ? " · " + s.instrument : "")], [L("Read", "读数"), (state.plates[state.sig] || {}).label + (state.ref >= 0 && state.plates[state.ref] ? " − " + state.plates[state.ref].label : "")],
        [L("Lot", "批号"), m.lot], [L("Operator", "操作人"), m.op], [L("Run date", "检测日期"), m.date], [L("Notes", "备注"), m.notes], [L("Printed", "打印时间"), new Date().toLocaleString()]]
        .filter(function (q) { return q[1]; }).map(function (q) { return "<dt>" + esc(q[0]) + "</dt><dd>" + esc(q[1]) + "</dd>"; }).join("") + "</dl>" +
      '<div class="el-printplate">' + $("plate").outerHTML.replace('id="plate"', "") + "</div>";
    document.querySelector(".lm-page").insertBefore(d, document.querySelector(".lm-page").children[1]);
  });
  window.addEventListener("afterprint", function () { var old = $("printHead"); if (old) old.remove(); });

  // test hook
  if (window.LMT_EL_TEST) window.LMT_EL_TEST.api = { state: function () { return state; }, res: function () { return res; }, render: render, setState: function (s) { state = s; render(); }, paint: paint, loadExample: loadExample, methods: methods, tableRows: tableRows, record: record, openRecord: function (r) { openRecord(r, "test.json"); render(); } };

  applyLang();
  if (!state.plates.length && !LM.load(KEY)) loadExample(); else render();
})();
