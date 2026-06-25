# Variable-Height Drawer Banks (M4 Slice A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user specify an explicit height (mm) per drawer in a drawer bank; omitting heights preserves today's uniform behavior byte-identically.

**Architecture:** `AddDrawerBankCommand` already loops per-slot. Only slot *generation* (`drawerBankLayout`) and front *sizing* (`drawerFrontMath`) hardcode the uniform `openH/n` assumption. We add an optional `heights?: number[]` that flows dialog → command params → `drawerBankLayout` (which validates count/sum and tiles from cumulative offsets) → per-slot guard → the existing per-slot pipeline. The box/slide math is already per-slot and is untouched.

**Tech Stack:** TypeScript, pnpm workspaces (`packages/shared` pure fns, `packages/app` commands + React shell), Vitest (unit), Playwright (e2e), i18next (en/uk).

## Global Constraints

- **Branch:** `feat/m4-variable-height-drawers` (off `master`). Never commit/push to `master` (protected). Stay on the feature branch. Do NOT push (local master is ~20 commits ahead of origin, all intentionally unpushed).
- **Back-compat:** omitting `heights` MUST produce a result byte-identical to today. This is a hard requirement, tested explicitly.
- **Sum policy:** strict. `|Σheights − openH| > 0.5 mm` throws a translatable guard error *before any write*. No auto-absorb, no rescale.
- **No manifest version bump.** `heights` is a transient command param; confirmed NOT serialized into any `.ziasm`/manifest (`drawerSpec` does not carry it). Do not add a version bump.
- **No new `BoreRole`. No unrelated refactoring** of the drawer pipeline.
- **i18n:** every new user-facing string gets an `en` + `uk` key under the existing `dialog.drawerBank.*` namespace.
- **Verification:** `pnpm typecheck` must be 0 after each task. Lint scoped to changed files only (`pnpm exec eslint <files>` — full-repo lint OOMs). `packages/app` has no `test` script → run `pnpm exec vitest run <spec>` directly.
- **Error-message convention:** thrown errors embed the i18n key as a prefix, e.g. `new Error('drawerBank.error.tooSmall: ...')` (matches existing command code).

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `packages/shared/src/drawerBankLayout.ts` | Generate slots; accept `heights?`, validate count/sum, tile from cumulative offsets | 1 |
| `packages/shared/src/__tests__/drawerBankLayout.spec.ts` | Unit tests for above | 1 |
| `packages/shared/src/drawerFrontMath.ts` | Size a drawer front; consume a passed-in `slot` instead of recomputing slot edges | 2 |
| `packages/shared/src/__tests__/drawerFrontMath.spec.ts` | Unit tests for above (existing tests updated for new signature) | 2 |
| `packages/app/src/commands/AddDrawerBankCommand.ts` | Add `heights?` param; pass to layout; per-slot min-height guard; update front-math call site | 3 |
| `packages/app/src/commands/__tests__/AddDrawerBankCommand.spec.ts` | Unit tests for above | 3 |
| `packages/app/src/store/*` (AddDrawerBankDialogState) | `dims` becomes required; `onSubmit` gains `heights?` | 4 |
| `packages/app/src/shell/tabs/FurnitureTab.tsx` | Pick callback becomes async; derive dims; pass `dims` + `heights` | 4 |
| `packages/app/src/i18n/locales/en.json`, `uk.json` | New `drawerBank` keys | 4 |
| `packages/app/src/shell/DrawerBankDialog.tsx` | N height inputs + "remaining" helper + submit gate | 5 |
| `tests/e2e/m4-variable-height-drawers.spec.ts` | e2e: unequal heights → drawers render, 0 console errors | 6 |

**Dependency order:** 1 → 2 → 3 → 4 → 5 → 6. (Tasks 1 and 2 both touch shared pure fns; 2 imports the `Slot` type from 1 but the `Slot` *shape* is unchanged, so they could be done in parallel — but the plan sequences them for clarity.)

---

### Task 1: `drawerBankLayout` accepts explicit `heights?`

**Files:**
- Modify: `packages/shared/src/drawerBankLayout.ts` (current full contents below)
- Test: `packages/shared/src/__tests__/drawerBankLayout.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `drawerBankLayout(opening: { openBottomZ: number; openH: number }, n: number, heights?: number[]): Slot[]`. `Slot` shape unchanged: `{ index: number; bottomZ: number; topZ: number }`. Throws `Error('drawerBank.error.heightCount: ...')` when `heights.length !== n`; throws `Error('drawerBank.error.heightSum: ...')` when `|Σheights − openH| > 0.5`.

**Current contents (`drawerBankLayout.ts`, lines 1–11):**
```typescript
export interface Slot { index: number; bottomZ: number; topZ: number; }

export function drawerBankLayout(opening: { openBottomZ: number; openH: number }, n: number): Slot[] {
  if (n < 1) throw new Error('drawer count must be ≥ 1');
  const h = opening.openH / n;
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    bottomZ: opening.openBottomZ + i * h,
    topZ: opening.openBottomZ + (i + 1) * h,
  }));
}
```

- [ ] **Step 1: Write failing tests for variable heights**

Append to `packages/shared/src/__tests__/drawerBankLayout.spec.ts` (keep existing tests). Match house style (`toBeCloseTo(..., 6)`):

```typescript
describe('drawerBankLayout — explicit heights', () => {
  it('tiles non-uniform heights from cumulative offsets (no gap/overlap)', () => {
    const openBottomZ = 100;
    const slots = drawerBankLayout({ openBottomZ, openH: 600 }, 3, [100, 200, 300]);
    expect(slots).toHaveLength(3);
    expect(slots[0]!.bottomZ).toBeCloseTo(100, 6);
    expect(slots[0]!.topZ).toBeCloseTo(200, 6);
    expect(slots[1]!.bottomZ).toBeCloseTo(slots[0]!.topZ, 6); // 200
    expect(slots[1]!.topZ).toBeCloseTo(400, 6);
    expect(slots[2]!.bottomZ).toBeCloseTo(slots[1]!.topZ, 6); // 400
    expect(slots[2]!.topZ).toBeCloseTo(700, 6);
    // each slot height matches its requested value
    expect(slots[0]!.topZ - slots[0]!.bottomZ).toBeCloseTo(100, 6);
    expect(slots[1]!.topZ - slots[1]!.bottomZ).toBeCloseTo(200, 6);
    expect(slots[2]!.topZ - slots[2]!.bottomZ).toBeCloseTo(300, 6);
  });

  it('throws heightSum when heights do not sum to openH (> 0.5mm)', () => {
    expect(() => drawerBankLayout({ openBottomZ: 100, openH: 600 }, 3, [100, 200, 290]))
      .toThrow(/drawerBank\.error\.heightSum/);
  });

  it('accepts heights within ±0.5mm of openH', () => {
    expect(() => drawerBankLayout({ openBottomZ: 100, openH: 600 }, 3, [100, 200, 300.4]))
      .not.toThrow();
  });

  it('throws heightCount when heights.length !== n', () => {
    expect(() => drawerBankLayout({ openBottomZ: 100, openH: 600 }, 3, [300, 300]))
      .toThrow(/drawerBank\.error\.heightCount/);
  });

  it('omitting heights yields the uniform split (regression)', () => {
    const a = drawerBankLayout({ openBottomZ: 100, openH: 600 }, 3);
    const b = drawerBankLayout({ openBottomZ: 100, openH: 600 }, 3, [200, 200, 200]);
    a.forEach((s, i) => {
      expect(s.bottomZ).toBeCloseTo(b[i]!.bottomZ, 6);
      expect(s.topZ).toBeCloseTo(b[i]!.topZ, 6);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/drawerBankLayout.spec.ts`
Expected: the new tests FAIL — `heightSum`/`heightCount` not thrown, and `drawerBankLayout` called with 3 args is a TS/arity issue or the 3rd arg is ignored. (Existing uniform tests still pass.)

- [ ] **Step 3: Implement variable-height support**

Replace the body of `drawerBankLayout.ts`:

```typescript
export interface Slot { index: number; bottomZ: number; topZ: number; }

export function drawerBankLayout(
  opening: { openBottomZ: number; openH: number },
  n: number,
  heights?: number[],
): Slot[] {
  if (n < 1) throw new Error('drawer count must be ≥ 1');

  if (heights === undefined) {
    const h = opening.openH / n;
    return Array.from({ length: n }, (_, i) => ({
      index: i,
      bottomZ: opening.openBottomZ + i * h,
      topZ: opening.openBottomZ + (i + 1) * h,
    }));
  }

  if (heights.length !== n) {
    throw new Error(
      `drawerBank.error.heightCount: expected ${n} heights, got ${heights.length}`,
    );
  }
  const sum = heights.reduce((acc, v) => acc + v, 0);
  if (Math.abs(sum - opening.openH) > 0.5) {
    throw new Error(
      `drawerBank.error.heightSum: heights sum to ${sum}mm, opening is ${opening.openH}mm`,
    );
  }

  const slots: Slot[] = [];
  let cursor = opening.openBottomZ;
  for (let i = 0; i < n; i++) {
    const bottomZ = cursor;
    const topZ = bottomZ + heights[i]!;
    slots.push({ index: i, bottomZ, topZ });
    cursor = topZ;
  }
  return slots;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/drawerBankLayout.spec.ts`
Expected: PASS (all new + existing).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck` (expect 0) and `cd /Users/lion/Documents/Projects/mine/zilventor && pnpm exec eslint packages/shared/src/drawerBankLayout.ts`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/drawerBankLayout.ts packages/shared/src/__tests__/drawerBankLayout.spec.ts
git commit -m "feat(m4-a): drawerBankLayout accepts explicit per-drawer heights"
```

---

### Task 2: `drawerFrontMath` consumes a passed-in `slot`

**Files:**
- Modify: `packages/shared/src/drawerFrontMath.ts` (signature lines 60–66; internal recompute lines 70–72)
- Test: `packages/shared/src/__tests__/drawerFrontMath.spec.ts` (existing tests must be updated — they break)

**Interfaces:**
- Consumes: `Slot` type from `./drawerBankLayout`.
- Produces: `drawerFrontMath(index: number, n: number, slot: Slot, opening: { openW: number; frontY: number }, overlay: 'full' | 'half' | 'inset', params: DrawerFrontParams): DrawerFrontResult`. Behavior: front edges derive from `slot.bottomZ`/`slot.topZ`; first (`index===0`) and last (`index===n-1`) fronts get `overhang`, interior edges get `GAP/2` (unchanged); adjacent-gap invariant `bottomZ_{i+1} − topZ_i === DRAWER_FRONT_GAP` holds for unequal slots.

**Current signature (lines 60–66):**
```typescript
export function drawerFrontMath(
  index: number,
  n: number,
  opening: { openBottomZ: number; openH: number; openW: number; frontY: number },
  overlay: 'full' | 'half' | 'inset',
  params: DrawerFrontParams,
): DrawerFrontResult
```

**Internal recompute to REPLACE (lines 70–72):**
```typescript
const slotH = openH / n;
const slotBottomZ = openBottomZ + index * slotH;
const slotTopZ = openBottomZ + (index + 1) * slotH;
```

- [ ] **Step 1: Update existing tests + add non-uniform tests (red)**

In `packages/shared/src/__tests__/drawerFrontMath.spec.ts`:

1. Add import at top: `import { drawerBankLayout } from '../drawerBankLayout';`
2. Every existing call `drawerFrontMath(i, n, opening, overlay, params)` becomes slot-driven. Replace the existing `opening` constant and call sites. Example — the existing adjacent-gap test becomes:

```typescript
const FULL_OPENING = { openBottomZ: 100, openH: 600, openW: 564, frontY: 500 };
const params = { Tc: 18, reveal: 2, insetClearance: 2 };

it('adjacent fronts leave exactly DRAWER_FRONT_GAP, no overlap (N=3 uniform)', () => {
  const slots = drawerBankLayout(FULL_OPENING, 3);
  const o = { openW: FULL_OPENING.openW, frontY: FULL_OPENING.frontY };
  const f = [0, 1, 2].map((i) => drawerFrontMath(i, 3, slots[i]!, o, 'full', params));
  expect(f[1]!.bottomZ - f[0]!.topZ).toBeCloseTo(DRAWER_FRONT_GAP, 6);
  expect(f[2]!.bottomZ - f[1]!.topZ).toBeCloseTo(DRAWER_FRONT_GAP, 6);
  expect(f[0]!.bottomZ).toBeCloseTo(100 - 18, 6);
  expect(f[2]!.topZ).toBeCloseTo(700 + 18, 6);
  expect(f[0]!.width).toBeCloseTo(564 + 2 * 18, 6);
});
```

Apply the same transform to every other existing test (inset tests that reconstruct `slotBottomZ/slotTopZ` from `opening.openBottomZ + i*slotH` should instead read `slots[i]!.bottomZ`/`.topZ`).

3. Add a NEW non-uniform test:

```typescript
it('sizes fronts from non-uniform slots; adjacent gap holds; first/last overhang (N=3 [100,200,300])', () => {
  const slots = drawerBankLayout(FULL_OPENING, 3, [100, 200, 300]);
  const o = { openW: FULL_OPENING.openW, frontY: FULL_OPENING.frontY };
  const f = [0, 1, 2].map((i) => drawerFrontMath(i, 3, slots[i]!, o, 'full', params));
  // adjacent gap invariant under unequal slots
  expect(f[1]!.bottomZ - f[0]!.topZ).toBeCloseTo(DRAWER_FRONT_GAP, 6);
  expect(f[2]!.bottomZ - f[1]!.topZ).toBeCloseTo(DRAWER_FRONT_GAP, 6);
  // first/last overhang anchored to opening extremes
  expect(f[0]!.bottomZ).toBeCloseTo(100 - 18, 6);
  expect(f[2]!.topZ).toBeCloseTo(700 + 18, 6);
  // middle front height reflects its 200mm slot (minus the two GAP/2 interior reveals)
  expect(f[1]!.topZ - f[1]!.bottomZ).toBeLessThan(f[2]!.topZ - f[2]!.bottomZ);
  // inset width unchanged by height variation
  const fi = drawerFrontMath(0, 3, slots[0]!, o, 'inset', params);
  expect(fi.width).toBeCloseTo(564 - 2 * 2, 6); // openW - 2*insetClearance
});
```

> Note: confirm the exact `inset` width expression against the current code while editing — keep whatever the existing inset test asserted, just feed it from `slots[i]!`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/drawerFrontMath.spec.ts`
Expected: FAIL — `drawerFrontMath` does not yet accept a `slot` param (arity/type mismatch).

- [ ] **Step 3: Change the signature + internal recompute (minimal/surgical)**

In `drawerFrontMath.ts`:

1. Add import at top: `import type { Slot } from './drawerBankLayout';`
2. Change the signature (lines 60–66) to insert `slot: Slot` as the 3rd param and shrink `opening`:

```typescript
export function drawerFrontMath(
  index: number,
  n: number,
  slot: Slot,
  opening: { openW: number; frontY: number },
  overlay: 'full' | 'half' | 'inset',
  params: DrawerFrontParams,
): DrawerFrontResult
```

3. Replace lines 70–72 (the recompute) — **keep the same local variable names** so the rest of the body is untouched:

```typescript
const slotH = slot.topZ - slot.bottomZ;
const slotBottomZ = slot.bottomZ;
const slotTopZ = slot.topZ;
```

4. If the destructuring at the top of the function pulled `openBottomZ`/`openH` out of `opening`, remove those two names from the destructure (they no longer exist on `opening`). Leave `openW`/`frontY` destructuring intact. `n` and `index` are still parameters and still used for the overlay boundary logic.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/drawerFrontMath.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck` (expect 0 — this will fail in `AddDrawerBankCommand.ts` until Task 3; if so, note it and proceed, OR do Step 6 of Task 3's call-site fix as part of this commit). Run `pnpm exec eslint packages/shared/src/drawerFrontMath.ts packages/shared/src/__tests__/drawerFrontMath.spec.ts`.

> **Cross-task note:** changing `drawerFrontMath`'s signature breaks its only production caller (`AddDrawerBankCommand.ts:165`). `pnpm typecheck` will report that error until Task 3 updates the call site. This is expected; the shared-package tests are green. If you want a clean typecheck at this commit, jump to Task 3 Step 5 (call-site update) and fold it into this commit. Otherwise commit the shared change and immediately do Task 3.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/drawerFrontMath.ts packages/shared/src/__tests__/drawerFrontMath.spec.ts
git commit -m "feat(m4-a): drawerFrontMath consumes per-slot edges instead of recomputing"
```

---

### Task 3: `AddDrawerBankCommand` — `heights?` param, per-slot guard, call-site update

**Files:**
- Modify: `packages/app/src/commands/AddDrawerBankCommand.ts` (params ~67; guard ~130–143; layout call ~146; front-math call ~165–169)
- Test: `packages/app/src/commands/__tests__/AddDrawerBankCommand.spec.ts`

**Interfaces:**
- Consumes: `drawerBankLayout(opening, n, heights?)` (Task 1); `drawerFrontMath(index, n, slot, { openW, frontY }, overlay, params)` (Task 2).
- Produces: `AddDrawerBankParams` gains `heights?: number[]`. `apply()` passes `params.heights` to `drawerBankLayout`. Per-slot min-height guard throws `drawerBank.error.tooSmall` when any `slot.topZ − slot.bottomZ <= 24`.

**Current params (lines 67–71):**
```typescript
export interface AddDrawerBankParams {
  count: number;
  overlay: 'full' | 'half' | 'inset';
  thickness: number;
}
```

**Current guard block (lines 130–143):**
```typescript
if (N < 1) {
  throw new Error('drawerBank.error.tooSmall: count must be ≥ 1');
}
const slotH = openH / N;
if (openW <= 57) {
  throw new Error(`drawerBank.error.tooSmall: cabinet opening width ${openW}mm is ≤ 57mm ...`);
}
if (slotH <= 24) {
  throw new Error(`drawerBank.error.tooSmall: drawer slot height ${slotH}mm is ≤ 24mm ...`);
}
```

**Current layout call (line 146):** `const slots = drawerBankLayout({ openBottomZ, openH }, N);`

**Current front-math call (lines 165–169):**
```typescript
const front = drawerFrontMath(i, N, { openBottomZ, openH, openW, frontY }, params.overlay, {
  Tc: dims.Tc,
  reveal: 2,
  insetClearance: 2,
});
```

- [ ] **Step 1: Write failing tests**

Append to `packages/app/src/commands/__tests__/AddDrawerBankCommand.spec.ts` (reuse existing `MemOpfs`/`makeKernel`/`seedCabinet` harness). Patterns:

```typescript
it('back-compat: omitting heights is byte-identical to today', async () => {
  // bank A — no heights
  const opfsA = new MemOpfs(); const kernelA = makeKernel();
  const pathA = await seedCabinet(opfsA);
  await new AddDrawerBankCommand({ cabinetPath: pathA, params: { count: 3, overlay: 'full', thickness: 18 }, opfs: opfsA, store: useAppStore }).apply();
  // bank B — heights equal to the equal split
  const opfsB = new MemOpfs(); const kernelB = makeKernel();
  const pathB = await seedCabinet(opfsB);
  // openH for the seeded cabinet must be known; derive the equal split or read from a helper.
  // Use the same split the command would: openH/3 each.
  const split = await equalSplitForSeed(opfsB, pathB, 3); // helper: returns number[] summing to openH
  await new AddDrawerBankCommand({ cabinetPath: pathB, params: { count: 3, overlay: 'full', thickness: 18, heights: split }, opfs: opfsB, store: useAppStore }).apply();
  // compare the written component instances (positions/sizes) between A and B
  expect(await dumpDrawerGeometry(opfsB, pathB)).toEqual(await dumpDrawerGeometry(opfsA, pathA));
});

it('applies explicit unequal heights → N fronts at expected Z', async () => {
  const opfs = new MemOpfs();
  const path = await seedCabinet(opfs);
  const heights = await someUnequalSplit(opfs, path, 3); // e.g. [openH*0.25, openH*0.35, openH*0.40]
  await new AddDrawerBankCommand({ cabinetPath: path, params: { count: 3, overlay: 'full', thickness: 18, heights }, opfs, store: useAppStore }).apply();
  const geo = await dumpDrawerGeometry(opfs, path);
  expect(geo).toHaveLength(3);
  // first front bottom anchored, last front top anchored, ascending
  expect(geo[0]!.bottomZ).toBeLessThan(geo[1]!.bottomZ);
});

it('per-slot guard throws tooSmall when a height is ≤ 24mm', async () => {
  const opfs = new MemOpfs();
  const path = await seedCabinet(opfs);
  const openH = await openHForSeed(opfs, path); // helper
  const heights = [10, (openH - 20) / 2 + 5, (openH - 20) / 2 + 5]; // first slot 10mm ≤ 24
  // adjust so sum === openH and first ≤ 24
  await expect(
    new AddDrawerBankCommand({ cabinetPath: path, params: { count: 3, overlay: 'full', thickness: 18, heights }, opfs, store: useAppStore }).apply(),
  ).rejects.toThrow(/drawerBank\.error\.tooSmall/);
});

it('sum-mismatch heights throw heightSum before writing', async () => {
  const opfs = new MemOpfs();
  const path = await seedCabinet(opfs);
  await expect(
    new AddDrawerBankCommand({ cabinetPath: path, params: { count: 3, overlay: 'full', thickness: 18, heights: [50, 50, 50] }, opfs, store: useAppStore }).apply(),
  ).rejects.toThrow(/drawerBank\.error\.heightSum/);
});

it('revert restores prior state after a variable-height apply', async () => {
  const opfs = new MemOpfs();
  const path = await seedCabinet(opfs);
  const before = await opfs.read(path);
  const heights = await someUnequalSplit(opfs, path, 3);
  const cmd = new AddDrawerBankCommand({ cabinetPath: path, params: { count: 3, overlay: 'full', thickness: 18, heights }, opfs, store: useAppStore });
  await cmd.apply();
  await cmd.revert();
  expect(await opfs.read(path)).toEqual(before);
});
```

> **Implementer note:** the existing spec already has helpers to read back drawer geometry / cabinet dims. Reuse them — do NOT invent `equalSplitForSeed`/`dumpDrawerGeometry`/`openHForSeed` if equivalents exist. If not, write tiny local helpers in the spec file that read the cabinet via the same path the command uses (`unpackAssembly(await opfs.read(path))` + `deriveCabinetDims`). The byte-identical test is the load-bearing one — make it compare the actual written component instances (positions + dims), not console output.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/app && pnpm exec vitest run src/commands/__tests__/AddDrawerBankCommand.spec.ts`
Expected: FAIL — `heights` not accepted / guard not per-slot.

- [ ] **Step 3: Add `heights?` to params**

```typescript
export interface AddDrawerBankParams {
  count: number;
  overlay: 'full' | 'half' | 'inset';
  thickness: number;
  heights?: number[];
}
```

- [ ] **Step 4: Pass `heights` to layout + replace the degenerate guard with a per-slot loop**

Change the layout call (line 146):
```typescript
const slots = drawerBankLayout({ openBottomZ, openH }, N, params.heights);
```

Replace the guard block (lines 130–143). Keep the `count < 1` and `openW <= 57` guards; **remove** the single `const slotH = openH / N;` + `if (slotH <= 24)` and move the min-height check to a per-slot loop placed *after* `drawerBankLayout` runs (so `drawerBankLayout` validates count/sum first, then the command validates per-slot minimum):

```typescript
if (N < 1) {
  throw new Error('drawerBank.error.tooSmall: count must be ≥ 1');
}
if (openW <= 57) {
  throw new Error(`drawerBank.error.tooSmall: cabinet opening width ${openW}mm is ≤ 57mm to fit a drawer box`);
}

// drawerBankLayout validates heights count + sum (throws heightCount/heightSum) before any write.
const slots = drawerBankLayout({ openBottomZ, openH }, N, params.heights);

// per-slot minimum-height guard (replaces the old single slotH check)
for (const slot of slots) {
  const slotH = slot.topZ - slot.bottomZ;
  if (slotH <= 24) {
    throw new Error(`drawerBank.error.tooSmall: drawer slot ${slot.index + 1} height ${slotH}mm is ≤ 24mm`);
  }
}
```

> Ensure there is only ONE `drawerBankLayout(...)` call now (the old one at line ~146 is replaced by the one inside this block). Delete the old standalone call to avoid running it twice.

- [ ] **Step 5: Update the `drawerFrontMath` call site (lines 165–169)**

```typescript
const front = drawerFrontMath(i, N, slot, { openW, frontY }, params.overlay, {
  Tc: dims.Tc,
  reveal: 2,
  insetClearance: 2,
});
```

(`slot` is the current loop variable; `currentSlotH` at line ~162 stays as-is.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/app && pnpm exec vitest run src/commands/__tests__/AddDrawerBankCommand.spec.ts`
Expected: PASS (including back-compat byte-identical).

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm typecheck` (expect 0 now — the shared signature change from Task 2 is satisfied). `pnpm exec eslint packages/app/src/commands/AddDrawerBankCommand.ts packages/app/src/commands/__tests__/AddDrawerBankCommand.spec.ts`.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/commands/AddDrawerBankCommand.ts packages/app/src/commands/__tests__/AddDrawerBankCommand.spec.ts
git commit -m "feat(m4-a): AddDrawerBankCommand accepts heights + per-slot min-height guard"
```

---

### Task 4: Store type + FurnitureTab dims wiring + i18n keys

**Files:**
- Modify: store file defining `AddDrawerBankDialogState` (locate: grep `AddDrawerBankDialogState`; brief reports it ~`packages/app/src/store/*` lines 128–135)
- Modify: `packages/app/src/shell/tabs/FurnitureTab.tsx` (pick callback ~187–213)
- Modify: `packages/app/src/i18n/locales/en.json`, `packages/app/src/i18n/locales/uk.json` (`drawerBank` block ~191–203)

**Interfaces:**
- Produces: `AddDrawerBankDialogState.dims` becomes **required** `{ openW: number; openH: number }`; `onSubmit` param type gains `heights?: number[]`. FurnitureTab's pick callback derives dims and always passes them; its `onSubmit` forwards `heights` to `AddDrawerBankCommand`.

**Current `AddDrawerBankDialogState` (store, ~128–135):**
```typescript
export type AddDrawerBankDialogState = {
  cabinetPath: string;
  dims?: { openW: number; openH: number };
  onSubmit: (params: {
    count: number;
    overlay: 'full' | 'half' | 'inset';
    thickness: number;
  }) => void;
  onCancel: () => void;
};
```

**Current `deriveCabinetDims` (`packages/app/src/commands/cabinetDims.ts:18`):**
```typescript
export async function deriveCabinetDims(
  cab: AssemblyDocument,
  opfs: Pick<OpfsReader, 'read'>,
): Promise<{ width: number; height: number; depth: number; Tc: number; toekickHeight: number }>
```

**Current `apply()` derivation (`AddDrawerBankCommand.ts:119–128`) — mirror this in FurnitureTab:**
```typescript
const cab = await unpackAssembly(await opfs.read(cabinetPath));
const dims = await deriveCabinetDims(cab, opfs);
const openW = dims.width - 2 * dims.Tc;
const openH = dims.height - dims.toekickHeight - 2 * dims.Tc;
```

- [ ] **Step 1: Make `dims` required + add `heights?` to `onSubmit`**

Edit `AddDrawerBankDialogState`:
```typescript
export type AddDrawerBankDialogState = {
  cabinetPath: string;
  dims: { openW: number; openH: number };
  onSubmit: (params: {
    count: number;
    overlay: 'full' | 'half' | 'inset';
    thickness: number;
    heights?: number[];
  }) => void;
  onCancel: () => void;
};
```

- [ ] **Step 2: FurnitureTab — make the pick callback async, derive dims, pass dims + heights**

In `FurnitureTab.tsx` (~187–213). Add imports near the top (verify they aren't already present):
```typescript
import { deriveCabinetDims } from '../../commands/cabinetDims';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
```

Replace the pick callback:
```typescript
const handle = viewport.beginOneComponentPick(resolvePartPath, async (cabinetPath: string) => {
  useAppStore.getState().setOneComponentPickHandle(null);
  const opfs = await Opfs.forNavigator();
  const cab = await unpackAssembly(await opfs.read(cabinetPath));
  const raw = await deriveCabinetDims(cab, opfs);
  const openW = raw.width - 2 * raw.Tc;
  const openH = raw.height - raw.toekickHeight - 2 * raw.Tc;
  useAppStore.getState().setAddDrawerBankDialog({
    cabinetPath,
    dims: { openW, openH },
    onSubmit: async (p) => {
      const opfs2 = await Opfs.forNavigator();
      await useAppStore.getState().bus.execute(
        new AddDrawerBankCommand({
          cabinetPath,
          params: { count: p.count, overlay: p.overlay, thickness: p.thickness, heights: p.heights },
          opfs: opfs2,
          store: useAppStore,
        }),
      );
    },
    onCancel: () => useAppStore.getState().setAddDrawerBankDialog(null),
  });
});
```

> Verify `beginOneComponentPick`'s second-arg type accepts `(path: string) => void | Promise<void>`. If it's typed `=> void`, widen it to `=> void | Promise<void>` (its callers don't await it, so this is safe). If widening is needed, do it in the same commit and note it.

- [ ] **Step 3: Add i18n keys (en + uk)**

`en.json` — extend the existing `dialog.drawerBank` block:
```json
"drawerBank": {
  "title": "Add Drawer Bank",
  "count": "Count",
  "overlay": "Overlay",
  "overlayFull": "Full",
  "overlayHalf": "Half",
  "overlayInset": "Inset",
  "thickness": "Thickness (mm)",
  "heights": "Drawer heights (mm)",
  "heightN": "Drawer {{n}}",
  "remaining": "Remaining: {{mm}} mm",
  "error": {
    "invalidCount": "Count must be between 2 and 10",
    "tooSmall": "Cabinet opening is too small to fit drawers",
    "heightSum": "Heights must sum to the opening height ({{openH}} mm)",
    "heightCount": "Enter one height for each drawer"
  }
}
```

`uk.json` — same keys, Ukrainian values (review for tone):
```json
"heights": "Висоти шухляд (мм)",
"heightN": "Шухляда {{n}}",
"remaining": "Залишок: {{mm}} мм",
...
"heightSum": "Сума висот має дорівнювати висоті отвору ({{openH}} мм)",
"heightCount": "Вкажіть висоту для кожної шухляди"
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck` (expect 0). `pnpm exec eslint packages/app/src/shell/tabs/FurnitureTab.tsx <store-file> packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/uk.json` (eslint may skip JSON; that's fine — JSON validity is checked by typecheck/runtime).

> Until Task 5 updates the dialog component to read `dims` and emit `heights`, the dialog still compiles (it just ignores the new fields). `dims` being required is satisfied because FurnitureTab now always passes it. Any other caller of `setAddDrawerBankDialog` (grep to confirm there are none) must also pass `dims`.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/tabs/FurnitureTab.tsx packages/app/src/store packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/uk.json
git commit -m "feat(m4-a): wire cabinet dims to drawer-bank dialog + heights param + i18n keys"
```

---

### Task 5: `DrawerBankDialog` — N height inputs, remaining helper, submit gate

**Files:**
- Modify: `packages/app/src/shell/DrawerBankDialog.tsx` (form state ~52–55; submit ~85–88; OK disable ~171)

**Interfaces:**
- Consumes: `dims.openH` (Task 4); `onSubmit` accepting `heights?` (Task 4).
- Produces: when `count` is valid, renders N number inputs pre-filled with `openH/N`, a live "remaining: X mm" helper from `openH − Σ`, and disables submit unless `|Σ − openH| ≤ 0.5`. Submitting passes `heights`.

**Verification:** this is pure-visual UI — verified via the Task 6 e2e flow (per the project's UI verification posture), not a component unit test. Keep the logic minimal and correct.

- [ ] **Step 1: Add height state, pre-fill, and the remaining/gate logic**

Read the current `DrawerBankDialog.tsx` fully first. Then:

1. Read `dims` from the dialog state (the component already receives the `AddDrawerBankDialogState`; pull `dims.openH`).
2. Add state `const [heightStrs, setHeightStrs] = useState<string[]>([])`.
3. When `countValid` and `count` changes, (re)initialize `heightStrs` to the equal split: `Array.from({ length: count }, () => String(round(openH / count)))`. Use a `useEffect` keyed on `[count, openH]`. Round to a sensible precision (e.g. `Math.round(openH/count)` — but then the last field must absorb the rounding remainder so the initial split sums exactly to `openH`; set the last entry to `openH − Σ(others)`).
4. Parse to numbers: `const heights = heightStrs.map(Number)`; `const sum = heights.reduce((a,b)=>a+b, 0)`.
5. Compute `const remaining = openH - sum;` and `const heightsValid = Number.isFinite(sum) && Math.abs(remaining) <= 0.5 && heights.every((h) => Number.isFinite(h) && h > 0);`

- [ ] **Step 2: Render the inputs + helper**

When `countValid`, render N number inputs (labels `t('dialog.drawerBank.heightN', { n: i + 1 })`) bound to `heightStrs[i]`, plus a helper line `t('dialog.drawerBank.remaining', { mm: round(remaining) })`. Section label `t('dialog.drawerBank.heights')`.

- [ ] **Step 3: Gate submit + pass heights**

Change the OK-disabled condition (line ~171) to `!countValid || !heightsValid`. On submit (line ~85–88), pass `heights`:
```typescript
onSubmit({ count, overlay, thickness, heights });
```
(Passing the equal split is equivalent to omitting — back-compat preserved by Task 1/Task 3.)

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck` (expect 0). `pnpm exec eslint packages/app/src/shell/DrawerBankDialog.tsx`.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/DrawerBankDialog.tsx
git commit -m "feat(m4-a): drawer-bank dialog — per-drawer height inputs + sum gate"
```

---

### Task 6: e2e — variable-height drawer flow

**Files:**
- Create: `tests/e2e/m4-variable-height-drawers.spec.ts`

**Interfaces:**
- Consumes: the full wired feature (Tasks 1–5).

**Reference test:** `tests/e2e/prisadka-slice4-drawer-banks.spec.ts` (app launch `page.goto('/')` + `waitForKernelReady`; console-error filter pattern at its lines ~425–428).

- [ ] **Step 1: Write the e2e test**

Two viable paths — prefer driving the real dialog UI (it's the new surface). If the dialog is reachable only via 3D viewport picking (hard to drive headlessly), fall back to injecting `AddDrawerBankCommand` with `heights` via `page.evaluate` (the slice-4 test's pattern) AND a lighter DOM assertion that the dialog renders N height inputs.

```typescript
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

test('variable-height drawer bank renders with no console errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto('/');
  await waitForKernelReady(page);

  // Seed a cabinet + apply a variable-height bank via the command (deterministic, headless-safe):
  await page.evaluate(async () => {
    // build/seed a cabinet through the same path the app uses, then:
    const { AddDrawerBankCommand } = await import('/src/commands/AddDrawerBankCommand.ts');
    const store = (window as any).__zilventorStore;
    const cabinetPath = /* seeded cabinet .ziasm path */;
    const openH = /* derived openH for the seed */;
    const heights = [openH * 0.25, openH * 0.35, openH * 0.40];
    const { Opfs } = await import('/src/storage/Opfs.ts');
    const opfs = await Opfs.forNavigator();
    await store.getState().bus.execute(new AddDrawerBankCommand({
      cabinetPath, params: { count: 3, overlay: 'full', thickness: 18, heights }, opfs, store,
    }));
  });

  const realErrors = consoleErrors.filter((e) => !e.includes('ResizeObserver') && !e.includes('favicon'));
  expect(realErrors, 'no browser errors during variable-height drawer flow').toHaveLength(0);
});
```

> Reuse the slice-4 test's exact cabinet-seeding code (copy its `page.evaluate` seed block). Do not invent new seeding. If a dialog-driven variant is feasible, add a second test that opens the dialog, fills 3 unequal heights summing to `openH`, asserts the OK button enables only when remaining ≈ 0, submits, and asserts 0 console errors + a screenshot.

- [ ] **Step 2: Run the e2e test**

Run: `pnpm test:e2e -- --grep "variable-height"`
Expected: PASS, 0 console errors. Read back any screenshot artifact.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/m4-variable-height-drawers.spec.ts
git commit -m "test(m4-a): e2e variable-height drawer bank renders, 0 console errors"
```

---

## Final verification (after all tasks)

- [ ] `pnpm typecheck` → 0
- [ ] `cd packages/shared && pnpm exec vitest run src/__tests__/drawerBankLayout.spec.ts src/__tests__/drawerFrontMath.spec.ts` → green
- [ ] `cd packages/app && pnpm exec vitest run src/commands/__tests__/AddDrawerBankCommand.spec.ts` → green (esp. back-compat byte-identical)
- [ ] `pnpm test:e2e -- --grep "variable-height"` → green, 0 console errors
- [ ] Scoped eslint on all changed files → 0
- [ ] Manual sanity: confirm `git grep -n "AddDrawerBankParams"` shows no serialization into `.ziasm`/manifest (scope guard — expect none).
- [ ] Whole-branch review (opus) before finishing.

## Self-review notes (plan author)

- **Spec coverage:** every spec unit (drawerBankLayout, drawerFrontMath, command guard, dialog, i18n, e2e, scope guards) maps to Tasks 1–6. ✓
- **Open resolution baked in:** dialog gets `openH` via FurnitureTab deriving dims in an async pick callback (Task 4), making `dims` required — the one design question the recon flagged.
- **Risk:** the byte-identical back-compat test (Task 3) is load-bearing; it must compare actual written component geometry, not logs. Flagged inline.
- **Risk:** `beginOneComponentPick` callback may be typed `=> void`; Task 4 Step 2 includes widening it if needed.
- **Risk:** existing `drawerFrontMath` spec tests break on the signature change; Task 2 updates them rather than leaving them red.
