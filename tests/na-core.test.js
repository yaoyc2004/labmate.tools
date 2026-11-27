/* Core of 2.8 DNA/RNA Normalization (tools/nucleic-acid-normalization/na-core.js): reading exports,
   purity flags, volumes, plate positions and export files. Fixtures in tests/fixtures/na follow the
   column layouts of real NanoDrop and Qubit exports, with made-up values.
   Run from the repo root:  node tests/na-core.test.js   (the .xlsx check also uses python3 + openpyxl if present) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const NA = require('../tools/nucleic-acid-normalization/na-core.js');
const FX = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', 'na', f), 'utf8');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= (tol || 1e-9), (msg || '') + ` ${a} ≠ ${b}`);

t('NanoDrop One CSV: name, ng/uL, ratios; Acclaro "Corrected" column ignored; negative blank flagged', () => {
  const p = NA.parse(FX('nanodrop-one.csv'));
  assert.strictEqual(p.format, 'NanoDrop One');
  assert.strictEqual(p.rows.length, 4);
  assert.deepStrictEqual(p.rows.map((r) => r.name), ['Liver 1', 'Liver 2', 'Liver 1', 'Blank check']);
  near(p.rows[0].conc, 512.334); near(p.rows[0].r280, 2.071); near(p.rows[1].r230, 1.402);
  assert.strictEqual(p.rows[3].conc, null); assert.strictEqual(p.rows[3].flag, 'neg');
});

t('NanoDrop Eight TSV: Application line, UUID ids skipped for Sample, decimal commas incl. 1.086,5', () => {
  const p = NA.parse(FX('nanodrop-eight-rna.tsv'));
  assert.strictEqual(p.fileType, 'RNA'); assert.strictEqual(p.decimalComma, true);
  assert.deepStrictEqual(p.rows.map((r) => r.name), ['PBL 1', 'PBL 2', 'PBL 3']);
  near(p.rows[0].conc, 704.986); near(p.rows[1].conc, 1086.5); near(p.rows[2].r230, 0.93);
});

t('NanoDrop 8000: mg/ml → ng/µL, wells, ratios from Formula Name / Value columns', () => {
  const p = NA.parse(FX('nanodrop-8000.txt'));
  assert.strictEqual(p.format, 'NanoDrop 8000');
  near(p.rows[0].conc, 392.9, 1e-6); near(p.rows[1].conc, 684.4, 1e-6);
  near(p.rows[0].r280, 1.449); near(p.rows[1].r230, 2.21);
  assert.deepStrictEqual(p.rows.map((r) => r.pos), ['A1', 'B1']);
});

t('NanoDrop 2000: Sample ID, Nucleic Acid Conc. + Unit, Sample Type DNA; empty value kept as no value', () => {
  const p = NA.parse(FX('nanodrop-2000.tsv'));
  assert.strictEqual(p.format, 'NanoDrop 2000 / Lite');
  assert.deepStrictEqual(p.rows.map((r) => [r.name, r.conc, r.type]), [['Plasmid A', 1250.6, 'DNA'], ['Plasmid B', 310.2, 'DNA'], ['Primer mix', null, 'DNA']]);
  assert.strictEqual(p.rows[2].flag, 'bad');
});

t('Qubit 4: original sample conc. (not tube conc.), its own Units column (ng/mL → ng/µL), Out of range', () => {
  const p = NA.parse(FX('qubit4.csv'));
  assert.strictEqual(p.format, 'Qubit 4');
  assert.deepStrictEqual(p.rows.map((r) => r.name), ['Lib A', 'Lib B', 'Lib C']);
  near(p.rows[0].conc, 24.6); near(p.rows[1].conc, 1.64, 1e-9);
  assert.strictEqual(p.rows[2].conc, null); assert.strictEqual(p.rows[2].flag, 'bad');
  assert.strictEqual(p.rows[0].type, 'DNA'); assert.strictEqual(p.rows[0].r280, null);
});

t('Qubit Flex: µg/µL → ng/µL, RNA assay, wells', () => {
  const p = NA.parse(FX('qubit-flex.csv'));
  assert.strictEqual(p.format, 'Qubit (Flex)');
  near(p.rows[0].conc, 528); near(p.rows[1].conc, 610, 1e-9);
  assert.deepStrictEqual(p.rows.map((r) => [r.type, r.pos]), [['RNA', 'A1'], ['RNA', 'B1']]);
});

t('plain lists: spaces, tabs, commas, units, "Sample 1 250.3", a sample number first, < values', () => {
  const r1 = NA.parse('Sample 1 250.3\nSample 2  88\nWT 1 1520 1.85 2.1\nS4 704,98 2,07 1,9').rows;
  assert.deepStrictEqual(r1.map((r) => [r.name, r.conc, r.r280, r.r230]),
    [['Sample 1', 250.3, null, null], ['Sample 2', 88, null, null], ['WT 1', 1520, 1.85, 2.1], ['S4', 704.98, 2.07, 1.9]]);
  const r2 = NA.parse('A\t125\nB\t<0.5\n3\t300\t1.9\t2.0').rows;
  assert.deepStrictEqual(r2.map((r) => [r.name, r.conc, r.flag]), [['A', 125, ''], ['B', null, 'low'], ['3', 300, '']]);
  const r3 = NA.parse('S1 125.3 ng/µL\nS2 0.3 µg/µL\nS3 40 ng/mL').rows;
  assert.deepStrictEqual(r3.map((r) => [r.name, +r.conc.toFixed(6)]), [['S1', 125.3], ['S2', 300], ['S3', 0.04]]);
  const r4 = NA.parse('Sample,Conc (ng/uL),260/280\nA,1,079.5,1.9').rows; // thousands comma inside an unquoted CSV field is not supported…
  assert(r4.length === 1);
  const r5 = NA.parse('Sample,Conc (ng/uL),260/280\n"A","1,079.5","1.9"').rows; // …but quoted it is
  near(r5[0].conc, 1079.5); near(r5[0].r280, 1.9);
});

t('repeats with the same name are averaged, with CV', () => {
  const m = NA.mergeRepeats(NA.parse(FX('nanodrop-one.csv')).rows);
  assert.strictEqual(m.length, 3);
  near(m[0].conc, (512.334 + 530.102) / 2, 1e-9); assert.strictEqual(m[0].n, 2);
  const sd = Math.sqrt(((512.334 - 521.218) ** 2 + (530.102 - 521.218) ** 2) / 1);
  near(m[0].cv, sd / 521.218 * 100, 1e-6);
  near(m[0].r280, 2.07, 1e-9);
});

t('purity: DNA vs RNA limits, causes, grey under 10 ng/µL', () => {
  const P = (conc, r280, r230, type) => [NA.purity({ conc, r280, r230 }, '280', type).c, NA.purity({ conc, r280, r230 }, '230', type).c];
  assert.deepStrictEqual(P(500, 1.85, 2.1, 'DNA'), ['g', 'g']);
  assert.deepStrictEqual(P(500, 1.85, 2.1, 'RNA'), ['y', 'g']);   // 1.85 is amber for RNA
  assert.deepStrictEqual(P(500, 2.08, 1.62, 'DNA'), ['y', 'y']);  // RNA in the DNA? / salt
  assert.deepStrictEqual(P(500, 1.55, 1.2, 'DNA'), ['r', 'r']);
  assert.deepStrictEqual(P(500, 2.35, 2.7, 'RNA'), ['r', 'y']);
  assert.deepStrictEqual(P(8, 1.2, 0.5, 'RNA'), ['q', 'q']);
  assert.deepStrictEqual(P(500, null, null, 'DNA'), ['n', 'n']);
  assert.match(NA.purity({ conc: 500, r280: 2.15 }, '280', 'DNA').why, /RNA/);
  assert.match(NA.purity({ conc: 500, r230: 1.1 }, '230', 'RNA').why, /guanidine/);
  const lim = JSON.parse(JSON.stringify(NA.LIMITS)); lim.DNA.g230 = 2.0;
  assert.strictEqual(NA.purity({ conc: 500, r230: 1.9 }, '230', 'DNA', lim).c, 'y');
});

t('normalize by mass: hand-calculated volumes, rounding to pipette steps', () => {
  const s = [{ conc: 412.6 }, { conc: 198.3 }, { conc: 1520.4 }];
  const r = NA.normalize(s, { mode: 'mass', amount: 1000, vf: 10, minVol: 0.5, predil: true });
  // 1000/412.6 = 2.4237 → 2.4 (0.1 µL steps 2–20 µL); 1000/198.3 = 5.0429 → 5.0; 1000/1520.4 = 0.6577 → 0.66 (0.01 µL under 2 µL)
  assert.deepStrictEqual(r.map((x) => [x.status, x.sv, x.water]), [['ok', 2.4, 7.6], ['ok', 5, 5], ['ok', 0.66, 9.34]]);
  near(r[0].gives, 2.4 * 412.6, 1e-9); near(r[2].err, (0.66 * 1520.4 / 1000 - 1) * 100, 1e-9);
  const ex = NA.normalize(s, { mode: 'mass', amount: 1000, vf: 10, minVol: 0.5, step: 0 });
  near(ex[0].sv, 1000 / 412.6, 1e-6); near(ex[0].sv + ex[0].water, 10, 1e-9);
});

t('normalize by concentration: 20 ng/µL in 20 µL = 400 ng', () => {
  const r = NA.normalize([{ conc: 125.3 }], { mode: 'conc', target: 20, vf: 20, minVol: 0.5, step: 0.01 })[0];
  assert.strictEqual(r.needed, 400); assert.strictEqual(r.sv, 3.19); assert.strictEqual(r.water, 16.81);
});

t('too dilute: whole volume, what it gives, shortfall', () => {
  const r = NA.normalize([{ conc: 85.2 }], { mode: 'mass', amount: 1000, vf: 10, minVol: 0.5, predil: true })[0];
  assert.strictEqual(r.status, 'dilute'); assert.strictEqual(r.sv, 10); assert.strictEqual(r.water, 0);
  near(r.gives, 852, 1e-9); near(r.err, -14.8, 1e-9);
});

t('pre-dilution: smallest tidy factor bringing the volume to ≥ 1 µL; off → flagged', () => {
  const a = NA.normalize([{ conc: 2650 }], { mode: 'mass', amount: 1000, vf: 10, minVol: 0.5, predil: true })[0];
  // 0.377 µL → ×4 = 1.509 µL → 1.51; pre-dilution 2 µL + 6 µL
  assert.strictEqual(a.status, 'predil'); assert.strictEqual(a.k, 4); assert.strictEqual(a.sv, 1.51); assert.strictEqual(a.water, 8.49);
  assert.deepStrictEqual(a.pre, { sample: 2, diluent: 6, total: 8 });
  near(a.gives, 1.51 * 2650 / 4, 1e-9);
  const b = NA.normalize([{ conc: 26500 }], { mode: 'mass', amount: 1000, vf: 10, minVol: 0.5, predil: true })[0];
  assert.strictEqual(b.k, 50); assert.deepStrictEqual(b.pre, { sample: 1, diluent: 49, total: 50 }); assert.strictEqual(b.sv, 1.89);
  const c = NA.normalize([{ conc: 2650 }], { mode: 'mass', amount: 1000, vf: 10, minVol: 0.5, predil: false })[0];
  assert.strictEqual(c.status, 'small'); assert.strictEqual(c.sv, 0.38);
  const d = NA.normalize([{ conc: null }, { conc: 100, skip: true }], { mode: 'mass', amount: 100, vf: 10, minVol: 0.5 });
  assert.deepStrictEqual(d.map((x) => x.status), ['nodata', 'skip']);
});

t('largest equal amount, rounded down to a tidy number', () => {
  assert.strictEqual(NA.maxEqual([{ conc: 412.6 }, { conc: 85.2 }, { conc: null }, { conc: 10, skip: true }], 10), 800);
  assert.strictEqual(NA.tidyDown(852), 800); assert.strictEqual(NA.tidyDown(129), 120); assert.strictEqual(NA.tidyDown(0.47), 0.4);
});

t('plate positions: down columns, along rows, start well, skip edges, Tecan index', () => {
  assert.deepStrictEqual(NA.wells(3, '96', 'col', 'G1').map((w) => w.well), ['G1', 'H1', 'A2']);
  assert.deepStrictEqual(NA.wells(3, '96', 'row', 'A11').map((w) => w.well), ['A11', 'A12', 'B1']);
  assert.deepStrictEqual(NA.wells(2, '96', 'col', 'A1', true).map((w) => w.well), ['B2', 'C2']);
  assert.strictEqual(NA.wells(1, '96', 'col', 'H12')[0].idx, 96);
  assert.strictEqual(NA.wells(1, '384', 'col', 'P24')[0].idx, 384);
  assert.strictEqual(NA.wells(2, '96', 'col', 'H12')[1], null);
});

t('CSV quoting, Tecan .gwl: diluent first with a tip change, then samples', () => {
  assert.strictEqual(NA.csv([['a,b', 'say "hi"', 1.5]]), '"a,b","say ""hi""",1.5\r\n');
  const g = NA.gwl([{ srcPos: 1, destPos: 9, sv: 2.4, water: 7.6 }, { srcPos: 2, destPos: 10, sv: 10, water: 0 }]).split('\r\n');
  assert.deepStrictEqual(g.slice(1, 4), ['A;Diluent;;;1;;7.60', 'D;Destination;;;9;;7.60', 'W;']);
  assert.deepStrictEqual(g.slice(4, 10), ['A;Source;;;1;;2.40', 'D;Destination;;;9;;2.40', 'W;', 'A;Source;;;2;;10.00', 'D;Destination;;;10;;10.00', 'W;']);
});

t('xlsx: valid zip (CRC-32), opens in openpyxl with values and fills', () => {
  near(NA.crc32(Buffer.from('123456789')), 0xCBF43926);
  const S = NA.STYLE;
  const bytes = NA.xlsx([{ name: 'Normalization', rows: [[{ v: 'Title', s: S.title }], ['Sample', 'µL'], ['Ctrl 1', { v: 2.42, s: S.g }], ['KO <2>', { v: 10, s: S.r }]], widths: [12, 8], freeze: 2 }, { name: 'Plate map', rows: [['A', 'x']] }]);
  const f = path.join(require('os').tmpdir(), 'na-test.xlsx');
  fs.writeFileSync(f, bytes);
  const py = require('child_process').spawnSync('python3', ['-c', `
import openpyxl,sys
wb=openpyxl.load_workbook(sys.argv[1]); ws=wb['Normalization']
print(wb.sheetnames, ws['A1'].value, ws['B2'].value, ws['B3'].value, ws['A4'].value, ws['B3'].fill.fgColor.rgb, ws.freeze_panes)`, f], { encoding: 'utf8' });
  if (py.status !== 0 && /No module named/.test(py.stderr || '')) { console.log('    (openpyxl not installed — skipped the open check)'); return; }
  assert.strictEqual(py.status, 0, py.stderr);
  assert.strictEqual(py.stdout.trim(), "['Normalization', 'Plate map'] Title µL 2.42 KO <2> FFD7EEDF A3");
});

console.log(`\n${n} tests passed`);
