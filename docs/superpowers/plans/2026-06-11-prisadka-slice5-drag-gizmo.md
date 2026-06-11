# Присадка Slice 5 — 3D Drag-Gizmo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user drag a carcass/hinge присадка bore marker along its natural axis in the 3D viewport to reposition the connector, with a live mm readout and single-step undo.

**Architecture:** Three pure shared units (axis-projection, axis-derivation, face clamp) feed an App.tsx pointer-drag handler that mirrors the existing component-drag ref pattern. The handler disables OrbitControls on a bore hit, moves the marker+gizmo mesh live (no re-bake), and on release fires ONE `MoveConnectorCommand` through `bus.execute` (reusing `translateConnectorAlong`). The numeric panel's two move commands are also routed through the bus, fixing the latent undo-bypass bug. No manifest bump (v24), no kernel change.

**Tech Stack:** TypeScript monorepo (pnpm), raw three.js `^0.165.0` + OrbitControls, Zustand store, OPFS persistence, Playwright e2e, OCCT WASM kernel (real-OCCT integration tests).

**Authoritative source:** `docs/superpowers/specs/2026-06-11-prisadka-slice5-drag-gizmo-design.md` — **§9 Corrections v2 overrides everything else.** Read it before starting.

---

## CWD / command traps (read first — from prior-slice memory)
- **App suites:** from `packages/app/` → `npx vitest run --config vitest.config.ts <relpath>`.
- **Shared suites:** from `packages/shared/` → `npx vitest run <relpath>`.
- **Kernel real-OCCT:** from `packages/kernel/` → `npx vitest run --config vitest.integration.config.ts <relpath>`.
- **Typecheck (full):** from repo root → `pnpm -r typecheck` (covers shared + app; catches `noUncheckedIndexedAccess` test-file errors vitest misses).
- **Bash cwd persists across calls AND within a compound command** — re-`cd` absolute at the start of each package op.
- Tests live in `__tests__/`. Wrong dir → blank output (NOT a pass).

## File structure (decomposition)
| File | Responsibility | Task |
|---|---|---|
| `packages/shared/src/dragProjection.ts` (create) | Pure `signedDragDeltaAlongAxis` + near-parallel guard | A |
| `packages/shared/src/boreGizmoAxis.ts` (create) | Pure `boreGizmoAxis(bore, panelWorldQuat)` → world axis or null | B |
| `packages/shared/src/clampDelta.ts` (create) | Pure `clampDeltaToFaceExtents(members, worldDir, delta)` | C |
| `packages/app/src/shell/BorePropertiesPanel.tsx` (modify) | Route 2 move commits through `bus.execute` | D |
| `packages/app/src/viewport/Viewport.tsx` (modify) | Forward `onPointerCancel`; (controls ref stays App-side) | E |
| `packages/app/src/viewport/SceneManager.ts` (modify) | Gizmo mesh render + rebuild-gating during drag + probe | F |
| `packages/app/src/App.tsx` (modify) | `orbitControlsRef`; bore drag handler (down/move/up/cancel) | G |
| `packages/app/e2e/drag-gizmo.spec.ts` (create) | Real-DOM-pointer e2e (3-step undo + mid-drag controls probe) | H |
| `packages/kernel/src/__tests__/dragGizmoBake.integration.test.ts` (create) | OCCT centroid-move bake | I |

**Parallelizable:** A, B, C, D, I are disjoint (3 new shared files + 1 app panel + 1 kernel test) → run in parallel. E + F are disjoint app files → parallel. G depends on A/B/C/E/F. H depends on G.

---

### Task A: `signedDragDeltaAlongAxis` (pure projection)

**Files:**
- Create: `packages/shared/src/dragProjection.ts`
- Test: `packages/shared/src/__tests__/dragProjection.spec.ts`

**Design:** The app builds the pointer **world ray** from NDC via the trusted three.js one-liner `new THREE.Raycaster().setFromCamera(ndc, camera)` (NOT our code). This pure unit operates on world rays so its test can author rays from explicit geometry (FOV-independent oracle, per §9.A/§9.C). The constrained value is the parameter `t` of the closest point on the axis line `pivot + t·axis` to the pointer ray; delta = `t_now − t_start`. Near-parallel guard (`|axis·dir| > 0.95`) returns 0 (hold), per §9.A.

- [ ] **Step 1: Write the failing test** (independent oracle — rays authored from geometry, never the closest-point formula)

```ts
import { describe, it, expect } from 'vitest';
import { signedDragDeltaAlongAxis, GIZMO_AXIS_VIEW_PARALLEL_THRESHOLD } from '../dragProjection';

// Camera looking straight down -Z from z=100. A pointer ray is vertical (dir = (0,0,-1)),
// its origin's XY is where the pointer "is" in world space. Moving the pointer in +X by 5mm
// must yield delta = +5 along world-X axis. Oracle authored from geometry, not the impl.
const downZ = (x: number, y: number) => ({ origin: { x, y, z: 100 }, dir: { x: 0, y: 0, z: -1 } });

describe('signedDragDeltaAlongAxis', () => {
  it('maps a +X pointer move to +5 along world-X', () => {
    const axis = { x: 1, y: 0, z: 0 };
    const pivot = { x: 0, y: 0, z: 0 };
    const d = signedDragDeltaAlongAxis(axis, pivot, downZ(0, 0), downZ(5, 0));
    expect(d).toBeCloseTo(5, 6);
  });

  it('ignores pointer motion orthogonal to the axis', () => {
    const axis = { x: 1, y: 0, z: 0 };
    const pivot = { x: 0, y: 0, z: 0 };
    const d = signedDragDeltaAlongAxis(axis, pivot, downZ(0, 0), downZ(0, 7));
    expect(d).toBeCloseTo(0, 6);
  });

  it('is signed (negative drag)', () => {
    const axis = { x: 1, y: 0, z: 0 };
    const d = signedDragDeltaAlongAxis(axis, { x: 0, y: 0, z: 0 }, downZ(3, 0), downZ(-2, 0));
    expect(d).toBeCloseTo(-5, 6);
  });

  it('works for a vertical (world-Z) axis with a side-on camera', () => {
    // Camera looking down -Y; pointer ray dir = (0,-1,0); moving origin +Z by 4 → +4 along world-Z.
    const ray = (z: number) => ({ origin: { x: 0, y: 100, z }, dir: { x: 0, y: -1, z: 0 } });
    const d = signedDragDeltaAlongAxis({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, ray(0), ray(4));
    expect(d).toBeCloseTo(4, 6);
  });

  it('returns 0 when the axis is near-parallel to the view (degenerate)', () => {
    // axis = world-Z, ray dir also ~ -Z → |axis·dir| ≈ 1 > threshold → hold (0).
    const ray = (x: number) => ({ origin: { x, y: 0, z: 100 }, dir: { x: 0, y: 0, z: -1 } });
    const d = signedDragDeltaAlongAxis({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, ray(0), ray(5));
    expect(d).toBe(0);
  });

  it('threshold constant is 0.95', () => {
    expect(GIZMO_AXIS_VIEW_PARALLEL_THRESHOLD).toBeCloseTo(0.95, 6);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/shared && npx vitest run src/__tests__/dragProjection.spec.ts`
Expected: FAIL — `signedDragDeltaAlongAxis` not exported.

- [ ] **Step 3: Implement** (reuse existing shared Vec3 helpers — confirm the import path against `connectorCoupling.ts`'s imports; it already uses `dot`/`sub`)

```ts
import type { Vec3 } from './connectorCoupling'; // or the shared vec module that exports Vec3
import { dot, sub } from './connectorCoupling';   // confirm these are exported there; else import from the vec module

export const GIZMO_AXIS_VIEW_PARALLEL_THRESHOLD = 0.95;

export interface PointerRay { origin: Vec3; dir: Vec3 } // dir assumed unit-length (three.js raycaster guarantees)

/** Parameter t of the closest point on line (pivot + t·axis) to the ray. axis & ray.dir unit. */
function closestAxisParam(axis: Vec3, pivot: Vec3, ray: PointerRay): number {
  const b = dot(axis, ray.dir);          // a=c=1 (both unit)
  const w0 = sub(pivot, ray.origin);
  const dA = dot(axis, w0);
  const eD = dot(ray.dir, w0);
  const denom = 1 - b * b;               // sin²θ
  return (b * eD - dA) / denom;
}

/** Signed mm the bore should move along `axis` given pointer rays at drag-start and now.
 *  Returns 0 (hold) when the axis is near-parallel to the view direction. */
export function signedDragDeltaAlongAxis(
  axis: Vec3,
  pivot: Vec3,
  rayStart: PointerRay,
  rayNow: PointerRay,
): number {
  if (Math.abs(dot(axis, rayNow.dir)) > GIZMO_AXIS_VIEW_PARALLEL_THRESHOLD) return 0;
  return closestAxisParam(axis, pivot, rayNow) - closestAxisParam(axis, pivot, rayStart);
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/shared && npx vitest run src/__tests__/dragProjection.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dragProjection.ts packages/shared/src/__tests__/dragProjection.spec.ts
git commit -m "feat(slice5): signedDragDeltaAlongAxis pure projection unit (near-parallel guard)"
```

---

### Task B: `boreGizmoAxis` (pure axis derivation)

**Files:**
- Create: `packages/shared/src/boreGizmoAxis.ts`
- Test: `packages/shared/src/__tests__/boreGizmoAxis.spec.ts`

**Design:** Single source of truth for a bore's world move-axis (collapses the panel's duplicated derivation, §9.E#2). Carcass (`confirmat`/`minifix`/`dowel`) → `bore.jointDir` (already world, unit). Hinge → `rotate({1,0,0}, panelWorldQuat)` (the cup-face u-axis, §9.A NIT — NOT "height"). Else (`shelfPin`/`drawerSlide`/missing jointDir) → `null` (not draggable).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { boreGizmoAxis } from '../boreGizmoAxis';
import type { BoreOp } from '../bore';

const base = (kind: BoreOp['connectorKind'], extra: Partial<BoreOp> = {}): BoreOp => ({
  id: 'b1', face: { featureId: 'panel', role: 'Top', instance: 0 },
  u: 10, v: 10, diameter: 5, depth: 12, role: 'carcass-a',
  connectorId: 'c1', connectorKind: kind, ...extra,
} as BoreOp);

const IDENTITY_QUAT = { x: 0, y: 0, z: 0, w: 1 };

describe('boreGizmoAxis', () => {
  it('returns jointDir for carcass kinds', () => {
    const jd = { x: 0, y: 0, z: 1 };
    for (const k of ['confirmat', 'minifix', 'dowel'] as const) {
      expect(boreGizmoAxis(base(k, { jointDir: jd }), IDENTITY_QUAT)).toEqual(jd);
    }
  });

  it('returns the cup u-axis (rotated {1,0,0}) for hinge', () => {
    // identity quat → {1,0,0}
    expect(boreGizmoAxis(base('hinge'), IDENTITY_QUAT)).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('returns null for out-of-scope kinds', () => {
    expect(boreGizmoAxis(base('shelfPin'), IDENTITY_QUAT)).toBeNull();
    expect(boreGizmoAxis(base('drawerSlide'), IDENTITY_QUAT)).toBeNull();
  });

  it('returns null for carcass without jointDir', () => {
    expect(boreGizmoAxis(base('confirmat'), IDENTITY_QUAT)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/shared && npx vitest run src/__tests__/boreGizmoAxis.spec.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement** (reuse `rotate` from `connectorCoupling.ts` — the same one `commitHingeMove` uses)

```ts
import type { BoreOp } from './bore';
import type { Vec3, Quat } from './connectorCoupling';
import { rotate } from './connectorCoupling';

const CARCASS_KINDS = new Set(['confirmat', 'minifix', 'dowel']);

/** World move-axis for a draggable bore, or null if the kind has no defined drag axis. */
export function boreGizmoAxis(bore: BoreOp, panelWorldQuat: Quat): Vec3 | null {
  if (CARCASS_KINDS.has(bore.connectorKind)) {
    return bore.jointDir ?? null; // already world-space unit
  }
  if (bore.connectorKind === 'hinge') {
    return rotate({ x: 1, y: 0, z: 0 }, panelWorldQuat);
  }
  return null; // shelfPin, drawerSlide, anything else
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/shared && npx vitest run src/__tests__/boreGizmoAxis.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/boreGizmoAxis.ts packages/shared/src/__tests__/boreGizmoAxis.spec.ts
git commit -m "feat(slice5): boreGizmoAxis single-source axis derivation (carcass/hinge/null)"
```

---

### Task C: `clampDeltaToFaceExtents` (single-delta coupled clamp)

**Files:**
- Create: `packages/shared/src/clampDelta.ts`
- Test: `packages/shared/src/__tests__/clampDelta.spec.ts`

**Design (§9.A BLOCKER):** Two coupled members move via different face frames. Compute ONE clamped delta against the **most-restrictive** member, applied identically to all (no per-member clamp → desync). For each member, a unit of `delta` along `worldDir` changes its `(u,v)` by `(du,dv) = (dot(worldDir, worldU), dot(worldDir, worldV))` where `worldU/worldV = rotate(uDir/vDir, worldPose.quaternion)` and `uDir/vDir` come from `face2DFrame(panelDims, bore.face.role)`. Keep each bore's center within `[r, faceLen − r]` (r = diameter/2). Solve the allowable signed-delta interval per member, intersect, clamp the requested delta into it.

> **Implementer note (flag for plan-verify):** `face2DFrame(panelDims, role)` returns `{origin, uDir, vDir}` (`bore.ts:~65`). You also need the face's **u/v extents** (the two non-thickness panel dims for that face). If `face2DFrame` doesn't return extents, add a sibling `faceExtents(panelDims, role): { uLen: number; vLen: number }` in `bore.ts` deriving them from `panelDims` by role (same role→dim mapping `face2DFrame` uses). Confirm the exact `ConnectorMember` shape (`{bore, panelDims, worldPose}`) against `connectorCoupling.ts:5-12`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { clampDeltaToFaceExtents } from '../clampDelta';
import type { ConnectorMember } from '../connectorCoupling';

// One member on a 600×400 face, bore at u=300 (center), diameter 5. worldDir == worldU so du=1.
// face2DFrame for the chosen role must give uDir mapping to worldDir under identity quat.
function member(u: number, uLen: number): ConnectorMember {
  return {
    bore: { id: 'b', face: { featureId: 'panel', role: 'Top', instance: 0 }, u, v: 200,
            diameter: 5, depth: 12, role: 'carcass-a', connectorId: 'c', connectorKind: 'confirmat',
            jointDir: { x: 1, y: 0, z: 0 } } as ConnectorMember['bore'],
    panelDims: { length: uLen, width: 400, thickness: 18 } as ConnectorMember['panelDims'],
    worldPose: { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } } as ConnectorMember['worldPose'],
  };
}

describe('clampDeltaToFaceExtents', () => {
  const worldDir = { x: 1, y: 0, z: 0 }; // assume face2DFrame Top → uDir = +X under identity

  it('passes a delta that stays in bounds unchanged', () => {
    expect(clampDeltaToFaceExtents([member(300, 600)], worldDir, 50)).toBeCloseTo(50, 6);
  });

  it('clamps a delta that would push the bore past the far edge (keeps radius margin)', () => {
    // u=300, uLen=600, r=2.5 → max u = 597.5 → max delta = 297.5
    expect(clampDeltaToFaceExtents([member(300, 600)], worldDir, 1000)).toBeCloseTo(297.5, 4);
  });

  it('clamps negative delta at the near edge', () => {
    // min u = 2.5 → min delta = -297.5
    expect(clampDeltaToFaceExtents([member(300, 600)], worldDir, -1000)).toBeCloseTo(-297.5, 4);
  });

  it('the most-restrictive member governs', () => {
    // member A allows +297.5, member B (shorter face) allows less → result = the smaller bound
    const a = member(300, 600);
    const b = member(150, 320); // max u 317.5 → max delta 167.5
    expect(clampDeltaToFaceExtents([a, b], worldDir, 1000)).toBeCloseTo(167.5, 4);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/shared && npx vitest run src/__tests__/clampDelta.spec.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

```ts
import type { ConnectorMember, Vec3 } from './connectorCoupling';
import { dot, rotate } from './connectorCoupling';
import { face2DFrame, faceExtents } from './bore'; // faceExtents added per implementer note if missing

/** Largest-magnitude delta (same sign as `requested`) keeping every member's bore center
 *  within [r, faceLen − r] on both u and v. Single delta → coupled members stay in sync. */
export function clampDeltaToFaceExtents(
  members: ConnectorMember[],
  worldDir: Vec3,
  requested: number,
): number {
  let lo = -Infinity, hi = Infinity; // allowable signed-delta interval
  for (const m of members) {
    const { uDir, vDir } = face2DFrame(m.panelDims, m.bore.face.role);
    const { uLen, vLen } = faceExtents(m.panelDims, m.bore.face.role);
    const q = m.worldPose.quaternion;
    const du = dot(worldDir, rotate(uDir, q));
    const dv = dot(worldDir, rotate(vDir, q));
    const r = m.bore.diameter / 2;
    // u(delta) = bore.u + du*delta must be in [r, uLen - r]; likewise v.
    const bound = (cur: number, coef: number, len: number) => {
      if (Math.abs(coef) < 1e-9) return; // this axis unaffected by the move
      const t1 = (r - cur) / coef;
      const t2 = (len - r - cur) / coef;
      lo = Math.max(lo, Math.min(t1, t2));
      hi = Math.min(hi, Math.max(t1, t2));
    };
    bound(m.bore.u, du, uLen);
    bound(m.bore.v, dv, vLen);
  }
  return Math.max(lo, Math.min(hi, requested));
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/shared && npx vitest run src/__tests__/clampDelta.spec.ts`
Expected: PASS (4 tests). If `face2DFrame`'s Top-face uDir is not +X, adjust the test's `worldDir` to the real uDir (read `bore.ts`) — the clamp logic is convention-agnostic.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/clampDelta.ts packages/shared/src/__tests__/clampDelta.spec.ts packages/shared/src/bore.ts
git commit -m "feat(slice5): clampDeltaToFaceExtents single-delta coupled-member clamp"
```

---

### Task D: Route the numeric panel's two move commands through the bus

**Files:**
- Modify: `packages/app/src/shell/BorePropertiesPanel.tsx` (`commitJointMove` ~:127, `commitHingeMove` ~:143)
- Test: `packages/app/src/commands/__tests__/MoveConnectorCommand.bus.spec.ts` (create)

**Design (§9.D):** `MoveConnectorCommand` already conforms to the `Command` interface (`apply`/`revert`) and `CommandBus.execute` calls `apply()` then pushes undo (`CommandBus.ts:15-19`). The panel today calls `void new MoveConnectorCommand({...}).apply()` (bus-bypass → no undo). Add `bus` from the store and route both commits through it.

- [ ] **Step 1: Write the failing test** (command-bus round-trip — guards §9.D and is the foundation the gizmo reuses)

```ts
import { describe, it, expect } from 'vitest';
import { CommandBus } from '../CommandBus';
import { MoveConnectorCommand } from '../MoveConnectorCommand';
// Use the existing MoveConnectorCommand test fixtures/helpers (seed two docs + members + a fake opfs).
// Read MoveConnectorCommand's existing spec for the exact fixture builders and reuse them.

describe('MoveConnectorCommand on the bus', () => {
  it('execute moves u, undo restores, redo re-applies', async () => {
    const { members, opfs, worldDir, readU } = makeMoveFixture(); // reuse/port from existing MoveConnectorCommand.spec
    const bus = new CommandBus();
    const before = readU();
    await bus.execute(new MoveConnectorCommand({ members, worldDir, delta: 12, opfs }));
    expect(readU()).not.toBe(before);   // proves it ran (§9.C 3-step, step 2)
    await bus.undo();
    expect(readU()).toBe(before);       // step 3
    await bus.redo();
    expect(readU()).not.toBe(before);
  });
});
```

> **Implementer note:** read `packages/app/src/commands/__tests__/MoveConnectorCommand.spec.ts` (or wherever the command is tested) and reuse its fixture builders for `makeMoveFixture`. If none exists, build a minimal two-member fixture with an in-memory opfs stub matching what `MoveConnectorCommand.apply()` reads/writes. Confirm `MoveConnectorCommand` constructor opts shape against `MoveConnectorCommand.ts:41`.

- [ ] **Step 2: Run test, verify it fails or passes**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/commands/__tests__/MoveConnectorCommand.bus.spec.ts`
Expected: PASS immediately is acceptable here (the command already conforms — this is a **characterization guard** for §9.D, a documented no-red exception). If it FAILS, the command's bus-compat is broken — fix before proceeding.

- [ ] **Step 3: Wire the panel through the bus**

In `BorePropertiesPanel.tsx`, add the bus from the store (it lives at `useAppStore` state `bus`, see `useAppStore.ts:157`):

```ts
const bus = useAppStore((s) => s.bus);
```

Then in `commitJointMove` (~:134) and `commitHingeMove` (~:152), replace:

```ts
void new MoveConnectorCommand({ /* …opts… */ }).apply();
```
with:
```ts
void bus.execute(new MoveConnectorCommand({ /* …same opts… */ }));
```
(Keep the opts identical. Do not add `await`/post-call UI updates — the panel does none today, §9.D CONFIRMED.)

- [ ] **Step 4: Verify panel tests + tsc still green**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/shell/__tests__/BorePropertiesPanel*.spec.tsx` (run whatever panel specs exist)
Then: `cd /Users/lion/Documents/Projects/mine/zilventor && pnpm -r typecheck`
Expected: PASS; 0 new tsc errors.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/BorePropertiesPanel.tsx packages/app/src/commands/__tests__/MoveConnectorCommand.bus.spec.ts
git commit -m "fix(slice5): route numeric bore-move commands through bus.execute (undo)"
```

---

### Task E: Forward `pointercancel` from the viewport

**Files:**
- Modify: `packages/app/src/viewport/Viewport.tsx` (pointer wiring ~:473-476)

**Design (§9.B BLOCKER):** Viewport forwards only down/move/up/click. Add `onPointerCancel` so the drag handler can re-enable OrbitControls if the gesture is interrupted (alt-tab). No unit test (DOM wiring; covered by e2e Task H) — verified by tsc + e2e. **No-TDD exception: pure event-plumbing.**

- [ ] **Step 1: Add the handler**

In the canvas JSX (alongside `onPointerDown/Move/Up`), add:
```tsx
onPointerCancel={(e) => props.onPointer?.({ type: 'pointercancel', clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, button: e.button })}
```
Confirm the `onPointer` payload shape against the existing `onPointerDown` forwarding (~:473) and extend the union type the handler accepts to include `'pointercancel'`. Ensure `pointerId` is included on the existing down/move/up forwards too (needed by Task G for `releasePointerCapture`); add it if absent.

- [ ] **Step 2: Typecheck**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor && pnpm -r typecheck`
Expected: 0 new errors.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/viewport/Viewport.tsx
git commit -m "feat(slice5): forward pointercancel + pointerId from viewport canvas"
```

---

### Task F: Gizmo mesh in SceneManager (render + rebuild-gate + probe)

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts`

**Design (§9.B BLOCKER + §3 Unit C):** A double-arrow handle mesh drawn through the selected bore's world position along its world axis. Two new pieces: (1) `setBoreGizmo(spec | null)` builds/clears the mesh; (2) a drag-active flag that **defers `rebuildBoreMarkers`** so a mid-drag `boreCacheInvalidator` doesn't dispose the dragged mesh (else stale orphan, §9.B). Plus a probe for the e2e (headless renders black).

- [ ] **Step 1: Add the drag-gate + gizmo API + probe**

Add fields near `boreMarkers` (`:108`):
```ts
private boreGizmo: THREE.Object3D | null = null;
private boreDragActive = false;
private pendingMarkerRebuild = false;
```

Add a guard at the top of `rebuildBoreMarkers` (`:664`):
```ts
if (this.boreDragActive) { this.pendingMarkerRebuild = true; return; }
```

Add methods:
```ts
/** Called by the App drag handler around a gesture. On end, flush a deferred rebuild. */
setBoreDragActive(active: boolean): void {
  this.boreDragActive = active;
  if (!active && this.pendingMarkerRebuild) {
    this.pendingMarkerRebuild = false;
    this.rebuildBoreMarkers(this.lastMarkerSpecs); // reuse the last specs cached by rebuildBoreMarkers
  }
}

/** Show (or clear with null) the drag handle at a world position along a world axis. */
setBoreGizmo(spec: { worldPos: Vec3; worldAxis: Vec3 } | null): void {
  if (this.boreGizmo) { this.scene.remove(this.boreGizmo); disposeObject(this.boreGizmo); this.boreGizmo = null; }
  if (!spec) return;
  this.boreGizmo = buildAxisHandle(spec.worldPos, spec.worldAxis); // thin cylinder + 2 cone caps, distinct color
  this.scene.add(this.boreGizmo);
}

/** Test/e2e probe (headless renders black). */
boreGizmoVisible(): boolean { return this.boreGizmo !== null; }
```

- [ ] **Step 2: Implement `buildAxisHandle` + `disposeObject`** (match existing marker color/material conventions near `BORE_COLORS` :114; cache `lastMarkerSpecs` in `rebuildBoreMarkers` if not already)

```ts
function buildAxisHandle(pos: Vec3, axis: Vec3): THREE.Object3D {
  const len = 24, r = 1.2;
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffaa00, depthTest: false });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
  // CylinderGeometry is +Y aligned; rotate +Y → axis.
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
  shaft.quaternion.setFromUnitVectors(up, dir);
  group.add(shaft);
  for (const s of [1, -1]) {
    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 2.2, len * 0.25, 12), mat);
    cap.quaternion.setFromUnitVectors(up, dir.clone().multiplyScalar(s));
    cap.position.copy(dir.clone().multiplyScalar(s * len * 0.5));
    group.add(cap);
  }
  group.position.set(pos.x, pos.y, pos.z);
  group.renderOrder = 999;
  return group;
}
function disposeObject(o: THREE.Object3D) {
  o.traverse((c) => { const m = c as THREE.Mesh; m.geometry?.dispose?.(); (m.material as THREE.Material)?.dispose?.(); });
}
```

- [ ] **Step 3: Typecheck + existing SceneManager tests**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor && pnpm -r typecheck`
Run any existing SceneManager spec: `cd packages/app && npx vitest run --config vitest.config.ts src/viewport/__tests__/SceneManager*.spec.ts` (if present)
Expected: 0 new tsc errors; existing green. (Mesh appearance verified by e2e Task H.)

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/viewport/SceneManager.ts
git commit -m "feat(slice5): bore drag-gizmo mesh + rebuild-gate during drag + probe"
```

---

### Task G: Bore drag handler in App.tsx

**Files:**
- Modify: `packages/app/src/App.tsx` (pointer handler ~:2003-2106; SceneManager-init `useEffect` ~:1218)

**Design (§9.B + §9.D + §3 Unit D):** Mirror the `componentDragRef` pattern. Insert bore-drag handling **before the `dragBusy` guard** (§9.B). On a bore-hit pointerdown with a non-null `boreGizmoAxis`: stash `boreDragRef`, disable + abort OrbitControls (`releasePointerCapture(pointerId)`), set drag-active + gizmo. On move: compute delta via `signedDragDeltaAlongAxis` + `clampDeltaToFaceExtents`, move marker+gizmo. On up/cancel: re-enable controls, `bus.execute(MoveConnectorCommand)`, clear, suppress click. No unit test (integration wiring) — **verified by e2e Task H**.

- [ ] **Step 1: Add `orbitControlsRef` + populate it**

Near the other refs in `App`:
```ts
const orbitControlsRef = useRef<OrbitControls | null>(null);
const boreDragRef = useRef<null | {
  boreId: string; partPath: string; pointerId: number;
  worldAxis: Vec3; pivot: Vec3; rayStart: PointerRay;
  members: MemberOpts[]; markerMesh: THREE.Mesh | null; startUV: { u: number; v: number };
}>(null);
```
In the SceneManager-init `useEffect` (where `sm.getControls()` is already used ~:1218):
```ts
orbitControlsRef.current = sm.getControls();
```

- [ ] **Step 2: Build the pointer ray helper** (trusted three.js — NOT our projection code)

```ts
function pointerRayFrom(ev: { clientX: number; clientY: number }, sm: SceneManager): PointerRay {
  const ndc = sm.clientToNdc(ev.clientX, ev.clientY); // use existing client→NDC (Viewport.tsx:302 has the math); add sm.clientToNdc if absent
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), sm.getCamera());
  return { origin: { ...rc.ray.origin }, dir: { ...rc.ray.direction } };
}
```

- [ ] **Step 3: pointerdown branch — BEFORE `dragBusy` (§9.B)**

Insert in `handleViewportPointer`, before the `dragBusy` check (~:2014), inside the assembly-mode branch (mirror the assembly-picker placement ~:2003):
```ts
if (ev.type === 'pointerdown' && docKind === 'assembly') {
  const sm = viewportRef.current?.getSceneManager();
  const hit = sm ? viewportRef.current!.raycastBoreMarker(ev.clientX, ev.clientY) : null;
  if (sm && hit) {
    const bores = partBoresCacheRef.current.get(hit.partPath);
    const bore = bores?.find((b) => b.id === hit.boreId);
    const memberWorldQuat = /* the cup/this panel worldPose.quaternion for this bore */;
    const axis = bore ? boreGizmoAxis(bore, memberWorldQuat) : null;
    if (bore && axis) {
      const docs = getConnectorDocs();
      const members = collectConnectorMembers(bore.connectorId, docs); // MemberOpts[] for MoveConnectorCommand
      const pivot = sm.boreWorldPos(hit.boreId, hit.partPath); // returns the marker mesh world translation (added; reads matrixWorld AFTER raycast, §9.A)
      orbitControlsRef.current && (orbitControlsRef.current.enabled = false);
      sm.getControls().domElement.releasePointerCapture?.(ev.pointerId); // abort latched orbit, §9.B
      sm.setBoreDragActive(true);
      sm.setBoreGizmo({ worldPos: pivot, worldAxis: axis });
      boreDragRef.current = {
        boreId: hit.boreId, partPath: hit.partPath, pointerId: ev.pointerId,
        worldAxis: axis, pivot, rayStart: pointerRayFrom(ev, sm),
        members, markerMesh: sm.findBoreMarkerMesh(hit.boreId, hit.partPath), startUV: { u: bore.u, v: bore.v },
      };
      return; // consume; do not fall through to dragBusy/component-pick
    }
  }
}
```
> **Implementer note (flag for plan-verify):** confirm `raycastBoreMarker` is exposed on `ViewportRef` (Viewport.tsx:302 wraps it) or call via `sm`. Add small SceneManager accessors `boreWorldPos(boreId, partPath)` (reads the matching marker's `matrixWorld` translation — call `updateMatrixWorld` defensively) and `findBoreMarkerMesh(...)` if not present (reuse `boreMarkerList()` :649). Confirm `collectConnectorMembers` returns the `MemberOpts[]` shape `MoveConnectorCommand` wants (partPath/doc/bore/panelDims/worldPose); if it returns `ConnectorMember`, map to add partPath/doc from `docs`. Resolve `memberWorldQuat` from the bore's own member in `docs`.

- [ ] **Step 4: pointermove branch**

```ts
if (ev.type === 'move' && boreDragRef.current) {
  const sm = viewportRef.current!.getSceneManager()!;
  const d = boreDragRef.current;
  const raw = signedDragDeltaAlongAxis(d.worldAxis, d.pivot, d.rayStart, pointerRayFrom(ev, sm));
  const delta = clampDeltaToFaceExtents(d.members, d.worldAxis, raw);
  // live visual: translate marker + gizmo by delta·axis from pivot (no command, no bake)
  const off = { x: d.worldAxis.x * delta, y: d.worldAxis.y * delta, z: d.worldAxis.z * delta };
  sm.setBoreGizmo({ worldPos: { x: d.pivot.x + off.x, y: d.pivot.y + off.y, z: d.pivot.z + off.z }, worldAxis: d.worldAxis });
  d.markerMesh && d.markerMesh.position.set(d.pivot.x + off.x, d.pivot.y + off.y, d.pivot.z + off.z); // confirm marker uses matrix vs position; if matrixAutoUpdate=false, set matrix translation instead
  d.lastDelta = delta;
  return;
}
```
> **Implementer note:** markers use `matrixAutoUpdate=false` + `mesh.matrix` (`SceneManager.ts:701`). To move one live, set its `matrix` translation column (or temporarily enable autoUpdate + set position). Keep it simple; the authoritative geometry comes from the commit on release.

- [ ] **Step 5: pointerup + pointercancel branch**

```ts
if ((ev.type === 'pointerup' || ev.type === 'pointercancel') && boreDragRef.current) {
  const sm = viewportRef.current!.getSceneManager()!;
  const d = boreDragRef.current;
  if (orbitControlsRef.current) orbitControlsRef.current.enabled = true; // re-enable on EVERY exit, §9.B
  if (ev.type === 'pointerup' && d.lastDelta && Math.abs(d.lastDelta) > 1e-6) {
    void bus.execute(new MoveConnectorCommand({ members: d.members, worldDir: d.worldAxis, delta: d.lastDelta, opfs }));
    suppressNextClickRef.current = true; // §9.B: prevent the synthetic click re-selecting/clearing
  }
  sm.setBoreGizmo(null);
  sm.setBoreDragActive(false); // flushes any deferred marker rebuild → markers re-sync to committed u/v
  boreDragRef.current = null;
  return;
}
```
(Add `lastDelta?: number` to the `boreDragRef` type.)

- [ ] **Step 6: Render the gizmo on selection (not just during drag)** — when `selectedBoreId` changes and its `boreGizmoAxis` ≠ null, call `sm.setBoreGizmo({ worldPos, worldAxis })`; clear on deselect. Add a small `useEffect` keyed on `selectedBoreId/selectedBorePartPath` mirroring how markers react to selection. (So the handle is visible to grab before dragging.)

- [ ] **Step 7: Typecheck + app smoke**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor && pnpm -r typecheck`
Run: `cd packages/app && npx vitest run --config vitest.config.ts src/__tests__/App*.spec.tsx` (the known teardown-noise file is allowed)
Expected: 0 new tsc errors; app suite green modulo the known noise file.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/App.tsx
git commit -m "feat(slice5): bore drag handler (pre-dragBusy, orbit-abort, clamp, one bus.execute on release)"
```

---

### Task H: Real-DOM-pointer e2e (the false-green gate)

**Files:**
- Create: `packages/app/e2e/drag-gizmo.spec.ts`

**Design (§9.C BLOCKER):** Drive **real** `page.mouse.down/move/up` at the marker's screen coords via `worldToScreen3d` — NEVER a probe shortcut. Assert: (a) `MoveConnectorCommand` went through `bus.execute`; (b) 3-step undo (u changed, then restored); (c) OrbitControls disabled **mid-gesture** (between down and up) + camera matrix unchanged; (d) re-enabled after.

> **Run config (from prior-slice memory):** `playwright.worktree.config.ts` (port 5182, `reuseExistingServer:true`) is MASTER-TRACKED — do not alter it. Manually start `npx vite --port 5182` from the worktree's `packages/app` first, then `npx playwright test --config playwright.worktree.config.ts e2e/drag-gizmo.spec.ts`.

- [ ] **Step 1: Write the e2e**

```ts
import { test, expect } from '@playwright/test';

test('drag a carcass bore marker → command runs, undo reverts, orbit disabled mid-drag', async ({ page }) => {
  await page.goto('/');
  // Seed: build a cabinet with carcass bores into the active assembly via existing __zilventor seed probes,
  // then select the bore (so the gizmo renders). Reuse the slice-1/3/4 seeding helpers.
  await page.evaluate(async () => { await (window as any).__zilventorSeedCabinetWithBores(); });
  await page.waitForFunction(() => (window as any).__zilventorStore.getState().viewport?.getSceneManager()?.boreMarkerCount?.() > 0);

  // Pick a bore + its world pos; project to screen. FAIL LOUDLY on degenerate (0,0).
  const target = await page.evaluate(() => {
    const sm = (window as any).__zilventorStore.getState().viewport.getSceneManager();
    const { boreId, partPath } = sm.firstDraggableBore();      // add a tiny probe returning a carcass bore id+path
    (window as any).__zilventorStore.getState().setSelectedBore(boreId, partPath); // show gizmo
    const wp = sm.boreWorldPos(boreId, partPath);
    const s = sm.worldToScreen3d(wp.x, wp.y, wp.z);            // canvas-relative px
    const uv = (window as any).__zilventorReadBoreUV(boreId, partPath); // {u,v} from OPFS/live
    return { boreId, partPath, sx: s.x, sy: s.y, uBefore: uv.u };
  });
  expect(target.sx, 'worldToScreen3d degenerate (black scene?)').toBeGreaterThan(1);
  expect(target.sy).toBeGreaterThan(1);

  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  const camBefore = await page.evaluate(() => JSON.stringify((window as any).__zilventorStore.getState().viewport.getSceneManager().getCamera().matrixWorld.elements));

  await page.mouse.move(box.x + target.sx, box.y + target.sy);
  await page.mouse.down();
  await page.mouse.move(box.x + target.sx + 40, box.y + target.sy, { steps: 6 });
  // (c) mid-gesture: controls disabled
  const enabledMid = await page.evaluate(() => (window as any).__zilventorStore.getState().viewport.getSceneManager().getControls().enabled);
  expect(enabledMid, 'OrbitControls must be disabled mid-drag').toBe(false);
  await page.mouse.up();

  // (a) command ran through the bus + (b step 2) u changed
  const after = await page.evaluate((t) => {
    const uv = (window as any).__zilventorReadBoreUV(t.boreId, t.partPath);
    const lastCmd = (window as any).__zilventorStore.getState().bus.lastExecutedName?.(); // tiny probe or read undo stack top
    const enabled = (window as any).__zilventorStore.getState().viewport.getSceneManager().getControls().enabled;
    return { uAfter: uv.u, lastCmd, enabled };
  }, target);
  expect(after.uAfter).not.toBeCloseTo(target.uBefore, 3);  // §9.C step 2
  expect(after.lastCmd).toBe('MoveConnectorCommand');
  expect(after.enabled, 'controls re-enabled after drag').toBe(true);

  // camera unchanged across the drag (§9.B stronger check)
  const camAfter = await page.evaluate(() => JSON.stringify((window as any).__zilventorStore.getState().viewport.getSceneManager().getCamera().matrixWorld.elements));
  expect(camAfter).toBe(camBefore);

  // (b step 3) undo restores
  await page.evaluate(async () => { await (window as any).__zilventorStore.getState().bus.undo(); });
  const uUndo = await page.evaluate((t) => (window as any).__zilventorReadBoreUV(t.boreId, t.partPath).u, target);
  expect(uUndo).toBeCloseTo(target.uBefore, 3);              // §9.C step 3
});
```

> **Implementer note:** add the small probes referenced (`firstDraggableBore`, `boreWorldPos`, `worldToScreen3d` if not already, `__zilventorReadBoreUV`, `bus.lastExecutedName`/read undo-stack top, `__zilventorSeedCabinetWithBores` — reuse slice-4's seed). `worldToScreen3d` is claimed to exist (verify lens-3); if absent, add it (project world→NDC→canvas px via camera + `getBoundingClientRect`). These are dev-only probes, gated like the existing `__zilventor*` hooks.

- [ ] **Step 2: Start vite + run the e2e**

Run (background): `cd /Users/lion/Documents/Projects/mine/zilventor/<worktree>/packages/app && npx vite --port 5182`
Then: `cd /Users/lion/Documents/Projects/mine/zilventor/<worktree>/packages/app && npx playwright test --config playwright.worktree.config.ts e2e/drag-gizmo.spec.ts`
Expected: PASS. If it fails because the marker isn't hit, log `target.sx/sy` and the canvas box; do NOT downgrade to a probe-drive shortcut.

- [ ] **Step 3: Commit**

```bash
git add packages/app/e2e/drag-gizmo.spec.ts packages/app/src/**/  # include any new probes
git commit -m "test(slice5): real-DOM-pointer drag e2e (3-step undo + mid-drag orbit/camera probe)"
```

---

### Task I: OCCT centroid-move bake (geometry ground-truth)

**Files:**
- Create: `packages/kernel/src/__tests__/dragGizmoBake.integration.test.ts`

**Design (§9.C SHOULD-FIX):** A Ø5 hole's volume is unchanged by a move, so assert the drilled-face **centroid moved** by ≈ the delta along the axis. Bake the part with the bore at `u`, then at `u+Δ`, compare hole-face centroids via OCCT `GProp_GProps`.

- [ ] **Step 1: Write the failing test** (reuse slice-1/4 bake harness for `atFace` HolePlacement)

```ts
import { describe, it, expect } from 'vitest';
// Reuse the existing bake helpers from the slice-1/4 boring integration tests.

describe('drag-gizmo bake: moving a bore moves the hole', () => {
  it('a +20mm u shift moves the drilled-hole centroid by ~20mm along u', async () => {
    const panel = makeTestPanel(600, 400, 18);              // reuse existing helper
    const c0 = await bakeAndHoleCentroid(panel, { u: 100, v: 200, diameter: 5, depth: 12 }); // helper: bake atFace + GProp centroid of the hole face
    const c1 = await bakeAndHoleCentroid(panel, { u: 120, v: 200, diameter: 5, depth: 12 });
    const dx = Math.hypot(c1.x - c0.x, c1.y - c0.y, c1.z - c0.z);
    expect(dx).toBeCloseTo(20, 1);                          // moved by the delta, not just "a hole exists"
  });
});
```
> **Implementer note:** `bakeAndHoleCentroid` = bake the panel with one `atFace` bore (slice-1 path), then compute the centroid of the cut hole region via OCCT mass properties (`GProp_GProps` / `BRepGProp`). Reuse the slice-1/4 integration harness for the real-OCCT context.

- [ ] **Step 2: Run, verify it fails then passes**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx vitest run --config vitest.integration.config.ts src/__tests__/dragGizmoBake.integration.test.ts`
Expected: FAIL until helper wired (real-OCCT), then PASS (centroid moved ~20mm).

- [ ] **Step 3: Commit**

```bash
git add packages/kernel/src/__tests__/dragGizmoBake.integration.test.ts
git commit -m "test(slice5): OCCT centroid-move bake proves bore u/v reaches geometry"
```

---

## Verification gate (after all tasks)
1. `cd /Users/lion/Documents/Projects/mine/zilventor && pnpm -r typecheck` → 0 new errors.
2. shared suite: `cd packages/shared && npx vitest run` → all green (incl. 3 new units).
3. app suite: `cd packages/app && npx vitest run --config vitest.config.ts` → green modulo the 1 known App.spec teardown-noise file.
4. kernel integration: the new centroid bake green.
5. e2e: Task H green (real pointer dispatch).
6. **FINAL whole-branch §-by-§ review** of App.tsx + SceneManager + Viewport + panel against §9: OrbitControls re-enabled on every exit path (up + cancel); gizmo cleared on deselect + drag-end; marker rebuild deferred during drag and flushed after; no double bus push; bore pointerdown before `dragBusy`; no dead code; `suppressNextClickRef` ordering comment present.

---

## Self-review notes (author)
- **Spec coverage:** §9.A→Tasks A/C + G-notes; §9.B→Tasks E/F/G; §9.C→Tasks H/I + tsc gate; §9.D→Task D + G. §3 units A/B/C/F/G all have tasks. ✓
- **Type consistency:** `signedDragDeltaAlongAxis`, `boreGizmoAxis`, `clampDeltaToFaceExtents`, `setBoreGizmo`, `setBoreDragActive`, `boreGizmoVisible` used consistently across tasks. `MemberOpts`/`ConnectorMember` distinction flagged in G-notes (map if needed).
- **Known binding risks (for plan-verify to confirm against real APIs):** (1) `face2DFrame` returning extents vs adding `faceExtents`; (2) `collectConnectorMembers` output shape vs `MoveConnectorCommand` opts; (3) `raycastBoreMarker` exposure on `ViewportRef`; (4) marker live-move via `matrix` (autoUpdate=false); (5) `worldToScreen3d` existence; (6) Vec3/Quat/`rotate`/`dot`/`sub` export locations in shared.

---

## Plan Corrections v2 — AUTHORITATIVE (post 2-lens plan-verify)

The 2-lens plan-verify (math-by-hand conf 88 · scaffolding-vs-real-APIs conf 82) ran against the real code. **These corrections override the task bodies above where they conflict.** Apply ALL of them. Each is code-grounded (file:line).

### PC1 — Shared imports (BLOCKER). `connectorCoupling` does NOT re-export these.
- `Vec3`: `import type { Vec3 } from './types'` (`types.ts:201`).
- `rotate`: `import { rotate } from './jointMath'` (`jointMath.ts:25`). **Quaternions are a 4-tuple `[number,number,number,number]`, NOT a `Quat` object — there is no `Quat` type in shared.**
- `dot` is **private** in `connectorCoupling.ts:14`; `sub` does **not exist**. Define them locally in each new file:
```ts
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
```

### PC2 — `boreGizmoAxis` signature (BLOCKER). Quat param is a tuple.
```ts
export function boreGizmoAxis(bore: BoreOp, panelWorldQuat: [number, number, number, number]): Vec3 | null
```
Test identity quaternion = `[0, 0, 0, 1]` (NOT `{x,y,z,w}`). `rotate({x:1,y:0,z:0}, [0,0,0,1])` → `{x:1,y:0,z:0}`.

### PC3 — `closestAxisParam` formula is CORRECT — do NOT change it.
`(b·eD − dA)/denom` returns the **axis-line** parameter (closest axis point), which is geometrically correct (pointer at world x=5 → axis param +5). The math verifier's "negated" note was a t/s line-label swap; all Task A expected values (5, 0, −5, 4) are right. Leave the implementation as written in Task A Step 3.

### PC4 — Near-parallel guard returns `null`, not `0` (math F4). Prevents marker snap-back + `lastDelta` corruption.
`signedDragDeltaAlongAxis` returns `number | null`; **return `null`** (not 0) when `|axis·rayNow.dir| > GIZMO_AXIS_VIEW_PARALLEL_THRESHOLD`. Update Task A:
- Signature: `): number | null`.
- Guard line: `if (Math.abs(dot(axis, rayNow.dir)) > GIZMO_AXIS_VIEW_PARALLEL_THRESHOLD) return null;`
- Test "near-parallel" case: `expect(d).toBeNull();` (replace `toBe(0)`).
- Task G move branch: `const raw = signedDragDeltaAlongAxis(...); if (raw === null) return;` (skip the whole frame — preserves marker position AND `lastDelta`; do NOT clamp/move/commit on a null frame).

### PC5 — `ConnectorMember.worldPose` shape (BLOCKER). It is `{ translation, quaternion }`, NOT `{ position }`.
`ConnectorMember` (`connectorCoupling.ts:5-12`): `{ bore, panelDims, worldPose: { translation: Vec3; quaternion: [number,number,number,number] } }`. Fix the Task C and Task D test fixtures: use `worldPose: { translation: {x:0,y:0,z:0}, quaternion: [0,0,0,1] }` (NOT `position`/object-quat). `panelDims` is `{ length, width, thickness }` (matches).

### PC6 — `collectConnectorMembers` location + return type (FIX). No mapping needed.
It lives at `packages/app/src/shell/collectConnectorMembers.ts` (NOT `commands/`) and returns `ConnectorMemberFull[]`, which is **structurally identical to `MoveConnectorCommand`'s `MemberOpts`** (`MoveConnectorCommand.ts:9-15`: `{ bore, partPath, doc, panelDims, worldPose }`). Pass its output straight into `MoveConnectorCommand({ members, ... })` — drop the Task G "map if needed" note.

### PC7 — Add `faceExtents` to `bore.ts` (FIX). `face2DFrame` (`bore.ts:58`) returns only `{origin,uDir,vDir}`.
Add a sibling exporting the face's u/v lengths from `panelDims` by role (same role→dim mapping `face2DFrame` uses):
```ts
export function faceExtents(panelDims: PanelDims, role: PanelFaceRole): { uLen: number; vLen: number }
```
Top-face `uDir = {x:1,y:0,z:0}` confirmed (`bore.ts:66`) — Task C test `worldDir={x:1,y:0,z:0}` is valid. `PanelFaceRole` = `'Top'|'Bottom'|'Front'|'Back'|'Left'|'Right'`.

### PC8 — Marker live-move (BLOCKER). `position.set(...)` is IGNORED (`matrixAutoUpdate=false`, `SceneManager.ts:701`).
In Task G Step 4, replace `d.markerMesh.position.set(...)` with:
```ts
d.markerMesh.matrix.setPosition(d.pivot.x + off.x, d.pivot.y + off.y, d.pivot.z + off.z);
```

### PC9 — No `clientToNdc` on SceneManager (FIX). Build the pointer world-ray in the Viewport layer.
`sm.clientToNdc` does not exist. Add a method to `ViewportRef`/`Viewport.tsx` (it owns the canvas + camera) that returns the world ray:
```ts
// Viewport.tsx — mirror raycastBoreMarker's NDC math (~:302) then setFromCamera
pointerWorldRay(clientX: number, clientY: number): { origin: Vec3; dir: Vec3 } {
  const rect = canvasRef.current!.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, sm.getCamera());
  return { origin: { ...rc.ray.origin }, dir: { ...rc.ray.direction } };
}
```
Task G `pointerRayFrom` becomes `viewportRef.current!.pointerWorldRay(ev.clientX, ev.clientY)`.

### PC10 — `getConnectorDocs` is a JSX prop closure, NOT callable from `handleViewportPointer` (FIX).
Extract the docs-building logic into an App-scope `useCallback` `buildConnectorDocs()` and use it BOTH for the `BorePropertiesPanel` `getConnectorDocs` prop AND the drag handler. `opfs` in the handler = `opfsRef.current` (`App.tsx:1089`).

### PC11 — `OrbitControls` type import in App.tsx (FIX).
Add `import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'` (match the exact specifier `SceneManager.ts` uses).

### PC12 — `setBoreDragActive` flush calls `rebuildBoreMarkers()` with NO args (FIX).
`rebuildBoreMarkers()` reads `this.boreOverlaySpecs` (`SceneManager.ts:633`) — it takes no arguments. Remove the `lastMarkerSpecs` field/param from Task F; the flush is just `this.rebuildBoreMarkers();`.

### PC13 — Add SceneManager accessors for the handler/e2e (FIX). These do NOT exist yet.
- `boreWorldPos(boreId, partPath): Vec3` — find the marker in `boreMarkerList()` (`:649`) by `userData.boreId`+`partPath`, `mesh.updateMatrixWorld(true)`, read `matrixWorld` translation (`elements[12..14]`). (§9.A: world pos valid after updateMatrixWorld.)
- `findBoreMarkerMesh(boreId, partPath): THREE.Mesh | null` — same lookup, returns the mesh (for live-move).
- `firstDraggableBore(): { boreId, partPath } | null` — e2e helper: first marker whose bore has a non-null `boreGizmoAxis`.

### PC14 — e2e file location + probes (FIX).
- **File path:** `tests/e2e/drag-gizmo.spec.ts` (repo-root Playwright dir), NOT `packages/app/e2e/`.
- **Exist:** `__zilventorStore` (`App.tsx:410`), `__zilventorWorldToScreen3d` (`:416`), `__zilventorGetOpfs` (`:423`).
- **Add (dev-only `__zilventor*` hooks, gated like the others):** `__zilventorSeedCabinetWithBores` (reuse the slice-4 cabinet+bores seed), `__zilventorReadBoreUV(boreId, partPath)` (read live/OPFS u,v), and a bus probe — read the undo-stack top command's `name` (or add `bus.lastExecutedName()`).

### PC15 — Command name string (FIX). `MoveConnectorCommand.name = 'MoveConnector'` (`MoveConnectorCommand.ts:42`).
The e2e assertion must be `expect(after.lastCmd).toBe('MoveConnector')` (NOT `'MoveConnectorCommand'`).

### PC16 — `MoveConnectorCommand` already conforms to the bus (CONFIRMED, from spec §9.D). No command changes; Task D is purely the panel re-route + the bus round-trip guard test.
