"""Independent reference numbers for assets/micro-core.js (8.2 Nyquist Calculator).
Written from the formulas on the page (SVI Nyquist rate eqs. 1, 4, 5; Nikon MicroscopyU resolution
calculator eqs. 8, 10, 17-20), not from the JavaScript. Run from the repo root:
    python3 tests/micro_reference.py   → tests/fixtures/micro/reference.json
"""
import json, math, os

def nyquist(mode, na, n, lex, lem):
    a = math.asin(na / n)
    k, lam = (1, lem) if mode == "widefield" else (2, lex)
    return {"dx": lam / (4 * k * n * math.sin(a)), "dz": lam / (2 * k * n * (1 - math.cos(a)))}

def c_lat(au): return -0.2908 * au**4 + 0.4884 * au**3 - 0.0714 * au**2 + 0.0298 * au + 0.4357
def c_ax(au): return -0.0765 * au**6 + 0.6359 * au**5 - 1.9752 * au**4 + 2.7427 * au**3 - 1.5335 * au**2 + 0.2905 * au + 0.7143

def resolution(mode, na, n, lex, lem, au=1.0):
    if mode == "widefield":
        return {"lat": 0.61 * lem / na, "ax": 2 * n * lem / na**2}
    if mode == "twophoton":
        return None
    lat = (c_lat(au) if au <= 1.2 else 0.61) * lex / na
    if au <= 0.3: ax = 1.43 * n * lex / na**2
    elif au < 2.5: ax = 2 * n * c_ax(au) * lex / na**2
    else: ax = 2 * n * lex / na**2
    return {"lat": lat, "ax": ax}

def camera_pixel(pix, binning, mag, design, stand, adapter):
    return pix * binning / (mag * stand / design * adapter) * 1000

def scan_pixel(field, mag, design, stand, zoom, frame):
    side_um = field / math.sqrt(2) * 1000 / (mag * stand / design * zoom)
    return side_um / frame * 1000

cases = []
for mode, na, n, lex, lem in [("widefield", 1.42, 1.518, 488, 507), ("widefield", 0.45, 1.0, 358, 461), ("widefield", 1.15, 1.333, 561, 610),
                              ("confocal", 1.4, 1.518, 488, 520), ("confocal", 0.8, 1.0, 640, 670), ("disk", 1.3, 1.45, 561, 600),
                              ("twophoton", 1.0, 1.333, 920, 510), ("confocal", 1.25, 1.40, 405, 461)]:
    for au in ([0.2, 0.6, 1.0, 1.5, 3.0] if mode == "confocal" else [1.0]):
        cases.append({"in": {"mode": mode, "na": na, "n": n, "lex": lex, "lem": lem, "au": au},
                      "nyq": nyquist(mode, na, n, lex, lem), "res": resolution(mode, na, n, lex, lem, au)})

cams = []
for pix, b, mag, d, s, ad in [(6.5, 1, 60, 200, 200, 1), (6.5, 2, 100, 180, 200, 1.5), (4.6, 1, 40, 165, 165, 0.63), (11, 1, 63, 200, 180, 1)]:
    cams.append({"in": {"pix": pix, "bin": b, "mag": mag, "designTube": d, "standTube": s, "adapter": ad}, "pixel": camera_pixel(pix, b, mag, d, s, ad)})
scans = []
for f, mag, d, s, z, fr in [(20, 63, 165, 165, 1, 1024), (25, 60, 200, 200, 3.5, 2048), (22, 40, 200, 200, 0.75, 512), (18, 100, 180, 200, 2, 1024)]:
    scans.append({"in": {"field": f, "mag": mag, "designTube": d, "standTube": s, "zoom": z, "frame": fr}, "pixel": scan_pixel(f, mag, d, s, z, fr)})

out = {"nyquist": cases, "camera": cams, "scan": scans}
here = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(here, "fixtures", "micro"), exist_ok=True)
json.dump(out, open(os.path.join(here, "fixtures", "micro", "reference.json"), "w"), indent=1)
print(len(cases), "nyquist cases,", len(cams), "camera,", len(scans), "scan")
