# Zilventor × ViyarPro/Viyar — Customer Demo Scenario

## Purpose

This demo proves one thing to a furniture-maker who already lives in ViyarPro
(viyar.ua's online constructor) and ships jobs to Viyar production: **Zilventor
can replace the SketchUp+ABF-plugin step of that workflow end-to-end** — model
a cabinet, auto-generate carcass boring (присадка) and hardware, nest it onto
sheet stock, and hand off DXF/CSV files ViyarPro's importer and Viyar's cutting
line already understand — without asking the customer to change how they work
downstream. Everything referenced below is a real file or screenshot already
sitting in this folder (`docs/demo/viyarpro-abf-demo/`), produced by a live
run of the app against the demo kitchen project; nothing here is a mockup.

## At-a-glance

**Agenda (~30 min + Q&A)**

| Act | Time | What we show |
|---|---|---|
| 1 — Design live | ~10 min | Build one door cabinet from scratch: dimensions → carcass boring → door → System-32 shelf pins |
| 2 — ABF plugin parity | ~5 min | What ABF is, our parity status (R1–R7), the ABF layer-scheme toggle, importing a real ABF export |
| 3 — Production package | ~10 min | Nest, statistics/BOM, per-material manufacturing DXF, labels, packing slip — the files that go to Viyar |
| Q&A | ~5 min | Anticipated objections, see §6 |

**Assets checklist** (this folder)

- `project/demo-kitchen.ziasm` — the pre-built two-cabinet kitchen (open this after the live build)
- `exports/` — 10 files, every export button's output already generated once (see §8 for the full inventory)
- `screenshots/` — 16 reference PNGs (`01`–`16`), captioned throughout this doc
- ABF import fixture: `tests/e2e/fixtures/abf-flatten-sample.dxf` (repo-relative from `zilventor/`)

**Pre-demo setup checklist**

1. `cd packages/app && pnpm dev` → open `http://localhost:5173`
2. Maximize the browser window (see gotcha in §7 — the ABF Layer Scheme toggle
   sits at the far right of the Присадка ribbon group and gets clipped on a
   narrow window)
3. Confirm you can reach `Furniture` tab → `Присадка` panel → toggle
   `Layer Scheme` between `Native` and `ABF` without scrolling
4. Have `docs/demo/viyarpro-abf-demo/exports/` open in Finder, ready to drag files into view
5. Know the path to `abf-flatten-sample.dxf` for the Act 2 import demo
6. Do **not** pre-open `demo-kitchen.ziasm` before Act 1 — the live build must start from an empty document

---

## Act 1 — Design live (~10 min)

**Goal:** build one fully-outfitted base cabinet from nothing, live, so the
customer sees Zilventor as a modeler, not just an export pipe.

> Reference screenshots below (`01`–`03`, `05`–`07`, `10`) were captured
> against the **finished** `demo-kitchen.ziasm` (both cabinets already
> present) for illustration only. During the live build only ONE cabinet
> exists — ignore the second cabinet visible in some of these frames until
> you explicitly open the kitchen file at the end of the act.

| Step | Click script | Talking point | Ref |
|---|---|---|---|
| 1 | Open the app on an empty document | "This is a blank Zilventor session — no pre-built content." | `screenshots/01-empty-app.png` |
| 2 | `Furniture` tab → `Cabinets` group → `Base Cabinet` | Opens the **Base Cabinet** dialog | `screenshots/02-cabinet-dialog.png` |
| 3 | Fill the dialog: `Name` = `Тумба нижня 600 (фасад)`, `Type` = `Base (floor)`, `Width` 600 / `Depth` 520 / `Height` 720 mm, `Toekick height` 100 / `Toekick setback` 50 mm, `Shelf count` 1, `Carcass material` = `ДСП 18мм Дуб сонома`, `Back material` = `ДВП 6мм білий`, `Edge band material` = `None`, click `OK` | "One dialog, real dimensions, real material picks — no separate modeling step per panel." | `screenshots/02-cabinet-dialog.png` |
| 4 | The carcass appears in 3D | "That's a full 6-panel + shelf carcass, correctly joined." | `screenshots/03-cabinet-3d.png` |
| 5 | `Присадка` panel → `Generate Carcass Boring` | Auto-generates confirmat/dowel bores at every panel joint — this is the same class of hardware boring ABF's Solid-Group + machining-primitive model produces, done automatically instead of by hand | `screenshots/05-carcass-boring.png` |
| 6 | `Присадка` panel → `Add Door` | Opens the **Add Door** dialog | `screenshots/06-door-dialog.png` |
| 7 | Fill: `Count` = `Single`, `Hinge side` = `Left`, `Overlay` = `Full`, `Style` = `Slab`, `Frame width` 70 mm, `Thickness` 18 mm, `Reveal` 2 mm, `Clearance` 2 mm, `Center reveal` 3 mm — note the dialog auto-computes `Hinges (auto)` = 2, click `OK` | "The door and its two Ø35 hinge cups are generated together — no manual hinge boring." | `screenshots/07-door-added.png` |
| 8 | `Присадка` panel → `Система-32` (System-32 shelf-pin rows) | Adds the System-32 shelf-pin bore rows down both sides | `screenshots/10-system32.png` |

**Reveal the full kitchen:** `File` → `Open…` → `project/demo-kitchen.ziasm`.
This opens the two-cabinet assembly — the door cabinet you just built (already
present in the file, same dimensions) sitting next to `Тумба нижня 600
(шухляди) 10`, a second 600×520×720 base cabinet with a 3-drawer bank and bar
pulls. Point out `screenshots/04-two-cabinets.png`, `08-drawers.png` and
`09-handles.png` here — the second cabinet's drawer bank, drawer-box carcasses,
and handles were built the same way (drawer-count dialog, then `Add Handles`)
but off-camera, to keep Act 1 inside its 10-minute budget.

> **Live-build safety rule (see §7 item 1):** never add a door/drawers/handles
> while two-or-more cabinets are loaded — a known viewport-pick bug always
> resolves the click to the first cabinet regardless of which mesh you click.
> That's why the second cabinet is pre-built rather than added live here.

---

## Act 2 — ABF plugin parity (~5 min)

**What ABF is** (say this cold, don't read it): ABF is a free SketchUp
extension the customer's world already runs on — it turns a SketchUp solid
model into CNC machining data (hardware bores, groove/dado joinery), nests
panels, and exports shop-floor DXF/labels/BOM. It's the tool standing between
"I modeled a cabinet" and "Viyar cut it." Zilventor's own manufacturing
pipeline was built by treating ABF's demonstrated behavior as a requirements
list (`docs/abf-plugin/05-parity/03-processing-parity-requirements.md`,
requirements R1–R7) — not to copy ABF, but to make sure nothing the customer
relies on today is missing here.

**Parity status** (as tracked in that requirements doc, re-synced 2026-07-03):

| Req | What it covers | Status |
|---|---|---|
| R1 | Normalize any part representation into one unambiguous panel record | `done` |
| R2 | Configurable hardware/machining presets with tool metadata, per named CNC layer | `done` |
| R3 | Nesting: kerf/oversize, grain-direction propagation, grain-lock exclusion flag | `done` (R3.1–R3.4) |
| R4 | CNC/DXF export: per-material-folder + combined-file modes, true arc/circle fidelity | `done, regression-locked` |
| R5 | Labels/reports: preset-driven templates with QR, five-category Statistics/BOM | `done` |
| R6 | Drawing generation must never mutate the live parametric model | `done`, verified by a byte-hash non-mutation test |
| R7 | Traceability — this table stays synced to the capability inventory | `done` as a process |

Say: "Every gap ABF's own behavior surfaced against us has a shipped fix and a
regression test — this isn't a slide, it's tracked against real commits."

**The ABF-compatible layer scheme.** `Furniture` tab → `Присадка` panel →
`Layer Scheme: Native / ABF` toggle (right end of the ribbon strip, past
`Export DXF (Manufacturing)` — see §7 for the narrow-window gotcha).
Switching it to `ABF` changes the DXF layer names Zilventor writes to match
ABF's own naming grammar, reverse-engineered from a real ABF export
(`docs/abf-plugin/05-parity/04-abf-flatten-dxf-sample-analysis.md`):
outline → `ABF_cuttingLines`, face bores with a known hardware SKU →
`DEPTH<depth>-ARTICLE<sku>`, edge/side bores → `ABF-DSIDE-<diameter>`. Point
at `screenshots/11-abf-toggles.png` (Присадка ribbon group) while explaining
this — say plainly that the toggle itself sits just off the edge of that
frame and show it live rather than on the screenshot.

**Import round-trip — "your existing ABF projects open here."**
`File` tab → `Import ABF flatten DXF…` opens a mapping dialog
(`screenshots/15-abf-import-dialog.png`): every `<MATERIAL>_THICKNESS_<mm>`
group ABF's export encodes (SketchUp's own internal naming) gets mapped to a
Zilventor material one-for-one. Import the bundled fixture — a real ABF
"flatten" export of a shelving unit called «Стелаж 123» — and the panels
come in as real Zilventor parts with their actual bore geometry (hinge cups
included), not flattened outlines: `screenshots/16-abf-imported.png` shows two
imported panels, named exactly as ABF/SketchUp named them — `__4. Дверка`
(door) and `__11. Бік Пр` (right side) — Cyrillic intact. Say: "If this
customer has years of ABF-modeled cabinets, they don't start over."

---

## Act 3 — Production package for ViyarPro (~10 min)

Walk the `exports/` folder file by file. ViyarPro's constructor imports
**CSV / TXT / MPR / DXF / XML / S3D / JPG**; the table below maps what
Zilventor emits onto that list, and flags the two files that are Zilventor's
own shop-floor deliverables rather than a ViyarPro input format.

| File | Contents | Satisfies | Show on screen |
|---|---|---|---|
| `untitled-assembly-boring.csv` | 280 boring rows (`Panel,Length,Width,Thickness,Tag,Face,X,Y,Ø,Depth,Type`) across both cabinets | ViyarPro **CSV** import | Open in a text editor, scroll — point at real Cyrillic panel names (`Тумба нижня 600 (фасад) 10 - Bottom`) |
| `untitled-assembly-boring.dxf` | Per-hole-type boring layers (`D5_T13`, `D5_T32`, `D35_T12`, `D5_THROUGH`, `OUTLINE`) | ViyarPro **DXF** import | `Furniture` → `Присадка` → `Export DXF (Boring)` |
| `untitled-assembly-manufacturing.zip` | Per-material-folder ZIP: `ДСП_18мм_Дуб_сонома/` + `ДВП_6мм_білий/` folders with 14 panel DXFs (ABF layer scheme, same layers as the combined file below) + `machining.csv` CAM sidecar | ViyarPro **DXF** import, folder-per-material | Unzip in Finder, show the two Cyrillic material folders |
| `untitled-assembly-manufacturing-combined.dxf` | Same 14 panels laid out on one grid — captured with `Layer Scheme = ABF`: real layers seen in this exact file include `ABF_cuttingLines`, `ABF-DSIDE-5`, `DEPTH13` (bare, no catalog SKU), `DEPTH12-ARTICLEhinge-35mm-cup-full`, `DEPTH12-ARTICLEdrawer-slide-500-fullext`, and `BORES-FRONT-5MM` (native fallback — see §6 on THROUGH bores) | ViyarPro **DXF** import, single-file mode | Toggle `Layer Scheme` live and re-export to show both naming conventions come out of the same model |
| `untitled-assembly-nest-combined.dxf` | 3-sheet nest layout, layers `OUTLINE`/`GRAIN`/`INFO`/`REMNANT`/`SHEET` | ViyarPro **DXF** import, cutting diagram | `Nesting` panel → `Export DXF (Nest)` |
| `untitled-assembly-statistics.csv` | Five-category BOM: Hardware, Connectors, Edge Band, Linear Material, Panels (editable unit pricing, subtotals, grand total) | ViyarPro **CSV** import / costing | `Statistics` panel → `Export CSV` |
| `untitled-assembly-statistics.xlsx` | Same five-category report as an Excel workbook | Internal costing deliverable (not a ViyarPro input format) | `Statistics` panel → `Export XLSX` |
| `untitled-assembly-nest.pdf` | 3-page printable cutting diagram, one page per sheet | Shop-floor reference (not a ViyarPro input format) | `Nesting` panel → `Export PDF` |
| `untitled-assembly-labels.pdf` | Per-panel shop labels with QR code, mini panel diagram, grain arrow, banded-edge marks; Cyrillic renders correctly (a Cyrillic font is embedded) | Shop-floor reference | `Присадка`/labels export |
| `untitled-assembly-packing-slip.pdf` | 1-page packing slip tied to the Production tab's QR reconciliation (`screenshots/14-production.png` — "0/32 produced" tracker, scan panel labels to mark them produced) | Shop-floor tracking | `Production` tab → `Export Packing Slip (PDF)` |

Also show `screenshots/12-nest-view.png` (per-sheet utilization: 76.4% /
20.4% / 14.9%, `Export PNG` per sheet) and `screenshots/13-statistics.png`
(Hardware/Connectors line items — 3 bar pulls, 3 drawer slide pairs, 6
confirmats, 6 drawer-slide bores, 6 handle screws, 2 hinge cups, 152 shelf-pin
bores) to ground the file contents in what's on screen.

---

## Anticipated customer questions

1. **"Does this DXF open in AutoCAD?"** Yes — it's AC1015 (AutoCAD 2000)
   plain-ASCII DXF, and every layer an entity references is declared in the
   file's own `LAYER` table (verified: 18 declared layers, zero undeclared
   layers referenced by any entity in the combined manufacturing DXF).
2. **"What about my existing ABF/SketchUp projects?"** `File` → `Import ABF
   flatten DXF…` reads them directly, mapping ABF's material-group naming to
   Zilventor materials — see Act 2.
3. **"Edge banding?"** Tracked as its own BOM category (`Edge Band` in the
   Statistics report) with gross-size allowances; this demo's cabinets have no
   banding configured so that section shows empty — ask if they want a banded
   example run live.
4. **"Offcuts / remnants?"** The nest DXF carries a dedicated `REMNANT` layer
   for reusable offcuts.
5. **"Ukrainian text in production docs?"** All PDF exports embed a Cyrillic
   font, so `Тумба нижня 600 (фасад)` renders correctly on labels and packing
   slips. DXF text is transliterated to ASCII by design (Cyrillic → Latin,
   e.g. `hinge-35mm-cup-full`) because R12/R2000 DXF layer names are
   ASCII-only — this is a deliberate, documented choice, not a bug.
6. **"What if a bore is a through-hole — does ABF's convention cover that?"**
   No — ABF has no documented THRU-bore layer convention, so Zilventor
   deliberately falls back to its own native layer (`BORES-FRONT-<dia>MM`)
   for those specific bores even when `Layer Scheme = ABF` is selected. This
   is visible in the combined manufacturing DXF: the handle-screw through
   bores sit on `BORES-FRONT-5MM` while every other bore uses an ABF-style
   layer name.
7. **"How do I actually get this into ViyarPro / to Viyar production?"**
   Upload the manufacturing DXF (or the per-material ZIP) and the boring CSV
   into ViyarPro's constructor the same way you would an ABF export today;
   the Statistics CSV feeds costing, and the packing slip/QR flow lets the
   shop floor reconcile produced panels against the order.
8. **"Can I configure hardware SKUs and tool numbers for CNC?"** Yes —
   `Machining Presets` (Присадка panel) stores per-operation tool
   number/speed and a routable layer name; the folders-mode manufacturing ZIP
   ships a `machining.csv` sidecar with that data per part.

---

## Known limitations & safety notes

State these plainly if asked — don't let the customer discover them live.

1. **Multi-cabinet 3D-pick bug (open).** In an assembly with two or more
   cabinets, clicking any cabinet mesh to `Add Door` / `Add Drawers` / `Add
   Handles` always resolves to the *first* cabinet in the tree, not the one
   clicked. **Mitigation used in this demo:** build and fully outfit one
   cabinet live from scratch (Act 1), then open the pre-built
   `demo-kitchen.ziasm` for the multi-cabinet walkthrough. Never add
   doors/drawers/handles live once two-or-more cabinets are loaded.
2. **Drawer-box material placeholder (open).** `buildDrawerBox.ts` hardcodes
   a placeholder material id for the drawer-box side/front/bottom panels,
   which otherwise show up as "(missing material)" in Statistics and a
   `_missing_material_` folder in the manufacturing ZIP. The pre-built demo
   file has this patched by hand; if drawers are added live in a follow-up
   session, acknowledge this as a known issue in the current build rather
   than treating it as a fresh bug.
3. **Nest requires sheet stock per material.** `Manage Materials` must set a
   sheet length/width for every material used, or those panels are excluded
   from the nest with a "no sheet stock defined" message.
4. **Frame the viewport after generating geometry.** Use the `Home` ribbon
   button (iso view + fit) — there is no keyboard shortcut for it in this
   build.
5. **Materials render as flat gray, untextured, in this build.** Say
   "rendering materials/textures are supported; this demo build uses flat
   shading" rather than let the customer wonder why the oak doesn't look like
   oak.
6. **The `Layer Scheme` / `DXF Export Mode` toggles are easy to miss.** They
   sit in the same ribbon row as `Export DXF (Manufacturing)`, past the
   visible edge on a standard laptop window — scroll the ribbon right or
   maximize the browser before Act 2, or you'll be hunting for them on camera.

---

## Appendix — file inventory

**`exports/`** (10 files)

| File | Size |
|---|---|
| `untitled-assembly-boring.csv` | 33,070 B |
| `untitled-assembly-boring.dxf` | 54,596 B |
| `untitled-assembly-labels.pdf` | 1,554,080 B |
| `untitled-assembly-manufacturing-combined.dxf` | 66,872 B |
| `untitled-assembly-manufacturing.zip` | 25,232 B |
| `untitled-assembly-nest-combined.dxf` | 30,674 B |
| `untitled-assembly-nest.pdf` | 32,908 B |
| `untitled-assembly-packing-slip.pdf` | 36,600 B |
| `untitled-assembly-statistics.csv` | 611 B |
| `untitled-assembly-statistics.xlsx` | 10,659 B |

**`project/`** — `demo-kitchen.ziasm` (7,587 B)

**`screenshots/`** — 16 PNGs, `01-empty-app.png` through `16-abf-imported.png`
(59 KB – 111 KB each)

**Verification evidence** (machine-checked while preparing this doc, not
narrative claims):

- `demo-kitchen.ziasm` is a gzip'd tar containing `manifest.json` (7,180 B)
  and `thumbnail.png` (6,154 B); `manifest.json` parses as valid JSON with
  `"formatVersion": 41`, matching the current schema baseline.
- The assembly has exactly 2 components, 2 materials (`ДСП 18мм Дуб сонома`,
  `ДВП 6мм білий`, both with `sheetLengthMm: 2800` / `sheetWidthMm: 2070`
  defined), and a nest with exactly 3 sheets (2 sheets of the ДСП material,
  1 of the ДВП) — confirming the "2 materials, 3 sheets" claim used
  throughout this doc.
- `untitled-assembly-manufacturing.zip` passes `unzip -t` with zero CRC
  errors across all 15 entries (14 panel DXFs + `machining.csv`); its
  material folder names are exactly `ДСП_18мм_Дуб_сонома/` and
  `ДВП_6мм_білий/`.
- Both combined DXF exports (`manufacturing-combined.dxf`,
  `nest-combined.dxf`) and `boring.dxf` identify as `AutoCAD Drawing Exchange
  Format, version 2000` (AC1015) by file magic; all three are plain ASCII
  text.
- In `untitled-assembly-manufacturing-combined.dxf`: parsed the `TABLES` /
  `LAYER` section directly (group-code level) — 18 custom layers declared;
  cross-referenced against every group-code-8 (layer) reference on every
  entity in the file — every referenced layer is declared (the only
  "undeclared" reference is layer `0`, AutoCAD's always-implicit default
  layer). This is the same defect class fixed by the
  `fix/panel-mfg-dxf-layers` and boring-DXF merges referenced in this
  project's `CLAUDE.md` baseline, re-confirmed here against this specific
  export.
- Both the per-panel DXFs inside the manufacturing ZIP and the combined
  manufacturing DXF carry the **ABF layer scheme** (verified by extracting
  every group-code-8 layer reference from both: identical layer sets —
  `ABF_cuttingLines` ×14, `DEPTH12-ARTICLEhinge-35mm-cup-full`,
  `DEPTH12-ARTICLEdrawer-slide-500-fullext`, `ABF-DSIDE-5`, `DEPTH13`, plus
  the `BORES-FRONT-5MM` THROUGH-bore fallback). Note: the `machining.csv`
  sidecar's `layer` column always reports the native/preset layer names
  (e.g. `BORES-FRONT-5MM`) regardless of the `Layer Scheme` toggle — a known
  cosmetic inconsistency in the current build; the DXF geometry layers are
  authoritative.
- R1–R7 statuses quoted in Act 2 are taken verbatim (status tags only) from
  `docs/abf-plugin/05-parity/03-processing-parity-requirements.md`, last
  re-synced 2026-07-03 per that document's own R7 entry.

No unconfirmed facts were left in this document — every concrete number,
layer name, file size, and status tag above was read directly from the files
in this folder or the cited source docs during preparation.
