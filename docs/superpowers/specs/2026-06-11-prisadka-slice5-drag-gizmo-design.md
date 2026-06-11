# Присадка slice 5 — 3D drag-gizmo for bore live-edit

**Status:** spec (pre-adversarial-verify)
**Date:** 2026-06-11
**Track:** Tier-1 Inventor-2012 furniture parity, присадка/hardware-boring family (slice 5)
**Prior art:** slice 1 carcass joints `bdfe322` · slice 2 doors + система-32 `a57b1f7` · slice 3 live-edit + hardware-BOM `d4e17b8` · slice 4 drawer banks `9574d3f3`
**Manifest:** v24 — **NO bump** (no new persisted fields)
**Kernel:** **NO change** (bake pipeline is generic; this slice only moves an existing bore's `u`/`v`)

---

## 1. Problem & goal

присадка connectors (carcass joints, hinge cups) can be repositioned today only through the **numeric** `BorePropertiesPanel` (type a value, coupled-move along a fixed axis). This slice adds **direct manipulation**: select a bore marker in the 3D viewport, grab an axis handle, and **drag** it along its natural move-axis to reposition the connector — with a live mm readout and full undo. This is the "3D drag-gizmo" deferred twice across slices 3–4.

**Success = all true:**
1. Selecting a carcass/hinge bore marker shows a draggable axis handle along its move-axis.
2. Dragging the handle moves the marker live (no per-frame OCCT re-bake) and updates the connector's `u`/`v` on release.
3. The whole gesture is **one** undoable command; Ctrl+Z restores the prior position.
4. The numeric panel and the gizmo produce identical results and both participate in undo.
5. OrbitControls does not fight the drag (camera stays put while dragging a handle).
6. On release the real OCCT hole re-bakes at the new face position.

**Locked design decisions (brainstorm):**
- **Constrained 1-axis** drag (not free 2D in-face). Axis = the connector's existing coupled-move axis.
- **Carcass (confirmat/minifix/dowel) + hinge only.** shelfPin/drawerSlide are out of scope (no defined move-axis yet).
- **Fix both undo paths**: gizmo commit AND the numeric panel's two move commands route through `bus.execute`.

---

## 2. Reuse surface (audited — file:line)

The 3D-drag-gizmo audit (Explore, conf 87) confirmed most infra exists:

| Capability | Location | Notes |
|---|---|---|
| Bore marker picking | `SceneManager.raycastBoreMarker(camera, ndc)` → `{boreId, partPath} \| null` | `packages/app/src/viewport/SceneManager.ts:785`. Returns identity only, **not** world position. |
| Marker meshes (world matrix) | `SceneManager.rebuildBoreMarkers` | `SceneManager.ts:664`. `this.boreMarkers: THREE.Mesh[]` (`:108`); each marker's composed world matrix holds the world position; `userData = {boreId, markerKey, partPath}` (`:703-706`). |
| Marker colors per kind | `BORE_COLORS` | `SceneManager.ts:114-121`. |
| Click→select bore | `App.tsx:2103` | bore raycast runs before component selection; on hit → `setSelectedBore(boreId, partPath)`. **No pointerdown/move branch for bores today.** |
| Coupled cross-doc move | `MoveConnectorCommand` | `packages/app/src/commands/MoveConnectorCommand.ts:41`. `apply()` snapshots + prior OPFS bytes, calls `translateConnectorAlong`, sets `edited=true`, atomic write with rollback, invalidates caches. **Called via `void new …().apply()` — bypasses `bus.execute` (no undo).** |
| World-axis projection math | `translateConnectorAlong(members, worldDir, delta)` | `packages/shared/src/connectorCoupling.ts:31`. `bore.u += delta·dot(worldDir, worldUDir)`, `bore.v += delta·dot(worldDir, worldVDir)`. Convention-agnostic; **reused verbatim** by the gizmo. |
| Numeric move paths | `BorePropertiesPanel.commitJointMove` (`:127`, worldDir=`bore.jointDir`) / `commitHingeMove` (`:143`, worldDir = cup quaternion · {1,0,0}) | `packages/app/src/shell/BorePropertiesPanel.tsx`. Both call `MoveConnectorCommand` directly (bus-bypass). |
| Single-axis bore edit | `EditBoreCommand` | `packages/app/src/commands/EditBoreCommand.ts:22`. u/v/diameter/depth patch; also bus-bypass. Not used by the gizmo (gizmo uses the coupled `MoveConnectorCommand`). |
| Component-drag precedent | `App.tsx:2023-2093` + `Viewport.dragAlongFreeDofs` (`Viewport.tsx:419`) | pointerdown stashes `componentDragRef`, move calls drag fn past a 3px threshold, up commits + sets `suppressNextClickRef`. **Pointer wiring for it is a TODO** (`Viewport.tsx:462`) — only E2E calls it. Mirror this pattern. |
| Pointer plumbing | `Viewport.tsx:473-476` forwards React synthetic `onPointerDown/Move/Up/Click` via `props.onPointer`. | Raw three.js `^0.165.0` + `OrbitControls` from examples; manual `THREE.Raycaster`. |
| Command bus | `CommandBus.execute/undo/redo` | `packages/app/src/commands/CommandBus.ts:11`. Clean stack; adding bore commands is mechanically trivial. |
| Bore shape | `BoreOp` | `packages/shared/src/bore.ts:21-39`. `face`, `u`, `v`, `diameter`, `depth`, `role`, `connectorId`, `connectorKind`, `edited?`, `jointDir?` (world unit vector of joint line; absent on hinge/shelf-pin). |
| Format version | `CURRENT_FORMAT_VERSION = 24` | `packages/shared/src/fileFormat.ts:4`. No migration this slice. |

**Two blast-radius risks the audit flagged (must be designed-for, not discovered):**
- **R1 — OrbitControls contention.** No `controls.enabled = false` guard exists anywhere. A click-drag on a small ring will rotate the camera simultaneously. **The gizmo MUST disable OrbitControls on pointerdown-over-handle and re-enable on pointerup.**
- **R2 — Undo bypass.** `MoveConnectorCommand`/`EditBoreCommand` bypass `bus.execute`; Ctrl+Z does not undo bore edits today. The gizmo MUST coalesce into one `bus.execute`; we also fix the panel (locked decision).

---

## 3. Architecture — units in isolation

### Unit A — `screenDragToAxisDelta` (packages/shared, pure)
**The only net-new math.** Signature (proposed; finalize in plan):
```
screenDragToAxisDelta(
  worldAxis: Vec3,          // unit move-axis in world space
  boreWorldPos: Vec3,       // world position of the bore at drag start
  ndcStart: {x,y},          // pointer NDC at pointerdown
  ndcNow: {x,y},            // pointer NDC at current move
  camera: { projViewInverse: Mat4 | … }  // enough to build a world ray from NDC
): number                   // signed mm along worldAxis
```
**Model:** build the world ray for `ndcNow` (and `ndcStart`); the constrained value is the signed distance along the line `boreWorldPos + t·worldAxis` to the closest point on the pointer ray. Return `t_now − t_start` (mm). Pure, deterministic, unit-tested standalone with hand-computed oracles (camera looking down −Z, axis = world X, known pointer offsets).

> Implementation note: passing the camera as a plain matrix (not a `THREE.Camera`) keeps `packages/shared` three-free. The app layer extracts the matrix and calls the pure fn.

### Unit B — `boreGizmoAxis(bore, worldPose)` (axis derivation, shared or app)
Returns the **world** move-axis for a bore, reusing the panel's exact derivation:
- carcass (`confirmat`/`minifix`/`dowel`): `bore.jointDir` (already world).
- hinge: rotate `{x:1,y:0,z:0}` by the cup panel's world quaternion (mirror of `commitHingeMove`).
Returns `null` for out-of-scope kinds (shelfPin/drawerSlide) → no gizmo, not draggable. **Single source of truth** shared by gizmo rendering, the drag handler, and ideally the numeric panel (collapse the duplicated derivation).

### Unit C — Gizmo rendering (SceneManager)
When `selectedBore` is set **and** `boreGizmoAxis` ≠ null, draw a double-arrow handle through the bore's world position along the world axis (a distinct mesh, e.g. a thin cylinder + cone caps, in a recognizable color). Rebuilt alongside markers. Expose a probe (`__zilventor…gizmoVisible()` / count) since headless renders black.

### Unit D — Drag handler (App.tsx, mirrors `componentDragRef`)
- `pointerdown`: `raycastBoreMarker` → if hit and `boreGizmoAxis(bore)≠null` → stash `boreDragRef` {boreId, partPath, worldAxis, boreWorldPos, ndcStart}, **disable OrbitControls**, record members via the same collection the panel uses (`collectConnectorMembers`).
- `pointermove`: past 3px threshold → `delta = screenDragToAxisDelta(...)` → translate the marker (and gizmo) mesh visually by `delta·worldAxis`; update a readout. No command yet.
- `pointerup`: **re-enable OrbitControls**; if moved, `bus.execute(new MoveConnectorCommand({members, worldDir: worldAxis, delta, opfs}))`; clear ref; set `suppressNextClickRef`. If not moved past threshold, treat as a plain select (no command).

### Unit E — Undo wiring
Make `MoveConnectorCommand` conform to the bus `Command` interface (verify exact method names `execute`/`undo` vs current `apply`/`revert` in the plan) and route:
1. the gizmo commit (Unit D),
2. `BorePropertiesPanel.commitJointMove`,
3. `BorePropertiesPanel.commitHingeMove`
…all through `bus.execute`. One gesture / one numeric edit = one undo step.

---

## 4. Data flow

```
pointerdown on marker ─▶ raycastBoreMarker ─▶ boreGizmoAxis (kind gate)
   │                                              │ null → ignore (plain select)
   ▼                                              ▼ non-null
disable OrbitControls, stash boreDragRef + boreWorldPos + members
   │
pointermove ─▶ screenDragToAxisDelta ─▶ move marker+gizmo mesh + readout   (no bake)
   │
pointerup ─▶ re-enable OrbitControls
          ─▶ bus.execute(MoveConnectorCommand{members, worldAxis, delta})
                 │ translateConnectorAlong mutates u/v, edited=true
                 │ atomic OPFS write (.zipt repack) with rollback
                 ▼
             boreCacheInvalidator([affected paths]) ─▶ rebuildBoreMarkers + re-bake OCCT hole
```

Undo: `bus.undo()` → `MoveConnectorCommand` restores snapshots + prior OPFS bytes → invalidate → markers/bake revert.

---

## 5. Error handling & edge cases
- **Out-of-scope kind** (shelfPin/drawerSlide/no axis): `boreGizmoAxis` returns null → no gizmo, drag does nothing, falls through to select. No error.
- **Clamp to face:** the drag delta is clamped so the resulting `u`/`v` keep the bore inside the panel face extents (don't let a handle drag a bore off its board). Clamp lives in the command or the handler; spec'd, plan picks the seam.
- **Zero-delta release** (click without drag): no command; behaves as today's select.
- **OrbitControls re-enable on every exit path** (pointerup, pointercancel, blur) — never leave it disabled (would freeze the camera). Use a `finally`-style guard.
- **Coupled members:** hinge/carcass moves are cross-document; reuse `collectConnectorMembers` exactly as the panel does so both cabinet-side and mating-side bores move together.

---

## 6. Testing & verification plan (headless renders black → probes)

1. **Unit (shared) — `screenDragToAxisDelta`:** hand-computed oracles with an independent derivation (NOT re-using the function's own formula). Camera down −Z, axis = world X, pointer dragged +0.1 NDC → known mm. Axis = world Z (vertical) too. Anti-tautology: oracle computed by a second method (project two explicit world points, not the same closest-point algebra).
2. **Unit — `boreGizmoAxis`:** carcass returns `jointDir`; hinge returns the rotated cup axis; shelfPin/drawerSlide return null.
3. **Command — undo round-trip:** `MoveConnectorCommand` through a real `CommandBus`: execute moves u/v, undo restores exactly, redo re-applies. OPFS bytes round-trip.
4. **e2e (real browser + WASM, worktree playwright config, port 5182) — the false-green gate:** seed a cabinet with carcass bores; drive **real** `pointerdown → pointermove×N → pointerup` on a real bore marker (dispatch pointer events at the marker's screen position, NOT a probe shortcut). Assert: (a) a `MoveConnectorCommand` instance went through `bus.execute` (probe the bus history / instanceof), (b) the bore's `u`/`v` changed by the expected sign, (c) **OrbitControls was disabled during the drag and re-enabled after** (probe `controls.enabled` mid-gesture), (d) `Ctrl+Z` restores the original `u`/`v`. A green test that calls the command directly instead of dispatching pointer events is a false green — must dispatch DOM pointer events.
5. **Real-OCCT bake:** after a drag-move, the producer's actual moved bore bakes a real Ø hole at the **new** face position (volume/position delta vs pre-move) — ground-truth geometry proof that the u/v change reaches OCCT.
6. **Full-package tsc** (app + shared) — catch test-file `noUncheckedIndexedAccess` errors vitest misses.
7. **FINAL whole-branch §-by-§ review** of the real interaction code for: OrbitControls re-enable on every exit path; gizmo not left dangling after deselect; the numeric-panel bus routing not double-pushing; dead code.

---

## 7. Open premises for adversarial spec-verify to attack
1. **World-position source:** can the drag reliably read the bore's world position from the marker mesh matrix at pointerdown, or does `rebuildBoreMarkers` not leave a stable per-bore world transform? (audit: matrix exists but world-pos not surfaced.)
2. **`MoveConnectorCommand` ↔ bus interface:** does it expose `execute`/`undo` (or `apply`/`revert`)? Does routing the panel's existing direct calls through the bus change behavior (double-write, cache double-invalidate)?
3. **Hinge axis correctness:** is `commitHingeMove`'s `quaternion·{1,0,0}` actually the height axis, and is it the axis a user expects to drag? Does `collectConnectorMembers` assemble both hinge members from a single `partPath`?
4. **Projection math for an arbitrary (non-axis-aligned) camera:** does `screenDragToAxisDelta` stay stable when the move-axis is near-parallel to the view direction (degenerate)? Spec a fallback (ignore/clamp) when `|axis · viewDir|` ≈ 1.
5. **Clamp seam:** where does the face-extent clamp live so that both the live mesh preview and the committed u/v agree (no preview/commit divergence)?
6. **Marker-mesh move vs rebuild race:** moving the marker mesh during drag, then `boreCacheInvalidator` rebuilding on commit — any of: stale mesh, double marker, gizmo orphaned?
7. **False-green risk:** can the e2e pass while actually bypassing the pointer path? (must dispatch real DOM pointer events; assert orbit-disabled mid-gesture.)

---

## 8. Out of scope (deferred)
shelfPin/drawerSlide dragging; free 2D in-face drag; multi-bore / marquee drag; snapping to the 32mm Система-32 grid; diameter/depth handles (numeric only); touch/mobile; a transform-gizmo library. Manifest stays v24.
