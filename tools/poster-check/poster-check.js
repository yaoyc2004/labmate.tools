/* labmate.tools · Poster Check
   Reads a poster file (PDF, PPTX, PNG, JPG) in the browser and checks it
   against the print size and the board limit: shape, orientation, scale,
   image resolution and text size at full size, fonts.
   Nothing is uploaded. Settings (not files) are kept in localStorage. */
(function () {
  'use strict';

  var STORE_KEY = 'labmate.posterCheck.v1';
  var CDN = 'https://cdnjs.cloudflare.com/ajax/libs/';
  var LIB = {
    pdfjs: CDN + 'pdf.js/3.11.174/pdf.min.js',
    pdfjsWorker: CDN + 'pdf.js/3.11.174/pdf.worker.min.js',
    pdflib: CDN + 'pdf-lib/1.17.1/pdf-lib.min.js',
    jszip: CDN + 'jszip/3.10.1/jszip.min.js'
  };
  var CM = 2.54;
  var EMU = 914400;            // PowerPoint units per inch
  var PPI_FAIL = 100, PPI_WARN = 150;
  var MIN_SMALLEST = 12, MIN_BODY = 24;   // printed pt

  var PRESETS = [
    { id: '48x36', w: 48, h: 36, label: '48 × 36 in · landscape', g: 'INCHES' },
    { id: '36x48', w: 36, h: 48, label: '36 × 48 in · portrait', g: 'INCHES' },
    { id: '56x42', w: 56, h: 42, label: '56 × 42 in · landscape', g: 'INCHES' },
    { id: '42x56', w: 42, h: 56, label: '42 × 56 in · portrait', g: 'INCHES' },
    { id: '44x44', w: 44, h: 44, label: '44 × 44 in · square', g: 'INCHES' },
    { id: '36x24', w: 36, h: 24, label: '36 × 24 in · landscape', g: 'INCHES' },
    { id: '24x36', w: 24, h: 36, label: '24 × 36 in · portrait', g: 'INCHES' },
    { id: 'a0p', w: 841 / 25.4, h: 1189 / 25.4, label: 'A0 · 841 × 1189 mm · portrait', g: 'ISO' },
    { id: 'a0l', w: 1189 / 25.4, h: 841 / 25.4, label: 'A0 · 1189 × 841 mm · landscape', g: 'ISO' },
    { id: 'a1p', w: 594 / 25.4, h: 841 / 25.4, label: 'A1 · 594 × 841 mm · portrait', g: 'ISO' },
    { id: 'a1l', w: 841 / 25.4, h: 594 / 25.4, label: 'A1 · 841 × 594 mm · landscape', g: 'ISO' }
  ];
  var GUIDE = [['Title', 72], ['Section headings', 36], ['Body text', 24], ['Captions', 18]];
  var STD_FONT = /^(helvetica|times|courier|symbol|zapfdingbats)/i;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function userError(msg) { var e = new Error(msg); e.user = true; return e; }

  /* ---------- state ---------- */
  var defaults = { v: 1, unit: 'in', preset: '48x36', pw: 48, ph: 36, bw: null, bh: null, fit: 'fit', bands: 'white', want: 28 };
  var state = Object.assign({}, defaults);
  var canStore = true;
  try {
    var raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      var saved = JSON.parse(raw);
      if (saved && saved.v === 1) state = Object.assign({}, defaults, saved);
    }
  } catch (e) { canStore = false; }
  function save() {
    if (!canStore) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { canStore = false; }
  }
  function okNum(v) { return typeof v === 'number' && isFinite(v) && v > 0; }
  if (!okNum(state.pw) || !okNum(state.ph)) { state.pw = 48; state.ph = 36; state.preset = '48x36'; }
  if (!okNum(state.bw)) state.bw = null;
  if (!okNum(state.bh)) state.bh = null;

  /* ---------- units and formatting ---------- */
  function cmMode() { return state.unit === 'cm'; }
  function u() { return cmMode() ? 'cm' : 'in'; }
  function trimZeros(s) { return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s; }
  function num(vIn) {
    if (cmMode()) return trimZeros((vIn * CM).toFixed(1));
    return trimZeros((Math.round(vIn * 100) / 100).toFixed(2));
  }
  function dims(w, h) { return num(w) + ' × ' + num(h) + ' ' + u(); }
  function DIMS(w, h) { return dims(w, h).toUpperCase(); }
  function len(vIn) { return num(vIn) + ' ' + u(); }
  function toIn(v) { return cmMode() ? v / CM : v; }
  function pctStr(s) {
    var p = s * 100;
    return (Math.abs(p - Math.round(p)) < 0.05 ? String(Math.round(p)) : p.toFixed(1)) + '%';
  }
  function pt(v) { return trimZeros((Math.round(v * 10) / 10).toFixed(1)); }
  function half(v) { return trimZeros((Math.round(v * 2) / 2).toFixed(1)); }
  function orient(w, h) { return Math.abs(w / h - 1) < 0.01 ? 'square' : (w > h ? 'landscape' : 'portrait'); }
  var RATIOS = [[1, 1], [4, 3], [3, 2], [16, 9], [16, 10], [5, 4], [2, 1], [3, 1]];
  function ratioLabel(w, h) {
    var land = w >= h, r = land ? w / h : h / w;
    if (Math.abs(r / Math.SQRT2 - 1) < 0.008) return 'ISO A';
    for (var i = 0; i < RATIOS.length; i++) {
      var q = RATIOS[i];
      if (Math.abs(r / (q[0] / q[1]) - 1) < 0.012) return land ? q[0] + ':' + q[1] : q[1] + ':' + q[0];
    }
    return land ? r.toFixed(2) + ':1' : '1:' + r.toFixed(2);
  }
  function bytesStr(n) {
    if (!isFinite(n)) return '';
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  /* ---------- loading libraries on demand ---------- */
  var scriptCache = {};
  function loadScript(url) {
    if (scriptCache[url]) return scriptCache[url];
    var p = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { delete scriptCache[url]; reject(userError('A reading library didn’t load. Check your connection and try again.')); };
      document.head.appendChild(s);
    });
    scriptCache[url] = p;
    return p;
  }

  /* ---------- image headers (pixel size, stored DPI) ---------- */
  function u32(b, i) { return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]; }
  function imageHeader(b) {
    if (!b || b.length < 24) return null;
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) {
      var out = { type: 'PNG', w: u32(b, 16), h: u32(b, 20), dpi: null };
      var i = 8;
      while (i + 12 <= b.length) {
        var n = u32(b, i), t = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
        if (t === 'pHYs' && n >= 9) {
          var ppu = u32(b, i + 8), unit = b[i + 16];
          if (unit === 1 && ppu > 0) out.dpi = ppu * 0.0254;
        }
        if (t === 'IDAT' || t === 'IEND') break;
        i += 12 + n;
      }
      return out;
    }
    if (b[0] === 0xFF && b[1] === 0xD8) {
      var o = { type: 'JPG', w: 0, h: 0, dpi: null }, j = 2;
      while (j + 4 < b.length) {
        if (b[j] !== 0xFF) { j++; continue; }
        var mk = b[j + 1];
        if (mk === 0xD8 || mk === 0x01 || (mk >= 0xD0 && mk <= 0xD7) || mk === 0xFF) { j += mk === 0xFF ? 1 : 2; continue; }
        var L = (b[j + 2] << 8) + b[j + 3];
        if (mk === 0xE0 && b[j + 4] === 0x4A && b[j + 5] === 0x46 && b[j + 6] === 0x49 && b[j + 7] === 0x46) {
          var units = b[j + 11], xd = (b[j + 12] << 8) + b[j + 13];
          if (units === 1 && xd > 1) o.dpi = xd;
          if (units === 2 && xd > 1) o.dpi = xd * CM;
        }
        if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) {
          o.h = (b[j + 5] << 8) + b[j + 6];
          o.w = (b[j + 7] << 8) + b[j + 8];
          break;
        }
        j += 2 + L;
      }
      return o.w ? o : null;
    }
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { type: 'GIF', w: b[6] + (b[7] << 8), h: b[8] + (b[9] << 8), dpi: null };
    return null;
  }

  /* ---------- thumbnail helpers ---------- */
  function loadImg(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(userError('This picture could not be opened.')); };
      im.src = src;
    });
  }
  function canvasToThumb(c) { return c.toDataURL('image/jpeg', 0.86); }

  /* A plain drawing of where pictures and text boxes sit, for files with no preview */
  function schematic(wIn, hIn, images, texts, note) {
    var W = 900, H = Math.round(W * hIn / wIn);
    if (H > 900) { H = 900; W = Math.round(H * wIn / hIn); }
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#C9CDC8'; x.lineWidth = 1;
    (texts || []).forEach(function (r) {
      var lh = Math.max(4, Math.min(14, r.h * H / 6));
      for (var yy = r.y * H + lh; yy < (r.y + r.h) * H - 2; yy += lh * 1.6) {
        x.fillStyle = '#C9CDC8'; x.fillRect(r.x * W, yy, r.w * W * 0.92, Math.max(2, lh * 0.45));
      }
    });
    (images || []).forEach(function (r) {
      x.fillStyle = '#9CC7B6'; x.fillRect(r.x * W, r.y * H, r.w * W, r.h * H);
      x.strokeStyle = '#1B2224'; x.strokeRect(r.x * W + 0.5, r.y * H + 0.5, r.w * W - 1, r.h * H - 1);
    });
    if (note) {
      x.font = '600 ' + Math.round(Math.max(11, W / 60)) + 'px "IBM Plex Mono", monospace';
      x.fillStyle = '#5B6466'; x.textAlign = 'center';
      x.fillText(note, W / 2, H - Math.max(10, H * 0.03));
    }
    return canvasToThumb(c);
  }

  /* =======================================================================
     PDF
     ======================================================================= */
  function openPdf(bytes) {
    return loadScript(LIB.pdfjs).then(function () {
      var lib = window.pdfjsLib;
      if (!lib) throw userError('The PDF reader didn’t load. Check your connection and try again.');
      lib.GlobalWorkerOptions.workerSrc = LIB.pdfjsWorker;
      var boxesP = loadScript(LIB.pdflib).then(function () { return readBoxes(bytes.slice()); }).catch(function () { return null; });
      var docP = lib.getDocument({ data: bytes.slice(), fontExtraProperties: true, isEvalSupported: false }).promise.catch(function (err) {
        if (err && err.name === 'PasswordException') throw userError('This PDF is password-protected. Save a copy without a password and try again.');
        if (err && err.name === 'InvalidPDFException') throw userError('This doesn’t look like a working PDF. Export it again and retry.');
        throw err;
      });
      return Promise.all([docP, boxesP]);
    }).then(function (r) {
      var pdf = r[0], boxes = r[1];
      return pageSizes(pdf, boxes).then(function (sizes) {
        return {
          count: pdf.numPages,
          noun: 'PAGE',
          sizes: sizes,
          destroy: function () { try { pdf.destroy(); } catch (e) { /* ignore */ } },
          analyze: function (i) { return analyzePdfPage(pdf, i, boxes && boxes[i]); }
        };
      });
    });
  }

  function readBoxes(bytes) {
    var L = window.PDFLib;
    if (!L) return null;
    return L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }).then(function (d) {
      return d.getPages().map(function (p) {
        function arr(b) { return [b.x, b.y, b.x + b.width, b.y + b.height]; }
        var has = function (n) { try { return !!p.node.get(L.PDFName.of(n)); } catch (e) { return false; } };
        return {
          media: arr(p.getMediaBox()), crop: arr(p.getCropBox()),
          trim: arr(p.getTrimBox()), bleed: arr(p.getBleedBox()),
          hasTrim: has('TrimBox'), hasCrop: has('CropBox')
        };
      });
    }).catch(function () { return null; });
  }

  function boxWH(b, uu, rot) {
    var w = Math.abs(b[2] - b[0]) * uu / 72, h = Math.abs(b[3] - b[1]) * uu / 72;
    return rot % 180 ? [h, w] : [w, h];
  }

  function pageSizes(pdf, boxes) {
    var n = Math.min(pdf.numPages, 60), jobs = [];
    for (var i = 0; i < n; i++) {
      jobs.push((function (idx) {
        return pdf.getPage(idx + 1).then(function (pg) {
          var b = boxes && boxes[idx];
          var box = b && b.hasTrim ? b.trim : pg.view;
          return boxWH(box, pg.userUnit || 1, pg.rotate || 0);
        });
      })(i));
    }
    return Promise.all(jobs);
  }

  function mul(m, n) {
    return [
      m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
      m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
      m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]
    ];
  }

  function analyzePdfPage(pdf, i, bx) {
    var lib = window.pdfjsLib, OPS = lib.OPS;
    var page, vp, frac, uu, rot;
    return pdf.getPage(i + 1).then(function (pg) {
      page = pg;
      uu = pg.userUnit || 1;
      rot = ((pg.rotate || 0) % 360 + 360) % 360;
      var base = pg.getViewport({ scale: 1 });
      var sc = Math.min(4, 1100 / Math.max(base.width, base.height));
      vp = pg.getViewport({ scale: sc });
      frac = function (r) {
        var q = vp.convertToViewportRectangle(r);
        var x0 = Math.min(q[0], q[2]), x1 = Math.max(q[0], q[2]), y0 = Math.min(q[1], q[3]), y1 = Math.max(q[1], q[3]);
        return { x: x0 / vp.width, y: y0 / vp.height, w: (x1 - x0) / vp.width, h: (y1 - y0) / vp.height };
      };
      var c = document.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      return pg.render({ canvasContext: ctx, viewport: vp }).promise.then(function () { return canvasToThumb(c); }, function () { return null; });
    }).then(function (thumb) {
      return Promise.all([thumb, page.getOperatorList(), page.getTextContent()]);
    }).then(function (r) {
      var thumb = r[0], ops = r[1], tc = r[2];
      var view = page.view;
      var finished = bx && bx.hasTrim ? bx.trim : view;
      var wh = boxWH(finished, uu, rot);
      var trim = frac(finished);
      // keep the finished box inside the drawn page
      trim.x = clamp(trim.x, 0, 1); trim.y = clamp(trim.y, 0, 1);
      trim.w = clamp(trim.w, 0.01, 1 - trim.x); trim.h = clamp(trim.h, 0.01, 1 - trim.y);

      /* placed images: walk the drawing operators, tracking the transform */
      var images = [], stack = [], ctm = [1, 0, 0, 1, 0, 0];
      for (var k = 0; k < ops.fnArray.length; k++) {
        var fn = ops.fnArray[k], a = ops.argsArray[k];
        if (fn === OPS.save) stack.push(ctm.slice());
        else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
        else if (fn === OPS.transform) ctm = mul(a, ctm);
        else if (fn === OPS.paintFormXObjectBegin) {
          stack.push(ctm.slice());
          if (a && a[0] && a[0].length === 6) ctm = mul(a[0], ctm);
        }
        else if (fn === OPS.paintFormXObjectEnd) { if (stack.length) ctm = stack.pop(); }
        else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
          var pw, ph;
          if (fn === OPS.paintImageXObject) { pw = a[1]; ph = a[2]; }
          else { pw = a[0] && a[0].width; ph = a[0] && a[0].height; }
          if (!(pw > 3 && ph > 3)) continue;
          var dw = Math.hypot(ctm[0], ctm[1]) * uu / 72, dh = Math.hypot(ctm[2], ctm[3]) * uu / 72;
          if (dw < 0.05 || dh < 0.05) continue;
          var xs = [ctm[4], ctm[0] + ctm[4], ctm[2] + ctm[4], ctm[0] + ctm[2] + ctm[4]];
          var ys = [ctm[5], ctm[1] + ctm[5], ctm[3] + ctm[5], ctm[1] + ctm[3] + ctm[5]];
          var rect = frac([Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)]);
          if (rect.x > 1 || rect.y > 1 || rect.x + rect.w < 0 || rect.y + rect.h < 0) continue;  // off the page
          images.push({ px: pw, py: ph, dw: dw, dh: dh, rect: rect });
        }
      }

      /* text sizes, weighted by number of characters */
      var bySize = {}, total = 0, fontIds = {};
      tc.items.forEach(function (it) {
        if (!it.str) return;
        var s = it.str.replace(/\s+/g, '');
        if (!s.length) return;
        var t = it.transform;
        var size = Math.hypot(t[2], t[3]) * uu;
        if (!(size > 0.5)) return;
        var key = Math.round(size * 2) / 2;
        bySize[key] = (bySize[key] || 0) + s.length;
        total += s.length;
        if (it.fontName) fontIds[it.fontName] = true;
      });
      var text;
      if (!total) text = { none: 'NO TEXT FOUND · OUTLINED OR IN A PICTURE', long: 'No live text was found, so text size can’t be measured. It may be outlined or inside a picture — check it by eye.' };
      else text = sizeStats(bySize, total, 0);

      /* fonts: pdf.js marks fonts that are not embedded with missingFile */
      var fonts = [];
      Object.keys(fontIds).forEach(function (id) {
        var f = null;
        try { if (page.commonObjs.has(id)) f = page.commonObjs.get(id); } catch (e) { f = null; }
        var nm = (f && f.name) || (tc.styles[id] && tc.styles[id].fontFamily) || id;
        nm = String(nm).replace(/^[A-Z]{6}\+/, '');
        var known = !!f;
        if (!fonts.some(function (x) { return x.name === nm; })) {
          fonts.push({ name: nm, embedded: known ? !f.missingFile : null, std: STD_FONT.test(nm) });
        }
      });

      var bleed = null, boxNote;
      if (bx) {
        var media = boxWH(bx.media, uu, rot);
        if (bx.hasTrim) {
          var extra = Math.max(media[0] - wh[0], media[1] - wh[1]) / 2;
          if (extra > 0.01) bleed = extra;
          boxNote = bleed ? { kind: 'trim', media: media, bleed: bleed } : { kind: 'trim-same' };
        } else {
          boxNote = bx.hasCrop && Math.abs(boxWH(bx.crop, uu, rot)[0] - media[0]) > 0.01 ? { kind: 'crop', media: media } : { kind: 'media' };
        }
      } else boxNote = { kind: 'unknown' };

      return {
        w: wh[0], h: wh[1], rot: rot, userUnit: uu,
        thumb: thumb, trim: trim, images: images, text: text,
        fonts: { kind: 'pdf', list: fonts }, boxNote: boxNote
      };
    });
  }

  function sizeStats(bySize, total, unknown) {
    var keys = Object.keys(bySize).map(Number).sort(function (a, b) { return a - b; });
    var body = keys[0], best = -1;
    keys.forEach(function (k) { if (bySize[k] > best) { best = bySize[k]; body = k; } });
    return { min: keys[0], body: body, chars: total, unknown: unknown || 0 };
  }

  /* =======================================================================
     PPTX
     ======================================================================= */
  function parseXml(s) { return new DOMParser().parseFromString(s, 'application/xml'); }
  function desc(el, name) { return Array.prototype.slice.call(el.getElementsByTagNameNS('*', name)); }
  function child(el, name) {
    if (!el) return null;
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c;
    return null;
  }
  function attrN(el, n) { var v = el && el.getAttribute(n); return v == null ? NaN : Number(v); }
  function readRels(zip, path) {
    var f = zip.file(path);
    if (!f) return Promise.resolve({});
    return f.async('string').then(function (s) {
      var out = {};
      desc(parseXml(s), 'Relationship').forEach(function (r) {
        out[r.getAttribute('Id')] = { target: r.getAttribute('Target'), external: r.getAttribute('TargetMode') === 'External' };
      });
      return out;
    });
  }
  function resolvePath(fromFile, target) {
    if (!target) return '';
    if (target.charAt(0) === '/') return target.slice(1);
    var parts = fromFile.split('/'); parts.pop();
    target.split('/').forEach(function (p) {
      if (p === '..') parts.pop(); else if (p && p !== '.') parts.push(p);
    });
    return parts.join('/');
  }
  function xfrmRect(x) {
    if (!x) return null;
    var off = child(x, 'off'), ext = child(x, 'ext');
    if (!off || !ext) return null;
    return { x: attrN(off, 'x'), y: attrN(off, 'y'), w: attrN(ext, 'cx'), h: attrN(ext, 'cy') };
  }
  /* map a shape's box out through any groups it sits in */
  function throughGroups(el, r) {
    for (var p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) {
      if (p.localName !== 'grpSp') continue;
      var gx = child(child(p, 'grpSpPr'), 'xfrm');
      if (!gx) continue;
      var off = child(gx, 'off'), ext = child(gx, 'ext'), co = child(gx, 'chOff'), ce = child(gx, 'chExt');
      if (!off || !ext || !co || !ce) continue;
      var sx = attrN(ext, 'cx') / attrN(ce, 'cx'), sy = attrN(ext, 'cy') / attrN(ce, 'cy');
      if (!isFinite(sx) || !isFinite(sy)) continue;
      r = { x: attrN(off, 'x') + (r.x - attrN(co, 'x')) * sx, y: attrN(off, 'y') + (r.y - attrN(co, 'y')) * sy, w: r.w * sx, h: r.h * sy };
    }
    return r;
  }
  function shapeBox(owner) {
    if (!owner) return null;
    var x = owner.localName === 'graphicFrame' ? child(owner, 'xfrm') : child(child(owner, 'spPr'), 'xfrm');
    var r = xfrmRect(x);
    return r ? throughGroups(owner, r) : null;
  }
  function closest(el, names) {
    for (var p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) if (names.indexOf(p.localName) >= 0) return p;
    return null;
  }

  function openPptx(bytes) {
    return loadScript(LIB.jszip).then(function () {
      return window.JSZip.loadAsync(bytes).catch(function () { throw userError('This .pptx could not be opened. Save it again from PowerPoint and retry.'); });
    }).then(function (zip) {
      var presF = zip.file('ppt/presentation.xml');
      if (!presF) throw userError('This file has no slides inside. Is it a PowerPoint (.pptx) file?');
      var th = zip.file('docProps/thumbnail.jpeg');
      return Promise.all([presF.async('string'), readRels(zip, 'ppt/_rels/presentation.xml.rels'), th ? th.async('base64') : null]).then(function (r) {
        var pres = parseXml(r[0]), rels = r[1];
        var sz = desc(pres, 'sldSz')[0];
        if (!sz) throw userError('This .pptx has no slide size inside.');
        var w = attrN(sz, 'cx') / EMU, h = attrN(sz, 'cy') / EMU;
        var slides = desc(pres, 'sldId').map(function (s) {
          var rel = rels[s.getAttribute('r:id')];
          return rel ? resolvePath('ppt/presentation.xml', rel.target) : null;
        }).filter(Boolean);
        if (!slides.length) throw userError('This .pptx has no slides.');
        var embedded = desc(pres, 'embeddedFont').map(function (f) { var fo = child(f, 'font'); return fo && fo.getAttribute('typeface'); }).filter(Boolean);
        var thumb = r[2] ? 'data:image/jpeg;base64,' + r[2] : null;
        var media = {};
        return {
          count: slides.length,
          noun: 'SLIDE',
          sizes: slides.map(function () { return [w, h]; }),
          destroy: function () {},
          analyze: function (i) { return analyzeSlide(zip, slides[i], i, w, h, thumb, embedded, media); }
        };
      });
    });
  }

  function analyzeSlide(zip, path, index, wIn, hIn, thumb, embedded, media) {
    var f = zip.file(path);
    if (!f) return Promise.reject(userError('Slide ' + (index + 1) + ' is missing from the file.'));
    var relPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
    return Promise.all([f.async('string'), readRels(zip, relPath)]).then(function (r) {
      var doc = parseXml(r[0]), rels = r[1];
      var W = wIn * EMU, H = hIn * EMU;
      function fracR(b) { return { x: b.x / W, y: b.y / H, w: b.w / W, h: b.h / H }; }

      /* pictures: every image fill, in a picture, a shape or the background */
      var jobs = [];
      desc(doc, 'blipFill').forEach(function (bf) {
        var blip = child(bf, 'blip');
        var id = blip && blip.getAttribute('r:embed');
        var rel = id && rels[id];
        if (!rel || rel.external) return;
        var target = resolvePath(path, rel.target);
        var box;
        if (closest(bf, ['bg'])) box = { x: 0, y: 0, w: W, h: H };
        else box = shapeBox(closest(bf, ['pic', 'sp']));
        if (!box || !(box.w > 0) || !(box.h > 0)) return;
        var sr = child(bf, 'srcRect');
        var crop = { l: attrN(sr, 'l') || 0, t: attrN(sr, 't') || 0, r: attrN(sr, 'r') || 0, b: attrN(sr, 'b') || 0 };
        var mf = zip.file(target);
        if (!mf) return;
        if (!media[target]) media[target] = mf.async('uint8array').then(imageHeader);
        jobs.push(media[target].then(function (hd) {
          if (!hd || !hd.w) return null;   // vector (EMF, SVG) or unknown
          var fx = Math.max(0.01, 1 - (crop.l + crop.r) / 100000), fy = Math.max(0.01, 1 - (crop.t + crop.b) / 100000);
          return { px: hd.w * fx, py: hd.h * fy, dw: box.w / EMU, dh: box.h / EMU, rect: fracR(box) };
        }));
      });

      /* text: explicit run sizes, shrunk by "shrink text on overflow" */
      var bySize = {}, total = 0, unknown = 0, textBoxes = [];
      desc(doc, 'txBody').forEach(function (tb) {
        var fit = child(child(tb, 'bodyPr'), 'normAutofit');
        var scale = fit && fit.getAttribute('fontScale') ? Number(fit.getAttribute('fontScale')) / 100000 : 1;
        var owner = closest(tb, ['sp', 'graphicFrame']);
        var box = shapeBox(owner);
        if (box) textBoxes.push(fracR(box));
        desc(tb, 'r').concat(desc(tb, 'fld')).forEach(function (run) {
          var t = child(run, 't');
          var s = t ? t.textContent.replace(/\s+/g, '') : '';
          if (!s) return;
          var rp = child(run, 'rPr');
          var sz = rp && rp.getAttribute('sz');
          if (sz) {
            var size = Number(sz) / 100 * scale;
            var key = Math.round(size * 2) / 2;
            bySize[key] = (bySize[key] || 0) + s.length;
            total += s.length;
          } else unknown += s.length;
        });
      });
      var text;
      if (total) text = sizeStats(bySize, total, unknown);
      else if (unknown) text = { none: 'SIZES COME FROM THE TEMPLATE · NOT READ', long: 'All text on this slide uses the template’s default size, which this page doesn’t read. Export a PDF and check that instead.' };
      else text = { none: 'NO TEXT ON THIS SLIDE', long: 'No text was found on this slide.' };

      var faces = {};
      desc(doc, 'latin').forEach(function (l) {
        var tf = l.getAttribute('typeface');
        if (tf && tf.charAt(0) !== '+') faces[tf] = true;
      });

      return Promise.all(jobs).then(function (imgs) {
        imgs = imgs.filter(Boolean);
        var pic = index === 0 && thumb ? thumb : schematic(wIn, hIn, imgs.map(function (x) { return x.rect; }), textBoxes, 'NO PREVIEW IN FILE · BOXES SHOW PICTURES');
        return {
          w: wIn, h: hIn, rot: 0, thumb: pic, trim: { x: 0, y: 0, w: 1, h: 1 }, images: imgs, text: text,
          fonts: { kind: 'pptx', faces: Object.keys(faces), embedded: embedded },
          boxNote: { kind: 'slide' }
        };
      });
    });
  }

  /* =======================================================================
     PNG / JPG
     ======================================================================= */
  function openImage(bytes, kind) {
    var hd = imageHeader(bytes);
    if (!hd) return Promise.reject(userError('This picture could not be read. Is it a real ' + kind + ' file?'));
    var dpi = hd.dpi && hd.dpi >= 10 ? hd.dpi : null;
    var url = URL.createObjectURL(new Blob([bytes], { type: kind === 'PNG' ? 'image/png' : 'image/jpeg' }));
    return loadImg(url).then(function (im) {
      var W = 1100, sc = Math.min(1, W / Math.max(im.naturalWidth, im.naturalHeight));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.naturalWidth * sc)); c.height = Math.max(1, Math.round(im.naturalHeight * sc));
      var x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      var d = dpi || 72;
      var a = {
        w: hd.w / d, h: hd.h / d, rot: 0, thumb: canvasToThumb(c), trim: { x: 0, y: 0, w: 1, h: 1 },
        images: [{ px: hd.w, py: hd.h, dw: hd.w / d, dh: hd.h / d, rect: { x: 0, y: 0, w: 1, h: 1 }, whole: true }],
        text: { none: 'TEXT IN A PICTURE · CHECK BY EYE', long: 'Text inside a picture can’t be measured. Check it by eye at full size.' },
        fonts: null, boxNote: { kind: 'image', px: [hd.w, hd.h], dpi: dpi }
      };
      return { count: 1, noun: 'PAGE', sizes: [[a.w, a.h]], destroy: function () {}, analyze: function () { return Promise.resolve(a); } };
    }, function (err) { URL.revokeObjectURL(url); throw err; });
  }

  /* =======================================================================
     Opening files
     ======================================================================= */
  var current = null;   // { src, name, kind, size, index, page }
  var loadToken = 0;

  function kindOf(file) {
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf' || file.type === 'application/pdf') return 'PDF';
    if (ext === 'pptx') return 'PPTX';
    if (ext === 'png' || file.type === 'image/png') return 'PNG';
    if (ext === 'jpg' || ext === 'jpeg' || file.type === 'image/jpeg') return 'JPG';
    if (ext === 'ppt') return 'PPT';
    return null;
  }

  function handleFile(file) {
    if (!file) return;
    var kind = kindOf(file);
    if (kind === 'PPT' || !kind) { if (current && current.src) current.src.destroy(); current = null; }
    if (kind === 'PPT') { showFileError('This is an old .ppt file. In PowerPoint, save it as .pptx — or better, export a PDF — and try again.'); return; }
    if (!kind) { showFileError('Poster Check reads PDF, PPTX, PNG and JPG files. Export your poster as a PDF and try again.'); return; }
    setSample(null);
    setBusy('READING ' + file.name.toUpperCase());
    file.arrayBuffer().then(function (buf) {
      openBytes(new Uint8Array(buf), file.name, kind, file.size);
    }, function () { showFileError('This file could not be read.'); });
  }

  function openBytes(bytes, name, kind, size) {
    var token = ++loadToken;
    if (!current || current.name !== name) setBusy('READING ' + name.toUpperCase());
    var p = kind === 'PDF' ? openPdf(bytes) : kind === 'PPTX' ? openPptx(bytes) : openImage(bytes, kind);
    return p.then(function (src) {
      if (token !== loadToken) { src.destroy(); return; }
      if (current && current.src) current.src.destroy();
      current = { src: src, name: name, kind: kind, size: size, index: 0, page: null };
      return selectPage(0, token);
    }).catch(function (err) {
      if (token !== loadToken) return;
      if (!(err && err.user)) console.error(err);
      // don't leave the previous file's result on screen
      if (current && current.src) current.src.destroy();
      current = null;
      setSample(null);
      showFileError(err && err.user ? err.message : 'This file could not be read. ' + (kind === 'PDF' ? 'Export the PDF again and retry.' : 'Save it again and retry.'));
    });
  }

  function selectPage(i, token) {
    token = token || ++loadToken;
    var src = current.src;
    setBusy('CHECKING ' + src.noun + ' ' + (i + 1));
    return src.analyze(i).then(function (a) {
      if (token !== loadToken) return;
      current.index = i;
      current.page = a;
      a.thumbImg = null;
      if (a.thumb) loadImg(a.thumb).then(function (im) { a.thumbImg = im; }, function () {});
      busy = false;
      $('fileError').hidden = true;
      render();
    }).catch(function (err) {
      if (token !== loadToken) return;
      console.error(err);
      showFileError(err && err.user ? err.message : 'This ' + src.noun.toLowerCase() + ' could not be read.');
    });
  }

  var busy = false;
  function setBusy(msg) {
    busy = true;
    $('drop').classList.add('busy');
    var v = $('verdict');
    v.className = 'status busy';
    v.innerHTML = '<div class="status-title">' + esc(msg) + ' …</div><p class="sans">Large posters can take a few seconds.</p>';
    $('fileError').hidden = true;
  }
  function showFileError(msg) {
    busy = false;
    $('drop').classList.remove('busy');
    $('fileError').textContent = msg;
    $('fileError').hidden = false;
    render();
  }

  /* =======================================================================
     Samples — made here with jsPDF, so they go through the same reader
     ======================================================================= */
  var SAMPLES = {
    half: {
      name: 'sample_half-size.pdf', w: 24, h: 18, note: 'Half-size file for a 48 × 36 in print',
      size: { title: 40, authors: 16, head: 20, body: 12, caption: 10, refs: 9 },
      ppi: { logo: 340, a: 340, b: 340, c: 340, d: 340 }
    },
    wide: {
      name: 'sample_widescreen.pdf', w: 13.333, h: 7.5, note: 'A 16:9 PowerPoint slide, exported to PDF',
      size: { title: 24, authors: 10, head: 12, body: 8, caption: 7, refs: 6 },
      ppi: { logo: 600, a: 600, b: 600, c: 600, d: 600 }
    },
    low: {
      name: 'sample_low-res.pdf', w: 48, h: 36, note: 'Full-size file with two low-resolution pictures',
      size: { title: 96, authors: 32, head: 36, body: 14, caption: 12, refs: 11 },
      ppi: { logo: 50, a: 160, b: 90, c: 160, d: 160 }
    }
  };
  var BODY = [
    'This sample poster was made in your browser to show how the checks work.',
    'All names, numbers and figures on it are made up.',
    'Swap in your own file to check a real poster.'
  ];

  function rng(seed) { var s = seed; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
  function figure(kind, wPx, hPx) {
    var c = document.createElement('canvas'); c.width = wPx; c.height = hPx;
    var x = c.getContext('2d'), r = rng(wPx * 7 + hPx), i;
    if (kind === 'logo') {
      x.fillStyle = '#fff'; x.fillRect(0, 0, wPx, hPx);
      x.fillStyle = '#17403D'; x.beginPath(); x.arc(wPx / 2, hPx / 2, wPx * 0.46, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#fff'; x.font = '600 ' + Math.round(wPx * 0.28) + 'px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('LAB', wPx / 2, hPx / 2);
    } else if (kind === 'micro') {
      x.fillStyle = '#0B1513'; x.fillRect(0, 0, wPx, hPx);
      for (i = 0; i < 70; i++) {
        var cx = r() * wPx, cy = r() * hPx, rad = (0.02 + r() * 0.035) * wPx;
        var g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, 'rgba(120,230,160,0.95)'); g.addColorStop(1, 'rgba(46,158,91,0)');
        x.fillStyle = g; x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI * 2); x.fill();
      }
    } else if (kind === 'bars') {
      x.fillStyle = '#fff'; x.fillRect(0, 0, wPx, hPx);
      x.strokeStyle = '#1B2224'; x.lineWidth = Math.max(1, wPx / 300);
      x.beginPath(); x.moveTo(wPx * 0.1, hPx * 0.08); x.lineTo(wPx * 0.1, hPx * 0.9); x.lineTo(wPx * 0.95, hPx * 0.9); x.stroke();
      var vals = [0.35, 0.55, 0.8, 0.62, 0.9];
      vals.forEach(function (v, k) {
        x.fillStyle = k % 2 ? '#9CC7B6' : '#17403D';
        var bw = wPx * 0.11, bx = wPx * (0.16 + k * 0.155);
        x.fillRect(bx, hPx * 0.9 - v * hPx * 0.78, bw, v * hPx * 0.78);
      });
    } else if (kind === 'line') {
      x.fillStyle = '#fff'; x.fillRect(0, 0, wPx, hPx);
      x.strokeStyle = '#C9CDC8'; x.lineWidth = Math.max(1, wPx / 600);
      for (i = 1; i < 5; i++) { x.beginPath(); x.moveTo(wPx * 0.1, hPx * i / 5); x.lineTo(wPx * 0.95, hPx * i / 5); x.stroke(); }
      x.strokeStyle = '#17403D'; x.lineWidth = Math.max(2, wPx / 150);
      x.beginPath();
      for (i = 0; i <= 40; i++) { var px = wPx * (0.1 + 0.85 * i / 40), py = hPx * (0.85 - 0.65 * (1 - Math.exp(-i / 12)) + (r() - 0.5) * 0.04); if (i) x.lineTo(px, py); else x.moveTo(px, py); }
      x.stroke();
    } else {
      x.fillStyle = '#E9E4D6'; x.fillRect(0, 0, wPx, hPx);
      for (i = 0; i < 6; i++) {
        for (var j = 0; j < 3; j++) {
          x.fillStyle = 'rgba(27,34,36,' + (0.25 + r() * 0.6).toFixed(2) + ')';
          x.fillRect(wPx * (0.06 + i * 0.155), hPx * (0.2 + j * 0.25), wPx * 0.12, hPx * 0.06);
        }
      }
    }
    return c.toDataURL('image/jpeg', 0.8);
  }

  function makeSample(id) {
    var S = SAMPLES[id];
    var J = window.jspdf && window.jspdf.jsPDF;
    if (!J) throw userError('The PDF library didn’t load. Check your connection and reload the page.');
    var W = S.w * 72, H = S.h * 72;
    var doc = new J({ unit: 'pt', format: [W, H], orientation: W > H ? 'landscape' : 'portrait', compress: true });
    var sz = S.size;
    function T(str, x, y, size, bold, color) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size);
      doc.setTextColor.apply(doc, color || [27, 34, 36]);
      doc.text(str, x, y);
    }
    function img(kind, key, x, y, w, h) {
      var px = Math.max(8, Math.round(w / 72 * S.ppi[key])), py = Math.max(8, Math.round(h / 72 * S.ppi[key]));
      doc.addImage(figure(kind, px, py), 'JPEG', x, y, w, h);
    }
    function lines(arr, x, y, size) {
      arr.forEach(function (l, k) { T(l, x, y + k * size * 1.35, size); });
      return y + arr.length * size * 1.35;
    }
    var m = W * 0.05, colW = W * 0.265, gap = (W - 2 * m - 3 * colW) / 2;
    var cx = [m, m + colW + gap, m + 2 * (colW + gap)];
    T('Example poster: a made-up study', m, H * 0.085, sz.title, true);
    T('A. Author, B. Author · Example Institute · fictional data', m, H * 0.085 + sz.title * 0.9, sz.authors, false, [91, 100, 102]);
    var lg = W * 0.08;
    img('logo', 'logo', W - m - lg, H * 0.03, lg, lg);
    doc.setDrawColor(27, 34, 36); doc.setLineWidth(Math.max(1, W / 1200));
    doc.line(m, H * 0.19, W - m, H * 0.19);
    var top = H * 0.19 + sz.head * 1.8;
    var ih = colW * 0.6;
    function wrap(str, size) { doc.setFont('helvetica', 'normal'); doc.setFontSize(size); return doc.splitTextToSize(str, colW); }
    var body = wrap(BODY.join(' '), sz.body);
    // column 1
    T('Background', cx[0], top, sz.head, true);
    var y = lines(body, cx[0], top + sz.head * 1.2, sz.body);
    img('micro', 'a', cx[0], y, colW, ih);
    y = lines(wrap('Fig. 1 — A made-up micrograph.', sz.caption), cx[0], y + ih + sz.caption * 1.4, sz.caption);
    lines(body, cx[0], y + sz.body, sz.body);
    // column 2
    T('Results', cx[1], top, sz.head, true);
    img('bars', 'b', cx[1], top + sz.head * 0.8, colW, ih);
    y = lines(wrap('Fig. 2 — Made-up counts per group.', sz.caption), cx[1], top + sz.head * 0.8 + ih + sz.caption * 1.4, sz.caption);
    img('line', 'c', cx[1], y + sz.caption, colW, ih);
    lines(wrap('Fig. 3 — A made-up time course.', sz.caption), cx[1], y + sz.caption + ih + sz.caption * 1.4, sz.caption);
    // column 3
    T('Methods', cx[2], top, sz.head, true);
    y = lines(body, cx[2], top + sz.head * 1.2, sz.body);
    img('blot', 'd', cx[2], y, colW, ih * 0.8);
    y += ih * 0.8 + sz.head * 1.6;
    T('Conclusions', cx[2], y, sz.head, true);
    lines(body, cx[2], y + sz.head * 1.2, sz.body);
    T('References: 1. Example A, et al. Made-up Journal. 2. Example B, et al. Another Journal.', m, H - m * 0.6, sz.refs, false, [91, 100, 102]);
    doc.setProperties({ title: 'Poster Check sample', creator: 'labmate.tools · Poster Check' });
    return new Uint8Array(doc.output('arraybuffer'));
  }

  var activeSample = null;
  function setSample(id) {
    activeSample = id;
    Array.prototype.forEach.call(document.querySelectorAll('[data-sample]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-sample') === id));
    });
    $('sampleHint').hidden = !id;
  }
  function runSample(id) {
    setSample(id);
    state.pw = 48; state.ph = 36; state.preset = '48x36'; state.bw = 48; state.bh = 42;
    save(); syncInputs();
    setBusy('MAKING THE ' + id.toUpperCase() + ' SAMPLE');
    setTimeout(function () {
      try {
        var b = makeSample(id);
        openBytes(b, SAMPLES[id].name, 'PDF', b.length);
      } catch (err) {
        console.error(err);
        showFileError(err && err.user ? err.message : 'The sample could not be made in this browser.');
      }
    }, 30);
  }

  /* =======================================================================
     The checks
     ======================================================================= */
  function compute() {
    var P = { w: state.pw, h: state.ph };
    var B = okNum(state.bw) && okNum(state.bh) ? { w: state.bw, h: state.bh } : null;
    var a = current && current.page;
    var m = { P: P, B: B, a: a, checks: [] };
    if (!(okNum(P.w) && okNum(P.h))) { m.noPrint = true; return m; }
    if (!a) return m;
    var F = { w: a.w, h: a.h };
    m.F = F;
    m.oF = orient(F.w, F.h); m.oP = orient(P.w, P.h);
    m.orientBad = (m.oF === 'landscape' && m.oP === 'portrait') || (m.oF === 'portrait' && m.oP === 'landscape');
    m.shapeDiff = Math.abs((F.w / F.h) / (P.w / P.h) - 1);
    m.sameShape = m.shapeDiff < 0.01;
    m.sFit = Math.min(P.w / F.w, P.h / F.h);
    m.sFill = Math.max(P.w / F.w, P.h / F.h);
    m.mode = m.sameShape ? 'same' : (state.fit === 'fill' ? 'fill' : 'fit');
    m.s = m.mode === 'fill' ? m.sFill : m.sFit;
    m.out = { w: F.w * m.s, h: F.h * m.s };
    m.fitOut = { w: F.w * m.sFit, h: F.h * m.sFit };
    m.bandX = Math.max(0, (P.w - m.fitOut.w) / 2);
    m.bandY = Math.max(0, (P.h - m.fitOut.h) / 2);
    m.cutX = Math.max(0, (F.w * m.sFill - P.w) / 2);
    m.cutY = Math.max(0, (F.h * m.sFill - P.h) / 2);

    var C = m.checks;
    function add(label, value, kind, key) { C.push({ label: label, value: value, kind: kind, key: key }); }
    var rF = ratioLabel(F.w, F.h), rP = ratioLabel(P.w, P.h);
    if (m.sameShape) {
      if (m.shapeDiff > 0.002) add('SHAPE MATCHES PRINT', 'NEARLY · ' + (m.shapeDiff * 100).toFixed(1) + '% OFF, UNDER ' + len(Math.max(m.bandX, m.bandY) * 2 + 0.005).toUpperCase(), 'pass', 'shape');
      else add('SHAPE MATCHES PRINT', rF + ' FILE · ' + rP + ' PRINT', 'pass', 'shape');
    } else {
      add('SHAPE MATCHES PRINT', rF + ' FILE · ' + rP + ' PRINT · ' + (m.mode === 'fill' ? 'FILL' : 'FIT') + ' CHOSEN', 'warn', 'shape');
    }
    if (m.orientBad) add('ORIENTATION', m.oF.toUpperCase() + ' FILE → ' + m.oP.toUpperCase() + ' PRINT', 'fail', 'orient');
    else add('ORIENTATION', m.oF.toUpperCase() + ' → ' + m.oP.toUpperCase(), 'pass', 'orient');

    if (!B) add('FITS THE BOARD', 'NO BOARD LIMIT ENTERED', 'info', 'board');
    else {
      var eps = 0.01;
      m.overW = P.w - B.w; m.overH = P.h - B.h;
      if (m.overW > eps || m.overH > eps) {
        m.boardBad = true;
        var parts = [];
        if (m.overW > eps) parts.push(len(m.overW).toUpperCase() + ' TOO WIDE');
        if (m.overH > eps) parts.push(len(m.overH).toUpperCase() + ' TOO TALL');
        add('FITS THE BOARD', parts.join(' · '), 'fail', 'board');
        var sB = Math.min(B.w / F.w, B.h / F.h);
        var step = cmMode() ? 1 / CM : 0.5;
        var best = { w: Math.floor(F.w * sB / step + 1e-6) * step, h: Math.floor(F.h * sB / step + 1e-6) * step };
        m.boardSuggest = best;
      } else add('FITS THE BOARD', DIMS(P.w, P.h) + ' ≤ ' + DIMS(B.w, B.h), 'pass', 'board');
    }

    /* images */
    m.imgs = a.images.map(function (im) {
      var ppi = Math.min(im.px / (im.dw * m.s), im.py / (im.dh * m.s));
      return { ppi: ppi, rect: im.rect, level: ppi < PPI_FAIL ? 'fail' : ppi < PPI_WARN ? 'warn' : 'ok' };
    });
    var n = m.imgs.length;
    var low = n ? Math.min.apply(null, m.imgs.map(function (x) { return x.ppi; })) : 0;
    var nFail = m.imgs.filter(function (x) { return x.level === 'fail'; }).length;
    var nWarn = m.imgs.filter(function (x) { return x.level === 'warn'; }).length;
    m.nFail = nFail; m.nWarn = nWarn;
    if (a.images.length === 1 && a.images[0].whole) {
      add('RESOLUTION AT PRINT SIZE', a.images[0].px + ' × ' + a.images[0].py + ' PX → ' + Math.round(low) + ' PPI', nFail ? 'fail' : nWarn ? 'warn' : 'pass', 'images');
    } else if (!n) {
      add('IMAGES AT PRINT SIZE', current.kind === 'PPTX' ? 'NO PHOTOS ON THIS SLIDE' : 'NO PHOTOS · VECTOR ONLY', 'pass', 'images');
    } else if (nFail) {
      add('IMAGES AT PRINT SIZE', nFail + ' OF ' + n + ' UNDER ' + PPI_FAIL + ' PPI · LOWEST ' + Math.round(low), 'fail', 'images');
    } else if (nWarn) {
      add('IMAGES AT PRINT SIZE', nWarn + ' OF ' + n + ' UNDER ' + PPI_WARN + ' PPI · LOWEST ' + Math.round(low), 'warn', 'images');
    } else {
      add('IMAGES AT PRINT SIZE', n + (n === 1 ? ' IMAGE' : ' IMAGES') + ' · LOWEST ' + Math.round(low) + ' PPI', 'pass', 'images');
    }

    /* text */
    var t = a.text, sx = m.s.toFixed(2);
    if (t && !t.none) {
      m.minP = t.min * m.s; m.bodyP = t.body * m.s;
      add('SMALLEST TEXT, PRINTED', pt(t.min) + ' PT × ' + sx + ' = ' + pt(m.minP) + ' PT', m.minP < MIN_SMALLEST ? 'warn' : 'pass', 'small');
      add('MOST TEXT, PRINTED', pt(t.body) + ' PT × ' + sx + ' = ' + pt(m.bodyP) + ' PT' + (m.bodyP < MIN_BODY ? ' · GUIDE ' + MIN_BODY + ' PT' : ''), m.bodyP < MIN_BODY ? 'warn' : 'pass', 'body');
      if (t.unknown) add('TEXT FROM THE TEMPLATE', t.unknown + ' CHARACTERS · SIZE NOT READ', 'info', 'tpl');
    } else if (t) {
      add('TEXT SIZE', t.none, 'info', 'small');
    }

    /* fonts */
    var fo = a.fonts;
    if (fo && fo.kind === 'pdf' && fo.list.length) {
      var miss = fo.list.filter(function (f) { return f.embedded === false; });
      var other = miss.filter(function (f) { return !f.std; }), std = miss.filter(function (f) { return f.std; });
      var names = function (arr) { var s = arr.slice(0, 2).map(function (f) { return f.name.toUpperCase(); }).join(', '); return arr.length > 2 ? s + ' +' + (arr.length - 2) : s; };
      if (other.length) add('FONTS EMBEDDED', names(other) + ' NOT EMBEDDED', 'warn', 'fonts');
      else if (std.length) add('FONTS EMBEDDED', names(std) + ' NOT EMBEDDED · STANDARD PDF FONT', 'info', 'fonts');
      else add('FONTS EMBEDDED', fo.list.length === 1 ? 'THE 1 FONT IS EMBEDDED' : 'ALL ' + fo.list.length + ' EMBEDDED', 'pass', 'fonts');
    } else if (fo && fo.kind === 'pptx') {
      add('FONTS EMBEDDED', 'CAN’T TELL FROM A PPTX · EXPORT A PDF TO CHECK', 'info', 'fonts');
    }

    /* pages */
    var src = current.src;
    if (src.count > 1) {
      add(src.noun + 'S', src.count + ' ' + src.noun + 'S · CHECKING ' + src.noun + ' ' + (current.index + 1), 'warn', 'pages');
      var s0 = src.sizes[0];
      var mixed = src.sizes.some(function (z) { return Math.abs(z[0] - s0[0]) > 0.01 || Math.abs(z[1] - s0[1]) > 0.01; });
      if (mixed) add(src.noun + ' SIZES', 'NOT ALL THE SAME', 'warn', 'mixed');
    }

    /* verdict */
    var fails = C.filter(function (c) { return c.kind === 'fail'; });
    var warns = C.filter(function (c) { return c.kind === 'warn'; });
    var v;
    if (fails.length) {
      var k = fails[0].key;
      if (k === 'orient') v = { kind: 'fail', title: 'FILE AND PRINT FACE DIFFERENT WAYS', text: 'Your file is ' + m.oF + ' but the print size is ' + m.oP + '. Usually the width and height were typed the wrong way round.', act: 'swap', actText: 'SWAP TO ' + DIMS(P.h, P.w) };
      else if (k === 'board') v = { kind: 'fail', title: 'TOO BIG FOR THE BOARD', text: 'The print is bigger than the ' + dims(B.w, B.h) + ' board. The largest print in your file’s shape that fits is about ' + dims(m.boardSuggest.w, m.boardSuggest.h) + '.', act: 'board', actText: 'USE ' + DIMS(m.boardSuggest.w, m.boardSuggest.h) };
      else v = { kind: 'fail', title: (nFail === 1 ? '1 IMAGE WILL' : nFail + ' IMAGES WILL') + ' PRINT BLURRY', text: (a.images.length === 1 && a.images[0].whole ? 'At this print size the picture has only ' + Math.round(low) + ' pixels per inch.' : 'Marked in red on the preview: under ' + PPI_FAIL + ' ppi at full size.') + ' Put the original image files back into the poster, then export again.' };
    } else if (warns.length) {
      if (warns[0].key === 'shape') v = { kind: 'warn', title: 'SHAPE DIFFERS — ' + rF + ' FILE, ' + rP + ' PRINT', text: (current.kind === 'PPTX' && rF === '16:9' ? 'PowerPoint’s default slide is 16:9. ' : '') + 'Pick how the extra space is handled below, and tell the print shop which one.' };
      else v = { kind: 'warn', title: warns.length === 1 ? '1 THING TO CHECK' : warns.length + ' THINGS TO CHECK', text: 'Look at the rows marked CHECK below. None of them stops the print, but the result may not look as you expect.' };
    } else {
      var p = m.s;
      if (Math.abs(p - 1) < 0.01) v = { kind: 'pass', title: 'PASS — FULL SIZE, PRINT AT 100%', text: 'The file is already the print size. Ask the print shop to print it at 100%.' };
      else v = { kind: 'pass', title: 'PASS — PRINTS AT ' + pctStr(p) + ', NOTHING TO FIX', text: (p > 1 ? 'A smaller file is normal. ' : 'The file is bigger than the print. ') + 'Ask the print shop to scale it proportionally to ' + pctStr(p) + '.' };
    }
    m.verdict = v;
    return m;
  }

  /* =======================================================================
     Drawing (SVG, to scale)
     ======================================================================= */
  var svgId = 0;
  function stageSVG(m, o) {
    var P = m.P, F = m.F, a = m.a, B = o.board ? m.B : null;
    var mode = o.mode || m.mode;
    var s = F ? (mode === 'fill' ? m.sFill : m.sFit) : 1;
    var spanW = Math.max(P.w, B ? B.w : 0), spanH = Math.max(P.h, B ? B.h : 0);
    var k = Math.min(o.W / spanW, o.H / spanH);
    var art = F ? { w: F.w * s * k, h: F.h * s * k } : null;
    var pw = P.w * k, ph = P.h * k;
    var edge = 14, overX = 0, overY = 0;
    if (art && mode === 'fill') { overX = Math.max(0, (art.w - pw) / 2) + 6; overY = Math.max(0, (art.h - ph) / 2) + 6; }
    var fileW = 0, fileH = 0, showFile = false;
    if (o.file && F && s >= 1.1) {
      fileW = F.w * k; fileH = F.h * k;
      showFile = fileW >= 16 && fileH >= 16 && fileW <= o.W * 0.55;
    }
    var padX = edge;   // the file sits at the left edge
    var leftW = showFile ? fileW + 92 : 0;
    var ox = edge + leftW + overX, oy = edge + overY;
    var areaW = Math.max(pw, B ? B.w * k : 0), areaH = Math.max(ph, B ? B.h * k : 0);
    var totalW = ox + Math.max(areaW, pw + overX) + edge, totalH = oy + Math.max(areaH, ph + overY) + edge;
    var id = 'pc' + (++svgId);
    var out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + totalW.toFixed(1) + ' ' + totalH.toFixed(1) + '" width="' + totalW.toFixed(0) + '" font-family="IBM Plex Mono, monospace" aria-hidden="true">');
    out.push('<defs><clipPath id="' + id + 'c"><rect x="' + ox + '" y="' + oy + '" width="' + pw + '" height="' + ph + '"/></clipPath>');
    out.push('<pattern id="' + id + 'h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#F7E1DB"/><line x1="0" y1="0" x2="0" y2="6" stroke="#A3341F" stroke-width="1.2"/></pattern></defs>');

    var ax = 0, ay = 0, place = null;
    if (art) {
      ax = ox + (pw - art.w) / 2; ay = oy + (ph - art.h) / 2;
      var t = a.trim || { x: 0, y: 0, w: 1, h: 1 };
      var fw = art.w / t.w, fh = art.h / t.h;
      place = { x: ax - t.x * fw, y: ay - t.y * fh, w: fw, h: fh };
    }
    function picture(extra) {
      if (!a || !a.thumb) return '<rect x="' + ax + '" y="' + ay + '" width="' + art.w + '" height="' + art.h + '" fill="#fff"' + (extra || '') + '/>';
      return '<image href="' + a.thumb + '" x="' + place.x + '" y="' + place.y + '" width="' + place.w + '" height="' + place.h + '" preserveAspectRatio="none"' + (extra || '') + '/>';
    }
    // fill: show what gets cut, faintly, outside the print
    if (art && mode === 'fill') {
      out.push('<g opacity="0.3">' + picture() + '</g>');
      if (art.w - pw > 0.5) {
        var cw = (art.w - pw) / 2;
        out.push('<rect x="' + (ox - cw) + '" y="' + oy + '" width="' + cw + '" height="' + ph + '" fill="url(#' + id + 'h)" opacity="0.75"/>');
        out.push('<rect x="' + (ox + pw) + '" y="' + oy + '" width="' + cw + '" height="' + ph + '" fill="url(#' + id + 'h)" opacity="0.75"/>');
      }
      if (art.h - ph > 0.5) {
        var chh = (art.h - ph) / 2;
        out.push('<rect x="' + ox + '" y="' + (oy - chh) + '" width="' + pw + '" height="' + chh + '" fill="url(#' + id + 'h)" opacity="0.75"/>');
        out.push('<rect x="' + ox + '" y="' + (oy + ph) + '" width="' + pw + '" height="' + chh + '" fill="url(#' + id + 'h)" opacity="0.75"/>');
      }
    }
    // board
    if (B) {
      var bad = P.w - B.w > 0.01 || P.h - B.h > 0.01;
      out.push('<rect x="' + ox + '" y="' + oy + '" width="' + B.w * k + '" height="' + B.h * k + '" fill="none" stroke="' + (bad ? '#A3341F' : '#1B2224') + '" stroke-width="1.5" stroke-dasharray="6 4"/>');
    }
    // print + artwork
    out.push('<rect x="' + ox + '" y="' + oy + '" width="' + pw + '" height="' + ph + '" fill="#fff"/>');
    if (art) {
      out.push('<g clip-path="url(#' + id + 'c)">' + picture() + '</g>');
      if (mode !== 'fill') {
        var bx = (pw - art.w) / 2, by = (ph - art.h) / 2;
        var bandText = function (vIn) { return esc(len(vIn).toUpperCase() + ' BLANK'); };
        if (by > 1) {
          out.push('<rect x="' + ox + '" y="' + oy + '" width="' + pw + '" height="' + by + '" fill="#E9E4D6"/><rect x="' + ox + '" y="' + (oy + ph - by) + '" width="' + pw + '" height="' + by + '" fill="#E9E4D6"/>');
          out.push('<line x1="' + ox + '" y1="' + (oy + by) + '" x2="' + (ox + pw) + '" y2="' + (oy + by) + '" stroke="#1B2224" stroke-dasharray="4 3"/><line x1="' + ox + '" y1="' + (oy + ph - by) + '" x2="' + (ox + pw) + '" y2="' + (oy + ph - by) + '" stroke="#1B2224" stroke-dasharray="4 3"/>');
          if (o.labels && by >= 14) {
            out.push('<text x="' + (ox + pw / 2) + '" y="' + (oy + by / 2 + 3.5) + '" font-size="10" text-anchor="middle" fill="#1B2224">' + bandText(m.bandY) + '</text>');
            out.push('<text x="' + (ox + pw / 2) + '" y="' + (oy + ph - by / 2 + 3.5) + '" font-size="10" text-anchor="middle" fill="#1B2224">' + bandText(m.bandY) + '</text>');
          }
        }
        if (bx > 1) {
          out.push('<rect x="' + ox + '" y="' + oy + '" width="' + bx + '" height="' + ph + '" fill="#E9E4D6"/><rect x="' + (ox + pw - bx) + '" y="' + oy + '" width="' + bx + '" height="' + ph + '" fill="#E9E4D6"/>');
          out.push('<line x1="' + (ox + bx) + '" y1="' + oy + '" x2="' + (ox + bx) + '" y2="' + (oy + ph) + '" stroke="#1B2224" stroke-dasharray="4 3"/><line x1="' + (ox + pw - bx) + '" y1="' + oy + '" x2="' + (ox + pw - bx) + '" y2="' + (oy + ph) + '" stroke="#1B2224" stroke-dasharray="4 3"/>');
          if (o.labels && bx >= 14) {
            out.push('<text transform="translate(' + (ox + bx / 2 + 3.5) + ' ' + (oy + ph / 2) + ') rotate(-90)" font-size="10" text-anchor="middle" fill="#1B2224">' + bandText(m.bandX) + '</text>');
            out.push('<text transform="translate(' + (ox + pw - bx / 2 + 3.5) + ' ' + (oy + ph / 2) + ') rotate(-90)" font-size="10" text-anchor="middle" fill="#1B2224">' + bandText(m.bandX) + '</text>');
          }
        }
      }
      // marks on low-resolution pictures
      if (o.marks && m.imgs) {
        m.imgs.forEach(function (im) {
          if (im.level === 'ok') return;
          var col = im.level === 'fail' ? '#A3341F' : '#B4690E';
          var r = im.rect;
          var x = place.x + r.x * place.w, y = place.y + r.y * place.h, w = r.w * place.w, h = r.h * place.h;
          // keep marks inside the print
          var x0 = Math.max(x, ox), y0 = Math.max(y, oy), x1 = Math.min(x + w, ox + pw), y1 = Math.min(y + h, oy + ph);
          if (x1 - x0 < 2 || y1 - y0 < 2) return;
          out.push('<rect x="' + (x0 + 1) + '" y="' + (y0 + 1) + '" width="' + (x1 - x0 - 2) + '" height="' + (y1 - y0 - 2) + '" fill="none" stroke="' + col + '" stroke-width="2.5"/>');
          var lab = Math.round(im.ppi) + ' PPI', lw = lab.length * 6.3 + 8;
          var lx = Math.min(x0 + 1, ox + pw - lw), ly = y0 + 1;
          out.push('<rect x="' + lx + '" y="' + ly + '" width="' + lw + '" height="14" fill="' + col + '"/><text x="' + (lx + 4) + '" y="' + (ly + 10.5) + '" font-size="10" fill="#fff">' + lab + '</text>');
        });
      }
    } else {
      out.push('<text x="' + (ox + pw / 2) + '" y="' + (oy + ph / 2 + 4) + '" font-size="11" text-anchor="middle" fill="#5B6466">YOUR POSTER</text>');
    }
    out.push('<rect x="' + ox + '" y="' + oy + '" width="' + pw + '" height="' + ph + '" fill="none" stroke="#1B2224" stroke-width="1.6"/>');
    if (art && mode === 'fill' && o.labels) {
      if (m.cutX > 0.01 && (art.w - pw) / 2 >= 10) {
        out.push('<text transform="translate(' + (ox - (art.w - pw) / 4 + 3.5) + ' ' + (oy + ph / 2) + ') rotate(-90)" font-size="10" text-anchor="middle" fill="#8A2A18">' + esc(len(m.cutX).toUpperCase()) + ' CUT</text>');
        out.push('<text transform="translate(' + (ox + pw + (art.w - pw) / 4 + 3.5) + ' ' + (oy + ph / 2) + ') rotate(-90)" font-size="10" text-anchor="middle" fill="#8A2A18">' + esc(len(m.cutX).toUpperCase()) + ' CUT</text>');
      }
      if (m.cutY > 0.01 && (art.h - ph) / 2 >= 10) {
        out.push('<text x="' + (ox + pw / 2) + '" y="' + (oy - (art.h - ph) / 4 + 3.5) + '" font-size="10" text-anchor="middle" fill="#8A2A18">' + esc(len(m.cutY).toUpperCase()) + ' CUT</text>');
        out.push('<text x="' + (ox + pw / 2) + '" y="' + (oy + ph + (art.h - ph) / 4 + 3.5) + '" font-size="10" text-anchor="middle" fill="#8A2A18">' + esc(len(m.cutY).toUpperCase()) + ' CUT</text>');
      }
    }
    // the file at the same scale, with the arrow
    if (showFile) {
      var fx = padX, fy = oy + Math.max(0, (ph - fileH) / 2);
      out.push('<svg x="' + fx + '" y="' + fy + '" width="' + fileW + '" height="' + fileH + '" viewBox="0 0 ' + fileW + ' ' + fileH + '" preserveAspectRatio="none">');
      var tt = a.trim || { x: 0, y: 0, w: 1, h: 1 };
      if (a.thumb) out.push('<image href="' + a.thumb + '" x="' + (-tt.x * fileW / tt.w) + '" y="' + (-tt.y * fileH / tt.h) + '" width="' + fileW / tt.w + '" height="' + fileH / tt.h + '" preserveAspectRatio="none"/>');
      out.push('</svg>');
      out.push('<rect x="' + fx + '" y="' + fy + '" width="' + fileW + '" height="' + fileH + '" fill="none" stroke="#1B2224" stroke-width="1.2"/>');
      out.push('<text x="' + fx + '" y="' + (fy + fileH + 14) + '" font-size="10" fill="#1B2224">YOUR FILE</text>');
      out.push('<text x="' + fx + '" y="' + (fy + fileH + 27) + '" font-size="10" fill="#5B6466">' + esc(DIMS(F.w, F.h)) + '</text>');
      var axx = fx + fileW + 16, ayy = oy + ph / 2;
      out.push('<text x="' + (axx + 30) + '" y="' + (ayy - 10) + '" font-size="17" font-style="italic" font-family="IBM Plex Serif, Georgia, serif" text-anchor="middle" fill="#1B2224">×' + s.toFixed(2) + '</text>');
      out.push('<line x1="' + axx + '" y1="' + ayy + '" x2="' + (axx + 56) + '" y2="' + ayy + '" stroke="#1B2224" stroke-width="1.6" stroke-dasharray="4 3"/><path d="M' + (axx + 51) + ' ' + (ayy - 5) + 'l6 5-6 5" fill="none" stroke="#1B2224" stroke-width="1.6"/>');
    }
    out.push('</svg>');
    return out.join('');
  }

  /* the same picture on a canvas, for the checklist PDF */
  function diagramCanvas(m, maxW, maxH) {
    var P = m.P, a = m.a, s = m.s;
    var k = Math.min(maxW / P.w, maxH / P.h) * 3;   // 3× for print sharpness
    var W = Math.round(P.w * k), H = Math.round(P.h * k);
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    var aw = m.F.w * s * k, ah = m.F.h * s * k, ax = (W - aw) / 2, ay = (H - ah) / 2;
    if (a.thumbImg) {
      var t = a.trim, fw = aw / t.w, fh = ah / t.h;
      x.save(); x.beginPath(); x.rect(0, 0, W, H); x.clip();
      x.drawImage(a.thumbImg, ax - t.x * fw, ay - t.y * fh, fw, fh);
      x.restore();
    }
    if (m.mode !== 'fill') {
      x.fillStyle = '#ECE8DC';
      if (ay > 0.5) { x.fillRect(0, 0, W, ay); x.fillRect(0, H - ay, W, ay); }
      if (ax > 0.5) { x.fillRect(0, 0, ax, H); x.fillRect(W - ax, 0, ax, H); }
    }
    x.strokeStyle = '#1B2224'; x.lineWidth = 4; x.strokeRect(2, 2, W - 4, H - 4);
    return { url: c.toDataURL('image/jpeg', 0.9), w: W / 3, h: H / 3 };
  }

  /* =======================================================================
     Words for the print shop
     ======================================================================= */
  function headline(m) {
    var s = 'Print at ' + dims(m.P.w, m.P.h) + '. ';
    if (Math.abs(m.s - 1) < 0.01) return s + 'Print the file at 100% — it is already full size.';
    s += 'Scale the file to ' + pctStr(m.s) + ', proportionally';
    if (m.mode === 'fit') s += ' — fit, nothing cut.';
    else if (m.mode === 'fill') s += ' — fill, edges cut.';
    else s += '.';
    return s;
  }
  function trimSize(m) { return dims(m.fitOut.w, m.fitOut.h); }
  function bandWhere(m) { return m.bandY > m.bandX ? 'at the top and bottom' : 'on the left and right'; }
  function cutWhere(m) { return m.cutX > m.cutY ? 'the left and right edges' : 'the top and bottom edges'; }
  function cutAmount(m) { return Math.max(m.cutX, m.cutY); }
  function bandAmount(m) { return Math.max(m.bandX, m.bandY); }

  function emailText(m) {
    var F = m.F, P = m.P;
    var subj = 'Poster print — ' + dims(P.w, P.h) + (Math.abs(m.s - 1) < 0.01 ? '' : ', from a ' + dims(F.w, F.h) + ' file');
    var o = m.oP === 'square' ? 'square' : m.oP;
    var b = 'Hi,\n\nI’d like to print one poster at ' + dims(P.w, P.h) + ', ' + o + '. ';
    if (Math.abs(m.s - 1) < 0.01) b += 'The file is already full size, so please print it at 100%.';
    else {
      b += 'The file is ' + dims(F.w, F.h) + ' (' + ratioLabel(F.w, F.h) + '), so please scale it proportionally to ' + pctStr(m.s);
      if (m.mode === 'same') b += '.';
      else if (m.mode === 'fit') {
        b += ' so the whole poster fits. That leaves about ' + len(bandAmount(m)) + ' of white ' + bandWhere(m) + ' — ';
        b += state.bands === 'trim' ? 'please trim the print to ' + trimSize(m) + '.' : 'please keep it white.';
      } else {
        b += ' so it fills the whole sheet. About ' + len(cutAmount(m)) + ' will be cut from ' + cutWhere(m) + '; that’s expected.';
      }
    }
    b += '\n\nCould you confirm the paper and finish options, whether you need bleed, which file type and colour profile you prefer, and when it can be ready? I need it by [DATE].\n\nThanks,\n[YOUR NAME]';
    return { subject: subj, body: b };
  }

  /* =======================================================================
     Checklist PDF
     ======================================================================= */
  function pdfSafe(s) {
    return String(s).replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/→/g, '->').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/⧉|↗/g, '');
  }
  function downloadChecklist() {
    var m = compute();
    if (!m.F) return;
    var J = window.jspdf && window.jspdf.jsPDF;
    if (!J) { $('libError').hidden = false; return; }
    var a4 = cmMode();
    var doc = new J({ unit: 'pt', format: a4 ? 'a4' : 'letter', orientation: 'portrait', compress: true });
    var PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight();
    var L = 50, R = PW - 50, y = 52;
    var INK = [27, 34, 36], MUTED = [91, 100, 102];
    var COL = { pass: [31, 122, 69], warn: [122, 69, 8], fail: [138, 42, 24], info: [91, 100, 102] };
    function txt(s, x, yy, o) { doc.text(pdfSafe(s), x, yy, o || {}); }
    function font(style, size, col) { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor.apply(doc, col || INK); }

    font('bold', 10); txt('POSTER PRINT CHECKLIST', L, y);
    font('normal', 9); txt('CHECKED ' + todayISO() + ' · LABMATE.TOOLS', R, y, { align: 'right' });
    y += 8; doc.setDrawColor.apply(doc, INK); doc.setLineWidth(2.2); doc.line(L, y, R, y);
    y += 30;
    doc.setFont('times', 'bold'); doc.setFontSize(19); doc.setTextColor.apply(doc, INK);
    var hl = doc.splitTextToSize(pdfSafe(headline(m)), R - L);
    doc.text(hl, L, y); y += hl.length * 23 + 4;

    // spec table + drawing
    var diag = diagramCanvas(m, 170, 150);
    var tR = R - diag.w - 22, yTop = y;
    var src = current.src;
    var rows = [
      ['FILE', current.name + (src.count > 1 ? ' · ' + src.noun.toLowerCase() + ' ' + (current.index + 1) + ' of ' + src.count : '')],
      ['FILE SIZE', dims(m.F.w, m.F.h) + ' · ' + ratioLabel(m.F.w, m.F.h)],
      ['PRINT SIZE', dims(m.P.w, m.P.h) + ' · ' + ratioLabel(m.P.w, m.P.h)],
      ['SCALE', pctStr(m.s) + ' · proportional, do not stretch'],
      ['RESULT', m.mode === 'fit' ? trimSize(m) + ' printed · ' + len(bandAmount(m)) + ' blank ' + bandWhere(m) : m.mode === 'fill' ? 'fills the sheet · ' + len(cutAmount(m)) + ' cut from ' + cutWhere(m) : 'fills the sheet exactly'],
      ['BOARD LIMIT', m.B ? dims(m.B.w, m.B.h) + (m.boardBad ? ' · DOES NOT FIT' : ' · fits') : 'not given']
    ];
    doc.setLineWidth(0.8);
    doc.line(L, y - 13, tR, y - 13);
    rows.forEach(function (r) {
      font('normal', 9); txt(r[0], L, y);
      var v = doc.splitTextToSize(pdfSafe(r[1]), tR - L - 86);
      font(r[0] === 'SCALE' ? 'bold' : 'normal', 9.5); doc.text(v, L + 86, y);
      y += Math.max(1, v.length) * 12 + 8;
      doc.line(L, y - 13, tR, y - 13);
    });
    doc.addImage(diag.url, 'JPEG', R - diag.w, yTop - 12, diag.w, diag.h);
    font('normal', 8, MUTED); txt(m.mode === 'fill' ? 'FILL · TO SCALE' : m.mode === 'fit' ? 'FIT · TO SCALE' : 'TO SCALE', R - diag.w, yTop - 12 + diag.h + 11);
    y = Math.max(y, yTop + diag.h + 14) + 14;

    function bar(label) {
      doc.setFillColor.apply(doc, INK); doc.rect(L, y - 12, R - L, 18, 'F');
      font('bold', 9, [255, 255, 255]); txt(label, L + 8, y + 0.5);
      y += 22;
    }
    bar('CHECKED BY THE TOOL');
    m.checks.forEach(function (c) {
      var word = { pass: 'PASS', warn: 'CHECK', fail: 'FIX', info: 'NOTE' }[c.kind];
      font('bold', 9, COL[c.kind]); txt(word, L, y);
      font('normal', 9.5); txt(c.label.charAt(0) + c.label.slice(1).toLowerCase(), L + 52, y);
      font('normal', 8.5);
      var v = doc.splitTextToSize(pdfSafe(c.value), R - L - 230);
      doc.text(v, L + 230, y);
      y += Math.max(1, v.length) * 11.5 + 6;
      doc.setDrawColor(190, 194, 190); doc.setLineWidth(0.6); doc.line(L, y - 11, R, y - 11);
    });
    y += 10;

    bar('PLEASE CONFIRM WITH THE PRINT SHOP');
    var ask = [];
    ask.push(Math.abs(m.s - 1) < 0.01 ? 'Final size ' + dims(m.P.w, m.P.h) + ', printed at 100%.' : 'Final size ' + dims(m.P.w, m.P.h) + ', scaled ' + pctStr(m.s) + ' proportionally from ' + dims(m.F.w, m.F.h) + '.');
    if (m.mode === 'fit') ask.push('Blank bands: ' + (state.bands === 'trim' ? '[ ] keep them white   [x] trim the print to ' + trimSize(m) : '[x] keep them white   [ ] trim the print to ' + trimSize(m)));
    if (m.mode === 'fill') ask.push('About ' + len(cutAmount(m)) + ' is cut from ' + cutWhere(m) + ' — that is expected.');
    ask.push('Paper and finish: ______________________________');
    ask.push('Do they need bleed or a margin? ______________________');
    ask.push('Colour: preferred file type and colour profile ________________');
    ask.push('Ready by: ______________   Pickup or delivery: ______________');
    ask.forEach(function (q) {
      doc.setDrawColor.apply(doc, INK); doc.setLineWidth(1); doc.rect(L, y - 8.5, 9, 9);
      font('normal', 10); var v = doc.splitTextToSize(pdfSafe(q), R - L - 20);
      doc.text(v, L + 18, y);
      y += v.length * 12.5 + 7;
      doc.setDrawColor(190, 194, 190); doc.setLineWidth(0.6); doc.line(L, y - 11, R, y - 11);
    });
    y += 8;
    doc.setDrawColor.apply(doc, INK); doc.setLineWidth(1);
    var note = doc.splitTextToSize('Colour mode and profile, bleed, transparency and overprint, spelling. Ask the print shop for a proof if any of these matter.', R - L - 20);
    doc.rect(L, y - 12, R - L, 22 + note.length * 12);
    font('bold', 9); txt('NOT CHECKED BY THIS TOOL', L + 10, y + 1);
    font('normal', 10); doc.text(note, L + 10, y + 15);

    font('normal', 8.5, MUTED);
    doc.setDrawColor.apply(doc, INK); doc.setLineWidth(0.8); doc.line(L, PH - 44, R, PH - 44);
    txt('Made in the browser at labmate.tools. The poster file was not uploaded.', L, PH - 31);
    txt('P. 1 / 1', R, PH - 31, { align: 'right' });

    doc.setProperties({ title: 'Poster print checklist', creator: 'labmate.tools · Poster Check' });
    var base = current.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'poster';
    doc.save(base + '_print-checklist.pdf');
  }

  /* =======================================================================
     Rendering
     ======================================================================= */
  var ICON = {
    pass: '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="#2E9E5B"/><path d="M4.3 8.3l2.4 2.4 5-5" fill="none" stroke="#fff" stroke-width="2"/></svg>',
    warn: '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><rect x="0.75" y="0.75" width="14.5" height="14.5" fill="#FCEFD9" stroke="#B4690E" stroke-width="1.5"/><rect x="7" y="3.5" width="2" height="6" fill="#7A4508"/><rect x="7" y="11" width="2" height="2" fill="#7A4508"/></svg>',
    fail: '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" fill="#A3341F"/><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="#fff" stroke-width="2"/></svg>',
    info: '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.25" fill="none" stroke="#5B6466" stroke-width="1.5"/><rect x="7" y="7" width="2" height="5" fill="#5B6466"/><rect x="7" y="4" width="2" height="2" fill="#5B6466"/></svg>'
  };
  var WORD = { pass: 'PASS', warn: 'CHECK', fail: 'FIX', info: 'NOTE' };
  var emailEdited = false, lastEmail = null;

  function boxNoteText(a) {
    var b = a.boxNote || {};
    var rot = a.rot ? ' · ROTATED ' + a.rot + '°' : '';
    if (b.kind === 'trim-same') return 'TRIMBOX = MEDIABOX' + rot;
    if (b.kind === 'trim') return 'TRIMBOX ' + DIMS(a.w, a.h) + ' · ' + len(b.bleed).toUpperCase() + ' BLEED' + rot;
    if (b.kind === 'crop') return 'CROPBOX ' + DIMS(a.w, a.h) + ' · MEDIA ' + DIMS(b.media[0], b.media[1]) + rot;
    if (b.kind === 'media') return 'MEDIABOX ONLY · NO TRIMBOX' + rot;
    return 'PAGE SIZE ONLY' + rot;
  }

  function renderFileInfo() {
    var info = $('fileInfo');
    if (!current || !current.page) { info.hidden = true; $('kindBar').textContent = ''; return; }
    var a = current.page, src = current.src;
    info.hidden = false;
    $('kindBar').textContent = current.kind;
    $('fileName').textContent = current.name;
    $('fileMeta').textContent = (src.count + ' ' + src.noun + (src.count === 1 ? '' : 'S') + ' · ' + bytesStr(current.size)).toUpperCase();
    var pick = $('pagePick'), sel = $('pageSel');
    if (src.count > 1) {
      pick.hidden = false;
      $('pagePickLabel').textContent = src.noun + ' TO CHECK';
      if (sel.options.length !== src.count) {
        sel.innerHTML = '';
        for (var i = 0; i < src.count; i++) {
          var o = document.createElement('option'); o.value = i; o.textContent = src.noun + ' ' + (i + 1); sel.appendChild(o);
        }
      }
      sel.value = String(current.index);
    } else { pick.hidden = true; sel.innerHTML = ''; }

    var rows = [['FILE SIZE', DIMS(a.w, a.h) + ' · ' + ratioLabel(a.w, a.h)], ['ORIENTATION', orient(a.w, a.h).toUpperCase()]];
    if (current.kind === 'PDF') rows.push(['PAGE BOXES', boxNoteText(a)]);
    if (current.kind === 'PPTX') rows.push(['SLIDE SIZE', 'FROM PRESENTATION.XML']);
    if (a.boxNote && a.boxNote.kind === 'image') rows.push(['PIXELS', a.boxNote.px[0] + ' × ' + a.boxNote.px[1] + ' · ' + (a.boxNote.dpi ? Math.round(a.boxNote.dpi) + ' DPI STORED' : 'NO DPI STORED · 72 ASSUMED')]);
    var fo = a.fonts;
    if (fo && fo.kind === 'pdf') {
      var miss = fo.list.filter(function (f) { return f.embedded === false; }).length;
      rows.push(['FONTS', fo.list.length ? (fo.list.length - miss) + ' EMBEDDED · ' + miss + ' MISSING' : 'NO TEXT']);
    } else if (fo && fo.kind === 'pptx') {
      rows.push(['FONTS', (fo.faces.length ? fo.faces.slice(0, 3).join(', ').toUpperCase() + (fo.faces.length > 3 ? ' +' + (fo.faces.length - 3) : '') : 'TEMPLATE FONTS') + (fo.embedded.length ? ' · ' + fo.embedded.length + ' EMBEDDED' : '')]);
    }
    if (a.text && !a.text.none) rows.push(['TEXT IN FILE', 'SMALLEST ' + pt(a.text.min) + ' PT · MOSTLY ' + pt(a.text.body) + ' PT']);
    $('fileFacts').innerHTML = rows.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('');
  }

  function render() {
    $('drop').classList.toggle('busy', busy);
    Array.prototype.forEach.call(document.querySelectorAll('.u'), function (s) { s.textContent = cmMode() ? 'CM' : 'IN'; });
    $('unitIn').setAttribute('aria-pressed', String(!cmMode()));
    $('unitCm').setAttribute('aria-pressed', String(cmMode()));
    renderFileInfo();

    var m = compute();
    var v = $('verdict');
    if (!busy) {
      if (m.noPrint) {
        v.className = 'status empty';
        v.innerHTML = '<div class="status-title">ENTER A PRINT SIZE</div><p class="sans">Fill in the print width and height in step 02.</p>';
      } else if (!m.F) {
        v.className = 'status empty';
        v.innerHTML = '<div class="status-title">NO FILE YET</div><p class="sans">Drop your poster file in step 01 — or try a sample.</p>';
      } else {
        var vd = m.verdict;
        var mark = vd.kind === 'pass' ? ICON.pass : vd.kind === 'warn' ? '!' : '×';
        v.className = 'status ' + vd.kind;
        v.innerHTML = '<div class="status-title">' + (vd.kind === 'pass' ? mark : '<span aria-hidden="true">' + mark + '</span>') + '<span>' + esc(vd.title) + '</span></div><p class="sans">' + esc(vd.text) + '</p>' +
          (vd.act ? '<button type="button" class="act" data-act="' + vd.act + '">' + esc(vd.actText) + '</button>' : '');
      }
    }

    // preview
    if (m.noPrint) {
      $('stage').innerHTML = '';
      $('legend').innerHTML = '';
      $('previewTitle').textContent = 'PREVIEW';
      $('previewMode').textContent = '';
    } else {
      $('stage').innerHTML = stageSVG(m, { W: 460, H: 380, file: true, marks: true, board: true, labels: true });
      var lg = '<span>━ PRINT ' + esc(DIMS(m.P.w, m.P.h)) + '</span>';
      if (m.B) {
        lg += '<span' + (m.boardBad ? ' class="bad"' : '') + '>┅ BOARD LIMIT ' + esc(DIMS(m.B.w, m.B.h)) + '</span>';
        if (!m.boardBad) lg += '<span>BOARD SPARE ' + esc(num(Math.max(0, m.B.w - m.P.w)) + ' × ' + num(Math.max(0, m.B.h - m.P.h)) + ' ' + u()).toUpperCase() + '</span>';
      }
      if (m.F && m.mode === 'fill') lg += '<span class="bad">▨ CUT OFF</span>';
      if (m.F && m.mode === 'fit' && (m.bandX > 0.01 || m.bandY > 0.01)) lg += '<span>▭ BLANK</span>';
      $('legend').innerHTML = lg;
      if (m.F) {
        $('previewTitle').textContent = 'PREVIEW · SCALE ×' + m.s.toFixed(2) + ' · ' + pctStr(m.s);
        $('previewMode').textContent = m.mode === 'same' ? 'SAME SHAPE · NOTHING CUT' : m.mode === 'fit' ? 'FIT · NOTHING CUT' : 'FILL · EDGES CUT';
      } else {
        $('previewTitle').textContent = 'PREVIEW · PRINT AND BOARD';
        $('previewMode').textContent = 'TO SCALE';
      }
    }

    // fit / fill choice
    var choice = $('choice');
    if (m.F && !m.sameShape) {
      choice.hidden = false;
      var fit = m.mode === 'fit';
      $('pickFit').setAttribute('aria-pressed', String(fit));
      $('pickFill').setAttribute('aria-pressed', String(!fit));
      $('fitTitle').textContent = (fit ? '● ' : '○ ') + 'FIT — SCALE ×' + m.sFit.toFixed(2);
      $('fillTitle').textContent = (!fit ? '● ' : '○ ') + 'FILL — SCALE ×' + m.sFill.toFixed(2);
      $('fitPic').innerHTML = stageSVG(m, { W: 240, H: 170, mode: 'fit', labels: false });
      $('fillPic').innerHTML = stageSVG(m, { W: 240, H: 170, mode: 'fill', labels: false });
      $('fitText').textContent = 'Nothing is cut. Prints ' + trimSize(m) + ', with ' + len(bandAmount(m)) + ' blank ' + bandWhere(m) + ' — or ask them to trim it.';
      $('fillText').textContent = 'Fills the whole ' + dims(m.P.w, m.P.h) + ', but ' + len(cutAmount(m)) + ' is cut off ' + cutWhere(m) + '. Check nothing important sits near them.';
      $('bandsRow').hidden = !fit;
      $('bandsWhite').setAttribute('aria-pressed', String(state.bands !== 'trim'));
      $('bandsTrim').setAttribute('aria-pressed', String(state.bands === 'trim'));
      $('bandsTrim').textContent = 'TRIM TO ' + DIMS(m.fitOut.w, m.fitOut.h);
    } else choice.hidden = true;

    // checks
    $('checks').innerHTML = (m.F ? m.checks : []).map(function (c) {
      return '<li class="k-' + c.kind + '"><span>' + ICON[c.kind] + '</span><span class="lbl">' + esc(c.label) + '</span><span class="val">' + esc(c.value) + '</span><span class="word">' + WORD[c.kind] + '</span></li>';
    }).join('');

    // lookup
    var want = Number(state.want);
    $('want').value = isFinite(want) && want > 0 ? String(state.want) : '';
    if (m.F) {
      $('setPt').textContent = want > 0 ? half(want / m.s) + ' pt' : '—';
      $('lookupScale').textContent = 'AT ×' + m.s.toFixed(2);
      $('lookupHint').textContent = 'Rule of thumb only. If the conference gives its own sizes, use those.';
    } else {
      $('setPt').textContent = '—';
      $('lookupScale').textContent = '';
      $('lookupHint').textContent = 'Load your file in step 01 to work out the scale.';
    }
    $('guideBody').innerHTML = GUIDE.map(function (g) {
      return '<tr><td>' + g[0] + '</td><td>' + g[1] + ' pt</td><td>' + (m.F ? half(g[1] / m.s) + ' pt' : '—') + '</td></tr>';
    }).join('');

    // outputs
    var ready = !!m.F;
    $('downloadPdf').disabled = !ready;
    $('copyEmail').disabled = !ready;
    var link = $('mailLink');
    if (ready) {
      var e = emailText(m);
      lastEmail = e;
      if (!emailEdited) { $('emailSubject').value = e.subject; $('emailBody').value = e.body; }
      link.setAttribute('aria-disabled', 'false');
    } else {
      lastEmail = null;
      if (!emailEdited) { $('emailSubject').value = ''; $('emailBody').value = ''; }
      link.setAttribute('aria-disabled', 'true');
    }
    updateMailLink();
    $('resetEmail').hidden = !emailEdited;
  }

  function updateMailLink() {
    var link = $('mailLink');
    if (link.getAttribute('aria-disabled') === 'true') { link.setAttribute('href', '#'); return; }
    link.setAttribute('href', 'mailto:?subject=' + encodeURIComponent($('emailSubject').value) + '&body=' + encodeURIComponent($('emailBody').value));
  }

  /* =======================================================================
     Inputs
     ======================================================================= */
  function buildPresets() {
    var sel = $('preset'), groups = {};
    sel.innerHTML = '';
    PRESETS.forEach(function (p) {
      if (!groups[p.g]) { groups[p.g] = document.createElement('optgroup'); groups[p.g].label = p.g; sel.appendChild(groups[p.g]); }
      var o = document.createElement('option'); o.value = p.id; o.textContent = p.label; groups[p.g].appendChild(o);
    });
    var og = document.createElement('optgroup'); og.label = 'OTHER';
    var oc = document.createElement('option'); oc.value = 'custom'; oc.textContent = 'Custom — type the size below'; og.appendChild(oc);
    sel.appendChild(og);
  }
  function matchPreset() {
    for (var i = 0; i < PRESETS.length; i++) {
      var p = PRESETS[i];
      if (Math.abs(p.w - state.pw) < 0.02 && Math.abs(p.h - state.ph) < 0.02) return p.id;
    }
    return 'custom';
  }
  function showNum(vIn) { return okNum(vIn) ? num(vIn) : ''; }
  function syncInputs() {
    state.preset = matchPreset();
    $('preset').value = state.preset;
    ['pw', 'ph', 'bw', 'bh'].forEach(function (k) { if (document.activeElement !== $(k)) $(k).value = showNum(state[k]); });
  }

  function onSize(key) {
    var raw = $(key).value.trim();
    var v = raw === '' ? null : Number(raw);
    if (v != null && !(v > 0)) return;
    state[key] = v == null ? null : toIn(v);
    if (key === 'pw' || key === 'ph') { state.preset = matchPreset(); $('preset').value = state.preset; }
    save(); render();
  }

  function bind() {
    buildPresets();
    syncInputs();

    $('fileInput').addEventListener('change', function (e) { handleFile(e.target.files && e.target.files[0]); e.target.value = ''; });
    var drop = $('drop'), depth = 0;
    document.addEventListener('dragenter', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { depth++; document.body.classList.add('dragging'); } });
    document.addEventListener('dragleave', function () { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging'); });
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault(); depth = 0; document.body.classList.remove('dragging');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
    drop.addEventListener('dragover', function () { drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function () { drop.classList.remove('over'); });

    Array.prototype.forEach.call(document.querySelectorAll('[data-sample]'), function (b) {
      b.addEventListener('click', function () { runSample(b.getAttribute('data-sample')); });
    });
    $('pageSel').addEventListener('change', function (e) { if (current) selectPage(Number(e.target.value)); });

    $('unitIn').addEventListener('click', function () { state.unit = 'in'; save(); syncInputs(); render(); });
    $('unitCm').addEventListener('click', function () { state.unit = 'cm'; save(); syncInputs(); render(); });
    $('preset').addEventListener('change', function (e) {
      var p = PRESETS.filter(function (x) { return x.id === e.target.value; })[0];
      if (p) { state.pw = p.w; state.ph = p.h; state.preset = p.id; save(); syncInputs(); render(); }
      else { state.preset = 'custom'; $('pw').focus(); }
    });
    ['pw', 'ph', 'bw', 'bh'].forEach(function (k) {
      $(k).addEventListener('input', function () { onSize(k); });
      $(k).addEventListener('blur', function () { syncInputs(); });
    });
    $('want').addEventListener('input', function (e) {
      var v = Number(e.target.value);
      if (v > 0) { state.want = v; save(); }
      var m = compute();
      $('setPt').textContent = m.F && v > 0 ? half(v / m.s) + ' pt' : '—';
    });
    $('pickFit').addEventListener('click', function () { state.fit = 'fit'; save(); render(); });
    $('pickFill').addEventListener('click', function () { state.fit = 'fill'; save(); render(); });
    $('bandsWhite').addEventListener('click', function () { state.bands = 'white'; save(); render(); });
    $('bandsTrim').addEventListener('click', function () { state.bands = 'trim'; save(); render(); });

    $('verdict').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var m = compute();
      if (b.getAttribute('data-act') === 'swap') { var t = state.pw; state.pw = state.ph; state.ph = t; }
      if (b.getAttribute('data-act') === 'board' && m.boardSuggest) { state.pw = m.boardSuggest.w; state.ph = m.boardSuggest.h; }
      save(); syncInputs(); render();
    });

    $('downloadPdf').addEventListener('click', function () {
      try { downloadChecklist(); } catch (err) { console.error(err); $('libError').hidden = false; }
    });
    function onEmailEdit() {
      emailEdited = !!lastEmail && ($('emailSubject').value !== lastEmail.subject || $('emailBody').value !== lastEmail.body);
      $('resetEmail').hidden = !emailEdited;
      updateMailLink();
    }
    $('emailSubject').addEventListener('input', onEmailEdit);
    $('emailBody').addEventListener('input', onEmailEdit);
    $('resetEmail').addEventListener('click', function () { emailEdited = false; render(); });
    $('copyEmail').addEventListener('click', function () {
      var btn = $('copyEmail'), text = $('emailBody').value;
      function done(ok) {
        btn.firstChild.nodeValue = ok ? 'COPIED ' : 'SELECT AND COPY ';
        setTimeout(function () { btn.firstChild.nodeValue = 'COPY MESSAGE '; }, 1600);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
      else fallback();
      function fallback() {
        var ta = $('emailBody'); ta.focus(); ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        done(ok);
      }
    });
    $('mailLink').addEventListener('click', function (e) { if (this.getAttribute('aria-disabled') === 'true') e.preventDefault(); });

    if (!(window.jspdf && window.jspdf.jsPDF)) $('libError').hidden = false;
    render();
  }

  bind();
})();
