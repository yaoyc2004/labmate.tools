# labmate.tools — changelog

Newest first. One entry per working day; each line says what changed for someone using the site.

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
