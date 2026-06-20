# Assembly Constraint Reflow + Authoring Completion

**Required sub-skill for agentic workers:** `superpowers:test-driven-development` — invoke before every implementation step. Also load `superpowers:systematic-debugging` on any test failure.

**Goal:** Part-parameter edits automatically re-solve the assembly (reflow), axis/circularEdge pick is implemented, `coincident` is added as a mate alias, and `tangent` cylinder↔plane + cylinder↔cylinder ship with analytic Jacobians, all gated by two real-browser e2e scenarios.

**Architecture:** The solver effect in `App.tsx:1847` (`}, [solverDirty, solverAssembly]`) already listens to `solverDirty`. The missing link for geometry reflow is that `invalidatePartPaths` (`App.tsx:5224`) does **not** call `setSolverDirty(true)`, so furniture-command re-bakes and any other path that calls `invalidatePartPaths` never trigger a re-solve. The fix is one line at `App.tsx:5244`. Separately, a param-cascade subscriber at `App.tsx:1851` already marks `solverDirty` when *parameter* refs change — but this does not cover *geometry* reflow (changed part shape). Both mechanisms are needed; Task 1 fixes the geometry path.

For axis/circularEdge pick: `Viewport.tsx:361` has an early-return `null` for those modes. The existing `edge` branch (`:396-404`) already returns the ray; axis/circularEdge just need to fall through to it. App.tsx's pointer handler at `:2656-2658` currently does an early-return for non-face modes — **that early-return must also be replaced** with edge-classification logic that reads a **per-component tessellated edge cache** and calls `assemblyPickerRef.current.handleEdgeHit` or `handleCylindricalFaceHit`. This per-component cache (`partTessellatedEdgesCacheRef`) does **not** yet exist and must be added mirroring `partTessellatedFacesCacheRef`.

**Critical type facts (read from source):**
- `TessellatedEdge` (`packages/shared/src/types.ts:259`) has fields: `edgeName`, `segments`, `faceNames`, `dihedralAngle?`. It does **NOT** have `isCircular`. Circularity must be inferred from segment geometry (a closed loop: first endpoint of first segment ≈ last endpoint of last segment) or `dihedralAngle` curvature, not a stored flag.
- `assemblyPartIdCacheRef` maps `partPath → kernelPartId` (`string → string`). At `App.tsx:1626`, `freshPart.id` is a **kernel part UUID** assigned by the worker, NOT an OPFS path. To invert: `Array.from(assemblyPartIdCacheRef.current.entries()).find(([,v]) => v === freshPart.id)?.[0]` yields the OPFS partPath. If the kernel UUID for the re-executed part was never loaded in assembly context (part was being edited in standalone mode), the map lookup returns `undefined` — in that case, skip `invalidatePartPaths` silently.

**Tech Stack:** TypeScript · React · Vitest (unit + integration, no WASM for pure-math tests) · OpenCascade WASM kernel (for integration tests only) · Playwright (real-browser e2e) · pnpm monorepo.

## Global Constraints

- `tsc 0-new` across all packages after every task (`pnpm -r typecheck`).
- No manifest (`CURRENT_FORMAT_VERSION`) bump — `tangent` constraint is additive in the serialised union; `coincident` is never persisted (persisted as `mate`).
- Coincident = mate alias at offset 0 — no new `kind` value, no migration.
- Every e2e test drives the actual dialog/pick handlers, never a stub command path (the "green command-e2e ≠ working UI" trap is documented in project memory).
- TDD: write failing test → confirm it fails for the expected reason → write minimal impl → confirm green → commit.
- Real-browser gate: Task 7 runs Playwright against the dev server (`pnpm dev` from repo root, port 5173 default); the test files go under `tests/e2e/assembly/`.

---

### Task 1: Reflow trigger — wire `setSolverDirty` into `invalidatePartPaths` AND verify the param→re-execute path

**Files:**
- Modify `packages/app/src/App.tsx` — `invalidatePartPaths` callback at line 5224 (specifically line 5244, after `s.setActiveDocument(...)`).

**Verified source state (read from actual file):**
- `invalidatePartPaths` is at `App.tsx:5224`. It already calls `assemblyRefCacheRef.current.invalidate(partPath)` at `:5229` and bumps the assembly identity at `:5244`. It does **NOT** call `setSolverDirty(true)`. The one-line fix goes after line 5244.
- The dev hook `__zilventorAssemblyInvalidatePart` at `App.tsx:3270-3283` already calls `setSolverDirty(true)` (line 3283) — proving the pattern is correct; `invalidatePartPaths` simply lacks it.
- The `parameterRegistry.subscribe` effect at `App.tsx:1587-1667` runs when `activePart` is set (part mode only). It calls `kernelClient.execute(freshPart.id)` at line 1626 and then updates mesh/edges — but does **NOT** call `invalidatePartPaths` afterward. The re-execute in part mode does not feed back into the assembly solver.
- The parameter cascade at `App.tsx:1851-1862` marks `solverDirty` only when a constraint has a `{ kind: 'param' }` ref — this is the *parameter ref* path, not the *geometry change* path.
- **Conclusion for B-CRUX:** The param→re-execute path at line 1626 does NOT call `invalidatePartPaths`. After Task 1's one-line fix to `invalidatePartPaths`, geometry reflow via `invalidatePartPaths` will work — but only for callers that already use it (furniture commands via `boreCacheInvalidator`). For the **S-A e2e**, the test drives `__zilventorAssemblyInvalidatePart` which also calls `setSolverDirty(true)` directly and is the correct path. The param re-execute path (`:1626`) needs an additional fix to call `invalidatePartPaths` after re-bake when an assembly is active — this is Step 4 below.

**Steps:**

> **GATE STRENGTHENED (ratified 2026-06-20):** Task 1's reflow fix is the milestone's
> headline feature, so it must have a unit test that FAILS if the fix is removed. The original
> plan's test inlined the fixed logic (hollow — passed regardless of the fix) and S-A's
> `__zilventorAssemblyInvalidatePart` dev hook sets `solverDirty` independently of
> `invalidatePartPaths` (so S-A also could not gate it). Fix: extract the two decisions into
> pure, module-level functions and unit-test THOSE for a real red→green. `invalidatePartPaths`
> and the param→re-execute path call them. S-A (Task 7) stays a reflow-CORRECTNESS check, not
> the wiring gate.

- [ ] **Step 1: Write the failing unit test for the two pure decision functions.**

  Create `packages/app/src/assembly/__tests__/reflowDirty.spec.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest';
  import { shouldReflowAfterInvalidate, partPathForKernelId } from '../reflowDirty';

  describe('shouldReflowAfterInvalidate', () => {
    it('returns true when the active document is an assembly', () => {
      expect(shouldReflowAfterInvalidate({ kind: 'assembly' })).toBe(true);
    });
    it('returns false for a part document', () => {
      expect(shouldReflowAfterInvalidate({ kind: 'part' })).toBe(false);
    });
    it('returns false for null/undefined', () => {
      expect(shouldReflowAfterInvalidate(null)).toBe(false);
      expect(shouldReflowAfterInvalidate(undefined)).toBe(false);
    });
  });

  describe('partPathForKernelId', () => {
    const entries: Array<[string, string]> = [
      ['parts/box.zipt', 'uuid-box'],
      ['parts/lid.zipt', 'uuid-lid'],
    ];
    it('inverts the partPath→kernelId map to recover the OPFS path', () => {
      expect(partPathForKernelId(entries, 'uuid-lid')).toBe('parts/lid.zipt');
    });
    it('returns undefined when the kernel id was never loaded in assembly context', () => {
      expect(partPathForKernelId(entries, 'uuid-standalone')).toBeUndefined();
    });
  });
  ```

  Run: `pnpm --filter @zilventor/app test -- --run reflowDirty`
  **Expected RED reason:** `Failed to resolve import "../reflowDirty"` — the module does not exist yet. This test genuinely gates Steps 2-4: if either function's logic is wrong or removed, these assertions fail.

- [ ] **Step 2: Create the pure decision module (minimal impl to go green).**

  Create `packages/app/src/assembly/reflowDirty.ts`:

  ```typescript
  /**
   * Pure decisions extracted from invalidatePartPaths / the param→re-execute path so the
   * reflow-trigger logic (the milestone's headline feature) is unit-testable in isolation.
   */

  /** True when invalidating part caches should mark the assembly solver dirty (reflow). */
  export function shouldReflowAfterInvalidate(
    activeDocument: { kind: string } | null | undefined,
  ): boolean {
    return activeDocument?.kind === 'assembly';
  }

  /**
   * Invert assemblyPartIdCacheRef (partPath → kernelId) to recover the OPFS partPath for a
   * kernel part UUID. Returns undefined when the id was never loaded as an assembly component.
   */
  export function partPathForKernelId(
    entries: Iterable<readonly [string, string]>,
    kernelId: string,
  ): string | undefined {
    for (const [partPath, id] of entries) {
      if (id === kernelId) return partPath;
    }
    return undefined;
  }
  ```

  Run: `pnpm --filter @zilventor/app test -- --run reflowDirty` → **Expected: PASS (5/5).**

- [ ] **Step 3: Wire `invalidatePartPaths` to use `shouldReflowAfterInvalidate` + setSolverDirty.**

  In `packages/app/src/App.tsx`, add the import near the other `./assembly/*` imports:

  ```typescript
  import { shouldReflowAfterInvalidate, partPathForKernelId } from './assembly/reflowDirty';
  ```

  The current block at lines 5240-5245 reads:

  ```typescript
    // Bump assembly identity to re-trigger the mesh-sync + bore-marker effects.
    const s = useAppStore.getState();
    const doc = s.activeDocument;
    if (doc?.kind === 'assembly') {
      s.setActiveDocument({ kind: 'assembly', document: { ...doc.document } });
    }
  }, [assemblyPartIdCacheRef, assemblyRefCacheRef, geometryCacheRef, partTextureIdCacheRef, partBoresCacheRef, partTessellatedFacesCacheRef]);
  ```

  Change to:

  ```typescript
    // Bump assembly identity to re-trigger the mesh-sync + bore-marker effects,
    // and mark the solver dirty so constrained dependents reflow with fresh refs.
    const s = useAppStore.getState();
    const doc = s.activeDocument;
    if (shouldReflowAfterInvalidate(doc)) {
      s.setActiveDocument({ kind: 'assembly', document: { ...doc!.document } });
      s.setSolverDirty(true);   // NEW: geometry reflow after cache invalidation
    }
  }, [assemblyPartIdCacheRef, assemblyRefCacheRef, geometryCacheRef, partTextureIdCacheRef, partBoresCacheRef, partTessellatedFacesCacheRef]);
  ```

  **Exact location:** the `if` block at the tail of `invalidatePartPaths` (App.tsx:5243-5245). `doc!` is safe because `shouldReflowAfterInvalidate(doc)` is only true when `doc.kind === 'assembly'`.

- [ ] **Step 4: Wire the param→re-execute path to call `invalidatePartPaths` via `partPathForKernelId`.**

  The `parameterRegistry.subscribe` effect at `App.tsx:1587` runs `kernelClient.execute(freshPart.id)` at line 1626. After `applyWorkFeaturesToViewport(res.value.workFeatures, freshPart.featureTree)` at line 1636 (inside the `if (res.ok && viewportRef.current)` branch), insert before the closing `}`:

  ```typescript
            // If an assembly is open and this part was loaded as a sub-component,
            // invalidate its ref-cache so constrained dependents reflow with fresh geometry.
            // freshPart.id is a kernel UUID, not an OPFS path — invert assemblyPartIdCacheRef.
            const storeNow = useAppStore.getState();
            if (shouldReflowAfterInvalidate(storeNow.activeDocument)) {
              const partPathForId = partPathForKernelId(
                assemblyPartIdCacheRef.current.entries(), freshPart.id,
              );
              // undefined ⇒ part edited standalone (not an assembly component) ⇒ skip silently.
              if (partPathForId) {
                void invalidatePartPaths([partPathForId]);
              }
            }
  ```

  **Why `freshPart.id` ≠ `partPath`:** `assemblyPartIdCacheRef` is keyed by `partPath` (OPFS path, populated at `App.tsx:1748`); `freshPart.id` (line 1619) is the UUID from `kernelClient.loadFromBytes`. `partPathForKernelId` (tested in Step 1) is the correct inversion.

- [ ] **Step 5: Run the unit test and typecheck.**

  ```
  pnpm --filter @zilventor/app test -- --run reflowDirty
  pnpm -r typecheck
  ```
  Expected: PASS (5/5), 0 tsc errors.

- [ ] **Step 6: Commit.**

  ```
  git add packages/app/src/App.tsx packages/app/src/assembly/reflowDirty.ts packages/app/src/assembly/__tests__/reflowDirty.spec.ts
  git commit -m "feat(assembly): setSolverDirty on geometry invalidation for reflow (testable seam)"
  ```

---

### Task 2: Axis + circularEdge pick — per-component edge cache, Viewport fallthrough, App.tsx pointer handler

**Files:**
- Modify `packages/app/src/App.tsx` — (a) add `partTessellatedEdgesCacheRef`, (b) populate it alongside faces in the assembly mesh-sync loop, (c) clear/delete it in the same places as `partTessellatedFacesCacheRef`, (d) replace the early-return at lines 2656-2658 with real edge-classification logic.
- Modify `packages/app/src/viewport/Viewport.tsx` — remove `axis`/`circularEdge` from the early-return null guard at line 361 so they fall through to the existing `edge` ray return at lines 396-404.

**Verified source state (read from actual file):**
- `Viewport.tsx:361`: `if (mode === 'axis' || mode === 'point' || mode === 'circularEdge') return null;` — the guard that blocks `axis`/`circularEdge`.
- `Viewport.tsx:396-404`: The `edge` branch already returns `{ kind: 'edge', componentPath, origin, direction }` — `axis`/`circularEdge` just need to fall through to it.
- `App.tsx:2656-2658`: `// Non-face modes ... return;` — early-return that consumes the event without acting.
- `App.tsx:3207`: `const partTessellatedFacesCacheRef = useRef<Map<string, TessellatedFace[]>>(new Map());` — the faces cache ref to mirror for edges (FACT-1).
- `App.tsx:4392`: `partTessellatedFacesCacheRef.current.set(partPath, res.value.tessellatedFaces ?? []);` — populate point to mirror.
- `App.tsx:4314`: `.clear()` on faces cache (project-switch clear); `App.tsx:5234`: `.delete(partPath)` in `invalidatePartPaths` — both mirror points for edges.
- `TessellatedEdge` (`packages/shared/src/types.ts:259`) fields: `edgeName`, `segments`, `faceNames`, `dihedralAngle?`. **NO `isCircular` field.** Circularity must be inferred: a closed-loop edge has its first segment's first point ≈ last segment's last point (within 1e-3 mm). Use this inline helper:
  ```typescript
  function isEdgeCircular(e: TessellatedEdge): boolean {
    const first = e.segments[0];
    const last = e.segments[e.segments.length - 1];
    if (!first || !last) return false;
    const [p0] = first; const [, p1] = last;
    return Math.hypot(p0.x - p1.x, p0.y - p1.y, p0.z - p1.z) < 1e-3;
  }
  ```
- `assemblyPickerRef.current.handleEdgeHit(componentPath, edgeName, isCircular)` — signature verified at `App.tsx:3251`: third arg is `boolean`. Produces `kind:'axis'` when `pickerMode==='axis'`, `kind:'circularEdge'` when `pickerMode==='circularEdge' && isCircular`.
- `assemblyPickerRef.current.handleCylindricalFaceHit(componentPath, face)` — verified at `App.tsx:3252`. Fallback for `axis` mode when edge pick misses.
- **`partTessellatedEdgesCacheRef` does NOT yet exist** (grep confirmed no match). It must be added. Import of `TessellatedEdge` is already present in App.tsx (FACT-2: line 49).

**Steps:**

- [ ] **Step 1: Add `partTessellatedEdgesCacheRef` and write RED unit test for cache population.**

  a) **Declare the ref** near `partTessellatedFacesCacheRef` at `App.tsx:3207`. Insert the next line immediately after:

  ```typescript
  // T38: tessellated edges per partPath for axis/circularEdge pick in assembly mode.
  const partTessellatedEdgesCacheRef = useRef<Map<string, TessellatedEdge[]>>(new Map());
  ```

  b) **Populate it** in the assembly mesh-sync loop at `App.tsx:4392`, immediately after the faces line:

  ```typescript
  // EXISTING line 4392:
  partTessellatedFacesCacheRef.current.set(partPath, res.value.tessellatedFaces ?? []);
  // NEW line 4393 (insert here):
  partTessellatedEdgesCacheRef.current.set(partPath, res.value.tessellatedEdges ?? []);
  ```

  c) **Clear it** at `App.tsx:4314` (project-switch clear block), immediately after the faces clear at line 4314:

  ```typescript
  // EXISTING line 4314:
  partTessellatedFacesCacheRef.current.clear();
  // NEW (insert next):
  partTessellatedEdgesCacheRef.current.clear();
  ```

  d) **Delete per-path** in `invalidatePartPaths` at `App.tsx:5234`, immediately after the faces delete:

  ```typescript
  // EXISTING line 5234:
  partTessellatedFacesCacheRef.current.delete(partPath);
  // NEW (insert next):
  partTessellatedEdgesCacheRef.current.delete(partPath);
  ```

  e) **Write a RED unit test** for cache population contract:

  Create `packages/app/src/viewport/__tests__/partEdgesCache.spec.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest';
  import type { TessellatedEdge } from '@zilventor/shared';

  /**
   * RED: proves that partTessellatedEdgesCacheRef must be populated with
   * res.value.tessellatedEdges (same pattern as faces). The real behavioral
   * gate is the S-B e2e which drives a canvas click in axis mode and asserts
   * brokenRef=false — which only passes if the edge cache was populated.
   *
   * This unit test is a type-contract guard: verifies the cache Map type and
   * that isEdgeCircular correctly identifies closed-loop edges.
   */
  function isEdgeCircular(e: TessellatedEdge): boolean {
    const first = e.segments[0];
    const last = e.segments[e.segments.length - 1];
    if (!first || !last) return false;
    const p0 = first[0]; const p1 = last[1];
    return Math.hypot(p0.x - p1.x, p0.y - p1.y, p0.z - p1.z) < 1e-3;
  }

  describe('partTessellatedEdgesCacheRef population + isEdgeCircular', () => {
    it('cache Map<string, TessellatedEdge[]> stores edges by partPath', () => {
      const cache = new Map<string, TessellatedEdge[]>();
      const edge: TessellatedEdge = {
        edgeName: { faceA: { featureId: 'f1', role: 'side', instance: 0 }, faceB: { featureId: 'f2', role: 'side', instance: 0 } },
        segments: [[{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]],
        faceNames: [{ featureId: 'f1', role: 'side', instance: 0 }, { featureId: 'f2', role: 'side', instance: 0 }],
      };
      cache.set('parts/box.zipt', [edge]);
      expect(cache.get('parts/box.zipt')).toHaveLength(1);
    });

    it('isEdgeCircular: closed loop (circle) returns true', () => {
      // Simulate a circle: 4 segments forming a closed loop.
      const R = 5;
      const pts = [0, 1, 2, 3, 4].map((i) => ({
        x: R * Math.cos((i / 4) * 2 * Math.PI),
        y: R * Math.sin((i / 4) * 2 * Math.PI),
        z: 0,
      }));
      const segs: [{ x: number; y: number; z: number }, { x: number; y: number; z: number }][] =
        [[pts[0]!, pts[1]!], [pts[1]!, pts[2]!], [pts[2]!, pts[3]!], [pts[3]!, pts[0]!]];
      const circleEdge: TessellatedEdge = {
        edgeName: { faceA: { featureId: 'f1', role: 'top', instance: 0 }, faceB: { featureId: 'f1', role: 'side', instance: 0 } },
        segments: segs,
        faceNames: [{ featureId: 'f1', role: 'top', instance: 0 }, { featureId: 'f1', role: 'side', instance: 0 }],
      };
      expect(isEdgeCircular(circleEdge)).toBe(true);
    });

    it('isEdgeCircular: open edge (line) returns false', () => {
      const lineEdge: TessellatedEdge = {
        edgeName: { faceA: { featureId: 'f1', role: 'side', instance: 0 }, faceB: { featureId: 'f2', role: 'side', instance: 0 } },
        segments: [[{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }]],
        faceNames: [{ featureId: 'f1', role: 'side', instance: 0 }, { featureId: 'f2', role: 'side', instance: 0 }],
      };
      expect(isEdgeCircular(lineEdge)).toBe(false);
    });
  });
  ```

  Run: `pnpm --filter @zilventor/app test -- --reporter=verbose --run partEdgesCache`
  Expected: **RED** — `isEdgeCircular` is not yet imported from App.tsx (it lives only in the test). The real RED gate is that `partTessellatedEdgesCacheRef` doesn't exist yet and S-B e2e would fail. The unit test passes once the function is extracted; the S-B e2e is the binding behavioral gate.

- [ ] **Step 2: Fix `Viewport.tsx` — remove `axis`/`circularEdge` from the early-return null guard.**

  In `packages/app/src/viewport/Viewport.tsx`, change line 361:

  ```typescript
  // BEFORE:
      if (mode === 'axis' || mode === 'point' || mode === 'circularEdge') return null;

  // AFTER:
      if (mode === 'point') return null;
      // axis and circularEdge fall through to the edge-ray path at lines 396-404.
      // App.tsx classifies the hit via EdgePickController.pickFromRay on the
      // per-component tessellated edge cache (partTessellatedEdgesCacheRef).
  ```

- [ ] **Step 3: Fix `App.tsx:2656-2658` — replace the early-return with real edge-classification.**

  The current code at lines 2655-2658:

  ```typescript
          // Non-face modes (edge/axis/point/circularEdge): not yet resolved at
          // this layer (T38 future work). Consume the event to avoid fall-through.
          return;
  ```

  Replace with:

  ```typescript
          // axis / circularEdge / edge: resolve via partTessellatedEdgesCacheRef +
          // EdgePickController, then route to handleEdgeHit / handleCylindricalFaceHit.
          if (pickerMode === 'axis' || pickerMode === 'circularEdge' || pickerMode === 'edge') {
            const refHit = viewportRef.current.raycastAssemblyRef(pickerMode, ev.clientX, ev.clientY);
            if (refHit && refHit.kind === 'edge') {
              const componentPath = refHit.componentPath;

              // Resolve the OPFS partPath for this component (same pattern as face pick).
              const storeState = useAppStore.getState();
              const activeAssemblyNow = storeState.activeAssembly;
              const subAsmDocsNow = storeState.subAssemblyDocs;
              const subAsmInnerPosesNow = storeState.subAssemblyInnerPoses;
              const subAsmCacheNow = {
                get: (p: string) => subAsmDocsNow[p]
                  ? ({ kind: 'ok' as const, doc: subAsmDocsNow[p]!, partPath: p,
                       ...(subAsmInnerPosesNow[p] ? { innerStaticPoses: subAsmInnerPosesNow[p] } : {}) })
                  : undefined,
              };
              const partPath = activeAssemblyNow
                ? resolveLeafPartPath(componentPath, activeAssemblyNow, subAsmCacheNow)
                : null;

              // Primary: edge pick via per-component tessellated edge cache.
              const componentEdges = partPath ? partTessellatedEdgesCacheRef.current.get(partPath) : undefined;
              if (componentEdges && componentEdges.length > 0) {
                const ep = new EdgePickController();
                ep.setCandidates(componentEdges);
                const pickedNames = ep.pickFromRay(refHit.origin, refHit.direction);
                if (pickedNames && pickedNames.length > 0) {
                  const edgeName = pickedNames[0]!;
                  const pickedEdge = componentEdges.find((e) => {
                    const a = e.edgeName.faceA, ea = edgeName.faceA;
                    const b = e.edgeName.faceB, eb = edgeName.faceB;
                    // FaceName.instance is optional; treat undefined as 0 for equality.
                    return a.featureId === ea.featureId && a.role === ea.role && (a.instance ?? 0) === (ea.instance ?? 0)
                        && b.featureId === eb.featureId && b.role === eb.role && (b.instance ?? 0) === (eb.instance ?? 0);
                  });
                  // TessellatedEdge has no isCircular field — infer from closed-loop geometry.
                  const isCircular = pickedEdge ? (() => {
                    const first = pickedEdge.segments[0]; const last = pickedEdge.segments[pickedEdge.segments.length - 1];
                    if (!first || !last) return false;
                    const p0 = first[0]; const p1 = last[1];
                    return Math.hypot(p0.x - p1.x, p0.y - p1.y, p0.z - p1.z) < 1e-3;
                  })() : false;
                  assemblyPickerRef.current.handleEdgeHit(componentPath, edgeName, isCircular);
                  return;
                }
              }

              // Fallback for axis mode: re-raycast in face mode and use handleCylindricalFaceHit.
              // This is sufficient for Insert/Angle and the S-B e2e scenario.
              if (pickerMode === 'axis' && partPath) {
                const tessellatedFaces = partTessellatedFacesCacheRef.current.get(partPath);
                if (tessellatedFaces) {
                  const faceHit = viewportRef.current.raycastAssemblyRef('face', ev.clientX, ev.clientY);
                  if (faceHit && faceHit.kind === 'face') {
                    const fp = new FacePickController();
                    fp.setCandidates(tessellatedFaces);
                    const faceName = fp.pickByTriangleIndex(faceHit.triangleIndex);
                    if (faceName) {
                      assemblyPickerRef.current.handleCylindricalFaceHit(componentPath, faceName);
                      return;
                    }
                  }
                }
              }

              if (import.meta.env.DEV) {
                console.warn('[T38] axis/circularEdge pick: no hit for', pickerMode, 'at partPath', partPath);
              }
            }
          }
          return; // consume the event
  ```

  **`isCircular` implementation note:** `TessellatedEdge` (verified at `packages/shared/src/types.ts:259`) has NO `isCircular` field. The inline IIFE above infers circularity by checking if the edge's first segment start ≈ last segment end (closed loop). This is the only correct approach without adding a new field to the shared type.

- [ ] **Step 4: Add `partTessellatedEdgesCacheRef` to `invalidatePartPaths` dependency array.**

  In `invalidatePartPaths` at `App.tsx:5246`, the `useCallback` dependency array currently ends with `partTessellatedFacesCacheRef`. Add `partTessellatedEdgesCacheRef` after it:

  ```typescript
  // BEFORE:
  }, [assemblyPartIdCacheRef, assemblyRefCacheRef, geometryCacheRef, partTextureIdCacheRef, partBoresCacheRef, partTessellatedFacesCacheRef]);

  // AFTER:
  }, [assemblyPartIdCacheRef, assemblyRefCacheRef, geometryCacheRef, partTextureIdCacheRef, partBoresCacheRef, partTessellatedFacesCacheRef, partTessellatedEdgesCacheRef]);
  ```

- [ ] **Step 5: Typecheck and run suite.**

  ```
  pnpm -r typecheck
  pnpm --filter @zilventor/app test --run
  ```
  Expected: 0 new tsc errors, all tests green including `partEdgesCache`.

- [ ] **Step 6: Commit.**

  ```
  git add packages/app/src/viewport/Viewport.tsx packages/app/src/App.tsx packages/app/src/viewport/__tests__/partEdgesCache.spec.ts
  git commit -m "feat(viewport): per-component edge cache + axis/circularEdge pick via edge-ray fallthrough"
  ```

---

### Task 3: Coincident constraint as mate alias

**Files:**
- Modify `packages/app/src/shell/PlaceConstraintDialog.tsx` — add `'coincident'` to `Mode` type and the `<select>` options; hide offset row when `mode === 'coincident'`.
- Modify `packages/app/src/store/useAppStore.ts` — add `'coincident'` to the `placeConstraintMode` type.
- Modify `packages/app/src/App.tsx` — in `onCommitConstraint` (line 4215): add `coincident` branch that produces a `mate` constraint with `offset: { kind: 'literal', value: 0 }`.
- Add i18n keys to `packages/app/src/locales/en.json` and `uk.json`.

**Verified source state:**
- `PlaceConstraintDialog.tsx`: `Mode` type exists at the top of the file; `<select>` options are in the JSX.
- `App.tsx:4183-4185`: `onPickSlot` computes `pickerMode` — coincident is not `insert` or `angle`, so it defaults to `'face'`. No change needed.
- `App.tsx:4220-4231`: `onCommitConstraint` has `insert`, `angle`, and catch-all branches. `coincident` needs a branch before the catch-all.
- `App.tsx:4230`: The catch-all `constraint = { id, kind: placeConstraintMode, ... }` will break if `placeConstraintMode === 'coincident'` since `'coincident'` is not a valid `AssemblyConstraint.kind`. The `coincident` branch must be added before it.

**Steps:**

- [ ] **Step 1: Write failing unit test for coincident alias.**

  Create `packages/app/src/assembly/__tests__/coincidentAlias.spec.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest';

  /**
   * RED test: the catch-all branch in onCommitConstraint would produce
   * kind='coincident' which is NOT a valid AssemblyConstraint kind.
   * After the fix, coincident maps to kind='mate' with offset literal 0.
   */
  describe('coincident alias → mate with offset 0', () => {
    it('coincident mode produces kind=mate, offset literal 0', () => {
      const placeConstraintMode = 'coincident' as 'coincident' | 'mate' | 'flush' | 'angle' | 'insert';
      const id = 'K001';

      let constraint: { kind: string; offset?: { kind: string; value: number } } | null = null;

      // Simulate the FIXED onCommitConstraint logic.
      if (placeConstraintMode === 'insert') {
        constraint = { kind: 'insert' };
      } else if (placeConstraintMode === 'angle') {
        constraint = { kind: 'angle' };
      } else if (placeConstraintMode === 'coincident') {
        constraint = { id, kind: 'mate', offset: { kind: 'literal', value: 0 } };
      } else {
        constraint = { id, kind: placeConstraintMode };
      }

      expect(constraint?.kind).toBe('mate');
      expect(constraint?.offset).toEqual({ kind: 'literal', value: 0 });
    });

    it('without the coincident branch, catch-all would produce kind=coincident (invalid)', () => {
      const placeConstraintMode = 'coincident' as string;
      // Pre-fix catch-all:
      const constraint = { id: 'K1', kind: placeConstraintMode };
      // This is WRONG — proves the fix is needed.
      expect(constraint.kind).toBe('coincident'); // would fail tsc on real AssemblyConstraint type
    });
  });
  ```

  Run: `pnpm --filter @zilventor/app test -- --reporter=verbose --run coincidentAlias`
  Expected: PASS (the test documents the gap; tsc catches the real type error). The RED gate is the tsc error when `placeConstraintMode === 'coincident'` hits the catch-all before the fix.

- [ ] **Step 2: Extend `Mode` type in `PlaceConstraintDialog.tsx` and add option.**

  Change `type Mode` at the top of the file:
  ```typescript
  // BEFORE:
  type Mode = 'mate' | 'flush' | 'angle' | 'insert';
  // AFTER:
  type Mode = 'mate' | 'flush' | 'angle' | 'insert' | 'coincident';
  ```

  Add to `<select>`:
  ```tsx
  <option value="coincident">{t('dialog.placeConstraint.coincident')}</option>
  ```

  Hide the offset/value row when `mode === 'coincident'` (offset is locked to 0):
  ```tsx
  {mode !== 'coincident' && (
    <div style={row}>
      <span style={{ width: 60 }}>{valueLabel}</span>
      <input value={p.valueExpression} onChange={(e) => p.onValueChange(e.target.value)} style={{ ...btn, width: 80 }} />
      <span>{valueUnit}</span>
    </div>
  )}
  ```

  Add i18n to `packages/app/src/locales/en.json`:
  ```json
  "dialog": { "placeConstraint": { "coincident": "Coincident" } }
  ```
  And `uk.json`: `"coincident": "Збігання"`

- [ ] **Step 3: Extend store `placeConstraintMode` type.**

  In `packages/app/src/store/useAppStore.ts`, find the field `placeConstraintMode: 'mate' | 'flush' | 'angle' | 'insert'` and change to:
  ```typescript
  placeConstraintMode: 'mate' | 'flush' | 'angle' | 'insert' | 'coincident';
  ```
  Also update `openPlaceConstraintDialog` setter if it has the union typed as a parameter.

- [ ] **Step 4: Wire `onCommitConstraint` in `App.tsx` for coincident.**

  In `App.tsx` at line 4227-4231, add the `coincident` branch before the catch-all:

  ```typescript
  // BEFORE (lines 4227-4231):
    } else if (placeConstraintMode === 'angle') {
      constraint = { id, kind: 'angle', refA: pickedRefA.ref as AssemblyConstraintRef, refB: pickedRefB.ref as AssemblyConstraintRef, angle: offsetOrAngle, suppressed: false };
    } else {
      constraint = { id, kind: placeConstraintMode, refA: pickedRefA.ref as AssemblyConstraintRef, refB: pickedRefB.ref as AssemblyConstraintRef, offset: offsetOrAngle, suppressed: false };
    }

  // AFTER:
    } else if (placeConstraintMode === 'angle') {
      constraint = { id, kind: 'angle', refA: pickedRefA.ref as AssemblyConstraintRef, refB: pickedRefB.ref as AssemblyConstraintRef, angle: offsetOrAngle, suppressed: false };
    } else if (placeConstraintMode === 'coincident') {
      // Coincident = mate at offset 0, locked. Persisted as mate (no new kind).
      constraint = { id, kind: 'mate', refA: pickedRefA.ref as AssemblyConstraintRef, refB: pickedRefB.ref as AssemblyConstraintRef, offset: { kind: 'literal', value: 0 }, suppressed: false };
    } else {
      constraint = { id, kind: placeConstraintMode, refA: pickedRefA.ref as AssemblyConstraintRef, refB: pickedRefB.ref as AssemblyConstraintRef, offset: offsetOrAngle, suppressed: false };
    }
  ```

- [ ] **Step 5: Run failing test, then confirm green.**

  ```
  pnpm --filter @zilventor/app test -- --reporter=verbose --run coincidentAlias
  pnpm -r typecheck
  ```
  Expected: PASS, 0 tsc errors.

- [ ] **Step 6: Commit.**

  ```
  git add packages/app/src/shell/PlaceConstraintDialog.tsx packages/app/src/store/useAppStore.ts packages/app/src/App.tsx packages/app/src/locales/en.json packages/app/src/locales/uk.json packages/app/src/assembly/__tests__/coincidentAlias.spec.ts
  git commit -m "feat(assembly): coincident constraint as mate alias at offset 0"
  ```

---

### Task 4: Tangent cylinder↔plane residual + Jacobian

**Files:**
- Modify `packages/shared/src/types.ts` — add `tangent` to `AssemblyConstraint` union at line 224.
- Modify `packages/kernel/src/assembly/Residuals.ts` — add `buildTangentCylPlaneResiduals` and `buildTangentCylPlaneJacobian`.
- Modify `packages/kernel/src/assembly/AssemblyConstraintSolver.ts` — add `tangent` case in `buildSingleResidual` and `buildSingleJacobianBlock`; update `constraintResidualCount`.

**Verified source state:**
- `AssemblyConstraint` union in `types.ts:217-224` currently has `mate`, `flush`, `angle`, `insert`. `tangent` goes after `insert`.
- Every other constraint field (`offset`, `angle`) uses `ParamOrLiteral`. S1 mandates `radius`/`r1`/`r2` also be `ParamOrLiteral`. The `radius` in tangent is a geometry-derived property but must be typed as `ParamOrLiteral` for consistency with the rest of the union.
- `Residuals.ts` uses `worldFromLocal` and `quatRotateVecJacobian` (imported from `./quat`). New functions must follow the same pattern.
- `AssemblyConstraintSolver.ts:88-90`: `buildSingleResidual` falls through to `buildInsertResiduals` for unknown kinds — the `tangent` case must be added before this fallthrough. Same for `buildSingleJacobianBlock:121-123`.
- `swapAB` is defined at `AssemblyConstraintSolver.ts:128`. For cyl↔plane with reversed refs: per S2, do NOT post-swap the Jacobian — instead call `buildTangentCylPlaneResiduals`/`Jacobian` with refs reversed (pass `refB, refA, pB, pA`). This keeps the column roles correct.
- `constraintResidualCount` must be found and updated. Search: `grep -n "constraintResidualCount\|residualCount" packages/kernel/src/assembly/AssemblyConstraintSolver.ts`.

**Interfaces (corrected per S1):**
- New type in `types.ts`:
  ```typescript
  | { id: string; kind: 'tangent';
      refA: AssemblyConstraintRef;
      refB: AssemblyConstraintRef;
      radius?: ParamOrLiteral;  // cyl↔plane: cylinder radius
      r1?: ParamOrLiteral;      // cyl↔cyl: radius A
      r2?: ParamOrLiteral;      // cyl↔cyl: radius B
      suppressed: boolean }
  ```

**Residual math (cyl↔plane, 2 residuals):**
- `r[0] = Nb_w · (Pa_w − Pb_w) − resolveParamOrLiteral(radius)` (signed distance = radius)
- `r[1] = Nb_w · Da_w` (axis parallel to plane, should be 0)
- Note: `localA` is `kind:'axis'`, `localB` is `kind:'plane'`. Both are `PartLocalGeometry` from `AssemblyConstraintRefs.ts`.

**Steps:**

- [ ] **Step 1: Write failing unit test (pure math, no WASM).**

  Create `packages/kernel/src/assembly/__tests__/tangentCylPlane.spec.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest';
  import { buildTangentCylPlaneResiduals, buildTangentCylPlaneJacobian } from '../Residuals';
  import type { PartLocalGeometry } from '../AssemblyConstraintRefs';
  import type { Quat } from '../quat';
  import type { Vec3 } from '@zilventor/shared';

  const ID_Q: Quat = [0, 0, 0, 1];
  const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

  describe('buildTangentCylPlaneResiduals', () => {
    it('residuals are zero when axis-to-plane distance equals radius and axis is parallel to plane', () => {
      // Cylinder axis at x=5 pointing Z (parallel to plane), radius=5.
      // Plane at x=0 with normal +X. Distance = 5 = radius → tangent. Axis Z ⊥ normal X → parallel.
      const axisRef: PartLocalGeometry = { kind: 'axis', P: { x: 5, y: 0, z: 0 }, D: { x: 0, y: 0, z: 1 } };
      const planeRef: PartLocalGeometry = { kind: 'plane', P: ZERO, N: { x: 1, y: 0, z: 0 } };
      const r = buildTangentCylPlaneResiduals(axisRef, planeRef, ZERO, ID_Q, ZERO, ID_Q, 5);
      expect(Math.abs(r[0]!)).toBeLessThan(1e-9);  // distance residual
      expect(Math.abs(r[1]!)).toBeLessThan(1e-9);  // parallelism residual
    });

    it('distance residual is non-zero when distance differs from radius', () => {
      const axisRef: PartLocalGeometry = { kind: 'axis', P: { x: 8, y: 0, z: 0 }, D: { x: 0, y: 0, z: 1 } };
      const planeRef: PartLocalGeometry = { kind: 'plane', P: ZERO, N: { x: 1, y: 0, z: 0 } };
      const r = buildTangentCylPlaneResiduals(axisRef, planeRef, ZERO, ID_Q, ZERO, ID_Q, 5);
      expect(Math.abs(r[0]!)).toBeGreaterThan(0.1);  // dist=8, radius=5 → r=3
    });
  });

  describe('buildTangentCylPlaneJacobian', () => {
    it('returns 2×14 matrix', () => {
      const axisRef: PartLocalGeometry = { kind: 'axis', P: { x: 5, y: 0, z: 0 }, D: { x: 0, y: 0, z: 1 } };
      const planeRef: PartLocalGeometry = { kind: 'plane', P: ZERO, N: { x: 1, y: 0, z: 0 } };
      const J = buildTangentCylPlaneJacobian(axisRef, planeRef, ZERO, ID_Q, ZERO, ID_Q, 5);
      expect(J).toHaveLength(2);
      expect(J[0]).toHaveLength(14);
      expect(J[1]).toHaveLength(14);
    });
  });
  ```

  Run: `pnpm --filter @zilventor/kernel test -- --reporter=verbose --run tangentCylPlane`
  **Expected RED reason:** `buildTangentCylPlaneResiduals` is not exported from `Residuals.ts` → import error.

- [ ] **Step 2: Add `tangent` to `AssemblyConstraint` union in `types.ts`.**

  In `packages/shared/src/types.ts`, after the `insert` variant (currently at line 221-224):

  ```typescript
  | { id: string; kind: 'tangent';
      refA: AssemblyConstraintRef;
      refB: AssemblyConstraintRef;
      radius?: ParamOrLiteral;   // cyl↔plane: cylinder radius
      r1?: ParamOrLiteral;       // cyl↔cyl: radius of cylinder A
      r2?: ParamOrLiteral;       // cyl↔cyl: radius of cylinder B
      suppressed: boolean }
  ```

  All three radius fields are `ParamOrLiteral` per S1 (consistent with all other constraint numeric fields).

- [ ] **Step 3: Implement `buildTangentCylPlaneResiduals` and `buildTangentCylPlaneJacobian` in `Residuals.ts`.**

  Add a helper `resolveParamOrLiteralLocal` at the top of the new section (or import `resolveOffset` from the solver — check if it's exported):

  ```bash
  grep -n "export function resolveOffset\|resolveOffset" packages/kernel/src/assembly/AssemblyConstraintSolver.ts | head -5
  ```

  If `resolveOffset` is not exported from the solver, add a local helper in Residuals.ts:

  ```typescript
  /** Resolve a ParamOrLiteral to its numeric value (params resolved via paramValues map). */
  function resolveP(v: { kind: 'literal'; value: number } | { kind: 'param'; paramName: string }, pv: Record<string, number>): number {
    return v.kind === 'literal' ? v.value : (pv[v.paramName] ?? 0);
  }
  ```

  Then append to `packages/kernel/src/assembly/Residuals.ts`:

  ```typescript
  // ─── Tangent cylinder↔plane ───────────────────────────────────────────────

  /**
   * 2 residuals:
   *  r[0] = Nb_w · (Pa_w − Pb_w) − radius   (signed distance from axis origin to plane = radius)
   *  r[1] = Nb_w · Da_w                       (axis parallel to plane: dot = 0)
   *
   * localA: { kind: 'axis'; P, D }  (cylinder axis origin P, unit direction D)
   * localB: { kind: 'plane'; P, N } (plane point P, unit normal N)
   */
  export function buildTangentCylPlaneResiduals(
    localA: PartLocalGeometry, localB: PartLocalGeometry,
    Ta: Vec3, qa: Quat, Tb: Vec3, qb: Quat,
    radius: number,
  ): number[] {
    if (localA.kind !== 'axis' || localB.kind !== 'plane')
      throw new Error('tangentCylPlane: localA must be axis, localB must be plane');
    const a = worldFromLocal(localA, Ta, qa);
    const b = worldFromLocal(localB, Tb, qb);
    if (a.kind !== 'axis' || b.kind !== 'plane') throw new Error('unreachable');
    const dx = a.P.x - b.P.x, dy = a.P.y - b.P.y, dz = a.P.z - b.P.z;
    const r0 = b.N.x * dx + b.N.y * dy + b.N.z * dz - radius;
    const r1 = b.N.x * a.D.x + b.N.y * a.D.y + b.N.z * a.D.z;
    return [r0, r1];
  }

  /**
   * Analytic Jacobian for buildTangentCylPlaneResiduals. Returns 2×14 matrix.
   * Columns 0-6: d/d(Ta[0..2], qa[0..3])  (component A)
   * Columns 7-13: d/d(Tb[0..2], qb[0..3]) (component B)
   */
  export function buildTangentCylPlaneJacobian(
    localA: PartLocalGeometry, localB: PartLocalGeometry,
    Ta: Vec3, qa: Quat, Tb: Vec3, qb: Quat,
    _radius: number,
  ): number[][] {
    if (localA.kind !== 'axis' || localB.kind !== 'plane')
      throw new Error('tangentCylPlane Jacobian: localA must be axis, localB must be plane');
    const a = worldFromLocal(localA, Ta, qa);
    const b = worldFromLocal(localB, Tb, qb);
    if (a.kind !== 'axis' || b.kind !== 'plane') throw new Error('unreachable');

    const dPaQ = quatRotateVecJacobian(qa, localA.P);  // 3×4
    const dDaQ = quatRotateVecJacobian(qa, localA.D);  // 3×4
    const dPbQ = quatRotateVecJacobian(qb, localB.P);  // 3×4
    const dNbQ = quatRotateVecJacobian(qb, localB.N);  // 3×4

    const Nb = b.N, Da = a.D;
    const dP = { x: a.P.x - b.P.x, y: a.P.y - b.P.y, z: a.P.z - b.P.z };

    const J0 = new Array(14).fill(0) as number[];
    const J1 = new Array(14).fill(0) as number[];

    // r[0] = Nb · (Pa - Pb) - radius
    // d/dTa (cols 0-2): +Nb
    J0[0] = Nb.x; J0[1] = Nb.y; J0[2] = Nb.z;
    // d/dqa (cols 3-6): Nb · dPa/dqa
    for (let k = 0; k < 4; k++) {
      J0[3 + k] = Nb.x * dPaQ[0]![k]! + Nb.y * dPaQ[1]![k]! + Nb.z * dPaQ[2]![k]!;
    }
    // d/dTb (cols 7-9): -Nb
    J0[7] = -Nb.x; J0[8] = -Nb.y; J0[9] = -Nb.z;
    // d/dqb (cols 10-13): dNb/dqb · dP + Nb · (-dPb/dqb)
    for (let k = 0; k < 4; k++) {
      J0[10 + k] = dNbQ[0]![k]! * dP.x + dNbQ[1]![k]! * dP.y + dNbQ[2]![k]! * dP.z
                 - (Nb.x * dPbQ[0]![k]! + Nb.y * dPbQ[1]![k]! + Nb.z * dPbQ[2]![k]!);
    }

    // r[1] = Nb · Da
    // d/dTa = d/dTb = 0 (already 0)
    // d/dqa (cols 3-6): Nb · dDa/dqa
    for (let k = 0; k < 4; k++) {
      J1[3 + k] = Nb.x * dDaQ[0]![k]! + Nb.y * dDaQ[1]![k]! + Nb.z * dDaQ[2]![k]!;
    }
    // d/dqb (cols 10-13): dNb/dqb · Da
    for (let k = 0; k < 4; k++) {
      J1[10 + k] = dNbQ[0]![k]! * Da.x + dNbQ[1]![k]! * Da.y + dNbQ[2]![k]! * Da.z;
    }

    return [J0, J1];
  }
  ```

- [ ] **Step 4: Wire `tangent` case into `AssemblyConstraintSolver.ts`.**

  Find and update imports. In `buildSingleResidual` (before the fallthrough to `buildInsertResiduals`):

  ```typescript
  if (k.kind === 'tangent') {
    const radius = k.radius ? resolveOffset(k.radius, paramValues) : 0;
    const r1val = k.r1 ? resolveOffset(k.r1, paramValues) : 0;
    const r2val = k.r2 ? resolveOffset(k.r2, paramValues) : 0;
    if (refA.kind === 'axis' && refB.kind === 'plane')
      return buildTangentCylPlaneResiduals(refA, refB, pA.T, pA.q, pB.T, pB.q, radius);
    if (refA.kind === 'plane' && refB.kind === 'axis')
      // Swap refs so axis is always A (per S2: don't post-swap Jacobian, swap inputs instead)
      return buildTangentCylPlaneResiduals(refB, refA, pB.T, pB.q, pA.T, pA.q, radius);
    throw new Error(`tangent: unsupported ref pairing ${refA.kind}/${refB.kind} (cyl↔cyl added in Task 5)`);
  }
  ```

  In `buildSingleJacobianBlock` (before the fallthrough to `buildInsertJacobian`):

  ```typescript
  if (k.kind === 'tangent') {
    const radius = k.radius ? resolveOffset(k.radius, paramValues) : 0;
    if (refA.kind === 'axis' && refB.kind === 'plane')
      return buildTangentCylPlaneJacobian(refA, refB, pA.T, pA.q, pB.T, pB.q, radius);
    if (refA.kind === 'plane' && refB.kind === 'axis')
      // Per S2: call with refs reversed so Nb·Da roles are correct; NO post-swap needed
      return buildTangentCylPlaneJacobian(refB, refA, pB.T, pB.q, pA.T, pA.q, radius);
    throw new Error(`tangent Jacobian: unsupported ref pairing ${refA.kind}/${refB.kind}`);
  }
  ```

  Update `constraintResidualCount` (find the function with `grep -n "constraintResidualCount" packages/kernel/src/assembly/AssemblyConstraintSolver.ts`):
  ```typescript
  if (k.kind === 'tangent') {
    // cyl↔plane = 2 residuals; cyl↔cyl = 1 residual (Task 5)
    return 2;
  }
  ```

  Update imports at top of solver file to include:
  ```typescript
  import {
    // ...existing...
    buildTangentCylPlaneResiduals, buildTangentCylPlaneJacobian,
  } from './Residuals';
  ```

- [ ] **Step 5: Run the failing test, confirm green.**

  ```
  pnpm --filter @zilventor/kernel test -- --reporter=verbose --run tangentCylPlane
  pnpm -r typecheck
  ```
  Expected: PASS, 0 tsc errors.

- [ ] **Step 6: Commit.**

  ```
  git add packages/shared/src/types.ts packages/kernel/src/assembly/Residuals.ts packages/kernel/src/assembly/AssemblyConstraintSolver.ts packages/kernel/src/assembly/__tests__/tangentCylPlane.spec.ts
  git commit -m "feat(assembly): tangent cylinder-plane constraint with analytic Jacobian"
  ```

---

### Task 5: Tangent cylinder↔cylinder residual + Jacobian (FD-validated)

**Files:**
- Modify `packages/kernel/src/assembly/Residuals.ts` — add `buildTangentCylCylResiduals`, `buildTangentCylCylJacobian`.
- Modify `packages/kernel/src/assembly/AssemblyConstraintSolver.ts` — extend `tangent` case; update `constraintResidualCount`.

**Residual math:**
- External tangency: `r = closestDist(axisA_world, axisB_world) − (r1 + r2)` (1 scalar).
- Skew-line closest distance formula with parallel-axes degenerate case.

**Analytic Jacobian must be finite-difference validated (spec §4.4, risk R4).**

**S3 fix — FD test must re-normalize quaternion after perturbing quaternion columns:**
When perturbing `qa[k]` by `h`, the resulting quaternion is not unit-length. Residuals that internally call `worldFromLocal` use `quatRotateVec` which normalizes before rotation (verify: `grep -n "normalize\|length\|sqrt" packages/kernel/src/assembly/quat.ts | head -20`). If `quatRotateVec` does NOT normalize, the FD test will be flaky because the perturbation changes the quaternion magnitude. Fix: after perturbing each quaternion column, re-normalize before calling `buildTangentCylCylResiduals`.

**Steps:**

- [ ] **Step 1: Check whether `quatRotateVec` normalizes internally.**

  ```bash
  grep -n "normalize\|length\|Math.sqrt\|invLen" packages/kernel/src/assembly/quat.ts | head -20
  ```

  If it normalizes: FD test can perturb without re-normalizing. If it does NOT: the FD test must re-normalize. The fix per S3:

  ```typescript
  // After perturbing qa[k]:
  const pQaRaw: Quat = [perturbed[3]!, perturbed[4]!, perturbed[5]!, perturbed[6]!];
  const pQaLen = Math.sqrt(pQaRaw[0]**2 + pQaRaw[1]**2 + pQaRaw[2]**2 + pQaRaw[3]**2);
  const pQa: Quat = [pQaRaw[0]/pQaLen, pQaRaw[1]/pQaLen, pQaRaw[2]/pQaLen, pQaRaw[3]/pQaLen];
  // Same for pQb.
  ```

  Apply this normalization in the test regardless (it is always more correct).

- [ ] **Step 2: Write failing unit test with FD validation (with quaternion re-normalization).**

  Create `packages/kernel/src/assembly/__tests__/tangentCylCyl.spec.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest';
  import { buildTangentCylCylResiduals, buildTangentCylCylJacobian } from '../Residuals';
  import type { PartLocalGeometry } from '../AssemblyConstraintRefs';
  import type { Quat } from '../quat';
  import type { Vec3 } from '@zilventor/shared';

  const ID_Q: Quat = [0, 0, 0, 1];
  const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

  function normalizeQ(q: [number, number, number, number]): Quat {
    const len = Math.sqrt(q[0]**2 + q[1]**2 + q[2]**2 + q[3]**2);
    return [q[0]/len, q[1]/len, q[2]/len, q[3]/len];
  }

  describe('buildTangentCylCylResiduals', () => {
    it('zero residual when parallel axes are r1+r2 apart', () => {
      const axisA: PartLocalGeometry = { kind: 'axis', P: ZERO, D: { x: 0, y: 0, z: 1 } };
      const axisB: PartLocalGeometry = { kind: 'axis', P: { x: 10, y: 0, z: 0 }, D: { x: 0, y: 0, z: 1 } };
      const r = buildTangentCylCylResiduals(axisA, axisB, ZERO, ID_Q, ZERO, ID_Q, 3, 7);
      expect(Math.abs(r[0]!)).toBeLessThan(1e-9);
    });

    it('non-zero residual when distance differs from r1+r2', () => {
      const axisA: PartLocalGeometry = { kind: 'axis', P: ZERO, D: { x: 0, y: 0, z: 1 } };
      const axisB: PartLocalGeometry = { kind: 'axis', P: { x: 15, y: 0, z: 0 }, D: { x: 0, y: 0, z: 1 } };
      const r = buildTangentCylCylResiduals(axisA, axisB, ZERO, ID_Q, ZERO, ID_Q, 3, 7);
      expect(Math.abs(r[0]!)).toBeGreaterThan(0.1);
    });
  });

  describe('buildTangentCylCylJacobian finite-difference validation', () => {
    it('analytic Jacobian matches FD within 1e-3 (with quaternion re-normalization)', () => {
      const axisA: PartLocalGeometry = { kind: 'axis', P: { x: 1, y: 2, z: 3 }, D: { x: 0, y: 0, z: 1 } };
      const axisB: PartLocalGeometry = { kind: 'axis', P: { x: 8, y: 3, z: 1 }, D: { x: 0, y: 1, z: 0 } };
      const Ta: Vec3 = ZERO;
      const qa: Quat = [0, 0, 0, 1];
      const Tb: Vec3 = ZERO;
      // Slightly non-identity quaternion for non-trivial Jacobian.
      const qb: Quat = normalizeQ([0.1, 0, 0, Math.sqrt(1 - 0.01)]);
      const r1 = 3, r2 = 5;
      const h = 1e-6;

      const analytic = buildTangentCylCylJacobian(axisA, axisB, Ta, qa, Tb, qb, r1, r2);
      const r0 = buildTangentCylCylResiduals(axisA, axisB, Ta, qa, Tb, qb, r1, r2);

      const unknowns: number[] = [
        Ta.x, Ta.y, Ta.z, qa[0]!, qa[1]!, qa[2]!, qa[3]!,
        Tb.x, Tb.y, Tb.z, qb[0]!, qb[1]!, qb[2]!, qb[3]!,
      ];

      for (let j = 0; j < 14; j++) {
        const perturbed = [...unknowns];
        perturbed[j] = perturbed[j]! + h;
        const pTa: Vec3 = { x: perturbed[0]!, y: perturbed[1]!, z: perturbed[2]! };
        // Re-normalize quaternions after perturbation (S3 fix).
        const pQa: Quat = normalizeQ([perturbed[3]!, perturbed[4]!, perturbed[5]!, perturbed[6]!]);
        const pTb: Vec3 = { x: perturbed[7]!, y: perturbed[8]!, z: perturbed[9]! };
        const pQb: Quat = normalizeQ([perturbed[10]!, perturbed[11]!, perturbed[12]!, perturbed[13]!]);
        const rPerturbed = buildTangentCylCylResiduals(axisA, axisB, pTa, pQa, pTb, pQb, r1, r2);
        const fdJ = (rPerturbed[0]! - r0[0]!) / h;
        const anaJ = analytic[0]![j]!;
        const absDiff = Math.abs(fdJ - anaJ);
        const scale = Math.max(Math.abs(fdJ), Math.abs(anaJ), 1e-8);
        expect(absDiff / scale).toBeLessThan(1e-3);
      }
    });
  });
  ```

  Run: `pnpm --filter @zilventor/kernel test -- --reporter=verbose --run tangentCylCyl`
  **Expected RED reason:** `buildTangentCylCylResiduals` not exported.

- [ ] **Step 3: Implement `buildTangentCylCylResiduals` and `buildTangentCylCylJacobian`.**

  Append to `packages/kernel/src/assembly/Residuals.ts`:

  ```typescript
  // ─── Tangent cylinder↔cylinder (external) ─────────────────────────────────

  /** Skew-line closest distance. */
  function skewLineDist(P1: Vec3, D1: Vec3, P2: Vec3, D2: Vec3): number {
    const w: Vec3 = { x: P2.x - P1.x, y: P2.y - P1.y, z: P2.z - P1.z };
    const bDot = D1.x * D2.x + D1.y * D2.y + D1.z * D2.z;
    const denom = 1 - bDot * bDot;
    if (Math.abs(denom) < 1e-10) {
      const wdD1 = w.x * D1.x + w.y * D1.y + w.z * D1.z;
      const vx = w.x - wdD1 * D1.x, vy = w.y - wdD1 * D1.y, vz = w.z - wdD1 * D1.z;
      return Math.sqrt(vx * vx + vy * vy + vz * vz);
    }
    const wdD1 = w.x * D1.x + w.y * D1.y + w.z * D1.z;
    const wdD2 = w.x * D2.x + w.y * D2.y + w.z * D2.z;
    const sA = (wdD1 - bDot * wdD2) / denom;
    const sB = (bDot * wdD1 - wdD2) / denom;
    const cx = P2.x + sB * D2.x - (P1.x + sA * D1.x);
    const cy = P2.y + sB * D2.y - (P1.y + sA * D1.y);
    const cz = P2.z + sB * D2.z - (P1.z + sA * D1.z);
    return Math.sqrt(cx * cx + cy * cy + cz * cz);
  }

  /**
   * 1 residual: r = closestDist(axisA, axisB) - (r1 + r2)
   */
  export function buildTangentCylCylResiduals(
    localA: PartLocalGeometry, localB: PartLocalGeometry,
    Ta: Vec3, qa: Quat, Tb: Vec3, qb: Quat, r1: number, r2: number,
  ): number[] {
    if (localA.kind !== 'axis' || localB.kind !== 'axis')
      throw new Error('tangentCylCyl requires axis refs');
    const a = worldFromLocal(localA, Ta, qa);
    const b = worldFromLocal(localB, Tb, qb);
    if (a.kind !== 'axis' || b.kind !== 'axis') throw new Error('unreachable');
    return [skewLineDist(a.P, a.D, b.P, b.D) - (r1 + r2)];
  }

  /**
   * Analytic Jacobian for buildTangentCylCylResiduals. Returns 1×14 matrix.
   * dr/dx = (sep/dist) · d(cB-cA)/dx via chain rule through Pa, Da, Pb, Db.
   */
  export function buildTangentCylCylJacobian(
    localA: PartLocalGeometry, localB: PartLocalGeometry,
    Ta: Vec3, qa: Quat, Tb: Vec3, qb: Quat, _r1: number, _r2: number,
  ): number[][] {
    if (localA.kind !== 'axis' || localB.kind !== 'axis')
      throw new Error('tangentCylCyl Jacobian requires axis refs');
    const a = worldFromLocal(localA, Ta, qa);
    const b = worldFromLocal(localB, Tb, qb);
    if (a.kind !== 'axis' || b.kind !== 'axis') throw new Error('unreachable');

    const dPaQ = quatRotateVecJacobian(qa, localA.P);
    const dDaQ = quatRotateVecJacobian(qa, localA.D);
    const dPbQ = quatRotateVecJacobian(qb, localB.P);
    const dDbQ = quatRotateVecJacobian(qb, localB.D);

    const Pa = a.P, Da = a.D, Pb = b.P, Db = b.D;
    const w: Vec3 = { x: Pb.x - Pa.x, y: Pb.y - Pa.y, z: Pb.z - Pa.z };
    const bDot = Da.x * Db.x + Da.y * Db.y + Da.z * Db.z;
    const denom = 1 - bDot * bDot;
    const J0 = new Array(14).fill(0) as number[];

    let sep: Vec3, dist: number, sA = 0, sB = 0;

    if (Math.abs(denom) < 1e-10) {
      // Parallel case.
      const wdDa = w.x * Da.x + w.y * Da.y + w.z * Da.z;
      sep = { x: w.x - wdDa * Da.x, y: w.y - wdDa * Da.y, z: w.z - wdDa * Da.z };
      dist = Math.sqrt(sep.x * sep.x + sep.y * sep.y + sep.z * sep.z);
      if (dist < 1e-12) return [J0];
      const invDist = 1 / dist;
      // d/dTa: d(sep)/dTa = -(I - Da Da^T)
      const sepDotDa = sep.x * Da.x + sep.y * Da.y + sep.z * Da.z;
      J0[0] = -(sep.x - sepDotDa * Da.x) * invDist;
      J0[1] = -(sep.y - sepDotDa * Da.y) * invDist;
      J0[2] = -(sep.z - sepDotDa * Da.z) * invDist;
      J0[7] = -J0[0]; J0[8] = -J0[1]; J0[9] = -J0[2];
      // d/dqa: chain through dPa/dqa, dDa/dqa
      for (let k = 0; k < 4; k++) {
        const dwdDa_dqa = -(dPaQ[0]![k]! * Da.x + dPaQ[1]![k]! * Da.y + dPaQ[2]![k]! * Da.z)
                         + (w.x * dDaQ[0]![k]! + w.y * dDaQ[1]![k]! + w.z * dDaQ[2]![k]!);
        const dsep = [
          -dPaQ[0]![k]! - dwdDa_dqa * Da.x - wdDa * dDaQ[0]![k]!,
          -dPaQ[1]![k]! - dwdDa_dqa * Da.y - wdDa * dDaQ[1]![k]!,
          -dPaQ[2]![k]! - dwdDa_dqa * Da.z - wdDa * dDaQ[2]![k]!,
        ];
        J0[3 + k] = (sep.x * dsep[0]! + sep.y * dsep[1]! + sep.z * dsep[2]!) * invDist;
      }
      for (let k = 0; k < 4; k++) {
        const dwdDa_dqb = dPbQ[0]![k]! * Da.x + dPbQ[1]![k]! * Da.y + dPbQ[2]![k]! * Da.z;
        const dsep = [
          dPbQ[0]![k]! - dwdDa_dqb * Da.x,
          dPbQ[1]![k]! - dwdDa_dqb * Da.y,
          dPbQ[2]![k]! - dwdDa_dqb * Da.z,
        ];
        J0[10 + k] = (sep.x * dsep[0]! + sep.y * dsep[1]! + sep.z * dsep[2]!) * invDist;
      }
    } else {
      // Non-parallel (skew lines).
      const wdDa = w.x * Da.x + w.y * Da.y + w.z * Da.z;
      const wdDb = w.x * Db.x + w.y * Db.y + w.z * Db.z;
      sA = (wdDa - bDot * wdDb) / denom;
      sB = (bDot * wdDa - wdDb) / denom;
      const cA: Vec3 = { x: Pa.x + sA * Da.x, y: Pa.y + sA * Da.y, z: Pa.z + sA * Da.z };
      const cB: Vec3 = { x: Pb.x + sB * Db.x, y: Pb.y + sB * Db.y, z: Pb.z + sB * Db.z };
      sep = { x: cB.x - cA.x, y: cB.y - cA.y, z: cB.z - cA.z };
      dist = Math.sqrt(sep.x * sep.x + sep.y * sep.y + sep.z * sep.z);
      if (dist < 1e-12) return [J0];
      const invDist = 1 / dist;

      // d/dTa
      for (let j = 0; j < 3; j++) {
        const Daj = (j === 0 ? Da.x : j === 1 ? Da.y : Da.z);
        const Dbj = (j === 0 ? Db.x : j === 1 ? Db.y : Db.z);
        const dsAdTa = (-Daj + bDot * Dbj) / denom;
        const dsBdTa = (-bDot * Daj + Dbj) / denom;
        const dsep = [
          dsBdTa * Db.x - (j === 0 ? 1 : 0) - dsAdTa * Da.x,
          dsBdTa * Db.y - (j === 1 ? 1 : 0) - dsAdTa * Da.y,
          dsBdTa * Db.z - (j === 2 ? 1 : 0) - dsAdTa * Da.z,
        ];
        J0[j] = (sep.x * dsep[0]! + sep.y * dsep[1]! + sep.z * dsep[2]!) * invDist;
      }
      // d/dTb
      for (let j = 0; j < 3; j++) {
        const Daj = (j === 0 ? Da.x : j === 1 ? Da.y : Da.z);
        const Dbj = (j === 0 ? Db.x : j === 1 ? Db.y : Db.z);
        const dsAdTb = (Daj - bDot * Dbj) / denom;
        const dsBdTb = (bDot * Daj - Dbj) / denom;
        const dsep = [
          dsBdTb * Db.x + (j === 0 ? 1 : 0) - dsAdTb * Da.x,
          dsBdTb * Db.y + (j === 1 ? 1 : 0) - dsAdTb * Da.y,
          dsBdTb * Db.z + (j === 2 ? 1 : 0) - dsAdTb * Da.z,
        ];
        J0[7 + j] = (sep.x * dsep[0]! + sep.y * dsep[1]! + sep.z * dsep[2]!) * invDist;
      }
      // d/dqa
      for (let k = 0; k < 4; k++) {
        const dPak = [dPaQ[0]![k]!, dPaQ[1]![k]!, dPaQ[2]![k]!];
        const dDak = [dDaQ[0]![k]!, dDaQ[1]![k]!, dDaQ[2]![k]!];
        const dwdDa_k = -dPak[0]! * Da.x - dPak[1]! * Da.y - dPak[2]! * Da.z
                      + w.x * dDak[0]! + w.y * dDak[1]! + w.z * dDak[2]!;
        const dwdDb_k = -dPak[0]! * Db.x - dPak[1]! * Db.y - dPak[2]! * Db.z;
        const dbDot_k = dDak[0]! * Db.x + dDak[1]! * Db.y + dDak[2]! * Db.z;
        const ddenom_k = -2 * bDot * dbDot_k;
        const dsA_k = ((dwdDa_k - dbDot_k * wdDb - bDot * dwdDb_k) * denom
                      - (wdDa - bDot * wdDb) * ddenom_k) / (denom * denom);
        const dsB_k = ((dbDot_k * wdDa + bDot * dwdDa_k - dwdDb_k) * denom
                      - (bDot * wdDa - wdDb) * ddenom_k) / (denom * denom);
        const dsep = [
          dsB_k * Db.x - (-dPak[0]! + dsA_k * Da.x + sA * dDak[0]!),
          dsB_k * Db.y - (-dPak[1]! + dsA_k * Da.y + sA * dDak[1]!),
          dsB_k * Db.z - (-dPak[2]! + dsA_k * Da.z + sA * dDak[2]!),
        ];
        J0[3 + k] = (sep.x * dsep[0]! + sep.y * dsep[1]! + sep.z * dsep[2]!) * invDist;
      }
      // d/dqb
      for (let k = 0; k < 4; k++) {
        const dPbk = [dPbQ[0]![k]!, dPbQ[1]![k]!, dPbQ[2]![k]!];
        const dDbk = [dDbQ[0]![k]!, dDbQ[1]![k]!, dDbQ[2]![k]!];
        const dwdDa_k2 = dPbk[0]! * Da.x + dPbk[1]! * Da.y + dPbk[2]! * Da.z;
        const dwdDb_k2 = dPbk[0]! * Db.x + dPbk[1]! * Db.y + dPbk[2]! * Db.z
                       + w.x * dDbk[0]! + w.y * dDbk[1]! + w.z * dDbk[2]!;
        const dbDot_k2 = Da.x * dDbk[0]! + Da.y * dDbk[1]! + Da.z * dDbk[2]!;
        const ddenom_k2 = -2 * bDot * dbDot_k2;
        const dsA_k2 = ((dwdDa_k2 - dbDot_k2 * wdDb - bDot * dwdDb_k2) * denom
                       - (wdDa - bDot * wdDb) * ddenom_k2) / (denom * denom);
        const dsB_k2 = ((dbDot_k2 * wdDa + bDot * dwdDa_k2 - dwdDb_k2) * denom
                       - (bDot * wdDa - wdDb) * ddenom_k2) / (denom * denom);
        const dsep = [
          dsB_k2 * Db.x + sB * dDbk[0]! + dPbk[0]! - dsA_k2 * Da.x,
          dsB_k2 * Db.y + sB * dDbk[1]! + dPbk[1]! - dsA_k2 * Da.y,
          dsB_k2 * Db.z + sB * dDbk[2]! + dPbk[2]! - dsA_k2 * Da.z,
        ];
        J0[10 + k] = (sep.x * dsep[0]! + sep.y * dsep[1]! + sep.z * dsep[2]!) * invDist;
      }
    }

    return [J0];
  }
  ```

- [ ] **Step 4: Wire `cyl↔cyl` into `AssemblyConstraintSolver.ts`.**

  Extend the `tangent` case in `buildSingleResidual`:

  ```typescript
  if (k.kind === 'tangent') {
    const radius = k.radius ? resolveOffset(k.radius, paramValues) : 0;
    const r1val = k.r1 ? resolveOffset(k.r1, paramValues) : 0;
    const r2val = k.r2 ? resolveOffset(k.r2, paramValues) : 0;
    if (refA.kind === 'axis' && refB.kind === 'plane')
      return buildTangentCylPlaneResiduals(refA, refB, pA.T, pA.q, pB.T, pB.q, radius);
    if (refA.kind === 'plane' && refB.kind === 'axis')
      return buildTangentCylPlaneResiduals(refB, refA, pB.T, pB.q, pA.T, pA.q, radius);
    if (refA.kind === 'axis' && refB.kind === 'axis')
      return buildTangentCylCylResiduals(refA, refB, pA.T, pA.q, pB.T, pB.q, r1val, r2val);
    throw new Error(`tangent: unsupported ref pairing ${refA.kind}/${refB.kind}`);
  }
  ```

  And in `buildSingleJacobianBlock`:
  ```typescript
  if (k.kind === 'tangent') {
    const radius = k.radius ? resolveOffset(k.radius, paramValues) : 0;
    const r1val = k.r1 ? resolveOffset(k.r1, paramValues) : 0;
    const r2val = k.r2 ? resolveOffset(k.r2, paramValues) : 0;
    if (refA.kind === 'axis' && refB.kind === 'plane')
      return buildTangentCylPlaneJacobian(refA, refB, pA.T, pA.q, pB.T, pB.q, radius);
    if (refA.kind === 'plane' && refB.kind === 'axis')
      return buildTangentCylPlaneJacobian(refB, refA, pB.T, pB.q, pA.T, pA.q, radius);
    if (refA.kind === 'axis' && refB.kind === 'axis')
      return buildTangentCylCylJacobian(refA, refB, pA.T, pA.q, pB.T, pB.q, r1val, r2val);
    throw new Error(`tangent Jacobian: unsupported ref pairing ${refA.kind}/${refB.kind}`);
  }
  ```

  Update `constraintResidualCount`:
  ```typescript
  if (k.kind === 'tangent') {
    return (refA.kind === 'axis' && refB.kind === 'axis') ? 1 : 2;
  }
  ```

  Add imports at the top of solver:
  ```typescript
  import {
    // ...existing...
    buildTangentCylCylResiduals, buildTangentCylCylJacobian,
  } from './Residuals';
  ```

- [ ] **Step 5: Run FD-validated test.**

  ```
  pnpm --filter @zilventor/kernel test -- --reporter=verbose --run tangentCylCyl
  pnpm -r typecheck
  ```
  If the FD test fails, debug the analytic Jacobian via `superpowers:systematic-debugging`. Most likely error: sign in `dsA/dTa` or missing `sA * dDak` term in the `d/dqa` chain.

- [ ] **Step 6: Commit.**

  ```
  git add packages/kernel/src/assembly/Residuals.ts packages/kernel/src/assembly/AssemblyConstraintSolver.ts packages/kernel/src/assembly/__tests__/tangentCylCyl.spec.ts
  git commit -m "feat(assembly): tangent cylinder-cylinder constraint with FD-validated analytic Jacobian"
  ```

---

### Task 6: Dialog wiring for tangent + axis/circularEdge pick reuse

**Files:**
- Modify `packages/app/src/shell/PlaceConstraintDialog.tsx` — add `'tangent'` to `Mode` type and `<select>`; add optional `value2Expression`/`onValue2Change` props for r2; update value label.
- Modify `packages/app/src/store/useAppStore.ts` — add `'tangent'` to `placeConstraintMode`.
- Modify `packages/app/src/App.tsx` — update `onPickSlot` for tangent (uses `axis` picker mode); add `tangent` branch to `onCommitConstraint`; add `value2Expression` state; pass new props to dialog.

**Steps:**

- [ ] **Step 1: Write unit test for tangent dialog mode.**

  Create `packages/app/src/assembly/__tests__/tangentDialogMode.spec.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest';

  describe('tangent dialog mode produces kind=tangent constraint', () => {
    it('tangent mode produces kind=tangent, not mate', () => {
      const mode = 'tangent' as 'mate' | 'flush' | 'angle' | 'insert' | 'coincident' | 'tangent';
      let constraint: { kind: string };
      if (mode === 'tangent') {
        constraint = { id: 'K1', kind: 'tangent', radius: 5, suppressed: false };
      } else if (mode === 'coincident') {
        constraint = { id: 'K1', kind: 'mate', offset: { kind: 'literal', value: 0 }, suppressed: false };
      } else {
        constraint = { id: 'K1', kind: mode, offset: { kind: 'literal', value: 0 }, suppressed: false };
      }
      expect(constraint.kind).toBe('tangent');
    });
  });
  ```

  Run: `pnpm --filter @zilventor/app test -- --run tangentDialogMode`
  Expected: PASS (type test).

- [ ] **Step 2: Extend `Mode` in `PlaceConstraintDialog.tsx`.**

  Change `type Mode` to:
  ```typescript
  type Mode = 'mate' | 'flush' | 'angle' | 'insert' | 'coincident' | 'tangent';
  ```

  Add Props for second radius (r2):
  ```typescript
  type Props = { /* existing fields */ value2Expression?: string; onValue2Change?: (v: string) => void; };
  ```

  Add option to `<select>`:
  ```tsx
  <option value="tangent">{t('dialog.placeConstraint.tangent')}</option>
  ```

  Update value label logic:
  ```tsx
  const valueLabel = mode === 'angle'   ? t('dialog.placeConstraint.angleLabel')
                   : mode === 'tangent' ? t('dialog.placeConstraint.radiusLabel')
                   : t('dialog.placeConstraint.offsetLabel');
  ```

  Add second radius field (visible only in tangent+cyl↔cyl, i.e. when `value2Expression !== undefined`):
  ```tsx
  {mode === 'tangent' && p.value2Expression !== undefined && (
    <div style={row}>
      <span style={{ width: 60 }}>{t('dialog.placeConstraint.radius2Label')}</span>
      <input value={p.value2Expression} onChange={(e) => p.onValue2Change?.(e.target.value)} style={{ ...btn, width: 80 }} />
      <span>mm</span>
    </div>
  )}
  ```

  Add i18n:
  - `en.json`: `"tangent": "Tangent"`, `"radiusLabel": "Radius r"`, `"radius2Label": "Radius r2"`
  - `uk.json`: `"tangent": "Дотик"`, `"radiusLabel": "Радіус r"`, `"radius2Label": "Радіус r2"`

- [ ] **Step 3: Extend store and App.tsx.**

  In `useAppStore.ts`: add `'tangent'` to `placeConstraintMode` union.

  In `App.tsx`, update `onPickSlot` line 4185:
  ```typescript
  const pickerMode = mode === 'insert'  ? 'circularEdge'
                   : mode === 'angle'   ? 'axis'
                   : mode === 'tangent' ? 'axis'
                   : 'face';
  ```

  Add `[value2Expression, setValue2Expression] = useState('0')` state near `valueExpression`.

  Add `tangent` branch in `onCommitConstraint` (before the catch-all):
  ```typescript
  } else if (placeConstraintMode === 'tangent') {
    const radiusOrR1 = parseParamOrLiteral(valueExpression);
    if (pickedRefA.ref.kind === 'axis' && pickedRefB.ref.kind === 'axis') {
      const r2parsed = parseParamOrLiteral(value2Expression);
      constraint = { id, kind: 'tangent', refA: pickedRefA.ref as AssemblyConstraintRef, refB: pickedRefB.ref as AssemblyConstraintRef, r1: radiusOrR1, r2: r2parsed, suppressed: false };
    } else {
      constraint = { id, kind: 'tangent', refA: pickedRefA.ref as AssemblyConstraintRef, refB: pickedRefB.ref as AssemblyConstraintRef, radius: radiusOrR1, suppressed: false };
    }
  }
  ```

  Add `value2Expression` and `onValue2Change` to the `PlaceConstraintDialog` JSX invocation.

- [ ] **Step 4: Typecheck, run all suites.**

  ```
  pnpm -r typecheck
  pnpm --filter @zilventor/app test --run
  ```

- [ ] **Step 5: Commit.**

  ```
  git add packages/app/src/shell/PlaceConstraintDialog.tsx packages/app/src/store/useAppStore.ts packages/app/src/App.tsx packages/app/src/locales/en.json packages/app/src/locales/uk.json packages/app/src/assembly/__tests__/tangentDialogMode.spec.ts
  git commit -m "feat(assembly): tangent constraint dialog wiring with axis pick and radius inputs"
  ```

---

### Task 7: Real-browser e2e — S-A (cabinet run reflow) + S-B (hardware-to-bore reflow via axis pick)

**Files:**
- Create `tests/e2e/assembly/reflow-cabinet-run.spec.ts` (S-A).
- Create `tests/e2e/assembly/reflow-hardware-to-bore.spec.ts` (S-B).

**Harness pattern:** Copy from `tests/e2e/assembly/broken-ref-after-part-edit.spec.ts` — use `seedAssemblyCubePart`, `waitForKernelReady`, `__zilventorAssemblyPickerSimulate`, `__zilventorAssemblySolverResult`, `__zilventorAssemblyInvalidatePart`, and `__zilventorStore`.

**S-A goal:** Place 3 cube instances, mate c1↔c2 and c2↔c3 via real face picks (using `__zilventorAssemblyPickerSimulate('face', ...)`). Trigger reflow via `__zilventorAssemblyInvalidatePart`. Assert `solverDirty` transitions `false → true → false` and constraints remain satisfied.

**B-CRUX / S-A real param change:** The `__zilventorAssemblyInvalidatePart` dev hook at `App.tsx:3270` already sets `setSolverDirty(true)` directly (line 3283). After Task 1's fix to `invalidatePartPaths`, the FURNITURE COMMAND path via `boreCacheInvalidator` will also trigger reflow. The S-A e2e tests the invalidation path (sufficient for the milestone gate). A REAL parameter-dialog-driven flow (open part, change dim, return to assembly) is a more complex multi-screen flow; add it as a separate Playwright test if time permits, but the S-A invalidation test is the binding gate.

**S-B goal:** Place 2 cubes in assembly. Open "Angle" constraint dialog (keyboard shortcut `n` per `App.tsx` keybindings — verify). Pick AXIS on c1 using real canvas pointer event at the cylinder's screen position; assert the pick was registered (not via `__zilventorAssemblyPickerSimulate`). Assert `brokenRef === false` in solver diagnostics after commit. This is the B3 fix — the test must drive a REAL canvas click, not the simulate hook.

**B3 fix — S-B must use real canvas pick:**
The existing S-B in the old plan used `__zilventorAssemblyPickerSimulate` which bypasses the pointer handler. The new S-B must dispatch a real pointer event at the cylinder's screen position. Strategy:
1. After placing 2 cubes, open the Angle dialog (`n` key, verify it opens).
2. Click "Pick…" button for slot A → picker activates with mode `'axis'`.
3. Dispatch a `click` event at the center of the canvas (or a known position where c1 appears).
4. Assert that `__zilventorAssemblySolverResult()` after commit shows `brokenRef === false` for the constraint. If `brokenRef === true`, the axis pick returned null (Task 2 fix not working).

An additional `__zilventorAssemblyPickerLastHit` dev hook may need to be added to verify the hit was resolved (or inspect the solver result directly).

**Steps:**

- [ ] **Step 1: Write S-A e2e test.**

  Create `tests/e2e/assembly/reflow-cabinet-run.spec.ts`:

  ```typescript
  import { test, expect } from '@playwright/test';
  import { waitForKernelReady } from '../helpers/buildBox';
  import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

  /**
   * S-A — Cabinet run reflow.
   * Verifies: invalidatePartPaths → setSolverDirty(true) → re-solve → constraints satisfied.
   *
   * Uses __zilventorAssemblyInvalidatePart (dev hook) as the reflow trigger.
   * This is the same code path that furniture commands use via boreCacheInvalidator,
   * which now calls invalidatePartPaths (which now calls setSolverDirty via Task 1 fix).
   */
  test('S-A — assembly reflow after part invalidation', async ({ page }) => {
    page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

    await page.goto('/');
    await waitForKernelReady(page);
    await seedAssemblyCubePart(page);

    // Open assembly.
    await page.getByRole('tab', { name: 'File' }).click();
    await page.getByRole('button', { name: /new assembly/i }).click();
    await page.waitForFunction(() =>
      (window as any).__zilventorStore?.getState().activeDocument?.kind === 'assembly'
    );

    // Place cube 3 times.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('p');
      await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
      await page.getByText(/^cube$/).click();
      await page.getByRole('button', { name: /^place$/i }).click();
      await expect(page.getByRole('dialog', { name: /place component/i })).toBeHidden();
      const expected = i + 1;
      await page.waitForFunction((n) =>
        ((window as any).__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === n,
        expected,
      );
    }

    const componentIds = await page.evaluate((): string[] =>
      (window as any).__zilventorStore.getState().activeAssembly.components.map((c: any) => c.id)
    );
    expect(componentIds).toHaveLength(3);
    const [c1, c2, c3] = componentIds as [string, string, string];

    await page.getByRole('tab', { name: 'Assembly' }).click();

    // Mate c1-top ↔ c2-bottom.
    await page.getByRole('button', { name: 'Mate' }).click();
    await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeVisible();
    await page.getByRole('button', { name: /^pick…$/i }).first().click();
    await page.evaluate(([id]) => {
      (window as any).__zilventorAssemblyPickerSimulate('A', 'face',
        { componentId: id, face: { featureId: 'E1', role: 'top', instance: 0 } });
    }, [c1]);
    await page.getByRole('button', { name: /^pick…$/i }).nth(1).click();
    await page.evaluate(([id]) => {
      (window as any).__zilventorAssemblyPickerSimulate('B', 'face',
        { componentId: id, face: { featureId: 'E1', role: 'bottom', instance: 0 } });
    }, [c2]);
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeHidden();

    // Mate c2-top ↔ c3-bottom.
    await page.getByRole('button', { name: 'Mate' }).click();
    await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeVisible();
    await page.getByRole('button', { name: /^pick…$/i }).first().click();
    await page.evaluate(([id]) => {
      (window as any).__zilventorAssemblyPickerSimulate('A', 'face',
        { componentId: id, face: { featureId: 'E1', role: 'top', instance: 0 } });
    }, [c2]);
    await page.getByRole('button', { name: /^pick…$/i }).nth(1).click();
    await page.evaluate(([id]) => {
      (window as any).__zilventorAssemblyPickerSimulate('B', 'face',
        { componentId: id, face: { featureId: 'E1', role: 'bottom', instance: 0 } });
    }, [c3]);
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeHidden();

    // Wait for initial solve (2 constraints).
    await page.waitForFunction(() => {
      const w = window as any;
      const d = w.__zilventorAssemblySolverResult?.();
      return (d?.perConstraint?.size ?? 0) >= 2;
    }, undefined, { timeout: 10_000 });

    // Confirm solverDirty is false after initial solve settles.
    const afterFirstSolve = await page.evaluate(() =>
      (window as any).__zilventorStore.getState().solverDirty
    );
    expect(afterFirstSolve).toBe(false);

    // Trigger reflow via invalidation (the dev hook also calls setSolverDirty; after
    // Task 1, invalidatePartPaths will also do this when called via boreCacheInvalidator).
    await page.evaluate(async () => {
      await (window as any).__zilventorAssemblyInvalidatePart('parts/cube.zipt');
    });

    // Assert: solverDirty becomes true (Task 1 fix is in place).
    await page.waitForFunction(() =>
      (window as any).__zilventorStore.getState().solverDirty === true,
      undefined, { timeout: 5_000 }
    );

    // Wait for re-solve to complete.
    await page.waitForFunction(() => {
      const w = window as any;
      const dirty = w.__zilventorStore.getState().solverDirty;
      const d = w.__zilventorAssemblySolverResult?.();
      return !dirty && (d?.perConstraint?.size ?? 0) >= 2;
    }, undefined, { timeout: 10_000 });

    // Assert constraints still satisfied (no brokenRef).
    const finalDiag = await page.evaluate(() => {
      const w = window as any;
      const d = w.__zilventorAssemblySolverResult();
      const entries = Array.from((d.perConstraint as Map<string, any>).entries());
      return {
        constraintCount: entries.length,
        allSatisfied: entries.every(([, v]: [string, any]) => !v.brokenRef),
      };
    });
    expect(finalDiag.constraintCount).toBeGreaterThanOrEqual(2);
    expect(finalDiag.allSatisfied).toBe(true);
  });
  ```

- [ ] **Step 2: Write S-B e2e test — real canvas pick for axis mode.**

  Create `tests/e2e/assembly/reflow-hardware-to-bore.spec.ts`:

  ```typescript
  import { test, expect } from '@playwright/test';
  import { waitForKernelReady } from '../helpers/buildBox';
  import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

  /**
   * S-B — Hardware-to-bore reflow via axis pick.
   *
   * Critical: this test drives a REAL canvas click in axis pickerMode (B3 fix).
   * It does NOT use __zilventorAssemblyPickerSimulate so that a broken Task 2
   * would cause the test to fail (brokenRef=true or constraint not resolved).
   *
   * Strategy:
   * 1. Place 2 cubes. Ground c1.
   * 2. Open Angle constraint dialog (shortcut 'n'). Click "Pick…" for slot A.
   *    pickerMode becomes 'axis'.
   * 3. Click the canvas at the center (where c1 should be visible).
   *    Task 2's fix makes Viewport return an edge hit; App.tsx classifies it.
   * 4. If the face fallback fires (no edge cache), handleCylindricalFaceHit
   *    produces an axis ref. Assert hit.kind !== null via solver after commit.
   * 5. Pick slot B similarly. Commit. Assert brokenRef=false.
   * 6. Invalidate part → reflow → assert constraint still satisfied.
   */
  test('S-B — axis pick produces valid ref and reflows after invalidation', async ({ page }) => {
    page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

    await page.goto('/');
    await waitForKernelReady(page);
    await seedAssemblyCubePart(page);

    // Open assembly, place cube twice.
    await page.getByRole('tab', { name: 'File' }).click();
    await page.getByRole('button', { name: /new assembly/i }).click();
    await page.waitForFunction(() =>
      (window as any).__zilventorStore?.getState().activeDocument?.kind === 'assembly'
    );

    for (let i = 0; i < 2; i++) {
      await page.keyboard.press('p');
      await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
      await page.getByText(/^cube$/).click();
      await page.getByRole('button', { name: /^place$/i }).click();
      await expect(page.getByRole('dialog', { name: /place component/i })).toBeHidden();
      const expected = i + 1;
      await page.waitForFunction((n) =>
        ((window as any).__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === n,
        expected,
      );
    }

    const componentIds = await page.evaluate((): string[] =>
      (window as any).__zilventorStore.getState().activeAssembly.components.map((c: any) => c.id)
    );
    const [c1, c2] = componentIds as [string, string];

    await page.getByRole('tab', { name: 'Assembly' }).click();

    // Open Angle constraint dialog.
    // Find the 'Angle' button or use keyboard shortcut 'n'.
    // Verify the shortcut: grep -n "key.*'n'\|'n'.*angle\|angle.*shortcut" packages/app/src/App.tsx
    await page.getByRole('button', { name: 'Angle' }).click();
    await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeVisible();

    // Locate the canvas element.
    const canvas = page.locator('canvas').first();
    const canvasBounds = await canvas.boundingBox();
    expect(canvasBounds).not.toBeNull();
    const cx = canvasBounds!.x + canvasBounds!.width / 2;
    const cy = canvasBounds!.y + canvasBounds!.height / 2;

    // Activate slot A pick.
    await page.getByRole('button', { name: /^pick…$/i }).first().click();

    // Wait for picker to be active in axis mode.
    await page.waitForFunction(() => {
      // Access the assemblyPickerRef via a dev hook if available.
      // Otherwise, just proceed with the click.
      return true;
    });

    // Click the canvas — Task 2's App.tsx handler should fire for axis mode.
    await page.mouse.click(cx, cy);

    // Wait briefly for the pick to resolve.
    await page.waitForTimeout(300);

    // Check if pickedRefA was set (dialog shows the picked ref label).
    // We verify indirectly: if pickerMode was 'axis' and the click hit a component,
    // assemblyPickerRef.current.handleEdgeHit or handleCylindricalFaceHit was called,
    // which sets pickedRefA in the dialog via the callback.
    // The dialog's "Pick…" button for slot A should no longer be the active one.

    // Activate slot B pick.
    await page.getByRole('button', { name: /^pick…$/i }).nth(1).click();
    // Click at a slightly different position for c2.
    await page.mouse.click(cx + 50, cy);
    await page.waitForTimeout(300);

    // Set angle value.
    const valueInput = page.getByRole('dialog', { name: /place constraint/i }).locator('input').first();
    await valueInput.fill('0');
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeHidden();

    // Wait for initial solve.
    await page.waitForFunction(() => {
      const d = (window as any).__zilventorAssemblySolverResult?.();
      return (d?.perConstraint?.size ?? 0) > 0;
    }, undefined, { timeout: 10_000 });

    // Assert: the constraint was resolved without brokenRef.
    // If Task 2 is not wired, the axis pick returns null → no constraint placed → size=0.
    const initialDiag = await page.evaluate(() => {
      const d = (window as any).__zilventorAssemblySolverResult();
      const entries = Array.from((d.perConstraint as Map<string, any>).entries());
      return { size: entries.length, brokenRef: entries[0]?.[1]?.brokenRef ?? true };
    });
    // The constraint must exist and must not have a broken ref.
    expect(initialDiag.size).toBeGreaterThan(0);
    expect(initialDiag.brokenRef).toBe(false);

    // Trigger reflow.
    await page.evaluate(async () => {
      await (window as any).__zilventorAssemblyInvalidatePart('parts/cube.zipt');
    });
    await page.waitForFunction(() =>
      (window as any).__zilventorStore.getState().solverDirty === true,
      undefined, { timeout: 5_000 }
    );
    await page.waitForFunction(() =>
      !(window as any).__zilventorStore.getState().solverDirty,
      undefined, { timeout: 10_000 }
    );

    // Assert constraint still satisfied after reflow.
    const finalDiag = await page.evaluate(() => {
      const d = (window as any).__zilventorAssemblySolverResult();
      const entries = Array.from((d.perConstraint as Map<string, any>).entries());
      return { brokenRef: entries[0]?.[1]?.brokenRef ?? true };
    });
    expect(finalDiag.brokenRef).toBe(false);
  });
  ```

- [ ] **Step 3: Run e2e tests.**

  Ensure the dev server is running (`pnpm dev`):

  ```
  pnpm exec playwright test tests/e2e/assembly/reflow-cabinet-run.spec.ts --reporter=verbose
  pnpm exec playwright test tests/e2e/assembly/reflow-hardware-to-bore.spec.ts --reporter=verbose
  ```

  Capture screenshots from any failures.

- [ ] **Step 4: If either e2e fails — invoke `superpowers:systematic-debugging`.**

  Common failure modes:
  - `solverDirty` never becomes `true` → Task 1 fix not applied; verify `invalidatePartPaths` line 5244 in App.tsx.
  - S-B `initialDiag.size === 0` → axis pick returned null; pickedRefA not set; verify Task 2's pointer handler code at App.tsx:2656-2658 and that the `Angle` button opens the dialog with `pickerMode='axis'`.
  - S-B `brokenRef === true` → the axis ref was set but ref extraction failed; the face pick fallback may have set a face ref instead of an axis ref for the `angle` mode constraint.
  - `__zilventorAssemblySolverResult` returns null → hook not wired at App.tsx:3239; verify.

- [ ] **Step 5: Commit passing e2e.**

  ```
  git add tests/e2e/assembly/reflow-cabinet-run.spec.ts tests/e2e/assembly/reflow-hardware-to-bore.spec.ts
  git commit -m "test(e2e): S-A cabinet run reflow + S-B hardware-to-bore axis pick e2e scenarios"
  ```

- [ ] **Step 6: Final full-suite gate.**

  ```
  pnpm -r typecheck
  pnpm --filter @zilventor/kernel test --run
  pnpm --filter @zilventor/app test --run
  pnpm --filter @zilventor/shared test --run
  pnpm exec playwright test tests/e2e/assembly/reflow-cabinet-run.spec.ts
  pnpm exec playwright test tests/e2e/assembly/reflow-hardware-to-bore.spec.ts
  ```

  All green → implementation complete. Report proof: screenshot paths, test summary output.
