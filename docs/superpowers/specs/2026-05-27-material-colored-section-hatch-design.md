# Material-colored section hatch — design spec

**Date:** 2026-05-27
**Status:** Approved (brainstorming) → ready for implementation plan
**Manifest:** v19 unchanged (additive optional field; no migration)

## Problem

Assembly-sourced drawing section views render gray hatch — the kernel's
assembly cut passes `materialResolver: () => ''`, so cut faces carry
`materialId: ''`. Investigation showed the gap is broader than the seed assumed:

1. The kernel `cutBySectionPlane` hardcodes `materialId: ''` on **every** cut
   face — for the part path too (`cutBySectionPlane.ts:226,231,234,304`).
2. Both `AddSectionViewCommand` and `regenerateSectionView` use an identical
   `hatchLookup` keyed on `materialId`; with `materialId=''` both hit the same
   gray fallback. So the **part path does not differentiate by material either**.
3. No material in the app sets `hatchAngleDeg`/`hatchSpacingMm` (grep: zero
   assignments) — every material uses the 45°/3mm default, so threading the id
   alone changes nothing visually.
4. Hatch color is hardcoded (`ViewElement.tsx:87` `stroke="black"`; DXF `#000`;
   export SVG draws **no** hatch at all).

**Decision (user):** make section hatch reflect material **color** — draw each
cut face's hatch lines in its source component's material color.

## Goal

Each section cut-face's hatch lines are drawn in the color of the source
component's primary material (`materials[0].color`, used as-is), with a gray
`#808080` fallback when no material is resolvable. Applies to both part-sourced
and assembly-sourced section views, across all three hatch renderers.

## Non-goals

- Per-instance `colorOverrides` (assembly): two instances of the same part get
  the same material hatch color. This is correct "by material" behavior.
- Custom hatch angle/spacing per material: no material defines them today; hatch
  stays the default 45°/3mm pattern. Only the **color** varies per material.
- Contrast adjustment for light materials: color is used as-is (user choice).
  A light melamine may produce faint lines on white; accepted for v1.

## Data model change

`HatchSegment` (`packages/shared/src/drawing/types.ts:115`) gains an optional
field:

```ts
export type HatchSegment = {
  readonly p0: Vec2;
  readonly p1: Vec2;
  readonly materialId: string;
  readonly color?: string;   // NEW — hex (#rrggbb); absent ⇒ renderer default gray
};
```

- **Additive optional field → manifest stays v19, no migration** (precedent:
  F4/F6 additive fields).
- Color is **baked at projection time** (in `generateHatchSegments` /
  `projectSectionView`) and refreshed on Regenerate. A material recolor needs a
  Regenerate to appear — consistent with how angle/spacing already bake into the
  persisted segments.

## Color resolution — app-side, no kernel change

The kernel already stamps the real per-component `partId` on assembly faces
(`cutLeavesBySectionPlane.ts:392`, `cutLeavesByStepSegments.ts:443`) and leaves
`materialId: ''`. We resolve color **by partId** at projection time. This:

- avoids cross-part `materialId` collisions (two parts may each define a material
  with id `"mat-1"` but different colors);
- needs **no Comlink threading** of a material map into the worker;
- leaves the kernel `materialResolver: () => ''` stub untouched.

### Assembly path

`loadAssemblyForProjection` (`packages/app/src/drawing/loadAssemblyForProjection.ts`)
already loads each leaf part's bytes and registers it in the kernel, yielding a
kernel `partId`. Extend it to also build a `partId → color` map:

- For each unique loaded part, `unpackProject(bytes)` → `migrateManifest` →
  `document.materials[0]?.color` (the exact pattern in `loadDrawingSource.ts:100-107`).
  Wrap in try/catch; malformed manifest ⇒ no entry ⇒ gray fallback.
- Return `componentColors: Record<string /*kernel partId*/, string /*hex*/>`
  alongside `components` and `sourceFingerprint`.

Store it in a new runtime store slot `activeDrawingSourceComponentColors:
Record<string,string>`, set at **every** path that sets
`activeDrawingSourceComponents` (CreateDrawingCommand assembly branch +
`activateDrawingDocument` + autosave-restore path). **`drawingDocState()` must
NOT reset this slot** — same discipline as `activeDrawingSourceComponents`
(see `project_active_drawing_audit`).

Keys are kernel `partId`s, regenerated on each load — consistent within a load
because the same `components` array drives both the cut and the color map.

### Part path

Single color = `state.activePart?.materials[0]?.color`. No new store slot needed.

### The closure

Both command call sites build a `colorForFace(partId: string) => string`:

- assembly: `activeDrawingSourceComponentColors[partId] ?? '#808080'`
- part: `state.activePart?.materials[0]?.color ?? '#808080'`

## Projection wiring

`projectSectionView` (`packages/shared/src/drawing/projectSectionView.ts`)
currently calls a `hatchLookup(materialId: string) => {angleDeg, spacingMm}` per
cut face. Make the lookup **face-aware** so it can resolve color by partId:

```ts
// before: (materialId: string) => { angleDeg, spacingMm }
// after:  (face: { partId: string; materialId: string }) => { angleDeg, spacingMm, color }
```

- `generateHatchSegments` attaches the returned `color` to every segment it
  emits for that face.
- Angle/spacing resolution is unchanged (still by `materialId`, still default).
- Both call sites (`AddSectionViewCommand.ts:138`, `regenerateSectionView.ts:138`)
  build the closure from their materials + color source.

## Renderers (three hatch targets)

1. **`ViewElement.tsx`** (on-screen canvas): change `stroke="black"` →
   `stroke={seg.color ?? '#808080'}`. One line.
2. **`renderDrawingSvg`** (export SVG → PDF/PNG): **add** a per-section-view
   hatch `<line>` loop (currently omitted) under the view's transform group,
   emitting `stroke="${seg.color ?? '#808080'}"` with `data-role="hatch"`. Fills
   the pre-existing export-has-no-hatch gap.
3. **`renderDrawingDxf`** (`renderDrawingDxf.ts:152-153`): color the
   `SECTION-HATCH` lines per material via **per-entity ACI color**. Extend
   `dxfWriter.line()` to accept an optional ACI color (group code `62`); add a
   `hexToAci(hex)` nearest-palette mapper. `renderDrawingDxf1to1` has no hatch —
   unaffected.

## Testing (TDD slices, red → green)

1. **shared/projection**: `generateHatchSegments` / `projectSectionView` attach
   `color` from the face-aware lookup. RED: assert `seg.color` equals the
   lookup's color for a tagged cut face.
2. **part path**: `AddSectionViewCommand` part-section segments carry
   `state.activePart.materials[0].color`.
3. **assembly map**: `loadAssemblyForProjection` returns `componentColors` mapping
   each kernel partId → its part's `materials[0].color` (two parts, two colors).
4. **assembly path**: assembly section segments carry **≥2 distinct colors**
   (teeth: assert distinct colors present — NOT a count, which would be vacuous).
5. **regen**: `regenerateSectionView` re-bakes color after reopen.
6. **renderers**:
   - `ViewElement` renders `stroke` = segment color.
   - `renderDrawingSvg` emits colored hatch `<line>`s (NEW path).
   - `renderDrawingDxf` emits per-material ACI color; `hexToAci` unit-tested.
7. **e2e (real Chromium)**: assembly-sourced section view shows ≥2 distinct hatch
   colors on the canvas, and the DXF + SVG exports contain them. Read the browser
   console (every prior drawing feature surfaced production gaps only there).
   Strengthen with a distinct-color assertion, not a presence/count check.
8. **perf**: projection + cut stays within the existing section budget.

## Files touched (anticipated)

- `packages/shared/src/drawing/types.ts` — `HatchSegment.color`
- `packages/shared/src/drawing/hatchGenerator.ts` — attach color
- `packages/shared/src/drawing/projectSectionView.ts` — face-aware lookup
- `packages/app/src/drawing/loadAssemblyForProjection.ts` — `componentColors` map
- `packages/app/src/store/useAppStore.ts` (+ `drawingDocState`) — new slot,
  not-reset discipline
- `packages/app/src/commands/AddSectionViewCommand.ts` — colorForFace closure
- `packages/app/src/drawing/regenerateSectionView.ts` — colorForFace closure
- `packages/app/src/drawing/ViewElement.tsx` — stroke = color
- `packages/app/src/drawing/renderDrawingSvg.ts` — add colored hatch loop
- `packages/app/src/drawing/dxfWriter.ts` — optional ACI on `line()`
- `packages/app/src/drawing/renderDrawingDxf.ts` — per-material color + `hexToAci`
- tests + 1 e2e + 1 perf probe

## Open risks / verification notes

- **Store-slot reset discipline**: the new color slot must survive
  `drawingDocState()` (latent staleness bug class — see `project_active_drawing_audit`).
  Add it to the not-reset set and cover with the existing invariant test pattern.
- **partId key consistency**: color map keyed by kernel partId; rebuilt whenever
  `activeDrawingSourceComponents` is rebuilt. Verify both are set together at all
  three activation paths.
- **e2e teeth**: a count-only or presence-only hatch assertion is vacuous (a
  horizontal cut yields the same count regardless of color). Assert ≥2 *distinct*
  colors. Verify the test fails if color resolution regresses (temporarily break
  the production path → RED).
- **hexToAci**: lossy nearest-palette mapping; unit-test a few representative hex
  inputs (saturated colors map to plausible ACI indices).
