# Material-colored Section Hatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw each section-view cut-face's hatch lines in its source component's material color (`materials[0].color`, as-is), across the on-screen canvas, DXF export, and SVG/PDF/PNG export.

**Architecture:** Resolve color **app-side by `partId`** (the kernel already stamps the real per-component `partId` on assembly cut faces; the part path's faces carry `partId:''`). No kernel change — the `materialResolver: () => ''` stub stays. Color is **baked onto `HatchSegment.color` at projection time** via a new optional `colorForFace` resolver, refreshed on Regenerate. All three renderers read `seg.color` with a legacy fallback so old (color-less) persisted segments are unchanged.

**Tech Stack:** TypeScript monorepo (pnpm workspaces), Vitest, Playwright e2e (Chromium), Zustand store, OCCT kernel via Comlink, hand-rolled R12 DXF writer.

**Manifest:** v19 unchanged (additive optional field; no migration).

**Test commands (from repo root):**
- shared: `pnpm --filter @zilventor/shared exec vitest run <path-relative-to-packages/shared>`
- app: `pnpm --filter app exec vitest run <path-relative-to-packages/app>`
- full gate: `pnpm -r test:unit`
- e2e: `pnpm test:e2e -- tests/e2e/drawing/<spec> --project=chromium`
- perf: `pnpm test:perf -- tests/perf/<spec>`

**Reference, not literal:** code blocks below mirror current code, but verify imports / exact identifiers against the real files before re-emitting (per repo convention). If a line number drifted, match what's actually there.

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `packages/shared/src/drawing/types.ts` | `HatchSegment.color` field | modify |
| `packages/shared/src/drawing/projectSectionView.ts` | `colorForFace` param + attach color | modify |
| `packages/app/src/store/useAppStore.ts` | `activeDrawingSourceComponentColors` slot | modify |
| `packages/app/src/drawing/loadAssemblyForProjection.ts` | build `partId→color` map | modify |
| `packages/app/src/commands/CreateDrawingCommand.ts` | set/snapshot/revert the new slot | modify |
| `packages/app/src/drawing/activateDrawingDocument.ts` | set the new slot at activation | modify |
| `packages/app/src/commands/AddSectionViewCommand.ts` | `colorForFace` closure → projectSectionView | modify |
| `packages/app/src/drawing/regenerateSectionView.ts` | `colorForFace` closure → projectSectionView | modify |
| `packages/app/src/drawing/ViewElement.tsx` | canvas hatch stroke = color | modify |
| `packages/app/src/drawing/renderDrawingSvg.ts` | ADD colored hatch loop | modify |
| `packages/app/src/drawing/dxfWriter.ts` | optional ACI color on `line()` + `hexToAci` | modify |
| `packages/app/src/drawing/renderDrawingDxf.ts` | pass per-material ACI to hatch lines | modify |
| `packages/app/src/App.tsx` | perf-fixture: set new slot | modify |
| `tests/e2e/drawing/<spec>` | real-env distinct-color assertion | create |

---

## Task 1: `HatchSegment.color` + `projectSectionView` color attach (shared)

**Files:**
- Modify: `packages/shared/src/drawing/types.ts` (HatchSegment ~115)
- Modify: `packages/shared/src/drawing/projectSectionView.ts` (signature ~89, hatch loop ~125)
- Test: `packages/shared/src/drawing/__tests__/projectSectionView.color.spec.ts` (create; or add to the existing projectSectionView spec if present — check first)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/drawing/__tests__/projectSectionView.color.spec.ts`. Build a minimal `FaceTagMap` with one `cut-face` carrying a `polygon` (pre-projected, ≥3 pts) and a `partId`, then call `projectSectionView` with a `colorForFace` that returns `'#ab12cd'` for that partId. Assert every returned `hatchSegments` entry has `color === '#ab12cd'`.

```typescript
import { describe, it, expect } from 'vitest';
import { projectSectionView, type FaceTag } from '../projectSectionView';

describe('projectSectionView color attachment', () => {
  it('stamps colorForFace(partId) onto every hatch segment of a cut face', () => {
    const faceTags = new Map<string, FaceTag>([
      ['f1', {
        tag: 'cut-face',
        partId: 'P1',
        materialId: '',
        polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      }],
    ]);
    const { hatchSegments } = projectSectionView(
      { vertices: [], edges: [] } as never, // ProjectorInput stub — edges unused for hatch
      faceTags as never,
      1,
      (materialId: string) => ({ angleDeg: 45, spacingMm: 3 }),
      undefined,
      undefined,
      (partId: string) => (partId === 'P1' ? '#ab12cd' : '#808080'),
    );
    expect(hatchSegments.length).toBeGreaterThan(0);
    expect(hatchSegments.every((s) => s.color === '#ab12cd')).toBe(true);
  });

  it('omits color when no colorForFace is provided (legacy callers unaffected)', () => {
    const faceTags = new Map<string, FaceTag>([
      ['f1', {
        tag: 'cut-face',
        partId: 'P1',
        materialId: '',
        polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      }],
    ]);
    const { hatchSegments } = projectSectionView(
      { vertices: [], edges: [] } as never,
      faceTags as never,
      1,
      () => ({ angleDeg: 45, spacingMm: 3 }),
    );
    expect(hatchSegments.length).toBeGreaterThan(0);
    expect(hatchSegments.every((s) => s.color === undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/shared exec vitest run src/drawing/__tests__/projectSectionView.color.spec.ts`
Expected: FAIL — `colorForFace` arg not accepted / `s.color` is `undefined` in the first test (color not attached yet). (If the `ProjectorInput` stub shape is wrong, fix the stub to match the real `ProjectorInput` type — check its definition; the hatch path only needs faceTags + polygons, so edges/vertices can be empty.)

- [ ] **Step 3: Add `color` to `HatchSegment`**

In `packages/shared/src/drawing/types.ts`, extend the type:

```typescript
export type HatchSegment = {
  readonly p0: Vec2;
  readonly p1: Vec2;
  readonly materialId: string;
  readonly color?: string;   // NEW — hex (#rrggbb); absent ⇒ renderer legacy default
};
```

- [ ] **Step 4: Add `colorForFace` param + attach color in `projectSectionView`**

In `packages/shared/src/drawing/projectSectionView.ts`, append a 7th optional param to the signature (after `view?`):

```typescript
export function projectSectionView(
  source: ProjectorInput,
  faceTags: FaceTagMap,
  scale: number,
  getHatchSpec?: (materialId: string) => { angleDeg: number; spacingMm: number },
  sectionViewMatrix?: Mat4,
  view?: SectionView,
  colorForFace?: (partId: string) => string,   // NEW
): {
```

In the cut-face hatch loop, attach the color after generating segments (do NOT change `generateHatchSegments`):

```typescript
    const hatchSpec = getHatchSpec ? getHatchSpec(faceInfo.materialId) : DEFAULT_HATCH_SPEC;
    const segments = generateHatchSegments(polygon, faceInfo.materialId, hatchSpec);
    const color = colorForFace ? colorForFace(faceInfo.partId) : undefined;
    hatchSegments.push(...(color ? segments.map((s) => ({ ...s, color })) : segments));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zilventor/shared exec vitest run src/drawing/__tests__/projectSectionView.color.spec.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Run the shared suite to confirm no regression**

Run: `pnpm --filter @zilventor/shared exec vitest run`
Expected: all green (existing projectSectionView tests still pass — they pass no `colorForFace`, so segments have no `color`).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/drawing/types.ts packages/shared/src/drawing/projectSectionView.ts packages/shared/src/drawing/__tests__/projectSectionView.color.spec.ts
git commit -m "feat(section-hatch): HatchSegment.color + colorForFace in projectSectionView"
```

---

## Task 2: `activeDrawingSourceComponentColors` store slot

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts` (AppState type ~89, initial values ~355)
- Test: `packages/app/src/store/__tests__/activeDrawingSourceComponentColors.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { useAppStore } from '../useAppStore';

describe('activeDrawingSourceComponentColors slot', () => {
  it('defaults to null and is settable', () => {
    expect(useAppStore.getState().activeDrawingSourceComponentColors).toBeNull();
    useAppStore.setState({ activeDrawingSourceComponentColors: { P1: '#112233' } } as never);
    expect(useAppStore.getState().activeDrawingSourceComponentColors).toEqual({ P1: '#112233' });
    useAppStore.setState({ activeDrawingSourceComponentColors: null } as never); // reset for other tests
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/store/__tests__/activeDrawingSourceComponentColors.spec.ts`
Expected: FAIL — property missing / typed `undefined` not `null`.

- [ ] **Step 3: Add the slot to AppState + initial value**

In `packages/app/src/store/useAppStore.ts`, add to the `AppState` type right after `activeDrawingSourceComponents`:

```typescript
  /** partId → material color (hex) for the active assembly-sourced drawing's components.
   *  Parallel to activeDrawingSourceComponents; built by loadAssemblyForProjection from each
   *  component part's materials[0].color. Null for part-sourced drawings / no active drawing.
   *  NOT reset by drawingDocState() — same lifecycle contract as activeDrawingSourceComponents. */
  activeDrawingSourceComponentColors: Record<string, string> | null;
```

And in the `create<AppState>` initial values, after `activeDrawingSourceComponents: null,`:

```typescript
  activeDrawingSourceComponentColors: null,
```

- [ ] **Step 4: Verify `drawingDocState()` does NOT reset it**

Open `packages/app/src/store/useAppStore.ts`, find `drawingDocState`. Confirm it does NOT set/reset `activeDrawingSourceComponents` (it must not — the slot is preserved across drawing edits). Since the new color slot follows the identical contract, ensure `drawingDocState` likewise does NOT mention `activeDrawingSourceComponentColors`. No edit needed if it already omits the component slots; if `drawingDocState` explicitly nulls component slots (it should not, per the slot comments), STOP and report — that contradicts the design.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/store/__tests__/activeDrawingSourceComponentColors.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/store/useAppStore.ts packages/app/src/store/__tests__/activeDrawingSourceComponentColors.spec.ts
git commit -m "feat(section-hatch): add activeDrawingSourceComponentColors store slot"
```

---

## Task 3: `loadAssemblyForProjection` builds `componentColors`

**Files:**
- Modify: `packages/app/src/drawing/loadAssemblyForProjection.ts`
- Test: `packages/app/src/drawing/__tests__/loadAssemblyForProjection.color.spec.ts` (create — first read the existing `loadAssemblyForProjection` test to mirror its opfs/kernel mocking + how it provides part bytes)

- [ ] **Step 1: Write the failing test**

Mirror the existing `loadAssemblyForProjection` test harness (mock `opfs.read`, `kernel.loadFromBytes`/`execute`, and the assembly walkers). Mock the manifest unpack so each part's bytes resolve to a `document.materials` with a known color. Assert the returned `componentColors` maps each kernel partId → that color, and that two parts with different colors produce two entries.

Use `vi.mock` for the unpack module the impl uses (see Step 3 for which). Example skeleton (adapt mock module paths + walker mocks to the existing test):

```typescript
import { describe, it, expect, vi } from 'vitest';
// vi.mock the same module loadDrawingSource uses for unpackProject/migrateManifest —
// resolve the real import path from loadDrawingSource.ts before writing this mock.
// Make unpackProject return { manifest } and migrateManifest return { document: { materials: [{ id:'m', name:'n', defaultThickness:1, color: <perBytes> }] } }.

describe('loadAssemblyForProjection componentColors', () => {
  it('maps each kernel partId to its primary material color', async () => {
    // ...build args with 2 distinct leaf parts whose bytes decode to colors '#aa0000' and '#0000bb'
    const { components, componentColors } = await loadAssemblyForProjection(args);
    const colors = components.map((c) => componentColors[c.partId]);
    expect(new Set(colors)).toEqual(new Set(['#aa0000', '#0000bb']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/loadAssemblyForProjection.color.spec.ts`
Expected: FAIL — `componentColors` is `undefined` on the result.

- [ ] **Step 3: Implement the color map**

In `packages/app/src/drawing/loadAssemblyForProjection.ts`:

1. Add the same imports `loadDrawingSource.ts` uses to unpack a part's manifest (it does `const { manifest } = await unpackProject(bytes); const migrated = migrateManifest(...); migrated.document`). Copy those exact import statements.
2. Extend `LoadAssemblyForProjectionResult`:

```typescript
export type LoadAssemblyForProjectionResult = {
  components: AssemblyComponentInput[];
  sourceFingerprint: string;
  componentColors: Record<string, string>;   // NEW: kernel partId → material color (hex)
};
```

3. Declare `const componentColors: Record<string, string> = {};` next to `partIdCache`.
4. Inside the `if (!partId) { ... }` block (after `partIdCache.set(...)`), extract the primary color from the SAME `partBytes` (already read this iteration):

```typescript
      try {
        const { manifest } = await unpackProject(partBytes);
        const migrated = migrateManifest(manifest as Parameters<typeof migrateManifest>[0]);
        const color = (migrated as { document?: { materials?: ReadonlyArray<{ color?: string }> } })
          .document?.materials?.[0]?.color;
        if (color) componentColors[partId] = color;
      } catch {
        // malformed manifest → no entry → gray fallback at resolve time
      }
```

5. Return it: `return { components, sourceFingerprint: fingerprint(fpHash), componentColors };`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/loadAssemblyForProjection.color.spec.ts`
Expected: PASS.

- [ ] **Step 5: Fix the existing `loadAssemblyForProjection` test if it destructures the result**

Run the existing spec: `pnpm --filter app exec vitest run src/drawing/__tests__/loadAssemblyForProjection*.spec.ts`
If TypeScript/asserts break on the new required field, they won't (additive). Confirm green.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/drawing/loadAssemblyForProjection.ts packages/app/src/drawing/__tests__/loadAssemblyForProjection.color.spec.ts
git commit -m "feat(section-hatch): loadAssemblyForProjection returns partId→color map"
```

---

## Task 4: Wire `componentColors` into all activation paths

**Files:**
- Modify: `packages/app/src/drawing/activateDrawingDocument.ts` (~42, ~53, ~93)
- Modify: `packages/app/src/commands/CreateDrawingCommand.ts` (~129, ~150 + prev-field)
- Modify: `packages/app/src/App.tsx` (~3252, ~3271 perf fixtures)
- Test: covered by Task 6/8 e2e + the revert test below

- [ ] **Step 1: Write the failing test (CreateDrawingCommand revert restores the slot)**

Add to (or create) `packages/app/src/commands/__tests__/CreateDrawingCommand.color.spec.ts`: seed the store with `activeDrawingSourceComponentColors: { OLD: '#000000' }`, run a CreateDrawingCommand for an assembly source whose load yields `{ NEW: '#ffffff' }` (mock loadAssemblyForProjection), assert after `apply` the slot is the new map, and after `revert` it is restored to `{ OLD: '#000000' }`. (Mirror the existing CreateDrawingCommand assembly test's mocks.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/CreateDrawingCommand.color.spec.ts`
Expected: FAIL — slot not set/reverted.

- [ ] **Step 3: Update `activateDrawingDocument.ts`**

At the assembly success path (currently sets `activeDrawingSourceComponents`/`Fingerprint`/`Document`), destructure `componentColors` from `loadAssemblyForProjection` and add:

```typescript
      const { components, sourceFingerprint, componentColors } = await loadAssemblyForProjection(/* ...existing args... */);
      useAppStore.setState({
        activeDrawingSourceComponents: components,
        activeDrawingSourceFingerprint: sourceFingerprint,
        activeDrawingSourceDocument: asmDoc,
        activeDrawingSourceComponentColors: componentColors,   // NEW
      } as never);
```

In BOTH error/fallback `setState` blocks (assembly error ~53 and part error ~93), add `activeDrawingSourceComponentColors: null,`.

- [ ] **Step 4: Update `CreateDrawingCommand.ts`**

1. Add a prev field beside the other `prev*` fields: `private prevActiveDrawingSourceComponentColors!: Record<string, string> | null;`
2. Where it snapshots the other prev values (before mutating), capture: `this.prevActiveDrawingSourceComponentColors = useAppStore.getState().activeDrawingSourceComponentColors;`
3. In the assembly apply `setState` (~129), destructure + set `componentColors`:

```typescript
          const { components, sourceFingerprint, componentColors } = await loadAssemblyForProjection(/* ... */);
          useAppStore.setState({
            activeDrawingSourceComponents: components,
            activeDrawingSourceFingerprint: sourceFingerprint,
            activeDrawingSourceComponentColors: componentColors,   // NEW
          } as never);
```

4. In `revert` (~150), add: `activeDrawingSourceComponentColors: this.prevActiveDrawingSourceComponentColors,`

- [ ] **Step 5: Update `App.tsx` perf fixtures**

At the two perf-fixture `setState` blocks that set `activeDrawingSourceComponents` (~3252 synthetic, ~3271 restore), add `activeDrawingSourceComponentColors: {},` alongside (an empty map → gray fallback; perf fixture doesn't assert color).

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/CreateDrawingCommand.color.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/drawing/activateDrawingDocument.ts packages/app/src/commands/CreateDrawingCommand.ts packages/app/src/App.tsx packages/app/src/commands/__tests__/CreateDrawingCommand.color.spec.ts
git commit -m "feat(section-hatch): set componentColors at every drawing activation path"
```

---

## Task 5: `colorForFace` closure in AddSectionViewCommand + regenerateSectionView

**Files:**
- Modify: `packages/app/src/commands/AddSectionViewCommand.ts` (~134-151)
- Modify: `packages/app/src/drawing/regenerateSectionView.ts` (~137-151)
- Test: `packages/app/src/commands/__tests__/AddSectionViewCommand.color.spec.ts` (create) + assembly color teeth

- [ ] **Step 1: Write the failing tests**

Two tests (mirror existing AddSectionViewCommand section tests for setup/mocks):
1. **Part path:** active part with `materials: [{ id:'m1', color:'#336699', ... }]`, create a section view, assert the resulting `SectionView.hatchSegments` all have `color === '#336699'`.
2. **Assembly path (teeth):** set `activeDrawingSourceComponentColors: { A:'#aa0000', B:'#0000bb' }` and components/faceTags such that the cut produces faces with `partId:'A'` and `partId:'B'`, assert the segments contain **≥2 distinct colors** including both `#aa0000` and `#0000bb` (NOT a count — a count is identical regardless of color).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/AddSectionViewCommand.color.spec.ts`
Expected: FAIL — segments have no `color`.

- [ ] **Step 3: Implement the closure in AddSectionViewCommand**

After the `hatchLookup` definition (~141), add the unified resolver and pass it as the 7th projectSectionView arg (note: this call currently passes 5 args and omits `view` — pass `undefined` for the `view` slot):

```typescript
    const colorForFace = (partId: string): string =>
      state.activeDrawingSourceComponentColors?.[partId]
      ?? state.activePart?.materials?.[0]?.color
      ?? '#808080';

    const scale = parentView.scale.numerator / parentView.scale.denominator;
    const { edges, hatchSegments, fingerprint } = projectSectionView(
      compound as Parameters<typeof projectSectionView>[0],
      faceTags,
      scale,
      hatchLookup,
      sectionViewMatrix,
      undefined,            // view (not built yet here)
      colorForFace,         // NEW 7th arg
    );
```

- [ ] **Step 4: Implement the closure in regenerateSectionView**

After the `hatchLookup` definition (~141), add the same resolver and pass it as the 7th arg (this call already passes `view` as the 6th):

```typescript
  const colorForFace = (partId: string): string =>
    state.activeDrawingSourceComponentColors?.[partId]
    ?? state.activePart?.materials?.[0]?.color
    ?? '#808080';

  const { edges, hatchSegments } = projectSectionView(
    compound as Parameters<typeof projectSectionView>[0],
    faceTags as Parameters<typeof projectSectionView>[1],
    scale,
    hatchLookup,
    sectionViewMatrix,
    view,
    colorForFace,           // NEW 7th arg
  );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/AddSectionViewCommand.color.spec.ts`
Expected: PASS (both part single-color and assembly ≥2-distinct-color).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/commands/AddSectionViewCommand.ts packages/app/src/drawing/regenerateSectionView.ts packages/app/src/commands/__tests__/AddSectionViewCommand.color.spec.ts
git commit -m "feat(section-hatch): resolve per-component hatch color by partId at create + regen"
```

---

## Task 6: Canvas renderer (`ViewElement.tsx`)

**Files:**
- Modify: `packages/app/src/drawing/ViewElement.tsx` (~87)
- Test: `packages/app/src/drawing/__tests__/ViewElement.hatchColor.spec.tsx` (create; mirror existing ViewElement render tests using @testing-library/react)

- [ ] **Step 1: Write the failing test**

Render a `ViewElement` for a section view whose `hatchSegments` include one with `color:'#123456'` and one without `color`. Assert the rendered `<line data-role="hatch">` for the first has `stroke="#123456"`, and the color-less one has `stroke="black"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/ViewElement.hatchColor.spec.tsx`
Expected: FAIL — both render `stroke="black"`.

- [ ] **Step 3: Implement**

In `packages/app/src/drawing/ViewElement.tsx`, change the hatch `<line>` stroke:

```typescript
              stroke={seg.color ?? 'black'}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/ViewElement.hatchColor.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/ViewElement.tsx packages/app/src/drawing/__tests__/ViewElement.hatchColor.spec.tsx
git commit -m "feat(section-hatch): canvas draws hatch in material color"
```

---

## Task 7: Export SVG renderer — ADD colored hatch (`renderDrawingSvg.ts`)

**Files:**
- Modify: `packages/app/src/drawing/renderDrawingSvg.ts` (`renderViewGroup` ~152-207)
- Test: `packages/app/src/drawing/__tests__/renderDrawingSvg.hatch.spec.ts` (create; mirror existing renderDrawingSvg tests)

- [ ] **Step 1: Write the failing test**

Build a `DrawingDocument` with one sheet + one `section` view whose `hatchSegments` include `{ p0, p1, materialId:'m', color:'#0a0b0c' }`. Render via the SVG export entry point. Assert the output contains a hatch line `data-role="hatch"` with `stroke="#0a0b0c"`. Add a second segment without `color` and assert it renders `stroke="#000"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingSvg.hatch.spec.ts`
Expected: FAIL — no `data-role="hatch"` in output (SVG omits hatch today).

- [ ] **Step 3: Implement the hatch loop**

In `renderViewGroup`, add a `hatchMarkup` block (mirrors `detailMarkup`) before the `return`:

```typescript
  // Section-specific: material-colored hatch (mm space, inside the scaled group).
  let hatchMarkup = '';
  if (view.kind === 'section') {
    const sv = view as SectionView;
    for (const seg of sv.hatchSegments) {
      hatchMarkup += `\n    <line x1="${seg.p0.x}" y1="${seg.p0.y}" x2="${seg.p1.x}" y2="${seg.p1.y}" stroke="${escapeAttr(seg.color ?? '#000')}" stroke-width="0.25" data-role="hatch" data-material="${escapeAttr(seg.materialId)}"/>`;
    }
  }
```

Then include `${hatchMarkup}` in the returned group template (e.g. right after `${hiddenLines}` / before `${detailMarkup}`). Import `SectionView` type if not already imported.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingSvg.hatch.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run the renderDrawingSvg suite for regressions**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingSvg*.spec.ts`
Expected: green (additive markup; existing snapshot/string tests for non-section views unaffected — if a section-view snapshot exists, update it intentionally and confirm the only delta is the new hatch lines).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/drawing/renderDrawingSvg.ts packages/app/src/drawing/__tests__/renderDrawingSvg.hatch.spec.ts
git commit -m "feat(section-hatch): export SVG now renders material-colored hatch"
```

---

## Task 8: DXF — per-material ACI color (`dxfWriter.ts` + `renderDrawingDxf.ts`)

**Files:**
- Modify: `packages/app/src/drawing/dxfWriter.ts` (interface ~9, `line()` ~116; add `hexToAci`)
- Modify: `packages/app/src/drawing/renderDrawingDxf.ts` (hatch loop ~150)
- Test: `packages/app/src/drawing/__tests__/dxfWriter.color.spec.ts` (create) + extend a renderDrawingDxf test

- [ ] **Step 1: Write the failing tests**

1. `hexToAci('#ff0000')` → `1` (red), `hexToAci('#00ff00')` → `3` (green), `hexToAci('#0000ff')` → `5` (blue), `hexToAci('#ffffff')` → `7`, `hexToAci('#000000')` → `7` (near-black maps to 7 = layer default black/white). (Adjust expected indices to the palette you implement; the point is deterministic nearest-match.)
2. `doc.line('SECTION-HATCH', 0,0, 1,1, 1)` emits a group `' 62'` with value `1`; `doc.line('SECTION-HATCH', 0,0,1,1)` (no color) emits NO `' 62'` group for that entity.

```typescript
import { describe, it, expect } from 'vitest';
import { createDxfDocument, hexToAci } from '../dxfWriter'; // confirm the factory export name

describe('hexToAci', () => {
  it('maps primaries to ACI indices', () => {
    expect(hexToAci('#ff0000')).toBe(1);
    expect(hexToAci('#00ff00')).toBe(3);
    expect(hexToAci('#0000ff')).toBe(5);
    expect(hexToAci('#ffffff')).toBe(7);
  });
});

describe('line() optional ACI color', () => {
  it('emits group 62 when a color is given', () => {
    const doc = createDxfDocument(/* args per real factory signature */);
    doc.line('SECTION-HATCH', 0, 0, 10, 10, 1);
    const out = doc.toString();
    expect(/\n\s*62\n\s*1\n/.test(out)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/dxfWriter.color.spec.ts`
Expected: FAIL — `hexToAci` not exported; `line` ignores 6th arg.

- [ ] **Step 3: Implement `hexToAci` + optional color on `line()`**

In `dxfWriter.ts`:

```typescript
// Minimal ACI palette (index → RGB). Enough to differentiate common furniture material colors.
const ACI_PALETTE: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255],
  [5, 0, 0, 255], [6, 255, 0, 255], [7, 255, 255, 255], [8, 128, 128, 128],
  [9, 192, 192, 192], [30, 255, 127, 0], [40, 128, 64, 0], [250, 51, 51, 51],
];

export function hexToAci(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return 7;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // near-black → 7 (renders as default black/white, matching layer color)
  if (r < 24 && g < 24 && b < 24) return 7;
  let best = 7, bestD = Infinity;
  for (const [aci, pr, pg, pb] of ACI_PALETTE) {
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestD) { bestD = d; best = aci; }
  }
  return best;
}
```

Update the `DxfDocument` interface `line` signature and the implementation:

```typescript
// interface:
  line(layer: string, x1: number, y1: number, x2: number, y2: number, aci?: number): void;

// impl:
    line(layer, x1, y1, x2, y2, aci) {
      sink.push(
        '  0', 'LINE',
        '  8', layer,
        ...(aci !== undefined ? [' 62', String(aci)] : []),
        ' 10', fmt(x1), ' 20', fmt(y1),
        ' 11', fmt(x2), ' 21', fmt(y2),
      );
    },
```

(Group 62 integer values do not require space-padding; parsers accept `String(aci)`. The existing parse-back e2e reads group codes by code number, not by padding.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/dxfWriter.color.spec.ts`
Expected: PASS (adjust expected ACI indices to match the palette if needed).

- [ ] **Step 5: Pass per-material color in renderDrawingDxf**

In `renderDrawingDxf.ts`, import `hexToAci` and update the hatch loop:

```typescript
  if (view.kind === 'section') {
    const sv = view as SectionView;
    for (const h of sv.hatchSegments) {
      doc.line('SECTION-HATCH',
        tx(h.p0.x), ty(h.p0.y),
        tx(h.p1.x), ty(h.p1.y),
        h.color ? hexToAci(h.color) : undefined,
      );
    }
  }
```

- [ ] **Step 6: Add/extend a renderDrawingDxf test**

Add a test (or extend the existing renderDrawingDxf spec): a section view with a `#ff0000` hatch segment yields a `SECTION-HATCH` LINE entity carrying group `62` = `1`. Run:
`pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingDxf*.spec.ts`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/drawing/dxfWriter.ts packages/app/src/drawing/renderDrawingDxf.ts packages/app/src/drawing/__tests__/dxfWriter.color.spec.ts
git commit -m "feat(section-hatch): DXF emits per-material ACI color on section hatch"
```

---

## Task 9: Full gate + typecheck + lint

**Files:** none (verification)

- [ ] **Step 1: Typecheck all packages**

Run: `pnpm -r typecheck`
Expected: clean across all 5 packages. Fix any `Record<string,string>` / param-arity drift surfaced here.

- [ ] **Step 2: Full unit suite**

Run: `pnpm -r test:unit`
Expected: green. Baseline was 2957 (733 shared + 37 sketcher-worker + 350 kernel + 1837 app); expect app + shared counts to rise by the new tests. A lone DrawingCanvas act()-timing flake under `-r` re-runs green.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: 0 errors (16 warnings baseline). (Run inside the worktree or after cleanup — root lint does not ignore `.worktrees/`.)

- [ ] **Step 4: Commit (only if any fixups were needed)**

```bash
git add -A && git commit -m "chore(section-hatch): typecheck/lint fixups"
```

---

## Task 10: Real-environment e2e (Chromium) — distinct-color teeth

**Files:**
- Create: `tests/e2e/drawing/material-hatch-color.e2e.ts` (model on the assembly-section e2e, e.g. T-6-28; reuse its 2-part assembly fixture + drawing creation)
- Test: this IS the test

- [ ] **Step 1: Write the e2e**

Drive the real app: create/open a 2-part assembly where the two parts have **different material colors** (e.g. `#aa0000` and `#0000bb`), create an assembly-sourced drawing, add a base view, add a section view that cuts through both parts. Then assert, reading the **real DOM + browser console**:
1. **Canvas:** `<line data-role="hatch">` elements exist with **≥2 distinct `stroke` values** including both material colors. (Distinct-color assertion — NOT a count; a horizontal cut yields the same segment count regardless of color.)
2. **SVG export:** invoke the SVG export, parse the string, assert it contains hatch lines with both colors.
3. **DXF export:** invoke DXF export, parse it back, assert `SECTION-HATCH` LINE entities carry **≥2 distinct group-62 ACI values**.
4. Read `page` console; fail on any console error (every prior drawing feature surfaced production gaps only here).

- [ ] **Step 2: Run the e2e**

Run: `pnpm test:e2e -- tests/e2e/drawing/material-hatch-color.e2e.ts --project=chromium`
Expected: PASS, console clean.

- [ ] **Step 3: Verify the teeth (temporarily break the production path)**

Temporarily change the `colorForFace` closure in `AddSectionViewCommand.ts` to `() => '#808080'` (constant), re-run the e2e. Expected: the canvas distinct-color assertion FAILS (only one color). Restore the closure; re-run → PASS. This proves the test has teeth.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/drawing/material-hatch-color.e2e.ts
git commit -m "test(section-hatch): real-env e2e — ≥2 distinct material hatch colors (canvas+SVG+DXF)"
```

---

## Task 11: Perf — confirm no regression

**Files:** none (verification)

- [ ] **Step 1: Run the existing assembly-section perf probe**

Run: `pnpm test:perf -- tests/perf/<assembly-section-perf-spec>` (the T63m probe shipped with pose-aware assembly section cut; find it under `tests/perf/`).
Expected: p95 within its existing budget. Color resolution adds only O(segments) map lookups + spread — negligible. If it newly fails, STOP and investigate (do not widen the budget).

- [ ] **Step 2: No commit unless a probe file changed.**

---

## Self-review

**Spec coverage:**
- HatchSegment.color + bake at projection → Task 1. ✅
- App-side partId color resolution, no kernel change → Tasks 3/5. ✅
- Assembly `partId→color` via unpackProject → Task 3. ✅
- New store slot, not-reset discipline, all activation paths → Tasks 2/4. ✅
- Part path single-material color → Task 5. ✅
- Canvas / export-SVG (new hatch) / DXF (ACI) renderers → Tasks 6/7/8. ✅
- Manifest stays v19 (additive) → no migration task needed. ✅
- e2e distinct-color teeth + console read → Task 10. ✅
- Perf → Task 11. ✅
- Non-goals (colorOverrides, custom angle/spacing, light-color contrast) → intentionally untouched. ✅

**Placeholder scan:** no TBD/TODO; every code step shows code; mock-path/factory-signature lookups are flagged as "verify against real file" (reference-not-literal), not placeholders.

**Type consistency:** `activeDrawingSourceComponentColors: Record<string,string> | null` used identically in store type/init/setters/revert; `colorForFace: (partId: string) => string` identical in both commands and as projectSectionView's 7th param `(partId: string) => string`; `componentColors: Record<string,string>` consistent in loadAssemblyForProjection result + consumers; `hexToAci(hex: string): number` consistent in dxfWriter + renderDrawingDxf; `HatchSegment.color?: string` consistent across producer (projectSectionView) and all three renderers.
