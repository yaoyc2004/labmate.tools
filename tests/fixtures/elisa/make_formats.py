"""Write one simulated plate (450 nm signal + 630 nm reference) in the export layouts the ELISA tool reads.
The layouts follow the vendors' documented export formats; they are not files exported in a lab.
Run from the repo root:  python3 tests/fixtures/elisa/make_formats.py   (needs openpyxl for the .xlsx files)
tests/elisa-formats.test.js checks that every file gives the same 96 values."""
import json, os, random

random.seed(7)
HERE = os.path.dirname(os.path.abspath(__file__))
ROWS = "ABCDEFGH"
sig = [[round(0.05 + 3.2 * random.random() ** 2, 3) for _ in range(12)] for _ in range(8)]
ref = [[round(0.035 + 0.01 * random.random(), 3) for _ in range(12)] for _ in range(8)]
sig[5][3] = None  # one saturated well (overflow mark in each format)
SAT = {"gen5": "OVRFLW", "softmax": "Range?", "tecan": "OVER", "bmg": "overflow", "envision": "", "paste": "OVRFLW"}
json.dump({"sig": sig, "ref": ref, "sat": [5, 3]}, open(os.path.join(HERE, "plate.json"), "w"))


def v(x, kind, dec="."):
    if x is None:
        return SAT[kind]
    return ("%.3f" % x).replace(".", dec)


def write(name, lines, enc="utf-8"):
    with open(os.path.join(HERE, name), "w", encoding=enc, newline="") as fh:
        fh.write("\r\n".join(lines) + "\r\n")


# BioTek Gen5 text export, both reads in one matrix on alternate lines, read name after column 12
L = ["Software Version\t3.12.08", "Reader Type:\tSynergy HTX", "Read\tAbsorbance Endpoint", "\tWavelengths:  450, 630", "", "Results", "", "\t" + "\t".join(str(c) for c in range(1, 13))]
for r in range(8):
    L.append(ROWS[r] + "\t" + "\t".join(v(sig[r][c], "gen5") for c in range(12)) + "\t450")
    L.append("\t" + "\t".join(v(ref[r][c], "gen5") for c in range(12)) + "\t630")
write("gen5-interleaved.txt", L)

# SoftMax Pro plate-format text, two wavelengths side by side, temperature column, no row letters (UTF-16)
L = ["##BLOCKS= 1", "Plate:\tPlate1\t1.3\tPlateFormat\tEndpoint\tAbsorbance\tRaw\tFALSE\t1\t\t\t\t\t\t2\t450 630\t1\t12\t96\t1\t8\t\t",
     "\tTemperature(¡C)\t" + "\t".join(str(c) for c in range(1, 13)) + "\t\t" + "\t".join(str(c) for c in range(1, 13)) + "\t"]
for r in range(8):
    L.append("\t" + ("23.80" if r == 0 else "") + "\t" + "\t".join(v(sig[r][c], "softmax") for c in range(12)) + "\t\t" + "\t".join(v(ref[r][c], "softmax") for c in range(12)) + "\t")
L += ["", "~End", "Original Filename: elisa; Date Last Saved: 11/21/2026 10:00:00 AM"]
write("softmax-plate.txt", L, "utf-16")

# Tecan i-control style, comma-separated, two blocks with the <> corner
L = ["Application: Tecan i-control", "Device: infinite 200Pro", ""]
for name, data in (("450", sig), ("630", ref)):
    L += ["Label: Label" + name, "Measurement Wavelength," + name + ",nm", "", "<>," + ",".join(str(c) for c in range(1, 13))]
    for r in range(8):
        L.append(ROWS[r] + "," + ",".join(v(data[r][c], "tecan") for c in range(12)))
    L.append("")
write("tecan-icontrol.csv", L)

# BMG MARS list export, semicolons and decimal commas, split well row / column
L = ["User: USER", "Test name: ELISA", "Reader: CLARIOstar", "", "Well Row;Well Col;Content;Raw Data (450);Raw Data (630)"]
for r in range(8):
    for c in range(12):
        L.append("%s;%d;Sample X%d;%s;%s" % (ROWS[r], c + 1, r * 12 + c + 1, v(sig[r][c], "bmg", ","), v(ref[r][c], "bmg", ",")))
write("bmg-mars-list.csv", L)

# PerkinElmer EnVision-style plate list
L = ["Plate,Repeat,Barcode,Well,Type,Result,Signal 630"]
for r in range(8):
    for c in range(12):
        L.append("1,1,,%s%02d,M,%s,%s" % (ROWS[r], c + 1, v(sig[r][c], "envision"), v(ref[r][c], "envision")))
write("envision-list.csv", L)

# a bare 8 x 12 block pasted from Excel (signal only)
write("paste-bare.txt", ["\t".join(v(sig[r][c], "paste") for c in range(12)) for r in range(8)])

try:
    import openpyxl
    # Thermo SkanIt-style workbook: one sheet per wavelength, plate matrix under a title
    wb = openpyxl.Workbook()
    for i, (name, data) in enumerate((("Abs 450", sig), ("Abs 630", ref))):
        ws = wb.active if i == 0 else wb.create_sheet()
        ws.title = name
        ws.append(["SkanIt Software 7.0 RE for Multiskan SkyHigh"])
        ws.append(["Photometric1", name.split()[1] + " nm"])
        ws.append([])
        ws.append([None] + list(range(1, 13)))
        for r in range(8):
            ws.append([ROWS[r]] + [("OVER" if x is None else x) for x in data[r]])
    wb.save(os.path.join(HERE, "skanit.xlsx"))
    # BMG MARS-style workbook: two matrices on one sheet
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Microplate End point"
    ws.append(["Test Name: ELISA"]); ws.append(["CLARIOstar"])
    for name, data in (("Raw Data (450)", sig), ("Raw Data (630)", ref)):
        ws.append([]); ws.append([name]); ws.append([None] + list(range(1, 13)))
        for r in range(8):
            ws.append([ROWS[r]] + [("overflow" if x is None else x) for x in data[r]])
    wb.save(os.path.join(HERE, "bmg-mars-matrix.xlsx"))
except ImportError:
    print("openpyxl not installed: .xlsx fixtures skipped")
print("ok")
