---
title: Editing the Nest
---
# Editing the Nest
> Nudge, rotate, flip, or drag an individual panel on a generated sheet when the packer's layout needs a manual correction — without re-running the optimizer.

**Where:** Nesting sub-tab (Browser pane) ▸ **Edit Mode** · **Shortcut:** — · **Applies to:** a generated nest

## What it does

Edit Mode lets you adjust where a single panel sits on its sheet after
[Generate Nest](./nesting.md) has already packed it. This is a manual
override, not a re-optimization: nothing else on the sheet moves, and the
guillotine packer never runs again for that sheet. Use it for the corrections
an automatic packer can't judge — matching a real saw operator's preferred
cut order, or nudging a panel a few millimeters to align with a fence.

Every edit — rotate, flip, nudge, or drag — is validated against the sheet
boundary and every other panel already on it. An edit that would push a panel
off the sheet or on top of another panel is rejected outright; nothing is
written and the panel stays where it was.

## Before you start

- Generate a nest first — see [Nesting](./nesting.md). Edit Mode operates on
  sheets that already exist.
- Select the sheet and panel you want to adjust in the Nesting sub-tab.

## Steps

1. On the Nesting sub-tab, click **Edit Mode** to turn it on.
2. Click a placed panel on a sheet to select it — a small toolbar appears.
3. Adjust the panel using one of:
   - **Rotate 90°** — swaps the panel's length and width in place.
   - **Flip** — toggles a cosmetic mirror marker (see gotcha below).
   - The **▲ ▼ ◀ ▶** nudge buttons — move the panel 1mm per click, or 10mm
     with Shift held.
   - Drag the panel directly on the sheet; a ghost outline turns green while
     the position is valid and red while it isn't.
4. Release a drag, or click a rotate/flip/nudge button — the edit applies
   immediately if valid.

*Result: the panel updates in place on its sheet; the sheet picks up a
"Manually edited" badge; nothing else on the sheet moves.*

## Options

| Control | Meaning |
|---|---|
| Edit Mode | Toggles whether panels on sheets can be selected and edited. |
| Rotate 90° | Swaps the selected panel's length/width. |
| Flip | Toggles a cosmetic "flipped" marker on the panel — see Tips. |
| ▲ ▼ ◀ ▶ | Moves the selected panel 1mm (10mm with Shift) in the given direction. |
| Drag | Freehand reposition within the sheet; validated live as you drag. |
| Export PNG | Per-sheet export, available in Edit Mode exactly as it is outside it — see [Nesting](./nesting.md). |

## Tips & gotchas

- **Flip is cosmetic only — it does not touch bores, DXF, or CAM data.** It
  toggles a marker used purely to draw a small "⇄" icon on the panel in the
  nest view; it never changes the panel's length, width, position, or any
  feature the panel carries. The panel's own manufacturing geometry (bores,
  grooves, tenons/mortises) comes from the panel's feature tree, which the
  nest editor never touches — [Manufacturing DXF](./manufacturing-dxf.md) and
  [CAM Metadata](./cam-metadata.md) exports are completely unaffected by
  flipping a panel in the nest.
- **Overlap and out-of-bounds moves are rejected, not just flagged.** The red
  ghost outline during a drag is a preview; if you actually release, rotate,
  or nudge into an invalid position, the edit is rejected with an on-screen
  message ("Move rejected: panel would overlap another panel" or "...outside
  the sheet boundary") and nothing changes. You don't end up with an
  overlapping layout by accident.
- **The layout is never re-optimized after an edit.** Editing one panel does
  not reshuffle the rest of the sheet to close gaps or improve utilization —
  the manual placement sticks exactly as you left it.
- **Manual edits set a "Manually edited" badge, not a hard flag.** Once you
  edit any panel on a sheet, that sheet shows a "⚠ Manually edited" badge
  with the note "guillotine cut order may no longer be valid" — a warning
  that your edits may no longer describe a clean edge-to-edge cut sequence a
  panel saw can follow blindly. This is advisory only: it doesn't block
  further edits, exports, or anything else on that sheet.
- **Moving a panel into the sheet's remnant area drops the remnant label**
  from that sheet — the space it occupied is no longer free, so there's
  nothing left to call a remnant.
- Manual edits apply to that one generated nest. If you click **Regenerate**
  after a cut-list/kerf/oversize change (see [Nesting](./nesting.md)'s
  staleness banner), the packer runs fresh and your manual edits on the old
  layout are gone.

## See also

- [Nesting](./nesting.md)

<!-- SCREENSHOT: Nesting sub-tab in Edit Mode with a selected panel showing the Rotate/Flip/nudge toolbar — TODO follow-up -->
<!-- SCREENSHOT: a sheet with the "Manually edited" badge and a panel mid-drag showing the red invalid-position ghost outline — TODO follow-up -->
