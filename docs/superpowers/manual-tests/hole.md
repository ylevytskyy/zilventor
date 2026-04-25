# Hole feature manual checklist

- [ ] **From-sketch simple through:** sketch a 20×20 rect, extrude 10mm; sketch 2 circles on top face; press H; pick that sketch; OK; verify two through-holes appear.
- [ ] **Linear CBORE blind:** press H; switch to Linear; pick top face; pick edge 1, set offset 5; pick edge 2, set offset 5; switch profile to Counterbore; set Ø=4 / CBORE Ø=8 / CBORE depth=2; switch termination to Distance; depth=6; OK; verify a CBORE blind hole at expected position with the 118° drill tip cone visible.
- [ ] **Concentric CSK on cylindrical body:** revolve a profile to make a cylinder; press H; switch to Concentric; pick top face; pick the circular top edge; switch to Countersink; Ø=2, CSK Ø=4, CSK angle=82; throughAll termination; OK; verify CSK hole on axis.
- [ ] **Edit parameter d_hole:** create a hole with `=d_hole` for diameter; in Parameters panel, edit d_hole from 4 → 8; verify the hole regenerates.
- [ ] **Edit-reopen rehydrate:** create a Hole; double-click its node in the browser pane; verify the dialog opens in edit mode with all fields prefilled correctly across each placement / profile / termination kind.
- [ ] **Flip-axis toggle:** create a hole with flipAxis=true; verify the cutter goes the opposite direction.
- [ ] **To-Face termination on a sandwich:** stack two extrudes; press H; switch termination to To Face; pick the bottom face of the lower plate; verify the hole drills exactly to that face.
- [ ] **Live preview:** open Hole dialog; tweak diameter rapidly; verify the translucent cutter mesh updates within ~200ms (no flicker, no per-keystroke spam).
- [ ] **Soft-fail:** open Hole dialog with no sketch picked; OK; verify no crash, no malformed body.
