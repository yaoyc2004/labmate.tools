#!/usr/bin/env python3
"""
labmate.tools · Panel Designer — download measured spectra from FPbase.

Run once from this folder (needs Python 3.8+, no extra packages):

    python fetch_fpbase_spectra.py

It reads cytometry-data.js, looks up every fluor on FPbase (https://www.fpbase.org),
downloads its excitation (or absorption) and emission spectra, and writes spectra.js.
The tool page then uses these measured curves instead of the modelled ones.

Matching is by name. Only exact matches (after ignoring case, spaces and punctuation)
are used automatically. Everything else is listed in fpbase-unmatched.txt with the
closest FPbase names; to accept one, add it to OVERRIDES below and run again.

FPbase data is CC BY-SA 4.0: keep the attribution on the page, and spectra.js
stays under the same licence.
"""
import difflib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
GRAPHQL = "https://www.fpbase.org/graphql/"
LO, HI = 300, 900          # wavelength range kept, nm
SCALE = 1000               # values stored as integers 0..1000
TRIM = 2                   # drop leading/trailing values below 0.2 %

# labmate name -> exact FPbase owner name. Fill in from fpbase-unmatched.txt.
OVERRIDES = {
    # "APC": "APC (allophycocyanin)",
}

# common spelling differences, tried before giving up
def variants(name):
    v = {name}
    m = re.match(r"^BV(\d+)$", name)
    if m:
        v |= {"Brilliant Violet " + m.group(1), "BD Horizon BV" + m.group(1)}
    m = re.match(r"^BUV(\d+)$", name)
    if m:
        v |= {"BD Horizon BUV" + m.group(1), "Brilliant Ultraviolet " + m.group(1)}
    m = re.match(r"^BB(\d+)$", name)
    if m:
        v |= {"BD Horizon BB" + m.group(1), "Brilliant Blue " + m.group(1)}
    if name.startswith("LIVE/DEAD Fixable "):
        rest = name[len("LIVE/DEAD Fixable "):]
        v |= {"LIVE/DEAD Fixable " + rest + " Dead Cell Stain", "LIVE/DEAD Fixable " + rest + " Viability"}
    v |= {name.replace("-", "/"), name.replace("/", "-")}
    return v


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def gql(query):
    url = GRAPHQL + "?" + urllib.parse.urlencode({"query": query})
    req = urllib.request.Request(url, headers={"User-Agent": "labmate.tools spectra fetch (one-off)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        out = json.loads(r.read().decode("utf-8"))
    if out.get("errors"):
        raise RuntimeError(out["errors"])
    return out["data"]


def load_fluors():
    text = (HERE / "cytometry-data.js").read_text(encoding="utf-8")
    start = text.index("{", text.index("window.LMT_CYTO"))
    data = json.loads(text[start:text.rindex("}") + 1])
    return data["fluors"]


def resample(points):
    """points: [[nm, value], ...] -> (start_nm, [int, ...]) at 1 nm, normalised to max."""
    pts = sorted((float(a), float(b)) for a, b in points if b is not None)
    if len(pts) < 2:
        return None
    peak = max(b for _, b in pts) or 1.0
    vals = []
    j = 0
    for nm in range(LO, HI + 1):
        if nm < pts[0][0] or nm > pts[-1][0]:
            vals.append(0)
            continue
        while j < len(pts) - 2 and pts[j + 1][0] < nm:
            j += 1
        (x0, y0), (x1, y1) = pts[j], pts[j + 1]
        y = y0 if x1 == x0 else y0 + (y1 - y0) * (nm - x0) / (x1 - x0)
        vals.append(max(0, min(SCALE, round(y / peak * SCALE))))
    first = next((i for i, v in enumerate(vals) if v >= TRIM), None)
    if first is None:
        return None
    last = len(vals) - 1 - next(i for i, v in enumerate(reversed(vals)) if v >= TRIM)
    return [LO + first, vals[first:last + 1]]


def main():
    fluors = load_fluors()
    print(f"{len(fluors)} fluors in cytometry-data.js")

    print("Listing FPbase spectra …")
    owners = {}  # norm name -> {"name": owner, "EX": id, "AB": id, "EM": id}
    for cat in ("d", "p"):
        rows = gql('{spectra(category:"%s"){id subtype owner{name}}}' % cat)["spectra"]
        for r in rows:
            o = r["owner"]["name"]
            e = owners.setdefault(norm(o), {"name": o})
            e.setdefault(r["subtype"], r["id"])
        time.sleep(0.5)
    print(f"  {len(owners)} owners")

    matched, unmatched = {}, []
    by_norm = {k: v for k, v in owners.items()}
    for f in fluors:
        hit = None
        if f["name"] in OVERRIDES:
            hit = by_norm.get(norm(OVERRIDES[f["name"]]))
        if not hit:
            for v in variants(f["name"]):
                hit = by_norm.get(norm(v))
                if hit:
                    break
        if hit and ("EM" in hit) and ("EX" in hit or "AB" in hit):
            matched[f["id"]] = hit
        else:
            close = difflib.get_close_matches(norm(f["name"]), list(by_norm), n=3, cutoff=0.6)
            unmatched.append((f["name"], [by_norm[c]["name"] for c in close], bool(hit)))
    print(f"  matched {len(matched)}, unmatched {len(unmatched)}")

    ids = []
    for fid, h in matched.items():
        ids += [h.get("EX") or h.get("AB"), h["EM"]]
    data = {}
    for i in range(0, len(ids), 20):
        chunk = ids[i:i + 20]
        q = "{" + " ".join('s%s: spectrum(id:%s){id data}' % (x, x) for x in chunk) + "}"
        res = gql(q)
        for v in res.values():
            if v:
                data[str(v["id"])] = v["data"]
        print(f"  downloaded {min(i + 20, len(ids))}/{len(ids)}")
        time.sleep(0.5)

    out = {}
    for fid, h in matched.items():
        ex_id = str(h.get("EX") or h.get("AB"))
        ex = resample(data.get(ex_id, []))
        em = resample(data.get(str(h["EM"]), []))
        if ex and em:
            out[fid] = {"owner": h["name"], "exType": "EX" if h.get("EX") else "AB", "ex": ex, "em": em}

    payload = {
        "source": "FPbase (https://www.fpbase.org)",
        "license": "CC BY-SA 4.0",
        "fetched": date.today().isoformat(),
        "spectra": out,
    }
    js = ("/* labmate.tools · Panel Designer — measured spectra from FPbase (https://www.fpbase.org), "
          "CC BY-SA 4.0. Generated by fetch_fpbase_spectra.py; do not edit by hand. */\n"
          "window.LMT_SPECTRA = " + json.dumps(payload, separators=(",", ":")) + ";\n")
    (HERE / "spectra.js").write_text(js, encoding="utf-8")

    with open(HERE / "fpbase-unmatched.txt", "w", encoding="utf-8") as fh:
        fh.write("labmate name  ->  closest FPbase names (add one to OVERRIDES to accept)\n\n")
        for name, close, partial in unmatched:
            note = "  [found, but missing an ex/em spectrum]" if partial else ""
            fh.write(f"{name}{note}\n    " + (" | ".join(close) if close else "(nothing close)") + "\n")

    print(f"Wrote spectra.js with {len(out)} fluors ({len(js) // 1024} KB).")
    print("Unmatched names are in fpbase-unmatched.txt.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # keep the window readable when double-clicked
        print("Failed:", e)
        sys.exit(1)
