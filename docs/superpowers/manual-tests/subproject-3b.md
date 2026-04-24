# Sub-project 3b — Manual test checklist

## Setup
- [ ] `pnpm dev` starts Vite. Open `http://localhost:5173`. Ready / mm.

## Golden path (single-edge fillet via state seeding)
> Note: interactive edge picking is stubbed in 3b (blocked on tessellated-edge extraction from NamedShape in ExecutionResult). The path below exercises the fillet pipeline via store-seeding, mirroring the E2E tests.
- [ ] Seed a part with a sketched rectangle + extrude, then push a `FilletFeature` with one `FilletEdgeSpec` and constant radius `2 mm` into the feature tree → kernel regenerates, body shows rounded edge.
- [ ] Press `F` → FilletDialog opens. Default tab is Edges, mode Constant. Mode/selection toggles render without errors.
- [ ] Cancel dialog → part unchanged, no residual preview.

## Multi-edge (Loop-style)
> Same story — multi-edge fillet works when the feature is seeded with an `edges: []` array containing multiple specs. Interactive Loop mode (tangency graph walk) is deferred until edge-picking unstubs.
- [ ] Seed a `FilletFeature` with two `FilletEdgeSpec`s pointing at parallel extrude top edges → both rounds render on regenerate.
- [ ] Open FilletDialog → Edges tab lists the seeded specs (readonly indicator; no Add button action while picker is stubbed).

## Variable radius
> No UI affordance yet for adding variable-radius control points without a populated edge list. Exercise by seeding.
- [ ] Seed a `FilletFeature` with `mode: 'variable'` and an `edges` entry carrying `radiusStart` / `radiusEnd` scalars → regenerate produces a tapered round.
- [ ] Open FilletDialog → Variable tab renders, radius controls visible but disabled while edge list is empty.

## Setbacks
> Setbacks are stored in the feature payload but **inactive** at runtime — the installed `opencascade.js` binding (2.0.0-beta) does not expose `SetSetback`. Our wrapper falls back to a no-op and logs.
- [ ] Seed a `FilletFeature` with a `setbacks: [{ vertexName, distance }]` entry → save + reopen round-trips the data. Geometry matches the non-setback result (binding no-op; radius alone is applied).
- [ ] FilletDialog Setbacks tab renders and accepts edits without crash.

## Parametric cascade
> **KNOWN GAP (T29 skipped):** fillet radius parameter edits do not re-tessellate the affected feature. The parametric registry updates, but the cascade into fillet regeneration is not wired.
- [ ] Set fillet radius to a parameter (`r0`), edit `r0` in the Parameters panel → body does **NOT** update live. **Workaround:** reload the app (feature tree re-executes on boot, picks up new param value).
- [ ] Follow-up ticket: wire fillet radius param cascade (see deferred list in memory).

## Edge-lost UX
- [ ] Seed a `FilletFeature` with an invalid `FilletEdgeSpec` (bogus face names) → feature tree row renders a warning badge sourced from `ExecutionResult.featureErrors`. Tested in E2E `fillet-edge-lost.spec.ts`.
- [ ] Hover badge → tooltip names the failing feature.

## Save / reopen
- [ ] Create + seed a fillet feature, save as `.zipt`. Reopen fresh tab → feature loads (file format v6), kernel regenerates the round. Dialog re-open shows stored selection/mode (T26 re-open is a stub — populates feature id only, not full tab state).

## Error paths
- [ ] Seed an invalid edge reference → warning badge renders; kernel logs `filletFailed` in `featureErrors`, other features continue to execute.
- [ ] Seed `radius: 0` or negative → `FilletOps` throws `invalidParameter`, surfaced as `filletFailed` in `featureErrors`, badge visible.

## Known limitations (3b)
- [ ] **Edge-picking stubbed.** Interactive selection modes (Edge / Loop / Feature / All Fillets / All Rounds) wire through the controller but the picker cannot resolve viewport hits to `FilletEdgeSpec`s yet. Blocked on tessellated-edge extraction from `NamedShape` surfaced via `ExecutionResult`.
- [ ] **Parametric fillet cascade not wired** (T29 deferred). Reload to pick up param edits.
- [ ] **Setbacks inactive** in current `opencascade.js` binding. Stored but not applied. Re-enable when upstream exposes `SetSetback`.
- [ ] **Re-open-in-edit-mode** is a stub (T26). Dialog opens to the correct feature id; tab / mode / selection pre-populate deferred.
