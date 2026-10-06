// labmate.tools — 1.2 Plate Layout
(function () {
  "use strict";
  var LM = window.LM;
  var KEY = "lm-platelayout-v1";
  var FORMATS = { 96: { R: 8, C: 12 }, 384: { R: 16, C: 24 } };
  var N_CTRL_STYLES = 6;

  var EXAMPLE = {
    format: 96,
    samples: Array.from({ length: 24 }, function (_, i) { return "S" + String(i + 1).padStart(2, "0"); }).join("\n"),
    controls: "NTC\nPositive",
    reps: 3, dir: "across", fill: "col", ctrlPos: "end",
    skipEdges: false, repeatCtrls: true, plateName: "",
    blocked: { 96: [], 384: [] }
  };

  var $ = function (id) { return document.getElementById(id); };
  var state = LM.load(KEY);
  if (!state || !FORMATS[state.format]) state = JSON.parse(JSON.stringify(EXAMPLE));
  if (!state.blocked) state.blocked = { 96: [], 384: [] };
  var plateIdx = 0;
  var result = null;

  function rowName(r) { return String.fromCharCode(65 + r); }
  function wellId(r, c) { return rowName(r) + (c + 1); }

  function lines(text) {
    return String(text || "").split(/\r?\n/).map(function (l) {
      return l.split("\t")[0].replace(/^"|"$/g, "").trim();
    }).filter(Boolean);
  }

  // ---------- layout ----------
  function buildUnits(f, reps, dir, fill, skip, blocked) {
    var r0 = skip ? 1 : 0, r1 = skip ? f.R - 2 : f.R - 1;
    var c0 = skip ? 1 : 0, c1 = skip ? f.C - 2 : f.C - 1;
    var nr = r1 - r0 + 1, nc = c1 - c0 + 1;
    var uRows = dir === "down" ? Math.floor(nr / reps) : nr;
    var uCols = dir === "across" ? Math.floor(nc / reps) : nc;
    var units = [];
    function unit(ur, uc) {
      var wells = [];
      for (var k = 0; k < reps; k++) {
        var r = dir === "down" ? r0 + ur * reps + k : r0 + ur;
        var c = dir === "across" ? c0 + uc * reps + k : c0 + uc;
        if (blocked[wellId(r, c)]) return null;
        wells.push([r, c]);
      }
      return wells;
    }
    var outer = fill === "col" ? uCols : uRows, inner = fill === "col" ? uRows : uCols;
    for (var o = 0; o < outer; o++) for (var i = 0; i < inner; i++) {
      var u = fill === "col" ? unit(i, o) : unit(o, i);
      if (u) units.push(u);
    }
    return units;
  }

  function layout() {
    var f = FORMATS[state.format];
    var blocked = {};
    (state.blocked[state.format] || []).forEach(function (id) { blocked[id] = true; });
    var samples = lines(state.samples), ctrls = lines(state.controls);
    var units = buildUnits(f, state.reps, state.dir, state.fill, state.skipEdges, blocked);
    var per = units.length;
    var res = { f: f, samples: samples, ctrls: ctrls, per: per, plates: [], error: "", blocked: blocked };
    if (!per) { res.error = "No room for even one sample — fewer replicates, or un-block some wells."; return res; }

    var sItems = samples.map(function (n, i) { return { name: n, type: "sample", i: i }; });
    var cItems = ctrls.map(function (n, i) { return { name: n, type: "ctrl", i: i }; });
    var plateItems = [];
    if (state.repeatCtrls && cItems.length) {
      var room = per - cItems.length;
      if (room <= 0) { res.error = "The controls alone fill the plate."; return res; }
      for (var s = 0; s < sItems.length || (s === 0 && !sItems.length); s += room) {
        var chunk = sItems.slice(s, s + room);
        plateItems.push(state.ctrlPos === "start" ? cItems.concat(chunk) : chunk.concat(cItems));
        if (!sItems.length) break;
      }
    } else {
      var all = state.ctrlPos === "start" ? cItems.concat(sItems) : sItems.concat(cItems);
      for (var a = 0; a < all.length; a += per) plateItems.push(all.slice(a, a + per));
      if (!plateItems.length) plateItems.push([]);
    }
    plateItems.forEach(function (items) {
      var wells = {};
      items.forEach(function (it, k) {
        units[k].forEach(function (rc, rep) { wells[wellId(rc[0], rc[1])] = { item: it, rep: rep + 1 }; });
      });
      res.plates.push({ items: items, wells: wells });
    });
    return res;
  }

  // ---------- render ----------
  function cls(it) {
    return it.type === "sample" ? "s" + (it.i % 2) : "c" + (it.i % N_CTRL_STYLES);
  }

  // shared start of the sample names (not cut inside a number), shown once in the legend
  function commonPrefix(names) {
    if (names.length < 2) return "";
    var p = names[0];
    names.forEach(function (n) { while (n.indexOf(p) !== 0) p = p.slice(0, -1); });
    while (p && /\d/.test(p.slice(-1))) p = p.slice(0, -1);
    if (p.length < 2 || names.some(function (n) { return n.length === p.length; })) return "";
    return p;
  }

  function render() {
    result = layout();
    result.prefix = commonPrefix(result.samples);
    var f = result.f;
    if (plateIdx >= result.plates.length) plateIdx = 0;
    $("nSamples").textContent = result.samples.length;
    $("nCtrls").textContent = result.ctrls.length;

    // tabs
    var tabs = $("tabs");
    tabs.innerHTML = result.plates.length > 1 ? result.plates.map(function (_, i) {
      return '<button type="button" data-i="' + i + '" aria-pressed="' + (i === plateIdx) + '">PLATE ' + (i + 1) + "</button>";
    }).join("") : "";

    // plate grid
    var plate = result.plates[plateIdx] || { wells: {}, items: [] };
    var el = $("plate");
    el.style.setProperty("--nc", f.C);
    el.innerHTML = plateHTML(plate);

    // legend
    var nBlocked = Object.keys(result.blocked).length;
    $("legend").innerHTML = legendHTML(plate);

    $("blockedNote").innerHTML = nBlocked ? '· <button type="button" class="lm-link" id="unblock">USE ALL WELLS AGAIN</button>' : "";

    // stats + notes
    var total = f.R * f.C;
    var used = Object.keys(plate.wells).length;
    var nItems = result.samples.length + result.ctrls.length;
    var notes = [];
    if (result.error) {
      $("stats").innerHTML = "";
      notes.push('<li class="note"><b>' + LM.esc(result.error) + "</b></li>");
    } else if (!nItems) {
      $("stats").textContent = "Paste your samples to start.";
    } else {
      $("stats").innerHTML = "<b>" + result.samples.length + "</b> samples + <b>" + result.ctrls.length + "</b> controls × " + state.reps +
        " · <b>" + result.plates.length + "</b> plate" + (result.plates.length > 1 ? "s" : "") +
        " · this plate: " + used + " used, " + (total - used - nBlocked) + " empty";
      if (result.plates.length > 1) notes.push('<li class="note info">Doesn\'t fit on one plate — continued on ' + result.plates.length + " plates. Use the tabs above the plate.</li>");
      var lost = state.dir === "across" ? ((state.skipEdges ? f.C - 2 : f.C) % state.reps) : ((state.skipEdges ? f.R - 2 : f.R) % state.reps);
      if (lost && state.reps > 1) notes.push('<li class="note info">' + (state.dir === "across" ? "Columns" : "Rows") + " don't divide evenly by " + state.reps +
        " — the last " + (lost > 1 ? lost + " " : "") + (state.dir === "across" ? "column" + (lost > 1 ? "s" : "") : "row" + (lost > 1 ? "s" : "")) + " stay" + (lost > 1 ? "" : "s") + " empty.</li>");
    }
    $("notes").innerHTML = notes.join("");

    var ok = !result.error && nItems > 0;
    ["print", "csv", "copyMap", "copyList", "toTracker", "toMix", "toLabels"].forEach(function (id) { $(id).disabled = !ok; });

    renderList();
    syncControls();
    save();
  }


  function plateHTML(plate) {
    var f = result.f, html = ['<span class="pl-lab"></span>'];
    for (var c = 0; c < f.C; c++) html.push('<span class="pl-lab">' + (c + 1) + "</span>");
    for (var r = 0; r < f.R; r++) {
      html.push('<span class="pl-lab row">' + rowName(r) + "</span>");
      for (c = 0; c < f.C; c++) {
        var id = wellId(r, c), w = plate.wells[id];
        var k = "pl-w" + (state.format === 384 ? " is-384" : "");
        var label, title;
        if (result.blocked[id]) { k += " blocked"; label = ""; title = id + " — kept empty. Tap to use it."; }
        else if (w) {
          k += " " + cls(w.item);
          label = w.item.type === "sample" && result.prefix ? w.item.name.slice(result.prefix.length) : w.item.name;
          title = id + " — " + w.item.name + (state.reps > 1 ? " (rep " + w.rep + "/" + state.reps + ")" : "") + (w.item.type === "ctrl" ? " · control" : "");
        } else { label = ""; title = id + " — empty. Tap to keep it empty."; }
        html.push('<button type="button" class="' + k + '" data-w="' + id + '" title="' + LM.esc(title) + '" aria-label="' + LM.esc(title) + '"><span>' + LM.esc(label) + "</span></button>");
      }
    }
    return html.join("");
  }

  // every plate, for printing
  function renderPrint() {
    var f = result.f;
    $("printPlates").innerHTML = result.plates.map(function (p, i) {
      return '<section class="pl-print-plate"><div class="pl-print-title"><b>' + LM.esc(state.plateName || "Plate layout") + "</b>" +
        (result.plates.length > 1 ? " · plate " + (i + 1) + " of " + result.plates.length : "") +
        " · " + state.format + " well · " + state.reps + " replicate" + (state.reps > 1 ? "s" : "") + " · " + new Date().toLocaleDateString() +
        '</div><div class="pl-plate-wrap"><div class="pl-plate" style="--nc:' + f.C + '">' + plateHTML(p) + "</div></div>" +
        '<div class="pl-legend">' + legendHTML(p) + "</div></section>";
    }).join("");
  }

  function legendHTML(plate) {
    var nS = plate.items.filter(function (i) { return i.type === "sample"; }).length;
    var leg = [];
    if (nS) leg.push('<span><i class="pl-w s0"></i><i class="pl-w s1"></i>Samples' + (result.prefix ? ' <small>' + LM.esc(result.prefix) + "…</small>" : "") + ' <small>×' + nS + "</small></span>");
    result.ctrls.forEach(function (n, i) {
      if (plate.items.some(function (it) { return it.type === "ctrl" && it.i === i; }))
        leg.push('<span><i class="pl-w c' + (i % N_CTRL_STYLES) + '"></i>' + LM.esc(n) + "</span>");
    });
    var nBlocked = Object.keys(result.blocked).length;
    if (nBlocked) leg.push('<span><i class="pl-w blocked"></i>Kept empty <small>×' + nBlocked + "</small></span>");
    return leg.join("");
  }

  function wellRows(plate) {
    var f = result.f, out = [];
    var order = [];
    for (var c = 0; c < f.C; c++) for (var r = 0; r < f.R; r++) order.push([r, c]);
    order.forEach(function (rc) {
      var id = wellId(rc[0], rc[1]), w = plate.wells[id];
      if (w) out.push([id, w.item.name, w.item.type === "ctrl" ? "Control" : "Sample", w.rep]);
    });
    return out;
  }
  function renderList() {
    if (!result || result.error) { $("wellList").innerHTML = ""; return; }
    $("wellList").innerHTML = result.plates.map(function (p, i) {
      var rows = wellRows(p);
      return (result.plates.length > 1 ? "<h3>PLATE " + (i + 1) + "</h3>" : "") +
        '<div class="pl-list-cols"><table><thead><tr><th>WELL</th><th>SAMPLE</th><th>REP</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return "<tr><td>" + r[0] + "</td><td>" + LM.esc(r[1]) + (r[2] === "Control" ? ' <span class="t">CTRL</span>' : "") + "</td><td class=\"t\">" + r[3] + "</td></tr>";
        }).join("") + "</tbody></table></div>";
    }).join("");
  }

  // ---------- figure ----------
  (function fig() {
    var cols = ["#2E9E5B", "dash", "#9CC7B6", "#9CC7B6", "#D3E6DD", "#D3E6DD", "#9CC7B6", "none"];
    var s = "";
    for (var r = 0; r < 3; r++) for (var c = 0; c < 8; c++) {
      var x = 14 + c * 15, y = 14 + r * 16, k = cols[c];
      s += k === "dash" ? '<circle cx="' + x + '" cy="' + y + '" r="5.5" fill="#fff" stroke="#1B2224" stroke-width="1.3" stroke-dasharray="2 1.6"/>'
        : k === "none" ? '<circle cx="' + x + '" cy="' + y + '" r="5.5" fill="#fff" stroke="#8A918C" stroke-width="1.2"/>'
        : '<circle cx="' + x + '" cy="' + y + '" r="5.5" fill="' + k + '" stroke="' + (k === "#2E9E5B" ? "#1F7A45" : "#5E8F80") + '" stroke-width="1.2"/>';
    }
    $("figSvg").innerHTML = '<rect x="4" y="4" width="124" height="52" rx="6" fill="#fff" stroke="#1B2224" stroke-width="1.5"/>' + s;
  })();

  // ---------- controls ----------
  function seg(id, key, parse) {
    var box = $(id);
    box.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      state[key] = parse ? parse(b.getAttribute("data-v")) : b.getAttribute("data-v");
      render();
    });
  }
  function syncSeg(id, val) {
    $(id).querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-v") === String(val))); });
  }
  function syncControls() {
    syncSeg("fmtSeg", state.format); syncSeg("repSeg", state.reps); syncSeg("dirSeg", state.dir);
    syncSeg("fillSeg", state.fill); syncSeg("posSeg", state.ctrlPos);
    $("dirSeg").querySelectorAll("button").forEach(function (b) { b.disabled = state.reps === 1; });
  }
  seg("fmtSeg", "format", Number);
  seg("repSeg", "reps", Number);
  seg("dirSeg", "dir");
  seg("fillSeg", "fill");
  seg("posSeg", "ctrlPos");
  ["samples", "controls", "plateName"].forEach(function (id) {
    $(id).addEventListener("input", function () { state[id] = $(id).value; render(); });
  });
  ["skipEdges", "repeatCtrls"].forEach(function (id) {
    $(id).addEventListener("change", function () { state[id] = $(id).checked; render(); });
  });
  $("tabs").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    plateIdx = +b.getAttribute("data-i"); render();
  });
  $("plate").addEventListener("click", function (e) {
    var b = e.target.closest("[data-w]"); if (!b) return;
    var id = b.getAttribute("data-w"), list = state.blocked[state.format] = state.blocked[state.format] || [];
    var at = list.indexOf(id);
    if (at >= 0) list.splice(at, 1); else list.push(id);
    render();
    var again = $("plate").querySelector('[data-w="' + id + '"]');
    if (again) again.focus();
  });
  document.addEventListener("click", function (e) {
    if (e.target && e.target.id === "unblock") { state.blocked[state.format] = []; render(); }
  });
  $("clear").addEventListener("click", function () {
    state.samples = ""; state.controls = ""; state.plateName = ""; state.blocked = { 96: [], 384: [] };
    $("samples").value = ""; $("controls").value = ""; $("plateName").value = "";
    render(); $("samples").focus();
  });

  // ---------- output ----------
  function flash(msg) {
    $("copied").textContent = msg;
    setTimeout(function () { $("copied").textContent = ""; }, 2400);
  }
  $("copyMap").addEventListener("click", function () {
    var f = result.f, p = result.plates[plateIdx], out = [];
    var head = [""]; for (var c = 0; c < f.C; c++) head.push(c + 1);
    out.push(head.join("\t"));
    for (var r = 0; r < f.R; r++) {
      var row = [rowName(r)];
      for (c = 0; c < f.C; c++) { var w = p.wells[wellId(r, c)]; row.push(w ? w.item.name : ""); }
      out.push(row.join("\t"));
    }
    LM.copy(out.join("\n"), function (ok) { flash(ok ? "MAP COPIED ✓ — paste into Excel" : "Copy failed"); });
  });
  function listTSV(sep) {
    var out = [["Plate", "Well", "Sample", "Type", "Replicate"].join(sep)];
    result.plates.forEach(function (p, i) {
      wellRows(p).forEach(function (r) {
        var name = sep === "," && /[",\n]/.test(r[1]) ? '"' + r[1].replace(/"/g, '""') + '"' : r[1];
        out.push([i + 1, r[0], name, r[2], r[3]].join(sep));
      });
    });
    return out.join(sep === "," ? "\r\n" : "\n");
  }
  $("copyList").addEventListener("click", function () {
    LM.copy(listTSV("\t"), function (ok) { flash(ok ? "LIST COPIED ✓" : "Copy failed"); });
  });
  $("csv").addEventListener("click", function () {
    var blob = new Blob(["﻿" + listTSV(",")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    var name = (state.plateName || "plate-layout").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "plate-layout";
    a.href = URL.createObjectURL(blob); a.download = name + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    flash("CSV SAVED ✓");
  });
  var wasOpen = false;
  window.addEventListener("beforeprint", function () { if (result && !result.error) renderPrint(); if (document.activeElement) document.activeElement.blur(); wasOpen = $("listDetails").open; $("listDetails").open = true; });
  window.addEventListener("afterprint", function () { $("listDetails").open = wasOpen; });
  $("print").addEventListener("click", function () { window.print(); });

  function save() { LM.save(KEY, state); }

  // ---------- hand-off to other tools ----------
  function wellCount() {
    return result.plates.reduce(function (n, p) { return n + Object.keys(p.wells).length; }, 0);
  }
  $("toTracker").addEventListener("click", function () {
    if (!result || result.error) return;
    var plates = result.plates.map(function (p, i) {
      var wells = {};
      Object.keys(p.wells).forEach(function (id) {
        var w = p.wells[id];
        wells[id] = w.item.name + (state.reps > 1 ? " · rep " + w.rep : "") + (w.item.type === "ctrl" ? " · control" : "");
      });
      var base = state.plateName || "Layout";
      return { name: (result.plates.length > 1 ? base + " " + (i + 1) : base).slice(0, 24), wells: wells };
    });
    window.LMH.send("plate-tracker", { format: state.format, plates: plates }, "../plate-tracker/");
  });
  $("toMix").addEventListener("click", function () {
    if (!result || result.error) return;
    window.LMH.send("master-mix", { reactions: wellCount(), note: wellCount() + " wells from Plate Layout" + (result.plates.length > 1 ? " (" + result.plates.length + " plates)" : "") }, "../master-mix/");
  });
  $("toLabels").addEventListener("click", function () {
    if (!result || result.error) return;
    window.LMH.send("cryo-labels", { ids: result.samples.slice() }, "../cryo-labels/");
  });
  // arriving from the Serial Dilution tool: the standards become controls
  var inbound = window.LMH && window.LMH.take("plate-layout");
  if (inbound && Array.isArray(inbound.controls) && inbound.controls.length) {
    state.controls = inbound.controls.join("\n");
    state.ctrlPos = "start";
    if (inbound.reps >= 1 && inbound.reps <= 4) state.reps = inbound.reps;
    setTimeout(function () { window.LMH.note("Added " + inbound.controls.length + " standards from Serial Dilution as controls — paste your samples above.", document.querySelector(".lm-page")); }, 0);
  }

  // ---------- start ----------
  $("samples").value = state.samples || "";
  $("controls").value = state.controls || "";
  $("plateName").value = state.plateName || "";
  $("skipEdges").checked = !!state.skipEdges;
  $("repeatCtrls").checked = state.repeatCtrls !== false;
  render();
})();
