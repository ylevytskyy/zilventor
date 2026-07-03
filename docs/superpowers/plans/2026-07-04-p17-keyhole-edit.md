# P17 — Keyhole-slot post-placement editing + export wiring

**Status:** planned 2026-07-04 · branch `feat/p17-keyhole-edit`
**Source:** P16 shipped kind:'keyholeSlot' with creation/kernel/DXF/CSV but no selection, no
tree label (renders as mislabeled "Extrusion" fallback with the wrong click handler), no
properties panel, no edit command — and the scout found the DXF/CSV `keyholeSlots` input is
populated by NO call site (P16 export support is dead code in production paths).

## Goal (verifiable)

Selecting "Keyhole Slot N" in the browser tree shows an editable properties panel; each commit
dispatches one undoable EditKeyholeSlotCommand (bus-routed); kernel regenerates; e2e proves
geometry change + two-deep undo; manufacturing DXF/CSV actually receive keyholeSlots from the
real export call sites.

## Decisions / scope calls

- **S1 — preset-apply EXCLUDED:** toolNumber/speed/presetLayerName rows read-only, NO preset
  picker; ApplyMachiningPresetCommand untouched (tenon/mortise + P16 S3 precedent). (conf 60 —
  ratify.)
- **S2 — e2e probe:** dimension-only edit patch avoids entryDiameter/faceRole/axis/direction
  (cylinder tessellation vs diameter is unverified); patch {u,v,slotWidth,slotLength,depth},
  assert triangleCount invariant + positionsSum changed (groove-edit idiom).
- **S3 — export wiring added to scope (W5):** populate keyholeSlots at the real
  PanelManufacturingInput call sites (P16 completeness gap).
- Reuse dialog.keyholeSlot.* i18n for panel labels; only 2 new keys (browser.keyholeSlot,
  common.keyholeSlot_properties), owned by W1.

## Slices

1. **W1** store selection slice (mutually exclusive with bore/groove/component) + BrowserPane
   labeled row + 2 i18n keys en/uk.
2. **W2** EditKeyholeSlotCommand (9 patchable fields, EditGrooveCommand port) +
   KeyholeSlotPropertiesPanel (draft/commitField idiom, no preset block).
3. **W3** App.tsx wiring: partKeyholeSlotsCacheRef (populate/clear at the 3 groove lifecycle
   points ×2 delete sites) + mount panel; manual EXEC click-through screenshot.
4. **W4** e2e keyhole-slot-edit.spec.ts (bus-driven, add→edit→undo→undo, mesh fingerprints).
5. **W5** export wiring: find every call site building PanelManufacturingInput and pass
   keyholeSlots from the featureTree (+ regression test at one call-site level).

Order: W1 → W2 → (W3 ∥ W4) → W5 (W5 may touch App.tsx — after W3 to avoid file races).

## Risks

- W3 App.tsx wiring has no automated coverage (pre-existing gap for groove too) — screenshot
  verification only.
- W2 prop names pinned in briefs; W3 must read the real file before wiring.
