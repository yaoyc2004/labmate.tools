"""Independent reference for tools/elisa (5.5 ELISA Standard Curve Analyzer).

Builds synthetic standard curves and fits them with SciPy (MINPACK Levenberg-Marquardt, many starts),
using the same model and the same weights the page uses:
    y = D + (A - D) / (1 + (x / C)^B)^G,  G = 1 for 4PL
    w = 1 / max(|mean OD of the standard level|, 1% of the span of level means)^k,  k = 0, 1, 2
    weights normalised to mean 1.
Writes tests/fixtures/elisa/scipy-fits.json, read by tests/elisa-core.test.js.

Run from the repo root:  python3 tests/elisa_reference.py      (needs numpy, scipy)
All data here are simulated, not lab data.
"""
import json, os
import numpy as np
from scipy.optimize import least_squares
from scipy.stats import f as fdist

rng = np.random.default_rng(55)


def model(p, x, five):
    A, B, C, D = p[:4]
    G = p[4] if five else 1.0
    x = np.asarray(x, float)
    out = np.full_like(x, A)
    m = x > 0
    with np.errstate(all="ignore"):
        out[m] = D + (A - D) / (1 + (x[m] / C) ** B) ** G
    return out


def weights(x, y, kind):
    k = {"none": 0, "1/y": 1, "1/y2": 2}[kind]
    if k == 0:
        return np.ones_like(y)
    lv = {xv: y[x == xv].mean() for xv in np.unique(x)}
    span = max(lv.values()) - min(lv.values())
    fl = max(0.01 * span, 1e-6)
    w = np.array([1 / max(abs(lv[xv]), fl) ** k for xv in x])
    return w / w.mean()


def fit(x, y, kind, five, starts):
    w = weights(x, y, kind)
    best = None
    for s in starts:
        try:
            r = least_squares(lambda p: np.sqrt(w) * (y - model(p, x, five)), s, method="lm",
                              xtol=1e-15, ftol=1e-15, gtol=1e-15, max_nfev=50000)
        except Exception:
            continue
        if r.x[1] <= 0 or r.x[2] <= 0 or (five and r.x[4] <= 0) or not np.all(np.isfinite(r.fun)):
            continue
        ssr = float(np.sum(r.fun ** 2))
        if best is None or ssr < best[1]:
            best = (r.x, ssr, r)
    p, ssr, r = best
    J = r.jac
    n, k = len(y), len(p)
    cov = np.linalg.inv(J.T @ J) * ssr / (n - k)
    return p, ssr, np.sqrt(np.diag(cov))


def dataset(name, truth, conc, reps, cvn, add):
    x, y = [], []
    for c in conc:
        for _ in range(reps):
            m = model(truth, [c], len(truth) == 5)[0]
            x.append(c)
            y.append(float(m * (1 + rng.normal(0, cvn)) + rng.normal(0, add)))
    return {"name": name, "truth": truth, "x": x, "y": y}


sets = [
    dataset("sandwich-4pl-dup-zero", [0.05, 1.3, 120.0, 2.9], [1000 / 2 ** i for i in range(7)] + [0], 2, 0.03, 0.005),
    dataset("sandwich-5pl-trip", [0.08, 1.6, 40.0, 3.6, 0.35], [2000 / 2.5 ** i for i in range(10)], 3, 0.012, 0.002),
    dataset("competitive-4pl-dup", [2.2, 0.9, 15.0, 0.12], [500 / 3 ** i for i in range(7)] + [0], 2, 0.03, 0.004),
    dataset("sandwich-single-nozero", [0.1, 1.0, 8.0, 2.4], [100 / 2 ** i for i in range(6)], 1, 0.02, 0.003),
]

out = []
for d in sets:
    x, y = np.array(d["x"]), np.array(d["y"])
    pos = np.unique(x[x > 0])
    lo, hi = y[x == x.min()].mean(), y[x == x.max()].mean()
    res = {}
    for kind in ["none", "1/y", "1/y2"]:
        st4 = [[lo, b, c, hi] for b in (0.5, 1, 2) for c in pos[1:-1]] + [[a, b, c, dd] for a, dd in ((lo * 0.9, hi * 1.1), (lo * 1.1, hi * 0.9)) for b in (0.7, 1.5) for c in (pos[len(pos) // 2],)]
        p4, s4, se4 = fit(x, y, kind, False, st4)
        st5 = [list(p4) + [g] for g in (0.1, 0.25, 0.5, 1, 2, 4, 8)] + [s + [g] for s in st4 for g in (0.3, 1, 3)]
        p5, s5, se5 = fit(x, y, kind, True, st5)
        d2 = len(y) - 5
        F = (s4 - s5) / 1 / (s5 / d2)
        res[kind] = {"p4": p4.tolist(), "ssr4": s4, "se4": se4.tolist(), "p5": p5.tolist(), "ssr5": s5, "se5": se5.tolist(), "pF": float(fdist.sf(F, 1, d2))}
    d["scipy"] = res
    out.append(d)

path = os.path.join(os.path.dirname(__file__), "fixtures", "elisa", "scipy-fits.json")
with open(path, "w") as fh:
    json.dump(out, fh, indent=1)
print("wrote", path)
