# Sub-project 2b — Manual test checklist

Run once before merging 2b to master. Each item is a golden-path step. Use a fresh tab each time to avoid cached state.

## Setup
- [ ] `pnpm dev` starts the Vite server.
- [ ] Open `http://localhost:5173` in a new Chrome tab.
- [ ] Status bar shows **Ready**, unit shows **mm**.

## Golden path — draw and auto-constrain
- [ ] Click **New Part**, expect **Part1** in the Browser pane.
- [ ] Click the **Sketch** ribbon tab.
- [ ] Click **2D Sketch**. The **Select** tool is armed by default. Status bar shows `4 DOF` or similar once you draw.
- [ ] Press **L**; draw a roughly horizontal line. The H auto-constraint badge ("—") appears near its midpoint. DOF decreases.
- [ ] Press **R**; drop a rectangle by two corner clicks. 4 edge primitives + rectangle-implicit constraints; badges visible at each edge.

## Manual constraints
- [ ] Press **H** (or click the Horizontal button). Click a slanted line. The line snaps horizontal; badge appears.
- [ ] Press **P** (parallel). Click two lines. Both lines align.
- [ ] Press **N** (coincident). Click near two endpoints. They snap together.
- [ ] Press **=** or the Equal button. Click two lines. Their lengths equalise.

## Redundancy / conflict
- [ ] With an H already present, press H and click the same line. Toast appears: "Redundant — already implied." No new badge.
- [ ] With a V already present, press H and click the same line. Toast appears: "Conflict — these constraints conflict." No new badge.

## Drag-to-solve
- [ ] Press **Esc** to return to **Select** arrow.
- [ ] Grab an endpoint of a constrained rectangle and drag. Rectangle stretches while preserving H/V edges and corner coincidence. Frame rate feels smooth (no visible stutter).
- [ ] Status bar stays under `5 DOF` throughout. No flip to red "Over constrained".

## Over-constraint mid-drag
- [ ] Manually over-constrain the sketch (add two H's on coincident-linked lines). Try to drag an endpoint. Status bar turns red showing "Over constrained: N". Drag doesn't crash; coordinates stay feasible.

## Legacy v2 open
- [ ] Save the current sketch; reopen. All constraints round-trip.
- [ ] Open a legacy v2 `.zipt` fixture. Sketch opens. Badges appear on the 4 rectangle edges (inferred H / V). No toast about migration errors.

## Extrude and round-trip
- [ ] Finish Sketch; click **Model** tab; click **Extrude**; distance 18; OK. Triangle count > 0, box renders in viewport.
- [ ] Save as `.zipt`. Reopen. Extrusion + sketch + constraints all reload; DOF matches pre-save value.

## Unload
- [ ] Leave sketch mode (Finish Sketch). Footer DOF segment disappears.
- [ ] Re-enter sketch mode. DOF segment reappears with the previously-stored count.

## Notes on partial coverage

The following items from the plan are reduced scope in the shipped Sub-project 2b:
- Over-constraint detection fires only on duplicate parametric constraints (e.g., two horizontals on the same line), not on geometric over-constraint like H+V on the same line. planegcs 1.1.7 classifies the latter as degenerate rather than conflicting.
- Drag-to-solve on a rectangle's corner works via the rectangle's corner PointRef anchors; the rectangle primitive itself is not decomposed into four separate lines in the store.
- Equal-constraint applied between two edges of a single rectangle is a no-op (both sides resolve to the same rectangle primitive id). Apply Equal between two distinct line/arc/circle primitives instead.
