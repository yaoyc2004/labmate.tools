# labmate.tools — changelog

Newest first. One entry per working day; each line says what changed for someone using the site.

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
