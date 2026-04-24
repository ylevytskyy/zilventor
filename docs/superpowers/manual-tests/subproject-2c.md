# Sub-project 2c — Manual test checklist

## Setup
- [ ] `pnpm dev` starts Vite. Open `http://localhost:5173`. Ready / mm.

## Golden path — one-dim-per-kind walkthrough
- [ ] New Part → Sketch → 2D Sketch.
- [ ] Draw a horizontal line (L). Auto-H constraint appears (2b).
- [ ] Press **D**, click the line body. Dialog appears pre-filled with `d0` / current length. Type `50` OK. Dimension glyph shows `50.00`. DOF drops.
- [ ] Draw a second line. Press **D**, click first line's endpoint, then second line's endpoint → dim-distance dialog. Type `30` OK. Two glyphs now.
- [ ] Press **D**, click two lines → dim-angle dialog. Type `45` OK. Angle label `45.00°` appears.
- [ ] Draw a circle. Press **D**, click rim → dim-radius dialog. Type `20` OK. Label `R 20.00` appears. Click rim again → dim-diameter label `⌀ 40.00` replaces it.
- [ ] Press **D**, click a line + a point → dim-point-line-distance.

## Parameters panel
- [ ] Press **F7**. Panel opens listing all parameters.
- [ ] Double-click a value, change it, press Enter. Dimension in viewport updates live.
- [ ] Change a parameter to an expression like `d0 * 2`. Value recomputes.
- [ ] Try a cycle: edit `d1 = d0` then `d0 = d1`. Rejection toast shows "cycle".
- [ ] Close (Escape / Close button). Changes persist.

## Over-define
- [ ] With an existing length=50 dim on L1, press D, click L1, type `100`, OK.
- [ ] Toast appears: "over-defines". Click "Show conflict". Existing dim highlights red for 3 s.

## Save / reopen
- [ ] Save as `.zipt`. Reopen in a fresh tab. All parameters + dimensions restored with the right values.

## Drag
- [ ] Press Esc (Select). Drag a line endpoint.
- [ ] If the sketch is fully constrained, dragging produces no motion (solver snaps back).
- [ ] If partially constrained, drag stays within remaining DOF.

## Keyboard shortcuts
- [ ] D enters Dimension tool.
- [ ] F7 toggles Parameters panel.
- [ ] Escape returns to Select.

## Edge cases
- [ ] Adding a dim that conflicts with an auto-inferred H/V highlights the H/V badge as the offender.
- [ ] Delete key on a selected dimension removes it + its parameter (if the parameter is only used by that dim).
