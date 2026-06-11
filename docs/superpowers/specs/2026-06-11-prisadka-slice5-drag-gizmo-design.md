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

---

## 9. Corrections v2 — AUTHORITATIVE (post 4-lens adversarial spec-verify)

The 4-lens spec-verify (geometry conf 82 · interaction conf 82 · false-green conf 82 · reuse conf 88) ran against the real code. **This section overrides §2–§7 where they conflict.** The plan MUST honor every BLOCKER and SHOULD-FIX below. Each is code-grounded (file:line).

### 9.A Geometry / projection math
- **[BLOCKER] World position via `matrixWorld` after raycast, not `mesh.matrix`.** Markers set `mesh.matrixAutoUpdate=false` + `mesh.matrix.copy(worldMat)` (`SceneManager.ts:701-702`); `raycastBoreMarker` calls `updateMatrixWorld(true)` (`:788`) so `matrixWorld` is valid **only after** a raycast. **Extract `boreWorldPos` from the raycast hit object's `matrixWorld` translation in the SAME pointerdown that ran `raycastBoreMarker`** — never read it in a separate handler or before the raycast. Prefer reading the hit mesh directly (the raycast already returns the hit); fall back to `boreMarkerList()` lookup by boreId only if needed.
- **[BLOCKER] Single-delta clamp pre-pass (coupled-move desync).** Two members move via different face frames. Compute ONE clamped `delta` against the **most-restrictive** member's face extents in a pre-pass, then pass that identical delta to `translateConnectorAlong` for all members. Never clamp members independently (preview vs commit divergence + mating bore floats off its panel).
- **[SHOULD-FIX] Near-parallel guard baked into the unit.** `screenDragToAxisDelta` must hard-guard the degenerate case (move-axis ∥ view direction; denominator `sin²θ→0`, >11× magnification). Constant `GIZMO_AXIS_VIEW_PARALLEL_THRESHOLD = 0.95`; when `|worldAxis·viewDir| > 0.95` return `0` (hold last stable). The guard lives INSIDE the pure unit, not the caller. Closest-point-line-to-ray is the correct model otherwise (plane-project is numerically identical, same degeneracy).
- **[SHOULD-FIX] FOV-derived independent oracle.** The `screenDragToAxisDelta` unit oracle must be hand-computed from camera FOV/distance trig (ray-plane projection of two explicit world points), NOT the closest-point algebra the impl uses — else tautological green (slice-1/4 false-green class). Canonical case: camera at `(0,0,100)` down −Z, axis = world X, bore at origin.
- **[NIT] Re-label hinge axis.** It is the cup face **u-axis (along door length)**, derived `rotate({1,0,0}, cupQuat)` (`BorePropertiesPanel.tsx:151`) — NOT "height." Fix wording so no test asserts verticality. `jointDir` is unit-length (`connectorCatalog.ts:136 normalizeVec3`).

### 9.B 3D interaction wiring (the real blast-radius)
- **[BLOCKER] OrbitControls accessor.** App.tsx's pointer handler has no handle to controls. `SceneManager.getControls()` exists (`:152`), reachable via `viewportRef.current.getSceneManager()`. Add `orbitControlsRef = useRef<OrbitControls|null>(null)`, populate it in the SceneManager-init `useEffect` (alongside `sm.getControls()`), and read it in the pointer handler. (Two-hop nullable chain in a hot pointermove path otherwise.)
- **[BLOCKER] OrbitControls latches its own pointerdown.** Controls attach native listeners at `new OrbitControls(camera, canvas)` (`SceneManager.ts:133`) and latch rotation on their own `pointerdown`; setting `controls.enabled=false` afterward does NOT abort the in-progress gesture. On a bore-hit pointerdown: set `enabled=false` AND abort the latched gesture — `controls.domElement.releasePointerCapture(pointerId)` (stash `pointerId` in `boreDragRef`). **Verify by e2e probing the camera matrix is unchanged across the drag (stronger than the `enabled` flag).**
- **[BLOCKER] Forward `pointercancel`.** Viewport wires only down/move/up/click (`Viewport.tsx:473-476`). Add `onPointerCancel` (and optionally `onBlur`) forwarding through `props.onPointer`; the handler treats `pointercancel` exactly like `pointerup` (re-enable controls + clear `boreDragRef`). Otherwise alt-tab mid-drag freezes the camera permanently. Re-enable on EVERY exit path (`finally`-style).
- **[BLOCKER] Defer marker rebuild during drag.** `rebuildBoreMarkers` disposes + recreates all marker meshes (`SceneManager.ts:664-710`); if `boreCacheInvalidator` fires mid-drag the stashed dragged mesh ref (and the gizmo mesh) become disposed orphans (silent no-op moves). Gate rebuild while a bore drag is active (an `isDragging`/`boreDragRef` check that defers a queued rebuild to drag-end), OR re-fetch the mesh by boreId after each rebuild. Apply to BOTH the marker and the gizmo mesh.
- **[BLOCKER] Bore pointerdown before the `dragBusy` guard.** Insert bore-drag pointerdown handling BEFORE the `dragBusy` check (`App.tsx ~:2014`), mirroring the assembly-picker-ref placement (`~:2003`) — otherwise `dragBusy` blocks the bore drag.
- **[SHOULD-FIX] Comment the click-suppression ordering.** `suppressNextClickRef` is checked at the top of the click branch before the bore raycast (`App.tsx:2098-2106`) so it correctly suppresses bore-select after a drag — but it's order-fragile. Add a comment marking the dependency.

### 9.C False-green test design (the gate that caught prior slices)
- **[BLOCKER] e2e dispatches REAL DOM pointer events, never a probe.** `dragAlongFreeDofs` is explicitly a dev/E2E hook (`Viewport.tsx:462`) — a `__zilventorDragBore`/direct-`bus.execute` shortcut is GREEN while the whole pointer handler is unwired. The e2e MUST: seed a cabinet with bores into the active assembly → wait `boreMarkerCount() > 0` → compute the marker's screen coords via `viewport.worldToScreen3d(x,y,z)` (exists; canvas-relative) → `page.mouse.move/down/move(steps)/up`. If `worldToScreen3d` returns `(0,0)` (degenerate/black scene), **fail loudly** — do not click (0,0) (misses the marker → false green).
- **[BLOCKER] 3-step undo assertion.** (1) read `u_before` from OPFS; (2) after drag assert `u_after !== u_before` (proves the command ran + mutated); (3) after `bus.undo()` assert `u_undo === u_before`. All three mandatory — step 3 alone is a false green if the command never landed on the bus (value never changed → trivially restored).
- **[BLOCKER] Mid-gesture controls probe.** Read `getControls().enabled` (and/or the camera matrix) BETWEEN `mouse.down` and `mouse.up` and assert disabled / camera-unchanged; after `mouse.up` assert re-enabled. A post-`pointerup`-only check passes even if controls were never disabled.
- **[SHOULD-FIX] OCCT bake test compares hole CENTER position, not volume.** A Ø5 hole has identical volume before/after a move. Bake before + after; compare the drilled-face centroid (OCCT `GProp_GProps`) and assert it moved by ≈ the drag delta along the world axis. Volume-only / presence-only is a false green.
- **[SHOULD-FIX] tsc command.** Use `pnpm -r typecheck` from repo root (covers shared + app; matches `package.json#scripts.typecheck`) — NOT app-only. Catches the test-file `noUncheckedIndexedAccess` class.

### 9.D Reuse / API fit (resolved + gaps)
- **[RESOLVED] `MoveConnectorCommand` matches the bus.** `Command` interface = `apply()`/`revert()` (`Command.ts:3-4`); `MoveConnectorCommand` exposes both (`:47,:107`); `CommandBus.execute` calls `cmd.apply()` then pushes undo (`CommandBus.ts:15-19`). **No rename/adapter.** Replacing the panel's `void new …().apply()` with `void bus.execute(new …())` is execution-equivalent + adds undo (no double-apply). The §3 Unit E / §7.2 "verify execute/undo vs apply/revert" question is answered: it's `apply`/`revert`.
- **[SHOULD-FIX] Panel has no `bus`.** `BorePropertiesPanel` props (`:20-41`) lack `bus`; the store holds it (`useAppStore.ts:157`). Add `const bus = useAppStore((s) => s.bus)` and route `commitJointMove`/`commitHingeMove` (`:134,:152`) through it.
- **[SHOULD-FIX] connectorId lookup in the drag handler.** `raycastBoreMarker` returns `{boreId, partPath}` only — not `connectorId`. The handler must resolve the `BoreOp` and its `connectorId` via `partBoresCacheRef.current.get(partPath)?.find(b=>b.id===boreId)`, then call `collectConnectorMembers(connectorId, getConnectorDocs())` (`getConnectorDocs` exists, `App.tsx:4839`; needs `panelDims`+`worldPose` per member — all in App closure). This is the path to assemble coupled members for the commit.
- **[CONFIRMED] Triggers/shape.** `selectedBore` carries `boreId+partPath` (`useAppStore.ts:325-329`) — sufficient for gizmo render via `partBoresCacheRef` lookup. `connectorKind` is present on every `BoreOp` (shelfPin/drawerSlide gate works). `translateConnectorAlong((members→{bore,panelDims,worldPose}), worldDir, delta)` reused verbatim.

### 9.E Net-new work list (consolidated, post-verify)
1. `screenDragToAxisDelta` pure unit (+ near-parallel guard) — shared.
2. `boreGizmoAxis(bore, worldPose)` single-source axis derivation (carcass=jointDir, hinge=cupQuat·{1,0,0}, else null) — shared or app; collapse the panel's duplicated derivation onto it.
3. Gizmo mesh render + probe in SceneManager (rebuild-gated during drag).
4. `orbitControlsRef` plumbing + `onPointerCancel` forwarding in Viewport.
5. Bore drag handler in App.tsx (before `dragBusy`; pointerId stash; releasePointerCapture; connectorId lookup; single-delta clamp; one `bus.execute` on up; suppress-click).
6. Route gizmo + panel's two move commands through `bus.execute` (add `bus` to panel).
7. Tests: projection unit (FOV oracle), `boreGizmoAxis` unit, command undo round-trip, real-DOM-pointer e2e (3-step undo + mid-drag controls/camera probe), OCCT centroid-move bake.
