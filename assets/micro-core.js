/* labmate.tools — 8.2 Nyquist & Acquisition Calculator: pure calculations (no DOM).
 * window.LMM in the browser, require() in Node. Algorithm id: labmate-micro-1.
 * Units: wavelengths in nm, camera pixels and pinholes in µm, field numbers in mm,
 * tube lens focal lengths in mm. Results on the sample: pixel size, resolution and
 * Nyquist distances in nm, fields of view in µm.
 */
(function (root) {
  "use strict";
  var M = {};
  M.ALGO = "labmate-micro-1";

  // Tube lens focal length each maker designs its infinity objectives for (mm).
  M.TUBE = { nikon: 200, leica: 200, evident: 180, olympus: 180, zeiss: 165 };
  // Camera adapters (C-mount relay magnifications) commonly sold.
  M.ADAPTERS = [0.35, 0.38, 0.5, 0.55, 0.63, 0.7, 0.75, 1, 1.2, 1.5, 2, 2.5];
  M.BINNING = [1, 2, 3, 4];
  // A sampling distance this many times the Nyquist distance or finer counts as oversampled.
  M.OVER = 0.5;

  function pos(v) { return typeof v === "number" && isFinite(v) && v > 0; }
  M.pos = pos;

  // Half aperture angle α from NA = n sin α. null when NA ≥ n (impossible).
  M.alpha = function (na, n) {
    if (!pos(na) || !pos(n) || na >= n) return null;
    return Math.asin(na / n);
  };

  /* Nyquist critical sampling distances (nm).
   * mode: 'widefield' | 'confocal' (point scan) | 'disk' (spinning disk) | 'twophoton'
   * Widefield: detection OTF cut-off 2 NA / λem laterally and n(1 − cos α) / λem axially.
   * Confocal / disk: excitation × detection PSF doubles the cut-off; λex is used (stricter
   * than λem). Two-photon: squared excitation PSF at the infrared λex doubles it too. */
  M.nyquist = function (o) {
    var a = M.alpha(o.na, o.n);
    if (a === null) return null;
    var lat = o.n * Math.sin(a), ax = o.n * (1 - Math.cos(a));
    if (o.mode === "widefield") {
      if (!pos(o.lem)) return null;
      return { dx: o.lem / (4 * lat), dz: o.lem / (2 * ax), lambda: o.lem, which: "em" };
    }
    if (!pos(o.lex)) return null;
    return { dx: o.lex / (8 * lat), dz: o.lex / (4 * ax), lambda: o.lex, which: "ex" };
  };

  /* Rayleigh resolution (nm), for display — Nikon MicroscopyU resolution calculator, eqs. 8, 10, 17–20.
   * Widefield (epi): 0.61 λem / NA laterally; 2 n λem / NA² axially.
   * Confocal / disk: λex, scaled by the pinhole in Airy units (au, default 1):
   *   lateral C_lat(au) λex / NA for au ≤ 1.2, else 0.61 λex / NA;
   *   axial 1.43 n λex / NA² for au ≤ 0.3, 2 n C_ax(au) λex / NA² below 2.5 AU, else 2 n λex / NA².
   * Two-photon: no closed form here (null). */
  M.cLat = function (a) { return -0.2908 * Math.pow(a, 4) + 0.4884 * Math.pow(a, 3) - 0.0714 * a * a + 0.0298 * a + 0.4357; };
  M.cAx = function (a) {
    return -0.0765 * Math.pow(a, 6) + 0.6359 * Math.pow(a, 5) - 1.9752 * Math.pow(a, 4) + 2.7427 * Math.pow(a, 3) - 1.5335 * a * a + 0.2905 * a + 0.7143;
  };
  M.resolution = function (o) {
    if (M.alpha(o.na, o.n) === null) return null;
    var na2 = o.na * o.na;
    if (o.mode === "widefield") {
      if (!pos(o.lem)) return null;
      return { lat: 0.61 * o.lem / o.na, ax: 2 * o.n * o.lem / na2 };
    }
    if (o.mode === "twophoton" || !pos(o.lex)) return null;
    var au = typeof o.au === "number" && isFinite(o.au) && o.au >= 0 ? o.au : 1;
    var lat = (au <= 1.2 ? M.cLat(au) : 0.61) * o.lex / o.na;
    var ax = au <= 0.3 ? 1.43 * o.n * o.lex / na2 : au < 2.5 ? 2 * o.n * M.cAx(au) * o.lex / na2 : 2 * o.n * o.lex / na2;
    return { lat: lat, ax: ax, au: au };
  };

  // Magnification from the sample to the intermediate image, corrected for a stand
  // whose tube lens differs from the one the objective was designed for.
  M.objMag = function (mag, designTube, standTube) {
    if (!pos(mag)) return null;
    var r = pos(designTube) && pos(standTube) ? standTube / designTube : 1;
    return mag * r;
  };

  /* Camera path (widefield, spinning disk).
   * o: { mag, designTube, standTube, adapter, pix (µm), bin, px: [w, h], fn (mm), diag (mm) } */
  M.camera = function (o) {
    var m = M.objMag(o.mag, o.designTube, o.standTube);
    var ad = pos(o.adapter) ? o.adapter : 1, bin = pos(o.bin) ? o.bin : 1;
    if (!pos(m) || !pos(o.pix)) return null;
    var total = m * ad;
    var r = { totalMag: total, objMag: m, pixel: o.pix * bin / total * 1000 };
    if (o.px && pos(o.px[0]) && pos(o.px[1])) {
      var w = Math.floor(o.px[0] / bin), h = Math.floor(o.px[1] / bin);
      r.frame = [w, h];
      r.fov = [w * r.pixel / 1000, h * r.pixel / 1000];
      // sensor diagonal projected back to the intermediate image, mm
      var diag = pos(o.diag) ? o.diag : Math.sqrt(o.px[0] * o.px[0] + o.px[1] * o.px[1]) * o.pix / 1000;
      r.sensorDiag = diag;
      r.diagAtImage = diag / ad;
    }
    if (pos(o.fn)) {
      r.fieldDiam = o.fn / m * 1000; // µm on the sample
      if (r.diagAtImage) r.vignette = r.diagAtImage > o.fn * 1.0001;
    }
    return r;
  };

  /* Point-scanning confocal / two-photon.
   * o: { mag, designTube, standTube, field (mm diagonal of the square scan field at zoom 1, intermediate image),
   *      zoom, frame: [w, h] } — the square field's side is field / √2. */
  M.scan = function (o) {
    var m = M.objMag(o.mag, o.designTube, o.standTube);
    if (!pos(m) || !pos(o.field) || !pos(o.zoom) || !o.frame || !pos(o.frame[0])) return null;
    var side = o.field / Math.SQRT2 * 1000 / (m * o.zoom); // µm on the sample
    var w = o.frame[0], h = pos(o.frame[1]) ? o.frame[1] : w;
    var pixel = side / w * 1000; // nm
    return { objMag: m, side: side, pixel: pixel, fov: [w * pixel / 1000, h * pixel / 1000], frame: [w, h] };
  };

  // Zoom that brings the scan pixel to `target` nm (exact, not rounded).
  M.zoomFor = function (o, target) {
    var m = M.objMag(o.mag, o.designTube, o.standTube);
    if (!pos(m) || !pos(o.field) || !o.frame || !pos(o.frame[0]) || !pos(target)) return null;
    return o.field / Math.SQRT2 * 1e6 / (m * o.frame[0] * target);
  };

  // Round a zoom up to the next 0.1 (so the pixel never ends up coarser than wanted).
  M.zoomUp = function (z) { return Math.ceil(z * 10 - 1e-9) / 10; };

  // Spinning-disk pinhole projected on the sample, in Airy units (Airy disk diameter 1.22 λem / NA).
  M.diskAU = function (o) {
    var m = M.objMag(o.mag, o.designTube, o.standTube);
    var relay = pos(o.relay) ? o.relay : 1;
    if (!pos(m) || !pos(o.pinhole) || !pos(o.na) || !pos(o.lem)) return null;
    var onSample = o.pinhole / (m * relay) * 1000; // nm
    var airy = 1.22 * o.lem / o.na;
    var r = { pinholeOnSample: onSample, airy: airy, au: onSample / airy };
    if (pos(o.pitch)) { r.pitchOnSample = o.pitch / (m * relay) * 1000; r.pitchAU = r.pitchOnSample / airy; }
    return r;
  };

  // ratio = actual ÷ Nyquist. > 1 undersampled, M.OVER..1 at Nyquist, < M.OVER oversampled.
  M.verdict = function (actual, nyq) {
    if (!pos(actual) || !pos(nyq)) return null;
    var r = actual / nyq;
    return { ratio: r, state: r > 1 + 1e-9 ? "under" : r < M.OVER ? "over" : "ok" };
  };

  // Camera: the adapter and binning choices that reach Nyquist, smallest magnification first.
  M.cameraOptions = function (o, target) {
    var m = M.objMag(o.mag, o.designTube, o.standTube);
    if (!pos(m) || !pos(o.pix) || !pos(target)) return null;
    var need = o.pix / (target / 1000) / m; // adapter × (1 / bin) needed at bin 1
    var out = [];
    M.BINNING.forEach(function (b) {
      var a = M.ADAPTERS.filter(function (x) { return o.pix * b / (m * x) * 1000 <= target * (1 + 1e-9); })[0];
      if (a) out.push({ bin: b, adapter: a, pixel: o.pix * b / (m * a) * 1000 });
    });
    return { adapterNeeded: need, options: out };
  };

  // z stack: step (µm, rounded down to 0.01) and slices for a depth (µm).
  M.zPlan = function (dzNm, depthUm) {
    if (!pos(dzNm)) return null;
    var step = Math.floor(dzNm / 10 + 1e-9) / 100;
    if (step <= 0) step = dzNm / 1000;
    var r = { step: step };
    if (pos(depthUm)) r.slices = Math.ceil(depthUm / step - 1e-9) + 1;
    return r;
  };

  /* One full evaluation. s = {
   *   mode, na, n, mag, designTube, standTube,
   *   channels: [{ name, lex, lem }],
   *   camera: { pix, bin, px, diag, adapter }, scan: { field, zoom, frame }, disk: { pinhole, pitch, relay },
   *   manual: { pixel (nm) }, au (confocal pinhole, Airy units), zstep (µm), depth (µm), fn (mm),
   *   path: 'camera' | 'scan' | 'manual' } */
  M.evaluate = function (s) {
    var out = { ok: false, errors: [], channels: [] };
    if (!pos(s.na)) out.errors.push("na");
    if (!pos(s.n)) out.errors.push("n");
    if (pos(s.na) && pos(s.n) && s.na >= s.n) out.errors.push("na>=n");
    var chans = (s.channels || []).filter(function (c) {
      return s.mode === "widefield" ? pos(c.lem) : pos(c.lex);
    });
    if (!chans.length) out.errors.push("channels");
    if (out.errors.length) return out;

    chans.forEach(function (c) {
      var q = { mode: s.mode, na: s.na, n: s.n, lex: c.lex, lem: c.lem };
      var disk = null;
      if (s.mode === "confocal") q.au = pos(s.au) ? s.au : 1;
      if (s.mode === "disk" && s.disk) {
        disk = M.diskAU({ mag: s.mag, designTube: s.designTube, standTube: s.standTube, relay: s.disk.relay, pinhole: s.disk.pinhole, pitch: s.disk.pitch,
          na: s.na, lem: pos(c.lem) ? c.lem : c.lex });
        q.au = disk ? disk.au : 1;
      }
      out.channels.push({ name: c.name || "", lex: c.lex, lem: c.lem, nyq: M.nyquist(q), res: M.resolution(q), disk: disk });
    });
    // the strictest channel sets the target
    var strict = out.channels.reduce(function (a, b) { return b.nyq.dx < a.nyq.dx ? b : a; });
    var strictZ = out.channels.reduce(function (a, b) { return b.nyq.dz < a.nyq.dz ? b : a; });
    out.target = { dx: strict.nyq.dx, dz: strictZ.nyq.dz, channel: strict.name, channelZ: strictZ.name };

    var path = s.path || (s.mode === "confocal" || s.mode === "twophoton" ? "scan" : "camera");
    out.path = path;
    var geo = null;
    if (path === "manual") {
      if (pos(s.manual && s.manual.pixel)) geo = { pixel: s.manual.pixel };
    } else if (path === "scan") {
      var so = { mag: s.mag, designTube: s.designTube, standTube: s.standTube, field: s.scan && s.scan.field, zoom: s.scan && s.scan.zoom, frame: s.scan && s.scan.frame };
      geo = M.scan(so);
      var z = M.zoomFor(so, out.target.dx);
      if (z) out.zoom = { exact: z, up: M.zoomUp(z) };
    } else {
      var co = { mag: s.mag, designTube: s.designTube, standTube: s.standTube, adapter: s.camera && s.camera.adapter, pix: s.camera && s.camera.pix,
        bin: s.camera && s.camera.bin, px: s.camera && s.camera.px, diag: s.camera && s.camera.diag, fn: s.fn };
      geo = M.camera(co);
      out.cameraOptions = M.cameraOptions(co, out.target.dx);
    }
    out.geo = geo;
    if (geo) out.xy = M.verdict(geo.pixel, out.target.dx);
    if (pos(s.zstep)) out.z = M.verdict(s.zstep * 1000, out.target.dz);
    out.zPlan = M.zPlan(out.target.dz, s.depth);
    if (s.mode === "disk") out.disk = strict.disk;
    out.ok = true;
    return out;
  };

  // Validates a hardware entry (preset or user-made). Returns a list of problems (empty = fine).
  M.checkObjective = function (o) {
    var p = [];
    if (!o || !o.name) p.push("name");
    if (!pos(o && o.mag)) p.push("mag");
    if (!pos(o && o.na)) p.push("na");
    if (!pos(o && o.nImm)) p.push("nImm");
    if (o && pos(o.na) && pos(o.nImm) && o.na >= o.nImm) p.push("na>=n");
    return p;
  };
  M.checkCamera = function (c) {
    var p = [];
    if (!c || !c.name) p.push("name");
    if (!pos(c && c.pixel_um)) p.push("pixel_um");
    if (!(c && c.px && pos(c.px[0]) && pos(c.px[1]))) p.push("px");
    return p;
  };

  M.STORE_KEY = "labmate.microscopy.v1";

  if (typeof module !== "undefined" && module.exports) module.exports = M;
  if (root) root.LMM = M;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
