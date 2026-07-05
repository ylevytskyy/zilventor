# Manual Test Scenarios — real-world files from `~/Downloads`

Goal: verify the application is usable end-to-end with real customer/CAD files, not just
synthetic test fixtures. Start the app with `pnpm dev` from the repo root and open
<http://localhost:5173>.

Suggested order: **1 → 2 → 3 → 4** (core value chain: ABF in → manufacturing out,
STEP in → panel), then **5–6** (edge paths), then **7** (general sweep).

## Test files

| File | Format | Usable? | Exercises |
|---|---|---|---|
| `Стелаж flatten.dxf` (902 KB) | ASCII DXF AC1021, ANSI_1251, 178 blocks/ATTRIBs, 191 circles | ✅ | ABF flatten import, layer-scheme round-trip |
| `773 Шафа в коридор 2п СБ.stp` (753 KB) | STEP AP214, Inventor 2012 origin, 48 solids, multi-level assembly | ✅ | STEP import, convert-to-panel |
| `office-chair-black-1.snapshot.2.zip` (2.65 MB) | zip: `.ipt` + 716 KB `.stp` | ✅ | zip-STEP extraction |
| `mq-1-predator-uav.zip` (49.4 MB) | zip: 14.9 MB `.STEP` + `.stl`/`.rar`/`.rvt` | ✅ | zip extraction picks STEP, skips junk |
| `human-hand-1.snapshot.5.zip` (20.8 MB) | zip: `HAND.SLDPRT` + 9 MB `HAND.stp` | ✅ (extract first) | heavy STEP import; SolidWorks guidance |
| `supercar-system-powertrain-…zip` (242 MB) | zip: 171 MB `.step` | ⚠️ negative | 50 MB STEP size-cap error dialog |
| `Стелаж.dwg` (1.9 MB) | binary DWG AC1032 | ❌ | unsupported-format rejection |
| `Стелаж 123 .project` (7 KB) | Base64-wrapped encrypted blob (likely БАЗИС) | ❌ | unsupported-format rejection |

Supported import formats (from `FileTab.tsx`): `.zipt` / `.ziasm` / `.zidw` / `.step` /
`.stp` / `.zip` (first STEP inside) / `.dxf`; `.sldprt` / `.sldasm` accepted by the picker
only to show the "convert to STEP" guidance. DWG and `.project` are not supported.

## Scenario 1 — ABF flatten DXF import (flagship)

File: `Стелаж flatten.dxf`

1. File → Import ABF flatten DXF → pick the file. The import dialog appears with inferred
   panels.
2. Verify: panel **names come through in Cyrillic** (carried in SketchUp
   `Skp_GroupInstanceName` ATTRIBs); panel count is plausible for a shelving unit; bores
   show **depth + SKU inferred from layer names** (`DEPTH12-ARTICLE38877`,
   `DEPTH13.8-ARTICLE61281`, …) plus horizontal bores from `ABF-DSIDE-4.5` /
   `ABF-DSIDE-8` layers.
3. **Edge case:** the file contains a malformed layer `D7-DEPTHF-$44817`. The import must
   not crash — it should either skip it or surface it visibly. Best robustness test in the
   folder.
4. Confirm the import; check the browser tree: panels selectable, bores visible in 3D,
   properties panels open.
5. **Undo** the whole import → document returns to prior state; **redo** brings it back.

## Scenario 2 — Round-trip: export what you imported

Continue from Scenario 1 — closes the loop on ABF parity.

1. Export manufacturing DXF with the **ABF layer scheme toggle ON**. Open the result (a
   text editor is fine) and check layers follow the same grammar as the source
   (`ABF_cuttingLines`, `DEPTH<d>-ARTICLE<sku>`, `ABF-DSIDE-<dia>`). Cyrillic SKUs come out
   transliterated (sanitizer).
2. Export the combined-mode DXF and the per-material ZIP; both download without errors.
3. Run nesting on the imported panels → sheets render, grain arrows present; export nest
   DXF / PDF / PNG.
4. Generate the labels PDF and the statistics/cost report — Cyrillic panel names must
   render (not boxes) in all PDFs.

## Scenario 3 — Real-world STEP assembly import

File: `773 Шафа в коридор 2п СБ.stp`

1. Open it in part mode. Expect: loading overlay, then all 48 bodies rendered with
   per-body colors, viewport auto-fits the model.
2. Browser tree shows the exploded structure; leaf parts expand.
3. Second path: create/open an assembly, then import the same STEP **as a component**
   into it.

## Scenario 4 — STEP → parametric panel conversion

Continue from Scenario 3 — the convert-to-panel flow.

1. Right-click a flat leaf part (a shelf/side panel of the шафа) → **convert**. The
   PanelDialog opens pre-filled with bbox-derived dimensions.
2. Confirm → the imported body is replaced in place by a parametric panel. Add a bore or
   groove to it to prove it entered the manufacturing pipeline.
3. **Undo** → the original imported STEP part comes back exactly (byte-exact restore; if
   the part reappears visually identical, pass).
4. Save as `.ziasm`, reload the app, reopen — everything persists.

## Scenario 5 — ZIP import paths

- `office-chair-black-1.snapshot.2.zip`: open the **zip directly** — the app finds and
  imports the STEP inside, ignoring the Inventor file and JPGs.
- `mq-1-predator-uav.zip`: same — the extractor must pick the `.STEP` and skip the
  `.stl` / `.rar` / `.rvt`. Bigger model, mild performance check.
- `human-hand-1.snapshot.5.zip`: extract manually first, then open `HAND.stp` (9 MB)
  directly — heavier single-part import; succeeds with loading overlay, no tab freeze.

## Scenario 6 — Guardrails (negative tests: expect graceful refusal)

- **SolidWorks guidance:** from the extracted human-hand zip, open `HAND.SLDPRT` → the
  "convert to STEP" guidance dialog appears; no import attempt, no crash.
- **Size cap:** open `supercar-system-powertrain-assembly-stage-2-1.snapshot.2.zip` — the
  STEP inside is 171 MB, over the 50 MB cap → clean "file too large" error dialog; app
  stays responsive afterward.
- **Unsupported formats:** drag-and-drop `Стелаж.dwg` and `Стелаж 123 .project` onto the
  app → rejection or no-op, never a hang or console explosion.

## Scenario 7 — General usability sweep

Inside any of the above documents:

- Undo/redo several steps deep.
- Reload the page mid-work → OPFS autosave recovery restores the session.
- Switch language en ↔ uk → dialogs/ribbon translate.
- Open the Production tab (QR reconciliation). With a phone handy, do the **camera QR
  smoke test** — the one shipped feature never verified on a real device.

## Pass criterion

If Scenarios 1–4 pass end-to-end on these real files, the app is usable for the actual
furniture workflow — ABF DXF in → manufacturing output out, and STEP in → parametric
panel — not just green on synthetic tests.
