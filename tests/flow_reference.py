"""Independent reference numbers for assets/flow-core.js (7.2 Antibody Titration, 7.3 Staining Cocktail).
Written from the formulas on the pages, not from the JavaScript. Run from the repo root:
    python3 tests/flow_reference.py   → tests/fixtures/flow/reference.json
"""
import json, math, os

def series(stock, rec, final, cells, top, f, n, extra):
    vmix = final - cells
    keep = math.ceil(vmix * (1 + extra) - 1e-9)
    tubes = []
    for i in range(n):
        amt = rec * top / f ** i
        ul = amt if not stock else amt / stock
        tubes.append({"amount": amt, "ulStock": ul, "dil": final / ul,
                      "finalUgMl": None if not stock else amt / final * 1000})
    t = keep / (f - 1)
    first = keep + t
    return {"keep": keep, "transfer": t, "firstTotal": first, "firstStock": first * tubes[0]["ulStock"] / vmix, "tubes": tubes}

def stain_index(pos, neg, sd):            # Maecker et al. 2004
    return (pos - neg) / (2 * sd)

def separation_index(pos, neg, p84):      # 84th-percentile separation index
    return (pos - neg) / ((p84 - neg) / 0.995)

def cocktail(tubes, over_pct, final, cvol, abs_, bsb):
    n = tubes * (1 + over_pct / 100)
    per = []
    for use, value, stock in abs_:
        p = value if use == "ul" else final / value if use == "dil" else value / stock
        per.append(p)
    s = sum(per)
    return {"n": n, "perTest": per, "total": [p * n for p in per], "bufferPerTest": cvol - s - bsb, "bufferTotal": (cvol - s - bsb) * n}

cases = {
    "series": [
        {"in": dict(stock=0.2, rec=0.25, finalVol=100, cellVol=50, top=4, factor=2, points=8, extra=0.1)},
        {"in": dict(stock=0.5, rec=1, finalVol=200, cellVol=100, top=2, factor=3, points=6, extra=0.05)},
        {"in": dict(stock=None, rec=5, finalVol=100, cellVol=50, top=4, factor=2, points=10, extra=0.1)},
        {"in": dict(stock=1, rec=0.125, finalVol=50, cellVol=25, top=8, factor=2, points=12, extra=0.2)},
    ],
    "index": [
        {"pos": 52000, "neg": 900, "sd": 300, "p84": 1250},
        {"pos": 1830.5, "neg": 211.2, "sd": 75.4, "p84": 290.1},
        {"pos": 40, "neg": 12, "sd": 3.3, "p84": 15.5},
    ],
    "cocktail": [
        {"in": dict(tubes=12, over=10, finalVol=100, cocktailVol=50, bsb=10,
                    abs=[["ul", 1, None], ["dil", 400, None], ["ug", 0.06, 0.2], ["ul", 2.5, None]])},
        {"in": dict(tubes=96, over=5, finalVol=50, cocktailVol=25, bsb=5,
                    abs=[["ul", 0.25, None], ["dil", 200, None], ["ug", 0.125, 0.5]])},
    ],
}
for c in cases["series"]:
    i = c["in"]
    c["out"] = series(i["stock"], i["rec"], i["finalVol"], i["cellVol"], i["top"], i["factor"], i["points"], i["extra"])
for c in cases["index"]:
    c["si"] = stain_index(c["pos"], c["neg"], c["sd"])
    c["sep"] = separation_index(c["pos"], c["neg"], c["p84"])
    c["sn"] = c["pos"] / c["neg"]
for c in cases["cocktail"]:
    i = c["in"]
    c["out"] = cocktail(i["tubes"], i["over"], i["finalVol"], i["cocktailVol"], i["abs"], i["bsb"])

out = os.path.join(os.path.dirname(__file__), "fixtures", "flow", "reference.json")
with open(out, "w") as fh:
    json.dump(cases, fh, indent=1)
print("wrote", out)
