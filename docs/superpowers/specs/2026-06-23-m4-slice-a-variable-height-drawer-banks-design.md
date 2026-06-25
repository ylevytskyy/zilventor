# M4 Slice A — Variable-height drawer banks (design)

**Date:** 2026-06-23
**Milestone:** M4 — Furniture authoring correctness (first slice)
**Status:** Approved (brainstorming complete) → ready for writing-plans.
**Branch:** `feat/m4-variable-height-drawers` (off `master`).

## Context

`AddDrawerBankCommand` builds N **equal-height** drawers in a cabinet opening. M4 Slice A
lets the user give an **explicit height (mm) per drawer**. Omitting heights preserves today's
uniform behavior exactly (backward-compatible).

Reconnaissance finding: the `apply()` loop is **already per-slot** — it uses
`slot.bottomZ` / `slot.topZ` / `currentSlotH = topZ − bottomZ`, and `drawerBoxMath(slot, …)`
and `drawerSlideMath` (via `currentSlotH`) already consume the per-slot object. Only the slot
**generation** and the **front sizing** hardcode the uniform `openH/n` assumption.

## Decisions (locked in brainstorming)

1. **Height model:** explicit mm per drawer (array of N values). Omitted → uniform `openH/N`.
2. **Sum policy:** strict — if `|Σheights − openH| > 0.5 mm`, throw a translatable guard error
   **before any write** (mirrors existing C-8 "guard fires before writing anything"). No
   auto-absorb, no rescale.
3. **Dialog UX:** when count = N, render N inline number fields pre-filled with the equal split
   (`openH/N`); live "remaining: X mm" helper; submit blocked until `Σ === openH` (±0.5 mm).
   Submitting the equal-split values is equivalent to omitting `heights`.

## Units changed

### 1. `drawerBankLayout(opening, n, heights?)` — `packages/shared/src/drawerBankLayout.ts`
Pure function; primary TDD target.
- `heights` omitted → uniform `openH / n` (behavior unchanged).
- `heights` given:
  - validate `heights.length === n` → else throw `drawerBank.error.heightCount`;
  - validate `|Σheights − opening.openH| ≤ 0.5` → else throw `drawerBank.error.heightSum`;
  - build slots from **cumulative offsets** so tiling is preserved:
    `slot[i].bottomZ = openBottomZ + Σ_{j<i} heights[j]`, `slot[i].topZ = bottomZ + heights[i]`,
    guaranteeing `slot[i].topZ === slot[i+1].bottomZ`.
- Slot shape unchanged: `{ index, bottomZ, topZ }`.

### 2. `drawerFrontMath(index, n, slot, opening, overlay, params)` — `packages/shared/src/drawerFrontMath.ts`
- Remove the internal slot-edge recomputation (current lines 70–72:
  `slotH = openH/n; slotBottomZ = …; slotTopZ = …`) and consume the passed-in
  `slot.{bottomZ, topZ}` instead.
- Overlay boundary logic is **unchanged**: first drawer (`index === 0`) and last
  (`index === n − 1`) get `overhang`; interior edges get `GAP/2`. These need only `index`/`n`,
  which are still passed.
- `opening` parameter shrinks to `{ openW, frontY }` (`openH`/`openBottomZ` no longer needed
  here — slot edges come from `slot`).
- Adjacent-gap invariant must still hold for unequal slots:
  `bottomZ_{i+1} − topZ_i === DRAWER_FRONT_GAP`.

### 3. `AddDrawerBankParams` + `apply()` guard — `packages/app/src/commands/AddDrawerBankCommand.ts`
- Add optional `heights?: number[]` to `AddDrawerBankParams` (line ~67).
- `apply()` passes `params.heights` to `drawerBankLayout({ openBottomZ, openH }, N, params.heights)`.
- Degenerate guard (currently the single `slotH = openH/N; if (slotH <= 24)` at lines 133/139)
  becomes a **per-slot loop**: for each generated slot, `slot.topZ − slot.bottomZ > 24` else
  throw `drawerBank.error.tooSmall`. The `openW ≤ 57` and `count < 1` guards are unchanged.
  (Run the layout, then guard the slots — `drawerBankLayout` validates count/sum, the command
  validates per-slot minimum height.)
- Update the `drawerFrontMath(...)` call site to pass `slot` and the trimmed `opening`.

### 4. Dialog — Add-Drawer-Bank dialog component + its open-command
- **Planner must locate** the existing dialog (component + open-command analogous to
  `OpenCornerCabinetDialogCommand`).
- When count = N, render N number inputs pre-filled with `openH/N`, a live "remaining: X mm"
  helper derived from `openH − Σ`, and block submit until within ±0.5 mm.
- On submit, pass `heights` to `AddDrawerBankCommand`. Equal-split values may be passed as-is
  (equivalent to omitting heights).

### i18n
Add keys (en + uk): `drawerBank.error.heightSum`, `drawerBank.error.heightCount`, and the
dialog field/helper labels. `drawerBank.error.tooSmall` already exists.

## Explicitly untouched (confirmed per-slot already)
`drawerBoxMath`, `drawerSlideMath`, `buildDrawerBox`, `writeBoxSideBores`, and `revert()`.

## Data flow
dialog inputs → `params.heights` → `drawerBankLayout` (count/sum validation) → slots →
command per-slot guard (min height) → existing per-slot loop (front / box / slides) →
`packAssembly` + reload. Revert path unchanged.

## Testing (TDD — red→green per unit)
- **`drawerBankLayout`**: (a) variable heights tile correctly + `topZ_i === bottomZ_{i+1}`;
  (b) sum mismatch throws `heightSum`; (c) count mismatch throws `heightCount`;
  (d) omitted heights → uniform (regression).
- **`drawerFrontMath`**: (a) fronts sized from non-uniform slots; (b) adjacent-gap invariant
  holds with unequal slots; (c) first/last overhang correct; (d) inset width unchanged.
- **`AddDrawerBankCommand`**: (a) apply with `heights` → N fronts/boxes at expected Z;
  (b) per-slot min-height guard throws `tooSmall`; (c) sum guard throws;
  (d) **omitting `heights` produces a result byte-identical to today** (back-compat);
  (e) revert restores prior state.
- **e2e**: dialog → enter unequal heights → drawers render, 0 console errors.

## Scope guards
- No new `BoreRole`.
- **No manifest version bump** — `heights` is an optional additive param on a transient command,
  not persisted document schema. The plan must verify nothing serializes `AddDrawerBankParams`
  into a `.ziasm`/manifest; if something does, that becomes a versioning decision to surface.
- No unrelated refactoring of the drawer pipeline.

## Verification posture
- Static: `pnpm typecheck` (0). Lint scoped to changed files (`pnpm exec eslint <files>` —
  full-repo lint OOMs per project notes).
- Unit: `cd packages/app && pnpm exec vitest run <specs>` and the shared specs
  (`packages/app` has no `test` script; the root one is used elsewhere).
- e2e: Playwright dialog flow, read back %screenshot + 0 console errors.
