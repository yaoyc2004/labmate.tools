// labmate.tools — 8.2 Nyquist Calculator: the page. Maths in assets/micro-core.js (window.LMM),
// hardware in assets/data/microscopy-data.js (window.LMT_MICRO).
(function () {
  "use strict";
  var LM = window.LM, M = window.LMM, D = window.LMT_MICRO || { objectives: [], cameras: [], scanSystems: [], fluors: [], media: {} };
  var KEY = "lm-nyquist-v1";
  var $ = function (id) { return document.getElementById(id); };
  var esc = LM.esc;

  var MEDIA = Object.assign({ air: 1.0, water: 1.333, silicone: 1.40, glycerol: 1.45, oil: 1.518 }, D.media || {});
  var LASERS = [405, 445, 458, 488, 514, 532, 561, 594, 640, 685, 730];
  var TUBE = { Nikon: 200, Leica: 200, Evident: 180, Zeiss: 165 };
  var MAX_CH = 4;

  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function fluor(id) { return byId(D.fluors, id); }

  var DEF = {
    mode: "widefield", standBrand: "", standTube: "",
    objBrand: "Nikon", objId: "nikon-plan-apo-lambdad-60x-oil",
    mag: "", na: "", imm: "oil", n: "", designTube: "", fn: "",
    manualOn: false, manualPx: "", manualUnit: "nm",
    diskId: "yokogawa-csu-w1-50", pinhole: "", pitch: "", relay: "1",
    camBrand: "Hamamatsu", camId: "hamamatsu-orca-fusion-c14440-20up", pix: "", pxW: "", pxH: "", bin: "1", adapter: "1",
    scanId: "zeiss-lsm-980", field: "", frameW: "1024", frameH: "1024", zoom: "1", au: "1",
    ch: [{ dye: "egfp", ex: "", em: "" }, { dye: "mcherry", ex: "", em: "" }],
    zstep: "", depth: ""
  };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ---------------- my hardware (this browser) ----------------
  var mine = LM.load(M.STORE_KEY);
  if (!mine || typeof mine !== "object") mine = { kind: "labmate.microscopy", v: 1, objectives: [], cameras: [] };
  mine.objectives = Array.isArray(mine.objectives) ? mine.objectives : [];
  mine.cameras = Array.isArray(mine.cameras) ? mine.cameras : [];
  function saveMine() { LM.save(M.STORE_KEY, mine); }
  function allObjectives() { return D.objectives.concat(mine.objectives); }
  function allCameras() { return D.cameras.concat(mine.cameras); }

  // ---------------- state ----------------
  var st = LM.load(KEY);
  var fromLink = readHash();
  if (!st || typeof st !== "object") st = clone(DEF);
  Object.keys(DEF).forEach(function (k) { if (st[k] === undefined) st[k] = clone(DEF[k]); });
  if (!Array.isArray(st.ch) || !st.ch.length) st.ch = clone(DEF.ch);
  var firstRun = !LM.load(KEY) && !fromLink;

  var FIELDS = ["standTube", "mag", "na", "n", "designTube", "fn", "manualPx", "pinhole", "pitch", "relay", "pix", "pxW", "pxH", "adapter", "field", "frameW", "frameH", "zoom", "au", "zstep", "depth"];
  var SELECTS = ["standBrand", "imm", "manualUnit", "bin"];

  // ---------------- pickers ----------------
  function brands(list) {
    var b = [];
    list.forEach(function (x) { if (b.indexOf(x.brand) < 0) b.push(x.brand); });
    return b;
  }
  function fillBrand(sel, list, mineList, cur) {
    var b = brands(list);
    var h = '<option value="">All brands</option>' + b.map(function (x) { return '<option value="' + esc(x) + '"' + (x === cur ? " selected" : "") + ">" + esc(x) + "</option>"; }).join("");
    if (mineList.length) h += '<option value="__mine"' + (cur === "__mine" ? " selected" : "") + ">Mine (this browser)</option>";
    sel.innerHTML = h;
    if (cur && sel.value !== cur) sel.value = "";
  }
  function objLabel(o) { return o.name + " · " + LM.fmt(o.mag, 4) + "×/" + o.na.toFixed(2) + " " + o.immersion + (o.status === "verify" ? " (check)" : ""); }
  function camLabel(c) { return c.name + " · " + c.pixel_um + " µm · " + c.px[0] + "×" + c.px[1] + (c.status === "verify" ? " (check)" : ""); }
  function fillModel(sel, list, mineList, brand, cur, label, typeOwn) {
    var h = '<option value="">' + typeOwn + "</option>";
    var groups = {};
    var order = [];
    var src = brand === "__mine" ? [] : list.filter(function (x) { return !brand || x.brand === brand; });
    src.forEach(function (x) { var g = (brand ? "" : x.brand + " · ") + (x.series || x.brand); if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(x); });
    order.forEach(function (g) {
      h += '<optgroup label="' + esc(g) + '">' + groups[g].map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(label(x)) + "</option>"; }).join("") + "</optgroup>";
    });
    if ((brand === "__mine" || !brand) && mineList.length) {
      h += '<optgroup label="Mine (this browser)">' + mineList.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(label(x)) + "</option>"; }).join("") + "</optgroup>";
    }
    sel.innerHTML = h;
    sel.value = cur || "";
    if (sel.value !== (cur || "")) sel.value = "";
  }
  function fillScan(sel, type, cur) {
    var list = D.scanSystems.filter(function (s) { return s.type === type; });
    var h = '<option value="">— Type your own —</option>';
    var bs = brands(list);
    bs.forEach(function (b) {
      h += '<optgroup label="' + esc(b) + '">' + list.filter(function (s) { return s.brand === b; }).map(function (s) {
        return '<option value="' + esc(s.id) + '">' + esc(s.name + (s.discontinued ? " (discontinued)" : "") + (s.status === "verify" ? " (check)" : "")) + "</option>";
      }).join("") + "</optgroup>";
    });
    sel.innerHTML = h; sel.value = cur || ""; if (sel.value !== (cur || "")) sel.value = "";
  }
  function fillAll() {
    fillBrand($("objBrand"), D.objectives, mine.objectives, st.objBrand);
    fillModel($("objModel"), D.objectives, mine.objectives, $("objBrand").value, st.objId, objLabel, "— Type your own —");
    fillBrand($("camBrand"), D.cameras, mine.cameras, st.camBrand);
    fillModel($("camModel"), D.cameras, mine.cameras, $("camBrand").value, st.camId, camLabel, "— Type your own —");
    fillScan($("scanModel"), "point", st.scanId);
    fillScan($("diskModel"), "disk", st.diskId);
  }

  // values that a picked model sets
  function objValues(o) {
    return { mag: LM.fmtPlain(o.mag, 5), na: String(o.na), imm: o.immersion, n: String(MEDIA[o.immersion] || ""), designTube: String(o.tubeLens_mm || ""), fn: o.fn ? String(o.fn) : "" };
  }
  function camValues(c) { return { pix: String(c.pixel_um), pxW: String(c.px[0]), pxH: String(c.px[1]) }; }
  function scanValues(s) { return { field: String(s.field_mm || "") }; }
  function diskValues(s) { return { pinhole: String(s.pinhole_um || ""), pitch: s.pitch_um ? String(s.pitch_um) : "" }; }

  function applyObj(id) {
    var o = byId(allObjectives(), id); st.objId = id || "";
    if (o) Object.assign(st, objValues(o));
  }
  function applyCam(id) { var c = byId(allCameras(), id); st.camId = id || ""; if (c) Object.assign(st, camValues(c)); }
  function applyScan(id) {
    var s = byId(D.scanSystems, id); st.scanId = id || "";
    if (s) { Object.assign(st, scanValues(s)); if (s.maxFrame && LM.parse(st.frameW) > s.maxFrame) { st.frameW = String(s.maxFrame); st.frameH = String(s.maxFrame); } }
  }
  function applyDisk(id) { var s = byId(D.scanSystems, id); st.diskId = id || ""; if (s) Object.assign(st, diskValues(s)); }

  // ---------------- channels ----------------
  function defaultEx(f) {
    if (!f) return "";
    if (st.mode === "widefield") return String(f.exMax);
    if (st.mode === "twophoton") return String(Math.min(1300, Math.max(700, Math.round(f.exMax * 1.9 / 10) * 10)));
    var best = null;
    LASERS.forEach(function (l) { if (l <= f.exMax + 8 && (best === null || l > best)) best = l; });
    return String(best || LASERS[0]);
  }
  function fillChannelDefaults(force) {
    st.ch.forEach(function (c) {
      var f = fluor(c.dye);
      if (!f) return;
      if (force || !c.ex || c.exAuto) { c.ex = defaultEx(f); c.exAuto = true; }
      if (!c.em) c.em = String(f.emMax);
    });
  }
  function dyeOptions(cur) {
    return '<option value="">Other…</option>' + D.fluors.map(function (f) {
      return '<option value="' + esc(f.id) + '"' + (f.id === cur ? " selected" : "") + ">" + esc(f.name) + "</option>";
    }).join("");
  }
  function renderCh() {
    $("chRows").innerHTML = st.ch.map(function (c, i) {
      return '<tr data-i="' + i + '"><td data-l="DYE / PROTEIN"><div class="ny-dye"><label class="sr" for="cd' + i + '">Dye ' + (i + 1) + '</label><select id="cd' + i + '" data-k="dye">' + dyeOptions(c.dye) + '</select>' +
        (c.dye ? "" : '<label class="sr" for="cn' + i + '">Name</label><input id="cn' + i + '" type="text" data-k="name" autocomplete="off" placeholder="name" value="' + esc(c.name || "") + '">') + "</div></td>" +
        '<td data-l="' + (st.mode === "widefield" ? "EXCITATION nm" : st.mode === "twophoton" ? "2P LASER nm" : "LASER nm") + '"><input class="num" type="text" inputmode="numeric" data-k="ex" aria-label="Excitation, nm" value="' + esc(c.ex) + '"></td>' +
        '<td data-l="EMISSION nm"><input class="num" type="text" inputmode="numeric" data-k="em" aria-label="Emission, nm" value="' + esc(c.em) + '"></td>' +
        '<td class="c-x"><button type="button" class="rc-x" data-act="rm" aria-label="Remove channel ' + (i + 1) + '"' + (st.ch.length < 2 ? " disabled" : "") + ">×</button></td></tr>";
    }).join("");
    $("addCh").disabled = st.ch.length >= MAX_CH;
    $("exHead").textContent = st.mode === "widefield" ? "EXCITATION nm" : st.mode === "twophoton" ? "2P LASER nm" : "LASER nm";
    $("chHint").innerHTML = st.mode === "widefield" ? "Picking a dye fills its peak wavelengths. Widefield sampling depends on the <b>emission</b>; excitation is only shown." :
      st.mode === "twophoton" ? "Two-photon sampling depends on the <b>infrared laser</b> wavelength (filled as about 1.9× the one-photon peak — type the one you use)." :
      "Confocal sampling depends on the <b>laser line</b> (filled as the nearest common line below the dye's peak — type the one you use).";
  }

  // ---------------- form ----------------
  function fill() {
    FIELDS.forEach(function (k) { $(k).value = st[k]; });
    SELECTS.forEach(function (k) { $(k).value = st[k]; });
    $("manualOn").checked = !!st.manualOn;
    segSet();
    fillAll();
    renderCh();
  }
  function read() {
    FIELDS.forEach(function (k) { st[k] = $(k).value; });
    SELECTS.forEach(function (k) { st[k] = $(k).value; });
    st.manualOn = $("manualOn").checked;
  }
  function segSet() {
    Array.prototype.forEach.call($("modeSeg").querySelectorAll("button"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-mode") === st.mode)); });
  }
  function layout() {
    var scan = st.mode === "confocal" || st.mode === "twophoton";
    $("camBox").hidden = scan || st.manualOn;
    $("scanBox").hidden = !scan || st.manualOn;
    $("diskBox").hidden = st.mode !== "disk";
    $("manualBox").hidden = !st.manualOn;
    $("auTerm").hidden = st.mode !== "confocal";
    $("detK").textContent = st.manualOn ? "PIXEL SIZE" : scan ? "SCAN" : st.mode === "disk" ? "DISK + CAMERA" : "CAMERA";
    $("standCustomBox").hidden = st.standBrand !== "custom";
  }

  function setMsg(id, text) {
    var m = $(id + "m"); if (m) m.textContent = text || "";
    var t = document.querySelector('[data-term="' + id + '"]'); if (t) t.classList.toggle("is-bad", !!text);
  }
  function num(id, o) {
    o = o || {};
    var v = LM.parse(st[id]);
    if (v == null) { if (o.optional) return null; setMsg(id, "Required"); return NaN; }
    if (isNaN(v)) { setMsg(id, "Not a number"); return NaN; }
    if (v <= 0) { setMsg(id, "Must be above zero"); return NaN; }
    if (o.int && v !== Math.round(v)) { setMsg(id, "Whole number"); return NaN; }
    if (o.max != null && v > o.max) { setMsg(id, o.maxMsg || "Too large"); return NaN; }
    return v;
  }
  var nm = function (v) { return v == null || !isFinite(v) ? "—" : LM.fmt(v, v >= 100 ? 3 : 2) + " nm"; };
  var um = function (v) { return v == null || !isFinite(v) ? "—" : LM.fmt(v, v >= 100 ? 4 : 3) + " µm"; };

  // source lines under each picker
  function srcLine(el, item, edited, kind) {
    if (!item) { el.innerHTML = 'Your own ' + kind + ' — every number above is what you typed.'; return; }
    var links = String(item.source || "").split(" ; ").filter(Boolean).map(function (u, i) {
      return '<a href="' + esc(u) + '" rel="noopener" target="_blank">' + (i ? "source " + (i + 1) : "source") + "</a>";
    }).join(" · ");
    var h = (item.origin === "user" ? "Saved in this browser" : "Values from the maker's spec: " + (links || "—")) +
      (item.checked ? " · checked " + esc(item.checked) : "") +
      (item.status === "verify" ? ' · <span class="ny-chk">CHECK: ' + esc(item.note || "a value still to confirm") + "</span>" : item.note ? " · " + esc(item.note) : "");
    if (edited) h += ' · <span class="ny-ed">EDITED — your numbers are used</span>';
    el.innerHTML = h;
  }
  function isEdited(vals, keys) {
    return keys.some(function (k) {
      if (k === "imm") return st.imm !== vals.imm;
      var a = LM.parse(st[k]), b = LM.parse(vals[k]);
      return !(a === b || (a == null && b == null));
    });
  }

  // ---------------- compute ----------------
  var R = null;
  function compute() {
    FIELDS.forEach(function (k) { setMsg(k, ""); });
    layout();

    var obj = byId(allObjectives(), st.objId), cam = byId(allCameras(), st.camId);
    var scanSys = byId(D.scanSystems, st.scanId), diskSys = byId(D.scanSystems, st.diskId);
    var oKeys = ["mag", "na", "imm", "n", "designTube", "fn"], cKeys = ["pix", "pxW", "pxH"];
    var oEd = obj ? isEdited(objValues(obj), oKeys) : false;
    var cEd = cam ? isEdited(camValues(cam), cKeys) : false;
    var sEd = scanSys ? isEdited(scanValues(scanSys), ["field"]) : false;
    var dEd = diskSys ? isEdited(diskValues(diskSys), ["pinhole", "pitch"]) : false;
    srcLine($("objSrc"), obj, oEd, "objective");
    srcLine($("camSrc"), cam, cEd, "camera");
    srcLine($("scanSrc"), scanSys, sEd, "scan system");
    srcLine($("diskSrc"), diskSys, dEd, "disk");
    if (scanSys && scanSys.fieldWording && !sEd) $("scanSrc").innerHTML += " · “" + esc(scanSys.fieldWording) + "”";
    [["mag", obj, objValues], ["na", obj, objValues], ["n", obj, objValues], ["designTube", obj, objValues], ["fn", obj, objValues],
      ["pix", cam, camValues], ["pxW", cam, camValues], ["field", scanSys, scanValues], ["pinhole", diskSys, diskValues], ["pitch", diskSys, diskValues]].forEach(function (x) {
      var t = document.querySelector('[data-term="' + x[0] + '"]'); if (!t) return;
      var keys = x[0] === "pxW" ? ["pxW", "pxH"] : x[0] === "n" ? ["n", "imm"] : [x[0]];
      t.classList.toggle("is-edited", !!x[1] && isEdited(x[2](x[1]), keys));
    });

    var na = num("na", { max: 1.7, maxMsg: "NA above 1.7?" }), n = num("n", { max: 2, maxMsg: "Index above 2?" }), mag = num("mag", { max: 250 });
    if (na > 0 && n > 0 && na >= n) setMsg("na", "Must be below n (" + LM.fmt(n, 4) + ")");
    var designTube = num("designTube", { optional: true });
    var standTube = st.standBrand === "custom" ? num("standTube") : st.standBrand ? +st.standBrand : designTube;
    var fn = num("fn", { optional: true, max: 40 });

    var s = { mode: st.mode, na: na, n: n, mag: mag, designTube: designTube, standTube: standTube, fn: fn,
      channels: st.ch.map(function (c) { var f = fluor(c.dye); return { name: f ? f.name : c.name || "", lex: LM.parse(c.ex), lem: LM.parse(c.em) }; }) };
    s.zstep = num("zstep", { optional: true }); s.depth = num("depth", { optional: true });
    if (st.manualOn) {
      var mp = num("manualPx"); s.path = "manual"; s.manual = { pixel: st.manualUnit === "um" ? mp * 1000 : mp };
    } else if (st.mode === "confocal" || st.mode === "twophoton") {
      s.path = "scan";
      var fw = num("frameW", { int: true, max: 20000 }), fh = num("frameH", { optional: true, int: true, max: 20000 });
      if (isNaN(fw)) setMsg("frame", $("frameWm") ? "" : "Check the frame");
      s.scan = { field: num("field", { max: 40 }), zoom: num("zoom", { max: 1000 }), frame: [fw, fh || fw] };
      if (st.mode === "confocal") { var au = LM.parse(st.au); s.au = au > 0 ? au : 1; if (au != null && !(au > 0)) setMsg("au", "Above zero"); }
    } else {
      s.path = "camera";
      s.camera = { pix: num("pix", { max: 50 }), px: [num("pxW", { int: true, optional: true }), num("pxH", { int: true, optional: true })], bin: +st.bin || 1,
        adapter: num("adapter", { max: 10 }), diag: cam && !cEd ? cam.diag_mm : null };
    }
    if (st.mode === "disk") s.disk = { pinhole: num("pinhole"), pitch: num("pitch", { optional: true }), relay: num("relay", { optional: true }) || 1 };

    R = M.evaluate(s);
    R.input = s; R.obj = obj; R.cam = cam; R.scanSys = scanSys; R.diskSys = diskSys; R.oEd = oEd; R.cEd = cEd;
    render();
    st.v = 1;
    LM.save(KEY, st);
    writeHash();
  }

  function stateTag(v) {
    if (!v) return "";
    var t = v.state === "under" ? "UNDERSAMPLED" : v.state === "over" ? "OVERSAMPLED" : "AT NYQUIST";
    return '<span class="ny-tag ' + v.state + '">' + t + "</span>";
  }
  function kpi(k, v, s, cls) { return '<div class="ny-kpi' + (cls ? " is-" + cls : "") + '"><div class="k">' + k + '</div><div class="v">' + v + "</div>" + (s ? '<div class="s">' + s + "</div>" : "") + "</div>"; }
  function chName(c) { return c.name || "this channel"; }

  function render() {
    var ans = $("ans"), big = $("ansBig"), say = $("ansSay"), notes = [];
    ans.className = "ans";
    if (!R.ok) {
      ans.classList.add("is-empty");
      big.textContent = R.errors.indexOf("channels") >= 0 && R.errors.length === 1 ? "Add a wavelength" : "Fill in the objective";
      say.textContent = R.errors.indexOf("na>=n") >= 0 ? "The NA must be below the immersion's refractive index." : R.errors.indexOf("channels") >= 0 ? "Each channel needs " + (st.mode === "widefield" ? "an emission" : "an excitation (laser)") + " wavelength." : "Magnification, NA and immersion index are needed.";
      $("kpis").innerHTML = ""; $("chOut").innerHTML = ""; $("notes").innerHTML = ""; $("printHead").textContent = "";
      return;
    }
    var T = R.target, strictName = T.channel || "the shortest channel";
    var geo = R.geo, xy = R.xy;
    if (geo && xy) {
      ans.classList.add("is-" + xy.state);
      big.innerHTML = (xy.state === "under" ? "Undersampled " + LM.fmt(xy.ratio, 3) + "×" : xy.state === "over" ? "Oversampled " + LM.fmt(1 / xy.ratio, 3) + "×" : "At Nyquist") +
        ' <span class="eq">· ' + nm(geo.pixel) + " / " + nm(T.dx) + "</span>";
      var fix = "";
      if (xy.state === "under") {
        if (R.path === "camera" && R.cameraOptions && R.cameraOptions.options.length) {
          var o1 = R.cameraOptions.options[0];
          fix = " A <b>" + o1.adapter + "× camera adapter</b>" + (o1.bin > 1 ? " with " + o1.bin + "×" + o1.bin + " binning" : "") + " gives " + nm(o1.pixel) + ".";
        } else if (R.path === "scan" && R.zoom) fix = " Zoom <b>" + LM.fmt(R.zoom.up, 4) + "×</b> at " + R.input.scan.frame[0] + " px reaches it.";
        else if (R.path === "camera") fix = " No common adapter reaches it with this objective; a higher magnification objective will.";
      } else if (xy.state === "over") {
        if (R.path === "scan" && R.zoom) fix = " Zoom " + LM.fmt(Math.max(0.1, R.zoom.exact > 0 ? Math.floor(R.zoom.exact * 10) / 10 : 1), 4) + "× would still meet Nyquist with a larger field and less bleaching.";
        else if (R.path === "camera" && R.cameraOptions) {
          var big2 = R.cameraOptions.options.filter(function (o) { return o.adapter === R.input.camera.adapter && o.bin > R.input.camera.bin; }).pop();
          fix = big2 ? " " + big2.bin + "×" + big2.bin + " binning would still meet Nyquist with more signal per pixel." : " Binning or a smaller adapter would still meet Nyquist with more signal per pixel.";
        }
      }
      say.innerHTML = "Pixel on the sample <b>" + nm(geo.pixel) + "</b>; Nyquist for " + esc(strictName) + " needs <b>≤ " + nm(T.dx) + "</b>." + fix;
    } else {
      big.innerHTML = "Nyquist pixel ≤ " + nm(T.dx);
      say.innerHTML = "For " + esc(strictName) + ". Fill in the " + (R.path === "scan" ? "scan field, frame and zoom" : R.path === "manual" ? "pixel size" : "camera pixel and adapter") + " to check your settings.";
    }

    // tiles
    var k = [];
    if (geo) k.push(kpi("PIXEL ON SAMPLE", nm(geo.pixel).replace(" nm", "<small>nm</small>") + stateTag(xy), (geo.totalMag ? "total " + LM.fmt(geo.totalMag, 4) + "× · " : "") + LM.fmt(geo.pixel / 1000, 4) + " µm/px", xy && xy.state));
    else k.push(kpi("PIXEL ON SAMPLE", "—", "needs the detector"));
    k.push(kpi("NYQUIST XY", nm(T.dx).replace(" nm", "<small>nm</small>"), esc(strictName)));
    if (geo && geo.fov) k.push(kpi("FIELD OF VIEW", LM.fmt(geo.fov[0], 4) + " × " + LM.fmt(geo.fov[1], 4) + "<small>µm</small>", (geo.frame ? geo.frame[0] + " × " + geo.frame[1] + " px" : "")));
    else if (R.path === "scan" && R.zoom) k.push(kpi("ZOOM FOR NYQUIST", LM.fmt(R.zoom.up, 4) + "<small>×</small>", "at " + R.input.scan.frame[0] + " px"));
    else k.push(kpi("FIELD OF VIEW", "—", "needs the detector"));
    var zp = R.zPlan;
    k.push(kpi("Z STEP", (R.z ? LM.fmt(R.input.zstep, 3) + "<small>µm</small>" + stateTag(R.z) : "≤ " + LM.fmt(T.dz / 1000, 3) + "<small>µm</small>"),
      "Nyquist " + LM.fmt(T.dz / 1000, 3) + " µm" + (zp && zp.slices ? " · " + zp.slices + " slices at " + LM.fmt(zp.step, 3) + " µm" : ""), R.z && R.z.state));
    $("kpis").innerHTML = k.join("");

    // per channel
    $("chOut").innerHTML = R.channels.map(function (c) {
      var strict = c.nyq.dx === T.dx;
      return "<tr" + (strict ? ' class="is-best"' : "") + '><td data-l="CHANNEL"><b>' + esc(c.name || "—") + "</b>" + (strict ? ' <span class="fl-tag is-best">SETS XY</span>' : "") + "</td>" +
        '<td class="c-num" data-l="EX / EM nm">' + (c.lex ? Math.round(c.lex) : "—") + " / " + (c.lem ? Math.round(c.lem) : "—") + "</td>" +
        '<td class="c-num" data-l="RESOLUTION XY">' + (c.res ? nm(c.res.lat) : "—") + "</td>" +
        '<td class="c-num" data-l="RESOLUTION Z">' + (c.res ? nm(c.res.ax) : "—") + "</td>" +
        '<td class="c-num" data-l="NYQUIST XY">' + nm(c.nyq.dx) + "</td>" +
        '<td class="c-num" data-l="NYQUIST Z">' + nm(c.nyq.dz) + "</td></tr>";
    }).join("");

    // notes
    var inp = R.input;
    if (inp.standTube && inp.designTube && Math.abs(inp.standTube - inp.designTube) > 0.01)
      notes.push('<li class="note info">Objective designed for a ' + LM.fmt(inp.designTube, 4) + ' mm tube lens on a ' + LM.fmt(inp.standTube, 4) + ' mm stand: real magnification ' + LM.fmt(inp.mag * inp.standTube / inp.designTube, 4) + '× instead of ' + LM.fmt(inp.mag, 4) + '×. Image quality may also suffer away from the centre.</li>');
    if (xy && xy.state === "under" && R.path === "camera" && R.cameraOptions && R.cameraOptions.options.length > 1)
      notes.push('<li class="note info">Ways to reach Nyquist with this objective and camera: ' + R.cameraOptions.options.map(function (o) { return o.adapter + "× adapter" + (o.bin > 1 ? " + bin " + o.bin : "") + " → " + nm(o.pixel); }).join(" · ") + ". A bigger adapter shrinks the field of view by the same factor.</li>");
    if (xy && xy.state === "under") {
      var tol = st.mode === "widefield" ? 1.3 : 1.6;
      notes.push('<li class="note' + (xy.ratio <= tol ? " info" : "") + '">' + (xy.ratio <= tol ? "Within the " + tol + "× SVI suggests can still be deconvolved" + (st.mode === "widefield" ? "" : " (confocal, 1 AU pinhole)") + ", but fine detail near the resolution limit is lost." :
        "More than " + tol + "× coarser than Nyquist: structures near the resolution limit will not be resolved, and deconvolution can't recover them.") + "</li>");
    }
    if (xy && xy.state === "over") notes.push('<li class="note info">Pixels finer than half the Nyquist distance add no detail; they cost light dose, time and file size. Fine for deconvolution or very bright samples.</li>');
    if (R.z && R.z.state === "under") notes.push('<li class="note">Z step ' + LM.fmt(inp.zstep, 3) + " µm is coarser than Nyquist (" + LM.fmt(T.dz / 1000, 3) + " µm). Use " + LM.fmt(zp.step, 3) + " µm or smaller for 3D analysis or deconvolution.</li>");
    if (geo && geo.vignette) notes.push('<li class="note">The camera chip (' + LM.fmt(geo.sensorDiag, 3) + " mm diagonal" + (inp.camera.adapter !== 1 ? ", " + LM.fmt(geo.diagAtImage, 3) + " mm after the adapter" : "") + ") is larger than the objective's field number (" + LM.fmt(inp.fn, 3) + " mm): the corners may be dark or soft. The usable field is a " + um(geo.fieldDiam) + " circle.</li>");
    if (R.path === "scan" && R.scanSys) {
      var ss = R.scanSys;
      if (ss.maxFrame && inp.scan.frame[0] > ss.maxFrame) notes.push('<li class="note">' + esc(ss.name) + " scans up to " + ss.maxFrame + " px per line.</li>");
      if (ss.zoom && (inp.scan.zoom < ss.zoom[0] || inp.scan.zoom > ss.zoom[1])) notes.push('<li class="note">' + esc(ss.name) + "'s zoom runs " + ss.zoom[0] + "–" + ss.zoom[1] + "×.</li>");
      if (R.zoom && ss.zoom && R.zoom.up > ss.zoom[1]) notes.push('<li class="note">Nyquist needs more zoom than ' + esc(ss.name) + " offers at this frame size; use a larger frame (more pixels per line).</li>");
    }
    if (R.path === "scan" && R.zoom && xy && xy.state !== "under") notes.push('<li class="note info">Nyquist is met from zoom ' + LM.fmt(R.zoom.up, 4) + "× upward at " + inp.scan.frame[0] + " px per line.</li>");
    if (st.mode === "disk" && R.disk) {
      var d = R.disk;
      notes.push('<li class="note' + (d.au > 2 ? "" : " info") + '">Disk pinhole on the sample: ' + nm(d.pinholeOnSample) + " = <b>" + LM.fmt(d.au, 3) + " Airy units</b> at " + LM.fmt(inp.channels[0].lem || 0, 3) + " nm." +
        (d.au > 2 ? " Large pinholes section less; a smaller-pinhole disk or a higher magnification suits this objective better." : d.au < 0.7 ? " Small: sharp sections but less light." : " A good match for this objective.") +
        (d.pitchAU ? " Pinhole spacing " + LM.fmt(d.pitchAU, 3) + " AU" + (d.pitchAU < 5 ? " — close spacing raises crosstalk in thick samples." : ".") : "") + "</li>");
    }
    if (st.mode === "twophoton") notes.push('<li class="note info">Two-photon: Nyquist uses the infrared laser with k = 2 (SVI). Resolution is not shown; it depends on the excitation power and pulse.</li>');
    if (st.mode === "disk") notes.push('<li class="note info">Spinning disk is sampled like a confocal with a fairly large pinhole (SVI); up to about 1.6× coarser still deconvolves.</li>');
    [[R.obj, R.oEd], [R.cam, R.cEd]].forEach(function (x) { if (x[0] && x[0].status === "verify" && !x[1]) notes.push('<li class="note info">' + esc(x[0].name) + ": " + esc(x[0].note || "a value is still to be confirmed") + " Check against your spec sheet.</li>"); });
    $("notes").innerHTML = notes.join("");
    $("printHead").textContent = summaryLines().join("  ·  ");
    $("toScale").disabled = !(geo && geo.pixel > 0);
  }

  // ---------------- text outputs ----------------
  function objText() {
    var o = R.obj && !R.oEd ? R.obj.brand + " " + R.obj.name : "";
    return (o ? o + " — " : "") + LM.fmtPlain(R.input.mag, 4) + "×/" + R.input.na + " " + st.imm + " (n " + R.input.n + ")";
  }
  function detText() {
    var inp = R.input;
    if (R.path === "manual") return "pixel size " + LM.fmtPlain(inp.manual.pixel, 4) + " nm (entered)";
    if (R.path === "scan") return (R.scanSys ? R.scanSys.brand + " " + R.scanSys.name + " — " : "") + "field " + inp.scan.field + " mm, " + inp.scan.frame[0] + "×" + inp.scan.frame[1] + " px, zoom " + inp.scan.zoom + (st.mode === "confocal" ? ", pinhole " + (inp.au || 1) + " AU" : "");
    return (R.cam && !R.cEd ? R.cam.brand + " " + R.cam.name + " — " : "") + inp.camera.pix + " µm pixels, bin " + inp.camera.bin + ", adapter " + inp.camera.adapter + "×";
  }
  function summaryLines() {
    var L = ["MODE " + st.mode.toUpperCase(), "OBJECTIVE " + objText(), "DETECTOR " + detText()];
    if (st.mode === "disk" && R.input.disk) L.push("DISK " + (R.diskSys ? R.diskSys.name + ", " : "") + R.input.disk.pinhole + " µm pinholes");
    return L;
  }
  function settingsText() {
    var T = R.target, L = ["labmate.tools · Nyquist check"].concat(summaryLines());
    L.push("CHANNELS " + R.channels.map(function (c) { return (c.name || "?") + " " + (c.lex || "–") + "/" + (c.lem || "–") + " nm"; }).join("; "));
    L.push("NYQUIST XY ≤ " + LM.fmtPlain(T.dx, 3) + " nm · Z ≤ " + LM.fmtPlain(T.dz / 1000, 3) + " µm");
    if (R.geo) L.push("PIXEL " + LM.fmtPlain(R.geo.pixel, 3) + " nm (" + LM.fmtPlain(R.geo.pixel / 1000, 4) + " µm/px) — " + (R.xy.state === "under" ? "undersampled " + LM.fmtPlain(R.xy.ratio, 3) + "×" : R.xy.state === "over" ? "oversampled" : "at Nyquist"));
    if (R.geo && R.geo.fov) L.push("FIELD " + LM.fmtPlain(R.geo.fov[0], 4) + " × " + LM.fmtPlain(R.geo.fov[1], 4) + " µm");
    if (R.zoom) L.push("ZOOM FOR NYQUIST " + LM.fmtPlain(R.zoom.up, 4) + "×");
    if (R.zPlan) L.push("Z STEP " + LM.fmtPlain(R.zPlan.step, 3) + " µm" + (R.zPlan.slices ? ", " + R.zPlan.slices + " slices" : ""));
    L.push(location.origin && location.origin.indexOf("http") === 0 ? location.origin + location.pathname + (writeHash.last || "") : "");
    return L.filter(Boolean).join("\n");
  }

  // ---------------- share link ----------------
  function writeHash() {
    try {
      var s = btoa(unescape(encodeURIComponent(JSON.stringify({ v: 1, st: st })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      writeHash.last = "#n=" + s;
    } catch (e) { writeHash.last = ""; }
  }
  function readHash() {
    var m = location.hash.match(/^#n=([\w-]+)/); if (!m) return false;
    try {
      var o = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, "+").replace(/_/g, "/")))));
      if (o && o.v === 1 && o.st && Array.isArray(o.st.ch)) { st = Object.assign(clone(DEF), o.st); return true; }
    } catch (e) { /* bad link */ }
    return false;
  }

  // ---------------- my hardware ----------------
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function renderMine() {
    var rows = mine.objectives.map(function (o) { return { t: "objective", o: o, v: LM.fmt(o.mag, 4) + "×/" + o.na + " " + o.immersion + " · " + o.tubeLens_mm + " mm" }; })
      .concat(mine.cameras.map(function (c) { return { t: "camera", o: c, v: c.pixel_um + " µm · " + c.px[0] + " × " + c.px[1] }; }));
    $("mineRows").innerHTML = rows.length ? rows.map(function (r) {
      return '<tr data-id="' + esc(r.o.id) + '" data-t="' + r.t + '"><td data-l="TYPE">' + r.t.toUpperCase() + '</td><td data-l="NAME"><label class="sr" for="mn' + esc(r.o.id) + '">Name</label><input type="text" id="mn' + esc(r.o.id) + '" data-k="name" value="' + esc(r.o.name) + '"></td><td data-l="VALUES">' + esc(r.v) +
        '</td><td class="c-wide"><button type="button" class="fl-mini" data-act="use">USE</button> <button type="button" class="fl-mini" data-act="del">DELETE</button></td></tr>';
    }).join("") : '<tr><td class="c-wide" colspan="4">Nothing saved yet. Type your own objective or camera above and press SAVE.</td></tr>';
  }
  $("saveObj").addEventListener("click", function () {
    read();
    var mag = LM.parse(st.mag), na = LM.parse(st.na), n = LM.parse(st.n);
    var o = { id: uid("my-obj-"), origin: "user", brand: "Mine", name: "My " + LM.fmtPlain(mag, 4) + "x/" + st.na + " " + st.imm, mag: mag, na: na, immersion: st.imm, nImm: n,
      tubeLens_mm: LM.parse(st.designTube) || null, fn: LM.parse(st.fn) || undefined, checked: new Date().toISOString().slice(0, 10) };
    var bad = M.checkObjective(o);
    if (bad.length) { $("saveObjMsg").textContent = "Fill in magnification, NA and immersion first."; return; }
    mine.objectives.push(o); saveMine();
    st.objBrand = "__mine"; st.objId = o.id; fillAll(); renderMine(); compute();
    $("saveObjMsg").textContent = "Saved as “" + o.name + "”. Rename it under MY HARDWARE.";
  });
  $("saveCam").addEventListener("click", function () {
    read();
    var c = { id: uid("my-cam-"), origin: "user", brand: "Mine", name: "My camera " + st.pix + " µm", sensor: "", pixel_um: LM.parse(st.pix), px: [LM.parse(st.pxW), LM.parse(st.pxH)], checked: new Date().toISOString().slice(0, 10) };
    if (M.checkCamera(c).length) { $("saveCamMsg").textContent = "Fill in the camera pixel size and sensor pixels first."; return; }
    mine.cameras.push(c); saveMine();
    st.camBrand = "__mine"; st.camId = c.id; fillAll(); renderMine(); compute();
    $("saveCamMsg").textContent = "Saved as “" + c.name + "”. Rename it under MY HARDWARE.";
  });
  $("mineRows").addEventListener("change", function (e) {
    var tr = e.target.closest("tr[data-id]"); if (!tr || e.target.getAttribute("data-k") !== "name") return;
    var list = tr.getAttribute("data-t") === "objective" ? mine.objectives : mine.cameras, it = byId(list, tr.getAttribute("data-id"));
    if (it && e.target.value.trim()) { it.name = e.target.value.trim().slice(0, 80); saveMine(); fillAll(); compute(); }
  });
  $("mineRows").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act]"); if (!b) return;
    var tr = b.closest("tr"), t = tr.getAttribute("data-t"), id = tr.getAttribute("data-id");
    var list = t === "objective" ? mine.objectives : mine.cameras;
    if (b.getAttribute("data-act") === "del") {
      for (var i = 0; i < list.length; i++) if (list[i].id === id) list.splice(i, 1);
      saveMine(); if (st.objId === id) st.objId = ""; if (st.camId === id) st.camId = "";
      fillAll(); renderMine(); compute(); return;
    }
    if (t === "objective") { st.objBrand = "__mine"; applyObj(id); } else { st.camBrand = "__mine"; applyCam(id); }
    fill(); compute();
    window.scrollTo(0, (t === "objective" ? $("objBrand") : $("camBrand")).getBoundingClientRect().top + window.pageYOffset - 120);
  });
  $("mineExport").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify({ kind: "labmate.microscopy", v: 1, objectives: mine.objectives, cameras: mine.cameras }, null, 1)], { type: "application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "my-microscopy-hardware.json"; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });
  $("mineImport").addEventListener("change", function () {
    var f = this.files && this.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var o; try { o = JSON.parse(rd.result); } catch (e) { o = null; }
      if (!o || o.kind !== "labmate.microscopy" || o.v !== 1) { $("mineMsg").textContent = "Not a labmate.tools hardware file."; return; }
      var add = 0;
      (o.objectives || []).forEach(function (x) { if (!M.checkObjective(x).length && !byId(mine.objectives, x.id)) { x.origin = "user"; x.brand = "Mine"; mine.objectives.push(x); add++; } });
      (o.cameras || []).forEach(function (x) { if (!M.checkCamera(x).length && !byId(mine.cameras, x.id)) { x.origin = "user"; x.brand = "Mine"; mine.cameras.push(x); add++; } });
      saveMine(); fillAll(); renderMine(); compute();
      $("mineMsg").textContent = "Imported " + add + " item" + (add === 1 ? "" : "s") + ".";
    };
    rd.readAsText(f);
    this.value = "";
  });

  // ---------------- submit to the library ----------------
  function submitText() {
    var inp = R ? R.input : {};
    var L = ["Please add this hardware to the Nyquist Calculator library.", "",
      "OBJECTIVE: " + (st.mag || "?") + "x / NA " + (st.na || "?") + " / " + st.imm + " (n " + (st.n || "?") + "), designed for " + (st.designTube || "?") + " mm tube lens" + (st.fn ? ", FN " + st.fn : ""),
      "  maker + exact name + part no.: " + (R && R.obj && !R.oEd ? R.obj.brand + " " + R.obj.name + " (already listed)" : "")];
    if (st.mode === "confocal" || st.mode === "twophoton") L.push("CONFOCAL: scan field " + (st.field || "?") + " mm at zoom 1, max frame ?, zoom range ?", "  maker + model: " + (R && R.scanSys ? R.scanSys.brand + " " + R.scanSys.name + " (already listed)" : ""));
    else L.push("CAMERA: pixel " + (st.pix || "?") + " µm, " + (st.pxW || "?") + " × " + (st.pxH || "?") + " px", "  maker + model: " + (R && R.cam && !R.cEd ? R.cam.brand + " " + R.cam.name + " (already listed)" : ""));
    if (st.mode === "disk") L.push("DISK: pinhole " + (st.pinhole || "?") + " µm, spacing " + (st.pitch || "?") + " µm", "  maker + model: ");
    L.push("", "Link to the maker's spec sheet or datasheet (helps us check):", "");
    return L.join("\n");
  }
  $("submit").addEventListener("click", function (e) {
    if (!window.LMH) return;
    e.preventDefault();
    read();
    window.LMH.send("contact", { text: submitText(), kind: "Request" }, this.getAttribute("href"));
  });

  // ---------------- events ----------------
  document.addEventListener("input", function (e) {
    var t = e.target;
    if (t.closest("#mine") || t.closest("#chRows") || /^(objBrand|objModel|camBrand|camModel|scanModel|diskModel|mineImport)$/.test(t.id)) return;
    if (t.id === "imm") { if (MEDIA[$("imm").value]) $("n").value = MEDIA[$("imm").value]; }
    read(); compute();
  });
  $("objBrand").addEventListener("change", function () { st.objBrand = this.value; fillModel($("objModel"), D.objectives, mine.objectives, this.value, st.objId, objLabel, "— Type your own —"); });
  $("objModel").addEventListener("change", function () { read(); applyObj(this.value); fill(); compute(); });
  $("camBrand").addEventListener("change", function () { st.camBrand = this.value; fillModel($("camModel"), D.cameras, mine.cameras, this.value, st.camId, camLabel, "— Type your own —"); });
  $("camModel").addEventListener("change", function () { read(); applyCam(this.value); fill(); compute(); });
  $("scanModel").addEventListener("change", function () { read(); applyScan(this.value); fill(); compute(); });
  $("diskModel").addEventListener("change", function () { read(); applyDisk(this.value); fill(); compute(); });
  $("modeSeg").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-mode]"); if (!b) return;
    read(); st.mode = b.getAttribute("data-mode"); fillChannelDefaults(false); segSet(); renderCh(); compute();
  });
  $("chRows").addEventListener("input", function (e) {
    var tr = e.target.closest("tr[data-i]"); if (!tr) return;
    var c = st.ch[+tr.getAttribute("data-i")], k = e.target.getAttribute("data-k");
    if (k === "dye") {
      c.dye = e.target.value; var f = fluor(c.dye);
      if (f) { c.ex = defaultEx(f); c.exAuto = true; c.em = String(f.emMax); c.name = ""; }
      renderCh();
    } else if (k === "ex") { c.ex = e.target.value; c.exAuto = false; }
    else if (k === "em") c.em = e.target.value;
    else if (k === "name") c.name = e.target.value;
    compute();
  });
  $("chRows").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act=rm]"); if (!b || st.ch.length < 2) return;
    st.ch.splice(+b.closest("tr").getAttribute("data-i"), 1); renderCh(); compute();
  });
  $("addCh").addEventListener("click", function () {
    if (st.ch.length >= MAX_CH) return;
    st.ch.push({ dye: "", ex: "", em: "", name: "" }); renderCh(); compute();
    var el = $("cd" + (st.ch.length - 1)); if (el) el.focus();
  });
  $("print").addEventListener("click", function () { window.print(); });
  $("copy").addEventListener("click", function () {
    if (!R || !R.ok) return;
    LM.copy(settingsText(), function (ok) { $("copied").textContent = ok ? "COPIED" : "COPY FAILED"; setTimeout(function () { $("copied").textContent = ""; }, 2000); });
  });
  $("share").addEventListener("click", function () {
    writeHash();
    var url = location.origin + location.pathname + writeHash.last;
    try { history.replaceState(null, "", writeHash.last); } catch (e) { /* file:// */ }
    LM.copy(url, function (ok) { $("copied").textContent = ok ? "LINK COPIED" : "COPY FAILED"; setTimeout(function () { $("copied").textContent = ""; }, 2000); });
  });
  $("toScale").addEventListener("click", function () {
    if (!R || !R.geo || !window.LMH) return;
    var label = (R.obj && !R.oEd ? R.obj.name : LM.fmtPlain(R.input.mag, 4) + "x/" + R.input.na) + " · " + (R.path === "camera" ? (R.cam && !R.cEd ? R.cam.name : R.input.camera.pix + " µm camera") + (R.input.camera.bin > 1 ? " · bin " + R.input.camera.bin : "") :
      R.path === "scan" ? "zoom " + R.input.scan.zoom + " · " + R.input.scan.frame[0] + " px" : "entered");
    window.LMH.send("scale-bar", { umpp: R.geo.pixel / 1000, label: label, from: "nyquist" }, "../scale-bar/");
  });
  $("clear").addEventListener("click", function () {
    st = clone(DEF); applyObj(st.objId); applyCam(st.camId); applyScan(st.scanId); applyDisk(st.diskId); fillChannelDefaults(true);
    try { history.replaceState(null, "", location.pathname); } catch (e) { /* file:// */ }
    fill(); compute();
  });

  // ---------------- start ----------------
  if (firstRun) { applyObj(st.objId); applyCam(st.camId); applyScan(st.scanId); applyDisk(st.diskId); }
  fillChannelDefaults(false);
  fill();
  renderMine();
  compute();
  if (fromLink && window.LMH) setTimeout(function () { window.LMH.note("Opened shared settings. Your own last settings are replaced here; RESET starts fresh.", document.querySelector(".lm-page")); }, 0);
  window.LMT_NY_TEST = { get R() { return R; }, get st() { return st; }, compute: compute, fill: fill };
})();
