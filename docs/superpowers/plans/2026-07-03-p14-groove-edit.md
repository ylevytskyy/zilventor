# P14 — In-place groove editing

**Status:** planned 2026-07-03 · branch `feat/p14-groove-edit`
**Source:** ABF parity gap audit 2026-07-03 #2 — capability inventory line ~48 "no in-place
groove edit/delete"; ABF machining params are editable post-placement. Today the only edit
path is delete-and-recreate; GroovePropertiesPanel (P9) is read-only + preset apply.

## Goal (verifiable)

A selected groove's faceRole/axis/position/width/depth are editable in GroovePropertiesPanel;
each commit dispatches one undoable `EditGrooveCommand` through the bus; kernel regenerates
(OCCT triangle-count delta proves a real re-cut); undo restores exact prior params AND
geometry; OPFS manifest round-trips the edit. No manifest version bump (reuses existing
GrooveSpec fields; v39 stays).

## Decisions

- **D1 — editable field set:** all 5 geometry fields (faceRole, axis, position, width, depth).
  toolNumber/speed/presetLayerName stay preset-owned (P9 control untouched); label out of
  scope. (Scope call S1, conf 78 — a stricter reading is width/depth/position only.)
- **D2 — undo routing:** `bus.execute(new EditGrooveCommand(...))` following the panel's own
  D8 bus-routing precedent, NOT BorePropertiesPanel's direct `.apply()` bypass (pre-existing
  gap there, out of scope to fix).
- **D3 — command pattern:** mirror EditBoreCommand (patch-snapshot apply/revert), persist via
  ApplyMachiningPresetCommand's groove-branch packProject shape, invalidate via the existing
  boreCacheInvalidator (App.tsx already clears groove caches through it). No `edited` flag —
  grooves are regenerable.
- **D4 — e2e:** bus-driven with OPFS + triangle-count probes (groove-cut.spec.ts template);
  headless viewport is black, no DOM 3D verification. Settled-state polls only.
- **D5 — validation:** none added — GrooveDialog has no creation-time validation either;
  out-of-range edits inherit existing behavior (flagged, not fixed; candidate follow-up).

## Slices

1. **W1** `EditGrooveCommand` + spec (pinned opts shape: groove, patch, partPath, doc, opfs).
2. **W2** GroovePropertiesPanel inline edit (numeric draft-commit pattern from
   BorePropertiesPanel; faceRole/axis selects from GrooveDialog; existing i18n keys only).
3. **W3** e2e `tests/e2e/groove-edit.spec.ts`: add → edit → assert tri-count + OPFS → undo
   restores post-add state → second undo restores baseline (two-deep undo stack).

W1 first; W2+W3 in parallel against the pinned interface after W1 lands.

## Risks

- W3's two-deep undo assumption unverified against CommandBus internals (builder weakness #1).
- W2's Enter-commit → bus.execute spy assertion is an extrapolated test pattern (weakness #3).
- Degenerate cutter on out-of-range faceRole/axis edits inherited from creation path (D5).

## Scope calls (autonomous, for user ratification)

- **S1:** D1 five-field scope (includes faceRole/axis beyond the literal "width/depth/position"
  wording of the gap).
- **S2:** No validation/clamping added on edit (D5) — consistent with creation-time behavior.
