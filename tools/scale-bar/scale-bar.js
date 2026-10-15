/* labmate.tools · Scale Bar Maker (8.1)
   Opens microscope images in the browser, draws the same, correctly sized
   scale bar on each, and exports copies at the original pixel size plus a
   CSV record of the calibration. Nothing is uploaded. Presets and style
   (not images) are kept in localStorage. No libraries: the TIFF reader and
   the ZIP writer are below. */
(function () {
  'use strict';

  var STORE_KEY = 'labmate.scaleBar.v1';
  var UM = { nm: 0.001, um: 1, mm: 1000 };            // unit → µm
  var ULAB = { nm: 'nm', um: 'µm', mm: 'mm' };
  var PREVIEW_MAX = 1600;                             // preview canvas long side, px
  var LUM_MAX = 480;                                  // contrast map long side, px
  var MAX_MP_SAFE = 16777216;                         // iPad Safari canvas limit, px
  var AUTO_FRACTION = 0.2;                            // AUTO bar ≤ 20% of the narrowest field
  var ROUND_WARN = 0.01;                              // flag rounding error above 1%
  var FILE_MATCH = 0.01;                              // file scale "matches" within 1%

  function $(id) { return document.getElementById(id); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function ok(v) { return typeof v === 'number' && isFinite(v) && v > 0; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function userError(msg) { var e = new Error(msg); e.user = true; return e; }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function trim0(s) { return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s; }
  function sig(v, n) { // n significant figures, no trailing zeros
    if (!isFinite(v)) return '—';
    if (v === 0) return '0';
    var d = Math.max(0, n - 1 - Math.floor(Math.log10(Math.abs(v))));
    return trim0(v.toFixed(Math.min(d, 10)));
  }
  function fix(v, d) { return trim0(v.toFixed(d)); }
  function fmtUmpp(v) { return sig(v, 5); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function mpx(w, h) { return (w * h / 1e6).toFixed(1) + ' MP'; }
  function bytes(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  /* ===================================================================
     state
     =================================================================== */
  var defaults = {
    v: 1,
    presets: [],
    cal: { method: 'value', value: null, unit: 'umpp', presetId: '', linePx: null, known: 100, knownUnit: 'um', lockH: true,
      cam: { pix: 6.5, bin: 1, obj: 20, extra: 1 } },
    style: { lenMode: 'auto', len: 50, unit: 'um', corner: 'br', color: '#FFFFFF', custom: '#FFD400', label: 'above',
      font: 'arial', bold: true, box: 'none', halo: false, thick: 1.2, fontSize: 4, margin: 4 },
    out: { fmt: 'png', suffix: '_scalebar', hb: 'minmax' }
  };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var S = clone(defaults);
  var canStore = true;
  try {
    var raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      var saved = JSON.parse(raw);
      if (saved && saved.v === 1) {
        S.presets = Array.isArray(saved.presets) ? saved.presets.filter(function (p) { return p && ok(p.umpp) && p.name; }) : [];
        S.cal = Object.assign(clone(defaults.cal), saved.cal || {});
        S.cal.cam = Object.assign(clone(defaults.cal.cam), (saved.cal && saved.cal.cam) || {});
        S.style = Object.assign(clone(defaults.style), saved.style || {});
        S.out = Object.assign(clone(defaults.out), saved.out || {});
      }
    }
  } catch (e) { canStore = false; }
  if (['value', 'measure', 'camera'].indexOf(S.cal.method) < 0) S.cal.method = 'value';
  if (!UM[S.style.unit]) S.style.unit = 'um';
  function save() {
    if (!canStore) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, presets: S.presets, cal: S.cal, style: S.style, out: S.out })); }
    catch (e) { canStore = false; }
  }

  var images = [];      // loaded images, in order
  var sel = -1;         // index of the selected image
  var measure = null;   // { imgId, x1, y1, x2, y2 } in full-resolution pixels
  var busy = false;     // exporting

  /* ===================================================================
     TIFF reader — baseline strips: 1/8/16/32-bit, grey / RGB / palette,
     uncompressed, LZW, PackBits, Deflate; first page.
     =================================================================== */
  var TSIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

  function tiffInfo(buf) {
    if (buf.byteLength < 8) throw userError('This file is too short to be a TIFF.');
    var dv = new DataView(buf);
    var bo = dv.getUint16(0, false);
    var le = bo === 0x4949;
    if (!le && bo !== 0x4D4D) throw userError('This file is not a TIFF.');
    var magic = dv.getUint16(2, le);
    if (magic === 43) throw userError('BigTIFF files are not supported. In Fiji, save as a normal TIFF or export PNG.');
    if (magic !== 42) throw userError('This file is not a TIFF.');
    var len = buf.byteLength;
    function u16(o) { return dv.getUint16(o, le); }
    function u32(o) { return dv.getUint32(o, le); }
    function val(type, o) {
      switch (type) {
        case 1: case 7: return dv.getUint8(o);
        case 6: return dv.getInt8(o);
        case 3: return dv.getUint16(o, le);
        case 8: return dv.getInt16(o, le);
        case 4: case 13: return dv.getUint32(o, le);
        case 9: return dv.getInt32(o, le);
        case 5: { var d = dv.getUint32(o + 4, le); return d ? dv.getUint32(o, le) / d : 0; }
        case 10: { var d2 = dv.getInt32(o + 4, le); return d2 ? dv.getInt32(o, le) / d2 : 0; }
        case 11: return dv.getFloat32(o, le);
        case 12: return dv.getFloat64(o, le);
      }
      return 0;
    }
    function readIFD(off) {
      if (off + 2 > len) throw userError('This TIFF file is damaged.');
      var n = u16(off), tags = {};
      for (var i = 0; i < n; i++) {
        var e = off + 2 + i * 12;
        if (e + 12 > len) break;
        var tag = u16(e), type = u16(e + 2), cnt = u32(e + 4), sz = TSIZE[type] || 1, total = sz * cnt;
        var vo = total <= 4 ? e + 8 : u32(e + 8);
        if (vo + total > len || cnt > 5e7) continue;
        if (type === 2) {
          var b = new Uint8Array(buf, vo, cnt), s;
          try { s = new TextDecoder('utf-8', { fatal: true }).decode(b); }
          catch (x) { s = ''; for (var k = 0; k < b.length; k++) s += String.fromCharCode(b[k]); }
          tags[tag] = s.replace(/\0+$/, '');
        } else {
          var arr = new Array(cnt);
          for (var j = 0; j < cnt; j++) arr[j] = val(type, vo + j * sz);
          tags[tag] = arr;
        }
      }
      var nx = off + 2 + n * 12;
      return { tags: tags, next: nx + 4 <= len ? u32(nx) : 0 };
    }
    var first = readIFD(u32(4));
    var pages = 1, off = first.next, seen = {};
    while (off && off + 2 <= len && pages < 100000 && !seen[off]) {
      seen[off] = 1;
      var n = u16(off);
      if (off + 6 + n * 12 > len) break;
      off = u32(off + 2 + n * 12);
      pages++;
    }
    return { dv: dv, le: le, tags: first.tags, pages: pages };
  }

  function packbits(src, outLen) {
    var out = new Uint8Array(outLen), i = 0, o = 0;
    while (i < src.length && o < outLen) {
      var n = src[i++];
      if (n > 127) n -= 256;
      if (n >= 0) { for (var k = 0; k <= n && o < outLen && i < src.length; k++) out[o++] = src[i++]; }
      else if (n !== -128) { var v = src[i++]; for (var r = 0; r < 1 - n && o < outLen; r++) out[o++] = v; }
    }
    return out;
  }

  function lzw(src, outLen) {
    var out = new Uint8Array(outLen), o = 0;
    var dict = new Array(4096), dlen = 258, width = 9, bit = 0, bits = src.length * 8, old = null;
    for (var i = 0; i < 256; i++) dict[i] = new Uint8Array([i]);
    function read() {
      if (bit + width > bits) return 257;
      var b = bit >> 3, s = bit & 7;
      var v = ((src[b] << 16) | ((src[b + 1] || 0) << 8) | (src[b + 2] || 0)) >>> 0;
      bit += width;
      return (v >>> (24 - s - width)) & ((1 << width) - 1);
    }
    function put(e) { var n = Math.min(e.length, outLen - o); if (n > 0) { out.set(n === e.length ? e : e.subarray(0, n), o); o += n; } }
    function join(a, c) { var r = new Uint8Array(a.length + 1); r.set(a); r[a.length] = c; return r; }
    while (o < outLen) {
      var code = read();
      if (code === 257) break;
      if (code === 256) {
        dlen = 258; width = 9;
        code = read();
        if (code === 257) break;
        if (code > 255) break;
        put(dict[code]); old = dict[code];
        continue;
      }
      var entry;
      if (code < dlen) {
        entry = dict[code];
        if (old && dlen < 4096) dict[dlen++] = join(old, entry[0]);
      } else if (old) {
        entry = join(old, old[0]);
        if (dlen < 4096) dict[dlen++] = entry;
      } else break;
      put(entry);
      old = entry;
      if (dlen + 1 >= (1 << width) && width < 12) width++;
    }
    return out;
  }

  function inflate(src) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(userError('This browser can’t read Deflate-compressed TIFFs. Try a current Chrome, Edge, Firefox or Safari, or save the TIFF uncompressed.'));
    }
    var stream = new Blob([src]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  function decompress(comp, src, expect) {
    if (comp === 1) return Promise.resolve(src.slice(0, expect));
    if (comp === 32773) return Promise.resolve(packbits(src, expect));
    if (comp === 5) return Promise.resolve(lzw(src, expect));
    if (comp === 8 || comp === 32946) return inflate(src);
    if (comp === 7 || comp === 6) return Promise.reject(userError('JPEG-compressed TIFFs are not supported. Save the image uncompressed or as PNG.'));
    return Promise.reject(userError('This TIFF uses compression type ' + comp + ', which isn’t supported. Save it uncompressed or as PNG.'));
  }

  function unpredict(row, w, spp, bits, le) {
    if (bits === 8) {
      for (var i = spp; i < w * spp; i++) row[i] = (row[i] + row[i - spp]) & 255;
    } else if (bits === 16) {
      var dv = new DataView(row.buffer, row.byteOffset, row.byteLength);
      for (var j = spp; j < w * spp; j++) dv.setUint16(j * 2, (dv.getUint16(j * 2, le) + dv.getUint16((j - spp) * 2, le)) & 0xFFFF, le);
    } else if (bits === 32) {
      var dv3 = new DataView(row.buffer, row.byteOffset, row.byteLength);
      for (var k = spp; k < w * spp; k++) dv3.setUint32(k * 4, (dv3.getUint32(k * 4, le) + dv3.getUint32((k - spp) * 4, le)) >>> 0, le);
    }
  }

  function unitToUm(u) {
    if (!u) return null;
    var s = String(u).trim().replace(/\\u00[bB]5/g, 'µ').toLowerCase();
    if (/^(micron|microns|micrometer|micrometre|micrometers|micrometres|um|µm|μm|µm)$/.test(s)) return 1;
    if (/^(nm|nanometer|nanometre|nanometers|nanometres)$/.test(s)) return 0.001;
    if (/^(mm|millimeter|millimetre|millimeters|millimetres)$/.test(s)) return 1000;
    if (/^(cm|centimeter|centimetre)$/.test(s)) return 10000;
    if (/^(m|meter|metre)$/.test(s)) return 1e6;
    if (/^(inch|inches|in)$/.test(s)) return 25400;
    return null;
  }

  // scale saved in the TIFF: ImageJ/Fiji, OME-TIFF, or a centimetre resolution tag
  function tiffCal(t) {
    var desc = typeof t[270] === 'string' ? t[270] : '';
    var xres = t[282] ? t[282][0] : null, yres = t[283] ? t[283][0] : null;
    var runit = t[296] ? t[296][0] : 2;
    var c = null;
    if (/^ImageJ=/.test(desc)) {
      var m = /(?:^|\n)unit=([^\n\r]+)/.exec(desc);
      var f = m ? unitToUm(m[1]) : null;
      if (f && ok(xres)) c = { umpp: f / xres, label: 'ImageJ / Fiji TIFF', unit: m[1].trim() };
    }
    if (!c && /PhysicalSizeX\s*=\s*"/.test(desc)) {
      var mx = /PhysicalSizeX\s*=\s*"([\d.eE+\-]+)"/.exec(desc);
      var mu = /PhysicalSizeXUnit\s*=\s*"([^"]+)"/.exec(desc);
      var fu = mu ? unitToUm(mu[1]) : 1;
      var v = mx ? parseFloat(mx[1]) : NaN;
      if (fu && ok(v)) c = { umpp: v * fu, label: 'OME-TIFF PhysicalSizeX' };
    }
    if (!c && ok(xres) && runit === 3) {
      var u = 10000 / xres;
      if (u <= 20) c = { umpp: u, label: 'TIFF resolution tag (per cm)' };
    }
    if (!c && ok(xres) && runit === 2) {
      var ui = 25400 / xres;
      if (ui <= 5) c = { umpp: ui, label: 'TIFF resolution tag (per inch)' };
    }
    if (c && ok(xres) && ok(yres) && Math.abs(xres - yres) / xres > 0.001) c.aniso = true;
    return c;
  }

  function decodeTiff(buf, hb) {
    var info = tiffInfo(buf), t = info.tags, le = info.le;
    if (!t[256] || !t[257]) return Promise.reject(userError('This TIFF has no image size.'));
    var w = t[256][0], h = t[257][0];
    if (t[322] || t[324]) return Promise.reject(userError('Tiled TIFFs are not supported. In Fiji use File › Save As › Tiff, or export PNG.'));
    var bits = (t[258] || [1])[0], spp = (t[277] || [1])[0], comp = (t[259] || [1])[0];
    var photo = t[262] ? t[262][0] : 1, planar = (t[284] || [1])[0], pred = (t[317] || [1])[0], sfmt = (t[339] || [1])[0];
    if ([1, 8, 16, 32].indexOf(bits) < 0) return Promise.reject(userError(bits + '-bit TIFFs are not supported.'));
    if (photo > 3) return Promise.reject(userError('This TIFF’s colour type (' + photo + ') isn’t supported. Save it as RGB or greyscale.'));
    if (pred === 3) return Promise.reject(userError('Floating-point predictor TIFFs are not supported. Save without compression.'));
    if (w * h > 268435456) return Promise.reject(userError('This image is too large to open in a browser.'));
    var offs = t[273], cnts = t[279];
    if (!offs) return Promise.reject(userError('This TIFF has no image data.'));
    var rps = Math.min(h, (t[278] || [h])[0] || h);
    var planes = planar === 2 ? spp : 1, pspp = planar === 2 ? 1 : spp;
    var rowBytes = bits === 1 ? Math.ceil(w * pspp / 8) : w * pspp * bits / 8;
    var planeBytes = rowBytes * h;
    var rawB = new Uint8Array(planeBytes * planes);
    var spPlane = Math.ceil(h / rps);
    var chain = Promise.resolve();
    offs.forEach(function (o, i) {
      chain = chain.then(function () {
        var plane = Math.floor(i / spPlane), s = i % spPlane;
        if (plane >= planes) return;
        var rows = Math.min(rps, h - s * rps);
        if (rows <= 0) return;
        var expect = rows * rowBytes;
        var avail = buf.byteLength - o;
        if (avail <= 0) return;
        var src = new Uint8Array(buf, o, Math.min(cnts && cnts[i] ? cnts[i] : expect, avail));
        return decompress(comp, src, expect).then(function (d) {
          if (pred === 2 && bits >= 8) for (var r = 0; r < rows; r++) unpredict(d.subarray(r * rowBytes, (r + 1) * rowBytes), w, pspp, bits, le);
          rawB.set(d.length > expect ? d.subarray(0, expect) : d, plane * planeBytes + s * rps * rowBytes);
        });
      });
    });
    return chain.then(function () {
      var n = w * h * pspp * planes;
      var vals, dv = new DataView(rawB.buffer);
      if (bits === 8) vals = rawB;
      else if (bits === 16) { vals = new Uint16Array(n); for (var i = 0; i < n; i++) vals[i] = dv.getUint16(i * 2, le); }
      else if (bits === 32) {
        vals = sfmt === 3 ? new Float32Array(n) : new Float64Array(n);
        for (var j = 0; j < n; j++) vals[j] = sfmt === 3 ? dv.getFloat32(j * 4, le) : (sfmt === 2 ? dv.getInt32(j * 4, le) : dv.getUint32(j * 4, le));
      } else { // 1-bit: unpack rows
        vals = new Uint8Array(w * h * pspp * planes);
        for (var p = 0; p < planes; p++) for (var y = 0; y < h; y++) for (var x = 0; x < w * pspp; x++) {
          var byte = rawB[p * planeBytes + y * rowBytes + (x >> 3)];
          vals[p * w * h * pspp + y * w * pspp + x] = (byte >> (7 - (x & 7))) & 1;
        }
      }
      var rgb = photo === 2 && spp >= 3;
      var chans = rgb ? 3 : 1;
      function at(px, c) { return planar === 2 ? vals[c * w * h + px] : vals[px * spp + c]; }
      // display range
      var lo = 0, hi = 255, note = '';
      if (bits === 1) { lo = 0; hi = 1; }
      else if (bits > 8 && photo !== 3) {
        if (hb === 'full' && sfmt !== 3) { lo = sfmt === 2 ? -2147483648 : 0; hi = bits === 16 ? 65535 : 4294967295; if (sfmt === 2) hi = 2147483647; note = 'FULL RANGE'; }
        else {
          lo = Infinity; hi = -Infinity;
          for (var q = 0, np = w * h; q < np; q++) for (var cc = 0; cc < chans; cc++) {
            var v = at(q, cc);
            if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; }
          }
          if (!isFinite(lo)) { lo = 0; hi = 1; }
          note = 'MIN–MAX ' + sig(lo, 5) + '–' + sig(hi, 5);
        }
      }
      var span = hi > lo ? hi - lo : 1;
      var rgba = new Uint8ClampedArray(w * h * 4);
      var cmap = t[320], ncol = 1 << bits;
      for (var k = 0, N = w * h; k < N; k++) {
        var o4 = k * 4, r, g, b;
        if (photo === 3 && cmap) {
          var ix = at(k, 0);
          r = cmap[ix] >> 8; g = cmap[ncol + ix] >> 8; b = cmap[2 * ncol + ix] >> 8;
        } else if (rgb) {
          r = (at(k, 0) - lo) / span * 255; g = (at(k, 1) - lo) / span * 255; b = (at(k, 2) - lo) / span * 255;
        } else {
          var gv = (at(k, 0) - lo) / span * 255;
          if (photo === 0) gv = 255 - gv;
          r = g = b = gv;
        }
        rgba[o4] = r; rgba[o4 + 1] = g; rgba[o4 + 2] = b; rgba[o4 + 3] = 255;
      }
      var kind = (photo === 3 ? 'palette' : rgb ? 'RGB' : 'grey') + ' ' + bits + '-bit';
      return { w: w, h: h, rgba: rgba, bits: bits, kind: kind, pages: info.pages, cal: tiffCal(t), rangeNote: bits > 8 && photo !== 3 ? note : '',
        float: sfmt === 3, comp: comp };
    });
  }

  /* PNG header: bit depth and pHYs (pixels per metre) */
  function pngMeta(u8) {
    var sigOk = u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47;
    if (!sigOk) return null;
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), p = 8, meta = {};
    while (p + 8 <= u8.length) {
      var len = dv.getUint32(p), type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
      if (type === 'IHDR' && p + 17 <= u8.length) meta.bits = u8[p + 16];
      if (type === 'pHYs' && p + 17 <= u8.length) {
        var ppx = dv.getUint32(p + 8), ppy = dv.getUint32(p + 12), unit = u8[p + 16];
        if (unit === 1 && ppx > 0) {
          var umpp = 1e6 / ppx;
          if (umpp <= 20) meta.cal = { umpp: umpp, label: 'PNG pHYs', aniso: Math.abs(ppx - ppy) / ppx > 0.001 };
        }
      }
      if (type === 'IDAT' || type === 'IEND') break;
      p += 12 + len;
    }
    return meta;
  }

  /* ===================================================================
     ZIP writer (stored, no compression — images are already compressed)
     =================================================================== */
  var CRC_T = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  // entries: { name, blob, crc, size }
  function makeZip(entries) {
    var enc = new TextEncoder(), parts = [], cen = [], off = 0, cenSize = 0, d = new Date();
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    entries.forEach(function (e) {
      var nm = enc.encode(e.name);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, e.crc, true);
      h.setUint32(18, e.size, true); h.setUint32(22, e.size, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, nm, e.blob);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true); c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, e.crc, true);
      c.setUint32(20, e.size, true); c.setUint32(24, e.size, true); c.setUint16(28, nm.length, true);
      c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true);
      c.setUint32(38, 0, true); c.setUint32(42, off, true);
      cen.push(c.buffer, nm);
      cenSize += 46 + nm.length;
      off += 30 + nm.length + e.size;
    });
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cenSize, true); end.setUint32(16, off, true);
    return new Blob(parts.concat(cen, [end.buffer]), { type: 'application/zip' });
  }
  function blobEntry(name, blob) {
    return blob.arrayBuffer().then(function (ab) {
      var u8 = new Uint8Array(ab);
      return { name: name, blob: blob, crc: crc32(u8), size: u8.length };
    });
  }

  /* ===================================================================
     opening images
     =================================================================== */
  function kindOf(file) {
    var n = (file.name || '').toLowerCase(), t = file.type || '';
    if (/\.tiff?$/.test(n) || t === 'image/tiff') return 'tiff';
    if (/\.png$/.test(n) || t === 'image/png') return 'png';
    if (/\.jpe?g$/.test(n) || t === 'image/jpeg') return 'jpeg';
    if (/\.webp$/.test(n) || t === 'image/webp') return 'webp';
    if (/\.bmp$/.test(n) || t === 'image/bmp') return 'bmp';
    if (/\.(czi|nd2|lif|oib|oif|ims|lsm|vsi|sld|zvi|dv|ome\.zarr)$/.test(n)) return 'vendor';
    return t.indexOf('image/') === 0 ? 'other' : 'unknown';
  }

  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // full-resolution source for drawing; call done() when finished with it
  function decodeFull(img) {
    if (img.kind === 'tiff') {
      return img.file.arrayBuffer().then(function (buf) { return decodeTiff(buf, S.out.hb); }).then(function (t) {
        var c = makeCanvas(t.w, t.h);
        c.getContext('2d').putImageData(new ImageData(t.rgba, t.w, t.h), 0, 0);
        return { src: c, w: t.w, h: t.h, tiff: t, done: function () { c.width = 0; c.height = 0; } };
      });
    }
    if (window.createImageBitmap) {
      return createImageBitmap(img.file).then(function (bm) {
        return { src: bm, w: bm.width, h: bm.height, done: function () { if (bm.close) bm.close(); } };
      }, function () { return decodeWithImg(img.file); });
    }
    return decodeWithImg(img.file);
  }
  function decodeWithImg(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), el = new Image();
      el.onload = function () { res({ src: el, w: el.naturalWidth, h: el.naturalHeight, done: function () { URL.revokeObjectURL(url); } }); };
      el.onerror = function () { URL.revokeObjectURL(url); rej(userError('This browser couldn’t open the image.')); };
      el.src = url;
    });
  }

  function loadImage(img) {
    var head = img.kind === 'png' ? img.file.slice(0, 262144).arrayBuffer().then(function (ab) { return pngMeta(new Uint8Array(ab)); }) : Promise.resolve(null);
    return head.then(function (pm) {
      if (pm) { img.srcBits = pm.bits; if (pm.cal) img.fileCal = pm.cal; }
      return decodeFull(img);
    }).then(function (full) {
      img.w = full.w; img.h = full.h;
      if (full.tiff) {
        img.srcBits = full.tiff.bits; img.tiffKind = full.tiff.kind; img.pages = full.tiff.pages;
        img.rangeNote = full.tiff.rangeNote;
        if (full.tiff.cal) img.fileCal = full.tiff.cal;
      }
      var k = Math.min(1, PREVIEW_MAX / Math.max(img.w, img.h));
      var pv = makeCanvas(Math.max(1, Math.round(img.w * k)), Math.max(1, Math.round(img.h * k)));
      var pc = pv.getContext('2d');
      pc.imageSmoothingQuality = 'high';
      pc.drawImage(full.src, 0, 0, pv.width, pv.height);
      img.preview = pv; img.pk = pv.width / img.w;
      // luminance map for the contrast check
      var lk = Math.min(1, LUM_MAX / Math.max(img.w, img.h));
      var lc = makeCanvas(Math.max(1, Math.round(img.w * lk)), Math.max(1, Math.round(img.h * lk)));
      lc.getContext('2d').drawImage(pv, 0, 0, lc.width, lc.height);
      var d = lc.getContext('2d').getImageData(0, 0, lc.width, lc.height).data;
      var lum = new Uint8Array(lc.width * lc.height);
      for (var i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]) | 0;
      img.lum = lum; img.lw = lc.width; img.lh = lc.height; img.lk = lc.width / img.w;
      // thumbnail
      var tk = Math.min(1, 220 / Math.max(img.w, img.h));
      var th = makeCanvas(Math.max(1, Math.round(img.w * tk)), Math.max(1, Math.round(img.h * tk)));
      th.getContext('2d').drawImage(pv, 0, 0, th.width, th.height);
      img.thumb = th;
      full.done();
      img.status = 'ready';
    }).catch(function (e) {
      img.status = 'error';
      img.error = e && e.user ? e.message : 'This file couldn’t be opened' + (e && e.message ? ' (' + e.message + ')' : '') + '.';
    });
  }

  var loadQueue = Promise.resolve();
  function addFiles(list) {
    var files = Array.prototype.slice.call(list || []);
    if (!files.length) return loadQueue;
    $('fileError').hidden = true;
    var rejected = [];
    files.forEach(function (f) {
      var kind = kindOf(f);
      if (kind === 'vendor') { rejected.push(f.name + ' — vendor format; export TIFF or PNG first'); return; }
      if (kind === 'unknown') { rejected.push(f.name + ' — not an image'); return; }
      var img = { id: uid(), file: f, name: f.name || 'image', kind: kind, size: f.size, status: 'loading', use: 'batch', ownUmpp: null, pos: null };
      images.push(img);
      loadQueue = loadQueue.then(function () { return loadImage(img); }).then(function () {
        if (sel < 0) sel = images.indexOf(img);
        renderStripItem(img);
        refresh();
      });
    });
    if (rejected.length) {
      $('fileError').hidden = false;
      $('fileError').textContent = 'Skipped: ' + rejected.join('; ') + '.';
    }
    buildStrip();
    refresh();
    return loadQueue;
  }

  /* ===================================================================
     calibration
     =================================================================== */
  function presetById(id) { for (var i = 0; i < S.presets.length; i++) if (S.presets[i].id === id) return S.presets[i]; return null; }

  // the batch calibration: { umpp, src, detail, preset }
  function batchCal() {
    var c = S.cal, u = null, src = '', detail = '';
    if (c.method === 'value') {
      var v = num(c.value);
      if (ok(v)) {
        u = c.unit === 'nmpp' ? v / 1000 : c.unit === 'ppum' ? 1 / v : v;
        src = 'entered'; detail = 'entered: ' + sig(v, 6) + (c.unit === 'nmpp' ? ' nm/px' : c.unit === 'ppum' ? ' px/µm' : ' µm/px');
      }
    } else if (c.method === 'measure') {
      var L = num(c.known), px = num(c.linePx);
      if (ok(L) && ok(px)) {
        u = L * UM[c.knownUnit || 'um'] / px; src = 'measured';
        var on = measure && imgById(measure.imgId) ? ' on ' + imgById(measure.imgId).name : '';
        detail = 'measured: ' + fix(px, 2) + ' px = ' + sig(L, 6) + ' ' + ULAB[c.knownUnit || 'um'] + on;
      }
    } else if (c.method === 'camera') {
      var cm = c.cam, p = num(cm.pix), b = num(cm.bin) || 1, o = num(cm.obj), x = num(cm.extra) || 1;
      if (ok(p) && ok(o) && ok(b) && ok(x)) {
        u = p * b / (o * x); src = 'camera';
        detail = 'camera estimate: ' + sig(p, 4) + ' µm × ' + b + ' ÷ (' + sig(o, 4) + '× × ' + sig(x, 4) + '×)';
      }
    }
    if (!ok(u)) return null;
    var pr = presetById(c.presetId);
    if (pr && Math.abs(pr.umpp - u) / pr.umpp > 1e-9) pr = null;
    return { umpp: u, src: pr ? 'preset' : src, detail: pr ? 'preset: ' + pr.name : detail, preset: pr };
  }

  function calFor(img) {
    if (img.use === 'file' && img.fileCal) return { umpp: img.fileCal.umpp, src: 'file', detail: 'file: ' + img.fileCal.label };
    if (img.use === 'own') {
      return ok(img.ownUmpp) ? { umpp: img.ownUmpp, src: 'own', detail: img.ownPreset ? 'preset: ' + img.ownPreset : 'entered for this image' } : null;
    }
    return batchCal();
  }

  function imgById(id) { for (var i = 0; i < images.length; i++) if (images[i].id === id) return images[i]; return null; }
  function readyImages() { return images.filter(function (m) { return m.status === 'ready'; }); }

  /* ===================================================================
     bar length and geometry
     =================================================================== */
  function niceFloor(x) {
    if (!(x > 0)) return null;
    var p = Math.pow(10, Math.floor(Math.log10(x)));
    var m = x / p;
    var r = (m >= 5 - 1e-9 ? 5 : m >= 2 - 1e-9 ? 2 : 1) * p;
    return parseFloat(r.toPrecision(12));
  }
  function autoUnit(um) { return um < 1 ? 'nm' : um >= 1000 ? 'mm' : 'um'; }

  // the bar length shared by the batch, µm (and the unit it is labelled in)
  function barLength() {
    var st = S.style;
    if (st.lenMode === 'fixed') {
      var v = num(st.len);
      return ok(v) ? { um: v * UM[st.unit], unit: st.unit } : null;
    }
    var minField = Infinity;
    readyImages().forEach(function (m) { var c = calFor(m); if (c) minField = Math.min(minField, m.w * c.umpp); });
    if (!isFinite(minField)) return null;
    var um = niceFloor(minField * AUTO_FRACTION);
    return um ? { um: um, unit: autoUnit(um), field: minField } : null;
  }
  function labelFor(len) {
    var v = len.um / UM[len.unit];
    return sig(parseFloat(v.toPrecision(10)), 8) + ' ' + ULAB[len.unit];
  }

  var FONTS = {
    arial: 'Arial, "Helvetica Neue", Helvetica, "Liberation Sans", sans-serif',
    plex: '"IBM Plex Sans", Arial, Helvetica, sans-serif'
  };
  function fontStr(px) {
    var w = S.style.bold ? (S.style.font === 'plex' ? '600' : '700') : '400';
    return w + ' ' + px + 'px ' + (FONTS[S.style.font] || FONTS.arial);
  }
  var measureCtx = makeCanvas(4, 4).getContext('2d');
  function textBox(text, px) {
    measureCtx.font = fontStr(px);
    var m = measureCtx.measureText(text);
    var asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
    if (!(asc > 0)) asc = px * 0.72;
    if (!(desc >= 0)) desc = px * 0.2;
    // keep the box height the same whatever the digits are
    var ref = measureCtx.measureText('0123456789µ');
    if (ref.actualBoundingBoxAscent > 0) { asc = Math.max(asc, ref.actualBoundingBoxAscent); desc = Math.max(desc, ref.actualBoundingBoxDescent || 0); }
    return { w: m.width, asc: asc, desc: desc };
  }

  function barColor() { return S.style.color === 'custom' ? S.style.custom : S.style.color; }
  function hexLum(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 1;
    var n = parseInt(m[1], 16);
    return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255;
  }

  // everything in full-resolution pixels
  function geom(img) {
    var cal = calFor(img), len = barLength();
    if (!cal || !len || !img.w) return null;
    var st = S.style;
    var exact = len.um / cal.umpp;
    var px = Math.max(1, Math.round(exact));
    var side = Math.min(img.w, img.h);
    var thick = Math.max(1, Math.round(side * st.thick / 100));
    var fpx = Math.max(6, Math.round(side * st.fontSize / 100));
    var margin = Math.round(side * st.margin / 100);
    var label = st.label === 'none' ? '' : labelFor(len);
    var tb = label ? textBox(label, fpx) : { w: 0, asc: 0, desc: 0 };
    var gap = label ? Math.max(1, Math.round(fpx * 0.28)) : 0;
    var textH = label ? Math.ceil(tb.asc + tb.desc) : 0;
    var cw = Math.max(px, Math.ceil(tb.w)), ch = thick + (label ? gap + textH : 0);
    var pad = st.box === 'none' ? 0 : Math.max(2, Math.round((label ? fpx : thick * 2) * 0.35));
    var bw = cw + 2 * pad, bh = ch + 2 * pad;
    var bx, by;
    if (img.pos) {
      bx = Math.round(img.pos.fx * img.w); by = Math.round(img.pos.fy * img.h);
    } else {
      var c = st.corner || 'br';
      bx = c.charAt(1) === 'l' ? margin : img.w - margin - bw;
      by = c.charAt(0) === 't' ? margin : img.h - margin - bh;
    }
    var cx = bx + pad, cy = by + pad;
    // a label wider than the bar: the bar stays flush with the corner's side (centred once moved by hand)
    var barX = cx;
    if (cw > px) barX = img.pos ? cx + Math.round((cw - px) / 2) : (st.corner || 'br').charAt(1) === 'l' ? cx : cx + cw - px;
    var barY, base;
    if (st.label === 'below') { barY = cy; base = cy + thick + gap + tb.asc; }
    else { barY = cy + (label ? textH + gap : 0); base = cy + tb.asc; }
    var textX = barX + px / 2;
    // keep the label inside the block when it is wider than the bar
    if (label) {
      var half = tb.w / 2;
      textX = clamp(textX, cx + half, cx + cw - half);
    }
    return { cal: cal, len: len, exact: exact, px: px, err: Math.abs(px - exact) / exact, thick: thick, fpx: fpx, margin: margin,
      label: label, tw: tb.w, barX: barX, barY: barY, textX: textX, base: base, bx: bx, by: by, bw: bw, bh: bh, pad: pad };
  }

  function drawOverlay(ctx, g, k) {
    var st = S.style, col = barColor(), L = hexLum(col);
    var opp = L > 0.5 ? '#000000' : '#FFFFFF';
    ctx.save();
    if (st.box !== 'none') {
      ctx.fillStyle = st.box === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.75)';
      ctx.fillRect(g.bx * k, g.by * k, g.bw * k, g.bh * k);
    }
    var hw = Math.max(1, Math.round(Math.max(g.thick * 0.3, g.fpx * 0.06)));
    if (st.halo) {
      ctx.fillStyle = opp;
      ctx.fillRect((g.barX - hw) * k, (g.barY - hw) * k, (g.px + 2 * hw) * k, (g.thick + 2 * hw) * k);
    }
    ctx.fillStyle = col;
    ctx.fillRect(g.barX * k, g.barY * k, g.px * k, g.thick * k);
    if (g.label) {
      ctx.font = fontStr(g.fpx * k);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      if (st.halo) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = 2 * hw * k;
        ctx.strokeStyle = opp;
        ctx.strokeText(g.label, g.textX * k, g.base * k);
      }
      ctx.fillText(g.label, g.textX * k, g.base * k);
    }
    ctx.restore();
  }

  /* ===================================================================
     checks
     =================================================================== */
  var RANK = { pass: 0, info: 0, warn: 1, fail: 2 };
  function checksFor(img) {
    var out = [];
    function add(k, lbl, val, word) { out.push({ k: k, lbl: lbl, val: val, word: word || { pass: 'PASS', warn: 'CHECK', fail: 'FIX', info: 'NOTE' }[k] }); }
    if (img.status === 'error') { add('fail', 'FILE', img.error, 'FIX'); return out; }
    if (img.status !== 'ready') { add('info', 'FILE', 'Opening…', '…'); return out; }
    var cal = calFor(img);
    if (!cal) {
      add('fail', 'CALIBRATION', img.use === 'own' ? 'Enter the µm per pixel for this image.' : 'Not set — enter µm/px, measure a known length or pick a preset (step 02).', 'SET');
    } else {
      var k = cal.src === 'camera' ? 'warn' : 'pass';
      add(k, 'CALIBRATION', fmtUmpp(cal.umpp) + ' µm/px · ' + cal.detail + (cal.src === 'camera' ? ' — estimate, confirm with a stage micrometer' : ''), cal.src === 'camera' ? 'ESTIMATE' : 'PASS');
    }
    if (img.fileCal && cal && cal.src !== 'file') {
      var d = Math.abs(img.fileCal.umpp - cal.umpp) / cal.umpp;
      if (d <= FILE_MATCH) add('pass', 'SCALE IN FILE', 'Matches: ' + fmtUmpp(img.fileCal.umpp) + ' µm/px (' + img.fileCal.label + ')', 'MATCH');
      else add('warn', 'SCALE IN FILE', 'The file says ' + fmtUmpp(img.fileCal.umpp) + ' µm/px (' + img.fileCal.label + '), ' + (d * 100).toFixed(0) + '% different. Wrong preset, or the file’s value is stale?', 'DIFFERS');
    }
    if (img.fileCal && img.fileCal.aniso) add('warn', 'PIXEL SHAPE', 'X and Y resolution differ in the file; the bar is horizontal, so it uses X.', 'CHECK');
    if (cal && cal.src === 'preset' && cal.preset && cal.preset.w && cal.preset.h && (cal.preset.w !== img.w || cal.preset.h !== img.h)) {
      add('warn', 'IMAGE SIZE', img.w + ' × ' + img.h + ' px; the preset was saved for ' + cal.preset.w + ' × ' + cal.preset.h + ' px. Fine if cropped — wrong if resized or binned.', 'CHECK');
    }
    var g = geom(img);
    if (g) {
      var exactTxt = Math.abs(g.exact - Math.round(g.exact)) < 0.005 ? 'exact' : fix(g.exact, 2) + ' exact, ' + (g.err * 100).toFixed(g.err < 0.001 ? 2 : 1) + '% off';
      if (g.px < 10) add('warn', 'BAR LENGTH', g.label || labelFor(g.len), 'SHORT');
      if (g.err > ROUND_WARN) add('warn', 'BAR LENGTH', g.px + ' px for ' + labelFor(g.len) + ' (' + exactTxt + '). Pick a longer bar to cut the rounding error.', 'ROUNDING');
      else if (g.px >= 10) add('pass', 'BAR LENGTH', g.px + ' px = ' + labelFor(g.len) + ' (' + exactTxt + ')', 'PASS');
      else add('warn', 'BAR LENGTH', 'Only ' + g.px + ' px long — choose a longer bar.', 'SHORT');
      var frac = g.px / img.w;
      if (frac > 0.5) add('warn', 'BAR SIZE', 'The bar spans ' + Math.round(frac * 100) + '% of the image width.', 'LONG');
      var inside = g.bx >= 0 && g.by >= 0 && g.bx + g.bw <= img.w && g.by + g.bh <= img.h;
      if (!inside) add('fail', 'FITS', 'The bar or label runs off the image — use a shorter bar, smaller text or less margin.', 'FIX');
      else {
        var ct = contrast(img, g);
        if (ct) add(ct.k, 'CONTRAST', ct.msg, ct.word);
      }
    }
    if (img.rangeNote) add('info', 'BIT DEPTH', img.tiffKind + ' → 8-bit display copy (' + img.rangeNote + ')', 'NOTE');
    else if (img.kind === 'png' && img.srcBits === 16) add('info', 'BIT DEPTH', '16-bit PNG — the browser reads it as 8-bit; the copy is 8-bit.', 'NOTE');
    if (img.pages > 1) add('info', 'PAGES', 'Stack of ' + img.pages + ' pages — only the first is used.', 'NOTE');
    if (img.w * img.h > MAX_MP_SAFE) add('warn', 'SIZE', mpx(img.w, img.h) + ' — iPad and iPhone Safari can’t export images over 16.7 MP; use a computer.', 'LARGE');
    return out;
  }

  function contrast(img, g) {
    var st = S.style, Lbar = hexLum(barColor()) * 255;
    if (st.box !== 'none') {
      var Lbox = st.box === 'dark' ? 40 : 215; // 60% black / 75% white over the image, roughly
      if (Math.abs(Lbox - Lbar) < 100) return { k: 'warn', word: 'LOW', msg: 'The bar colour is close to the ' + st.box + ' background box — switch the colour or the box.' };
      return { k: 'pass', word: 'PASS', msg: 'Background box behind the bar.' };
    }
    if (st.halo) return { k: 'pass', word: 'PASS', msg: 'Outline around the bar and label.' };
    if (!img.lum) return null;
    var x0 = Math.floor(g.bx * img.lk), y0 = Math.floor(g.by * img.lk);
    var x1 = Math.ceil((g.bx + g.bw) * img.lk), y1 = Math.ceil((g.by + g.bh) * img.lk);
    x0 = clamp(x0, 0, img.lw - 1); x1 = clamp(x1, x0 + 1, img.lw); y0 = clamp(y0, 0, img.lh - 1); y1 = clamp(y1, y0 + 1, img.lh);
    var n = 0, close = 0;
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { n++; if (Math.abs(img.lum[y * img.lw + x] - Lbar) < 70) close++; }
    var f = n ? close / n : 0;
    if (f > 0.25) return { k: 'warn', word: 'LOW', msg: Math.round(f * 100) + '% of the area behind the bar is close to its colour — try ' + (Lbar > 127 ? 'BLACK' : 'WHITE') + ', a background box, an outline or another corner.' };
    return { k: 'pass', word: 'PASS', msg: 'Stands out from the image behind it.' };
  }

  function worst(list) {
    var k = 'pass';
    list.forEach(function (c) { if (RANK[c.k] > RANK[k]) k = c.k; });
    return k;
  }

  /* ===================================================================
     drawing the preview
     =================================================================== */
  var view = $('view'), vctx = view.getContext('2d');
  var dragging = null;

  function drawView() {
    var img = images[sel];
    var empty = !img || img.status !== 'ready';
    view.classList.toggle('is-empty', empty);
    $('stageEmpty').hidden = !!(img && img.status === 'ready');
    if (img && img.status === 'loading') $('stageEmpty').textContent = 'Opening ' + img.name + '…';
    else if (img && img.status === 'error') $('stageEmpty').textContent = img.error;
    else $('stageEmpty').textContent = 'Add images, or try the sample batch.';
    if (empty) { $('legend').innerHTML = ''; return; }
    if (view.width !== img.preview.width || view.height !== img.preview.height) { view.width = img.preview.width; view.height = img.preview.height; }
    vctx.clearRect(0, 0, view.width, view.height);
    vctx.drawImage(img.preview, 0, 0);
    var g = geom(img);
    var measuring = S.cal.method === 'measure';
    if (g) drawOverlay(vctx, g, img.pk);
    if (g && !measuring) {
      // dotted frame when the bar can be dragged
      vctx.save();
      vctx.setLineDash([4, 3]);
      vctx.lineWidth = Math.max(1, view.width / (view.getBoundingClientRect().width || view.width));
      vctx.strokeStyle = 'rgba(46,158,91,0.9)';
      if (dragging && dragging.type === 'bar') vctx.strokeRect(g.bx * img.pk - 2, g.by * img.pk - 2, g.bw * img.pk + 4, g.bh * img.pk + 4);
      vctx.restore();
    }
    if (measuring && measure && measure.imgId === img.id) drawMeasure(img);
    view.classList.toggle('measuring', measuring);
    view.classList.toggle('can-drag', !measuring && !!g);
    var legend = [img.w + ' × ' + img.h + ' PX', bytes(img.size)];
    if (img.tiffKind) legend.push(img.tiffKind.toUpperCase());
    if (g) legend.push('BAR ' + g.px + ' PX');
    if (img.pk < 1) legend.push('PREVIEW ' + Math.round(img.pk * 100) + '%');
    $('legend').innerHTML = legend.map(function (s) { return '<span>' + esc(s) + '</span>'; }).join('');
  }

  function cssScale() { var r = view.getBoundingClientRect(); return r.width ? view.width / r.width : 1; }

  function drawMeasure(img) {
    var k = img.pk, s = cssScale();
    var x1 = measure.x1 * k, y1 = measure.y1 * k, x2 = measure.x2 * k, y2 = measure.y2 * k;
    vctx.save();
    vctx.lineCap = 'round';
    vctx.strokeStyle = '#000'; vctx.lineWidth = 4 * s;
    vctx.beginPath(); vctx.moveTo(x1, y1); vctx.lineTo(x2, y2); vctx.stroke();
    vctx.strokeStyle = '#2E9E5B'; vctx.lineWidth = 2 * s;
    vctx.beginPath(); vctx.moveTo(x1, y1); vctx.lineTo(x2, y2); vctx.stroke();
    [[x1, y1], [x2, y2]].forEach(function (p) {
      vctx.fillStyle = '#fff'; vctx.strokeStyle = '#1B2224'; vctx.lineWidth = 1.5 * s;
      vctx.beginPath(); vctx.arc(p[0], p[1], 6 * s, 0, Math.PI * 2); vctx.fill(); vctx.stroke();
      vctx.beginPath(); vctx.moveTo(p[0], p[1] - 4 * s); vctx.lineTo(p[0], p[1] + 4 * s); vctx.stroke();
    });
    var L = Math.hypot(measure.x2 - measure.x1, measure.y2 - measure.y1);
    var txt = fix(L, 2) + ' px';
    vctx.font = '600 ' + Math.round(13 * s) + 'px "IBM Plex Mono", monospace';
    var tw = vctx.measureText(txt).width;
    var tx = (x1 + x2) / 2 - tw / 2, ty = Math.min(y1, y2) - 12 * s;
    if (ty < 16 * s) ty = Math.max(y1, y2) + 24 * s;
    vctx.fillStyle = 'rgba(27,34,36,0.85)';
    vctx.fillRect(tx - 5 * s, ty - 14 * s, tw + 10 * s, 19 * s);
    vctx.fillStyle = '#fff';
    vctx.fillText(txt, tx, ty);
    vctx.restore();
  }

  function toImg(e) {
    var img = images[sel], r = view.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * img.w, y: (e.clientY - r.top) / r.height * img.h, s: img.w / r.width };
  }

  view.addEventListener('pointerdown', function (e) {
    var img = images[sel];
    if (!img || img.status !== 'ready' || busy) return;
    var p = toImg(e);
    if (S.cal.method === 'measure') {
      var hit = null;
      if (measure && measure.imgId === img.id) {
        if (Math.hypot(p.x - measure.x1, p.y - measure.y1) < 12 * p.s) hit = 's';
        else if (Math.hypot(p.x - measure.x2, p.y - measure.y2) < 12 * p.s) hit = 'e';
      }
      if (!hit) { measure = { imgId: img.id, x1: p.x, y1: p.y, x2: p.x, y2: p.y }; hit = 'e'; }
      dragging = { type: 'measure', end: hit };
    } else {
      var g = geom(img);
      if (!g) return;
      var slop = 8 * p.s;
      if (p.x < g.bx - slop || p.x > g.bx + g.bw + slop || p.y < g.by - slop || p.y > g.by + g.bh + slop) return;
      dragging = { type: 'bar', dx: p.x - g.bx, dy: p.y - g.by, w: g.bw, h: g.bh };
      view.classList.add('dragging');
    }
    try { view.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    e.preventDefault();
  });
  view.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var img = images[sel];
    if (!img) return;
    var p = toImg(e);
    if (dragging.type === 'measure') {
      var x = clamp(p.x, 0, img.w), y = clamp(p.y, 0, img.h);
      if (dragging.end === 's') { measure.x1 = x; measure.y1 = S.cal.lockH ? measure.y2 : y; }
      else { measure.x2 = x; measure.y2 = S.cal.lockH ? measure.y1 : y; }
      setLineFromMeasure();
    } else {
      var bx = clamp(p.x - dragging.dx, 0, Math.max(0, img.w - dragging.w));
      var by = clamp(p.y - dragging.dy, 0, Math.max(0, img.h - dragging.h));
      img.pos = { fx: bx / img.w, fy: by / img.h };
    }
    refresh(true);
  });
  function endDrag() {
    if (!dragging) return;
    var wasMeasure = dragging.type === 'measure';
    dragging = null;
    view.classList.remove('dragging');
    if (wasMeasure && measure && Math.hypot(measure.x2 - measure.x1, measure.y2 - measure.y1) < 1) { measure = null; }
    save();
    refresh();
  }
  view.addEventListener('pointerup', endDrag);
  view.addEventListener('pointercancel', endDrag);

  function setLineFromMeasure() {
    if (!measure) return;
    var L = Math.hypot(measure.x2 - measure.x1, measure.y2 - measure.y1);
    S.cal.linePx = L > 0 ? parseFloat(L.toFixed(3)) : null;
    S.cal.presetId = '';
    $('lineLen').value = L > 0 ? fix(L, 2) : '';
  }

  /* ===================================================================
     UI: rendering the steps
     =================================================================== */
  function pressed(attr, val) {
    $$('[' + attr + ']').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute(attr) === String(val))); });
  }

  function renderPresetSelect() {
    var s = $('presetSel'), cur = S.cal.presetId;
    var opts = '<option value="">' + (S.presets.length ? '— none · set below —' : 'No presets yet — save one below') + '</option>';
    S.presets.forEach(function (p) {
      opts += '<option value="' + esc(p.id) + '">' + esc(p.name) + ' · ' + esc(fmtUmpp(p.umpp)) + ' µm/px</option>';
    });
    s.innerHTML = opts;
    s.value = presetById(cur) ? cur : '';
    $('pDelete').disabled = !presetById(cur);
    var os = $('ownPreset');
    if (os) {
      var o2 = '<option value="">— preset —</option>';
      S.presets.forEach(function (p) { o2 += '<option value="' + esc(p.id) + '">' + esc(p.name) + ' · ' + esc(fmtUmpp(p.umpp)) + '</option>'; });
      os.innerHTML = o2;
    }
  }

  function syncInputs() {
    var c = S.cal, st = S.style;
    pressed('data-method', c.method);
    $('mValue').hidden = c.method !== 'value';
    $('mMeasure').hidden = c.method !== 'measure';
    $('mCamera').hidden = c.method !== 'camera';
    if (document.activeElement !== $('calValue')) $('calValue').value = c.value == null ? '' : c.value;
    $('calUnit').value = c.unit;
    if (document.activeElement !== $('lineLen')) $('lineLen').value = ok(num(c.linePx)) ? fix(num(c.linePx), 2) : '';
    if (document.activeElement !== $('knownLen')) $('knownLen').value = c.known == null ? '' : c.known;
    $('knownUnit').value = c.knownUnit || 'um';
    $('lockH').checked = !!c.lockH;
    $('camPix').value = c.cam.pix; $('camBin').value = String(c.cam.bin); $('camObj').value = c.cam.obj; $('camExtra').value = c.cam.extra;
    pressed('data-len', st.lenMode);
    pressed('data-corner', st.corner);
    pressed('data-color', st.color === '#FFFFFF' || st.color === '#000000' ? st.color : 'custom');
    $('customColor').hidden = st.color !== 'custom';
    $('customColor').value = st.custom;
    pressed('data-label', st.label);
    pressed('data-font', st.font);
    $$('[data-bold]').forEach(function (b) { b.setAttribute('aria-pressed', String(!!st.bold)); });
    pressed('data-box', st.box);
    $$('[data-halo]').forEach(function (b) { b.setAttribute('aria-pressed', String(!!st.halo)); });
    $('thick').value = st.thick; $('fontSize').value = st.fontSize; $('margin').value = st.margin;
    $('thickOut').textContent = fix(+st.thick, 1) + '%';
    $('fontOut').textContent = fix(+st.fontSize, 2) + '%';
    $('marginOut').textContent = fix(+st.margin, 1) + '%';
    pressed('data-fmt', S.out.fmt);
    pressed('data-hb', S.out.hb);
    if (document.activeElement !== $('suffix')) $('suffix').value = S.out.suffix;
  }

  function renderCal() {
    var b = batchCal(), box = $('calResult');
    if (!b) {
      box.className = 'cal-result none';
      var why = S.cal.method === 'measure' ? (ok(num(S.cal.linePx)) ? 'Enter the known length.' : 'Draw a line across a known length in the preview.') : S.cal.method === 'camera' ? 'Fill in the camera and objective.' : 'Enter the pixel size.';
      box.innerHTML = '<span class="big">— µm/px</span><span class="sub">' + esc(why.toUpperCase()) + '</span>';
    } else {
      box.className = 'cal-result' + (b.src === 'camera' ? ' est' : '');
      box.innerHTML = '<span class="big">' + esc(fmtUmpp(b.umpp)) + '<small>µm/px</small></span><span class="sub">' + esc(sig(1 / b.umpp, 5)) + ' PX/µm<br>' +
        esc((b.src === 'camera' ? 'Estimate · ' : '') + b.detail) + '</span>';
    }
    // measuring help
    var mh = $('measureHint');
    if (S.cal.method === 'measure') {
      var img = images[sel];
      mh.textContent = !img ? 'Add an image with a known length first (a stage micrometer, or any image you know the size of).' :
        measure && measure.imgId === img.id ? 'Measuring on ' + img.name + '. Measure across many divisions (e.g. 100 µm, not 10 µm): a one-pixel error then matters less.' :
        'Drag across the known length on ' + img.name + ' in the preview.';
    }
    $$('[data-nudge]').forEach(function (bt) { bt.disabled = !measure; });
    // size field for presets
    var r = readyImages();
    if (r.length && !$('pSize').value) $('pSize').placeholder = r[0].w + ' × ' + r[0].h;
    // file calibrations
    var withFile = r.filter(function (m) { return m.fileCal; });
    var fc = $('fileCal');
    if (!withFile.length) { fc.hidden = true; }
    else {
      fc.hidden = false;
      var vals = {};
      withFile.forEach(function (m) { vals[fmtUmpp(m.fileCal.umpp)] = 1; });
      var keys = Object.keys(vals);
      var using = withFile.filter(function (m) { return m.use === 'file'; }).length;
      fc.innerHTML = '<p class="mono">SCALE FOUND IN ' + withFile.length + ' OF ' + r.length + ' FILE' + (r.length > 1 ? 'S' : '') + '</p>' +
        '<p class="sans">' + esc(keys.length === 1 ? keys[0] + ' µm/px (' + withFile[0].fileCal.label + ')' : keys.length + ' different values: ' + keys.slice(0, 4).join(', ') + (keys.length > 4 ? '…' : '') + ' µm/px') +
        '. Check it matches how the images were taken; files keep the scale even after resizing in some programs.</p>' +
        '<div class="filecal-btns mono"><button type="button" class="linkish" id="useFileAll">' + (using === withFile.length ? 'USING FILE VALUES ✓' : 'USE FILE VALUES FOR THESE IMAGES') + '</button>' +
        (keys.length === 1 ? '<button type="button" class="linkish" id="fileToBatch">COPY TO BATCH VALUE</button>' : '') +
        (using ? '<button type="button" class="linkish" id="fileOff">USE BATCH INSTEAD</button>' : '') + '</div>';
    }
  }

  function renderLenHint() {
    var len = barLength(), h = $('lenHint');
    var auto = S.style.lenMode === 'auto';
    $('barLen').readOnly = auto; $('barUnit').disabled = auto;
    if (auto) {
      if (len) {
        $('barLen').value = sig(len.um / UM[len.unit], 8); $('barUnit').value = len.unit;
        h.textContent = 'AUTO: ' + labelFor(len) + ' — the largest round length up to 20% of the narrowest field (' + sig(len.field, 4) + ' µm). Press FIXED to type your own.';
      } else h.textContent = 'AUTO picks a round length once the images and a calibration are in.';
    } else {
      h.textContent = len ? 'Every image gets a ' + labelFor(len) + ' bar; its length in pixels follows each image’s calibration.' : 'Enter a bar length.';
    }
  }

  function buildStrip() {
    var ol = $('strip');
    ol.innerHTML = '';
    images.forEach(function (img) {
      var li = document.createElement('li');
      li.innerHTML = '<button type="button"><span class="th"></span><span class="nm"></span><span class="st"></span></button>';
      li.querySelector('.nm').textContent = img.name;
      li.querySelector('button').addEventListener('click', function () { select(images.indexOf(img)); });
      img.li = li;
      ol.appendChild(li);
      renderStripItem(img);
    });
    $('stripBox').hidden = !images.length;
  }
  function renderStripItem(img) {
    if (!img.li) return;
    var th = img.li.querySelector('.th');
    if (img.thumb && !th.firstChild) { var c = makeCanvas(img.thumb.width, img.thumb.height); c.getContext('2d').drawImage(img.thumb, 0, 0); th.appendChild(c); img.thumbEl = c; }
    if (img.thumbEl) {
      var g = img.status === 'ready' ? geom(img) : null;
      var tc = img.thumbEl.getContext('2d');
      tc.drawImage(img.thumb, 0, 0);
      if (g) drawOverlay(tc, g, img.thumb.width / img.w);
    }
    var st = img.li.querySelector('.st');
    if (img.status === 'loading') { st.className = 'st k-busy'; st.textContent = 'OPENING…'; }
    else {
      var k = worst(checksFor(img));
      st.className = 'st k-' + (k === 'info' ? 'pass' : k);
      st.textContent = img.status === 'error' ? 'CAN’T OPEN' : { pass: 'READY', info: 'READY', warn: 'CHECK', fail: 'FIX' }[k];
    }
    img.li.querySelector('button').setAttribute('aria-current', String(images[sel] === img));
  }

  function renderPerImage() {
    var img = images[sel];
    var pi = $('perImage');
    if (!img || img.status !== 'ready') { pi.hidden = true; return; }
    pi.hidden = false;
    pressed('data-own', img.use);
    $$('[data-own="file"]')[0].disabled = !img.fileCal;
    $('ownWrap').hidden = img.use !== 'own';
    if (img.use === 'own' && document.activeElement !== $('ownValue')) $('ownValue').value = ok(img.ownUmpp) ? img.ownUmpp : '';
    var measuring = S.cal.method === 'measure';
    $('posNote').textContent = measuring ? 'MEASURING — SWITCH STEP 02 BACK TO MOVE THE BAR' : img.pos ? 'MOVED BY HAND ON THIS IMAGE' : 'DRAG THE BAR IN THE PREVIEW TO MOVE IT ON THIS IMAGE';
    $('posReset').disabled = !img.pos;
    $('posAll').disabled = !img.pos || images.length < 2;
  }

  function renderChecks() {
    var img = images[sel], ul = $('checks');
    if (!img) { ul.innerHTML = ''; return; }
    ul.innerHTML = checksFor(img).map(function (c) {
      return '<li class="k-' + c.k + '"><span><i class="ico" aria-hidden="true"></i></span><span class="lbl">' + esc(c.lbl) + '</span><span class="val">' + esc(c.val) + '</span><span class="word">' + esc(c.word) + '</span></li>';
    }).join('');
  }

  function renderVerdict() {
    var v = $('verdict');
    var r = readyImages(), loading = images.filter(function (m) { return m.status === 'loading'; }).length;
    var errs = images.filter(function (m) { return m.status === 'error'; }).length;
    if (!images.length) {
      v.className = 'status empty';
      v.innerHTML = '<div class="status-title">NO IMAGES YET</div><p class="sans">Add your images in step 01. They are opened here and never uploaded.</p>';
      return;
    }
    if (loading) {
      v.className = 'status busy';
      v.innerHTML = '<div class="status-title">OPENING ' + loading + ' IMAGE' + (loading > 1 ? 'S' : '') + '…</div><p class="sans">Large TIFFs take a few seconds each.</p>';
      return;
    }
    var counts = { pass: 0, warn: 0, fail: 0 };
    images.forEach(function (m) { var k = worst(checksFor(m)); counts[k === 'info' ? 'pass' : k]++; });
    var len = barLength();
    var noCal = r.filter(function (m) { return !calFor(m); }).length;
    if (noCal) {
      v.className = 'status fail';
      v.innerHTML = '<div class="status-title">SET THE CALIBRATION</div><p class="sans">' + (noCal === r.length ? 'No µm per pixel yet.' : noCal + ' image' + (noCal > 1 ? 's have' : ' has') + ' no µm per pixel.') +
        ' Enter it, measure a known length or pick a preset in step 02.</p>';
    } else if (counts.fail) {
      v.className = 'status fail';
      v.innerHTML = '<div class="status-title">' + counts.fail + ' IMAGE' + (counts.fail > 1 ? 'S NEED' : ' NEEDS') + ' A FIX</div><p class="sans">Open the images marked FIX below and see what to change.' + (errs ? ' Files that couldn’t be opened are left out of the ZIP.' : '') + '</p>';
    } else if (counts.warn) {
      v.className = 'status warn';
      v.innerHTML = '<div class="status-title">READY · ' + counts.warn + ' TO LOOK AT</div><p class="sans">' + (len ? labelFor(len) + ' bar on ' + r.length + ' image' + (r.length > 1 ? 's' : '') + '. ' : '') + 'Images marked CHECK will still export — look at them first.</p>';
    } else {
      v.className = 'status pass';
      v.innerHTML = '<div class="status-title">✓ READY</div><p class="sans">' + (len ? labelFor(len) + ' bar on ' + r.length + ' image' + (r.length > 1 ? 's' : '') + '.' : '') + ' Download the ZIP for copies and the calibration record.</p>';
    }
  }

  function renderButtons() {
    var r = readyImages();
    var exportable = r.filter(function (m) { return geom(m); });
    $('downloadZip').disabled = busy || !exportable.length;
    $('downloadCsv').disabled = busy || !exportable.length;
    $('copyLegend').disabled = !barLength();
    var img = images[sel];
    $('downloadOne').disabled = busy || !(img && img.status === 'ready' && geom(img));
    $('clearBtn').disabled = busy || !images.length;
    $('prevImg').disabled = sel <= 0;
    $('nextImg').disabled = sel < 0 || sel >= images.length - 1;
    $('imgPos').textContent = images.length ? (sel + 1) + ' / ' + images.length : '—';
    $('imgCountBar').textContent = images.length ? images.length + ' IMAGE' + (images.length > 1 ? 'S' : '') : '';
    $('previewTitle').textContent = img ? img.name.toUpperCase() : 'PREVIEW';
    $('previewMode').textContent = S.cal.method === 'measure' && img ? 'MEASURING' : '';
    var total = images.reduce(function (a, m) { return a + (m.size || 0); }, 0);
    $('stripSum').textContent = images.length ? images.length + ' · ' + bytes(total) : '';
    $('loadNote').textContent = '';
  }

  var rafPending = false;
  function refresh(fast) {
    if (fast) {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(function () { rafPending = false; drawView(); renderCal(); renderChecks(); renderPerImage(); });
      return;
    }
    syncInputs();
    renderCal();
    renderLenHint();
    drawView();
    renderPerImage();
    renderChecks();
    images.forEach(renderStripItem);
    renderVerdict();
    renderButtons();
  }

  function select(i) {
    if (i < 0 || i >= images.length) return;
    sel = i;
    refresh();
    var li = images[i].li;
    if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
  }

  /* ===================================================================
     UI: events
     =================================================================== */
  // 01 images
  var input = $('fileInput'), drop = $('drop');
  input.addEventListener('change', function () { addFiles(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });
  // a drop anywhere on the page also works
  document.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    if (e.target && drop.contains(e.target)) return;
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); }
  });
  $('clearBtn').addEventListener('click', function () {
    images = []; sel = -1; measure = null;
    buildStrip(); refresh();
  });
  $('sampleBtn').addEventListener('click', makeSamples);

  // 02 calibration
  $('presetSel').addEventListener('change', function () {
    var p = presetById(this.value);
    S.cal.presetId = p ? p.id : '';
    if (p) { S.cal.method = 'value'; S.cal.value = p.umpp; S.cal.unit = 'umpp'; }
    save(); refresh();
  });
  $$('[data-method]').forEach(function (b) {
    b.addEventListener('click', function () { S.cal.method = b.getAttribute('data-method'); S.cal.presetId = ''; save(); refresh(); });
  });
  $('calValue').addEventListener('input', function () { S.cal.value = num(this.value); S.cal.presetId = ''; save(); refresh(); });
  $('calUnit').addEventListener('change', function () { S.cal.unit = this.value; S.cal.presetId = ''; save(); refresh(); });
  $('lineLen').addEventListener('input', function () { S.cal.linePx = num(this.value); measure = null; save(); refresh(); });
  $('knownLen').addEventListener('input', function () { S.cal.known = num(this.value); save(); refresh(); });
  $('knownUnit').addEventListener('change', function () { S.cal.knownUnit = this.value; save(); refresh(); });
  $('lockH').addEventListener('change', function () {
    S.cal.lockH = this.checked;
    if (this.checked && measure) { measure.y2 = measure.y1; setLineFromMeasure(); }
    save(); refresh();
  });
  $$('[data-nudge]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!measure) return;
      var a = b.getAttribute('data-nudge').split(','), d = +a[1];
      var img = imgById(measure.imgId);
      if (a[0] === 's') measure.x1 = clamp(measure.x1 + d, 0, img ? img.w : Infinity);
      else measure.x2 = clamp(measure.x2 + d, 0, img ? img.w : Infinity);
      setLineFromMeasure(); save(); refresh();
    });
  });
  [['camPix', 'pix'], ['camObj', 'obj'], ['camExtra', 'extra']].forEach(function (p) {
    $(p[0]).addEventListener('input', function () { S.cal.cam[p[1]] = num(this.value); save(); refresh(); });
  });
  $('camBin').addEventListener('change', function () { S.cal.cam.bin = num(this.value) || 1; save(); refresh(); });

  // file calibrations (buttons are re-rendered)
  $('fileCal').addEventListener('click', function (e) {
    var id = e.target && e.target.id;
    var withFile = readyImages().filter(function (m) { return m.fileCal; });
    if (id === 'useFileAll') withFile.forEach(function (m) { m.use = 'file'; });
    else if (id === 'fileOff') withFile.forEach(function (m) { if (m.use === 'file') m.use = 'batch'; });
    else if (id === 'fileToBatch' && withFile.length) {
      S.cal.method = 'value'; S.cal.unit = 'umpp'; S.cal.value = parseFloat(withFile[0].fileCal.umpp.toPrecision(8)); S.cal.presetId = '';
      withFile.forEach(function (m) { if (m.use === 'file') m.use = 'batch'; });
      save();
    } else return;
    refresh();
  });

  // presets
  $('pSave').addEventListener('click', function () {
    var b = batchCal();
    var name = $('pName').value.trim();
    if (!b) { flashHint($('pName'), 'Set a calibration first.'); return; }
    if (!name) { $('pName').focus(); flashHint($('pName'), 'Give the preset a name.'); return; }
    var size = ($('pSize').value || $('pSize').placeholder || '').match(/(\d+)\s*[×x*]\s*(\d+)/);
    var p = { id: uid(), name: name, umpp: parseFloat(b.umpp.toPrecision(10)), how: b.detail, objective: $('pObj').value.trim(), camera: $('pCam').value.trim(),
      binning: $('pBin').value.trim(), w: size ? +size[1] : null, h: size ? +size[2] : null, saved: todayISO() };
    var same = S.presets.filter(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })[0];
    if (same) { p.id = same.id; S.presets[S.presets.indexOf(same)] = p; } else S.presets.push(p);
    S.cal.method = 'value'; S.cal.unit = 'umpp'; S.cal.value = p.umpp; S.cal.presetId = p.id;
    ['pName', 'pObj', 'pCam', 'pBin', 'pSize'].forEach(function (i) { $(i).value = ''; });
    save(); renderPresetSelect(); refresh();
    $('savePreset').open = false;
  });
  $('pDelete').addEventListener('click', function () {
    var p = presetById(S.cal.presetId);
    if (!p) return;
    if (this.getAttribute('data-confirm') !== '1') {
      this.setAttribute('data-confirm', '1'); this.textContent = 'TAP AGAIN TO DELETE';
      var btn = this; setTimeout(function () { btn.removeAttribute('data-confirm'); btn.textContent = 'DELETE THIS PRESET'; }, 3000);
      return;
    }
    S.presets = S.presets.filter(function (x) { return x.id !== p.id; });
    S.cal.presetId = '';
    this.removeAttribute('data-confirm'); this.textContent = 'DELETE THIS PRESET';
    save(); renderPresetSelect(); refresh();
  });
  $('pExport').addEventListener('click', function () {
    var data = { labmate: 'scale-bar-presets', v: 1, exported: todayISO(), presets: S.presets };
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'scale-bar-presets.json');
  });
  $('pImport').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    f.text().then(function (t) {
      var d = JSON.parse(t), list = d && Array.isArray(d.presets) ? d.presets : Array.isArray(d) ? d : null;
      if (!list) throw new Error('no presets');
      var n = 0;
      list.forEach(function (p) {
        if (!p || !p.name || !ok(+p.umpp)) return;
        var q = { id: p.id || uid(), name: String(p.name).slice(0, 120), umpp: +p.umpp, how: p.how || '', objective: p.objective || '', camera: p.camera || '',
          binning: p.binning || '', w: p.w || null, h: p.h || null, saved: p.saved || '' };
        var same = S.presets.filter(function (x) { return x.id === q.id || x.name.toLowerCase() === q.name.toLowerCase(); })[0];
        if (same) S.presets[S.presets.indexOf(same)] = q; else S.presets.push(q);
        n++;
      });
      save(); renderPresetSelect(); refresh();
      flashHint($('pName'), n + ' preset' + (n === 1 ? '' : 's') + ' imported.');
    }).catch(function () { flashHint($('pName'), 'That file has no scale bar presets.'); });
  });
  function flashHint(el, msg) {
    var p = el.closest('.preset-form').querySelector('.hint');
    var old = p.getAttribute('data-orig') || p.textContent;
    p.setAttribute('data-orig', old);
    p.textContent = msg;
    p.style.color = 'var(--ink)';
    clearTimeout(p._t);
    p._t = setTimeout(function () { p.textContent = old; p.style.color = ''; }, 3500);
    $('savePreset').open = true;
  }

  // 03 style
  function styleSet(k, v) { S.style[k] = v; save(); refresh(); }
  $$('[data-len]').forEach(function (b) {
    b.addEventListener('click', function () {
      var m = b.getAttribute('data-len');
      if (m === 'fixed' && S.style.lenMode === 'auto') {
        var len = barLength();
        if (len) { S.style.len = parseFloat((len.um / UM[len.unit]).toPrecision(10)); S.style.unit = len.unit; }
      }
      styleSet('lenMode', m);
    });
  });
  $('barLen').addEventListener('input', function () { if (S.style.lenMode === 'fixed') { S.style.len = num(this.value); save(); refresh(); } });
  $('barUnit').addEventListener('change', function () { styleSet('unit', this.value); });
  $$('[data-corner]').forEach(function (b) {
    b.addEventListener('click', function () { images.forEach(function (m) { m.pos = null; }); styleSet('corner', b.getAttribute('data-corner')); });
  });
  $$('[data-color]').forEach(function (b) { b.addEventListener('click', function () { styleSet('color', b.getAttribute('data-color')); }); });
  $('customColor').addEventListener('input', function () { styleSet('custom', this.value.toUpperCase()); });
  $$('[data-label]').forEach(function (b) { b.addEventListener('click', function () { styleSet('label', b.getAttribute('data-label')); }); });
  $$('[data-font]').forEach(function (b) {
    b.addEventListener('click', function () {
      var f = b.getAttribute('data-font');
      styleSet('font', f);
      if (f === 'plex' && document.fonts && document.fonts.load) {
        Promise.all([document.fonts.load('600 40px "IBM Plex Sans"'), document.fonts.load('400 40px "IBM Plex Sans"')]).then(function () { refresh(); }, function () { /* fallback font */ });
      }
    });
  });
  $$('[data-bold]').forEach(function (b) { b.addEventListener('click', function () { styleSet('bold', !S.style.bold); }); });
  $$('[data-box]').forEach(function (b) { b.addEventListener('click', function () { styleSet('box', b.getAttribute('data-box')); }); });
  $$('[data-halo]').forEach(function (b) { b.addEventListener('click', function () { styleSet('halo', !S.style.halo); }); });
  [['thick', 'thick'], ['fontSize', 'fontSize'], ['margin', 'margin']].forEach(function (p) {
    $(p[0]).addEventListener('input', function () {
      S.style[p[1]] = +this.value;
      save(); refresh();
    });
  });

  // 04 export settings
  $$('[data-fmt]').forEach(function (b) { b.addEventListener('click', function () { S.out.fmt = b.getAttribute('data-fmt'); save(); refresh(); }); });
  $('suffix').addEventListener('input', function () { S.out.suffix = this.value.replace(/[\\/:*?"<>|]/g, ''); save(); });
  $$('[data-hb]').forEach(function (b) {
    b.addEventListener('click', function () {
      var v = b.getAttribute('data-hb');
      if (v === S.out.hb) return;
      S.out.hb = v; save();
      // re-open high-bit-depth TIFFs with the new display range
      images.forEach(function (m) {
        if (m.kind === 'tiff' && m.srcBits > 8 && m.status === 'ready') {
          m.status = 'loading'; m.thumb = null;
          if (m.thumbEl && m.thumbEl.parentNode) m.thumbEl.parentNode.removeChild(m.thumbEl);
          m.thumbEl = null;
          loadQueue = loadQueue.then(function () { return loadImage(m); }).then(function () { renderStripItem(m); refresh(); });
        }
      });
      refresh();
    });
  });

  // per image
  $$('[data-own]').forEach(function (b) {
    b.addEventListener('click', function () {
      var img = images[sel];
      if (!img) return;
      var v = b.getAttribute('data-own');
      if (v === 'own' && !ok(img.ownUmpp)) { var c = calFor(img); if (c) img.ownUmpp = parseFloat(c.umpp.toPrecision(8)); }
      img.use = v;
      refresh();
    });
  });
  $('ownValue').addEventListener('input', function () { var img = images[sel]; if (!img) return; img.ownUmpp = num(this.value); img.ownPreset = ''; refresh(); });
  $('ownPreset').addEventListener('change', function () {
    var img = images[sel], p = presetById(this.value);
    if (!img || !p) return;
    img.ownUmpp = p.umpp; img.ownPreset = p.name; this.value = '';
    $('ownValue').value = p.umpp;
    refresh();
  });
  $('posReset').addEventListener('click', function () { var img = images[sel]; if (img) { img.pos = null; refresh(); } });
  $('posAll').addEventListener('click', function () {
    var img = images[sel];
    if (!img || !img.pos) return;
    var p = img.pos;
    images.forEach(function (m) { m.pos = { fx: p.fx, fy: p.fy }; });
    refresh();
  });
  $('removeImg').addEventListener('click', function () {
    var img = images[sel];
    if (!img) return;
    images.splice(sel, 1);
    if (measure && measure.imgId === img.id) measure = null;
    sel = Math.min(sel, images.length - 1);
    buildStrip(); refresh();
  });
  $('prevImg').addEventListener('click', function () { select(sel - 1); });
  $('nextImg').addEventListener('click', function () { select(sel + 1); });
  document.addEventListener('keydown', function (e) {
    var t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft' && sel > 0) { select(sel - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight' && sel < images.length - 1) { select(sel + 1); e.preventDefault(); }
  });
  window.addEventListener('resize', function () { refresh(true); });

  /* ===================================================================
     export
     =================================================================== */
  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  function outType(img) {
    var f = S.out.fmt;
    if (f === 'same') f = img.kind === 'jpeg' ? 'jpeg' : img.kind === 'webp' ? 'webp' : 'png';
    return { mime: 'image/' + f, ext: f === 'jpeg' ? '.jpg' : '.' + f };
  }
  function outName(img, used) {
    var base = img.name.replace(/\.[^.]+$/, '') || 'image';
    var name = base + (S.out.suffix || '') + outType(img).ext;
    if (used) {
      var n = 2, nm = name;
      while (used[nm.toLowerCase()]) nm = base + (S.out.suffix || '') + '-' + (n++) + outType(img).ext;
      used[nm.toLowerCase()] = 1;
      name = nm;
    }
    return name;
  }
  function toBlob(c, mime) {
    return new Promise(function (res, rej) {
      if (!c.toBlob) { rej(userError('This browser can’t save images from the page.')); return; }
      c.toBlob(function (b) {
        if (b) res(b);
        else rej(userError('The browser ran out of room drawing this image (' + mpx(c.width, c.height) + '). Try a computer, or a smaller image.'));
      }, mime, mime === 'image/png' ? undefined : 0.95);
    });
  }
  function renderFull(img) {
    var g = geom(img);
    if (!g) return Promise.reject(userError(img.name + ' has no calibration.'));
    return decodeFull(img).then(function (full) {
      var c = makeCanvas(full.w, full.h), ctx = c.getContext('2d');
      var t = outType(img);
      if (t.mime === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(full.src, 0, 0);
      full.done();
      drawOverlay(ctx, g, 1);
      return toBlob(c, t.mime).then(function (b) { c.width = 0; c.height = 0; return { blob: b, g: g }; });
    });
  }

  function csvCell(v) { var s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function corner(img) { if (img.pos) return 'moved: x ' + Math.round(img.pos.fx * img.w) + ' px, y ' + Math.round(img.pos.fy * img.h) + ' px'; return { tl: 'top left', tr: 'top right', bl: 'bottom left', br: 'bottom right' }[S.style.corner]; }
  function csvRows(list) {
    var head = ['source_file', 'output_file', 'width_px', 'height_px', 'um_per_px', 'px_per_um', 'calibration', 'preset', 'scale_in_file_um_per_px', 'bar_length', 'bar_unit', 'bar_um', 'bar_px', 'bar_px_exact', 'rounding_error_pct', 'position', 'label', 'bit_depth', 'made_with', 'date'];
    var rows = [head.join(',')];
    list.forEach(function (it) {
      var img = it.img, g = it.g || geom(img);
      if (!g) return;
      rows.push([img.name, it.out || '', img.w, img.h, sig(g.cal.umpp, 8), sig(1 / g.cal.umpp, 8), g.cal.detail, g.cal.preset ? g.cal.preset.name : '',
        img.fileCal ? sig(img.fileCal.umpp, 8) : '', sig(g.len.um / UM[g.len.unit], 8), ULAB[g.len.unit], sig(g.len.um, 8), g.px, fix(g.exact, 3), (g.err * 100).toFixed(3),
        corner(img), g.label ? g.label : '(no label)', img.rangeNote ? img.tiffKind + ' → 8-bit, ' + img.rangeNote.toLowerCase() : (img.srcBits ? img.srcBits + '-bit' : '8-bit'),
        'labmate.tools Scale Bar 8.1', todayISO()].map(csvCell).join(','));
    });
    return '﻿' + rows.join('\r\n') + '\r\n';
  }
  function settingsJson() {
    var b = batchCal();
    return JSON.stringify({ tool: 'labmate.tools Scale Bar', version: 1, date: todayISO(), batchCalibration: b ? { umPerPx: b.umpp, how: b.detail } : null,
      barLength: barLength(), style: S.style, output: S.out, presetsUsed: S.presets.filter(function (p) { return images.some(function (m) { var c = calFor(m); return c && c.preset === p; }); }) }, null, 2);
  }

  function setBusy(on, text) {
    busy = on;
    var b = $('downloadZip');
    b.classList.toggle('busy', on);
    b.innerHTML = on ? esc(text) + ' <span aria-hidden="true">…</span>' : 'DOWNLOAD ALL (ZIP + CSV) <span aria-hidden="true">→</span>';
    renderButtons();
  }
  function showExportError(msg) { var e = $('exportError'); e.hidden = !msg; e.textContent = msg || ''; }

  $('downloadZip').addEventListener('click', function () {
    if (busy) return;
    var list = readyImages().filter(function (m) { return geom(m); });
    if (!list.length) return;
    showExportError('');
    var used = {}, entries = [], done = [], failed = [], i = 0;
    setBusy(true, 'DRAWING 1 / ' + list.length);
    var chain = Promise.resolve();
    list.forEach(function (img) {
      chain = chain.then(function () {
        setBusy(true, 'DRAWING ' + (++i) + ' / ' + list.length);
        return renderFull(img).then(function (r) {
          var name = outName(img, used);
          return blobEntry(name, r.blob).then(function (e) { entries.push(e); done.push({ img: img, g: r.g, out: name }); });
        }, function (err) { failed.push(img.name + ': ' + (err && err.message || 'failed')); });
      });
    });
    chain.then(function () {
      setBusy(true, 'PACKING ZIP');
      var csv = new Blob([csvRows(done)], { type: 'text/csv' });
      var js = new Blob([settingsJson()], { type: 'application/json' });
      return Promise.all([blobEntry('calibration.csv', csv), blobEntry('scale-bar-settings.json', js)]);
    }).then(function (extra) {
      if (!entries.length) throw userError('No image could be drawn. ' + failed.join(' '));
      var zip = makeZip(entries.concat(extra));
      download(zip, 'scale-bars-' + todayISO() + '.zip');
      if (failed.length) showExportError('Left out: ' + failed.join('; '));
      setBusy(false);
      gtagEvent('scale_bar_zip', list.length);
    }).catch(function (err) {
      setBusy(false);
      showExportError(err && err.user ? err.message : 'Export failed' + (err && err.message ? ': ' + err.message : '.'));
    });
  });

  $('downloadOne').addEventListener('click', function () {
    var img = images[sel];
    if (!img || busy) return;
    showExportError('');
    busy = true; renderButtons();
    var btn = $('downloadOne'); btn.textContent = 'DRAWING…';
    renderFull(img).then(function (r) {
      download(r.blob, outName(img));
      gtagEvent('scale_bar_one', 1);
    }).catch(function (err) {
      showExportError(err && err.user ? err.message : 'Export failed.');
    }).then(function () {
      busy = false; btn.innerHTML = 'THIS IMAGE <span aria-hidden="true">↓</span>'; renderButtons();
    });
  });

  $('downloadCsv').addEventListener('click', function () {
    var used = {};
    var list = readyImages().filter(function (m) { return geom(m); }).map(function (m) { return { img: m, out: outName(m, used) }; });
    download(new Blob([csvRows(list)], { type: 'text/csv' }), 'calibration-' + todayISO() + '.csv');
  });

  $('copyLegend').addEventListener('click', function () {
    var len = barLength();
    if (!len) return;
    var txt = 'Scale bar' + (readyImages().length > 1 ? 's' : '') + ', ' + labelFor(len) + '.';
    var btn = this;
    function done() { btn.innerHTML = 'COPIED ✓'; setTimeout(function () { btn.innerHTML = 'COPY LEGEND <span aria-hidden="true">⧉</span>'; }, 1800); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fallback);
    else fallback();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { window.prompt('Copy:', txt); }
      ta.remove();
    }
  });

  function gtagEvent(name, n) { try { if (window.gtag) window.gtag('event', name, { value: n }); } catch (e) { /* ignore */ } }

  /* ===================================================================
     sample batch — drawn here, all at 0.5 µm/px
     =================================================================== */
  function rnd(seed) { return function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
  function blobs(ctx, w, h, n, colors, r0, r1, seed, alpha) {
    var R = rnd(seed);
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < n; i++) {
      var x = R() * w, y = R() * h, r = r0 + R() * (r1 - r0), col = colors[i % colors.length];
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(' + col + ',' + (alpha || 0.9) + ')'); g.addColorStop(0.7, 'rgba(' + col + ',' + ((alpha || 0.9) * 0.55) + ')'); g.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.7 + R() * 0.5), R() * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  function canvasFile(c, name, mime) {
    return toBlob(c, mime).then(function (b) { return new File([b], name, { type: mime }); });
  }
  // a small uncompressed 16-bit TIFF carrying an ImageJ scale (2 px per µm)
  function tiff16(w, h, R) {
    var desc = 'ImageJ=1.54f\nunit=micron\n\0';
    var n = 11, ifd = 8, dataOff = ifd + 2 + n * 12 + 4;
    var descOff = dataOff, resOff = descOff + desc.length + (desc.length & 1), pixOff = resOff + 16;
    var buf = new ArrayBuffer(pixOff + w * h * 2), dv = new DataView(buf), u8 = new Uint8Array(buf);
    dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, ifd, true);
    dv.setUint16(ifd, n, true);
    var e = ifd + 2;
    function tag(t, type, cnt, v) { dv.setUint16(e, t, true); dv.setUint16(e + 2, type, true); dv.setUint32(e + 4, cnt, true); if (type === 3 && cnt === 1) dv.setUint16(e + 8, v, true); else dv.setUint32(e + 8, v, true); e += 12; }
    tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 1, 16); tag(259, 3, 1, 1); tag(262, 3, 1, 1);
    tag(270, 2, desc.length, descOff); tag(273, 4, 1, pixOff); tag(278, 4, 1, h); tag(279, 4, 1, w * h * 2);
    tag(282, 5, 1, resOff); tag(283, 5, 1, resOff + 8);
    dv.setUint32(e, 0, true);
    for (var i = 0; i < desc.length; i++) u8[descOff + i] = desc.charCodeAt(i);
    dv.setUint32(resOff, 2, true); dv.setUint32(resOff + 4, 1, true); dv.setUint32(resOff + 8, 2, true); dv.setUint32(resOff + 12, 1, true);
    // dim nuclei on a camera offset of ~100 counts
    var cx = [], cy = [], cr = [];
    for (var k = 0; k < 26; k++) { cx.push(R() * w); cy.push(R() * h); cr.push(10 + R() * 18); }
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var v = 100 + R() * 30;
      for (var j = 0; j < cx.length; j++) { var d2 = ((x - cx[j]) * (x - cx[j]) + (y - cy[j]) * (y - cy[j])) / (cr[j] * cr[j]); if (d2 < 1) v += 2600 * (1 - d2 * d2); }
      dv.setUint16(pixOff + (y * w + x) * 2, Math.min(65535, v) | 0, true);
    }
    return new File([buf], 'nuclei_16bit.tif', { type: 'image/tiff' });
  }

  function makeSamples() {
    var btn = $('sampleBtn');
    btn.disabled = true;
    $('sampleHint').hidden = false;
    var files = [];
    // 1. stage micrometer: 10 µm divisions = 20 px at 0.5 µm/px
    var m = makeCanvas(1200, 360), c = m.getContext('2d');
    c.fillStyle = '#d9d6cc'; c.fillRect(0, 0, 1200, 360);
    var gr = c.createRadialGradient(600, 180, 60, 600, 180, 700); gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)');
    c.fillStyle = gr; c.fillRect(0, 0, 1200, 360);
    c.fillStyle = '#1a1a1a';
    c.fillRect(100, 200, 1001, 3);
    for (var i = 0; i <= 50; i++) {
      var x = 100 + i * 20, big = i % 10 === 0, mid = i % 5 === 0;
      c.fillRect(x, big ? 140 : mid ? 160 : 175, 2, big ? 60 : mid ? 40 : 25);
      if (big) { c.font = '600 22px Arial, sans-serif'; c.textAlign = 'center'; c.fillText(String(i * 10), x + 1, 128); }
    }
    c.font = '500 18px Arial, sans-serif'; c.textAlign = 'left'; c.fillText('0.5 mm stage micrometer · 10 µm divisions (fictional sample)', 100, 300);
    // 2. DAPI-like
    var a = makeCanvas(1024, 1024), ac = a.getContext('2d');
    ac.fillStyle = '#05060a'; ac.fillRect(0, 0, 1024, 1024);
    blobs(ac, 1024, 1024, 70, ['60,110,255', '80,140,255'], 18, 34, 7);
    // 3. two-colour
    var b = makeCanvas(1280, 960), bc = b.getContext('2d');
    bc.fillStyle = '#030303'; bc.fillRect(0, 0, 1280, 960);
    blobs(bc, 1280, 960, 120, ['40,220,90'], 12, 40, 11, 0.7);
    blobs(bc, 1280, 960, 50, ['230,40,200'], 8, 20, 23, 0.9);
    // 4. bright field — a white bar fails the contrast check here
    var d = makeCanvas(1200, 900), dc = d.getContext('2d');
    dc.fillStyle = '#e9e7e1'; dc.fillRect(0, 0, 1200, 900);
    var R = rnd(5);
    for (var k = 0; k < 90; k++) {
      var x0 = R() * 1200, y0 = R() * 900, r = 14 + R() * 26;
      dc.strokeStyle = 'rgba(90,80,70,0.55)'; dc.lineWidth = 2.5; dc.fillStyle = 'rgba(200,190,175,0.5)';
      dc.beginPath(); dc.ellipse(x0, y0, r, r * (0.6 + R() * 0.5), R() * 3, 0, Math.PI * 2); dc.fill(); dc.stroke();
    }
    Promise.all([
      canvasFile(m, 'stage-micrometer_20x.png', 'image/png'),
      canvasFile(a, 'dapi_field01.png', 'image/png'),
      canvasFile(b, 'gfp-mcherry_field02.png', 'image/png'),
      canvasFile(d, 'brightfield_field03.jpg', 'image/jpeg')
    ]).then(function (fs) {
      files = fs.concat([tiff16(640, 512, rnd(42))]);
      var start = images.length;
      // measure the micrometer: 0 → 400 µm (800 px)
      S.cal.method = 'measure'; S.cal.known = 400; S.cal.knownUnit = 'um'; S.cal.presetId = '';
      var p = addFiles(files);
      var micro = images[start];
      if (micro) { measure = { imgId: micro.id, x1: 101, y1: 201, x2: 901, y2: 201 }; setLineFromMeasure(); sel = start; }
      save();
      return p;
    }).then(function () {
      btn.disabled = false;
      refresh();
    }, function () { btn.disabled = false; });
  }

  /* ---------- go ---------- */
  renderPresetSelect();
  buildStrip();
  refresh();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { refresh(); });
})();
