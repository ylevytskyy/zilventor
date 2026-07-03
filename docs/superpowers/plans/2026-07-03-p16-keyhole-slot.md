# P16 — Keyhole-slot routing (wall-hanger milling)

**Status:** planned 2026-07-03 · branch `feat/p16-keyhole-slot`
**Source:** ABF parity audit item #9 — docs/abf-plugin/03-machining/02-hardware-boring-and-joinery.md
names "Keyhole slot creation" as a first-class ABF operation; zero code-side hits for "keyhole".
ABF documents the op but NO parameters — the param shape below is OUR design (scope call S1).

## Goal (verifiable)

A user picks a panel, opens a Keyhole Slot dialog from the Furniture ribbon (next to Groove),
submits params, and a `kind:'keyholeSlot'` feature lands in the panel's featureTree; the kernel
cuts a real cylinder∪box pocket (OCCT volume-drop in a sane range); undo restores bytes and
geometry; DXF gets a KEYHOLE-SLOTS layer (circle + slot outline), machining.csv gets an
opType:'keyholeSlot' row (diameter column = entryDiameter); 'keyholeSlot' is a valid preset
opType (registry only — preset APPLICATION not wired, same as tenon/mortise precedent).

## Feature shape (S1 — our design, mirrors bore point-placement + groove CAM fields)

`KeyholeSlotSpec { faceRole, u, v (entry-hole CENTER, face2DFrame coords), axis:'u'|'v',
direction:1|-1, entryDiameter, slotWidth, slotLength (from hole CENTER outward), depth,
label?, toolNumber?, speed?, presetLayerName? }`; `KeyholeSlotFeature = Spec + kind + id`.
Defaults in dialog: entryDiameter 15, slotWidth 8, slotLength 25, depth 6, faceRole 'Back'.
Localized cutout (NOT groove's full-face-extent channel). Slot box anchored at hole center
guarantees boolean overlap. No validation/clamping (S2 — consistent with GrooveDialog; a
slotWidth ≥ entryDiameter cuts fine, just isn't a functional keyhole).

## Key technical decisions

- **D1 kernel:** dedicated `KeyholeSlotFeature.ts` executor (cylinder via existing
  `makeSimpleCutter` with drillTipAngleDeg:null + box via `makeBoxFromCorners`, `fuseShapes`
  then `cutShapes`); FeatureTree gets one `else if` branch after tenonMortise, soft-fail
  convention. Pure math in shared `keyholeSlotMath.ts` (unit-testable without OCCT).
- **D2 manifest:** CURRENT_FORMAT_VERSION 39→40 — verified precedent (P6/P7/P8 each bumped for
  a new feature kind): no-op migration entry + **normalizeKind OR-list gets `=== 40`** (the
  easy-to-miss step) + ~30-file fixture sweep (`toBe(39)`→`toBe(40)`) + new
  migrateManifest-v39-to-v40.spec.ts.
- **D3 outputs:** MANUFACTURING_LAYERS.keyholeSlots='KEYHOLE-SLOTS'; DXF circle+rect (worker's
  call on exact primitives); CSV diameter column = entryDiameter (documented in comment).
- **D4 presets:** opType registry only ('keyholeSlot' in the union + OP_TYPES set);
  ApplyMachiningPresetCommand wiring explicitly OUT of scope (matches tenon/mortise precedent).
- **D5 e2e:** groove-cut.spec.ts template — OPFS + triangle-count probes, bus-driven,
  `__zilventorStore` window hook (never dynamic useAppStore import — HMR stale-binding gotcha).

## Slices

1. **W1** shared types/math + kernel executor + FeatureTree branch + manifest bump/sweep.
2. **W2** AddKeyholeSlotCommand + KeyholeSlotDialog + store slice + FurnitureTab ribbon +
   i18n en/uk (W2 owns BOTH locale files).
3. **W3** DXF layer/outline + machining.csv row + preset opType registry (parallel with W2).
4. **W4** e2e keyhole-slot-cut.spec.ts (after W1+W2; 2 consecutive clean runs required).

## Scope calls (autonomous, for user ratification)

- **S1:** invented param shape (ABF gives none) — center-anchored slot, defaults 15/8/25/6.
- **S2:** no validation on degenerate params (groove precedent).
- **S3:** preset application not wired (registry only).
- **S4:** manifest bump 39→40 (forced by precedent, not optional).
