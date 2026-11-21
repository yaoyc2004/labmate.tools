"""Independent reference for assets/recipe-core.js (SDS-PAGE gels and buffers).
Writes tests/fixtures/recipe/reference.json. Run from the repo root:  python3 tests/recipe_reference.py
Written from the formulas on the tool pages, not from the JavaScript."""
import json, math, os

STOCKS = dict(acryl=30, resTris=1.5, stkTris=0.5, sds=10, aps=10, temed=100)
FIN = dict(resolving=dict(tris=0.375, sds=0.1, aps=0.05, temed=0.05), stacking=dict(tris=0.125, sds=0.1, aps=0.05, temed=0.1))

def mix(kind, V, pct, stocks=STOCKS, fin=None, water="strict"):
    f = fin or FIN[kind]
    tris_stock = stocks["stkTris"] if kind == "stacking" else stocks["resTris"]
    v = dict(tris=V * f["tris"] / tris_stock, acryl=V * pct / stocks["acryl"], sds=V * f["sds"] / stocks["sds"],
             aps=V * f["aps"] / stocks["aps"], temed=V * f["temed"] / stocks["temed"])
    w = V - v["tris"] - v["acryl"] - v["sds"] - (0 if water == "nominal" else v["aps"] + v["temed"])
    v["water"] = w
    v["total"] = sum(v.values()) - 0  # water + components
    v["total"] = w + v["tris"] + v["acryl"] + v["sds"] + v["aps"] + v["temed"]
    return v

def batch(gels, per, over, step):
    v = gels * per * (1 + over / 100)
    if step > 0: v = math.ceil(v / step - 1e-9) * step
    return v

cases = {"mix": [], "plan": [], "make": [], "dilute": []}
for kind, V, pct, st, water in [
    ("resolving", 10, 10, STOCKS, "nominal"),            # Bio-Rad manual
    ("resolving", 10, 10, dict(STOCKS, acryl=40), "strict"),  # Robertson lab
    ("stacking", 10, 4, dict(STOCKS, acryl=40), "strict"),    # Robertson lab
    ("stacking", 10, 4, STOCKS, "nominal"),
    ("resolving", 18.5, 12, STOCKS, "strict"),
    ("resolving", 7.3, 7.5, dict(STOCKS, resTris=1.0), "strict"),
]:
    cases["mix"].append(dict(inp=dict(kind=kind, volume=V, pct=pct, stocks=st, water=water), out=mix(kind, V, pct, st, water=water)))

for cas, frac, over, step, res, stk in [(5.6, .75, 10, .5, [(10, 2), (12, 2)], 4), (4.2, .7, 0, 0, [(15, 1)], 5), (8.4, .75, 15, 1, [(8, 3), (10, 1), (12, 6)], 4)]:
    out = dict(res=[], stk=None)
    tot = 0
    for pct, g in res:
        V = batch(g, cas * frac, over, step); tot += g
        out["res"].append(dict(volume=V, **mix("resolving", V, pct)))
    Vs = batch(tot, cas * (1 - frac), over, step)
    out["stk"] = dict(volume=Vs, **mix("stacking", Vs, stk))
    cases["plan"].append(dict(inp=dict(cassette=cas, frac=frac, overage=over, step=step, resolving=[dict(pct=p, gels=g) for p, g in res], stackPct=stk, water="strict"), out=out))

MOL = {"M": 1, "mM": 1e-3, "µM": 1e-6}
def amount(c, x, V):
    if c["form"] == "powder":
        if c["u"] in MOL: return ("g", c["c"] * MOL[c["u"]] * x * V / 1000 * c["mw"])
        return ("g", c["c"] / 100 * x * V)
    final = c["c"] * MOL[c["u"]] * x if c["u"] in MOL else c["c"] * x
    stock = 100 if (c["form"] == "liquid" and c["u"] == "v/v") else c["stock"]
    return ("mL", final * V / stock)

def P(name, c, u, form, **k): d = dict(name=name, c=c, u=u, form=form); d.update(k); return d
RECIPES = {
    "tgs": [P("Tris", 25, "mM", "powder", mw=121.14), P("Gly", 192, "mM", "powder", mw=75.07), P("SDS", 0.1, "w/v", "powder")],
    "pbs": [P("NaCl", 137, "mM", "powder", mw=58.44), P("KCl", 2.7, "mM", "powder", mw=74.55), P("Na2HPO4", 10, "mM", "powder", mw=141.96), P("KH2PO4", 1.8, "mM", "powder", mw=136.09)],
    "tae": [P("Tris", 40, "mM", "powder", mw=121.14), P("AcOH", 20, "mM", "liquid", stock=17.5), P("EDTA", 1, "mM", "stock", stock=0.5)],
    "tbe": [P("Tris", 89, "mM", "powder", mw=121.14), P("Boric", 89, "mM", "powder", mw=61.83), P("EDTA", 2, "mM", "stock", stock=0.5)],
    "ripa": [P("Tris", 50, "mM", "stock", stock=1), P("NaCl", 150, "mM", "powder", mw=58.44), P("NP40", 1, "v/v", "liquid"), P("DOC", 0.5, "w/v", "powder"), P("SDS", 0.1, "w/v", "stock", stock=10)],
    "towbin": [P("Tris", 25, "mM", "powder", mw=121.14), P("Gly", 192, "mM", "powder", mw=75.07), P("MeOH", 20, "v/v", "liquid", atUse=True)],
    "edta": [P("Na2EDTA", 0.5, "M", "powder", mw=372.24)],
}
for k, x, V in [("tgs", 10, 1000), ("pbs", 10, 1000), ("tae", 50, 1000), ("tae", 10, 1000), ("tbe", 5, 1000), ("ripa", 1, 50), ("towbin", 10, 2000), ("edta", 1, 500), ("pbs", 1, 250)]:
    rows = []
    for c in RECIPES[k]:
        if c.get("atUse") and x != 1: rows.append(None); continue
        rows.append(amount(c, x, V))
    cases["make"].append(dict(inp=dict(recipe=k, components=RECIPES[k], x=x, V=V, includeAtUse=(x == 1)), out=rows))
for k, frm, to, V in [("towbin", 10, 1, 1000), ("tgs", 10, 1, 500), ("tbe", 5, 0.5, 2000), ("towbin", 20, 1, 1000)]:
    stockV = V * to / frm
    adds = [amount(c, to, V)[1] for c in RECIPES[k] if c.get("atUse")]
    cases["dilute"].append(dict(inp=dict(recipe=k, components=RECIPES[k], from_=frm, to=to, V=V), out=dict(stockV=stockV, adds=adds, water=V - stockV - sum(adds))))

os.makedirs("tests/fixtures/recipe", exist_ok=True)
json.dump(cases, open("tests/fixtures/recipe/reference.json", "w"), indent=1, ensure_ascii=False)
print("wrote", {k: len(v) for k, v in cases.items()})
