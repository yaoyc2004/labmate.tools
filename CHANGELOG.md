# labmate.tools — changelog

Newest first. One entry per working day; each line says what changed for someone using the site.

## 2026-11-26

### Protocol Timeline Planner (10.1) — bench mode
- START BENCH MODE follows the plan live on a phone: one card per group with what to do now, a countdown and a progress bar, the step after next, and a COMING UP list. Press DONE as you finish each step.
- Re-plans on every DONE: the next step starts then, step buffers take up a delay first, a flexible wait shrinks or stretches inside its window to land back on plan, and whatever is left moves the rest of the group (shown as +10 min / −5 min). A step running long is shown as over time; a passive step that is due says how long it may still wait.
- Beeps and buzzes (where the phone allows) when a hands-on moment arrives, keeps the screen on, shows the countdown in the tab title, and warns when two groups will need you at once. START EVERYTHING NOW moves the whole plan to now, keeping the stagger; UNDO takes back a DONE.
- The run is saved in the browser, so a reload or a closed tab picks up where you were. BACK TO PLAN keeps it; END RUN clears it.
- SHARE PLAN copies a link (or opens the phone's share sheet) that rebuilds the protocol, times and groups on another device; nothing is uploaded.
- Works offline once opened: a service worker for this tool only keeps a copy of the page, its scripts, styles and fonts.
- Dates and times always show in English, whatever the browser language.
- Tested: 3 more Node tests of the re-plan, 12 headless-browser tests of bench mode with a faked clock (start, overrun, late DONE, alarm, reload, undo, end, two groups, 390 / 1280 px), share links and an offline reload.

## 2026-11-25

New tool: **Protocol Timeline Planner (10.1)** in a new SECTION 10 — PLANNING.

### Protocol Timeline Planner (10.1) — new
- Eight editable templates: western blot (overnight primary), IHC on paraffin (DAB), immunofluorescence on cells, lipofection, sandwich ELISA, co-IP, RNA to qPCR, plasmid miniprep — or a blank protocol. Each step has a time, an optional shortest–longest window, and the minutes you are needed at its start and end (washes: the minutes at each change). Times can be typed as 45, 1:30, 1 h 30 or 16 h.
- Plan from START AT or back from DONE BY, with your working day and minutes kept free at the end. A hands-on step that would fall at night is moved by stretching the nearest flexible step inside its window; the page says which step and by how much, and lists overnight leave and return windows.
- Groups (up to 12) staggered AUTO (earliest clash-free start for 1–3 people), FIXED GAP or SIDE BY SIDE. Each group has an optional buffer (a guard band after each of its hands-on minutes); every hands-on step gets a step buffer (10% by default).
- Timeline: summary, a to-scale chart of every group with nights shaded, notes for clashes, after-hours and weekend work, and a when-to-do-what list built for a phone.
- ADD TO CALENDAR saves an .ics file with every step and an alarm 5 minutes before each (calendar alarms ring when the phone is locked; a web page can't). COPY SCHEDULE and PRINT BENCH CARD.
- MY TEMPLATES: save your edited protocols in the browser, export and import them as JSON.

### Site (planning)
- Homepage SECTION 10 — PLANNING, finder chip and index; structured data lists 25 tools, every tool page says ALL 25 TOOLS; 404 index, `llms.txt`, sitemap, social card (`assets/og/protocol-timeline.png`), About page sources, contact topic "10.1 Protocol Timeline".
- Tested: 14 Node tests of the scheduling core (forward and backward plans, stagger with buffers and 1–2 people, night stretching inside windows, the end of daylight saving, calendar file format) and headless-browser tests of the page, no JS errors, no horizontal scroll at 1440 / 834 / 390 px.

## 2026-11-24

New tool: **Microscopy Nyquist Calculator (8.2)** in SECTION 08 — IMAGING, with an open hardware library (objectives, cameras, confocal and spinning-disk systems) under CC BY 4.0.

### Microscopy Nyquist Calculator (8.2) — new
- Pick the mode (widefield, confocal, spinning disk, two-photon), the stand (tube lens), the objective, the camera or scanner, and up to four channels by dye. Results: target pixel and z step per channel (SVI definitions), the pixel you actually get, the verdict (UNDERSAMPLED / OK / OVERSAMPLED), resolution (Nikon MicroscopyU forms), field of view and the z-stack plan.
- Library: 31 objectives (Nikon, Evident, Zeiss, Leica), 15 cameras, 15 point-scan and spinning-disk systems, 34 dyes. Every entry links to the page its numbers were read from; values not yet confirmed against the maker are marked (check). Discontinued models are kept and marked.
- Every value can be typed by hand (magnification, NA, immersion, tube lens, pixel size, binning, adapter, scan field, zoom, frame, pinhole, wavelengths), so the calculation works for hardware that isn't in the library. Edited values are marked EDITED.
- Suggestions: camera adapter and binning combinations that reach Nyquist, the confocal zoom for a frame size, the spinning-disk pinhole in Airy units, tube-lens mismatch between stand and objective, vignetting for large sensors.
- MY HARDWARE: save your own objectives and cameras in the browser, export and import them as JSON.
- Large SUBMIT TO THE LIBRARY button opens the contact form with the hardware already written in.
- COPY SETTINGS, PRINT CARD, COPY SHARE LINK, and USE µm/px IN SCALE BAR.

### Scale Bar Maker (8.1)
- Camera calibration can now be filled from the library (camera and objective lists), and takes the µm/px sent from the Nyquist Calculator.

### Site (imaging)
- Homepage card in SECTION 08 (2 tools), structured data lists 24 tools, every tool page says ALL 24 TOOLS; 404 index, `llms.txt`, sitemap, social card (`assets/og/nyquist.png`), About page sources, contact topic "8.2 Nyquist Calculator" with a hardware submission template.
- Data lives in `assets/data/microscopy-data.json`; `assets/data/build_data.py` checks it and rebuilds the page script and the library tables.
- Tested: Nyquist, resolution, camera and scan geometry matched an independent Python implementation (largest relative difference 2.2 × 10⁻¹⁶) in 43 Node tests, including the 63×/1.4 oil confocal check (43 nm / 130 nm at 488 nm); 19 headless-browser tests (every mode, manual entry, my hardware, share link, submit hand-off, scale-bar hand-off), no JS errors, no horizontal scroll at 1440 / 834 / 390 px.

## 2026-11-23

New tools: **Flow Antibody Titration Calculator (7.2)** and **Flow Staining Cocktail Calculator (7.3)** in SECTION 07 — CYTOMETRY, sharing one antibody list saved in the browser.

### Flow Antibody Titration Calculator (7.2) — new
- Enter the antibody (target, fluor, clone, lot), the stock in mg/mL and the datasheet's amount per test in µg or µL. Set the staining volume, the cell suspension you add, the start (4× the recommendation by default), the step (2-fold) and the number of tubes (8).
- SERIAL TRANSFER: one top mix carried from tube to tube, with the exact volumes (default: tube 1 = 11 µL antibody + 99 µL buffer, 55 µL into 55 µL buffer each step, 55 µL discarded from the last tube). The antibody mix is made concentrated for the cells you add (50 µL mix + 50 µL cells → 2×). TUBE BY TUBE: antibody and buffer per tube, with one shared predilution for every tube under 0.5 µL. Print with tick boxes, copy or CSV.
- STAIN INDEX: paste a statistics table (FlowJo table editor, FCS Express, Diva, Kaluza, a spreadsheet; tab, comma or semicolon, decimal commas) or open a .csv. Columns are found by name (Median, Robust SD, 84th percentile, + / − populations) and can be changed; amounts are read from sample names (1:200, 0.25 µg, 2 µL, 4x) or taken in order from the series, and can be typed over.
- Stain index (Maecker et al. 2004: (pos − neg) ÷ 2 rSD of the negative), 84th-percentile separation index, or positive ÷ negative when there is no spread column. Marks the best amount and the lowest amount within 90% of it, flags a negative population more than twice as bright as at the lowest amount, and says when the best is at the top or bottom of the series. Chart as SVG or PNG, results CSV.
- SAVE TO MY ANTIBODIES keeps the chosen amount with the staining volume, cells, date and index; the list can be exported and imported as JSON.

### Flow Staining Cocktail Calculator (7.3) — new
- Tubes to stain with extra as a percentage or whole tubes, final staining volume and cocktail per tube. Antibodies in µL per test, µg per test (with stock) or 1:X of the staining volume; add them from MY ANTIBODIES (a titer from another staining volume is scaled to the same concentration) or send the panel from Panel Designer.
- One table in order of addition — staining buffer, Brilliant Stain Buffer (presets 50 µL / Plus 10 µL per test, editable), Fc block, antibodies — with per-tube and total volumes, µg used, tick boxes, and the cocktail total.
- Checks: totals under 0.5 µL (with a predilution and the tube count that avoids it), antibodies that don't fit the cocktail volume (with the smallest volume that works), two or more Brilliant polymer dyes without Brilliant Stain Buffer. Rows ticked VIABILITY go to their own table, to stain in protein-free PBS first.
- PRINT SHEET, CSV and COPY SHARE LINK (the whole cocktail in the link).

### Site (cytometry)
- Panel Designer: new BUILD STAINING COCKTAIL button sends its markers and dyes to 7.3; related tools now point to 7.2 and 7.3.
- The ELISA page's file reading moved to a shared `assets/grid-core.js`, also used by 7.2; ELISA behaves the same (its 50 tests pass unchanged).
- Homepage cards in SECTION 07 (3 tools), structured data lists 23 tools, every tool page says ALL 23 TOOLS; 404 index, `llms.txt`, sitemap, social cards (`assets/og/antibody-titration.png`, `assets/og/staining-cocktail.png`), About page sources, and contact topics "7.2 Antibody Titration" and "7.3 Staining Cocktail".
- Tested: series, indexes and cocktails matched an independent Python implementation (largest relative difference 2 × 10⁻¹⁶) in 23 Node tests; 17 headless-browser tests (series plan, shared predilution, paste → stain index, separation index from semicolon CSV, downloads, library across both pages, titer scaling, warnings, row removal right after typing, share link, Panel Designer hand-off), no JS errors, no horizontal scroll at 1440 / 834 / 390 px.

## 2026-11-21

New tools: **ELISA Standard Curve Analyzer (5.5)** and **SDS-PAGE Gel Recipe Calculator (5.6)** in SECTION 05 — CELLS & PROTEIN, and **Buffer Recipe Calculator (2.7)** in SECTION 02 — CALCULATORS.

### SDS-PAGE Gel Recipe Calculator (5.6) — new
- Pick the plates — Bio-Rad Mini-PROTEAN 0.75, 1.0 or 1.5 mm (4.2 / 5.6 / 8.4 mL cassettes, from the Mini-PROTEAN Tetra manual) or any glass size by width × height × spacer — and the number of gels. Up to four resolving percentages in one batch (e.g. two 10% and two 12% gels), one stacking gel for all of them.
- Overage (10% by default) and an optional round-up of each mix to 0.5, 1 or 5 mL. The resolving gel takes 75% of the cassette by default (about 1.5–2 cm left for the stacking gel and comb on a mini gel); the share can be changed, and the page shows what to pour per gel.
- YOUR STOCKS, kept in the browser: 30% or 40% acrylamide/bis (ratio label 37.5:1, 29:1 or 19:1), Tris-HCl pH 8.8 and pH 6.8 molarities, SDS and APS strengths, and the final concentration of every component (Laemmli defaults: 0.375 M / 0.125 M Tris, 0.1% SDS, 0.05% APS, 0.05% / 0.1% TEMED). Any of them can be 0, e.g. no SDS for a native gel. A link opens the stocks in the Buffer Recipe Calculator.
- Water EXACT TOTAL (the mix is exactly the volume shown) or AS PRINTED (APS and TEMED left out of the water sum, the way most printed recipes are written).
- One recipe card per mix in order of addition — water, Tris, acrylamide, SDS, then APS and TEMED last — with a tick box per component, the total and the volume to pour per gel. Flags volumes under 2 µL, a stacking gel not below the resolving gel and percentages above 20%; refuses a gel percentage at or above the acrylamide stock and mixes whose components add up to more than the volume.
- COPY RECIPE and PRINT (recipe cards only, with tick boxes).
- Tested: every volume matched an independent Python implementation on six single mixes and three multi-gel plans (largest relative difference 3 × 10⁻¹⁶), and reproduces the Bio-Rad manual's 10 mL 10% gel (4.1 mL water as printed, 3.33 mL acrylamide, 2.5 mL Tris, 0.1 mL SDS, 50 µL APS, 5 µL TEMED) and the Robertson lab's 40% acrylamide resolving and stacking gels; 8 headless-browser tests (stocks kept after reload, ticking, refusals, extra percentages, notes, copy), no JS errors, no horizontal scroll at 1440 / 834 / 390 px.

### Buffer Recipe Calculator (2.7) — new
- 14 built-in recipes, each with its 1× composition and source on the page: Tris-glycine-SDS running buffer, Towbin transfer buffer, TBS, TBST, PBS, PBST, RIPA, TAE, TBE, 1.5 M Tris-HCl pH 8.8, 0.5 M Tris-HCl pH 6.8, 10% SDS, 10% APS and 0.5 M EDTA pH 8.0, plus a custom recipe.
- MAKE FROM POWDER: any strength (5×, 10×, 50× or 1×) and volume gives the grams or millilitres of each component, the pH step and the volume to make up to. DILUTE A STOCK: stock, water and the at-use additions for any volume and strength.
- Every row can be edited: concentration at 1× in M, mM, µM, % w/v or % v/v; powder (needs the MW), neat liquid (methanol, Tween-20, NP-40, glacial acetic acid as 17.5 M) or a stock solution you already have; AT USE for what goes in only at working strength, such as the methanol in transfer buffer or the Tween in TBST. Hydrates: type the MW on the bottle (Na₂HPO₄ forms listed). Edited recipes are marked and can be restored.
- Notes when a stock is stronger than the usual one, a mass is under 10 mg, a stock solution is too weak for the strength asked, or the liquids don't fit.
- COPY RECIPE and PRINT. `?preset=` opens a recipe directly.
- Tested: every amount matched an independent Python implementation on nine recipes and four dilutions, and reproduces 10× PBS (Fisher: 80 g NaCl, 2 g KCl, 14.4 g Na₂HPO₄, 2.4 g KH₂PO₄), 5× TBE (CSH Protocols: 54 g, 27.5 g, 20 mL) and 10× TAE (Fisher: 48.4 g, 11.4 mL); 8 headless-browser tests (presets, Towbin dilution 100 + 200 + 700 mL, hydrate MW, editing a row's form, weak-stock refusal, `?preset=`, copy), no JS errors, no horizontal scroll at 1440 / 834 / 390 px.

### Site (gels & buffers)
- Homepage cards in SECTION 02 (7 tools) and SECTION 05 (6 tools), structured data lists 21 tools, every tool page says ALL 21 TOOLS; 404 index, `llms.txt`, sitemap, social cards (`assets/og/sds-page-gel.png`, `assets/og/buffer-recipes.png`), About page sources, and contact topics "2.7 Buffer Recipes" and "5.6 SDS-PAGE Gel Recipe".

### ELISA Standard Curve Analyzer (5.5) — new
- Open or drop the plate reader export, or paste the 8×12 block from Excel (with or without the A–H / 1–12 labels, or as a well + value list). Reads BioTek Gen5 (also two reads on alternate lines), SoftMax Pro plate format (wavelengths side by side, UTF-16), Tecan i-control / Magellan, BMG MARS (plate or list, decimal commas), Thermo SkanIt and PerkinElmer EnVision / VICTOR layouts, .txt, .csv or .xlsx. With several reads the 450 nm signal and the 570–690 nm reference are picked and the reference is subtracted per well; both can be changed. Overflow marks (OVRFLW, Over, Range?, ***) count as saturated wells. REPORT A FORMAT PROBLEM (step 1, opens by itself when a file can't be read) sends what went wrong, the reader and what the page detected through the site's contact form, optionally with the file's first rows with every digit masked; the preview shows exactly what is sent and the file is never uploaded.
- Layout on a tappable 8×12 plate: STANDARD, SAMPLE, CONTROL, BLANK, EXCLUDE or ERASE, 1–4 replicates across or down, auto-numbered; four common kit layouts in one tap. Standard concentrations typed or filled from the top and the fold (last one 0); a name and dilution per sample, typed, set for all, or pasted as a list; controls take an expected value.
- Fit: 4PL or 5PL by weighted least squares (1/Y², 1/Y or none, weights from each standard level's mean OD so the fit can be reproduced elsewhere), Levenberg–Marquardt from many starting values. AUTO uses 5PL only when an F-test favours it and its parameters are well determined; otherwise it says why 4PL was used (no convergence, a parameter on its limit, asymmetry with SE larger than itself, starts disagreeing, too few points). Parameters with SE, R², S<sub>y.x</sub>, iterations and how many starts agree.
- Zero standard fitted as a point or subtracted; blank wells subtracted when there are any. Sandwich and competitive assays (direction detected, %B/B0 shown, a warning if it contradicts the type you chose).
- Standards read back off the curve with recovery; the quantification range (LLOQ–ULOQ) is the widest run recovering 80–120% with CV ≤ 20%, one more level at either end at 75–125% / 25% (FDA 2018, ICH M10), or simply all standards. LOD from the zero standard or blanks (mean ± 3 SD).
- Results: in-well concentration, × dilution, the value to report (> ULOQ × dilution or < LLOQ × dilution when out of range, the extrapolated number only in grey), flags for > ULOQ, < LLOQ, above / below the curve, saturated, high replicate CV (15% by default), single well, < LOD and control recovery outside 80–120%. Each flagged sample gets the next step, e.g. "Dilute 10× more — re-run at 1:20", "Re-run less diluted, at 1:2", or "Replicates disagree", collected in a copyable re-run list. Tap a row for the working with its numbers.
- Curve chart (log axis, zero standard on a broken axis, range shaded, samples on the curve) as SVG or PNG; COPY TABLE; CSV; COPY METHODS paragraph; PRINT REPORT (or save as PDF) with analyte, lot, operator, date, plate map, fit, standards, results and re-run list; SAVE RECORD (`.elisa.json`, algorithm `labmate-elisa-1`; reopening recalculates and says whether every result matches).
- English and 中文: a switch in the top bar changes the whole page, results, methods paragraph and report; it follows `?lang=zh`, then your last choice, then the browser language.
- Example on first visit: a simulated human IL-6 sandwich ELISA in Gen5 format; the file can be downloaded.
- Tested: 4PL and 5PL parameters, standard errors, residual sums of squares and F-test p-values match SciPy's MINPACK Levenberg–Marquardt on four simulated curves × three weightings (largest relative parameter difference 5 × 10⁻⁶), and 5PL is refused on a curve with too few points; 11 rule tests (range, flags, advice, blank handling, competitive, exclusions); the same plate written in eight export layouts gives identical values; 15 page tests (layout painting, exclusion, settings, language switch, CSV, record round-trip and tamper check, paste, print), no JS errors, no horizontal scroll at 1440 / 834 / 390 px in both languages. The export layouts were written from the vendors' documented formats, not from files exported in a lab.

### Site (ELISA)
- Homepage card in SECTION 05 (5 tools), structured data lists 19 tools, every tool page says ALL 19 TOOLS; 404 index, `llms.txt`, sitemap, social card (`assets/og/elisa.png`), About page sources, and contact topic "5.5 ELISA Standard Curve" with a template for adding a plate reader.

## 2026-11-20

New tool: **Cloning Reaction Calculator (2.6)** in SECTION 02 — CALCULATORS.

### Panel Designer (7.1) — SUGGEST explains its picks
- Two suggested dyes that need the same detector (conventional) or have near-identical signatures (spectral), such as BV421 and Alexa Fluor 405, are now labelled "either this or …, not both". The list says it holds alternatives for one row; dyes already in the panel were, and still are, kept off a detector they would share.
- Brightness values from the BioLegend Fluorophore Brightness Index (1–5) added for 18 more dyes: BV421, BV510, BV570, BV605, BV650, BV711, BV750, FITC, Alexa Fluor 488, PerCP, PerCP-Cy5.5, PE-Cy5, PE-Cy7, APC, Alexa Fluor 647, Alexa Fluor 700, APC-Cy7 and APC-Fire 810 — 27 of the 199 built-in dyes now have one, including every antibody dye in the sample panel. EXPRESSION now changes the suggestions for most common panels (on the sample Attune NxT panel, LOW brings in BV605 and drops PerCP).
- Each suggestion shows the brightness it was scored with and whose rating it is (e.g. "4/5, BioLegend"), or "brightness unknown". The page now says plainly that brightness is each vendor's relative rating for its own conjugates, not one absolute scale across vendors (DYE 1–5 header, the hover on each value, the note under SUGGEST and a new FAQ). Pick a number in DYE 1–5 to use your own.
- On a row marked CHECK, your own DYE 1–5 rating for the dye already on it is now used when that dye is scored again, the same way the CHECK column uses it.
- Rankings are otherwise unchanged. Tested: 14 headless-browser regression tests (same-row and cross-row BV421 / Alexa Fluor 405 on the Attune NxT and Cytek Aurora, expression with known and unknown brightness, your own rating, share-link restore), no JS errors, no horizontal scroll at 1440 / 390 px.

### Cloning Reaction Calculator (2.6) — new
- One fragment table for three systems: ligation with T4 DNA ligase, Gibson and NEBuilder HiFi assembly, and Golden Gate with BsaI-HFv2 or BsmBI-v2. Switching keeps your fragments and changes only the rules and the mix.
- Per fragment: length in bp and a concentration in ng/µL or nM give pmol/µL, nM and the µL to take, with the pmol and ng that volume really delivers and the molar ratio it really gives after rounding to your pipette (0.1, 0.25 or 0.5 µL).
- Ratios start at what the protocol asks for and can be typed over: a 2-fold excess of each insert for 2–3 fragments by NEBuilder HiFi, 1:1 for 4–6, 5-fold for an insert under 200 bp, 2:1 insert:vector for Golden Gate, 1:3 for a ligation (1:10 at 100 bp or less).
- Set the amount by the vector in ng, the way protocols are written, or by the total pmol you want in the tube.
- Checks with the number that fixes them: the fragments will not fit in the reaction (run it in 25 or 50 µL, scale the DNA down if the lower total stays in range, or concentrate the fragment that takes the most room — one tap applies it), a volume under 0.5 µL (the dilution that makes it 1 µL), unpurified PCR product over 20% of the reaction, total DNA outside the vendor's range, vector outside 50–100 ng, a short insert below the 5-fold excess, a ratio rule that changed at 4 fragments, rounding over 10%, and a concentration that looks like the wrong unit.
- Master mix, buffer, enzyme and water are worked out from the reaction volume, with the incubation for the system and fragment count printed beside it. Scale to any number of reactions with overage.
- WORKING panel shows the arithmetic for any fragment. COPY RECIPE and PRINT SHEET (components, per-reaction and master-mix volumes, check boxes, the fragment table, incubation, checks and sign-off lines).
- On a phone each fragment becomes a card, so TAKE µL is never off-screen.
- Tested: every pmol/µL, volume, rounded amount, molar ratio, water volume and total matched an independent Python implementation on five test sets (two-fragment HiFi, five-fragment HiFi by total pmol, a ligation with a short insert, a nine-insert Golden Gate and an nM-input Gibson in 25 µL at 0.5 µL steps), 0 mismatches; fix buttons, paste, printing and the example were checked in a headless browser, no JS errors, no horizontal scroll at 1440 / 834 / 390 px.
- Reference section: total DNA and molar ratio by system with the vendor sources, and an ng-per-pmol table by fragment length. Contact topic "2.6 Cloning Reaction".

## 2026-11-18

New tools: **qPCR Relative Quantification (2.5)** in SECTION 02 — CALCULATORS, and **Rodent Dosing Sheet (9.1)** in a new SECTION 09 — ANIMALS.

### Rodent Dosing Sheet (9.1) — new
- Paste the batch from Excel or a weighing log (ID, cage, group, weight in g), or open a CSV. Columns are found by header name, or by position without one; tabs, commas, semicolons, decimal commas and "25.3 g" are read. A list that looks like it was typed in kg can be converted with one click.
- Species (mouse, rat, other) and route (PO, IP, SC, IV bolus, IV slow injection, IM). Two ways to dose: a known working concentration (mg/mL), or a fixed volume (mL/kg) that gives the concentration to make. Doses per group in mg/kg or µg/kg; a dose of 0 is a vehicle group and gets the same mL/kg as the dosed groups.
- Each volume is rounded to the chosen syringe's graduations (0.3 / 0.5 / 1 / 3 / 5 mL, 100 µL Hamilton, or your own), with the change in dose shown; TOO SMALL (under 2 graduations) and ROUNDING (over 5%) flags suggest a finer syringe or the dilution that fixes it. OVER SYRINGE when one dose won't fit.
- Volume limits: good-practice (amber) and maximum (red) from Diehl et al. 2001, a CONSERVATIVE set (lower of Diehl and the ULAM-based tables of Wayne State / WVU), or MY INSTITUTION — your own table, kept in the browser. IM is checked per site with the number of sites needed; mouse SC over 1 mL is told to split sites. When a group is over, the page gives the lowest concentration that brings it back to good practice. Also flagged: unusual weights, missing weights, duplicate IDs, oil or suspension vehicles for IV, more than 10% DMSO for IP/IV.
- Recipe per group: days × doses per day, overage %, dead volume per animal, salt factor and purity; drug to weigh, or stock to take (the stock counts toward its solvent, e.g. the 10% DMSO, and the page says when the stock is too weak to fit); each vehicle component in order of addition. Presets: saline, PBS, corn oil, 0.5% CMC-Na, 10% DMSO / 40% PEG300 / 5% Tween-80 / 45% saline, 10% DMSO in corn oil, 10% DMSO in 20% SBE-β-CD, or custom.
- WORKING panel puts any animal's numbers into the formula. COPY TABLE, CSV, SAVE RECORD (`.dosing.json`, algorithm `labmate-dosing-1`; reopening recalculates and says whether every volume matches).
- PRINT DOSING SHEET: study, protocol, compound/lot, date and operator; per group, large-type volumes, a check box per dose day, time, initials and notes columns, flagged animals marked ⚠, the preparation recipe with prepared-by / checked-by lines; optionally a new page per group.
- Example on first visit: tamoxifen 75 mg/kg IP in corn oil, 5 days, two cages.
- Tested: every per-animal dose, volume, rounding, mL/kg, limit flag and recipe total matched an independent Python implementation on four test sets (120 values, largest relative difference 2 × 10⁻¹⁶), including fixed mL/kg with four dose groups, a DMSO stock with salt factor and purity, a rat SC course in µg/kg and IM per-site limits; kg conversion, stock and vehicle-sum errors, custom limits, CSV, record round-trip and printing (A4 / Letter, one page per group) work; no horizontal scroll at 1440 / 834 / 390 px; no JS errors.
- Contact: "9.1 Dosing Sheet" in the contact form; "Send it to us" next to the limits opens the form with a template for an institution's volume table.

### Site (dosing)
- Homepage: new SECTION 09 — ANIMALS with its filter chip and INDEX line; structured data lists 17 tools; every tool page says ALL 17 TOOLS. 404 index, `llms.txt`, sitemap, social card (`assets/og/dosing.png`) and the About page's sources list updated.

### qPCR Relative Quantification (2.5) — new
- Open or drop the results export from the qPCR instrument (several files at once): Bio-Rad CFX (Quantification Cq Results, .csv/.xlsx), Thermo QuantStudio / ViiA 7 / 7500 / StepOne (.txt with its [Results] section, or .xlsx), Roche LightCycler 480 (text, one file per channel — name the gene) and LightCycler 96, Qiagen Rotor-Gene, RDML, or any table with sample, gene and Cq columns. Paste from Excel works too, including a samples × genes table. Semicolon files with decimal commas are read correctly. The header row is found automatically; the columns used can be changed per file. Old .xls and run files (.eds) get a message saying what to export instead.
- **Can't read your instrument?** A link on the page and in the reference table opens the contact form set to qPCR, with a template for the instrument, software version and export menu.
- Design: samples are biological replicates, grouped from names like Ctrl_1 / KO 3 (or CFX's Biological Set Name); common reference genes are recognised; control group and calibrator (control-group mean or one sample) can be chosen.
- Efficiency per gene: 100% (2^−ΔΔCq), a typed value (95 or 1.95), or fitted from the standard wells in the file (slope, E, R², number of levels, flags outside 90–110%, R² < 0.98, < 5 levels).
- Check: plate map (96/384) coloured by gene — tap a well to exclude it; replicate table with HIGH SD, NO AMP, NOT DETECTED, LATE Cq and SINGLE WELL flags; for triplicates the well furthest from the median is pointed out when dropping it brings the SD below 0.2. Nothing is removed automatically. Undetermined wells are never set to 40. NTC / no-RT wells within 5 cycles of the samples are flagged.
- Reference genes: geNorm M with two or more references, and a REFERENCE SHIFT warning when the reference level differs by more than 0.5 log₂ units between groups.
- Calculation: efficiency-corrected relative quantities normalised to the geometric mean of the references (Hellemans 2007); with E = 2 this is exactly −ΔΔCq, with one reference it is Pfaffl. Group fold change = 2^mean of the replicates' log₂ values, with error bars (SEM, SD or 95% CI) on the log scale; one sample per group shows the technical error only and is labelled so. Welch t-test against the control with Holm correction (n ≥ 3 per group).
- Results: fold-change chart (log₂ or linear axis, dots for every replicate, p-values optional) as PNG or SVG; table; per-replicate values with a WORKING panel that puts the numbers into the formula; COPY TABLE; CSV with groups, replicates, efficiencies and every well (and why it was excluded); COPY METHODS paragraph with efficiencies, references, calibrator, exclusions, statistics and geNorm M; SAVE RECORD (`.qpcr.json`, algorithm `labmate-qpcr-1`; reopening recalculates and says whether every result matches); PRINT.
- Example run (QuantStudio text export) on first visit; the file can be downloaded.
- Tested: results match an independent NumPy/SciPy implementation (relative difference ≤ 3 × 10⁻⁶ on three test sets, including three groups, three references and typed efficiencies); the same run written as CFX .csv/.xlsx, QuantStudio .txt/.xlsx, 7500, LightCycler 480 (incl. a UTF-16 file), LightCycler 96, Rotor-Gene, RDML, a semicolon/decimal-comma file and a wide table gives identical fold changes; excluding a well, the record round-trip and all exports work; no horizontal scroll at 1440 / 834 / 390 px; no JS errors. The export layouts were written from the instruments' documented formats, not from files exported in a lab.

### Contact form — new
- New **Contact** page (`/contact/`) replaces the hello@labmate.tools email links everywhere. Pick what it's about from a list of every tool (or the site in general, or a new tool request), choose Question / Problem / Request, add a name and email if you want a reply, and send. Messages go through Formspree; the Privacy page says so.
- Every tool page has a CONTACT link in the footer and "Question or problem? Contact us" under Related tools; both open the form with that tool already selected.
- Homepage "Send a request", the FAQ, About and Privacy now point to the form.

### Site
- Homepage: qPCR ΔΔCq in SECTION 02 (now "Mixes, dilutions, molarity, qPCR"), INDEX shows 5 calculators; structured data lists 16 tools.
- 404 index, `llms.txt`, sitemap, social card (`assets/og/qpcr.png`) and the About page's sources list updated; every tool page now says ALL 16 TOOLS.

## 2026-11-10

New tool: **Doubling Time & Growth Rate (5.4)** in SECTION 05 — CELLS & PROTEIN.

### Doubling Time (5.4) — new
- One table for a whole batch of cultures: name/batch, start count N₀, end count N, optional split factor, interval, note. Up to 300 rows; Enter on the last row adds the next one (P14 → P15).
- Time as an **interval** (hours or days — switching converts the numbers) or as **start and end date-times**; the interval is then worked out and locked.
- Counts are total cells, or cells/mL with a warning that the volume must not have changed.
- For each row: fold change, **population doublings**, **doubling time** and **specific growth rate μ** (/h and /day), kept apart; doublings per hour is shown separately and labelled "not μ".
- Tap a row for the full **working**, plus the doubling-time range if each count is off by 10%.
- Checks: NO NET GROWTH (no doubling time given, nothing forced positive), SMALL CHANGE (< 1.5-fold), SHORT INTERVAL (< 12 h), LONG INTERVAL (> 7 days), VERY FAST (< 10 h), SPLIT (assumed exact). Bad inputs are highlighted and the row says why.
- **By cell line**: rows with the same name (a trailing passage number like P14 ignored) give cumulative doublings and an overall doubling time = total time × ln 2 ÷ total ln(fold).
- Import: paste from Excel or open a CSV — columns by position, or found by header name (start, end, hours/days, split, start time, end time, note).
- Export: COPY TABLE, CSV with every intermediate value, **SAVE RECORD** (`.growth.json` with inputs, settings, results, algorithm `labmate-dt-1`; reopening recalculates and says whether every value matches), **PRINT WORKSHEET** (landscape, with formula line and Counted by / Checked by).
- Table kept on this device; CLEAR empties it. Example cultures on first visit.
- Tested in headless Chromium: 100,000 → 400,000 in 48 h gives 2 doublings, 24 h, μ 0.02888 /h; hours ↔ days and date-time intervals give the same result; per-line overall values checked by hand; record round-trip matches; Cell Count hand-off; no horizontal scroll at 1440 / 834 / 390 px; no JS errors.

### Site
- Cell Count & Seeding: **LOG FOR DOUBLING TIME →** sends this count (cells/mL × mL you have) with the time now. The first count starts a row, the next one finishes it. Related tools include Doubling Time.
- Homepage: Doubling Time in SECTION 05 (now "Counting, growth, loading & blots"), INDEX shows 4 tools; structured data lists 15 tools.
- 404 index, `llms.txt`, sitemap and social card (`assets/og/doubling-time.png`) added; every tool page now says ALL 15 TOOLS.

## 2026-11-08

New tool: **Blot Densitometry (5.3)** in SECTION 05 — CELLS & PROTEIN.

### Blot Densitometry (5.3) — new
- Open the blot image from your imager; it is measured in the browser and never uploaded. Own PNG and TIFF readers take the **raw pixel values** (no browser colour or gamma correction): 1–16-bit grey PNG; 8/16/32-bit grey TIFF incl. float, uncompressed, LZW, PackBits, Deflate. RGB with equal channels is used as grey; true colour is measured as (R+G+B) ÷ 3 like ImageJ and flagged; JPEG/WebP open but are flagged as lossy. White-is-zero TIFFs are flipped to match the display. Vendor formats (.scn, .1sc…) get an "export a TIFF" message. Up to 40 MP.
- Lanes: count, reference lane, sample names pasted one per line (or sent from Protein Loading).
- Band rows (up to 6): name, role (target / loading control), NORMALISE TO, one box size per row. **PLACE ROW** — click the first and last band, boxes go on every lane evenly spaced; drag, arrow keys (Shift = 10 px), MOVE WHOLE ROW; background box per band, placed above or below; exclude a lane.
- Arithmetic: corrected = Σ − background × area (light bands) or background × area − Σ (dark bands); background = mean or median of the equal-size box, or none. Normalised = target ÷ control in the same lane; relative to the reference lane. Negatives are reported as they are.
- Checks: file type and bit depth, polarity vs. the image, saturated pixels (0 or the type maximum) per band, boxes past the edge, background overlapping a band, bands within 3× background noise, missing lanes, loading-control spread > 1.5×, unusable reference lane.
- Display contrast (black/white, auto, full range, invert) never changes the numbers. Selected-box panel with values and a profile down the box.
- Results table + bar chart. Export: **project file** (`.blot.json`: original image, boxes, settings, algorithm `labmate-bd-1`, saved results — reopening recomputes and says whether every value matches), CSV with every intermediate value, COPY TABLE for Excel, image with boxes (PNG), **ImageJ macro** that draws and measures the same rectangles in Fiji, COPY METHODS sentence.
- Box positions for the last image are remembered on this device; reopening the same file offers RESTORE BOXES.
- SAMPLE BLOT: a fictional 16-bit blot (6 lanes, target + β-actin, one over-exposed band).
- Tested in headless Chromium: 11 file variants (16-bit TIFF ×4 compressions, 16/8-bit PNG, 8-bit TIFF, RGB equal/unequal PNG, 32-bit float TIFF, white-is-zero TIFF) — box sums, areas and median backgrounds match NumPy exactly; project file round-trip matches all 12 values; no horizontal scroll at 1440 / 834 / 390 px; no JS errors.

### Site
- Homepage: Blot Densitometry in SECTION 05 (now "Counting, seeding, loading & blots"), INDEX shows 3 tools; structured data lists 14 tools.
- 404 index, `llms.txt`, sitemap and social card (`assets/og/blot-densitometry.png`) added; every tool page now says ALL 14 TOOLS.
- Protein Loading: **QUANTIFY THE BLOT →** sends the sample names as lanes; related tools include Blot Densitometry.

## 2026-10-15

New section and tool: **SECTION 08 — IMAGING · Scale Bar Maker (8.1)**.

### Scale Bar (8.1) — new
- Drop a batch of microscope images (PNG, JPG, WebP, BMP, TIFF). Images are opened in the browser and never uploaded.
- Calibration three ways: type µm/px (or nm/px, px/µm); **MEASURE** — drag a line across a stage micrometer or any known length, with 1-px nudges and a horizontal lock; **CAMERA** — camera pixel × binning ÷ magnification, marked as an estimate.
- Named **presets** per microscope set-up (objective, camera, binning, image size), kept in this browser; export/import as JSON. A preset used on images of a different size is flagged ("fine if cropped, wrong if resized").
- Reads the scale saved in **ImageJ / Fiji TIFFs, OME-TIFF PhysicalSizeX**, centimetre TIFF resolution tags and PNG pHYs; shown as a suggestion and checked against the value in use. Print DPI values are ignored.
- Built-in TIFF reader: 1/8/16/32-bit grey, RGB, palette; uncompressed, LZW, PackBits, Deflate; first page of a stack. 16/32-bit images become an 8-bit display copy (MIN–MAX or FULL RANGE), noted per image. Tiled TIFF, BigTIFF and vendor formats (.czi, .nd2, .lif, .oib) are refused with a clear message.
- One bar for the whole batch: AUTO picks the largest 1-2-5 round length up to 20% of the narrowest field, or FIXED length in nm/µm/mm. Corner, colour, label above/below/none, Arial or Plex Sans, background box, outline; thickness, text and margin scale with each image.
- Drag the bar on any image; USE THIS SPOT ON ALL; per-image calibration (batch, from the file, or its own / a preset).
- Checks per image: calibration and source, scale in file, bar length in px with rounding error (flagged > 1%), fits on the image, contrast behind the bar, bit depth, stack pages, > 16.7 MP on iPad.
- Export: ZIP of copies at the original pixel size (PNG, JPG or same as file) + `calibration.csv` + settings JSON; single image; CSV only; COPY LEGEND ("Scale bars, 50 µm."). Own ZIP writer, no libraries.
- SAMPLE BATCH: a drawn stage micrometer (measured automatically), three fictional micrographs and a 16-bit ImageJ TIFF, all at 0.5 µm/px.
- Tested in headless Chromium: 10 TIFF variants decoded pixel-identical to the source; bars measured in the exported PNGs at exactly 80 px (20 µm at 0.25 µm/px) and 100 px (50 µm at 0.5 µm/px); no horizontal scroll at 1440 / 834 / 390 px; no JS errors.

### Site
- Homepage: SECTION 08 — IMAGING in the catalog, INDEX and filter chips; intro mentions the microscope; structured data lists 13 tools.
- 404 index, `llms.txt`, sitemap and social card (`assets/og/scale-bar.png`) added; every tool page now says ALL 13 TOOLS.
- Poster Check's related tools now include Scale Bar.

## 2026-10-12

Making every page easier for search engines and AI assistants to read, trust and quote.

### Every tool page
- New **REFERENCE** block above the FAQ: the values each tool uses, as plain tables on the page instead of only inside the script — plate and flask areas (Cell Count & Seeding), the 13 cytometer presets with their source sheets and the dye list by laser (Panel Designer), the built-in cryo label sheets (Cryo Labels), poster sizes, check thresholds and text sizes (Poster Check), samples per plate by replicate (Plate Layout), SLAS plate geometry (Plate Tracker), 1× from concentrated stocks (Dilution), common buffer reagents (Molarity), rpm for common × g (RPM ↔ g), kit standard series (Protein Loading), overage (Master Mix) and two common series (Serial Dilution).
- Worked examples added where there were none: Plate Layout, Plate Tracker, Cryo Labels, Poster Check, Panel Designer. Every example was run through the tool itself.
- 2–4 more questions per FAQ (37 in all), answered in a sentence or two with numbers; the structured data matches the visible text.
- "Last updated" date on every tool page, with `dateModified` in the structured data.
- Section headings no longer run their two parts together when read as text.

### Site
- New **About** page: what the site is, who it is for, where the values come from and how they are checked. Linked from the homepage, Privacy and every tool page.
- Homepage: one-sentence definition of labmate.tools under Good to know, and a short FAQ.
- The organisation's LinkedIn page is linked in the structured data of every page.
- New `llms.txt`: a plain list of every tool with its address and what it does.
- Sitemap: About page added; dates updated.
- IndexNow key file added, so Bing can be told about updates straight away.

## 2026-10-05

Review of all 12 live tools, then the changes below.

### Site
- Homepage strip and intro no longer say "small tools" or list individual tools; the intro now describes the toolbox by area.
- All 12 tools show **READY** instead of IN PROGRESS in the catalog.
- Cryo Labels, Poster Check and Panel Designer use the same top bar as the other tools (logo, section number, ALL TOOLS); their links point to `#find`.
- Plate Tracker footer gains Privacy and Plate Layout links; old-style footers now include INDEX.
- New `assets/handoff.js`: passes data from one tool page to the next through browser storage, once, within 15 minutes. Nothing is uploaded.

### Tools working together
- **Plate Layout → Plate Tracker**: TRACK IN PLATE TRACKER opens every layout plate as a tracker plate; empty wells start skipped and each well carries its sample name.
- **Plate Layout → Master Mix**: the number of filled wells becomes the number of reactions.
- **Plate Layout → Cryo Labels**: the sample list becomes the label list.
- **Serial Dilution → Plate Layout**: PUT ON A PLATE sends the tubes (and blank) as standards, in duplicate, ahead of the samples.
- **Molarity → Dilution**: DILUTE THIS STOCK makes the stock just calculated the C₁ of a new dilution.

### Plate Tracker (1.1)
- Up to 12 plates per format, shown as chips under PLATES; + NEW adds one, DELETE THIS PLATE asks for a second tap. Saved state moves to v3; v1/v2 plates are migrated.
- ROUND LOG records the time each round reached PASS (removed again on undo); COPY LOG pastes the plate, rounds and times into a notebook.
- With an imported layout, NEXT WELL also shows the sample, and every well's tooltip names it.

### Master Mix (2.1)
- SEVERAL TARGETS? — list genes / primer pairs; the answer, summary, copy and print give one mix per target with the same recipe.

### Protein Loading (5.2)
- One-tap kit standard series: BCA (2000 → 25 µg/mL), Micro BCA (200 → 0.5), Bradford BSA (2000 → 125), each with a 0 blank.
- PASTE FROM THE PLATE READER: paste the 8 × 12 export, choose single / duplicate / triplicate across and the read order; a mini plate shows which wells become standards and which samples, then both tables are filled.

### Panel Designer (7.1)
- SUGGEST on open rows and rows marked CHECK: ranks up to four dyes by detector clash, spill sent and received (spectral: signature similarity), brightness against expression and how well the instrument excites and detects them. Viability, DNA, proliferation dyes and fluorescent proteins are only offered on matching rows.
- FPbase attribution with the CC BY-SA 4.0 licence link in Good to know, the spectra chart caption and the footer. The static "published peak values" line is replaced.

### Not done today
- RPM ↔ g rotor presets and TESTED marks on Cryo Labels sheets: both need checking against manufacturer specs or a real printer first.
