# STEP Per-Body Color Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read per-body colors from imported STEP files (via OCCT XCAF) and apply them as the default render color of the imported part in both the single-part and assembly viewports, with user color-overrides always winning.

**Architecture:** Switch the kernel STEP reader to `STEPCAFControl_Reader` + a `TDocStd_Document` with color mode on (single parse — no double-read perf/heap regression). Extract per-solid colors at `importStep` time (the XCAF color tool only lives during the parse), cache them by `brepBlobId`, and consume them in the separate `splitImportedShape` call. Thread the per-solid hex color through `buildImportedPartDocument` onto `ImportedFeature.color` + `PartDocument.color`. The single-part viewport reads `PartDocument.color`; the explode/insert commands stamp it onto each `ComponentInstance.color` so the existing assembly `resolveColor` path renders it (override still wins). Uncolored STEP renders gray, exactly as today. All new fields optional → no manifest bump.

**Tech Stack:** TypeScript, opencascade.js (OCCT 7.6.2 full build, XCAF/XDE APIs), Vitest, THREE.js, Playwright (e2e). Monorepo: `packages/kernel`, `packages/app`, `packages/shared`.

**Spec:** `docs/superpowers/specs/2026-06-05-step-per-body-color-design.md`

---

## IMPORTANT: OCCT binding-name verification

The opencascade.js bindings use numbered constructor/overload suffixes (e.g. `STEPControl_Reader_1`, `Message_ProgressRange_1`, `TopExp_Explorer_2`) whose exact names vary. The XCAF code below is **reference, not literal**. Before relying on any XCAF symbol, the implementer MUST confirm the exact exported name + overload signature against the generated declarations:

```bash
# 9.3MB declaration file — grep, don't open
grep -nE "STEPCAFControl_Reader|TDocStd_Document_|XCAFApp_Application|XCAFDoc_DocumentTool|XCAFDoc_ColorTool|XCAFDoc_ColorType|Quantity_Color_|Quantity_ColorRGBA|TDF_LabelSequence|XCAFDoc_ColorSurf|XCAFDoc_ColorGen" \
  node_modules/opencascade.js/dist/opencascade.full.d.ts | head -80
```

Follow the existing defensive-lookup pattern in `readStep` (e.g. `(oc as {Ctor_1?: ...}).Ctor_1 ?? (oc as {Ctor?: ...}).Ctor`) so a missing/renamed binding throws a clear error rather than `undefined is not a constructor`.

---

## File Structure

**Modify:**
- `packages/kernel/src/occt/StepIO.ts` — `readStep` switches to XCAF reader + returns `solidColors`; `StepReadResult` gains `solidColors`; `ExtractedSolid` gains `color?`; `SplitImportedShapeResult` solids carry `color?`; `splitImportedShapeHelper` gains optional `solidColors` param.
- `packages/kernel/src/api.ts` — `importStep` caches `solidColors` in new `importedColorCache`; `splitImportedShape` reads cache + returns per-solid `color?`; API return types updated.
- `packages/shared/src/types.ts` — `ImportedFeature.color?: string`; `PartDocument.color?: ComponentColor`.
- `packages/app/src/import/buildImportedPartDocument.ts` — optional `color` param.
- `packages/app/src/import/importStepIntoNewParts.ts` — thread per-solid color into `registerOne`.
- `packages/app/src/viewport/SceneManager.ts` — `setMesh` gains optional `colorHex`.
- `packages/app/src/App.tsx` — pass `activePart.color` hex into `setMesh` at all `setMesh` call sites.
- `packages/app/src/commands/ExplodeIntoAssemblyCommand.ts` — stamp `instance.color` from part color.
- `packages/app/src/commands/ImportStepAsComponentCommand.ts` — stamp `instance.color` from part color.

**Create:**
- `packages/kernel/src/occt/__tests__/stepColor.helper.ts` — test helper that builds an N-box colored STEP via XCAF (fixture generator).
- `packages/kernel/src/occt/__tests__/stepColor.integration.spec.ts` — real-OCCT color round-trip + reader equivalence.
- `packages/kernel/src/occt/__tests__/splitImportedShapeColor.spec.ts` — split assigns colors.
- (Tests colocated with existing app modules for Tasks 5, 6, 7, 8.)
- e2e spec under the existing app e2e directory (Task 9).

---

## Task 1: Switch `readStep` to XCAF reader + extract per-solid colors

**Files:**
- Create: `packages/kernel/src/occt/__tests__/stepColor.helper.ts`
- Create: `packages/kernel/src/occt/__tests__/stepColor.integration.spec.ts`
- Modify: `packages/kernel/src/occt/StepIO.ts` (`StepReadResult`, `readStep`)

This is the **spike task** — it de-risks (a) that XCAF colors are readable at runtime and (b) that the new reader produces geometry equivalent to `STEPControl_Reader` (same solid/face counts + bbox), which the downstream face-naming/projection depend on.

- [ ] **Step 1: Write the colored-STEP fixture helper**

Reference code (verify XCAF binding names per the note above). Builds N axis-separated boxes, assigns each a surface color via XCAF, writes STEP bytes.

```ts
// packages/kernel/src/occt/__tests__/stepColor.helper.ts
import type { OcctInstance } from '../occtLoader';

/** Builds a STEP file (bytes) containing `colors.length` separate boxes, each
 *  assigned the given hex surface color via XCAF. Used as a self-contained,
 *  reproducible colored-STEP fixture for color-extraction tests. */
export function makeColoredBoxStepBytes(oc: OcctInstance, colors: string[]): ArrayBuffer {
  // --- new XCAF document ---
  const app = oc.XCAFApp_Application.GetApplication();          // Handle_XCAFApp_Application
  const doc = new oc.Handle_TDocStd_Document_1();
  app.get().NewDocument(new oc.TCollection_ExtendedString_1(), doc);
  const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.get().Main()).get();
  const colorTool = oc.XCAFDoc_DocumentTool.ColorTool(doc.get().Main()).get();

  colors.forEach((hex, i) => {
    const box = new oc.BRepPrimAPI_MakeBox_3(10, 10, 10); // adjust ctor suffix as needed
    // offset each box along +X so they are disjoint solids
    const trsf = new oc.gp_Trsf_1();
    trsf.SetTranslation_1(new oc.gp_Vec_4(i * 20, 0, 0));
    const moved = new oc.BRepBuilderAPI_Transform_2(box.Shape(), trsf, false).Shape();
    const label = shapeTool.AddShape(moved, false, true);
    const [r, g, b] = hexToRgb01(hex);
    const qcol = new oc.Quantity_Color_3(r, g, b, oc.Quantity_TypeOfColor.Quantity_TOC_RGB);
    colorTool.SetColor_2(label, qcol, oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf);
  });

  // --- write STEP ---
  const writer = new oc.STEPCAFControl_Writer_1();
  const tmp = `/_step_out_${Math.random().toString(36).slice(2, 10)}.step`;
  writer.Transfer_1(doc, oc.STEPControl_StepModelType.STEPControl_AsIs, null, new oc.Message_ProgressRange_1());
  writer.Write(tmp);
  const bytes = oc.FS.readFile(tmp);
  oc.FS.unlink(tmp);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}
```

- [ ] **Step 2: Write the failing integration test**

```ts
// packages/kernel/src/occt/__tests__/stepColor.integration.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../occtLoader';      // match the real export used elsewhere
import type { OcctInstance } from '../occtLoader';
import { readStep } from '../StepIO';
import { makeColoredBoxStepBytes } from './stepColor.helper';

describe('readStep XCAF color extraction', () => {
  let oc: OcctInstance;
  beforeAll(async () => { oc = await loadOcct(); }, 120_000);

  it('returns per-solid colors index-aligned with solid enumeration', () => {
    const bytes = makeColoredBoxStepBytes(oc, ['#ff0000', '#00ff00']);
    const res = readStep(oc, bytes);
    expect(res.solidCount).toBe(2);
    expect(res.solidColors).toHaveLength(2);
    // colors come back as lowercase #rrggbb; allow ±1 quantization tolerance
    expect(res.solidColors.filter(Boolean).sort()).toEqual(['#00ff00', '#ff0000']);
  });

  it('produces geometry equivalent to the legacy STEPControl_Reader path', () => {
    const bytes = makeColoredBoxStepBytes(oc, ['#ff0000', '#00ff00']);
    const res = readStep(oc, bytes);
    expect(res.solidCount).toBe(2);
    expect(res.faceCount).toBe(12); // 6 faces × 2 boxes
    // bbox spans both boxes (x: 0..30 after the +20 offset)
    expect(res.boundingBox[3] - res.boundingBox[0]).toBeGreaterThan(25);
  });
});
```

Run: `npx vitest run packages/kernel/src/occt/__tests__/stepColor.integration.spec.ts`
Expected: FAIL — `res.solidColors` is `undefined` (field not yet on `StepReadResult`).

> Note: `pnpm --filter app test` swallows stdout in this repo (see project memory). Always invoke `npx vitest run <file>` directly for kernel + app tests.

- [ ] **Step 3: Add `solidColors` to `StepReadResult` and rewrite `readStep`**

In `packages/kernel/src/occt/StepIO.ts`, extend the type:

```ts
export type StepReadResult = {
  shape: OcctShape;
  faceCount: number;
  solidCount: number;
  boundingBox: BoundingBox;
  /** Per-solid surface color as #rrggbb, index-aligned with the canonical
   *  TopExp_Explorer_2(shape, SOLID, SHAPE) enumeration. null when the solid
   *  carries no XCAF color. */
  solidColors: (string | null)[];
};
```

Rewrite the reader body to use `STEPCAFControl_Reader` + a `TDocStd_Document` with color mode, then enumerate solids in canonical order and resolve each color. Reference (verify binding names):

```ts
export function readStep(oc: OcctInstance, stepBytes: ArrayBuffer): StepReadResult {
  const tmpPath = `/_step_in_${Math.random().toString(36).slice(2, 10)}.step`;
  oc.FS.writeFile(tmpPath, new Uint8Array(stepBytes));

  let rawShape: unknown;
  let solidColors: (string | null)[] = [];
  try {
    // --- XCAF document + CAF reader (color mode on) ---
    const app = oc.XCAFApp_Application.GetApplication();
    const doc = new oc.Handle_TDocStd_Document_1();
    app.get().NewDocument(new oc.TCollection_ExtendedString_1(), doc);

    const reader = new oc.STEPCAFControl_Reader_1();
    reader.SetColorMode(true);
    const status = reader.ReadFile(tmpPath);
    const RetDone = oc.IFSelect_ReturnStatus?.IFSelect_RetDone;
    if (RetDone !== undefined && status !== RetDone) {
      throw new Error(`readStep: failed to parse STEP (IFSelect status=${String(status)})`);
    }
    const ok = reader.Transfer_1(doc, new oc.Message_ProgressRange_1());
    if (!ok) throw new Error('readStep: STEPCAFControl_Reader.Transfer failed');

    const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.get().Main()).get();
    const colorTool = oc.XCAFDoc_DocumentTool.ColorTool(doc.get().Main()).get();

    // OneShape equivalent: assemble all free shapes into one compound so the
    // downstream geometry path is unchanged vs STEPControl_Reader.OneShape().
    const builder = new oc.BRep_Builder();
    const comp = new oc.TopoDS_Compound();
    builder.MakeCompound(comp);
    const roots = new oc.TDF_LabelSequence_1();
    shapeTool.GetFreeShapes(roots);
    for (let i = 1; i <= roots.Length(); i++) {
      builder.Add(comp, shapeTool.GetShape(roots.Value(i)));
    }
    builder.delete();
    if (comp == null) throw new Error('readStep: STEP produced an empty shape');
    rawShape = comp;

    // --- per-solid colors in canonical TopExp order (matches split order) ---
    solidColors = extractSolidColors(oc, rawShape, colorTool);

    doc.delete?.();
  } finally {
    try { oc.FS.unlink(tmpPath); } catch { /* ignore */ }
  }

  const wrapped: OcctShape = { __brand: 'OcctShape', handle: rawShape };

  const TAS = (oc as { TopAbs_ShapeEnum: { TopAbs_FACE: unknown; TopAbs_SOLID: unknown; TopAbs_SHAPE: unknown } }).TopAbs_ShapeEnum;
  const ExplorerCtor = (oc as { TopExp_Explorer_2: new (s: unknown, t: unknown, a: unknown) => { More(): boolean; Next(): void; delete?(): void } }).TopExp_Explorer_2;

  let faceCount = 0;
  const faceExp = new ExplorerCtor(rawShape, TAS.TopAbs_FACE, TAS.TopAbs_SHAPE);
  while (faceExp.More()) { faceCount++; faceExp.Next(); }
  faceExp.delete?.();

  let solidCount = 0;
  const solidExp = new ExplorerCtor(rawShape, TAS.TopAbs_SOLID, TAS.TopAbs_SHAPE);
  while (solidExp.More()) { solidCount++; solidExp.Next(); }
  solidExp.delete?.();

  const boundingBox = computeBoundingBox(oc, wrapped);
  return { shape: wrapped, faceCount, solidCount, boundingBox, solidColors };
}
```

Add the color-extraction helper in the same file:

```ts
/** Enumerate solids in canonical TopExp order and resolve each XCAF color.
 *  Returns #rrggbb or null per solid, index-aligned with the same explorer
 *  order splitImportedShapeHelper uses. */
function extractSolidColors(oc: OcctInstance, shape: unknown, colorTool: any): (string | null)[] {
  const TAS = (oc as any).TopAbs_ShapeEnum;
  const ExplorerCtor = (oc as any).TopExp_Explorer_2;
  const out: (string | null)[] = [];
  const exp = new ExplorerCtor(shape, TAS.TopAbs_SOLID, TAS.TopAbs_SHAPE);
  try {
    while (exp.More()) {
      const solid = exp.Current();
      out.push(resolveShapeColor(oc, colorTool, solid));
      exp.Next();
    }
  } finally { exp.delete?.(); }
  return out;
}

/** GetColor(shape, ColorSurf) then fall back to ColorGen. OCCT resolves up the
 *  label hierarchy, so a color set on a parent assembly node is inherited. */
function resolveShapeColor(oc: OcctInstance, colorTool: any, shape: unknown): string | null {
  const ColorType = (oc as any).XCAFDoc_ColorType;
  const tryType = (t: unknown): string | null => {
    const col = new (oc as any).Quantity_Color_1();
    const got = colorTool.GetColor_1(shape, t, col); // verify GetColor overload index
    if (!got) return null;
    return quantityColorToHex(col);
  };
  return tryType(ColorType.XCAFDoc_ColorSurf) ?? tryType(ColorType.XCAFDoc_ColorGen);
}

/** Quantity_Color → #rrggbb. OCCT stores linear RGB; STEP/our render treat the
 *  values as sRGB hex. v1 uses the raw component values (verified against the
 *  chair in manual QA — see spec open item). */
function quantityColorToHex(col: any): string {
  const to255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  const h = (v: number) => to255(v).toString(16).padStart(2, '0');
  return `#${h(col.Red())}${h(col.Green())}${h(col.Blue())}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/kernel/src/occt/__tests__/stepColor.integration.spec.ts`
Expected: PASS (both tests). If the color values are off by sRGB/linear conversion, record the discrepancy and adjust `quantityColorToHex` — this is the spec's flagged open item; resolve it here against the fixture's known input colors.

- [ ] **Step 5: Run the full kernel suite to confirm no regression**

Run: `npx vitest run packages/kernel`
Expected: PASS — existing STEP import/integration tests still green (geometry path unchanged). If any face-naming/projection test regresses, STOP: the XCAF `OneShape` assembly differs from the legacy reader — invoke `superpowers:systematic-debugging` and compare sub-shape ordering before proceeding.

- [ ] **Step 6: Commit**

```bash
git add packages/kernel/src/occt/StepIO.ts packages/kernel/src/occt/__tests__/stepColor.helper.ts packages/kernel/src/occt/__tests__/stepColor.integration.spec.ts
git commit -m "feat(kernel): readStep extracts per-solid XCAF colors via STEPCAFControl_Reader"
```

---

## Task 2: `splitImportedShapeHelper` assigns per-solid colors

**Files:**
- Create: `packages/kernel/src/occt/__tests__/splitImportedShapeColor.spec.ts`
- Modify: `packages/kernel/src/occt/StepIO.ts` (`ExtractedSolid`, `SplitImportedShapeResult`, `splitImportedShapeHelper`)

- [ ] **Step 1: Write the failing test**

Builds a synthetic 2-solid compound directly (no STEP), passes a colors array, asserts assignment. Reuses the existing OCCT box primitive.

```ts
// packages/kernel/src/occt/__tests__/splitImportedShapeColor.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../occtLoader';
import type { OcctInstance } from '../occtLoader';
import { splitImportedShapeHelper } from '../StepIO';
import type { OcctShape } from '../SolidOps';

function twoBoxCompound(oc: OcctInstance): OcctShape {
  const b = new oc.BRep_Builder();
  const comp = new oc.TopoDS_Compound();
  b.MakeCompound(comp);
  b.Add(comp, new oc.BRepPrimAPI_MakeBox_3(10, 10, 10).Shape());
  const trsf = new oc.gp_Trsf_1();
  trsf.SetTranslation_1(new oc.gp_Vec_4(20, 0, 0));
  b.Add(comp, new oc.BRepBuilderAPI_Transform_2(new oc.BRepPrimAPI_MakeBox_3(10, 10, 10).Shape(), trsf, false).Shape());
  b.delete();
  return { __brand: 'OcctShape', handle: comp };
}

describe('splitImportedShapeHelper color assignment', () => {
  let oc: OcctInstance;
  beforeAll(async () => { oc = await loadOcct(); }, 120_000);

  it('assigns solidColors index-aligned to extracted solids', () => {
    const res = splitImportedShapeHelper(oc, twoBoxCompound(oc), ['#ff0000', null]);
    expect(res.solids).toHaveLength(2);
    expect(res.solids[0]!.color).toBe('#ff0000');
    expect(res.solids[1]!.color).toBeUndefined();
  });

  it('leaves color undefined when no colors array is passed', () => {
    const res = splitImportedShapeHelper(oc, twoBoxCompound(oc));
    expect(res.solids[0]!.color).toBeUndefined();
  });
});
```

Run: `npx vitest run packages/kernel/src/occt/__tests__/splitImportedShapeColor.spec.ts`
Expected: FAIL — `splitImportedShapeHelper` takes only 2 args / `ExtractedSolid` has no `color`.

- [ ] **Step 2: Add `color` to the result types**

```ts
export type ExtractedSolid = {
  brepBlobId: string;
  boundingBox: BoundingBox;
  shape: OcctShape;
  /** Per-body color as #rrggbb from the STEP XCAF data; undefined when none. */
  color?: string;
};
```

- [ ] **Step 3: Add the optional `solidColors` param and assign in the pass-1 loop**

Change the signature:

```ts
export function splitImportedShapeHelper(
  oc: OcctInstance,
  compound: OcctShape,
  solidColors?: (string | null)[],
): SplitImportedShapeResult {
```

In the pass-1 `while (solidExp.More())` loop, track the index and set `color`:

```ts
  const solids: ExtractedSolid[] = [];
  let solidIndex = 0;
  const solidExp = new ExplorerCtor(compound.handle, TAS.TopAbs_SOLID, TAS.TopAbs_SHAPE);
  try {
    while (solidExp.More()) {
      const handle = solidExp.Current();
      const builder = new BuilderCtor();
      const comp = new CompoundCtor();
      builder.MakeCompound(comp);
      builder.Add(comp, handle);
      builder.delete();
      const subShape: OcctShape = { __brand: 'OcctShape' as const, handle: comp };
      const boundingBox = computeBoundingBox(oc, subShape);
      const brepBlobId = `imp-${crypto.randomUUID()}`;
      const color = solidColors?.[solidIndex] ?? undefined;
      solids.push({ brepBlobId, boundingBox, shape: subShape, ...(color ? { color } : {}) });
      solidIndex++;
      solidExp.Next();
    }
  } finally {
    solidExp.delete?.();
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/kernel/src/occt/__tests__/splitImportedShapeColor.spec.ts`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/StepIO.ts packages/kernel/src/occt/__tests__/splitImportedShapeColor.spec.ts
git commit -m "feat(kernel): splitImportedShapeHelper assigns per-solid color from solidColors"
```

---

## Task 3: `importStep` caches colors; `splitImportedShape` returns them

**Files:**
- Modify: `packages/kernel/src/api.ts` (`importedColorCache`, `importStep`, `splitImportedShape`, API return type for `splitImportedShape`)
- Create/extend: `packages/kernel/src/__tests__/importStepColor.integration.spec.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/kernel/src/__tests__/importStepColor.integration.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createKernelApi } from '../api';
import { loadOcct } from '../occt/occtLoader';
import type { OcctInstance } from '../occt/occtLoader';
import { makeColoredBoxStepBytes } from '../occt/__tests__/stepColor.helper';

describe('importStep + splitImportedShape color round-trip', () => {
  let oc: OcctInstance;
  beforeAll(async () => { oc = await loadOcct(); }, 120_000);

  it('split returns per-solid color extracted at import time', async () => {
    const kernel = createKernelApi();
    await kernel.init();
    const bytes = makeColoredBoxStepBytes(oc, ['#ff0000', '#00ff00']);
    const { brepBlobId, solidCount } = await kernel.importStep({ stepBytes: bytes, partName: 'boxes' });
    expect(solidCount).toBe(2);
    const { solids } = await kernel.splitImportedShape(brepBlobId);
    expect(solids).toHaveLength(2);
    expect(solids.map((s) => s.color).filter(Boolean).sort()).toEqual(['#00ff00', '#ff0000']);
  });
});
```

> If `createKernelApi().init()` needs an OCCT instance injected rather than loading its own, match the pattern the existing kernel integration tests use (check a sibling `*.integration.spec.ts`). Adjust the harness accordingly — do not invent a new init path.

Run: `npx vitest run packages/kernel/src/__tests__/importStepColor.integration.spec.ts`
Expected: FAIL — `solids[i].color` is `undefined` (API drops it).

- [ ] **Step 2: Add `importedColorCache` and cache colors in `importStep`**

Near the other caches (~`api.ts:188`):

```ts
  /** Per-import solid colors, keyed by the whole-compound brepBlobId returned
   *  by importStep. Consumed by splitImportedShape (separate round-trip). */
  const importedColorCache = new Map<string, (string | null)[]>();
```

In `importStep` (~427), after `registerImportedShape(brepBlobId, result.shape)`:

```ts
      registerImportedShape(brepBlobId, result.shape);
      importedColorCache.set(brepBlobId, result.solidColors);
```

- [ ] **Step 3: Read the cache in `splitImportedShape` and return per-solid color**

Update the API method type (`api.ts` ~102):

```ts
  splitImportedShape(brepBlobId: string): Promise<{
    solids: Array<{ brepBlobId: string; boundingBox: BoundingBox; color?: string }>;
    surfaces: { brepBlobId: string; boundingBox: BoundingBox } | null;
  }>;
```

Update the implementation (~443):

```ts
    async splitImportedShape(brepBlobId) {
      if (!occt) throw new Error('kernel not initialized');
      const cached = importedShapeCache.get(brepBlobId);
      if (!cached) throw new Error(`splitImportedShape: brepBlobId '${brepBlobId}' not in importedShapeCache`);
      const solidColors = importedColorCache.get(brepBlobId);
      const result = splitImportedShapeHelper(occt, cached, solidColors);
      const solids = result.solids.map((s) => {
        registerImportedShape(s.brepBlobId, s.shape);
        return { brepBlobId: s.brepBlobId, boundingBox: s.boundingBox, ...(s.color ? { color: s.color } : {}) };
      });
      let surfaces: { brepBlobId: string; boundingBox: BoundingBox } | null = null;
      if (result.surfaces) {
        const surfacesBbox = computeBoundingBox(occt, result.surfaces.shape);
        registerImportedShape(result.surfaces.brepBlobId, result.surfaces.shape);
        surfaces = { brepBlobId: result.surfaces.brepBlobId, boundingBox: surfacesBbox };
      }
      return { solids, surfaces };
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/kernel/src/__tests__/importStepColor.integration.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/api.ts packages/kernel/src/__tests__/importStepColor.integration.spec.ts
git commit -m "feat(kernel): importStep caches solid colors, splitImportedShape returns them"
```

---

## Task 4: Add optional `color` fields to shared types

**Files:**
- Modify: `packages/shared/src/types.ts` (`ImportedFeature`, `PartDocument`)

No standalone test — the fields are exercised by Tasks 5/6/8. This task is a pure additive type change (no migration: optional fields default to `undefined`, matching the v9/v10/v12 precedent).

- [ ] **Step 1: Add `color?` to `ImportedFeature`**

```ts
export type ImportedFeature = {
  kind: 'imported';
  id: string;
  /** Source filename of the originating STEP, for diagnostics only. */
  sourceStep: string;
  /** Blob id of the cached B-rep body. */
  bodyRef: string;
  /** Per-body color (#rrggbb) read from the STEP XCAF data, if any. */
  color?: string;
};
```

- [ ] **Step 2: Add `color?` to `PartDocument`**

```ts
export type PartDocument = {
  id: string;
  name: string;
  units: 'mm';
  parameters: Record<string, SketchParameter>;
  featureTree: Feature[];
  cachedGeometry?: CachedGeometry;
  properties: Record<string, string | number | boolean>;
  materials: MaterialEntry[];
  hardware: HardwareEntry[];
  /** Intrinsic part color (e.g. from STEP import). Default render color in
   *  part view; seeds ComponentInstance.color on explode/insert. User
   *  colorOverrides still win. */
  color?: ComponentColor;
};
```

- [ ] **Step 3: Typecheck to confirm no breakage**

Run: `npx tsc --noEmit -p packages/shared/tsconfig.json`
Expected: PASS (additive optional fields break nothing).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): optional color on ImportedFeature + PartDocument (additive, no migration)"
```

---

## Task 5: `buildImportedPartDocument` sets color

**Files:**
- Create: `packages/app/src/import/__tests__/buildImportedPartDocument.color.spec.ts`
- Modify: `packages/app/src/import/buildImportedPartDocument.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/import/__tests__/buildImportedPartDocument.color.spec.ts
import { describe, it, expect } from 'vitest';
import { buildImportedPartDocument } from '../buildImportedPartDocument';
import type { ImportedFeature } from '@zilventor/shared';

describe('buildImportedPartDocument color', () => {
  it('sets PartDocument.color and ImportedFeature.color from a hex color', () => {
    const doc = buildImportedPartDocument('part', 'blob-1', 'f.step', undefined, '#a01010');
    expect(doc.color).toEqual({ kind: 'hex', hex: '#a01010' });
    const imp = doc.featureTree.find((f): f is ImportedFeature => f.kind === 'imported');
    expect(imp?.color).toBe('#a01010');
  });

  it('leaves color undefined when no color is given', () => {
    const doc = buildImportedPartDocument('part', 'blob-1', 'f.step');
    expect(doc.color).toBeUndefined();
    const imp = doc.featureTree.find((f): f is ImportedFeature => f.kind === 'imported');
    expect(imp?.color).toBeUndefined();
  });
});
```

Run: `npx vitest run packages/app/src/import/__tests__/buildImportedPartDocument.color.spec.ts`
Expected: FAIL — function takes 4 args; no color set.

- [ ] **Step 2: Add the optional `color` param and set both fields**

```ts
export function buildImportedPartDocument(
  partName: string,
  brepBlobId: string,
  fileName: string,
  partId?: string,
  color?: string,
): PartDocument {
  const id = partId ?? crypto.randomUUID();
  const importedFeature: ImportedFeature = {
    kind: 'imported',
    id: crypto.randomUUID(),
    sourceStep: fileName,
    bodyRef: brepBlobId,
    ...(color ? { color } : {}),
  };
  return {
    id,
    name: partName,
    units: 'mm',
    parameters: {},
    featureTree: [...ORIGIN_FEATURES, importedFeature],
    properties: {},
    materials: [],
    hardware: [],
    ...(color ? { color: { kind: 'hex', hex: color } as const } : {}),
  };
}
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run packages/app/src/import/__tests__/buildImportedPartDocument.color.spec.ts`
Expected: PASS (both).

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/import/buildImportedPartDocument.ts packages/app/src/import/__tests__/buildImportedPartDocument.color.spec.ts
git commit -m "feat(import): buildImportedPartDocument threads STEP color onto part + feature"
```

---

## Task 6: `importStepIntoNewParts` threads per-solid color

**Files:**
- Modify: `packages/app/src/import/importStepIntoNewParts.ts`
- Create: `packages/app/src/import/__tests__/importStepIntoNewParts.color.spec.ts`

- [ ] **Step 1: Write the failing test**

Mocks the kernel so `splitImportedShape` returns colored solids; asserts each part's color and that the surfaces part is uncolored.

```ts
// packages/app/src/import/__tests__/importStepIntoNewParts.color.spec.ts
import { describe, it, expect } from 'vitest';
import { importStepIntoNewParts } from '../importStepIntoNewParts';

function makeKernel() {
  return {
    importStep: async () => ({ brepBlobId: 'whole', triangleCount: 0, boundingBox: [0,0,0,1,1,1] as const, faceCount: 1, solidCount: 2 }),
    splitImportedShape: async () => ({
      solids: [
        { brepBlobId: 's0', boundingBox: [0,0,0,1,1,1] as const, color: '#ff0000' },
        { brepBlobId: 's1', boundingBox: [0,0,0,1,1,1] as const },
      ],
      surfaces: { brepBlobId: 'surf', boundingBox: [0,0,0,1,1,1] as const },
    }),
    registerPart: async () => {},
    saveToBytes: async () => new Uint8Array([1]),
  };
}

describe('importStepIntoNewParts color', () => {
  it('threads per-solid color onto each part; surfaces part stays uncolored', async () => {
    const writes: string[] = [];
    const opfs = { write: async (p: string) => { writes.push(p); }, listAll: async () => [] };
    const res = await importStepIntoNewParts({
      baseName: 'boxes', sourceFileName: 'boxes.step', stepBytes: new ArrayBuffer(8),
      kernel: makeKernel() as never, opfs,
    });
    const byBlob = new Map(res.map((r) => [r.part.featureTree.find((f) => f.kind === 'imported')!.bodyRef, r.part]));
    expect(byBlob.get('s0')!.color).toEqual({ kind: 'hex', hex: '#ff0000' });
    expect(byBlob.get('s1')!.color).toBeUndefined();
    expect(byBlob.get('surf')!.color).toBeUndefined();
  });
});
```

Run: `npx vitest run packages/app/src/import/__tests__/importStepIntoNewParts.color.spec.ts`
Expected: FAIL — `registerOne` ignores color; parts have no color.

- [ ] **Step 2: Thread color through `registerOne`**

Change `registerOne` to accept an optional color and pass it to `buildImportedPartDocument`:

```ts
  async function registerOne(brepBlobId: string, candidateName: string, color?: string): Promise<void> {
    const name = dedupeName(candidateName, [...existing, ...registered.map((r) => r.part.name)]);
    const part = buildImportedPartDocument(name, brepBlobId, sourceFileName, undefined, color);
    await kernel.registerPart(part);
    const archiveBytes = await kernel.saveToBytes(part.id);
    const opfsPath = `${name}.zipt`;
    await opfs.write(opfsPath, archiveBytes);
    registered.push({ partId: part.id, opfsPath, part, archiveBytes });
  }
```

Pass each solid's color in the solids loop:

```ts
      const candidateName = solids.length === 1 ? baseName : `${baseName}_${i + 1}`;
      await registerOne(solid.brepBlobId, candidateName, solid.color);
```

(Leave the `surfaces` call unchanged — surfaces stay uncolored.)

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run packages/app/src/import/__tests__/importStepIntoNewParts.color.spec.ts`
Expected: PASS.

- [ ] **Step 4: Run the existing importStepIntoNewParts suite**

Run: `npx vitest run packages/app/src/import/__tests__/importStepIntoNewParts.spec.ts`
Expected: PASS — adding an optional 3rd arg to `registerOne` doesn't change existing behavior.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/import/importStepIntoNewParts.ts packages/app/src/import/__tests__/importStepIntoNewParts.color.spec.ts
git commit -m "feat(import): importStepIntoNewParts threads per-solid STEP color into part docs"
```

---

## Task 7: Single-part viewport renders `PartDocument.color`

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts` (`setMesh`)
- Modify: `packages/app/src/App.tsx` (every `setMesh` call site)
- Create: `packages/app/src/viewport/__tests__/setMeshColor.spec.ts`

- [ ] **Step 1: Write the failing test**

Follow the existing SceneManager test setup (there is already a viewport test suite — match its canvas/WebGL mock harness).

```ts
// packages/app/src/viewport/__tests__/setMeshColor.spec.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SceneManager } from '../SceneManager';

// Reuse the harness pattern from the existing SceneManager tests to construct
// an instance against a mock canvas. (Copy the beforeEach setup verbatim.)

describe('SceneManager.setMesh color', () => {
  it('uses the provided hex color on the part material', () => {
    const sm = /* construct per existing harness */ null as unknown as SceneManager;
    const pos = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
    const idx = new Uint32Array([0,1,2]);
    sm.setMesh(pos, idx, '#ff0000');
    const mesh = (sm as unknown as { current: THREE.Mesh }).current;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe('ff0000');
  });

  it('falls back to default gray when no color is given', () => {
    const sm = /* construct per existing harness */ null as unknown as SceneManager;
    sm.setMesh(new Float32Array([0,0,0,1,0,0,0,1,0]), new Uint32Array([0,1,2]));
    const mesh = (sm as unknown as { current: THREE.Mesh }).current;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe('c8c8c8');
  });
});
```

Run: `npx vitest run packages/app/src/viewport/__tests__/setMeshColor.spec.ts`
Expected: FAIL — `setMesh` ignores a 3rd arg.

- [ ] **Step 2: Add the optional `colorHex` param to `setMesh`**

In `SceneManager.ts`, find `setMesh` (~line 130) and update its signature + material:

```ts
  setMesh(positions: Float32Array, indices: Uint32Array, colorHex?: string): void {
    // ...existing disposal + geometry build unchanged...
    const m = new THREE.MeshStandardMaterial({ color: colorHex ?? 0xc8c8c8, flatShading: true, side: THREE.DoubleSide });
    this.current = new THREE.Mesh(g, m);
    // ...rest unchanged...
  }
```

- [ ] **Step 3: Pass `activePart.color` at every `setMesh` call site in App.tsx**

There are three `setMesh` calls (≈ lines 1072, 1282, 1750 — confirm with `grep -n "\.setMesh(" packages/app/src/App.tsx`). For each, resolve the active part's hex (STEP colors are always `{kind:'hex'}`) and pass it:

```ts
// at each call site where `activePart` is in scope:
const partHex = activePart?.color?.kind === 'hex' ? activePart.color.hex : undefined;
viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices, partHex);
```

If a particular call site does not have `activePart` in scope, derive the part document already available there (e.g. the doc whose geometry is being pushed) and read `.color` the same way. Do not pass a color a call site cannot legitimately resolve — pass `undefined`.

- [ ] **Step 4: Run the test + typecheck**

Run: `npx vitest run packages/app/src/viewport/__tests__/setMeshColor.spec.ts`
Expected: PASS (both).
Run: `grep -n "\.setMesh(" packages/app/src/App.tsx` then `npx tsc --noEmit -p packages/app/tsconfig.json 2>&1 | grep -E "App.tsx|SceneManager"`
Expected: no new errors in those files.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/viewport/SceneManager.ts packages/app/src/App.tsx packages/app/src/viewport/__tests__/setMeshColor.spec.ts
git commit -m "feat(viewport): single-part view renders PartDocument color"
```

---

## Task 8: Explode/insert stamp `ComponentInstance.color`

**Files:**
- Modify: `packages/app/src/commands/ExplodeIntoAssemblyCommand.ts`
- Modify: `packages/app/src/commands/ImportStepAsComponentCommand.ts`
- Create: `packages/app/src/commands/__tests__/explodeColor.spec.ts`

- [ ] **Step 1: Write the failing test (ExplodeIntoAssembly)**

Construct the command so the imported parts carry color, run it, assert the created components carry matching `color`. Match the existing `ExplodeIntoAssemblyCommand` test harness (there are e2e + unit specs already — copy their setup for kernel/opfs/store mocks).

```ts
// packages/app/src/commands/__tests__/explodeColor.spec.ts
import { describe, it, expect } from 'vitest';
// import the command + the same mock harness the existing Explode tests use.

describe('ExplodeIntoAssemblyCommand color stamping', () => {
  it('stamps each component color from the imported part color', async () => {
    // Arrange: kernel.splitImportedShape returns solids [{color:'#ff0000'}, {}].
    // Act: execute the command.
    // Assert: the two added ComponentInstances have
    //   components[0].color === { kind: 'hex', hex: '#ff0000' }
    //   components[1].color === undefined
  });
});
```

> Fill the harness body from the sibling Explode spec — do not invent new mocks. The assertion is the contract: component color mirrors `part.color`.

Run: `npx vitest run packages/app/src/commands/__tests__/explodeColor.spec.ts`
Expected: FAIL — components have no color.

- [ ] **Step 2: Stamp color in `ExplodeIntoAssemblyCommand`**

Update `makeOriginInstance` to take the part (or its color) and set it:

```ts
function makeOriginInstance(partPath: string, color?: ComponentColor): ComponentInstance {
  return {
    id: `comp-${crypto.randomUUID()}`,
    partPath,
    position: { x: 0, y: 0, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
    ...(color ? { color } : {}),
  };
}
```

At the call site (after `buildImportedPartDocument` / `registerPart`, ~line 88-94), pass the part's color:

```ts
const partDoc = buildImportedPartDocument(name, solid.brepBlobId, sourceStep, undefined, solid.color);
await kernel.registerPart(partDoc);
// ...
components.push(makeOriginInstance(partPath, partDoc.color));
```

(Import `ComponentColor` from `@zilventor/shared` if not already imported.)

- [ ] **Step 3: Stamp color in `ImportStepAsComponentCommand`**

This command uses `importStepIntoNewParts` (Task 6 already sets `part.color`) and stores the resulting parts in `this.placedParts` with `this.placedPartPaths`. Map each path to its part and pass the color to `makeOriginInstance`:

```ts
const partByPath = new Map(this.placedParts.map((p, i) => [this.placedPartPaths[i], p]));
for (const partPath of this.placedPartPaths) {
  const part = partByPath.get(partPath);
  const instance = makeOriginInstance(partPath, part?.color);
  useAppStore.getState().addComponent(instance);
  this.placedIds.push(instance.id);
}
```

Apply the same `makeOriginInstance(partPath, color?)` signature change in this file (it has its own copy ~line 187).

> Verify `this.placedParts` and `this.placedPartPaths` are index-aligned in this command (read the surrounding code). If they are not, key the map off whatever stable identifier the command already stores. Do not assume alignment without checking.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/app/src/commands/__tests__/explodeColor.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run both command suites for regression**

Run: `npx vitest run packages/app/src/commands/__tests__/ExplodeIntoAssemblyCommand* packages/app/src/commands/__tests__/ImportStepAsComponentCommand*`
Expected: PASS — adding an optional color arg + stamping doesn't change existing assertions (those parts had no color, so `instance.color` stays undefined).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/commands/ExplodeIntoAssemblyCommand.ts packages/app/src/commands/ImportStepAsComponentCommand.ts packages/app/src/commands/__tests__/explodeColor.spec.ts
git commit -m "feat(commands): explode/insert stamp ComponentInstance.color from STEP part color"
```

---

## Task 9: E2E — colored STEP renders + persists

**Files:**
- Create: an e2e spec in the existing app e2e directory (match the location + harness of `T-6-*` / STEP-import e2e specs, e.g. `packages/app/e2e/`).
- Create (committed fixture): a small colored STEP file, OR generate it in-test via the helper if the e2e harness can run OCCT. Prefer a committed `two-colored-boxes.step` fixture generated once with `makeColoredBoxStepBytes` and saved, mirroring the committed `two-bodies.step` / `mixed-solid-surface.step` precedent.

- [ ] **Step 1: Generate + commit the fixture**

Add a one-off script step (or reuse an existing fixture-gen test) to write `two-colored-boxes.step` from `makeColoredBoxStepBytes(oc, ['#ff0000', '#00ff00'])` into the e2e fixtures directory next to the existing STEP fixtures. Verify it opens.

- [ ] **Step 2: Write the failing e2e**

Drive the real app: File→Open the colored STEP (single-part path), assert the rendered mesh material color is the STEP color (not gray); then Explode Into Assembly and assert each component renders its color; reload and assert persistence. Read the actual values via the browser (the existing STEP e2e specs show how to reach into the viewport / store). Assert against `#ff0000`/`#00ff00`.

> Drawing/command modules are not window-exposed in this repo (project memory): if the e2e needs to invoke a command directly, use `await import('/src/commands/<Cmd>.ts')` inside `page.evaluate`. Do not ship a silent skip-guard — a hollow e2e that passes without asserting color is a failure.

Run: the project's e2e runner for this spec (match how existing e2e are invoked — check `package.json` scripts; likely `npx playwright test <spec>`).
Expected: FAIL until the full chain (Tasks 1–8) is wired — by this point it should pass; if not, debug per `superpowers:systematic-debugging`.

- [ ] **Step 3: Run the e2e to verify it passes**

Expected: PASS — colored mesh in part view + assembly view, surviving reload.

- [ ] **Step 4: Commit**

```bash
git add packages/app/e2e/  # adjust path
git commit -m "test(e2e): colored STEP renders per-body color in part + assembly views"
```

---

## Task 10: Manual verification (chair STEP) — GATE

**Not auto-testable.** Requires the user's chair `.step` file and a browser session (OPFS/WASM need Chrome/Edge).

- [ ] **Step 1: Obtain the chair `.step` path from the user.**
- [ ] **Step 2: Start the dev server** (`pnpm --filter @zilventor/app dev`, localhost:5173, Chrome/Edge).
- [ ] **Step 3:** File→Open the chair STEP. Confirm: (a) per-body colors render (not uniform gray), (b) the DoubleSide fix holds (open surfaces visible both sides), (c) orbit shows no clipping.
- [ ] **Step 4:** If colors look wrong (washed out / too dark), it is the sRGB-vs-linear conversion (spec open item) — adjust `quantityColorToHex` in `StepIO.ts` and re-run Task 1's color assertion, then re-verify.
- [ ] **Step 5:** Capture a screenshot and read it back. Record the result. If a renderer bug surfaces, treat it as a new bug (`superpowers:systematic-debugging`), not a silent skip.

---

## Final verification

- [ ] `npx vitest run packages/kernel` — green.
- [ ] `npx vitest run packages/app` (or `npx vitest run` per repo convention) — green.
- [ ] `npx tsc --noEmit -p packages/app/tsconfig.json` shows no NEW errors beyond the pre-existing unrelated drawing/command type errors (record the baseline count before starting).
- [ ] Manual chair check (Task 10) done + screenshot read back.
- [ ] Update auto-memory with the shipped state per the project's convention.

---

## Self-Review (planner)

**Spec coverage:** Reader switch + color extraction → Task 1. Per-solid split color → Task 2. Two-round-trip cache → Task 3. Data model → Task 4. Import plumbing → Tasks 5–6. Single-part render → Task 7. Assembly via instance stamping (revised decision #5) → Task 8. Fallback-to-gray → covered by the "no color → undefined" assertions in Tasks 1/2/5/6/7. Testing strategy (spike, kernel unit, app unit, e2e, manual) → Tasks 1, 2/3, 5/6/8, 9, 10. No manifest bump → Task 4 (additive). All spec sections map to a task.

**Placeholder scan:** OCCT XCAF code is explicitly flagged "reference, verify bindings" with a grep command — not a TODO. Test harness bodies for Tasks 7/8/9 say "copy the existing harness" with the exact assertion contract spelled out, because the existing canvas/WebGL/kernel mocks must not be reinvented; the *behavior under test* is fully specified. No "TBD"/"implement later".

**Type consistency:** `solidColors: (string|null)[]` used consistently (StepReadResult → importedColorCache → splitImportedShapeHelper param). `ExtractedSolid.color?: string` (hex). `splitImportedShape` API returns `color?: string`. `ImportedFeature.color?: string` (hex). `PartDocument.color?: ComponentColor` (`{kind:'hex'}`). `setMesh(…, colorHex?: string)`. `makeOriginInstance(partPath, color?: ComponentColor)`. Kernel boundary speaks hex strings; the app converts to `ComponentColor` once, in `buildImportedPartDocument`. Consistent end to end.

**Known residual risks (carried into execution):** (1) exact XCAF overload names — mitigated by the grep + Task 1 spike; (2) sRGB vs linear color — flagged in Tasks 1 & 10; (3) `STEPCAFControl_Reader.OneShape`-equivalent (GetFreeShapes compound) must match the legacy reader's geometry — gated by Task 1 Step 5 full-suite run; (4) `placedParts`/`placedPartPaths` index alignment in `ImportStepAsComponentCommand` — Task 8 Step 3 requires verifying before relying on it.
