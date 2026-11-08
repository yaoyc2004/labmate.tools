/* labmate.tools · Blot Densitometry (5.3)
   Opens a Western blot / gel image in the browser, reads the raw pixel
   values (8/16/32-bit greyscale PNG or TIFF), measures equal-size band
   boxes minus a local background box, normalises to a loading control and
   saves everything — image, boxes, settings, algorithm version — in one
   project file that reopens to the same numbers. Nothing is uploaded.
   No libraries: the PNG and TIFF readers are below. */
(function () {
  'use strict';

  var STORE_KEY = 'labmate.blotDensitometry.v1';
  var TOOL = 'blot-densitometry';
  var ALGO = 'labmate-bd-1';          // bump if the arithmetic ever changes
  var MAX_PX = 40e6;                  // largest image opened, pixels
  var VIEW_MAX = 4096;                // preview canvas long side, px
  var SIGNAL_SNR = 3;                 // "close to background" below 3 × noise

  function $(id) { return document.getElementById(id); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function ok(v) { return typeof v === 'number' && isFinite(v) && v > 0; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function userError(msg) { var e = new Error(msg); e.user = true; return e; }
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function trim0(s) { return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s; }
  function sig(v, n) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    if (v === 0) return '0';
    var d = Math.max(0, n - 1 - Math.floor(Math.log10(Math.abs(v))));
    return trim0(v.toFixed(Math.min(d, 10)));
  }
  function big(v) { // integers with thin grouping, others 4 sig figs
    if (v === null || v === undefined || !isFinite(v)) return '—';
    if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString('en-US');
    return Number.isInteger(v) ? String(v) : sig(v, 4);
  }
  function plain(v) { return v === null || v === undefined || !isFinite(v) ? '' : String(+v.toPrecision(12)); }
  function bytes(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function nowISO() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z'); }
  function laneLabel(i) { return P.lanes[i] && P.lanes[i].trim() ? P.lanes[i].trim() : 'Lane ' + (i + 1); }

  /* ===================================================================
     settings (kept on this device) and the project (in memory / file)
     =================================================================== */
  var S = { v: 1, bgStat: 'mean', bgPlace: 'above', zoom: 'fit', labels: true, last: null };
  var canStore = true;
  try {
    var raw = localStorage.getItem(STORE_KEY);
    if (raw) { var sv = JSON.parse(raw); if (sv && sv.v === 1) S = Object.assign(S, sv); }
  } catch (e) { canStore = false; }
  function save() {
    if (!canStore) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { canStore = false; }
  }

  var IMG = null;   // { name, type, size, bytes, w, h, vals, bits, float, lo, hi, kind, format, lossy, colour, flipped, pages, hash }
  var DISP = { lo: 0, hi: 1, invert: false };
  var P = newProject(6);
  function newRow(name, role) { return { id: uid(), name: name, role: role, ctrl: '', w: null, h: null, bands: [] }; }
  function newProject(n) {
    var lanes = []; for (var i = 0; i < n; i++) lanes.push('');
    var t = newRow('Target', 'target'), c = newRow('Loading control', 'control');
    t.ctrl = c.id;
    return { lanes: lanes, ref: 0, polarity: 'dark', bgStat: S.bgStat, rows: [t, c] };
  }

  /* ===================================================================
     PNG reader — raw sample values, 1–16-bit grey, grey+alpha, RGB,
     RGBA, palette; non-interlaced.
     =================================================================== */
  function inflate(u8) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(userError('This browser can’t unpack PNG or Deflate-TIFF data. Use a current Chrome, Edge, Firefox or Safari.'));
    }
    var stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  function decodePng(buf) {
    var u8 = new Uint8Array(buf), dv = new DataView(buf);
    if (!(u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47)) return Promise.reject(userError('This file is not a PNG.'));
    var p = 8, w, h, bd, ct, il, pal = null, trns = false, idat = [], total = 0;
    while (p + 8 <= u8.length) {
      var len = dv.getUint32(p), type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
      var d = p + 8;
      if (d + len > u8.length) break;
      if (type === 'IHDR') { w = dv.getUint32(d); h = dv.getUint32(d + 4); bd = u8[d + 8]; ct = u8[d + 9]; il = u8[d + 12]; }
      else if (type === 'PLTE') pal = u8.slice(d, d + len);
      else if (type === 'tRNS') trns = true;
      else if (type === 'IDAT') { idat.push(u8.subarray(d, d + len)); total += len; }
      else if (type === 'IEND') break;
      p = d + len + 4;
    }
    if (!w || !h) return Promise.reject(userError('This PNG has no image header.'));
    if (il) return Promise.reject(userError('Interlaced PNGs are not supported. Save the image again without interlacing (Fiji: File › Save As › PNG).'));
    if (w * h > MAX_PX) return Promise.reject(userError('This image is ' + (w * h / 1e6).toFixed(0) + ' MP — larger than the ' + MAX_PX / 1e6 + ' MP this page opens. Crop it to the blot first.'));
    var chans = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
    if (!chans) return Promise.reject(userError('Unknown PNG colour type.'));
    var all = new Uint8Array(total), o = 0;
    idat.forEach(function (c) { all.set(c, o); o += c.length; });
    return inflate(all).then(function (raw) {
      var bpp = Math.max(1, chans * bd / 8), stride = Math.ceil(w * chans * bd / 8);
      var cur = new Uint8Array(stride), prev = new Uint8Array(stride), ip = 0;
      var n = w * h, s = new Array(chans);
      for (var c = 0; c < chans; c++) s[c] = bd === 16 ? new Uint16Array(n) : new Uint8Array(n);
      for (var y = 0; y < h; y++) {
        if (ip + 1 + stride > raw.length) throw userError('This PNG file is damaged or cut short.');
        var f = raw[ip++];
        cur.set(raw.subarray(ip, ip + stride)); ip += stride;
        unfilter(f, cur, prev, bpp);
        var row = y * w;
        if (bd === 16) {
          for (var x = 0; x < w; x++) for (var cc = 0; cc < chans; cc++) { var q = (x * chans + cc) * 2; s[cc][row + x] = (cur[q] << 8) | cur[q + 1]; }
        } else if (bd === 8) {
          for (var x2 = 0; x2 < w; x2++) for (var c2 = 0; c2 < chans; c2++) s[c2][row + x2] = cur[x2 * chans + c2];
        } else { // 1, 2, 4-bit grey or palette
          var per = 8 / bd, mask = (1 << bd) - 1;
          for (var x3 = 0; x3 < w; x3++) s[0][row + x3] = (cur[Math.floor(x3 / per)] >> ((per - 1 - x3 % per) * bd)) & mask;
        }
        var t = prev; prev = cur; cur = t;
      }
      var out = { w: w, h: h, format: 'PNG', pages: 1 };
      if (ct === 3) {
        if (!pal) throw userError('This palette PNG has no palette.');
        var rr = new Uint8Array(n), gg = new Uint8Array(n), bb = new Uint8Array(n);
        for (var k = 0; k < n; k++) { var ix = s[0][k] * 3; rr[k] = pal[ix]; gg[k] = pal[ix + 1]; bb[k] = pal[ix + 2]; }
        return fromChannels(out, [rr, gg, bb], 8, 'palette');
      }
      var colour = ct === 2 || ct === 6;
      out.alpha = (ct === 4 || ct === 6) && hasAlpha(s[chans - 1], bd === 16 ? 65535 : 255);
      if (trns) out.alpha = true;
      if (colour) return fromChannels(out, [s[0], s[1], s[2]], bd, 'RGB');
      out.vals = s[0]; out.bits = bd; out.lo = 0; out.hi = (1 << bd) - 1; out.kind = 'grey ' + bd + '-bit';
      return out;
    });
  }
  function hasAlpha(a, full) { for (var i = 0; i < a.length; i += 7) if (a[i] !== full) return true; return false; }
  function unfilter(f, cur, prev, bpp) {
    var n = cur.length, i;
    if (f === 0) return;
    if (f === 1) { for (i = bpp; i < n; i++) cur[i] = (cur[i] + cur[i - bpp]) & 255; return; }
    if (f === 2) { for (i = 0; i < n; i++) cur[i] = (cur[i] + prev[i]) & 255; return; }
    if (f === 3) { for (i = 0; i < n; i++) cur[i] = (cur[i] + (((i >= bpp ? cur[i - bpp] : 0) + prev[i]) >> 1)) & 255; return; }
    if (f === 4) {
      for (i = 0; i < n; i++) {
        var a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        var pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      return;
    }
    throw userError('This PNG file is damaged (unknown filter).');
  }

  // colour → grey: identical channels are used as they are; otherwise the
  // unweighted mean (R+G+B)/3, which is what ImageJ measures on RGB images
  function fromChannels(out, ch, bits, how) {
    var n = ch[0].length, same = true, r = ch[0], g = ch[1], b = ch[2];
    for (var i = 0; i < n; i++) if (r[i] !== g[i] || r[i] !== b[i]) { same = false; break; }
    if (same) { out.vals = r; out.colour = 'equal'; }
    else {
      var v = new Float32Array(n);
      for (var k = 0; k < n; k++) v[k] = (r[k] + g[k] + b[k]) / 3;
      out.vals = v; out.colour = 'mean';
    }
    out.bits = bits; out.lo = 0; out.hi = Math.pow(2, bits) - 1;
    out.kind = how + ' ' + bits + '-bit' + (same ? ' (grey in colour)' : '');
    return out;
  }

  /* ===================================================================
     TIFF reader — baseline strips: 1/8/16/32-bit, grey / RGB / palette,
     uncompressed, LZW, PackBits, Deflate; first page. Raw values kept.
     =================================================================== */
  var TSIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };
  function tiffInfo(buf) {
    if (buf.byteLength < 8) throw userError('This file is too short to be a TIFF.');
    var dv = new DataView(buf), bo = dv.getUint16(0, false), le = bo === 0x4949;
    if (!le && bo !== 0x4D4D) throw userError('This file is not a TIFF.');
    var magic = dv.getUint16(2, le);
    if (magic === 43) throw userError('BigTIFF files are not supported. In Fiji, save as a normal TIFF.');
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
          var b = new Uint8Array(buf, vo, cnt), s = '';
          for (var k = 0; k < b.length; k++) s += String.fromCharCode(b[k]);
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
    var first = readIFD(u32(4)), pages = 1, off = first.next, seen = {};
    while (off && off + 2 <= len && pages < 100000 && !seen[off]) {
      seen[off] = 1;
      var n = u16(off);
      if (off + 6 + n * 12 > len) break;
      off = u32(off + 2 + n * 12); pages++;
    }
    return { le: le, tags: first.tags, pages: pages };
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
        if (code === 257 || code > 255) break;
        put(dict[code]); old = dict[code];
        continue;
      }
      var entry;
      if (code < dlen) { entry = dict[code]; if (old && dlen < 4096) dict[dlen++] = join(old, entry[0]); }
      else if (old) { entry = join(old, old[0]); if (dlen < 4096) dict[dlen++] = entry; }
      else break;
      put(entry); old = entry;
      if (dlen + 1 >= (1 << width) && width < 12) width++;
    }
    return out;
  }
  function decompress(comp, src, expect) {
    if (comp === 1) return Promise.resolve(src.slice(0, expect));
    if (comp === 32773) return Promise.resolve(packbits(src, expect));
    if (comp === 5) return Promise.resolve(lzw(src, expect));
    if (comp === 8 || comp === 32946) return inflate(src);
    if (comp === 7 || comp === 6) return Promise.reject(userError('JPEG-compressed TIFFs are lossy and not supported. Export an uncompressed or LZW TIFF from your imager.'));
    return Promise.reject(userError('This TIFF uses compression type ' + comp + ', which isn’t supported. Save it uncompressed.'));
  }
  function unpredict(row, w, spp, bits, le) {
    if (bits === 8) { for (var i = spp; i < w * spp; i++) row[i] = (row[i] + row[i - spp]) & 255; }
    else if (bits === 16) {
      var dv = new DataView(row.buffer, row.byteOffset, row.byteLength);
      for (var j = spp; j < w * spp; j++) dv.setUint16(j * 2, (dv.getUint16(j * 2, le) + dv.getUint16((j - spp) * 2, le)) & 0xFFFF, le);
    } else if (bits === 32) {
      var dv3 = new DataView(row.buffer, row.byteOffset, row.byteLength);
      for (var k = spp; k < w * spp; k++) dv3.setUint32(k * 4, (dv3.getUint32(k * 4, le) + dv3.getUint32((k - spp) * 4, le)) >>> 0, le);
    }
  }
  function decodeTiff(buf) {
    var info, t, le;
    try { info = tiffInfo(buf); } catch (e) { return Promise.reject(e); }
    t = info.tags; le = info.le;
    if (!t[256] || !t[257]) return Promise.reject(userError('This TIFF has no image size.'));
    var w = t[256][0], h = t[257][0];
    if (t[322] || t[324]) return Promise.reject(userError('Tiled TIFFs are not supported. In Fiji use File › Save As › Tiff.'));
    var bits = (t[258] || [1])[0], spp = (t[277] || [1])[0], comp = (t[259] || [1])[0];
    var photo = t[262] ? t[262][0] : 1, planar = (t[284] || [1])[0], pred = (t[317] || [1])[0], sfmt = (t[339] || [1])[0];
    if ([1, 8, 16, 32].indexOf(bits) < 0) return Promise.reject(userError(bits + '-bit TIFFs are not supported.'));
    if (photo > 3) return Promise.reject(userError('This TIFF’s colour type (' + photo + ') isn’t supported. Save it as greyscale.'));
    if (pred === 3) return Promise.reject(userError('Floating-point predictor TIFFs are not supported. Save without compression.'));
    if (w * h > MAX_PX) return Promise.reject(userError('This image is ' + (w * h / 1e6).toFixed(0) + ' MP — larger than the ' + MAX_PX / 1e6 + ' MP this page opens. Crop it to the blot first.'));
    var offs = t[273], cnts = t[279];
    if (!offs) return Promise.reject(userError('This TIFF has no image data.'));
    var rps = Math.min(h, (t[278] || [h])[0] || h);
    var planes = planar === 2 ? spp : 1, pspp = planar === 2 ? 1 : spp;
    var rowBytes = bits === 1 ? Math.ceil(w * pspp / 8) : w * pspp * bits / 8, planeBytes = rowBytes * h;
    var rawB = new Uint8Array(planeBytes * planes), spPlane = Math.ceil(h / rps), chain = Promise.resolve();
    offs.forEach(function (o, i) {
      chain = chain.then(function () {
        var plane = Math.floor(i / spPlane), s = i % spPlane;
        if (plane >= planes) return;
        var rows = Math.min(rps, h - s * rps);
        if (rows <= 0) return;
        var expect = rows * rowBytes, avail = buf.byteLength - o;
        if (avail <= 0) return;
        var src = new Uint8Array(buf, o, Math.min(cnts && cnts[i] ? cnts[i] : expect, avail));
        return decompress(comp, src, expect).then(function (d) {
          if (pred === 2 && bits >= 8) for (var r = 0; r < rows; r++) unpredict(d.subarray(r * rowBytes, (r + 1) * rowBytes), w, pspp, bits, le);
          rawB.set(d.length > expect ? d.subarray(0, expect) : d, plane * planeBytes + s * rps * rowBytes);
        });
      });
    });
    return chain.then(function () {
      var n = w * h, total = n * pspp * planes, vals, dv = new DataView(rawB.buffer);
      if (bits === 8) vals = sfmt === 2 ? new Int8Array(rawB.buffer) : rawB;
      else if (bits === 16) { vals = sfmt === 2 ? new Int16Array(total) : new Uint16Array(total); for (var i = 0; i < total; i++) vals[i] = sfmt === 2 ? dv.getInt16(i * 2, le) : dv.getUint16(i * 2, le); }
      else if (bits === 32) {
        vals = new Float32Array(total);
        if (sfmt !== 3) {
          var exact = true;
          for (var j0 = 0; j0 < total; j0++) { var vv = sfmt === 2 ? dv.getInt32(j0 * 4, le) : dv.getUint32(j0 * 4, le); if (Math.abs(vv) > 16777216) { exact = false; break; } }
          if (!exact) vals = new Float64Array(total);
        }
        for (var j = 0; j < total; j++) vals[j] = sfmt === 3 ? dv.getFloat32(j * 4, le) : (sfmt === 2 ? dv.getInt32(j * 4, le) : dv.getUint32(j * 4, le));
      } else {
        vals = new Uint8Array(total);
        for (var p = 0; p < planes; p++) for (var y = 0; y < h; y++) for (var x = 0; x < w * pspp; x++) {
          var byte = rawB[p * planeBytes + y * rowBytes + (x >> 3)];
          vals[p * n * pspp + y * w * pspp + x] = (byte >> (7 - (x & 7))) & 1;
        }
      }
      var out = { w: w, h: h, format: 'TIFF', pages: info.pages, comp: comp };
      function ch(c) {
        if (planar === 2) return vals.subarray(c * n, (c + 1) * n);
        var a = new (vals.constructor)(n);
        for (var k = 0; k < n; k++) a[k] = vals[k * spp + c];
        return a;
      }
      if (photo === 3) {
        var cmap = t[320];
        if (!cmap) throw userError('This palette TIFF has no colour map.');
        var nc = 1 << bits, ix = spp === 1 ? vals : ch(0), rr = new Uint8Array(n), gg = new Uint8Array(n), bb = new Uint8Array(n);
        for (var q = 0; q < n; q++) { rr[q] = cmap[ix[q]] >> 8; gg[q] = cmap[nc + ix[q]] >> 8; bb[q] = cmap[2 * nc + ix[q]] >> 8; }
        return fromChannels(out, [rr, gg, bb], 8, 'palette');
      }
      if (photo === 2 && spp >= 3) {
        if (sfmt === 3) throw userError('Floating-point colour TIFFs are not supported. Convert to greyscale in Fiji first.');
        return fromChannels(out, [ch(0), ch(1), ch(2)], bits, 'RGB');
      }
      var g = spp === 1 ? vals : ch(0);
      out.bits = bits; out.float = sfmt === 3;
      if (sfmt === 3) { out.lo = null; out.hi = null; }
      else if (sfmt === 2) { out.lo = -Math.pow(2, bits - 1); out.hi = Math.pow(2, bits - 1) - 1; }
      else { out.lo = 0; out.hi = Math.pow(2, bits) - 1; }
      if (photo === 0 && sfmt !== 3) { // white-is-zero: flip so values match what is shown
        var top = out.hi;
        var f = new (g.constructor)(n);
        for (var z = 0; z < n; z++) f[z] = top - g[z] + out.lo;
        g = f; out.flipped = true;
      }
      out.vals = g;
      out.kind = 'grey ' + bits + '-bit' + (sfmt === 3 ? ' float' : sfmt === 2 ? ' signed' : '');
      return out;
    });
  }

  /* JPEG, WebP, BMP, GIF — decoded by the browser, no colour conversion */
  function decodeBrowser(file, fmt) {
    var p = typeof createImageBitmap === 'function'
      ? createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
      : Promise.reject(new Error('no createImageBitmap'));
    return p.catch(function () {
      return new Promise(function (res, rej) {
        var url = URL.createObjectURL(file), el = new Image();
        el.onload = function () { res(el); };
        el.onerror = function () { URL.revokeObjectURL(url); rej(userError('This browser couldn’t open the image.')); };
        el.src = url;
      });
    }).then(function (src) {
      var w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
      if (w * h > MAX_PX) throw userError('This image is larger than the ' + MAX_PX / 1e6 + ' MP this page opens. Crop it to the blot first.');
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(src, 0, 0);
      if (src.close) src.close();
      var d = ctx.getImageData(0, 0, w, h).data, n = w * h;
      c.width = c.height = 0;
      var r = new Uint8Array(n), g = new Uint8Array(n), b = new Uint8Array(n);
      for (var i = 0; i < n; i++) { r[i] = d[i * 4]; g[i] = d[i * 4 + 1]; b[i] = d[i * 4 + 2]; }
      var out = fromChannels({ w: w, h: h, format: fmt, pages: 1, lossy: fmt === 'JPEG' || fmt === 'WEBP' }, [r, g, b], 8, fmt === 'JPEG' ? 'JPEG' : 'colour');
      if (out.colour === 'equal') out.kind = 'grey 8-bit';
      return out;
    });
  }

  function kindOf(name, type) {
    var n = (name || '').toLowerCase();
    if (/\.json$/.test(n) || type === 'application/json') return 'project';
    if (/\.tiff?$/.test(n) || /tiff/.test(type)) return 'TIFF';
    if (/\.png$/.test(n) || type === 'image/png') return 'PNG';
    if (/\.jpe?g$/.test(n) || type === 'image/jpeg') return 'JPEG';
    if (/\.webp$/.test(n) || type === 'image/webp') return 'WEBP';
    if (/\.bmp$/.test(n) || type === 'image/bmp') return 'BMP';
    if (/\.gif$/.test(n) || type === 'image/gif') return 'GIF';
    if (/\.(scn|czi|nd2|lif|1sc|gel|sdi|img|svs)$/.test(n)) return 'vendor';
    return '';
  }
  function sniff(u8) {
    if (u8[0] === 0x89 && u8[1] === 0x50) return 'PNG';
    if ((u8[0] === 0x49 && u8[1] === 0x49) || (u8[0] === 0x4D && u8[1] === 0x4D)) return 'TIFF';
    if (u8[0] === 0xFF && u8[1] === 0xD8) return 'JPEG';
    if (u8[0] === 0x7B) return 'project';
    return '';
  }

  /* minimal 16-bit grey TIFF writer (for the sample blot) */
  function tiff16(w, h, vals, desc) {
    var enc = new TextEncoder(), d = enc.encode(desc + '\0');
    var nTags = 10, ifd = 8, ifdLen = 2 + nTags * 12 + 4, dOff = ifd + ifdLen, imgOff = dOff + d.length + (d.length & 1);
    var buf = new ArrayBuffer(imgOff + w * h * 2), dv = new DataView(buf), u8 = new Uint8Array(buf);
    dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, ifd, true);
    dv.setUint16(ifd, nTags, true);
    var tags = [[256, 3, 1, w], [257, 3, 1, h], [258, 3, 1, 16], [259, 3, 1, 1], [262, 3, 1, 1], [270, 2, d.length, dOff],
      [273, 4, 1, imgOff], [277, 3, 1, 1], [278, 3, 1, h], [279, 4, 1, w * h * 2]];
    tags.forEach(function (tg, i) {
      var e = ifd + 2 + i * 12;
      dv.setUint16(e, tg[0], true); dv.setUint16(e + 2, tg[1], true); dv.setUint32(e + 4, tg[2], true);
      if (tg[1] === 3 && tg[2] === 1) dv.setUint16(e + 8, tg[3], true); else dv.setUint32(e + 8, tg[3], true);
    });
    dv.setUint32(ifd + 2 + nTags * 12, 0, true);
    u8.set(d, dOff);
    for (var i = 0; i < w * h; i++) dv.setUint16(imgOff + i * 2, vals[i], true);
    return buf;
  }

  function sha256(buf) {
    if (!window.crypto || !crypto.subtle) return Promise.resolve('');
    return crypto.subtle.digest('SHA-256', buf).then(function (h) {
      return Array.prototype.map.call(new Uint8Array(h), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }, function () { return ''; });
  }
  function b64(buf) {
    var u8 = new Uint8Array(buf), s = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  function unb64(s) {
    var bin = atob(s), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  }

  /* ===================================================================
     image statistics
     =================================================================== */
  function percentiles(vals, ps) {
    var n = vals.length, step = Math.max(1, Math.floor(n / 400000)), a = [];
    for (var i = 0; i < n; i += step) { var v = vals[i]; if (v === v) a.push(v); }
    var f = new Float64Array(a); f.sort();
    return ps.map(function (p) { return f.length ? f[Math.min(f.length - 1, Math.floor(p * (f.length - 1)))] : 0; });
  }
  function imageStats(m) {
    var lo = Infinity, hi = -Infinity, n = m.vals.length, atLo = 0, atHi = 0;
    for (var i = 0; i < n; i++) { var v = m.vals[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (m.lo !== null && m.lo !== undefined && !m.float && m.colour !== 'mean') {
      for (var k = 0; k < n; k++) { var u = m.vals[k]; if (u <= m.lo) atLo++; else if (u >= m.hi) atHi++; }
    }
    var q = percentiles(m.vals, [0.001, 0.01, 0.5, 0.99, 0.999]);
    m.min = lo; m.max = hi; m.atLo = atLo; m.atHi = atHi; m.p = q;
    // a light background (most pixels near the top of the range) means dark bands
    m.suggest = q[2] > (q[1] + q[3]) / 2 ? 'dark' : 'light';
  }

  /* ===================================================================
     measuring a box
     =================================================================== */
  function boxStats(x, y, w, h, wantList) {
    var W = IMG.w, H = IMG.h, x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(W, x + w), y1 = Math.min(H, y + h);
    var res = { n: 0, sum: 0, sum2: 0, min: Infinity, max: -Infinity, atLo: 0, atHi: 0, outside: x0 > x || y0 > y || x1 < x + w || y1 < y + h };
    if (x1 <= x0 || y1 <= y0) return res;
    var list = wantList ? new Float64Array((x1 - x0) * (y1 - y0)) : null, k = 0, v = IMG.vals;
    var satLo = IMG.lo, satHi = IMG.hi, sat = !IMG.float && IMG.colour !== 'mean' && satLo !== null && satLo !== undefined;
    for (var yy = y0; yy < y1; yy++) {
      var row = yy * W;
      for (var xx = x0; xx < x1; xx++) {
        var a = v[row + xx];
        res.sum += a; res.sum2 += a * a;
        if (a < res.min) res.min = a;
        if (a > res.max) res.max = a;
        if (sat) { if (a <= satLo) res.atLo++; else if (a >= satHi) res.atHi++; }
        if (list) list[k++] = a;
      }
    }
    res.n = (x1 - x0) * (y1 - y0);
    res.mean = res.sum / res.n;
    res.sd = res.n > 1 ? Math.sqrt(Math.max(0, (res.sum2 - res.sum * res.sum / res.n) / (res.n - 1))) : 0;
    if (list) { list.sort(); res.median = res.n % 2 ? list[(res.n - 1) / 2] : (list[res.n / 2 - 1] + list[res.n / 2]) / 2; }
    return res;
  }

  function overlap(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }

  // all numbers: R[rowId][lane] = { ... }
  var R = {};
  function compute() {
    R = {};
    if (!IMG) return;
    var allBands = [];
    P.rows.forEach(function (row) {
      row.bands.forEach(function (b) { if (b && !b.off) allBands.push({ x: b.x, y: b.y, w: row.w, h: row.h }); });
    });
    P.rows.forEach(function (row) {
      var out = R[row.id] = [];
      P.lanes.forEach(function (ln, i) {
        var b = row.bands[i];
        if (!b) { out.push(null); return; }
        var band = boxStats(b.x, b.y, row.w, row.h, false);
        var r = { x: b.x, y: b.y, bx: b.bx, by: b.by, off: !!b.off, band: band, bg: null, bgVal: 0, corr: null };
        if (P.bgStat !== 'none') {
          var bg = boxStats(b.bx, b.by, row.w, row.h, P.bgStat === 'median');
          r.bg = bg;
          r.bgVal = bg.n ? (P.bgStat === 'median' ? bg.median : bg.mean) : NaN;
          var me = { x: b.bx, y: b.by, w: row.w, h: row.h };
          r.bgHitsBand = allBands.some(function (o) { return overlap(me, o); });
        }
        if (band.n) {
          var nb = band.n * r.bgVal;
          r.corr = P.polarity === 'dark' ? nb - band.sum : band.sum - nb;
          if (r.bg && r.bg.n) {
            var noise = r.bg.sd * Math.sqrt(band.n);
            r.weak = r.corr > 0 && noise > 0 && r.corr < SIGNAL_SNR * noise;
          }
          r.sat = P.polarity === 'dark' ? band.atLo : band.atHi;
        }
        out.push(r);
      });
    });
    // normalise
    P.rows.forEach(function (row) {
      var out = R[row.id], ctrl = row.role === 'target' && row.ctrl ? R[row.ctrl] : null;
      out.forEach(function (r, i) {
        if (!r || r.off || r.corr === null) return;
        if (ctrl) {
          var c = ctrl[i];
          r.ctrlCorr = c && !c.off && c.corr !== null ? c.corr : null;
          r.norm = r.ctrlCorr ? r.corr / r.ctrlCorr : null;
        } else r.norm = r.corr;
      });
      var ref = out[P.ref];
      var refNorm = ref && !ref.off && ref.norm !== null && ref.norm !== undefined ? ref.norm : null;
      out.forEach(function (r) {
        if (!r || r.off || r.norm === null || r.norm === undefined) return;
        r.rel = refNorm ? r.norm / refNorm : null;
      });
    });
  }

  function rowById(id) { for (var i = 0; i < P.rows.length; i++) if (P.rows[i].id === id) return P.rows[i]; return null; }
  function controls() { return P.rows.filter(function (r) { return r.role === 'control'; }); }
  function placed(row) { return row.bands.filter(function (b) { return b; }).length; }

  /* ===================================================================
     checks
     =================================================================== */
  function lanesText(list) {
    if (list.length > 4) return list.slice(0, 3).join(', ') + ' and ' + (list.length - 3) + ' more';
    return list.join(', ');
  }
  function checks() {
    var out = [];
    function add(k, lbl, val) { out.push({ k: k, lbl: lbl, val: val }); }
    if (!IMG) return out;
    // the file
    if (IMG.lossy) add('warn', 'FILE', 'JPEG/WebP compression changes pixel values. Quantify the original TIFF or PNG from your imager if you have it.');
    else if (IMG.colour === 'mean') add('warn', 'FILE', 'Colour image: measured as (R + G + B) ÷ 3, as ImageJ does. A greyscale export from the imager is better.');
    else if (IMG.bits === 8 && IMG.format !== 'project') add('info', 'FILE', '8-bit image. If your imager saved a 16-bit original, quantify that — 8-bit exports are often contrast-adjusted.');
    else add('pass', 'FILE', IMG.kind + ' · raw values read from the file.');
    if (IMG.flipped) add('info', 'VALUES', 'White-is-zero TIFF: values flipped (maximum − value) so they match the image as shown.');
    if (IMG.pages > 1) add('info', 'PAGES', 'Multi-page TIFF: page 1 of ' + IMG.pages + ' is measured.');
    if (IMG.alpha) add('warn', 'FILE', 'The image has transparency; transparent pixels are measured by their grey value only.');
    if (P.polarity !== IMG.suggest) add('warn', 'BANDS', 'Most of this image looks ' + (IMG.suggest === 'dark' ? 'light — bands are usually dark here' : 'dark — bands are usually light here') + '. Check BANDS ARE in step 04.');

    var any = false, satL = [], outL = [], negL = [], bgHit = [], weakL = [];
    P.rows.forEach(function (row) {
      (R[row.id] || []).forEach(function (r, i) {
        if (!r || r.off) return;
        any = true;
        var tag = row.name + ' · ' + laneLabel(i);
        if (r.band.outside || (r.bg && r.bg.outside)) outL.push(tag);
        if (r.sat) satL.push(tag + ' (' + r.sat + ' px)');
        if (r.corr !== null && r.corr <= 0) negL.push(tag);
        if (r.bgHitsBand) bgHit.push(tag);
        if (r.weak) weakL.push(tag);
      });
    });
    if (!any) { add('info', 'BOXES', 'No bands placed yet. Use PLACE ROW in step 03.'); return out; }
    if (outL.length) add('fail', 'OUTSIDE', 'Box reaches past the image edge: ' + lanesText(outL) + '. Move it inside.');
    if (satL.length) add('fail', 'SATURATED', 'Pixels at the detector limit in ' + lanesText(satL) + '. These bands are underestimated — re-image with a shorter exposure.');
    else if (!IMG.float && IMG.colour !== 'mean') add('pass', 'SATURATED', 'No pixel in any band is at the ' + (P.polarity === 'dark' ? 'minimum (' + IMG.lo + ')' : 'maximum (' + IMG.hi + ')') + ' value.');
    if (negL.length) add('warn', 'NEGATIVE', 'Zero or below background: ' + lanesText(negL) + '. Reported as is, not set to zero. Check the box and background positions.');
    if (bgHit.length) add('warn', 'BACKGROUND', 'Background box overlaps a band in ' + lanesText(bgHit) + '. Move it to empty membrane.');
    else if (P.bgStat !== 'none') add('pass', 'BACKGROUND', 'Every background box sits off the bands (' + P.bgStat + ' of an equal-size box).');
    else add('warn', 'BACKGROUND', 'No background subtracted: values are raw integrated density.');
    if (weakL.length) add('warn', 'WEAK', 'Within 3× background noise: ' + lanesText(weakL) + '. Treat these values with care.');

    P.rows.forEach(function (row) {
      var n = placed(row);
      if (n && n < P.lanes.length) add('warn', 'MISSING', row.name + ': ' + (P.lanes.length - n) + ' lane(s) without a box. PLACE ROW again or EXCLUDE the lane.');
      if (row.role === 'target' && !row.ctrl) add('info', 'NORMALISED', row.name + ' is not normalised to a loading control — values are relative to ' + laneLabel(P.ref) + ' only.');
      if (row.role === 'control') {
        var vals = (R[row.id] || []).filter(function (r) { return r && !r.off && r.corr > 0; }).map(function (r) { return r.corr; });
        if (vals.length > 1) {
          var hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals);
          if (hi / lo > 1.5) add('info', 'LOADING', row.name + ' varies ' + sig(hi / lo, 2) + '-fold between lanes. Normalising corrects for it, but a large spread points to uneven loading or transfer.');
        }
      }
      var ref = (R[row.id] || [])[P.ref];
      if (n && (!ref || ref.off || !ref.rel)) add('fail', 'REFERENCE', row.name + ': the reference lane (' + laneLabel(P.ref) + ') has no usable value, so nothing can be expressed relative to it.');
    });
    return out;
  }
  var RANK = { pass: 0, info: 0, warn: 1, fail: 2 };
  function worst(list) { var k = 'pass'; list.forEach(function (c) { if (RANK[c.k] > RANK[k]) k = c.k; }); return k; }

  /* ===================================================================
     preview: base image canvas + overlay canvas
     =================================================================== */
  var base = $('base'), over = $('over'), wrap = $('canvasWrap'), stage = $('stage');
  var sc = 1;          // canvas px per image px
  var selB = null;     // { rowId, lane, part: 'band' | 'bg' }
  var mode = null;     // { type: 'place', rowId, first }
  var drag = null;
  var hover = null;

  function drawBase() {
    if (!IMG) return;
    sc = Math.min(1, VIEW_MAX / Math.max(IMG.w, IMG.h));
    var cw = Math.max(1, Math.round(IMG.w * sc)), ch = Math.max(1, Math.round(IMG.h * sc));
    if (base.width !== cw || base.height !== ch) { base.width = over.width = cw; base.height = over.height = ch; }
    var ctx = base.getContext('2d'), im = ctx.createImageData(cw, ch), d = im.data, v = IMG.vals, W = IMG.w;
    var lo = DISP.lo, span = DISP.hi > DISP.lo ? DISP.hi - DISP.lo : 1, inv = DISP.invert;
    for (var y = 0; y < ch; y++) {
      var sy = Math.min(IMG.h - 1, Math.floor(y / sc)) * W, o = y * cw * 4;
      for (var x = 0; x < cw; x++) {
        var g = (v[sy + Math.min(W - 1, Math.floor(x / sc))] - lo) / span * 255;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        if (inv) g = 255 - g;
        d[o] = d[o + 1] = d[o + 2] = g; d[o + 3] = 255; o += 4;
      }
    }
    ctx.putImageData(im, 0, 0);
    applyZoom();
  }
  function applyZoom() {
    if (!IMG) { wrap.style.width = ''; return; }
    var avail = stage.clientWidth - 2;
    // fill the width, but keep a tall image within about 70% of the window height
    var fit = Math.max(160, Math.min(avail, window.innerHeight * 0.7 * IMG.w / IMG.h));
    var z = S.zoom === 'fit' ? 1 : +S.zoom;
    wrap.style.width = Math.round(fit * z) + 'px';
    stage.classList.toggle('zoomed', z > 1);
    drawOver();
  }
  function cssK() { var r = over.getBoundingClientRect(); return r.width ? over.width / r.width : 1; }

  var ROW_COLS = ['#2E9E5B', '#1E73BE', '#B4690E', '#8E3B9E', '#A3341F', '#17403D'];
  function rowColor(i) { return ROW_COLS[i % ROW_COLS.length]; }

  function drawOver() {
    var ctx = over.getContext('2d');
    ctx.clearRect(0, 0, over.width, over.height);
    if (!IMG) return;
    var k = cssK(), lw = 1.5 * k;
    ctx.save();
    ctx.scale(sc, sc);
    var px = 1 / sc; // canvas units per image px
    P.rows.forEach(function (row, ri) {
      var col = rowColor(ri);
      row.bands.forEach(function (b, i) {
        if (!b) return;
        var isSel = selB && selB.rowId === row.id && selB.lane === i;
        var rr = R[row.id] && R[row.id][i];
        // background box: dashed
        if (P.bgStat !== 'none' && !b.off) {
          ctx.setLineDash([4 * k * px, 3 * k * px]);
          ctx.lineWidth = (isSel && selB.part === 'bg' ? 2.5 : 1.2) * k * px;
          ctx.strokeStyle = rr && rr.bgHitsBand ? '#A3341F' : '#7A8284';
          strokeBox(ctx, b.bx, b.by, row.w, row.h, px);
          ctx.setLineDash([]);
        }
        // band box
        ctx.lineWidth = (isSel && selB.part === 'band' ? 3 : 1.6) * k * px;
        var bad = rr && (rr.band.outside || rr.sat);
        ctx.strokeStyle = b.off ? '#7A8284' : bad ? '#A3341F' : col;
        if (b.off) ctx.setLineDash([1.5 * k * px, 2.5 * k * px]);
        strokeBox(ctx, b.x, b.y, row.w, row.h, px);
        ctx.setLineDash([]);
        if (S.labels) {
          var fs = Math.max(9, Math.min(13, row.h * sc / k * 0.6)) * k * px;
          ctx.font = '600 ' + fs + 'px "IBM Plex Mono", ui-monospace, monospace';
          ctx.textBaseline = 'bottom';
          var t = String(i + 1);
          var tw = ctx.measureText(t).width;
          ctx.fillStyle = 'rgba(250,247,238,.88)';
          ctx.fillRect(b.x, b.y - fs * 1.15, tw + fs * 0.5, fs * 1.15);
          ctx.fillStyle = b.off ? '#5B6466' : bad ? '#A3341F' : col;
          ctx.fillText(t, b.x + fs * 0.25, b.y - fs * 0.05);
        }
      });
    });
    // placing a row: first point and guide
    if (mode && mode.type === 'place') {
      ctx.fillStyle = '#17403D'; ctx.strokeStyle = '#17403D';
      ctx.lineWidth = 1.5 * k * px;
      var r0 = 5 * k * px;
      if (mode.first) {
        ctx.beginPath(); ctx.arc(mode.first.x, mode.first.y, r0, 0, Math.PI * 2); ctx.fill();
        if (hover) {
          ctx.setLineDash([5 * k * px, 4 * k * px]);
          ctx.beginPath(); ctx.moveTo(mode.first.x, mode.first.y); ctx.lineTo(hover.x, hover.y); ctx.stroke();
          ctx.setLineDash([]);
          var n = P.lanes.length;
          for (var j = 1; j < n; j++) {
            var f = j / (n - 1);
            ctx.beginPath(); ctx.arc(mode.first.x + (hover.x - mode.first.x) * f, mode.first.y + (hover.y - mode.first.y) * f, r0 * 0.7, 0, Math.PI * 2); ctx.stroke();
          }
        }
      } else if (hover) {
        ctx.beginPath(); ctx.arc(hover.x, hover.y, r0, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();
  }
  function strokeBox(ctx, x, y, w, h, px) { ctx.strokeRect(x + 0, y + 0, w, h); }

  function toImg(e) {
    var r = over.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * IMG.w, y: (e.clientY - r.top) / r.height * IMG.h };
  }
  function hit(p) {
    var cands = [];
    P.rows.forEach(function (row) {
      row.bands.forEach(function (b, i) {
        if (!b) return;
        var pad = 2 / sc;
        if (p.x >= b.x - pad && p.x <= b.x + row.w + pad && p.y >= b.y - pad && p.y <= b.y + row.h + pad) cands.push({ rowId: row.id, lane: i, part: 'band' });
        if (P.bgStat !== 'none' && !b.off && p.x >= b.bx - pad && p.x <= b.bx + row.w + pad && p.y >= b.by - pad && p.y <= b.by + row.h + pad) cands.push({ rowId: row.id, lane: i, part: 'bg' });
      });
    });
    if (!cands.length) return null;
    if (selB) for (var i = 0; i < cands.length; i++) if (cands[i].rowId === selB.rowId && cands[i].lane === selB.lane && cands[i].part === selB.part) return cands[i];
    // a band beats a background box
    for (var j = 0; j < cands.length; j++) if (cands[j].part === 'band') return cands[j];
    return cands[0];
  }

  over.addEventListener('pointerdown', function (e) {
    if (!IMG) return;
    var p = toImg(e);
    if (mode && mode.type === 'place') {
      e.preventDefault();
      if (!mode.first && P.lanes.length > 1) { mode.first = p; drawOver(); renderPlaceHint(); return; }
      placeRow(rowById(mode.rowId), mode.first || p, p);
      mode = null; over.classList.remove('placing');
      changed(); return;
    }
    var h = hit(p);
    if (!h) { selB = null; refresh(); return; }
    e.preventDefault();
    selB = h;
    var row = rowById(h.rowId), b = row.bands[h.lane];
    drag = { h: h, sx: p.x, sy: p.y, moved: false, orig: row.bands.map(function (q) { return q ? { x: q.x, y: q.y, bx: q.bx, by: q.by } : null; }) };
    try { over.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    over.classList.add('dragging');
    refresh();
  });
  over.addEventListener('pointermove', function (e) {
    if (!IMG) return;
    var p = toImg(e);
    if (mode) { hover = p; drawOver(); return; }
    if (!drag) { over.classList.toggle('can-drag', !!hit(p)); return; }
    var dx = Math.round(p.x - drag.sx), dy = Math.round(p.y - drag.sy);
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 1) return;
    drag.moved = true;
    var row = rowById(drag.h.rowId), whole = $('moveRow').checked;
    row.bands.forEach(function (b, i) {
      if (!b) return;
      var o = drag.orig[i];
      if (drag.h.part === 'bg') {
        if (i === drag.h.lane || whole) { b.bx = o.bx + dx; b.by = o.by + dy; }
      } else if (i === drag.h.lane || whole) {
        b.x = o.x + dx; b.y = o.y + dy; b.bx = o.bx + dx; b.by = o.by + dy;
      }
    });
    compute(); drawOver();
    scheduleRender();
  });
  function endDrag() {
    if (!drag) return;
    var moved = drag.moved;
    drag = null; over.classList.remove('dragging');
    if (moved) changed(); else refresh();
  }
  over.addEventListener('pointerup', endDrag);
  over.addEventListener('pointercancel', endDrag);
  over.addEventListener('pointerleave', function () { if (mode) { hover = null; drawOver(); } });

  function nudge(dx, dy) {
    if (!selB) return false;
    var row = rowById(selB.rowId);
    if (!row) return false;
    var whole = $('moveRow').checked;
    row.bands.forEach(function (b, i) {
      if (!b || !(i === selB.lane || whole)) return;
      if (selB.part === 'bg') { b.bx += dx; b.by += dy; }
      else { b.x += dx; b.y += dy; b.bx += dx; b.by += dy; }
    });
    changed();
    return true;
  }
  document.addEventListener('keydown', function (e) {
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Escape' && mode) { mode = null; over.classList.remove('placing'); refresh(); return; }
    var step = e.shiftKey ? 10 : 1, m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (m && nudge(m[0], m[1])) e.preventDefault();
  });

  /* place a row of boxes evenly between the first and last lane centres */
  function placeRow(row, a, b) {
    var n = P.lanes.length;
    var dist = n > 1 ? Math.hypot(b.x - a.x, b.y - a.y) / (n - 1) : 0;
    if (!row.w || !row.h) {
      var w = n > 1 ? Math.round(dist * 0.72) : Math.round(Math.min(IMG.w, IMG.h) * 0.12);
      w = clamp(w, 4, IMG.w);
      row.w = w; row.h = clamp(Math.round(w * 0.42), 3, IMG.h);
    }
    var bands = [];
    for (var i = 0; i < n; i++) {
      var f = n > 1 ? i / (n - 1) : 0;
      var cx = a.x + (b.x - a.x) * f, cy = a.y + (b.y - a.y) * f;
      var x = Math.round(cx - row.w / 2), y = Math.round(cy - row.h / 2);
      var old = row.bands[i];
      var bb = { x: x, y: y, bx: 0, by: 0, off: old ? !!old.off : false };
      setBg(row, bb, S.bgPlace);
      bands.push(bb);
    }
    row.bands = bands;
  }
  function setBg(row, b, where) {
    var gap = Math.max(2, Math.round(row.h * 0.35));
    var up = b.y - row.h - gap, down = b.y + row.h + gap;
    b.bx = b.x;
    if (where === 'below') b.by = down + row.h <= IMG.h ? down : up;
    else b.by = up >= 0 ? up : down;
  }

  /* ===================================================================
     rendering the controls
     =================================================================== */
  function pressed(attr, val) {
    $$('[' + attr + ']').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute(attr) === String(val))); });
  }

  function renderFile() {
    var box = $('fileInfo');
    if (!IMG) { box.hidden = true; return; }
    box.hidden = false;
    $('fileName').textContent = IMG.name;
    $('fileMeta').textContent = [IMG.format === 'project' ? 'FROM PROJECT FILE' : IMG.format, bytes(IMG.size), IMG.w + ' × ' + IMG.h + ' px'].join(' · ');
    var rows = [
      ['TYPE', IMG.kind + (IMG.lossy ? ' · lossy' : '')],
      ['VALUES', sig(IMG.min, 6) + ' – ' + sig(IMG.max, 6) + (IMG.float ? '' : ' (of ' + IMG.lo + ' – ' + IMG.hi + ')')],
      ['AT MINIMUM · MAXIMUM', IMG.float || IMG.colour === 'mean' ? 'not checked' : big(IMG.atLo) + ' · ' + big(IMG.atHi) + ' px'],
      ['LOOKS LIKE', IMG.suggest === 'dark' ? 'dark bands on a light background' : 'light bands on a dark background'],
      ['SHA-256', IMG.hash ? IMG.hash.slice(0, 16) + '…' : '—']
    ];
    $('fileFacts').innerHTML = rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('');
  }

  function renderLanes() {
    $('laneCount').value = P.lanes.length;
    var ta = $('laneNames');
    if (document.activeElement !== ta) ta.value = P.lanes.join('\n').replace(/\n+$/, '');
    var opts = P.lanes.map(function (n, i) { return '<option value="' + i + '"' + (i === P.ref ? ' selected' : '') + '>' + esc((i + 1) + ' · ' + laneLabel(i)) + '</option>'; }).join('');
    $('refLane').innerHTML = opts;
  }

  function renderRows() {
    var host = $('rows');
    var ctrls = controls();
    host.innerHTML = P.rows.map(function (row, ri) {
      var n = placed(row), total = P.lanes.length;
      var st = !n ? '<span class="rs-none">NOT PLACED</span>' : n < total ? '<span class="rs-part">' + n + ' / ' + total + ' PLACED</span>' : '<span class="rs-ok">' + n + ' / ' + total + ' PLACED</span>';
      var ctrlSel = row.role === 'target'
        ? '<label class="field mono">NORMALISE TO<select data-f="ctrl"><option value="">— none —</option>' + ctrls.map(function (c) { return '<option value="' + c.id + '"' + (row.ctrl === c.id ? ' selected' : '') + '>' + esc(c.name || 'Control') + '</option>'; }).join('') + '</select></label>'
        : '<div class="field mono"><span>USED BY</span><span class="used-by">' + esc(P.rows.filter(function (t) { return t.ctrl === row.id; }).map(function (t) { return t.name; }).join(', ') || '—') + '</span></div>';
      var placing = mode && mode.rowId === row.id;
      return '<div class="row-card" data-row="' + row.id + '" style="--rc:' + rowColor(ri) + '">' +
        '<div class="row-head mono"><span class="sw"></span><span>ROW ' + (ri + 1) + '</span><span class="rs">' + st + '</span></div>' +
        '<div class="grid2">' +
          '<label class="field mono">NAME<input data-f="name" value="' + esc(row.name) + '" autocomplete="off" maxlength="40"></label>' +
          '<label class="field mono">ROLE<select data-f="role"><option value="target"' + (row.role === 'target' ? ' selected' : '') + '>Target</option><option value="control"' + (row.role === 'control' ? ' selected' : '') + '>Loading control</option></select></label>' +
          ctrlSel +
          '<div class="field mono"><span>BOX · W × H PX</span><span class="inline-pair"><input data-f="w" type="number" min="2" step="1" inputmode="numeric" value="' + (row.w || '') + '" placeholder="auto"><input data-f="h" type="number" min="2" step="1" inputmode="numeric" value="' + (row.h || '') + '" placeholder="auto"></span></div>' +
        '</div>' +
        '<div class="row-btns mono">' +
          '<button type="button" class="secondary small' + (placing ? ' is-on' : '') + '" data-act="place"' + (IMG ? '' : ' disabled') + '>' + (placing ? 'CANCEL' : n ? 'PLACE AGAIN' : 'PLACE ROW') + '</button>' +
          '<span class="row-links"><button type="button" class="linkish" data-act="bgup"' + (n ? '' : ' disabled') + '>BG ABOVE</button> · <button type="button" class="linkish" data-act="bgdown"' + (n ? '' : ' disabled') + '>BG BELOW</button> · <button type="button" class="linkish" data-act="del"' + (P.rows.length > 1 ? '' : ' disabled') + '>DELETE ROW</button></span>' +
        '</div>' +
      '</div>';
    }).join('');
  }
  function renderPlaceHint() {
    var el = $('placeHint');
    if (!mode) { el.hidden = true; return; }
    var row = rowById(mode.rowId);
    el.hidden = false;
    el.innerHTML = P.lanes.length < 2
      ? '<b>' + esc(row.name) + ':</b> click the middle of the band.'
      : !mode.first ? '<b>' + esc(row.name) + ':</b> click the middle of the band in lane 1 (' + esc(laneLabel(0)) + ').'
      : '<b>' + esc(row.name) + ':</b> now click the middle of the band in lane ' + P.lanes.length + ' (' + esc(laneLabel(P.lanes.length - 1)) + '). The lanes in between are spaced evenly.';
  }

  function renderSettings() {
    pressed('data-pol', P.polarity);
    pressed('data-bg', P.bgStat);
    pressed('data-zoom', S.zoom);
    pressed('data-bgplace', S.bgPlace);
    $('dispInvert').checked = DISP.invert;
    $('showLabels').checked = S.labels;
    if (IMG) {
      var a = IMG.float ? Math.min(IMG.min, DISP.lo) : IMG.lo !== null ? IMG.lo : IMG.min;
      var b = IMG.float ? Math.max(IMG.max, DISP.hi) : IMG.hi !== null ? IMG.hi : IMG.max;
      ['dispLo', 'dispHi'].forEach(function (id) { var el = $(id); el.min = a; el.max = b; el.step = IMG.float || IMG.colour === 'mean' ? (b - a) / 1000 : 1; el.disabled = false; });
      $('dispLo').value = DISP.lo; $('dispHi').value = DISP.hi;
      $('dispOut').textContent = sig(DISP.lo, 6) + ' – ' + sig(DISP.hi, 6);
    } else {
      $('dispLo').disabled = $('dispHi').disabled = true;
      $('dispOut').textContent = '';
    }
  }

  function renderSelected() {
    var box = $('selBox');
    var row = selB && rowById(selB.rowId), b = row && row.bands[selB.lane];
    if (!b) { box.hidden = true; return; }
    box.hidden = false;
    var r = R[row.id] && R[row.id][selB.lane];
    $('selTitle').textContent = row.name + ' · lane ' + (selB.lane + 1) + ' · ' + laneLabel(selB.lane) + (selB.part === 'bg' ? ' · background box' : '');
    $('selPos').textContent = 'BAND x ' + b.x + ', y ' + b.y + ' · BG x ' + b.bx + ', y ' + b.by + ' · ' + row.w + ' × ' + row.h + ' px';
    $('selExclude').textContent = b.off ? 'INCLUDE THIS LANE' : 'EXCLUDE THIS LANE';
    $('selVals').innerHTML = r && r.band.n ? [
      ['RAW INT. DEN.', big(r.band.sum)], ['BAND MEAN', sig(r.band.mean, 5)], ['BACKGROUND', P.bgStat === 'none' ? '—' : sig(r.bgVal, 5) + ' (' + P.bgStat + ')'],
      ['CORRECTED', big(r.corr)], ['RELATIVE', r.rel ? sig(r.rel, 3) : '—']
    ].map(function (x) { return '<div><dt>' + x[0] + '</dt><dd>' + x[1] + '</dd></div>'; }).join('') : '';
    drawProfile(row, b, r);
  }

  /* vertical profile through the selected box: mean across its width */
  function drawProfile(row, b, r) {
    var svg = $('profile');
    if (!r || !r.band.n) { svg.innerHTML = ''; return; }
    var top = Math.max(0, Math.min(b.y, b.by) - row.h), bot = Math.min(IMG.h, Math.max(b.y, b.by) + 2 * row.h);
    var x0 = Math.max(0, b.x), x1 = Math.min(IMG.w, b.x + row.w);
    if (x1 <= x0 || bot <= top) { svg.innerHTML = ''; return; }
    var ys = [], lo = Infinity, hi = -Infinity;
    for (var y = top; y < bot; y++) {
      var s = 0;
      for (var x = x0; x < x1; x++) s += IMG.vals[y * IMG.w + x];
      var m = s / (x1 - x0);
      ys.push(m); if (m < lo) lo = m; if (m > hi) hi = m;
    }
    if (P.bgStat !== 'none' && isFinite(r.bgVal)) { lo = Math.min(lo, r.bgVal); hi = Math.max(hi, r.bgVal); }
    var W = 300, H = 90, pad = 4, span = hi > lo ? hi - lo : 1, n = ys.length;
    function X(i) { return pad + i / Math.max(1, n - 1) * (W - 2 * pad); }
    function Y(v) { return H - pad - (v - lo) / span * (H - 2 * pad); }
    var pts = ys.map(function (v, i) { return X(i).toFixed(1) + ',' + Y(v).toFixed(1); }).join(' ');
    var band = '<rect x="' + X(b.y - top) + '" y="0" width="' + (X(b.y - top + row.h) - X(b.y - top)) + '" height="' + H + '" fill="var(--sample)" opacity=".45"/>';
    var bgr = P.bgStat !== 'none' ? '<rect x="' + X(b.by - top) + '" y="0" width="' + (X(b.by - top + row.h) - X(b.by - top)) + '" height="' + H + '" fill="none" stroke="#7A8284" stroke-dasharray="3 3"/>' +
      '<line x1="0" x2="' + W + '" y1="' + Y(r.bgVal) + '" y2="' + Y(r.bgVal) + '" stroke="#7A8284" stroke-dasharray="4 3"/>' : '';
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = band + bgr + '<polyline points="' + pts + '" fill="none" stroke="var(--ink)" stroke-width="1.5"/>';
  }

  function renderVerdict() {
    var el = $('verdict');
    if (!IMG) {
      el.className = 'status empty';
      el.innerHTML = '<div class="status-title">NO IMAGE YET</div><p>Open a blot image — the original TIFF or PNG from your imager — or try the sample blot.</p>';
      return;
    }
    var list = checks(), k = worst(list);
    var nb = 0;
    P.rows.forEach(function (row) { (R[row.id] || []).forEach(function (r) { if (r && !r.off && r.corr !== null) nb++; }); });
    var title = !nb ? 'PLACE THE BANDS' : k === 'fail' ? 'FIX BEFORE USING THESE NUMBERS' : k === 'warn' ? 'MEASURED · CHECK THE NOTES' : 'MEASURED · READY TO EXPORT';
    el.className = 'status ' + (!nb ? 'empty' : k);
    var ico = !nb ? '' : k === 'fail' ? '<span class="ico k-fail"></span>' : k === 'warn' ? '<span class="ico k-warn"></span>' : '<span class="ico k-pass"></span>';
    var nf = list.filter(function (c) { return c.k === 'fail'; }).length, nw = list.filter(function (c) { return c.k === 'warn'; }).length;
    el.innerHTML = '<div class="status-title">' + ico + title + '</div><p>' + (nb
      ? nb + ' band' + (nb === 1 ? '' : 's') + ' measured in ' + P.rows.filter(placed).length + ' row' + (P.rows.filter(placed).length === 1 ? '' : 's') + (nf ? ' · ' + nf + ' to fix' : '') + (nw ? ' · ' + nw + ' to check' : '') + '. Numbers come from the raw pixel values; the contrast you see does not change them.'
      : 'Choose PLACE ROW for each row in step 03, then click the first and the last band on the image.') + '</p>';
  }

  function renderChecks() {
    var ul = $('checks');
    ul.innerHTML = checks().map(function (c) {
      var word = { pass: 'PASS', warn: 'CHECK', fail: 'FIX', info: 'NOTE' }[c.k];
      return '<li class="k-' + c.k + '"><span><span class="ico"></span></span><span class="lbl">' + c.lbl + '</span><span class="val sans">' + esc(c.val) + '</span><span class="word">' + word + '</span></li>';
    }).join('');
  }

  function renderResults() {
    var host = $('results');
    var rows = P.rows.filter(placed);
    if (!IMG || !rows.length) { host.innerHTML = '<p class="hint sans">The table fills in as you place rows.</p>'; $('chart').innerHTML = ''; return; }
    var html = '<table class="rtab"><thead><tr><th>LANE</th><th>SAMPLE</th><th class="n">RAW INT. DEN.</th><th class="n">BG</th><th class="n">CORRECTED</th><th class="n">÷ CONTROL</th><th class="n t">RELATIVE</th></tr></thead>';
    rows.forEach(function (row) {
      var ri = P.rows.indexOf(row), ctrl = row.role === 'target' && row.ctrl ? rowById(row.ctrl) : null;
      html += '<tbody><tr class="rhead"><th colspan="7"><span class="sw" style="background:' + rowColor(ri) + '"></span>' + esc(row.name) +
        ' <small>' + (row.role === 'control' ? 'LOADING CONTROL' : ctrl ? 'NORMALISED TO ' + esc(ctrl.name.toUpperCase()) : 'NOT NORMALISED') + ' · ' + row.w + ' × ' + row.h + ' PX</small></th></tr>';
      (R[row.id] || []).forEach(function (r, i) {
        var cls = [];
        if (selB && selB.rowId === row.id && selB.lane === i) cls.push('is-sel');
        if (!r) { html += '<tr class="is-off"><td class="lane">' + (i + 1) + '</td><td>' + esc(laneLabel(i)) + '</td><td colspan="5" class="muted">no box</td></tr>'; return; }
        if (r.off) { html += '<tr class="is-off' + (cls.length ? ' ' + cls.join(' ') : '') + '" data-pick="' + row.id + ':' + i + '"><td class="lane">' + (i + 1) + '</td><td>' + esc(laneLabel(i)) + '</td><td colspan="5" class="muted">excluded</td></tr>'; return; }
        var flag = r.band.outside ? 'is-bad' : r.sat ? 'is-bad' : r.corr <= 0 || r.bgHitsBand || r.weak ? 'is-warn' : '';
        if (flag) cls.push(flag);
        var mark = r.sat ? ' <abbr title="' + r.sat + ' saturated pixels">SAT</abbr>' : r.band.outside ? ' <abbr title="box reaches past the image edge">EDGE</abbr>' : r.corr <= 0 ? ' <abbr title="zero or below background">≤ 0</abbr>' : r.weak ? ' <abbr title="within 3× background noise">WEAK</abbr>' : '';
        html += '<tr class="' + cls.join(' ') + '" data-pick="' + row.id + ':' + i + '"><td class="lane">' + (i + 1) + (i === P.ref ? '<sup>REF</sup>' : '') + '</td><td>' + esc(laneLabel(i)) + mark + '</td>' +
          '<td class="n">' + big(r.band.sum) + '</td><td class="n">' + (P.bgStat === 'none' ? '—' : sig(r.bgVal, 5)) + '</td>' +
          '<td class="n">' + big(r.corr) + '</td><td class="n">' + (row.role === 'target' && row.ctrl ? (r.norm !== null && r.norm !== undefined ? sig(r.norm, 4) : '—') : '') + '</td>' +
          '<td class="n t">' + (r.rel !== null && r.rel !== undefined ? sig(r.rel, 3) : '—') + '</td></tr>';
      });
      html += '</tbody>';
    });
    host.innerHTML = html + '</table>';
    $$('tr[data-pick]', host).forEach(function (tr) {
      tr.addEventListener('click', function () { var a = tr.getAttribute('data-pick').split(':'); selB = { rowId: a[0], lane: +a[1], part: 'band' }; refresh(); });
    });
    renderChart(rows);
  }

  function renderChart(rows) {
    var targets = rows.filter(function (r) { return r.role === 'target'; });
    if (!targets.length) targets = rows;
    var n = P.lanes.length, W = 640, H = 170, padL = 34, padB = 26, padT = 10;
    var maxV = 1;
    targets.forEach(function (row) { (R[row.id] || []).forEach(function (r) { if (r && r.rel > maxV) maxV = r.rel; }); });
    maxV = Math.ceil(maxV * 1.1 * 2) / 2;
    var gw = (W - padL) / n, bw = Math.min(26, gw * 0.8 / targets.length);
    function Y(v) { return padT + (1 - v / maxV) * (H - padT - padB); }
    var s = '';
    for (var t = 0; t <= maxV + 1e-9; t += maxV > 4 ? 1 : 0.5) {
      s += '<line x1="' + padL + '" x2="' + W + '" y1="' + Y(t) + '" y2="' + Y(t) + '" stroke="#1B2224" stroke-width="' + (t === 1 ? 1 : 0.5) + '"' + (t === 1 ? '' : ' stroke-dasharray="2 3"') + '/>' +
        '<text x="' + (padL - 6) + '" y="' + (Y(t) + 3) + '" text-anchor="end">' + sig(t, 2) + '</text>';
    }
    for (var i = 0; i < n; i++) {
      var gx = padL + i * gw + gw / 2;
      targets.forEach(function (row, j) {
        var r = R[row.id] && R[row.id][i];
        var x = gx - (targets.length * bw) / 2 + j * bw;
        if (r && !r.off && r.rel !== null && r.rel !== undefined) {
          var v = Math.max(0, r.rel);
          s += '<rect x="' + x.toFixed(1) + '" y="' + Y(v).toFixed(1) + '" width="' + (bw - 2).toFixed(1) + '" height="' + (Y(0) - Y(v)).toFixed(1) + '" fill="' + rowColor(P.rows.indexOf(row)) + '"><title>' + esc(row.name + ' · ' + laneLabel(i) + ' · ' + sig(r.rel, 3)) + '</title></rect>';
        }
      });
      s += '<text x="' + gx + '" y="' + (H - 9) + '" text-anchor="middle">' + (i + 1) + '</text>';
    }
    $('chart').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Relative band intensity by lane">' + s + '</svg>' +
      '<div class="chart-key mono">' + targets.map(function (row) { return '<span><i style="background:' + rowColor(P.rows.indexOf(row)) + '"></i>' + esc(row.name) + '</span>'; }).join('') + '<span class="muted">RELATIVE TO LANE ' + (P.ref + 1) + ' = 1</span></div>';
  }

  function renderButtons() {
    var any = IMG && P.rows.some(placed);
    ['dlCsv', 'dlProject', 'dlPng', 'copyTable', 'copyMethods', 'dlMacro'].forEach(function (id) { $(id).disabled = !any; });
    $('clearBtn').disabled = !IMG;
    $('addRow').disabled = P.rows.length >= 6;
  }

  var renderPending = false;
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(function () { renderPending = false; renderSelected(); renderResults(); renderChecks(); renderVerdict(); });
  }
  function refresh() {
    renderFile(); renderLanes(); renderRows(); renderPlaceHint(); renderSettings(); renderSelected();
    renderVerdict(); renderChecks(); renderResults(); renderButtons();
    $('stageEmpty').hidden = !!IMG;
    stage.classList.toggle('has-img', !!IMG);
    drawOver();
  }
  var saveTimer = null;
  function changed() {
    compute(); refresh();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(rememberLayout, 400);
  }

  /* remember the boxes for this image (not the image) so a reload can restore them */
  function fingerprint() { return IMG ? [IMG.name, IMG.size, IMG.w, IMG.h].join('|') : ''; }
  function layout() { return { lanes: P.lanes, ref: P.ref, polarity: P.polarity, bgStat: P.bgStat, rows: P.rows }; }
  function rememberLayout() {
    if (!IMG || !P.rows.some(placed)) return;
    S.last = { fp: fingerprint(), at: nowISO(), layout: JSON.parse(JSON.stringify(layout())) };
    S.bgStat = P.bgStat;
    save();
  }
  function applyLayout(L) {
    if (!L || !Array.isArray(L.lanes) || !Array.isArray(L.rows)) throw userError('This project file has no lanes or rows.');
    P.lanes = L.lanes.map(function (s) { return String(s || ''); }).slice(0, 60);
    if (!P.lanes.length) P.lanes = [''];
    P.ref = clamp(L.ref | 0, 0, P.lanes.length - 1);
    P.polarity = L.polarity === 'light' ? 'light' : 'dark';
    P.bgStat = ['mean', 'median', 'none'].indexOf(L.bgStat) >= 0 ? L.bgStat : 'mean';
    P.rows = L.rows.slice(0, 6).map(function (r) {
      var row = { id: String(r.id || uid()), name: String(r.name || 'Row'), role: r.role === 'control' ? 'control' : 'target', ctrl: String(r.ctrl || ''),
        w: r.w ? Math.max(2, r.w | 0) : null, h: r.h ? Math.max(2, r.h | 0) : null, bands: [] };
      for (var i = 0; i < P.lanes.length; i++) {
        var b = r.bands && r.bands[i];
        row.bands.push(b ? { x: b.x | 0, y: b.y | 0, bx: b.bx | 0, by: b.by | 0, off: !!b.off } : null);
      }
      return row;
    });
    var ids = P.rows.map(function (r) { return r.id; });
    P.rows.forEach(function (r) { if (r.ctrl && (ids.indexOf(r.ctrl) < 0 || rowById(r.ctrl).role !== 'control')) r.ctrl = ''; });
  }

  /* ===================================================================
     opening files
     =================================================================== */
  var opening = false;
  function setError(msg) { var el = $('fileError'); el.hidden = !msg; el.textContent = msg || ''; }

  function openFile(file) {
    if (!file || opening) return;
    setError('');
    file.slice(0, 16).arrayBuffer().then(function (head) {
      var k = kindOf(file.name, file.type) || sniff(new Uint8Array(head));
      if (k === 'project') return openProjectFile(file);
      if (k === 'vendor') throw userError('This is a vendor file format. Export the image from your imager software as TIFF (16-bit if offered), then open that.');
      if (!k) throw userError('This file type isn’t supported. Open a TIFF or PNG exported from your imager.');
      return file.arrayBuffer().then(function (buf) { return openImage(buf, file.name, file.type, k, file); });
    }).catch(fail);
  }
  function fail(e) {
    opening = false; $('drop').classList.remove('busy');
    setError(e && e.user ? e.message : 'Couldn’t open this file' + (e && e.message ? ' (' + e.message + ')' : '') + '.');
    if (!(e && e.user) && window.console) console.error(e);
  }

  function openImage(buf, name, type, k, file, project) {
    opening = true; $('drop').classList.add('busy');
    $('loadNote').textContent = 'Opening ' + name + '…';
    var p = k === 'PNG' ? decodePng(buf) : k === 'TIFF' ? decodeTiff(buf) : decodeBrowser(file || new Blob([buf], { type: type }), k);
    return p.then(function (m) {
      m.name = name; m.type = type; m.size = buf.byteLength; m.bytes = buf;
      imageStats(m);
      return sha256(buf).then(function (h) { m.hash = h; return m; });
    }).then(function (m) {
      opening = false; $('drop').classList.remove('busy'); $('loadNote').textContent = '';
      IMG = m;
      var lo = m.p[0], hi = m.p[4];
      if (!(hi > lo)) { lo = m.min; hi = m.max > m.min ? m.max : m.min + 1; }
      DISP = { lo: lo, hi: hi, invert: false };
      selB = null; mode = null;
      var restore = $('restore');
      restore.hidden = true;
      if (project) {
        applyLayout(project.layout);
        if (project.display) DISP = Object.assign(DISP, project.display);
        if (project.image && project.image.sha256 && m.hash && project.image.sha256 !== m.hash) setError('Warning: the image in this project file does not match its recorded fingerprint. The numbers may differ from the saved ones.');
      } else {
        var keepLanes = P.lanes.slice();
        P = newProject(keepLanes.length);
        P.lanes = keepLanes;
        P.polarity = m.suggest;
        if (S.last && S.last.fp === fingerprint() && S.last.layout) {
          restore.hidden = false;
          $('restoreWhen').textContent = S.last.at ? S.last.at.slice(0, 16).replace('T', ' ') + ' UTC' : '';
        }
      }
      compute(); drawBase(); refresh();
      if (project && project.results) verifySaved(project.results);
    }).catch(fail);
  }

  function openProjectFile(file) {
    return file.text().then(function (txt) {
      var pj;
      try { pj = JSON.parse(txt); } catch (e) { throw userError('This JSON file could not be read.'); }
      if (!pj || pj.app !== 'labmate.tools/blot-densitometry') throw userError('This is not a Blot Densitometry project file.');
      if (!pj.image || !pj.image.data) throw userError('This project file has no image in it.');
      var buf = unb64(pj.image.data);
      var k = sniff(new Uint8Array(buf.slice(0, 8))) || kindOf(pj.image.name, pj.image.type);
      return openImage(buf, pj.image.name || 'image', pj.image.type || '', k, null, pj);
    });
  }

  // reopening a project recomputes everything; say whether it matches
  function verifySaved(saved) {
    var diff = 0, n = 0;
    saved.forEach(function (s) {
      var row = P.rows.filter(function (r) { return r.id === s.row; })[0];
      var r = row && R[row.id] && R[row.id][s.lane];
      if (!r || r.corr === null || !isFinite(s.corrected)) return;
      n++;
      if (Math.abs(r.corr - s.corrected) > 1e-6 * Math.max(1, Math.abs(s.corrected))) diff++;
    });
    $('loadNote').textContent = n ? (diff ? 'Project reopened — ' + diff + ' of ' + n + ' values differ from the saved file (different algorithm or image).' : 'Project reopened — all ' + n + ' values recomputed and match the saved file ✓') : '';
  }

  /* ===================================================================
     sample blot (16-bit, dark bands on a light background)
     =================================================================== */
  function sampleBlot() {
    var w = 960, h = 440, v = new Uint16Array(w * h), seed = 7;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    function gauss() { return Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()); }
    var lanes = 6, x0 = 130, dx = 140;
    var tgt = [1, 0.48, 0.3, 0.86, 1.55, 2.6], act = [1, 0.96, 1.07, 0.9, 1.08, 1.02];
    var img = new Float64Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) img[y * w + x] = 52000 - 2600 * (x / w) - 1500 * Math.abs(y / h - 0.5);
    function band(cx, cy, bw, bh, amp) {
      for (var y2 = Math.max(0, Math.round(cy - bh * 2)); y2 < Math.min(h, cy + bh * 2); y2++) for (var x2 = Math.max(0, Math.round(cx - bw)); x2 < Math.min(w, cx + bw); x2++) {
        var ux = (x2 - cx) / (bw * 0.5), uy = (y2 - cy) / (bh * 0.5);
        var fx = Math.exp(-Math.pow(Math.abs(ux), 6)), fy = Math.exp(-uy * uy * 1.4) * (1 + 0.12 * Math.sin(ux * 2.2));
        img[y2 * w + x2] -= amp * fx * fy;
      }
    }
    for (var i = 0; i < lanes; i++) {
      var cx = x0 + i * dx + (i - 2.5) * 1.2;
      band(cx, 132 + i * 1.5, 92, 26, 15500 * tgt[i] * (i === 5 ? 1.55 : 1));
      band(cx, 322 + i * 1.0, 96, 22, 21000 * act[i]);
      band(cx, 214, 80, 10, 1800 + 300 * i); // faint non-specific band
    }
    for (var k = 0; k < w * h; k++) v[k] = clamp(Math.round(img[k] + gauss() * 420), 0, 65535);
    return { w: w, h: h, vals: v, lanes: ['Ctrl', 'siRNA 1', 'siRNA 2', 'Drug 1 µM', 'Drug 10 µM', 'Drug 50 µM'], x0: x0, dx: dx };
  }
  function loadSample() {
    var sb = sampleBlot();
    var buf = tiff16(sb.w, sb.h, sb.vals, 'labmate.tools sample blot — 16-bit, fictional data');
    P.lanes = sb.lanes.slice();
    openImage(buf, 'sample-blot-16bit.tif', 'image/tiff', 'TIFF').then(function () {
      if (!IMG) return;
      P.lanes = sb.lanes.slice();
      var t = P.rows[0], c = P.rows[1];
      t.name = 'Protein X'; c.name = 'β-actin';
      t.w = 100; t.h = 40; c.w = 104; c.h = 36;
      placeRow(t, { x: sb.x0 - 3, y: 132 }, { x: sb.x0 + 5 * sb.dx + 3, y: 140 });
      placeRow(c, { x: sb.x0 - 3, y: 322 }, { x: sb.x0 + 5 * sb.dx + 3, y: 327 });
      $('sampleHint').hidden = false;
      changed();
    });
  }

  /* ===================================================================
     export
     =================================================================== */
  function baseName() { return (IMG ? IMG.name : 'blot').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w.\-]+/g, '_') || 'blot'; }
  function download(blob, name) {
    var a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }
  function csvCell(s) { s = String(s === null || s === undefined ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function resultRows() {
    var out = [];
    P.rows.forEach(function (row) {
      var ctrl = row.role === 'target' && row.ctrl ? rowById(row.ctrl) : null;
      (R[row.id] || []).forEach(function (r, i) {
        if (!r) return;
        var flags = [];
        if (r.off) flags.push('excluded');
        if (r.band.outside || (r.bg && r.bg.outside)) flags.push('outside image');
        if (r.sat) flags.push('saturated');
        if (r.corr !== null && r.corr <= 0 && !r.off) flags.push('at or below background');
        if (r.bgHitsBand) flags.push('background overlaps band');
        if (r.weak) flags.push('within 3x noise');
        out.push({ row: row, ctrl: ctrl, lane: i, r: r, flags: flags });
      });
    });
    return out;
  }
  function csvText() {
    var head = ['image', 'image_sha256', 'algorithm', 'bands_are', 'background', 'row', 'role', 'normalised_to', 'lane_no', 'lane', 'reference_lane', 'excluded',
      'x', 'y', 'w', 'h', 'bg_x', 'bg_y', 'area_px', 'raw_int_den', 'band_mean', 'band_min', 'band_max', 'saturated_px', 'bg_value', 'bg_sd',
      'corrected', 'control_corrected', 'normalised', 'relative', 'flags'];
    var lines = [head.join(',')];
    resultRows().forEach(function (q) {
      var r = q.r, row = q.row;
      lines.push([IMG.name, IMG.hash, ALGO, P.polarity === 'dark' ? 'dark on light' : 'light on dark', P.bgStat === 'none' ? 'none' : 'local box ' + P.bgStat,
        row.name, row.role, q.ctrl ? q.ctrl.name : '', q.lane + 1, laneLabel(q.lane), laneLabel(P.ref), r.off ? 'yes' : 'no',
        r.x, r.y, row.w, row.h, P.bgStat === 'none' ? '' : r.bx, P.bgStat === 'none' ? '' : r.by, r.band.n, plain(r.band.sum), plain(r.band.mean), plain(r.band.min), plain(r.band.max),
        IMG.float || IMG.colour === 'mean' ? '' : r.sat || 0, P.bgStat === 'none' ? '' : plain(r.bgVal), r.bg ? plain(r.bg.sd) : '',
        r.off ? '' : plain(r.corr), r.off ? '' : plain(r.ctrlCorr), r.off ? '' : plain(q.ctrl ? r.norm : null), r.off ? '' : plain(r.rel), q.flags.join('; ')
      ].map(csvCell).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }
  function tsvText() {
    var lines = ['Row\tLane\tSample\tRaw int. den.\tBackground\tCorrected\t÷ control\tRelative'];
    resultRows().forEach(function (q) {
      var r = q.r;
      lines.push([q.row.name, q.lane + 1, laneLabel(q.lane), r.off ? 'excluded' : plain(r.band.sum), r.off || P.bgStat === 'none' ? '' : plain(r.bgVal),
        r.off ? '' : plain(r.corr), r.off || !q.ctrl ? '' : plain(r.norm), r.off ? '' : plain(r.rel)].join('\t'));
    });
    return lines.join('\n');
  }
  function methodsText() {
    var targets = P.rows.filter(function (r) { return r.role === 'target' && placed(r); });
    var bitsTxt = IMG.colour === 'mean' ? 'colour image (measured as the mean of R, G and B)' : IMG.kind.replace(/^grey /, '') + ' image';
    var s = 'Band intensities were measured with labmate.tools Blot Densitometry (' + ALGO + ') on the unmodified ' + bitsTxt +
      ' as integrated density (sum of pixel values) in equal-size rectangles for each protein';
    s += P.bgStat === 'none' ? ', without background subtraction.' : ', minus local background (the ' + P.bgStat + ' of an equal-size rectangle on empty membrane next to each band, multiplied by the band area).';
    targets.forEach(function (t) {
      var c = t.ctrl ? rowById(t.ctrl) : null;
      s += ' ' + t.name + (c ? ' was normalised to ' + c.name + ' in the same lane and' : ' was') + ' expressed relative to ' + laneLabel(P.ref) + '.';
    });
    return s;
  }
  function projectJson() {
    var res = resultRows().filter(function (q) { return !q.r.off && q.r.corr !== null; }).map(function (q) {
      return { row: q.row.id, lane: q.lane, raw_int_den: q.r.band.sum, bg_value: q.r.bgVal, corrected: q.r.corr, relative: q.r.rel };
    });
    return JSON.stringify({
      app: 'labmate.tools/blot-densitometry', version: 1, algorithm: ALGO, saved: nowISO(),
      note: 'Open this file in https://labmate.tools/tools/blot-densitometry/ to see the image, the boxes and the numbers again. It is a working record, not a tamper-proof audit file.',
      image: { name: IMG.name, type: IMG.type, size: IMG.size, w: IMG.w, h: IMG.h, kind: IMG.kind, sha256: IMG.hash, data: b64(IMG.bytes) },
      layout: layout(), display: DISP, results: res
    });
  }
  function imagejMacro() {
    var L = ['// labmate.tools Blot Densitometry — the same boxes as ImageJ / Fiji ROIs',
      '// 1. Open the unchanged image: ' + IMG.name + ' (' + IMG.w + ' x ' + IMG.h + ' px)',
      '// 2. Plugins › Macros › Run… this file. RawIntDen in the Results table should match raw_int_den in the CSV.',
      '// ' + (IMG.colour === 'mean' ? 'Colour image: ImageJ measures RGB as (R+G+B)/3 unless weighted conversion is on (Edit › Options › Conversions).' : 'Values are measured on the raw pixel values; no calibration is applied.'),
      'if (getWidth() != ' + IMG.w + ' || getHeight() != ' + IMG.h + ') exit("This is not the ' + IMG.w + ' x ' + IMG.h + ' image the boxes were drawn on.");',
      'run("Set Measurements...", "area mean min integrated display redirect=None decimal=3");',
      'run("Clear Results");',
      'roiManager("reset");'];
    function rect(x, y, w, h, name) {
      L.push('makeRectangle(' + x + ', ' + y + ', ' + w + ', ' + h + '); roiManager("Add"); roiManager("Select", roiManager("count") - 1); roiManager("Rename", "' + name.replace(/"/g, "'") + '"); run("Measure"); setResult("Label", nResults - 1, "' + name.replace(/"/g, "'") + '");');
    }
    P.rows.forEach(function (row) {
      row.bands.forEach(function (b, i) {
        if (!b || b.off) return;
        var nm = row.name + ' | lane ' + (i + 1) + ' ' + laneLabel(i);
        rect(b.x, b.y, row.w, row.h, nm + ' | band');
        if (P.bgStat !== 'none') rect(b.bx, b.by, row.w, row.h, nm + ' | background');
      });
    });
    L.push('roiManager("Show All with labels");', 'updateResults();');
    return L.join('\n') + '\n';
  }
  function annotatedPng() {
    var k = Math.min(1, Math.sqrt(16e6 / (IMG.w * IMG.h)));
    var w = Math.round(IMG.w * k), h = Math.round(IMG.h * k), head = Math.max(28, Math.round(w * 0.035));
    var c = document.createElement('canvas'); c.width = w; c.height = h + head;
    var ctx = c.getContext('2d');
    ctx.drawImage(base, 0, 0, base.width, base.height, 0, head, w, h);
    ctx.fillStyle = '#FAF7EE'; ctx.fillRect(0, 0, w, head);
    var fs = Math.round(head * 0.42);
    ctx.font = '500 ' + fs + 'px "IBM Plex Mono", ui-monospace, monospace'; ctx.fillStyle = '#1B2224'; ctx.textBaseline = 'middle';
    ctx.fillText(IMG.name + ' · ' + ALGO + ' · display contrast only — numbers from raw values', fs * 0.6, head / 2);
    ctx.save(); ctx.translate(0, head); ctx.scale(k, k);
    var lw = Math.max(1, 1.6 / k * (w / 1200));
    P.rows.forEach(function (row, ri) {
      row.bands.forEach(function (b, i) {
        if (!b) return;
        if (P.bgStat !== 'none' && !b.off) { ctx.setLineDash([4 * lw, 3 * lw]); ctx.strokeStyle = '#7A8284'; ctx.lineWidth = lw; ctx.strokeRect(b.bx, b.by, row.w, row.h); ctx.setLineDash([]); }
        ctx.strokeStyle = b.off ? '#7A8284' : rowColor(ri); ctx.lineWidth = lw * 1.4; ctx.strokeRect(b.x, b.y, row.w, row.h);
        var f2 = Math.max(10, row.h * 0.5);
        ctx.font = '600 ' + f2 + 'px "IBM Plex Mono", ui-monospace, monospace'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(250,247,238,.9)'; var t = String(i + 1), tw = ctx.measureText(t).width;
        ctx.fillRect(b.x, b.y - f2 * 1.15, tw + f2 * 0.5, f2 * 1.15);
        ctx.fillStyle = b.off ? '#5B6466' : rowColor(ri); ctx.fillText(t, b.x + f2 * 0.25, b.y - f2 * 0.05);
      });
    });
    ctx.restore();
    return new Promise(function (res) { c.toBlob(function (b) { c.width = c.height = 0; res(b); }, 'image/png'); });
  }
  function copy(text, btn) {
    var done = function () { var t = btn.innerHTML; btn.innerHTML = 'COPIED ✓'; setTimeout(function () { btn.innerHTML = t; }, 1400); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
      ta.remove();
    }
  }

  /* ===================================================================
     wiring
     =================================================================== */
  var input = $('fileInput'), drop = $('drop');
  input.addEventListener('change', function () { if (input.files[0]) openFile(input.files[0]); input.value = ''; });
  ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]); });
  document.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    if (e.defaultPrevented || !e.dataTransfer || !e.dataTransfer.files[0]) return;
    e.preventDefault(); openFile(e.dataTransfer.files[0]);
  });
  $('sampleBtn').addEventListener('click', loadSample);
  $('clearBtn').addEventListener('click', function () {
    IMG = null; selB = null; mode = null; var n = P.lanes.length; var names = P.lanes.slice();
    P = newProject(n); P.lanes = names;
    base.width = over.width = 1; base.height = over.height = 1;
    $('sampleHint').hidden = true; $('restore').hidden = true; $('loadNote').textContent = ''; setError('');
    compute(); refresh(); applyZoom();
  });
  $('restoreBtn').addEventListener('click', function () {
    try { applyLayout(S.last.layout); } catch (e) { setError(e.message); return; }
    $('restore').hidden = true; changed();
  });
  $('restoreNo').addEventListener('click', function () { $('restore').hidden = true; });

  // 02 lanes
  function setLaneCount(n) {
    n = clamp(n | 0, 1, 60);
    while (P.lanes.length < n) P.lanes.push('');
    P.lanes.length = n;
    P.rows.forEach(function (row) { while (row.bands.length < n) row.bands.push(null); row.bands.length = n; });
    if (P.ref >= n) P.ref = 0;
  }
  $('laneCount').addEventListener('change', function () { setLaneCount(+this.value || 1); changed(); });
  $('laneNames').addEventListener('input', function () {
    var lines = this.value.split(/\r?\n/).map(function (s) { return s.split('\t')[0].trim(); });
    while (lines.length > 1 && !lines[lines.length - 1]) lines.pop();
    if (lines.length > P.lanes.length) setLaneCount(lines.length);
    for (var i = 0; i < P.lanes.length; i++) P.lanes[i] = lines[i] || '';
    compute(); renderLanes(); renderResults(); renderSelected(); renderChecks(); drawOver();
    $('laneCount').value = P.lanes.length;
    clearTimeout(saveTimer); saveTimer = setTimeout(rememberLayout, 600);
  });
  $('laneNames').addEventListener('blur', function () { renderLanes(); });
  $('refLane').addEventListener('change', function () { P.ref = +this.value; changed(); });

  // 03 rows
  $('rows').addEventListener('input', function (e) {
    var el = e.target, card = el.closest('[data-row]'), f = el.getAttribute('data-f');
    if (!card || !f) return;
    var row = rowById(card.getAttribute('data-row'));
    if (f === 'name') { row.name = el.value; compute(); renderResults(); renderChecks(); renderSelected(); return; }
  });
  $('rows').addEventListener('change', function (e) {
    var el = e.target, card = el.closest('[data-row]'), f = el.getAttribute('data-f');
    if (!card || !f) return;
    var row = rowById(card.getAttribute('data-row'));
    if (f === 'name') { changed(); return; }
    if (f === 'role') {
      row.role = el.value;
      if (row.role === 'control') { row.ctrl = ''; P.rows.forEach(function (r) { if (r.role === 'target' && !r.ctrl) r.ctrl = row.id; }); }
      else { P.rows.forEach(function (r) { if (r.ctrl === row.id) r.ctrl = ''; }); var c = controls()[0]; row.ctrl = c ? c.id : ''; }
    }
    if (f === 'ctrl') row.ctrl = el.value;
    if (f === 'w' || f === 'h') {
      var v = Math.round(+el.value);
      if (!(v >= 2)) { el.value = row[f] || ''; return; }
      v = Math.min(v, f === 'w' ? IMG ? IMG.w : 1e5 : IMG ? IMG.h : 1e5);
      var old = row[f];
      row[f] = v;
      if (old) row.bands.forEach(function (b) { // keep box centres; keep the background on the same side
        if (!b) return;
        var d = Math.round((v - old) / 2);
        if (f === 'w') { b.x -= d; b.bx -= d; }
        else { var above = b.by < b.y; b.y -= d; b.by = above ? b.by - d - (v - old) : b.by - d + (v - old); }
      });
    }
    changed();
  });
  $('rows').addEventListener('click', function (e) {
    var bt = e.target.closest('[data-act]'), card = e.target.closest('[data-row]');
    if (!bt || !card || bt.disabled) return;
    var row = rowById(card.getAttribute('data-row')), act = bt.getAttribute('data-act');
    if (act === 'place') {
      if (mode && mode.rowId === row.id) { mode = null; over.classList.remove('placing'); }
      else { mode = { type: 'place', rowId: row.id, first: null }; selB = null; over.classList.add('placing'); stage.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      refresh(); return;
    }
    if (act === 'bgup' || act === 'bgdown') { S.bgPlace = act === 'bgup' ? 'above' : 'below'; row.bands.forEach(function (b) { if (b) setBg(row, b, S.bgPlace); }); save(); changed(); return; }
    if (act === 'del') {
      P.rows = P.rows.filter(function (r) { return r !== row; });
      P.rows.forEach(function (r) { if (r.ctrl === row.id) r.ctrl = ''; });
      if (selB && selB.rowId === row.id) selB = null;
      if (mode && mode.rowId === row.id) mode = null;
      changed();
    }
  });
  $('addRow').addEventListener('click', function () {
    if (P.rows.length >= 6) return;
    var hasCtrl = controls().length, r = newRow(hasCtrl ? 'Target ' + (P.rows.filter(function (x) { return x.role === 'target'; }).length + 1) : 'Loading control', hasCtrl ? 'target' : 'control');
    if (r.role === 'target') r.ctrl = controls()[0].id;
    for (var i = 0; i < P.lanes.length; i++) r.bands.push(null);
    P.rows.push(r); changed();
  });

  // 04 measure
  $$('[data-pol]').forEach(function (b) { b.addEventListener('click', function () { P.polarity = b.getAttribute('data-pol'); changed(); }); });
  $$('[data-bg]').forEach(function (b) { b.addEventListener('click', function () { P.bgStat = b.getAttribute('data-bg'); S.bgStat = P.bgStat; save(); changed(); }); });

  // display
  var dispRaf = false;
  function onDisp() {
    var lo = +$('dispLo').value, hi = +$('dispHi').value;
    if (hi <= lo) { if (this.id === 'dispLo') lo = hi - (+$('dispLo').step || 1); else hi = lo + (+$('dispHi').step || 1); }
    DISP.lo = lo; DISP.hi = hi;
    $('dispOut').textContent = sig(lo, 6) + ' – ' + sig(hi, 6);
    if (!dispRaf) { dispRaf = true; requestAnimationFrame(function () { dispRaf = false; drawBase(); }); }
  }
  $('dispLo').addEventListener('input', onDisp);
  $('dispHi').addEventListener('input', onDisp);
  $('dispAuto').addEventListener('click', function () {
    if (!IMG) return;
    DISP.lo = IMG.p[0]; DISP.hi = IMG.p[4] > IMG.p[0] ? IMG.p[4] : IMG.max;
    drawBase(); renderSettings();
  });
  $('dispFull').addEventListener('click', function () {
    if (!IMG) return;
    DISP.lo = IMG.lo !== null && IMG.lo !== undefined ? IMG.lo : IMG.min; DISP.hi = IMG.hi !== null && IMG.hi !== undefined ? IMG.hi : IMG.max;
    drawBase(); renderSettings();
  });
  $('dispInvert').addEventListener('change', function () { DISP.invert = this.checked; drawBase(); });
  $('showLabels').addEventListener('change', function () { S.labels = this.checked; save(); drawOver(); });
  $$('[data-zoom]').forEach(function (b) { b.addEventListener('click', function () { S.zoom = b.getAttribute('data-zoom'); save(); pressed('data-zoom', S.zoom); applyZoom(); }); });
  window.addEventListener('resize', function () { if (IMG) applyZoom(); });

  // selected box
  $('selExclude').addEventListener('click', function () {
    var row = selB && rowById(selB.rowId), b = row && row.bands[selB.lane];
    if (!b) return;
    b.off = !b.off; changed();
  });
  $('selRef').addEventListener('click', function () { if (selB) { P.ref = selB.lane; changed(); } });
  $$('[data-nudge]').forEach(function (bt) {
    bt.addEventListener('click', function () { var a = bt.getAttribute('data-nudge').split(','); nudge(+a[0], +a[1]); });
  });

  // export
  $('dlCsv').addEventListener('click', function () { download(new Blob(['﻿' + csvText()], { type: 'text/csv;charset=utf-8' }), baseName() + '_densitometry.csv'); });
  $('dlProject').addEventListener('click', function () { download(new Blob([projectJson()], { type: 'application/json' }), baseName() + '.blot.json'); });
  $('dlMacro').addEventListener('click', function () { download(new Blob([imagejMacro()], { type: 'text/plain' }), baseName() + '_rois.ijm'); });
  $('dlPng').addEventListener('click', function () { annotatedPng().then(function (b) { if (b) download(b, baseName() + '_boxes.png'); }); });
  $('copyTable').addEventListener('click', function () { copy(tsvText(), this); });
  $('copyMethods').addEventListener('click', function () { copy(methodsText(), this); });

  // lane names handed over from Protein Loading
  if (window.LMH) {
    var got = LMH.take(TOOL);
    if (got && Array.isArray(got.lanes) && got.lanes.length) {
      P.lanes = got.lanes.slice(0, 60).map(function (s) { return String(s || ''); });
      P.rows.forEach(function (r) { r.bands = P.lanes.map(function () { return null; }); });
      LMH.note('Lane names for ' + P.lanes.length + ' lanes taken from ' + (got.from || 'Protein Loading') + '. Open the blot image to place the bands.', $('steps'));
    }
  }

  P.bgStat = S.bgStat || 'mean';
  P.rows.forEach(function (r) { r.bands = P.lanes.map(function () { return null; }); });
  refresh();

  // for tests
  window.__blot = { get P() { return P; }, get R() { return R; }, get IMG() { return IMG; }, csv: csvText, methods: methodsText, macro: imagejMacro, project: projectJson, placeRow: function (i, a, b) { placeRow(P.rows[i], a, b); changed(); }, changed: changed };
})();
