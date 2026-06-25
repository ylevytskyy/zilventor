# M4 Slice C — Blum TANDEM Under-Mount Drawer-Slide Boring

**Date:** 2026-06-25
**Milestone:** M4 (Furniture authoring correctness) · Slice C
**Status:** Design approved, ready for implementation plan

## Summary

Extend the existing drawer-bank feature with a `slideSystem: 'sideMount' | 'tandem'`
option. When `'tandem'`, the command swaps the slide SKU to a Blum-style under-mount
profile, widens the drawer-box side clearance so the box body clears the under-mounted
runners, and emits an under-mount **boring pattern** on three surfaces: the **cabinet
side panels**, the **drawer-box bottom panel**, and the **drawer-box back panel**.

`slideSystem` defaults to `'sideMount'`, which leaves the currently shipped side-mount
path byte-for-byte identical (the same geometry-identical-default convention used by M4
Slice A variable-height drawers). This slice is purely additive.

## Decisions (locked during brainstorming)

1. **Integration** — extend `AddDrawerBankCommand` with a `slideSystem` parameter; do
   NOT create a separate command. DRY; one dialog dropdown.
2. **Box scope** — boring **+ clearance**: emit the TANDEM bores AND apply the wider
   under-mount side clearance (real geometry). See "Simplifications" for what is *not*
   in scope.
3. **Spec fidelity** — **nominal Blum-named** constants approximating TANDEM 560H,
   documented as nominal and editable; not held to the published datasheet to the
   millimetre.
4. **SKU set** — a **single** default TANDEM SKU, used regardless of depth (mirrors the
   single side-mount `DEFAULT_DRAWER_SLIDE_SKU`).

## Explicit simplifications (approved)

- **Rear engagement is represented as bores, not a true geometric notch.** The
  drawer-box panels have only a bore pipeline today (no material-removal cut feature).
  The under-mount rear-hook / locking-device engagement is emitted as **bore holes**. A
  true rear notch (material removal) is deferred to a follow-up. The side-clearance
  width change *is* real geometry (a cheap constant swap), and is in scope.
- **Numbers are nominal.** Constants approximate Blum TANDEM 560H and are documented as
  nominal/editable in `tandemConventions.ts`.

## Architecture

### New / changed units

#### 1. `packages/shared/src/tandemConventions.ts` (new)

Nominal Blum TANDEM 560H constants, each documented as nominal/editable:

| Constant | Nominal value | Meaning |
|---|---|---|
| `TANDEM_SLIDE_CLEARANCE_PER_SIDE` | `21` mm | box-body inset per side (Blum "inside − 42 mm" rule) |
| `TANDEM_CABINET_FRONT_SETBACK` | `37` mm | front runner-fixing hole from cabinet front |
| `TANDEM_CABINET_REAR_HOLE_FROM_BACK` | `9` mm | rear runner-fixing hole from cabinet back |
| `TANDEM_CABINET_RUNNER_HEIGHT` | `10` mm | runner-fixing line height above the drawer-opening floor |
| `TANDEM_CABINET_HOLE_DIAMETER` | `5` mm | cabinet-side fixing hole Ø |
| `TANDEM_LOCK_HOLE_DIAMETER` | `10` mm | locking-device hole Ø (drawer back) |
| `TANDEM_REAR_HOOK_FROM_BACK` | `9` mm | bottom-panel rear-hook engagement hole from box back |
| `TANDEM_BOTTOM_HOLE_DIAMETER` | `5` mm | bottom-panel fixing hole Ø |
| `TANDEM_HOLE_DEPTH` | `12` mm | nominal bore depth |
| `TANDEM_MIN_HOLES` | `2` | minimum fixing holes per cabinet side |

(Final exact numbers may be refined in the implementation plan; these are the nominal
defaults to encode.)

#### 2. `packages/shared/src/tandemSlideMath.ts` (new)

Mirrors `drawerSlideMath.ts`. **Takes the identical `DrawerSlideCtx`** input
(`drawerIndex`, `openBottomZ`, `slotH`, `bh`, `cabinet {H,D,Tc}`, `box {bd}`,
`slideLength`).

Returns:

```ts
{
  cabinetBores: BoreOp[];     // role 'tandem-cabinet'
  boxBottomBores: BoreOp[];   // role 'tandem-drawer-bottom'
  boxBackBores: BoreOp[];     // role 'tandem-drawer-back'
}
```

Bore placement:

- **Cabinet side panels** — faces `Top` (left = `LEFT_SIDE_INNER_FACE`) and `Bottom`
  (right = `RIGHT_SIDE_INNER_FACE`), reusing the existing routing. Two holes per side:
  front at `TANDEM_CABINET_FRONT_SETBACK`, rear at `D − Tc − TANDEM_CABINET_REAR_HOLE_FROM_BACK`.
  Height (u along world-Z) = `openBottomZ + drawerIndex·slotH + TANDEM_CABINET_RUNNER_HEIGHT`
  (runner sits low in the opening, NOT at box mid-height).
- **Drawer bottom panel** (face `Bottom`) — rear-hook engagement holes near the box
  back + front fixing holes.
- **Drawer back panel** (inward-facing face) — the locking-device hole(s),
  Ø `TANDEM_LOCK_HOLE_DIAMETER`.

**Frame-mapping requirement (carry-forward lesson):** the `(u,v)→world` mapping is
frame-dependent. Tests MUST assert the **absolute world position** of each bore,
co-located with the part it fastens, mapping `(u,v)` through the *same* `face2DFrame`
the viewport uses — not just bore counts. (The leg-leveler slice shipped a v-mapping
blocker that count-only assertions missed.)

#### 3. `packages/shared/src/bore.ts`

Add `BoreRole` values `tandem-cabinet`, `tandem-drawer-bottom`, `tandem-drawer-back`;
add `BoreConnectorKind` value `tandem`. **No manifest bump** — adding role strings to a
union needs no migration (leg-leveler precedent; stays `CURRENT_FORMAT_VERSION = 32`).

#### 4. `packages/shared/src/hardware/builtinCatalog.ts`

One new SKU `drawer-slide-tandem-500` (under-mount profile `bboxMm`, `category:
'drawerSlides'`, vendor 'Blum', front/back attach points). Auto-aggregates into the
hardware BOM via the existing `aggregateHardwareRecursive`.

#### 5. `packages/shared/src/drawerBoxMath.ts`

Plumb `slideSystem` through `BoxSlot`/`BoxOpening`. Width branch:

```ts
const clearance = slideSystem === 'tandem'
  ? TANDEM_SLIDE_CLEARANCE_PER_SIDE   // 21
  : SLIDE_CLEARANCE_PER_SIDE;         // 12.5
const bw = opening.openW - 2 * clearance;
```

All other box dims (height, depth, 5-panel set, butt-jointed bottom) unchanged.

#### 6. `packages/app/src/commands/buildDrawerBox.ts`

Add `writeBoxBottomBores` and `writeBoxBackBores`, mirroring `writeBoxSideBores`:
unpack the box `.ziasm`, route bores to the panel whose component `role` is
`drawerBox-bottom` / `drawerBox-back`, snapshot priors, append, repack, write to OPFS.
(`writeBoxSideBores` remains for the side-mount path.)

#### 7. `packages/app/src/commands/AddDrawerBankCommand.ts`

Branch on `slideSystem`:

- side-mount → current behaviour (`drawerSlideMath`, `DEFAULT_DRAWER_SLIDE_SKU`,
  `writeBoxSideBores`).
- tandem → `tandemSlideMath`, TANDEM SKU, `appendCabinetSideBores` (reused for the
  cabinet bores) + `writeBoxBottomBores` + `writeBoxBackBores`.

Slide component placed with `role: 'drawerSlide'` (unchanged pattern). Auto-BOM the
TANDEM SKU. **`reloadCabinet` (`setSubAssemblyDocs` + `setSolverDirty(true)`) +
`boreCacheInvalidator?.([...panelPaths])` must run in BOTH `execute()` AND `revert()`**
(leg-leveler lesson — otherwise the viewport stays stale until reload). Revert restores
the snapshotted prior bores on all touched panels. Guard optional store dependencies.

#### 8. `DrawerBankDialog.tsx` + store + i18n

Add a `slideSystem` dropdown (default **Side-mount**) to `DrawerBankDialogOpts`; plumb
through `onSubmit`. en + uk i18n keys for the label and the two options.

## Data flow

```
DrawerBankDialog (slideSystem) ─▶ store ─▶ AddDrawerBankCommand.apply()
   ├─ buildSlidePart(TANDEM SKU)            → hardware/<sku>.zipt
   ├─ per slot: drawerBoxMath(slideSystem)  → box outer width (wider for tandem)
   │            buildDrawerBox              → 5-panel box .ziasm
   │            tandemSlideMath(ctx)        → { cabinetBores, boxBottomBores, boxBackBores }
   │            appendCabinetSideBores      → cabinet L/R side panels
   │            writeBoxBottomBores         → drawerBox-bottom panel
   │            writeBoxBackBores           → drawerBox-back panel
   └─ packAssembly + write + reloadCabinet + boreCacheInvalidator   (execute AND revert)
```

## Error handling

Reuse the existing drawer-bank degenerate guards (`openW`, `slotH`, `count`). No new
user-facing error paths in scope. Optional store dependencies (`boreCacheInvalidator`,
setters) guarded as in the leg-leveler command.

## Testing

TDD red→green slices (each: failing test first, then minimum code, suite green):

1. `tandemConventions` — constant values present.
2. `builtinCatalog` — TANDEM SKU lookup returns expected `bboxMm`/category.
3. `bore.ts` — new `BoreRole` / `BoreConnectorKind` members.
4. `tandemSlideMath.spec` — **absolute world bore positions** + roles + face targeting
   for cabinet / bottom / back (the load-bearing test).
5. `drawerBoxMath.spec` — box outer width = `openW − 2·21` when `slideSystem='tandem'`;
   unchanged when `'sideMount'`.
6. `buildDrawerBox` — `writeBoxBottomBores` / `writeBoxBackBores` write to the correct
   panels; priors snapshotted.
7. `AddDrawerBankCommand.spec` — tandem branch produces tandem bores on all 3 surfaces,
   BOM row, store refresh; revert restores priors. Side-mount branch unchanged.
8. `DrawerBankDialog` — slideSystem dropdown renders + passes through `onSubmit`.
9. i18n — en/uk keys resolve.
10. `tests/e2e/m4-tandem-slides.spec.ts` — drive the UI; assert via the **store**
    (`subAssemblyDocs` contains tandem bores) + `solverDirty=true` + **0 console
    errors**. (Do NOT assert via OPFS — masks store-staleness bugs.)

## Project gotchas (carry forward)

- `master` is protected — `--no-ff` merge to LOCAL master, leave UNPUSHED; push is
  human-gated.
- `packages/app` has no `test` script → `cd packages/app && pnpm exec vitest run <spec>`.
- Full-repo `pnpm lint` OOMs → scoped eslint per package.
- gzip re-pack is non-deterministic → compare geometry/counts, not raw bytes.
- `exactOptionalPropertyTypes: true` → conditional spread for optional undefinable fields.
- Repack must preserve blobs: `blobs: project.blobs ?? {}`.
- `pnpm typecheck` (root, 5 pkgs, 0 expected) after each task.

## Out of scope (follow-ups)

- True geometric rear notch (material removal) on the bottom panel.
- Multiple TANDEM lengths / depth-based SKU auto-pick.
- BlumotionORGA / TIP-ON variants.
- Exact 560H datasheet calibration.
