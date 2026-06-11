# 3D STEP/STL export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax.

**Goal:** Add Export STEP (structured XCAF: named + transformed + colored components) and Export STL (binary mesh) for the active part and the active assembly, reusing the OCCT writers already in the WASM build.

**Architecture:** New kernel methods (exportStep/Stl Part/Assembly) that re-execute-if-cold then write via STEPCAFControl_Writer / direct binary-STL-from-tessellate; a pure app-side resolver (ComponentColor→rgb, partPath→partId, world poses, names); thin Export*Command + FileTab buttons mirroring the image/DXF exports. No manifest bump.

**Tech Stack:** TypeScript monorepo (pnpm), Vitest (+ real-OCCT integration config), Playwright (real-WASM e2e), OCCT/opencascade.js full build (STEPCAFControl_Writer, BRepMesh), Comlink worker, react-i18next.

---

## Contract (canonical — every task imports these signatures/paths/OCCT-API)

Verified: the proven helper uses `Quantity_TOC_sRGB` (not `Quantity_TOC_RGB`). This is a real divergence from the spec/instructions worth flagging. Both the reader (`StepIO.ts:213-215`) and the writer helper round-trip on sRGB. I have all facts confirmed. Emitting the contract.

---

# Contract: 3D STEP/STL Export — Canonical Imports for All Chunks

**Base:** master `a57b1f7` (working tree on `master`). No manifest bump. Every chunk imports the names below verbatim. All file:line anchors below were read against the real tree on 2026-06-11.

> **⚠️ Two spec/instruction divergences CONFIRMED against real code — chunks MUST follow the code, not the brief:**
> 1. **Color type constant:** the PROVEN write helper (`stepColor.helper.ts:47,59`) AND the shipped reader (`StepIO.ts:213-215`) round-trip on **`Quantity_TOC_sRGB`**, NOT `Quantity_TOC_RGB`. The §10 color round-trip uses `readStep`→`quantityColorToHex` (sRGB-as-is). Re-emit **`oc.Quantity_TypeOfColor.Quantity_TOC_sRGB`** in `new Quantity_Color_3(r,g,b,…)` or the round-trip will quantize wrong. (The instruction text said `Quantity_TOC_RGB` — overridden by code.)
> 2. **`stepColor.helper.ts` path:** it lives at `packages/kernel/src/occt/__tests__/stepColor.helper.ts` (a TEST helper), NOT `packages/kernel/src/occt/stepColor.helper.ts`. `hexToRgb01` is a private fn there — Phase 5a writes its OWN `effectiveColorToRgb`/hex parse (app pkg can't import a kernel test file).

---

## A. Files to CREATE + MODIFY (real anchors)

### Kernel (`packages/kernel/src`)
**CREATE:**
- `occt/StepExport.ts` — `exportStepDoc(oc, leaves: KernelExportLeaf[]): Uint8Array` (the XCAF build + STEPCAF write + FS readback). Pure-OCCT, no `parts`/cache access.
- `occt/StlExport.ts` — `exportStlBinary(oc, leaves: {shape, pose?}[]): Uint8Array` (tessellate + posed-vertex transform + REVERSED-winding flip + binary STL emit). Pure-OCCT.
- `occt/__tests__/StlExport.integration.spec.ts` (Phase 1+2), `occt/__tests__/StepExport.integration.spec.ts` (Phase 3+4), `occt/__tests__/binaryStlParser.ts` (test-only parser, §F).

**MODIFY:**
- `api.ts` — add 4 methods to the `KernelApi` type (after `cutAssemblyComponentsByStepSegments`, type at **api.ts:185-188**; impl after `extractAssemblyRef`, **api.ts:513-532**). Add `import { exportStepDoc } from './occt/StepExport'` and `import { exportStlBinary } from './occt/StlExport'` near **api.ts:8-9**. They reuse the in-scope closures `parts`, `namedShapeCache`, `workFeatureCache`, `lookupImportedShape`, `updateNamedShapeCache`, `executeTree` (the cold-cache helper, §D).
- `api.ts` integration test → add cases to a NEW `__tests__/api.export.integration.spec.ts` (uses `createKernelApi()`+`init()`+`createPart`/`addFeature`/`execute`, the harness at `__tests__/api.integration.spec.ts:8-23`).

### App (`packages/app/src`)
**CREATE:**
- `assembly/resolveExportLeaves.ts` — `effectiveColorToRgb(...)` + `resolveExportLeaves(...)` (Phase 5a, §E). Pure async-resolver module.
- `assembly/__tests__/resolveExportLeaves.spec.ts` (Phase 5a, run via app vitest.config.ts — jsdom).
- `commands/ExportStepCommand.ts`, `commands/ExportStlCommand.ts` (Phase 5b; mirror `commands/ExportDrawingDxfCommand.ts:5-30`).

**MODIFY:**
- `shell/tabs/FileTab.tsx` — 2 handlers near `handleExportImage` (**FileTab.tsx:25-39**); 2 buttons after the Export-Image button (**FileTab.tsx:272-278**), `disabled={!activeDoc || activeDoc.kind === 'drawing'}` (mirror **:274**).
- `i18n/locales/en.json` + `i18n/locales/uk.json` — add `menu.file.exportStep` / `menu.file.exportStl` (en.json `menu.file` block at **:594-601**). Gated by `i18n/parity.test.ts:16-22`.
- e2e (Phase 6): new `packages/app/e2e/export-3d.spec.ts` (or per-repo e2e dir convention).

---

## B. Canonical kernel signatures + ExportLeaf types

Add to **`KernelApi`** type (`api.ts`, after :188) and the returned object (after :532). Comlink auto-exposes them — **no `KernelClient` edit** (`worker.ts:5` `Comlink.expose(api,…)`).

```ts
// === in api.ts, exported for app + kernel reuse ===
import type { Pose } from '@zilventor/shared'; // NOTE: app Pose lives in app; kernel uses a structural pose (below)

/** World pose as already produced by composedPoses (app) / cutAssemblyComponentsByStepSegments (kernel). */
export type ExportPose = {
  translation: { x: number; y: number; z: number };
  quaternion: readonly [number, number, number, number];
};

/** App→kernel assembly leaf. color is pre-resolved to 0–1 RGB app-side (§E). */
export type ExportLeaf = {
  partId: string;
  name: string;
  pose: ExportPose;
  color?: readonly [number, number, number];
};

// === KernelApi methods ===
exportStepPart(partId: string): Promise<Uint8Array>;
exportStlPart(partId: string, opts?: { binary?: boolean }): Promise<Uint8Array>;
exportStepAssembly(leaves: readonly ExportLeaf[], opts?: { name?: string }): Promise<Uint8Array>;
exportStlAssembly(leaves: readonly ExportLeaf[], opts?: { binary?: boolean }): Promise<Uint8Array>;
```

`exportStepPart(partId)` = build a 1-leaf XCAF doc: `[{ partId, name: parts.get(partId)!.name, pose: IDENTITY_POSE, color: undefined }]` → `exportStepDoc`. (`opts.binary` on STL is accepted but only `true`/absent is honored this slice; ASCII is a non-goal §12 — throw or ignore non-binary.)

**`KernelExportLeaf` (kernel-internal, what `exportStepDoc`/`exportStlBinary` receive — shape already resolved):**
```ts
// occt/StepExport.ts
export type KernelExportLeaf = {
  shape: OcctShape;            // UN-POSED prototype handle (from namedShapeCache)
  name: string;
  pose: ExportPose;           // identity for a single part
  color?: readonly [number, number, number];
};
```
`IDENTITY_POSE: ExportPose = { translation: { x:0,y:0,z:0 }, quaternion: [0,0,0,1] }`.

---

## C. EXACT OCCT write sequence (CONFIRMED vs `stepColor.helper.ts` + the real `.d.ts`)

`exportStepDoc(oc, leaves)` in `occt/StepExport.ts`. **De-dup prototypes by a stable key** (kernel partId, threaded onto `KernelExportLeaf` as `protoKey`): `AddShape` ONCE per distinct part; `AddComponent_1` once per leaf.

```ts
// --- doc bootstrap (verbatim shape of stepColor.helper.ts:12-19) ---
const app = oc.XCAFApp_Application.GetApplication().get();
const docH = new oc.Handle_TDocStd_Document_1();
app.NewDocument_2(new oc.TCollection_ExtendedString_2('XmlXCAF'), docH);
const doc = docH.get();
const main = doc.Main();

// --- tools: .get() unwraps the Handle (helper :22-34) ---
const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(main).get();
const colorTool = oc.XCAFDoc_DocumentTool.ColorTool(main).get();

const QTOC = oc.Quantity_TypeOfColor.Quantity_TOC_sRGB;        // ⚠️ sRGB, per helper :47 + reader
const SURF = oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf;            // parity w/ reader StepIO.ts:145

// 1. One labeled, UN-POSED prototype per distinct part (helper :56,60)
const protoLabels = new Map<string, unknown>();  // protoKey -> label
for (const leaf of distinctProtos) {
  const partLabel = shapeTool.AddShape(leaf.shape.handle, false, true); // (s, makeAssembly=false, makePrepare=true)
  oc.TDataStd_Name.Set_1(partLabel, new oc.TCollection_ExtendedString_2(leaf.name)); // NO ShapeTool.SetName
  if (leaf.color) {
    const [r, g, b] = leaf.color;
    const qcol = new oc.Quantity_Color_3(r, g, b, QTOC);
    colorTool.SetColor_2(partLabel, qcol, SURF);
  }
  protoLabels.set(leaf.protoKey, partLabel);
}

// 2. One component per leaf — pose lives ONLY in the TopLoc_Location (NEVER baked into the shape)
const asmLabel = shapeTool.NewShape(); // root assembly label (XCAFDoc_ShapeTool.NewShape() -> TDF_Label)
for (const leaf of leaves) {
  const trsf = trsfFromPose(oc, leaf.pose);                    // SetValues, quat→3×3 (§ reuse TransformOps math, NOT its Transform output)
  const partLabel = protoLabels.get(leaf.protoKey)!;
  const compLabel = shapeTool.AddComponent_1(asmLabel, partLabel, new oc.TopLoc_Location_2(trsf));
  oc.TDataStd_Name.Set_1(compLabel, new oc.TCollection_ExtendedString_2(leaf.name)); // per-instance name
  trsf.delete?.();
}

// 3. Write (helper :64-77) — Transfer_1 takes the HANDLE docH + 4 args
const w = new oc.STEPCAFControl_Writer_1();
w.SetColorMode(true);
w.SetNameMode(true);
const ok = w.Transfer_1(docH, oc.STEPControl_StepModelType.STEPControl_AsIs, null, new oc.Message_ProgressRange_1());
const tmp = `/_step_export_${Math.random().toString(36).slice(2,10)}.step`;
w.Write(tmp);
w.delete();

// --- FS readback idiom (helper :79-81 / BRepIO.ts:21) ---
const bytes = oc.FS.readFile(tmp);
oc.FS.unlink(tmp);
docH.delete?.();
return bytes.slice(); // copy out of MEMFS view
```

**`trsfFromPose`** = inline `transformShapeByPose`'s quaternion→3×3 + `gp_Trsf_1().SetValues(r00,r01,r02,tx, r10,r11,r12,ty, r20,r21,r22,tz)` (TransformOps.ts:49-67) but **return the `trsf`, do NOT call `BRepBuilderAPI_Transform`** — that baked location is the §6 color-loss trap. For a single part, pose=identity → identity `gp_Trsf` (or pass `new oc.TopLoc_Location_2(identityTrsf)`).

> **Color-loss guard (§6 / §10):** Phase 4's round-trip MUST build a **posed 2-component, 2-DIFFERENT-color** assembly and assert `readStep(bytes).solidColors` contains **both** distinct colors (the bug's signature is "only the first survives"), AND each solid's posed bbox `toBeCloseTo` input. `solidCount === 2` asserted FIRST (cold-cache empty export → RED).

### Cold-cache re-execute snippet (each export method, §D)
```ts
async function warmShape(partId: string): Promise<import('./occt/FaceNaming').NamedShape> {
  let ns = namedShapeCache.get(partId);
  if (!ns) {
    const p = parts.get(partId);
    if (!p) throw new Error(`export: leaf part ${partId} not loaded`);
    const r = await executeTree(occt!, p, lookupImportedShape);
    if (!r.ok) throw new Error(`export: execute failed for ${partId}: ${r.error.message}`);
    updateNamedShapeCache(partId, r.value.namedShape, r.value.workFeatures ?? []);
    ns = r.value.namedShape;
  }
  return ns;
}
```
Pattern lifted verbatim from `extractAssemblyRef` (**api.ts:519-528**) / `mirrorPart` (**api.ts:468-474**). `ns.shape` is the `OcctShape`; `ns.shape.handle` is the `TopoDS_Shape` (NamedShape type: `FaceNaming.ts:5-10`).

---

## D. Cold-cache fallback signature

```ts
warmShape(partId: string): Promise<NamedShape>   // throws if parts.get(partId) is undefined
```
- Input: `partId` (a registered kernel id in `parts`, `api.ts:193`).
- Reads `namedShapeCache.get(partId)` (api.ts:203); on miss, `parts.get(partId)` → `executeTree(occt, p, lookupImportedShape)` → `updateNamedShapeCache(partId, …)` (api.ts:219-224).
- **Every** export method calls `warmShape` per `partId` BEFORE touching the writer/tessellator. The §10 guards assert `solidCount > 0` / `triCount > 0` so a cold-cache empty export turns RED.
- **STL path** additionally needs the bbox for `adaptiveLinearDeflection`: `ns.shape` → `computeBoundingBox(occt, ns.shape)` (SolidOps.ts:50) → `tessellate(occt, ns.shape, { linearDeflection: adaptiveLinearDeflection(bbox), angularDeflection: 0.5 })` (Tessellator.ts:14,47).

---

## E. App-side assembly resolution pipeline (Phase 5a — `resolveExportLeaves.ts`)

Reproduces the renderer (`App.tsx:3836-3925` + the self-warm BFS `App.tsx:3182-3203`) OUTSIDE React. **Exact calls + signatures:**

```ts
import { visibleLeaves, type VisibleLeaf } from './walkers/visibleLeaves';        // visibleLeaves.ts:12
import { composedPoses } from './walkers/composedPoses';                          // composedPoses.ts:28
import { flattenForSolver } from './walkers/flattenForSolver';                    // flattenForSolver.ts:51
import { computeInnerStaticPoses } from './computeInnerStaticPoses';              // :16
import { resolvePartInfo, type PartInfoCache } from '../shell/resolvePartInfo';   // :7
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { pathKey } from '@zilventor/shared';
import type { ComponentColor, AssemblyDocument } from '@zilventor/shared';
import type { ExportLeaf } from '@zilventor/kernel/src/api';

/** ComponentColor union → 0–1 RGB (mirrors App.tsx:3915-3919 + hex parse). undefined = unmaterialized. */
export function effectiveColorToRgb(
  color: ComponentColor | undefined,
  colors: Record<string, string>,
): readonly [number, number, number] | undefined {
  let hex: string | undefined;
  if (!color) return undefined;
  if (color.kind === 'hex') hex = color.hex;
  else if (color.kind === 'palette') hex = colors[color.name]; // App.tsx:3917-3918; missing entry → undefined
  if (!hex) return undefined;
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0,2),16)/255, parseInt(h.slice(2,4),16)/255, parseInt(h.slice(4,6),16)/255];
}

export async function resolveExportLeaves(args: {
  assembly: AssemblyDocument;
  kernel: { loadFromBytes(b: Uint8Array): Promise<string> };
  opfs: { read(p: string): Promise<Uint8Array>; exists(p: string): Promise<boolean> };
  componentPoses: Map<string, Pose>;                 // store.componentPoses (useAppStore :401)
  partInfoCache: PartInfoCache;                       // reuse / fresh Map
}): Promise<ExportLeaf[]>
```

**Body, in order (each step has a real anchor):**
1. **Self-warm sub-asm DOC cache** — BFS verbatim from `App.tsx:3183-3203`: stack-walk `.ziasm` children, `await opfs.exists` + `unpackAssembly(await opfs.read(c.partPath))` into a local `subAsmDocs: Record<string,AssemblyDocument>`. Then `innerPoses[pp] = computeInnerStaticPoses(d)` per loaded doc (App.tsx:2707-2708).
2. Build the **adapter** (App.tsx:3838-3842 shape): `const cache = { get: (p) => subAsmDocs[p] ? { kind:'ok', doc: subAsmDocs[p], partPath:p, ...(innerPoses[p] ? { innerStaticPoses: innerPoses[p] } : {}) } : undefined }`.
3. `const leaves = visibleLeaves(assembly, cache)` (App.tsx:3843). **Any `leaf.kind === 'placeholder'` → throw** `export: unresolved sub-assembly leaf ${leaf.partPath}` (§17 hard error — never silently drop).
4. **World poses** (App.tsx:3854-3863): `let composedMap = componentPoses; if (!leaves.every(l => composedMap.has(pathKey(l.componentPath)))) { const flat = flattenForSolver(assembly, cache); composedMap = composedPoses(assembly, cache, { pathToUnknown: flat.pathToUnknown, poses: flat.unknowns, rigidSubtreeRoots: flat.rigidSubtreeRoots }); }`.
5. **partPath → partId warm map** (App.tsx:3866-3873): `for (const pp of new Set(leaves.map(l=>l.partPath))) { partIdByPath.set(pp, await kernel.loadFromBytes(await opfs.read(pp))); }` — the part doc's stable persisted UUID (same id every load). **This is the only bridge; the assembly model carries no kernel partId.** (`loadFromBytes` warms `parts` only, NOT `namedShapeCache` — kernel `warmShape` re-executes, §D.)
6. **name** per partPath via `await resolvePartInfo(opfs, pp, partInfoCache)` → `.name` (resolvePartInfo.ts:7,17); fall back to `pp.split('/').pop()`.
7. Build `ExportLeaf[]`: `{ partId: partIdByPath.get(l.partPath)!, name, pose: composedMap.get(pathKey(l.componentPath)) ?? IDENTITY, color: effectiveColorToRgb(l.effectiveColor, assembly.colors) }`. De-dup naming: prototype named once per `partId` (kernel side), component named per instance — kernel handles this via `protoKey === partId` (§C).

**5a unit test (`resolveExportLeaves.spec.ts`):** 2-instance assembly resolves 2 leaves with distinct world poses + correct rgb + names; a placeholder leaf throws; `effectiveColorToRgb` table: hex→rgb, palette-hit→rgb, palette-miss→undefined, undefined→undefined. Mock `kernel.loadFromBytes` (returns a stable id per bytes) + `opfs` + `resolvePartInfo` fixtures.

---

## F. Round-trip helpers for tests

- **STEP re-import:** SHIPPED `readStep(oc, stepBytes: ArrayBuffer): StepReadResult` (`StepIO.ts:29`). Returns `{ shape, faceCount, solidCount, boundingBox: BoundingBox, solidColors: (string|null)[] }`. `solidColors` are lowercase `#rrggbb` index-aligned to `TopExp_Explorer_2(SOLID)`. `boundingBox` is `readonly [minX,minY,minZ,maxX,maxY,maxZ]` (`types.ts:19`). **Color round-trips via sRGB** (`quantityColorToHex`, StepIO.ts:216 — raw values, no linearization).
- **Binary-STL parser: DOES NOT EXIST in the repo** (grep clean). The plan **MUST add a tiny test-only parser** `occt/__tests__/binaryStlParser.ts`:
  ```ts
  export function parseBinaryStl(bytes: Uint8Array): { triCount: number; bbox: [number,number,number,number,number,number] } {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const triCount = dv.getUint32(80, true);                       // after 80-byte header
    let off = 84; const b = [Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
    for (let t = 0; t < triCount; t++) {
      off += 12;                                                    // skip normal 3×f32
      for (let v = 0; v < 3; v++) {
        const x = dv.getFloat32(off, true), y = dv.getFloat32(off+4, true), z = dv.getFloat32(off+8, true);
        b[0]=Math.min(b[0],x); b[1]=Math.min(b[1],y); b[2]=Math.min(b[2],z);
        b[3]=Math.max(b[3],x); b[4]=Math.max(b[4],y); b[5]=Math.max(b[5],z);
        off += 12;
      }
      off += 2;                                                     // uint16 attr
    }
    return { triCount, bbox: b as [number,number,number,number,number,number] };
  }
  ```
- **Real-part fixtures (no `buildPanelBox` standalone export):** integration tests build real solids via `createKernelApi()`+`init()`+`createPart`/`setParameter`/`addFeature(sketch+extrude)`/`execute` — harness verbatim from `__tests__/api.integration.spec.ts:8-23` (a 100×200×50 box). For the 10mm-box mm-proof, use a 10×10×10 extrude → assert `parseBinaryStl(bytes).bbox` span / `readStep(bytes).boundingBox[3]-[0]` **`toBeCloseTo(10, 3)`** — NOT `>` (the `stepColor.integration.spec.ts:25` `>25` anti-pattern). For posed multi-component STEP, register 2 parts, hand `exportStepAssembly` 2 `ExportLeaf` at distinct poses + 2 colors.

---

## G. triggerDownload + FileTab + parity wiring

**Command (`ExportStepCommand.ts`, mirror `ExportDrawingDxfCommand.ts:5-30`):**
```ts
export class ExportStepCommand {
  readonly name = 'ExportStep';
  constructor(private readonly opts: {
    kernel: { exportStepPart(id:string):Promise<Uint8Array>; exportStepAssembly(l:readonly ExportLeaf[],o?:{name?:string}):Promise<Uint8Array> };
    activeDocument: { kind:'part'|'assembly'|'drawing'; document:{ name:string } };
    activePart: { id:string } | null;
    opfs; componentPoses; partInfoCache;            // for the assembly branch (§E)
  }) {}
  async apply(): Promise<void> {
    const { activeDocument, activePart } = this.opts;
    let bytes: Uint8Array;
    if (activeDocument.kind === 'part' && activePart) bytes = await this.opts.kernel.exportStepPart(activePart.id);
    else { // assembly
      const leaves = await resolveExportLeaves({ assembly: activeDocument.document as AssemblyDocument, kernel: this.opts.kernel, opfs: this.opts.opfs, componentPoses: this.opts.componentPoses, partInfoCache: this.opts.partInfoCache });
      bytes = await this.opts.kernel.exportStepAssembly(leaves, { name: activeDocument.document.name });
    }
    await triggerDownload(new Blob([bytes as BlobPart], { type: 'application/step' }), {
      suggestedName: `${activeDocument.document.name}.step`, mimeType: 'application/step', extension: 'step', description: 'STEP file',
    });
  }
  async revert(): Promise<void> { /* non-undoable */ }
}
```
`ExportStlCommand` is identical with `exportStlPart`/`exportStlAssembly`, `.stl`, `model/stl`, `extension:'stl'`. `triggerDownload` signature: `(blob, { suggestedName, mimeType, extension, description })` (`triggerDownload.ts:8`; handles `showSaveFilePicker` + a-tag fallback + AbortError swallow).

**FileTab handlers** (near **FileTab.tsx:25-39**), modeled on `handleExportImage`: pull `{ kernel, activeDocument, activePart, opfs, componentPoses }` from `useAppStore.getState()`; `await bus.execute(new ExportStepCommand({…}))` (or call `.apply()` directly like `handleExportImage` does — non-undoable, no bus needed); `try/catch` swallowing `AbortError`, else `setErrorDialog`.

**Two buttons** after the Export-Image button (**FileTab.tsx:272-278**), same className, **`disabled={!activeDoc || activeDoc.kind === 'drawing'}`** (mirror :274), labels `{t('menu.file.exportStep')}` / `{t('menu.file.exportStl')}`.

**i18n** — add to BOTH `en.json` + `uk.json` `menu.file` block (en at **:594-601**), alphabetical-insert is fine (parity test sorts keys):
```json
"exportStep": "Export STEP",   // uk: "Експорт STEP"
"exportStl": "Export STL",     // uk: "Експорт STL"
```
`parity.test.ts:16-22` goes RED if a key is missing in either locale; `:24-30` RED if a uk value is empty. (`menu.file.exportImage` already exists at `:594`.)

---

### Self-critique
**Weaknesses:** (1) `shapeTool.NewShape()` as the root assembly label is the standard XCAF idiom but I did NOT find it exercised in-repo (the helper writes flat shapes, no assembly root) — Phase 4 must confirm it against the live `.d.ts`; if `AddComponent_1` needs a label already registered via `AddShape(emptyCompound,true,…)`, adjust. (2) STL REVERSED-winding flip (§7) needs a per-face orientation read that `tessellate` doesn't expose — StlExport may need a bespoke face-walk (Tessellator.ts:74 lacks `face.Orientation()`); flagged as best-effort per spec. (3) `Quantity_TOC_sRGB` divergence is load-bearing and confirmed, but I assumed the writer should match the reader's sRGB-as-is path — if STEP consumers expect linear, colors shift (round-trip test catches it).
**Assumptions:** kernel `ExportLeaf`/`ExportPose` types exported from `api.ts` are app-importable (cross-package type import is used elsewhere, e.g. `@zilventor/kernel/src/...`); `componentPoses` is populated at FileTab-export time (else step-4 recompute fires — covered).
**Confidence: 86** — every file:line, the cold-cache pattern, the proven XCAF write API, the resolution pipeline, and the missing-STL-parser fact are verified against real code; the two unverified spots (`NewShape` root, REVERSED-flip mechanics) are Phase-3/4 confirmations the round-trip guards will catch, not contract-breakers.

---

The in-repo idiom uses `typedFace.Orientation_1() === 1` (integer 1 = REVERSED), avoiding the enum-object comparison entirely. This is the proven approach. The triangulation `Node(i)` returns `gp_Pnt` with face-local coords; for posed assemblies I must also apply each face's `TopLoc_Location` transformation AND the leaf world pose. 

I now have all facts verified against real code:
- `loadOcct()` → `oc` for integration tests; `makeBox(oc, dx, dy, dz)` builds solids directly (pure-OCCT, no api needed for Phase 1+2 unit tests of `exportStlBinary`).
- `BRepMesh_IncrementalMesh_2` + `Perform_1` + `TopExp_Explorer_2(FACE)` + `BRep_Tool.Triangulation(face, loc, 0)` + `triHandle.get().Node(i)`/`Triangle(i).Value(j)` — exact idiom from Tessellator.ts.
- Winding flip: `oc.TopoDS.Face_1(faceShape).Orientation_1() === 1` → swap v2/v3.
- Face-local node transform via `loc.Transformation()` then `p.Transform(t)` (Tessellator.ts:256-261 idiom).
- `transformShapeByPose` quaternion→3×3 math (TransformOps.ts:49-67) for the per-vertex pose transform.
- `adaptiveLinearDeflection(bbox)` + `computeBoundingBox(oc, shape)`.
- Round-trip parser: `binaryStlParser.ts` (new test-only, per contract F).
- Integration config: `vitest.integration.config.ts` includes `src/occt/**/__tests__/**/*.spec.ts`.

Now I'll author the plan chunk.

---

---

## Binding corrections (read first — locked after a plan-fix + re-verify round)

# 3D STEP/STL export — PLAN CORRECTION ADDENDUM (binding)

> **OVERRIDES the plan + Contract where they conflict.** Fixes the blockers a 3-verifier round found
> in plan v1. Every fix-agent MUST make its chunk obey these. The theme is cross-chunk integration
> drift (the STL api-wiring fell between chunks; `resolveExportLeaves`'s signature diverged between
> the resolver and the commands).

## 1. Wire ALL FOUR kernel methods — STL methods are currently never added to `KernelApi` (BLOCKER)

The kernel chunks build the pure `exportStlBinary` / `exportStepDoc`, but only the STEP methods get
added to the `KernelApi` type + returned object; **`exportStlPart` / `exportStlAssembly` are never
wired**, yet Phase 5b commands and the Phase 6 test call them → runtime "method undefined" / RED that
never goes GREEN. **The kernel api-wiring task (in the STEP chunk, Phases 3&4 Task 2) MUST add all
FOUR methods** (`exportStepPart`, `exportStlPart`, `exportStepAssembly`, `exportStlAssembly`) to both
the `KernelApi` type AND the returned object. Each calls `warmShapeForExport(partId)` (the cold-cache
re-execute helper) then `exportStepDoc(...)` / `exportStlBinary(...)`. The STL methods honor
`opts.binary` (only `true`/absent supported; ASCII is a non-goal). Place this wiring task BEFORE
Phase 5b/Phase 6 so their guards can go green.

## 2. `resolveExportLeaves` — ONE signature; the command builds + injects the sub-asm cache (BLOCKER)

Plan v1: Phase 5a's `resolveExportLeaves` requires `{ ..., subAsmCache, resolvePartInfo }`, but the
Phase 5b commands call it WITHOUT `subAsmCache`/`resolvePartInfo` → tsc error, AND no sub-assembly
self-warm happens → every nested `.ziasm` (real cabinets) yields placeholder leaves and the resolver
throws "unresolved sub-assembly leaf". Fix (pin in BOTH 5a and 5b):
- **5a** keeps `resolveExportLeaves` PURE with the full required arg set, including `subAsmCache`
  (carrying `innerStaticPoses`) and `resolvePartInfo`. Document the exact arg list at the top.
- **5b** (the `ExportStepCommand`/`ExportStlCommand` apply, or the FileTab handler) MUST, for an
  assembly target, build the sub-assembly cache adapter from the store BEFORE calling the resolver,
  reproducing the renderer's BFS + adapter **verbatim** (read `App.tsx:3179-3210` for the BFS that
  populates `subAssemblyDocs`/`subAssemblyInnerPoses`, and `App.tsx:3837-3841` for the adapter shape):
  ```ts
  const { subAssemblyDocs, subAssemblyInnerPoses } = useAppStore.getState();
  const subAsmCache = {
    get: (p: string) => subAssemblyDocs[p]
      ? { kind: 'ok' as const, doc: subAssemblyDocs[p], partPath: p,
          ...(subAssemblyInnerPoses[p] ? { innerStaticPoses: subAssemblyInnerPoses[p] } : {}) }
      : undefined,
  };
  ```
  If `subAssemblyDocs` is not yet warm (export fired before the App effect ran), the command must run
  the BFS itself (mirror `App.tsx:3182-3208`: `opfs.exists` + `unpackAssembly` into a local doc map +
  `computeInnerStaticPoses` per doc) and build the adapter from that. Pass `subAsmCache` +
  `resolvePartInfo` (from `../shell/resolvePartInfo`) into `resolveExportLeaves`. **`innerStaticPoses`
  on each cache entry is required** — without it, rigid sub-assembly leaves fall back to
  `IDENTITY_POSE` (wrong placement). Add a 5b/integration case with a real nested `.ziasm` that
  asserts leaves are NOT dropped and ARE posed.

## 3. No duplicate `api.export.integration.spec.ts` path (BLOCKER)

Plan v1: BOTH the STEP-kernel chunk (Phases 3&4) AND the e2e task (Phase 6) `Create` the SAME file
`packages/kernel/src/__tests__/api.export.integration.spec.ts` → overwrite or redeclaration error.
Fix: the STEP-kernel chunk owns `api.export.integration.spec.ts` (cold-cache + STEP color-loss
guards). The Phase-6 e2e task uses a **distinct** file
`packages/kernel/src/__tests__/api.export.e2e.integration.spec.ts` (the part+assembly STEP/STL
round-trip + ISO-header + names + STL triCount), with its own `makeBoxPart` OR importing a shared
helper — reconcile so there is exactly ONE `makeBoxPart` definition per file (no redeclaration).

## 4. OCCT API precision (MAJOR/minor)

- **`TCollection_ExtendedString_2` needs TWO args** (`astring: Standard_CString, isMultiByte: Standard_Boolean`).
  Plan v1 calls it with one arg and an `oc as {...}` cast HIDES the arity error from tsc → runtime
  throw. Fix: doc format string → use the no-arg `TCollection_ExtendedString_1()` (verbatim from
  `stepColor.helper.ts:15`); name labels → `new oc.TCollection_ExtendedString_2(name, true)`
  (isMultiByte) — and REMOVE the arity-hiding `oc as` cast so tsc validates it. Confirm against the
  real `.d.ts` in the Phase-3 API-pin step (extend that step's binding grep to include
  `TCollection_ExtendedString`/`TDataStd_Name`).
- **Color type = `Quantity_TOC_sRGB`, NOT `Quantity_TOC_RGB`** (the proven helper `:47` + the reader
  `StepIO.ts:213-215` round-trip on sRGB). The Contract already flags this — every chunk's
  `new oc.Quantity_Color_3(r,g,b, oc.Quantity_TypeOfColor.Quantity_TOC_sRGB)` must use sRGB.
- **OCCT loader import = `loadOcct` (`occtLoader.ts:18`), NOT `getOcct`.** The Phase-6 test must
  `import { loadOcct } from '../occt/occtLoader'` and `await loadOcct()` — drop the `getOcct` guess.

## 5. STL minors

- **REVERSED-winding flip needs a test** (plan v1 only checks triCount + bbox, which are
  winding-agnostic): add one cheap outward-normal assertion on a convex box (each emitted facet's
  winding-normal points away from the box centroid), OR explicitly scope normals best-effort per spec
  §7 and note the deferral. Pick one and state it.
- **Don't assert `triCount === 12`** for a box (`Tessellator.spec.ts:37` only asserts `>= 36` indices
  → OCCT may split faces). Assert `triCount % 2 === 0 && triCount >= 12` and keep the bbox span strict
  (`toBeCloseTo`, the real unit proof).

## 6. Contract §E stale paths (minor)
The walkers live at `packages/app/src/assembly/walkers/...` and `Pose` comes from `flattenForSolver.ts`
(not `@zilventor/shared`). The Phase-5a chunk already corrected this; just don't let any chunk copy the
stale §E import block.

---

## Phases 1 & 2 — STL part + STL assembly (kernel)

> **Base:** master `3ecc2ff` (working tree on `master`). No manifest bump. Pure-OCCT module — `exportStlBinary(oc, leaves)` takes the raw `oc` and pre-resolved shape leaves; it touches **no** `parts`/`namedShapeCache` (the api.ts cold-cache wiring is Phase 5/§D, a later chunk). Phase 1 & 2 build real solids directly via `loadOcct()` + `makeBox` (verified harness: `SolidOps.revolve.integration.spec.ts:1-9`).
>
> **Runner (all tasks below):** from `packages/kernel` →
> `npx vitest run --config vitest.integration.config.ts src/occt/__tests__/<file>`
> The integration config (`vitest.integration.config.ts:5`) globs `src/occt/**/__tests__/**/*.spec.ts`, so `StlExport.integration.spec.ts` is picked up. Re-`cd` to `/Users/lion/Documents/Projects/mine/zilventor/packages/kernel` at the start of every Bash op (cwd persists across calls but be explicit).
>
> **Verified bindings (do not re-derive):** tessellation idiom = `Tessellator.ts:54-110`; bbox = `computeBoundingBox(oc, shape)` (`SolidOps.ts:50`); adaptive deflection = `adaptiveLinearDeflection(bbox)` (`Tessellator.ts:14`); face-local node transform = `loc.Transformation()` + `p.Transform(t)` (`Tessellator.ts:256-261`); **winding-flip read = `typedFace.Orientation_1() === 1`** (integer 1 = `TopAbs_REVERSED`, the in-repo idiom at `WorkFeatureOps.ts:357` — NOT the enum object); pose→matrix math = `transformShapeByPose` (`TransformOps.ts:49-67`); `OcctShape` = `{ __brand, handle }` (`SolidOps.ts:17`); `makeBox(oc,dx,dy,dz)` (`SolidOps.ts:24`).
>
> **Normals:** SPEC §7 marks outward normals as "best-effort" (consumers may recompute from winding). This chunk tests the winding flip explicitly via a cheap outward-normal assertion on a convex box centroid — see Task 2 Step 1 for details.
>
> **triCount relaxation:** existing `Tessellator.spec.ts:37` asserts `indices.length >= 36` (≥12 triangles) — OCCT is free to split planar faces. All OCCT-driven triCount assertions therefore use `triCount % 2 === 0 && triCount >= N` rather than strict `toBe(N)`. The bbox span (`toBeCloseTo`) remains the real unit proof.
>
> **API-wiring note (addendum §1):** `exportStlPart` / `exportStlAssembly` on `KernelApi` are **NOT added here**. They belong to the kernel-STEP chunk (Phases 3&4 Task 2). This chunk only exposes the pure `exportStlBinary(oc, leaves)` signature; the wiring chunk calls that with a `warmShapeForExport(partId)` result.

---

### Task 1 — test-only binary-STL parser (test fixture, no production code)

**Files:**
- **Create (test):** `packages/kernel/src/occt/__tests__/binaryStlParser.ts`
- **Create (test):** `packages/kernel/src/occt/__tests__/binaryStlParser.spec.ts`

This parser is the round-trip oracle for Tasks 2 & 3. Grep confirmed **no binary-STL parser exists in the repo** (contract §F), so we add one. We TDD the parser itself against a hand-built 1-triangle buffer so the oracle is trusted before it judges real exports.

The parser returns `{ triCount, bbox, facetVertices }` where `facetVertices` is an array of per-triangle vertex triples — needed by the outward-normal winding assertion in Task 2.

- [ ] **Step 1: Write the failing parser spec.** Create `packages/kernel/src/occt/__tests__/binaryStlParser.spec.ts` with COMPLETE content:

```ts
import { describe, it, expect } from 'vitest';
import { parseBinaryStl } from './binaryStlParser';

/** Hand-build a binary STL with `tris` triangles (each vertex list is [v0,v1,v2], each v = [x,y,z]). */
function buildBinaryStl(tris: Array<[[number, number, number], [number, number, number], [number, number, number]]>): Uint8Array {
  const bytes = new Uint8Array(84 + tris.length * 50);
  const dv = new DataView(bytes.buffer);
  // 80-byte header left as zeros, then triangle count at offset 80.
  dv.setUint32(80, tris.length, true);
  let off = 84;
  for (const [v0, v1, v2] of tris) {
    // normal (3 × f32) left zero
    off += 12;
    for (const v of [v0, v1, v2]) {
      dv.setFloat32(off, v[0], true);
      dv.setFloat32(off + 4, v[1], true);
      dv.setFloat32(off + 8, v[2], true);
      off += 12;
    }
    off += 2; // uint16 attribute byte count
  }
  return bytes;
}

describe('parseBinaryStl', () => {
  it('reads triangle count and accumulates a bbox over all vertices', () => {
    const bytes = buildBinaryStl([
      [[0, 0, 0], [10, 0, 0], [0, 5, 0]],
      [[2, 2, 2], [-3, 4, 1], [1, 1, 7]],
    ]);
    const { triCount, bbox } = parseBinaryStl(bytes);
    expect(triCount).toBe(2);
    // bbox = [minX,minY,minZ,maxX,maxY,maxZ]
    expect(bbox[0]).toBeCloseTo(-3, 5);
    expect(bbox[1]).toBeCloseTo(0, 5);
    expect(bbox[2]).toBeCloseTo(0, 5);
    expect(bbox[3]).toBeCloseTo(10, 5);
    expect(bbox[4]).toBeCloseTo(5, 5);
    expect(bbox[5]).toBeCloseTo(7, 5);
  });

  it('handles a non-zero byteOffset Uint8Array view (slice of a larger buffer)', () => {
    const inner = buildBinaryStl([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]);
    const padded = new Uint8Array(inner.length + 16);
    padded.set(inner, 16);
    const view = padded.subarray(16); // byteOffset === 16, non-trivial
    const { triCount, bbox } = parseBinaryStl(view);
    expect(triCount).toBe(1);
    expect(bbox[3]).toBeCloseTo(1, 5);
    expect(bbox[4]).toBeCloseTo(1, 5);
  });

  it('returns facetVertices with per-triangle vertex triples', () => {
    const bytes = buildBinaryStl([
      [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
    ]);
    const { triCount, facetVertices } = parseBinaryStl(bytes);
    expect(triCount).toBe(1);
    expect(facetVertices).toHaveLength(1);
    const [[v0, v1, v2]] = facetVertices;
    expect(v0[0]).toBeCloseTo(1, 5);
    expect(v1[1]).toBeCloseTo(5, 5);
    expect(v2[2]).toBeCloseTo(9, 5);
  });
});
```

- [ ] **Step 2: Run — confirm RED.**
  `cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx vitest run --config vitest.integration.config.ts src/occt/__tests__/binaryStlParser.spec.ts`
  **Expected RED:** `Failed to resolve import "./binaryStlParser"` / "No test files found or module not found" — the parser module does not exist yet (fails for the expected reason: missing module, not an assertion typo).

- [ ] **Step 3: Create the parser (minimal).** Create `packages/kernel/src/occt/__tests__/binaryStlParser.ts` with COMPLETE content (verbatim from contract §F, with the documented `byteOffset`/`byteLength` DataView construction so subarray views parse correctly; extended to also return `facetVertices` for the outward-normal winding test in Task 2):

```ts
/**
 * Test-only binary-STL parser. Reads the 80-byte header + uint32 triangle
 * count, then walks each 50-byte triangle record (12-byte normal, 3×12-byte
 * vertices, 2-byte attribute) accumulating an axis-aligned bbox over every
 * vertex. Returns { triCount, bbox=[minX,minY,minZ,maxX,maxY,maxZ],
 * facetVertices } where facetVertices[i] = [v0,v1,v2] (each v = [x,y,z]).
 *
 * DataView is constructed over (buffer, byteOffset, byteLength) so a Uint8Array
 * that is a non-zero-offset view of a larger ArrayBuffer parses correctly.
 */
export type FacetTriangle = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

export function parseBinaryStl(
  bytes: Uint8Array,
): {
  triCount: number;
  bbox: [number, number, number, number, number, number];
  facetVertices: FacetTriangle[];
} {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triCount = dv.getUint32(80, true); // little-endian, after the 80-byte header
  let off = 84;
  const b: [number, number, number, number, number, number] = [
    Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity,
  ];
  const facetVertices: FacetTriangle[] = [];
  for (let t = 0; t < triCount; t++) {
    off += 12; // skip the per-facet normal (3 × float32)
    const verts: Array<[number, number, number]> = [];
    for (let v = 0; v < 3; v++) {
      const x = dv.getFloat32(off, true);
      const y = dv.getFloat32(off + 4, true);
      const z = dv.getFloat32(off + 8, true);
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (z < b[2]) b[2] = z;
      if (x > b[3]) b[3] = x;
      if (y > b[4]) b[4] = y;
      if (z > b[5]) b[5] = z;
      verts.push([x, y, z]);
      off += 12;
    }
    facetVertices.push(verts as FacetTriangle);
    off += 2; // uint16 attribute byte count
  }
  return { triCount, bbox: b, facetVertices };
}
```

- [ ] **Step 4: Run — confirm GREEN.**
  `cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx vitest run --config vitest.integration.config.ts src/occt/__tests__/binaryStlParser.spec.ts`
  **Expected GREEN:** `3 passed` (bbox case, byteOffset case, facetVertices case).

- [ ] **Step 5: tsc gate (add no NEW baseline errors).**
  `cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx tsc --noEmit 2>&1 | grep -c "error TS"`
  **Expected:** count unchanged from the ~16-file baseline (no new `binaryStlParser*` lines). Confirm with `... | grep binaryStlParser` → no output.

- [ ] **Step 6: Commit.**
  `cd /Users/lion/Documents/Projects/mine/zilventor && git add packages/kernel/src/occt/__tests__/binaryStlParser.ts packages/kernel/src/occt/__tests__/binaryStlParser.spec.ts && git commit -m "test(stl-export): add test-only binary-STL parser oracle (round-trip guard, facetVertices for winding check)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 2 — `exportStlBinary` Phase 1: single-shape part export (cold geometry → binary STL, winding flip)

**Files:**
- **Create (prod):** `packages/kernel/src/occt/StlExport.ts`
- **Create (test):** `packages/kernel/src/occt/__tests__/StlExport.integration.spec.ts`
- **Reference (read-only):** `Tessellator.ts:54-110`, `SolidOps.ts:24,50`, `WorkFeatureOps.ts:357`

`exportStlBinary(oc, leaves)` where each leaf is `{ shape: OcctShape; pose?: ExportPose }`. Phase 1 covers a **single leaf with no pose** (identity). It tessellates per the proven Tessellator idiom, **flips winding on `TopAbs_REVERSED` faces** (swap vertices 2↔3 so emitted facets are outward-CCW), applies each face's `TopLoc_Location`, and emits a binary STL (80-byte zero header + uint32 triCount + 50-byte facets, all little-endian, zero normals + zero attr).

**triCount note (addendum §5):** `Tessellator.spec.ts:37` asserts `indices.length >= 36` — OCCT may produce more than 12 tris for a box. All assertions use `triCount % 2 === 0 && triCount >= 12` instead of strict `toBe(12)`. The bbox span (`toBeCloseTo`) is the real unit proof.

**Winding-flip assertion (addendum §5):** A dedicated test case verifies that every emitted facet on a convex box has its winding-normal pointing away from the box centroid. This catches a transposed/inverted flip that bbox checks cannot detect.

- [ ] **Step 1: Write the failing Phase-1 spec.** Create `packages/kernel/src/occt/__tests__/StlExport.integration.spec.ts` with COMPLETE content:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox, type OcctShape } from '../SolidOps';
import { exportStlBinary } from '../StlExport';
import { parseBinaryStl, type FacetTriangle } from './binaryStlParser';

let oc: OcctInstance;
beforeAll(async () => {
  oc = await loadOcct();
}, 60_000);

/** Compute the winding normal of a CCW triangle (v0,v1,v2) via cross product. */
function windingNormal(
  v0: [number, number, number],
  v1: [number, number, number],
  v2: [number, number, number],
): [number, number, number] {
  const ax = v1[0] - v0[0], ay = v1[1] - v0[1], az = v1[2] - v0[2];
  const bx = v2[0] - v0[0], by = v2[1] - v0[1], bz = v2[2] - v0[2];
  return [
    ay * bz - az * by,
    az * bx - ax * bz,
    ax * by - ay * bx,
  ];
}

/** True if the winding normal points in the same general direction as (facet centroid - box centroid). */
function normalPointsOutward(
  tri: FacetTriangle,
  boxCentroid: [number, number, number],
): boolean {
  const [v0, v1, v2] = tri;
  const n = windingNormal(v0, v1, v2);
  // Facet centroid
  const fc = [
    (v0[0] + v1[0] + v2[0]) / 3,
    (v0[1] + v1[1] + v2[1]) / 3,
    (v0[2] + v1[2] + v2[2]) / 3,
  ];
  // Outward vector from box center to facet center
  const dx = fc[0] - boxCentroid[0];
  const dy = fc[1] - boxCentroid[1];
  const dz = fc[2] - boxCentroid[2];
  // Dot product: positive = outward
  return (n[0] * dx + n[1] * dy + n[2] * dz) > 0;
}

describe('exportStlBinary — Phase 1 (single part, identity pose)', () => {
  it('emits a non-empty binary STL whose bbox matches a 10mm box (mm units, toBeCloseTo)', () => {
    const box: OcctShape = makeBox(oc, 10, 10, 10);
    const bytes = exportStlBinary(oc, [{ shape: box }]);

    // Header(80) + count(4) + N*50 — at minimum the header is present.
    expect(bytes.byteLength).toBeGreaterThan(84);

    const { triCount, bbox } = parseBinaryStl(bytes);
    // OCCT may split faces; assert even count and at least 12 tris (2 per face × 6 faces).
    expect(triCount % 2).toBe(0);
    expect(triCount).toBeGreaterThanOrEqual(12);

    // mm proof: span along each axis is exactly 10mm (NOT '>9' — that is the anti-pattern).
    expect(bbox[3] - bbox[0]).toBeCloseTo(10, 3);
    expect(bbox[4] - bbox[1]).toBeCloseTo(10, 3);
    expect(bbox[5] - bbox[2]).toBeCloseTo(10, 3);
    // Box spans [0,10] on every axis.
    expect(bbox[0]).toBeCloseTo(0, 3);
    expect(bbox[3]).toBeCloseTo(10, 3);
  }, 120_000);

  it('every facet winding-normal on a convex box points away from the box centroid (outward-CCW winding)', () => {
    // This is the REVERSED-flip test. A transposed or inverted flip would invert
    // all or some normals — bbox is winding-agnostic so it cannot catch this.
    // Box [0,10]^3 has centroid at [5,5,5].
    const box: OcctShape = makeBox(oc, 10, 10, 10);
    const bytes = exportStlBinary(oc, [{ shape: box }]);
    const { triCount, facetVertices } = parseBinaryStl(bytes);

    expect(triCount).toBeGreaterThanOrEqual(12);
    const boxCentroid: [number, number, number] = [5, 5, 5];
    let inwardCount = 0;
    for (const tri of facetVertices) {
      if (!normalPointsOutward(tri, boxCentroid)) inwardCount++;
    }
    // ALL facets must be outward. Zero tolerance — a transposed flip would
    // produce 100% inward normals; a partial flip would produce N > 0.
    expect(inwardCount).toBe(0);
  }, 120_000);

  it('larger box scales the STL bbox span 1:1 (no unit drift)', () => {
    const box: OcctShape = makeBox(oc, 100, 200, 50);
    const bytes = exportStlBinary(oc, [{ shape: box }]);
    const { triCount, bbox } = parseBinaryStl(bytes);
    expect(triCount % 2).toBe(0);
    expect(triCount).toBeGreaterThanOrEqual(12);
    expect(bbox[3] - bbox[0]).toBeCloseTo(100, 3);
    expect(bbox[4] - bbox[1]).toBeCloseTo(200, 3);
    expect(bbox[5] - bbox[2]).toBeCloseTo(50, 3);
  }, 120_000);
});
```

- [ ] **Step 2: Run — confirm RED.**
  `cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx vitest run --config vitest.integration.config.ts src/occt/__tests__/StlExport.integration.spec.ts`
  **Expected RED:** `Failed to resolve import "../StlExport"` — module does not exist (expected reason: missing module).

- [ ] **Step 3: Create `StlExport.ts` (Phase-1 scope: tessellate + winding flip + face-loc transform + binary emit).** Create `packages/kernel/src/occt/StlExport.ts` with COMPLETE content:

```ts
import type { OcctInstance } from './occtLoader';
import { computeBoundingBox, type OcctShape } from './SolidOps';
import { adaptiveLinearDeflection } from './Tessellator';

/** World pose: structural match to ExportPose (api.ts) / composedPoses (app). */
export type ExportPose = {
  translation: { x: number; y: number; z: number };
  quaternion: readonly [number, number, number, number];
};

/** A leaf the STL emitter consumes: a resolved shape + an optional world pose. */
export type StlExportLeaf = {
  shape: OcctShape;
  pose?: ExportPose;
};

/** A single emitted triangle, vertices already in world space, CCW outward. */
type Triangle = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

const ANGULAR_DEFLECTION = 0.5;

/**
 * Quaternion [x,y,z,w] + translation → a function mapping a face-local point to
 * world space. Mirrors `transformShapeByPose`'s row-major 3×3 derivation
 * (TransformOps.ts:49-67) but applied per-vertex on the JS side rather than via
 * BRepBuilderAPI_Transform — so the prototype shape is never mutated/baked.
 */
function poseVertexTransformer(
  pose: ExportPose | undefined,
): (x: number, y: number, z: number) => [number, number, number] {
  if (!pose) return (x, y, z) => [x, y, z];
  const [qx, qy, qz, qw] = pose.quaternion;
  const { x: tx, y: ty, z: tz } = pose.translation;
  const r00 = 1 - 2 * (qy * qy + qz * qz);
  const r01 = 2 * (qx * qy - qw * qz);
  const r02 = 2 * (qx * qz + qw * qy);
  const r10 = 2 * (qx * qy + qw * qz);
  const r11 = 1 - 2 * (qx * qx + qz * qz);
  const r12 = 2 * (qy * qz - qw * qx);
  const r20 = 2 * (qx * qz - qw * qy);
  const r21 = 2 * (qy * qz + qw * qx);
  const r22 = 1 - 2 * (qx * qx + qy * qy);
  return (x, y, z) => [
    r00 * x + r01 * y + r02 * z + tx,
    r10 * x + r11 * y + r12 * z + ty,
    r20 * x + r21 * y + r22 * z + tz,
  ];
}

/**
 * Tessellate one shape and collect world-space triangles. Vertices are
 * transformed first by the face's own TopLoc_Location (Tessellator.ts:256-261
 * idiom) and then by the leaf world pose. Faces flagged TopAbs_REVERSED
 * (Orientation_1() === 1, the in-repo idiom at WorkFeatureOps.ts:357) get their
 * 2nd/3rd vertices swapped so every emitted facet winds CCW around its outward
 * normal.
 */
function collectTriangles(oc: OcctInstance, leaf: StlExportLeaf): Triangle[] {
  const tris: Triangle[] = [];
  const bbox = computeBoundingBox(oc, leaf.shape);
  const linearDeflection = adaptiveLinearDeflection(bbox);
  const toWorld = poseVertexTransformer(leaf.pose);

  const meshTool = new oc.BRepMesh_IncrementalMesh_2(
    leaf.shape.handle as never,
    linearDeflection,
    false as never,
    ANGULAR_DEFLECTION,
    false as never,
  );
  const progress = new oc.Message_ProgressRange_1();
  meshTool.Perform_1(progress);
  progress.delete();

  const explorer = new oc.TopExp_Explorer_2(
    leaf.shape.handle as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
  );

  while (explorer.More()) {
    const faceShape = explorer.Current();
    const face = oc.TopoDS.Face_1(faceShape);
    // 1 === TopAbs_REVERSED (WorkFeatureOps.ts:357).
    const reversed = (face as { Orientation_1: () => number }).Orientation_1() === 1;
    const loc = new oc.TopLoc_Location_1();
    const triHandle = oc.BRep_Tool.Triangulation(face, loc, 0 as never);

    if (!triHandle.IsNull()) {
      const t = triHandle.get();
      const transformation = (loc as { Transformation: () => unknown }).Transformation();
      const nbNodes = t.NbNodes();
      const nbTris = t.NbTriangles();

      // Read & transform every node once (face-local loc → then world pose).
      const nodes: Array<[number, number, number]> = new Array(nbNodes);
      for (let i = 1; i <= nbNodes; i++) {
        const p = t.Node(i);
        (p as { Transform: (tr: unknown) => void }).Transform(transformation as never);
        nodes[i - 1] = toWorld(p.X(), p.Y(), p.Z());
        p.delete();
      }
      for (let i = 1; i <= nbTris; i++) {
        const tri = t.Triangle(i);
        const a = nodes[tri.Value(1) - 1]!;
        const b = nodes[tri.Value(2) - 1]!;
        const c = nodes[tri.Value(3) - 1]!;
        // Reversed faces: swap v2/v3 so the facet winds CCW around the outward normal.
        tris.push(reversed ? [a, c, b] : [a, b, c]);
        tri.delete();
      }
    }

    triHandle.delete();
    loc.delete();
    face.delete();
    faceShape.delete();
    explorer.Next();
  }
  explorer.delete();
  meshTool.delete();
  return tris;
}

/** Serialize world-space triangles into a binary STL (little-endian). */
function emitBinaryStl(tris: Triangle[]): Uint8Array {
  const bytes = new Uint8Array(84 + tris.length * 50);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(80, tris.length, true); // 80-byte header stays zero
  let off = 84;
  for (const [v0, v1, v2] of tris) {
    off += 12; // normal left as zero (consumers recompute from winding)
    for (const v of [v0, v1, v2]) {
      dv.setFloat32(off, v[0], true);
      dv.setFloat32(off + 4, v[1], true);
      dv.setFloat32(off + 8, v[2], true);
      off += 12;
    }
    dv.setUint16(off, 0, true); // attribute byte count
    off += 2;
  }
  return bytes;
}

/**
 * Build a binary STL from one or more resolved leaves. Each leaf's shape is
 * tessellated and its triangles are transformed into world space by the leaf
 * pose (identity when absent) and concatenated. Pure-OCCT: no parts/cache.
 *
 * API-wiring note: `exportStlPart` / `exportStlAssembly` on `KernelApi` are NOT
 * here — they belong to the api-wiring chunk (Phases 3&4 Task 2) which calls
 * `warmShapeForExport(partId)` then delegates to this function.
 */
// `_opts` accepted for call-site symmetry with the api-wiring chunk; output is ALWAYS binary
// this slice (ASCII STL is a non-goal §12), so the flag is ignored.
export function exportStlBinary(oc: OcctInstance, leaves: readonly StlExportLeaf[], _opts?: { binary?: boolean }): Uint8Array {
  const all: Triangle[] = [];
  for (const leaf of leaves) {
    for (const tri of collectTriangles(oc, leaf)) all.push(tri);
  }
  return emitBinaryStl(all);
}
```

- [ ] **Step 4: Run — confirm GREEN.**
  `cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx vitest run --config vitest.integration.config.ts src/occt/__tests__/StlExport.integration.spec.ts`
  **Expected GREEN:** `3 passed` (10mm box bbox proof, outward-normal winding proof, 100×200×50 unit-drift proof).
  *The outward-normal test is the discriminating guard: if the REVERSED flip is absent or inverted, `inwardCount > 0` and this test is RED. If bbox passes but winding is wrong, the flip is broken. Both must be GREEN together.*

- [ ] **Step 5: tsc gate.**
  `cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx tsc --noEmit 2>&1 | grep -E "StlExport" || echo "no new StlExport tsc errors"`
  **Expected:** `no new StlExport tsc errors`. (The `as never` casts mirror the existing Tessellator/TransformOps style; `Orientation_1`/`Transform` are accessed via inline typed casts to avoid `.d.ts` member-name drift.)

- [ ] **Step 6: Commit.**
  `cd /Users/lion/Documents/Projects/mine/zilventor && git add packages/kernel/src/occt/StlExport.ts packages/kernel/src/occt/__tests__/StlExport.integration.spec.ts && git commit -m "feat(stl-export): exportStlBinary single-part binary STL (winding flip + outward-normal assertion, mm-proof round-trip)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 3 — `exportStlBinary` Phase 2: posed multi-leaf assembly (per-leaf world-pose transform + concat)

**Files:**
- **Modify (prod):** `packages/kernel/src/occt/StlExport.ts` — none required if Phase 1 already iterates leaves + applies `leaf.pose` (it does). This task **proves** the assembly path and adds a posed-bbox round-trip; if Phase 1's pose math is correct the only change is the new test. (Strict TDD: write the failing test FIRST against the unproven posed path.)
- **Create (test):** add a `describe('exportStlBinary — Phase 2 …')` block to `packages/kernel/src/occt/__tests__/StlExport.integration.spec.ts`
- **Reference (read-only):** `TransformOps.ts:49-67` (pose math identity), `SolidOps.ts:24`

The Phase-1 `exportStlBinary` already loops leaves and applies `leaf.pose` per-vertex via `poseVertexTransformer`. Phase 2 locks that this is **correct under a real translation + rotation**: two 10mm boxes at distinct world poses must produce a single STL whose combined bbox spans both posed components.

- [ ] **Step 1: Append the failing Phase-2 spec block.** Add to the END of `packages/kernel/src/occt/__tests__/StlExport.integration.spec.ts` (after the Phase-1 `describe`):

```ts
describe('exportStlBinary — Phase 2 (posed multi-leaf assembly)', () => {
  const IDENTITY_Q = [0, 0, 0, 1] as const;

  it('translates each leaf by its world pose and concatenates — combined bbox spans both', () => {
    const a = makeBox(oc, 10, 10, 10); // spans [0,10]^3 at origin
    const b = makeBox(oc, 10, 10, 10); // same prototype, posed to [50..60] on X

    const bytes = exportStlBinary(oc, [
      { shape: a, pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: IDENTITY_Q } },
      { shape: b, pose: { translation: { x: 50, y: 0, z: 0 }, quaternion: IDENTITY_Q } },
    ]);

    const { triCount, bbox } = parseBinaryStl(bytes);
    // 2 boxes: OCCT may split faces, assert even and >= 24 (≥12 per box).
    expect(triCount % 2).toBe(0);
    expect(triCount).toBeGreaterThanOrEqual(24);
    // Combined X span = from box A's min (0) to box B's max (50+10=60).
    expect(bbox[0]).toBeCloseTo(0, 3);
    expect(bbox[3]).toBeCloseTo(60, 3);
    // Y/Z unchanged: still [0,10].
    expect(bbox[1]).toBeCloseTo(0, 3);
    expect(bbox[4]).toBeCloseTo(10, 3);
    expect(bbox[2]).toBeCloseTo(0, 3);
    expect(bbox[5]).toBeCloseTo(10, 3);
  }, 120_000);

  it('applies rotation: a 90° rotation about +Z maps a [0,20]×[0,10] footprint to [-10,0]×[0,20]', () => {
    // Box 20(X) × 10(Y) × 5(Z). Rotate +90° about Z: (x,y) -> (-y, x).
    // Footprint corners (0..20, 0..10) -> X in [-10,0], Y in [0,20].
    const box = makeBox(oc, 20, 10, 5);
    const halfAngle = (Math.PI / 2) / 2;
    const qz = Math.sin(halfAngle);
    const qw = Math.cos(halfAngle);
    const bytes = exportStlBinary(oc, [
      { shape: box, pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, qz, qw] } },
    ]);
    const { triCount, bbox } = parseBinaryStl(bytes);
    expect(triCount % 2).toBe(0);
    expect(triCount).toBeGreaterThanOrEqual(12);
    expect(bbox[0]).toBeCloseTo(-10, 3); // minX
    expect(bbox[3]).toBeCloseTo(0, 3);   // maxX
    expect(bbox[1]).toBeCloseTo(0, 3);   // minY
    expect(bbox[4]).toBeCloseTo(20, 3);  // maxY
    expect(bbox[5] - bbox[2]).toBeCloseTo(5, 3); // Z span untouched
  }, 120_000);
});
```

- [ ] **Step 2: Run — confirm RED-or-GREEN, and reason about which.**
  `cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx vitest run --config vitest.integration.config.ts src/occt/__tests__/StlExport.integration.spec.ts`
  **Expected:** the Phase-2 block is the **value-under-test for the pose math**. Two outcomes are acceptable, but you MUST confirm the *reason*:
  - If Phase 1's `poseVertexTransformer` is already correct, the translate case passes and **the rotation case is the discriminating RED→GREEN** — it would only fail if the quaternion→matrix transpose/sign were wrong (e.g. rotating to `[0,10]×[-20,0]` instead of `[-10,0]×[0,20]`). Confirm it passes for the right footprint, not a coincidence.
  - If it fails, the failure MUST be an **assertion mismatch on bbox extents** (wrong sign/axis), not an import error. Diagnose against the `transformShapeByPose` identity (`TransformOps.ts:52-60`): `(x,y)->(-y,x)` for +90°Z means `r01 = -1, r10 = +1` at this quaternion — verify your matrix yields that.

  *Rationale for keeping this task even though no prod change is expected:* the rotation case is a genuine red-without-the-correct-transform guard. A transposed matrix passes the translate-only test but fails here — that is the bug this task exists to catch (mirrors the memory's "hand-authored value = false green" lesson: the translate-only case can't distinguish R from Rᵀ).

- [ ] **Step 3: If RED — fix `poseVertexTransformer` to green (minimal).** Only if Step 2 was RED: the row-major derivation in `StlExport.ts` must match `TransformOps.ts:52-60` exactly (world = R·local + t, R applied as written). Correct the offending `r0x`/`r1x` term, re-run, confirm GREEN. If Step 2 was already GREEN, skip — note in the commit that Phase 1's pose math was proven by the rotation case.

- [ ] **Step 4: Run full StlExport spec — confirm ALL GREEN.**
  `cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx vitest run --config vitest.integration.config.ts src/occt/__tests__/StlExport.integration.spec.ts`
  **Expected GREEN:** `5 passed` (3 Phase-1 + 2 Phase-2).

- [ ] **Step 5: Regression — run the binary-STL parser spec + a touchstone neighbor to confirm no collateral.**
  `cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx vitest run --config vitest.integration.config.ts src/occt/__tests__/binaryStlParser.spec.ts src/occt/__tests__/Tessellator.spec.ts`
  **Expected GREEN:** parser `3 passed` + Tessellator suite unchanged (proves the new module didn't perturb the shared tessellation path).

- [ ] **Step 6: tsc gate.**
  `cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx tsc --noEmit 2>&1 | grep -cE "StlExport|binaryStlParser" || echo 0`
  **Expected:** `0` (no new tsc errors from this chunk's files).

- [ ] **Step 7: Commit.**
  `cd /Users/lion/Documents/Projects/mine/zilventor && git add packages/kernel/src/occt/__tests__/StlExport.integration.spec.ts packages/kernel/src/occt/StlExport.ts && git commit -m "feat(stl-export): posed multi-leaf STL assembly (per-vertex world pose, rotation-proven bbox round-trip)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

> **Hand-off to next chunk (Phase 5/§D — NOT in this chunk):** the api.ts methods `exportStlPart`/`exportStlAssembly` call `warmShape(partId)` (cold-cache re-execute, §D) to get `ns.shape`, then call `exportStlBinary(occt, [{ shape: ns.shape, pose }, …])`. The `KernelExportLeaf`→`StlExportLeaf` adapter (shape + pose) is trivial; the `opts.binary` flag is honored only as `true`/absent (ASCII is a §12 non-goal). The guards there assert `triCount > 0` so a cold-cache empty export turns RED — those guards belong to the api-wiring chunk, not here.

<!-- selfcritique: Applied all addendum §5 corrections: (1) triCount assertions relaxed from toBe(12/24) to `triCount % 2 === 0 && triCount >= N` matching Tessellator.spec.ts:37 precedent; (2) added explicit outward-normal winding test (new 3rd case in Phase 1) that computes cross-product per facet and asserts dot(normal, facet-centroid - box-centroid) > 0 — catches transposed flip that bbox cannot; (3) extended parseBinaryStl to return facetVertices (needed by winding test, tested in Task 1 Step 1 parser spec); (4) STL doesn't touch color so Quantity_TOC_sRGB is N/A; (5) api-wiring explicitly deferred to kernel-STEP chunk per addendum §1. Risks remaining: (a) winding-normal test assumes OCCT places the box at [0,10]^3 — centroid [5,5,5] is deterministic for makeBox; (b) degenerate near-zero-area facets might have zero cross product — if OCCT emits such facets the assertion could spuriously fail, but planar box faces don't produce them. Confidence: 93. -->

---

## Phases 3 & 4 — STEP part + STEP assembly (kernel, the XCAF core)

> **Pre-reqs from earlier chunks (assumed present at task start):** `occt/StepExport.ts` does **not** yet exist (created here). `api.ts` already has the `ExportLeaf` / `ExportPose` types + `warmShape` helper authored in the api-wiring chunk **OR** — if this chunk runs first — Task 2 below adds the minimal `warmShape` closure + the four export method signatures it needs. To keep this chunk self-contained and red→green-runnable in isolation, **Task 2 authors `warmShape` + the `ExportLeaf`/`ExportPose`/`KernelExportLeaf`/`StlExportLeaf` types itself** (idempotent: if the wiring chunk already added them, the edit's `old_string` won't match and you skip — the contract pins one canonical location so there is no duplication when chunks merge). Verify before editing with `grep -n 'export type ExportLeaf' src/api.ts`; if present, only add the four methods.

> **Binding fix (addendum §4):** The original plan called `new oc.TCollection_ExtendedString_2('XmlXCAF')` (one arg). The real `.d.ts` line 66737 declares `TCollection_ExtendedString_2(astring: Standard_CString, isMultiByte: Standard_Boolean)` — TWO required args. The plan used `oc as { TCollection_ExtendedString_2: new (s: string) => unknown }` which SUPPRESSES the tsc arity error. Fix: doc format string → `TCollection_ExtendedString_1()` (no-arg; proven verbatim from `stepColor.helper.ts:15`). Name labels → `new oc.TCollection_ExtendedString_2(name, true)` (isMultiByte). Remove the arity-hiding single-arg cast.

> **All-four-methods fix (addendum §1):** Task 2 MUST wire all four methods (`exportStepPart`, `exportStlPart`, `exportStepAssembly`, `exportStlAssembly`) to `KernelApi` + the returned object. Import `exportStlBinary` from `./occt/StlExport` (Phase 1/2 chunk). STL methods honor `opts?.binary` (true/absent; ASCII is a non-goal).

> **File-path uniqueness (addendum §3):** This chunk owns `packages/kernel/src/__tests__/api.export.integration.spec.ts` (cold-cache + STEP color-loss guards). Phase 6 uses the DISTINCT file `api.export.e2e.integration.spec.ts`. ONE `makeBoxPart` def per file — no redeclaration.

Three tasks:
- **Task 1** — `exportStepDoc(oc, leaves)` core in `occt/StepExport.ts` + a **pure-`oc`** integration spec (1 box → round-trip via `readStep`, `solidCount===1`, `bbox.span` `toBeCloseTo(10,3)` PROVING mm). No `api.ts` / cache involvement — isolates the XCAF write API.
- **Task 2** — ALL FOUR export methods (`exportStepPart`, `exportStlPart`, `exportStepAssembly`, `exportStlAssembly`) on `KernelApi` + the cold-cache `warmShape` re-execute (the load-bearing guard) + api-level integration spec (`createPart`→`execute`→`exportStepPart` AND a `loadFromBytes` COLD-cache part → still exports `solidCount===1`).
- **Task 3** — Phase 4 assembly correctness: posed **2-component, 2-DIFFERENT-color** round-trip (BOTH colors survive + posed min-corner `toBeCloseTo`) — the color-loss trap guard — plus a de-dup-prototype case (2 instances of ONE part → 1 `AddShape`, 2 components, 2 distinct posed bboxes).

---

### Task 1 — `exportStepDoc` XCAF write core + pure-`oc` round-trip (Phase 3 RED→GREEN)

**Files:**
- **Create:** `packages/kernel/src/occt/StepExport.ts`
- **Create (test):** `packages/kernel/src/occt/__tests__/StepExport.integration.spec.ts`
- **Reference (read-only):** `packages/kernel/src/occt/__tests__/stepColor.helper.ts:10-82` (proven write API — especially lines 15-17 for `TCollection_ExtendedString_1` no-arg doc bootstrap), `packages/kernel/src/occt/StepIO.ts:29-207` (`readStep`), `packages/kernel/src/occt/SolidOps.ts:17-34` (`makeBox`, `OcctShape`), `packages/kernel/src/occt/TransformOps.ts:41-77` (quat→3×3 math to inline as `trsfFromPose`).

- [ ] **Step 1: Write the failing spec.** Create `packages/kernel/src/occt/__tests__/StepExport.integration.spec.ts` (raw-`oc`, no api harness — this isolates the writer):
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox } from '../SolidOps';
import { readStep } from '../StepIO';
import { exportStepDoc, IDENTITY_POSE, type KernelExportLeaf } from '../StepExport';

describe('exportStepDoc — XCAF STEP write core', () => {
  let oc: OcctInstance;
  beforeAll(async () => { oc = await loadOcct(); }, 120_000);

  it('writes a single 10mm box that round-trips through readStep with correct mm units', () => {
    const box = makeBox(oc, 10, 10, 10); // [0,10]^3 — span proves mm, not cm/m
    const leaves: KernelExportLeaf[] = [
      { shape: box, protoKey: 'p1', name: 'Box10', pose: IDENTITY_POSE },
    ];
    const bytes = exportStepDoc(oc, leaves);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const res = readStep(oc, ab);
    expect(res.solidCount).toBe(1);                        // cold/empty export would be 0 → RED
    const span = res.boundingBox[3]! - res.boundingBox[0]!;
    expect(span).toBeCloseTo(10, 3);                       // PROVES mm — never `>`
    expect(res.boundingBox[4]! - res.boundingBox[1]!).toBeCloseTo(10, 3);
    expect(res.boundingBox[5]! - res.boundingBox[2]!).toBeCloseTo(10, 3);
  }, 120_000);

  it('round-trips a single surface color (sRGB) on a part label', () => {
    const box = makeBox(oc, 10, 10, 10);
    const leaves: KernelExportLeaf[] = [
      { shape: box, protoKey: 'p1', name: 'Red', pose: IDENTITY_POSE,
        color: [1, 0, 0] },
    ];
    const bytes = exportStepDoc(oc, leaves);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const res = readStep(oc, ab);
    expect(res.solidCount).toBe(1);
    expect(res.solidColors.filter(Boolean)).toEqual(['#ff0000']); // sRGB-as-is, lowercase
  }, 120_000);
});
```

- [ ] **Step 2: Run the spec — confirm RED for the right reason.**
```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx vitest run --config vitest.integration.config.ts src/occt/__tests__/StepExport.integration.spec.ts
```
**Expected RED:** module-resolution failure — `Failed to resolve import "../StepExport"` / `Cannot find module '../StepExport'` (the file doesn't exist yet). This is the expected red (missing impl), not an assertion mismatch.

- [ ] **Step 3: Create `StepExport.ts` with types + `trsfFromPose` + `exportStepDoc` (COMPLETE).** Create `packages/kernel/src/occt/StepExport.ts`:

> **Binding precision (addendum §4):**
> - Doc format string: use `TCollection_ExtendedString_1` (no-arg ctor) — verbatim from `stepColor.helper.ts:15`. Do NOT use `TCollection_ExtendedString_2` with one arg (two required: `astring, isMultiByte`).
> - Name labels: `new oc.TCollection_ExtendedString_2(name, true)` — the `true` is `isMultiByte` (Standard_Boolean, required). Remove arity-hiding single-arg cast.
> - Color: `Quantity_TOC_sRGB` (not `TOC_RGB`) — matches reader `StepIO.ts:211-215` and helper `:47`.
> - `TDataStd_Name.Set_1` accepts a `TCollection_ExtendedString` value (not a pointer/handle). The cast must reflect the two-arg ctor.

```ts
import type { OcctInstance } from './occtLoader';
import type { OcctShape } from './SolidOps';

/** World pose — same structural shape composedPoses (app) / cutAssemblyComponentsByStepSegments (kernel) emit. */
export type ExportPose = {
  translation: { x: number; y: number; z: number };
  quaternion: readonly [number, number, number, number];
};

export const IDENTITY_POSE: ExportPose = {
  translation: { x: 0, y: 0, z: 0 },
  quaternion: [0, 0, 0, 1],
};

/**
 * Kernel-internal export leaf — the shape is already resolved to an UN-POSED
 * prototype handle (from namedShapeCache). `protoKey` de-dups prototypes:
 * one AddShape per distinct protoKey, one AddComponent_1 per leaf. Pose lives
 * ONLY in the component's TopLoc_Location — NEVER baked into the shape, or the
 * STEP CAF writer drops per-shape colors (only the first survives).
 */
export type KernelExportLeaf = {
  shape: OcctShape;
  protoKey: string;
  name: string;
  pose: ExportPose;
  color?: readonly [number, number, number];
};

/**
 * Build a gp_Trsf from a pose (quaternion→3×3 + translation column).
 * Returns the gp_Trsf (caller wraps it in a TopLoc_Location). Does NOT apply
 * a BRepBuilderAPI_Transform — baking the location into the shape is the
 * color-loss trap. Math is identical to TransformOps.transformShapeByPose:49-67.
 * Caller owns the returned trsf and must .delete() it.
 */
function trsfFromPose(oc: OcctInstance, pose: ExportPose): unknown {
  const [x, y, z, w] = pose.quaternion;
  const { x: tx, y: ty, z: tz } = pose.translation;
  const r00 = 1 - 2 * (y * y + z * z);
  const r01 = 2 * (x * y - w * z);
  const r02 = 2 * (x * z + w * y);
  const r10 = 2 * (x * y + w * z);
  const r11 = 1 - 2 * (x * x + z * z);
  const r12 = 2 * (y * z - w * x);
  const r20 = 2 * (x * z - w * y);
  const r21 = 2 * (y * z + w * x);
  const r22 = 1 - 2 * (x * x + y * y);
  // gp_Trsf_1() is the no-arg ctor — confirmed in .d.ts; no (oc as {...}) cast needed.
  const trsf = new (oc as { gp_Trsf_1: new () => { SetValues: (...a: number[]) => void } }).gp_Trsf_1();
  trsf.SetValues(r00, r01, r02, tx, r10, r11, r12, ty, r20, r21, r22, tz);
  return trsf;
}

/**
 * Build a structured XCAF document from `leaves` and write it to STEP bytes via
 * STEPCAFControl_Writer. De-dups prototypes by `protoKey`: one labeled UN-POSED
 * AddShape per distinct part, one AddComponent_1 (with the pose in its
 * TopLoc_Location) per leaf. Colors + names live on the labels. sRGB color type
 * matches the shipped reader (StepIO.ts:211-215 quantityColorToHex, sRGB-as-is).
 *
 * Pure OCCT — no `parts`/cache access. Caller resolves `leaf.shape` (the
 * un-posed prototype) and `leaf.pose` (world pose) beforehand.
 */
export function exportStepDoc(oc: OcctInstance, leaves: readonly KernelExportLeaf[]): Uint8Array {
  if (leaves.length === 0) throw new Error('exportStepDoc: no leaves to export');

  // --- doc bootstrap ---
  // TCollection_ExtendedString_1 = no-arg ctor (proven verbatim: stepColor.helper.ts:15).
  // Do NOT use TCollection_ExtendedString_2 with one arg — it requires TWO args
  // (astring: Standard_CString, isMultiByte: Standard_Boolean) per .d.ts:66737.
  const appHandle = (oc as {
    XCAFApp_Application: { GetApplication(): { get(): { NewDocument_2(f: unknown, d: unknown): void } } };
  }).XCAFApp_Application.GetApplication();
  const app = appHandle.get();

  const TExtStr1 = (oc as { TCollection_ExtendedString_1: new () => unknown }).TCollection_ExtendedString_1;
  const docH = new (oc as { Handle_TDocStd_Document_1: new () => unknown }).Handle_TDocStd_Document_1();
  app.NewDocument_2(
    new TExtStr1(),
    docH as unknown as { get(): { Main(): unknown } },
  );
  const doc = (docH as unknown as { get(): { Main(): unknown } }).get();
  const main = doc.Main();

  // --- tools: .get() unwraps the Handle (helper :22-34) ---
  const shapeTool = (oc as {
    XCAFDoc_DocumentTool: { ShapeTool(l: unknown): { get(): {
      AddShape(s: unknown, makeAssembly: boolean, makePrepare: boolean): unknown;
      NewShape(): unknown;
      AddComponent_1(asm: unknown, comp: unknown, loc: unknown): unknown;
    } } };
  }).XCAFDoc_DocumentTool.ShapeTool(main).get();

  const colorTool = (oc as {
    XCAFDoc_DocumentTool: { ColorTool(l: unknown): { get(): {
      SetColor_2(label: unknown, color: unknown, type: unknown): void;
    } } };
  }).XCAFDoc_DocumentTool.ColorTool(main).get();

  // TCollection_ExtendedString_2: TWO args (astring: Standard_CString, isMultiByte: Standard_Boolean).
  // d.ts line 66737. Used for name labels only (NOT for the doc format string above).
  const TExtStr2 = (oc as { TCollection_ExtendedString_2: new (s: string, isMultiByte: boolean) => unknown }).TCollection_ExtendedString_2;
  const QColor = (oc as { Quantity_Color_3: new (a: number, b: number, c: number, t: unknown) => unknown }).Quantity_Color_3;
  // Quantity_TOC_sRGB — matches the shipped reader (StepIO.ts:211-215) and helper (:47).
  // NOT Quantity_TOC_RGB.
  const QTOC = (oc as { Quantity_TypeOfColor: { Quantity_TOC_sRGB: unknown } }).Quantity_TypeOfColor.Quantity_TOC_sRGB;
  const SURF = (oc as { XCAFDoc_ColorType: { XCAFDoc_ColorSurf: unknown } }).XCAFDoc_ColorType.XCAFDoc_ColorSurf;
  // TDataStd_Name.Set_1(label, TCollection_ExtendedString) — static, d.ts line 80281.
  const NameSet = (oc as { TDataStd_Name: { Set_1(l: unknown, s: unknown): unknown } }).TDataStd_Name;
  const TopLoc = (oc as { TopLoc_Location_2: new (t: unknown) => unknown }).TopLoc_Location_2;

  // 1. One labeled UN-POSED prototype per distinct protoKey (helper :56,60).
  const protoLabels = new Map<string, unknown>();
  for (const leaf of leaves) {
    if (protoLabels.has(leaf.protoKey)) continue;
    const partLabel = shapeTool.AddShape(leaf.shape.handle, false, true); // (s, makeAssembly=false, makePrepare=true)
    // TCollection_ExtendedString_2(name, true) — isMultiByte=true, both args required.
    NameSet.Set_1(partLabel, new TExtStr2(leaf.name, true));
    if (leaf.color) {
      const [r, g, b] = leaf.color;
      const qcol = new QColor(r, g, b, QTOC);
      colorTool.SetColor_2(partLabel, qcol, SURF);
    }
    protoLabels.set(leaf.protoKey, partLabel);
  }

  // 2. Root assembly label + one component per leaf — pose ONLY in TopLoc_Location.
  const asmLabel = shapeTool.NewShape();
  for (const leaf of leaves) {
    const trsf = trsfFromPose(oc, leaf.pose);
    const partLabel = protoLabels.get(leaf.protoKey)!;
    const compLabel = shapeTool.AddComponent_1(asmLabel, partLabel, new TopLoc(trsf));
    NameSet.Set_1(compLabel, new TExtStr2(leaf.name, true));
    (trsf as { delete?(): void }).delete?.();
  }

  // 3. Write (helper :64-77) — Transfer_1 takes the HANDLE docH + 4 args.
  const writer = new (oc as { STEPCAFControl_Writer_1: new () => {
    SetColorMode(v: boolean): void;
    SetNameMode(v: boolean): void;
    Transfer_1(doc: unknown, mode: unknown, multi: unknown, progress: unknown): boolean;
    Write(filename: string): unknown;
    delete(): void;
  } }).STEPCAFControl_Writer_1();
  writer.SetColorMode(true);
  writer.SetNameMode(true);

  const AsIs = (oc as { STEPControl_StepModelType: { STEPControl_AsIs: unknown } }).STEPControl_StepModelType.STEPControl_AsIs;
  const ProgressRange = (oc as { Message_ProgressRange_1?: new () => unknown }).Message_ProgressRange_1
    ?? (oc as { Message_ProgressRange?: new () => unknown }).Message_ProgressRange;
  if (!ProgressRange) throw new Error('exportStepDoc: Message_ProgressRange binding not found');

  const tmp = `/_step_export_${Math.random().toString(36).slice(2, 10)}.step`;
  const ok = writer.Transfer_1(docH, AsIs, null, new ProgressRange());
  if (!ok) {
    writer.delete();
    (docH as unknown as { delete?(): void }).delete?.();
    throw new Error('exportStepDoc: STEPCAFControl_Writer.Transfer_1 failed');
  }
  writer.Write(tmp);
  writer.delete();

  // --- FS readback (helper :79-81 / BRepIO.ts) ---
  const bytes = (oc as { FS: { readFile(p: string): Uint8Array; unlink(p: string): void } }).FS.readFile(tmp);
  (oc as { FS: { readFile(p: string): Uint8Array; unlink(p: string): void } }).FS.unlink(tmp);
  (docH as unknown as { delete?(): void }).delete?.();
  return bytes.slice(); // copy out of the MEMFS view
}
```

- [ ] **Step 4: Run the spec — confirm GREEN.**
```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx vitest run --config vitest.integration.config.ts src/occt/__tests__/StepExport.integration.spec.ts
```
**Expected GREEN:** `2 passed`. Both the mm-proof (span `toBeCloseTo(10,3)`) and the sRGB color round-trip (`['#ff0000']`) pass.
- **If the unit test reports the span as 1000 or 0.01 instead of 10** → STEP wrote in a non-mm length unit. ONLY THEN add, before constructing the writer in Step 3:
```ts
(oc as { Interface_Static: { SetCVal(name: string, val: string): unknown } }).Interface_Static.SetCVal('write.step.unit', 'MM');
```
Re-run; the contract's proven helper round-trips mm without it, so expect this branch to NOT fire — but the guard is here per the brief.
- **If RED with `AddComponent_1 is not a function` / `NewShape is not a function`** → confirm the binding names:
```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && grep -rn "AddComponent_1\|NewShape\|TCollection_ExtendedString_2\|TDataStd_Name" node_modules/opencascade.js/dist/*.d.ts | head -20
```
- **If RED with `TCollection_ExtendedString_2 called with wrong number of args`** → confirm the two-arg fix: `new TExtStr2(name, true)` — both args required per `.d.ts:66737`. The no-arg form for the doc format string uses `TExtStr1` (no args). These are separate ctor classes.

- [ ] **Step 5: Type-check — add no NEW tsc errors.**
```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx tsc --noEmit 2>&1 | grep -E 'StepExport' || echo 'NO NEW StepExport tsc ERRORS'
```
**Expected:** `NO NEW StepExport tsc ERRORS` (the casts mirror the proven helper's pattern → no new errors).

> **tsc / arity note:** The two-arg `TExtStr2` cast `new (s: string, isMultiByte: boolean) => unknown` is validated by tsc (the cast shape matches the actual two-arg ctor). This is intentionally NOT using a single-arg cast that would hide the arity mismatch. If tsc reports the cast as an error, verify against `.d.ts:66737` and adjust the cast's parameter list to match exactly.

- [ ] **Step 6: Commit.**
```bash
cd /Users/lion/Documents/Projects/mine/zilventor && git add packages/kernel/src/occt/StepExport.ts packages/kernel/src/occt/__tests__/StepExport.integration.spec.ts && git commit -m "$(printf 'feat(kernel): exportStepDoc XCAF STEP write core (Phase 3)\n\nUn-posed prototype AddShape + per-component AddComponent_1 w/ pose in\nTopLoc_Location only (color-loss trap avoided); TCollection_ExtendedString_1\nno-arg for doc format; TCollection_ExtendedString_2(name,true) two-arg for\nname labels; sRGB color type matches reader; mm-proof round-trip.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2 — ALL FOUR export methods on `KernelApi` + cold-cache `warmShape` (Phase 3 api-surface RED→GREEN)

> **Addendum §1 fix:** This task wires ALL FOUR methods (`exportStepPart`, `exportStlPart`, `exportStepAssembly`, `exportStlAssembly`) to the `KernelApi` type AND the returned object. The STL methods call `warmShapeForExport` then `exportStlBinary` (from Phase 1/2 chunk `occt/StlExport.ts`). This MUST happen before Phase 5b/Phase 6 so `exportStlPart`/`exportStlAssembly` are not undefined on the Comlink proxy.

**Files:**
- **Modify:** `packages/kernel/src/api.ts` — import `exportStepDoc` + `exportStlBinary` + types; add all four method signatures to `KernelApi`; add `warmShapeForExport` closure + all four method impls in the returned object.
- **Create (test):** `packages/kernel/src/__tests__/api.export.integration.spec.ts` (this chunk OWNS this file; Phase 6 uses the DISTINCT `api.export.e2e.integration.spec.ts`).
- **Reference (read-only):** `packages/kernel/src/api.ts:519-528` (`extractAssemblyRef` cold-cache pattern to lift), `:462-474` (`mirrorPart` same pattern), `:429-453` (`loadFromBytes` — warms `parts` NOT `namedShapeCache`, the trap), `__tests__/api.integration.spec.ts:8-32` (harness).

- [ ] **Step 1: Write the failing api-level spec.** Create `packages/kernel/src/__tests__/api.export.integration.spec.ts`:

> **File uniqueness (addendum §3):** This file is `api.export.integration.spec.ts` — the cold-cache + STEP color-loss guards. It has ONE `makeBoxPart` definition (name: string, side: number). Phase 6 uses the DISTINCT file `api.export.e2e.integration.spec.ts` with its own helper.

```ts
import { describe, it, expect } from 'vitest';
import { createKernelApi } from '../api';
import { readStep } from '../occt/StepIO';
import { loadOcct } from '../occt/occtLoader';

async function makeBoxPart(api: ReturnType<typeof createKernelApi>, name: string, side: number): Promise<string> {
  const partId = await api.createPart(name);
  await api.setParameter(partId, { name: 'd1', expression: String(side), value: side, unit: 'mm' });
  await api.addFeature(partId, { kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' },
    primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: side, h: side }], constraints: [] });
  await api.addFeature(partId, { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward', operation: 'new' });
  return partId;
}

describe('KernelApi STEP export', () => {
  it('exportStepPart on an executed part round-trips a 10mm box (mm units, 1 solid)', async () => {
    const api = createKernelApi();
    await api.init();
    const partId = await makeBoxPart(api, 'Box', 10);
    const r = await api.execute(partId); // warms namedShapeCache
    expect(r.ok).toBe(true);

    const bytes = await api.exportStepPart(partId);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const oc = await loadOcct();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const res = readStep(oc, ab);
    expect(res.solidCount).toBe(1);
    expect(res.boundingBox[3]! - res.boundingBox[0]!).toBeCloseTo(10, 3); // mm proof
  }, 120_000);

  it('exportStepPart re-executes a COLD namedShapeCache (loadFromBytes warms parts only)', async () => {
    const api = createKernelApi();
    await api.init();
    const partId = await makeBoxPart(api, 'ColdBox', 10);
    await api.execute(partId);
    const archive = await api.saveToBytes(partId);

    // Fresh kernel: loadFromBytes populates `parts` but NOT namedShapeCache → cold.
    const api2 = createKernelApi();
    await api2.init();
    const reloadedId = await api2.loadFromBytes(archive);

    const bytes = await api2.exportStepPart(reloadedId); // MUST re-execute, not export empty
    const oc = await loadOcct();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const res = readStep(oc, ab);
    expect(res.solidCount).toBe(1); // cold-cache-empty bug → 0 → RED
    expect(res.boundingBox[3]! - res.boundingBox[0]!).toBeCloseTo(10, 3);
  }, 120_000);
});
```

- [ ] **Step 2: Run — confirm RED for the right reason.**
```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx vitest run --config vitest.integration.config.ts src/__tests__/api.export.integration.spec.ts
```
**Expected RED:** `TypeError: api.exportStepPart is not a function` (method not yet on the returned object). Not an assertion/typo red.

- [ ] **Step 3: Add the imports.** In `packages/kernel/src/api.ts`, after the line `import { readStep, splitImportedShapeHelper } from './occt/StepIO';` (**:8**), add:
```ts
import { exportStepDoc, IDENTITY_POSE, type KernelExportLeaf, type ExportPose } from './occt/StepExport';
import { exportStlBinary, type StlExportLeaf } from './occt/StlExport';
```
Then **first run** `grep -n 'export type ExportLeaf' src/api.ts` — if it prints a line, the wiring chunk already declared the app-facing types; **skip the re-export edit below**. Otherwise add re-exports for the app-facing types immediately after `import type { FaceTag } from ...` (**:23**):
```ts
export type { ExportPose } from './occt/StepExport';
export type { StlExportLeaf } from './occt/StlExport';
/** App-facing export leaf — used by ExportStepCommand / ExportStlCommand. */
export type ExportLeaf = {
  partId: string;
  name: string;
  pose: ExportPose;
  color?: readonly [number, number, number];
};
```
> `IDENTITY_POSE` is a runtime value (used below). `KernelExportLeaf`/`ExportPose` are types — keep separate import lines. `StlExportLeaf` is the kernel-internal STL leaf type defined by the Phase 1/2 chunk.

- [ ] **Step 4: Add ALL FOUR method signatures to `KernelApi`.** In `api.ts`, inside the `KernelApi` type, after `cutAssemblyComponentsByStepSegments(...)` closing `;` at **:188** (right before the type's closing `};` at :189), add:
```ts
  /** Export a single registered part as a 1-leaf XCAF STEP doc (identity pose, no color). */
  exportStepPart(partId: string): Promise<Uint8Array>;
  /** Export an assembly: un-posed prototype per distinct partId, posed component per leaf. */
  exportStepAssembly(leaves: readonly ExportLeaf[], opts?: { name?: string }): Promise<Uint8Array>;
  /** Export a single part as binary STL (re-executes if cache is cold). */
  exportStlPart(partId: string, opts?: { binary?: boolean }): Promise<Uint8Array>;
  /** Export an assembly as binary STL (re-executes leaves if cache is cold). */
  exportStlAssembly(leaves: readonly ExportLeaf[], opts?: { binary?: boolean }): Promise<Uint8Array>;
```

- [ ] **Step 5: Add `warmShapeForExport` + all four method impls.** In `api.ts`, add the shared `warmShapeForExport` helper as a closure — place it **just above the `return {` at the start of the returned object** (alongside `updateNamedShapeCache` / `lookupImportedShape`, near **:226-233**):
```ts
  async function warmShapeForExport(partId: string): Promise<import('./occt/FaceNaming').NamedShape> {
    let ns = namedShapeCache.get(partId);
    if (!ns) {
      const p = parts.get(partId);
      if (!p) throw new Error(`export: leaf part ${partId} not loaded`);
      const r = await executeTree(occt!, p, lookupImportedShape);
      if (!r.ok) throw new Error(`export: execute failed for ${partId}: ${r.error.message}`);
      updateNamedShapeCache(partId, r.value.namedShape, r.value.workFeatures ?? []);
      ns = r.value.namedShape;
    }
    return ns;
  }
```
> `executeTree` + `lookupImportedShape` + `namedShapeCache` + `updateNamedShapeCache` + `parts` are all in scope at this closure site (defined :193-233). Reuse — do NOT re-import.

Then in the returned object after the `extractAssemblyRef` method's closing `},` (**:532**), add all four export method impls:
```ts
    // --- STEP export (Phase 3/4) ---
    // Cold-cache fallback: namedShapeCache is NOT warmed by loadFromBytes,
    // so every export re-executes when cold (pattern lifted from
    // extractAssemblyRef:519-528 / mirrorPart:467-474). Throws on unknown part.
    async exportStepPart(partId) {
      if (!occt) throw new Error('kernel not initialized');
      const ns = await warmShapeForExport(partId);
      const p = parts.get(partId)!;
      const leaf: KernelExportLeaf = { shape: ns.shape, protoKey: partId, name: p.name, pose: IDENTITY_POSE };
      return exportStepDoc(occt, [leaf]);
    },

    async exportStepAssembly(leaves, _opts) {
      if (!occt) throw new Error('kernel not initialized');
      if (leaves.length === 0) throw new Error('exportStepAssembly: no leaves');
      const kernelLeaves: KernelExportLeaf[] = [];
      for (const leaf of leaves) {
        const ns = await warmShapeForExport(leaf.partId);
        kernelLeaves.push({
          shape: ns.shape,
          protoKey: leaf.partId,
          name: leaf.name,
          pose: leaf.pose,
          ...(leaf.color ? { color: leaf.color } : {}),
        });
      }
      return exportStepDoc(occt, kernelLeaves);
    },

    // --- STL export (Phase 1/2) ---
    // STL methods honor opts?.binary (true/absent → binary; ASCII is a non-goal).
    // exportStlBinary is defined in occt/StlExport.ts (Phase 1/2 chunk).
    async exportStlPart(partId, opts) {
      if (!occt) throw new Error('kernel not initialized');
      const ns = await warmShapeForExport(partId);
      const p = parts.get(partId)!;
      const stlLeaf: StlExportLeaf = { shape: ns.shape, pose: IDENTITY_POSE };
      return exportStlBinary(occt, [stlLeaf], { binary: opts?.binary !== false });
    },

    async exportStlAssembly(leaves, opts) {
      if (!occt) throw new Error('kernel not initialized');
      if (leaves.length === 0) throw new Error('exportStlAssembly: no leaves');
      const stlLeaves: StlExportLeaf[] = [];
      for (const leaf of leaves) {
        const ns = await warmShapeForExport(leaf.partId);
        stlLeaves.push({ shape: ns.shape, pose: leaf.pose });
      }
      return exportStlBinary(occt, stlLeaves, { binary: opts?.binary !== false });
    },
```

- [ ] **Step 6: Run — confirm GREEN.**
```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx vitest run --config vitest.integration.config.ts src/__tests__/api.export.integration.spec.ts
```
**Expected GREEN:** `2 passed`. The cold-cache test is the load-bearing one — it proves `loadFromBytes`→`exportStepPart` re-executes (solidCount 1, not 0). If the cold test RED with `solidCount === 0` or a throw from `exportStepDoc`, the `warmShapeForExport` fallback didn't fire — re-check `warmShapeForExport` reads `namedShapeCache.get` BEFORE `exportStepDoc`.

- [ ] **Step 7: Regression — the existing api integration suite still passes (no signature break).**
```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx vitest run --config vitest.integration.config.ts src/__tests__/api.integration.spec.ts
```
**Expected GREEN:** all pre-existing cases pass (the additions are purely additive to `KernelApi`; Comlink auto-exposes, no `worker.ts` edit needed).

- [ ] **Step 8: Type-check.**
```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx tsc --noEmit 2>&1 | grep -E 'api\.ts|StepExport|StlExport' | grep -v 'node_modules' || echo 'NO NEW api/StepExport/StlExport tsc ERRORS'
```
**Expected:** `NO NEW api/StepExport/StlExport tsc ERRORS`.

> **tsc note on STL import:** `exportStlBinary` and `StlExportLeaf` must be exported by `packages/kernel/src/occt/StlExport.ts` (Phase 1/2 chunk). If tsc reports `Cannot find module './occt/StlExport'`, the Phase 1/2 chunk has not run yet — this is acceptable if chunks run in order (Phase 1/2 → Phase 3/4). Verify with: `ls packages/kernel/src/occt/StlExport.ts`. If missing, the Phase 1/2 chunk must complete first.

- [ ] **Step 9: Commit.**
```bash
cd /Users/lion/Documents/Projects/mine/zilventor && git add packages/kernel/src/api.ts packages/kernel/src/__tests__/api.export.integration.spec.ts && git commit -m "$(printf 'feat(kernel): all four export methods on KernelApi + cold-cache warmShape (Phase 3)\n\nWires exportStepPart/exportStepAssembly/exportStlPart/exportStlAssembly to\nKernelApi type + returned object; all four call warmShapeForExport (re-\nexecutes cold namedShapeCache). Cold-cache locked by loadFromBytes round-\ntrip asserting solidCount===1. STL methods honor opts.binary (binary default).\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3 — Phase 4: posed multi-component assembly + color-loss-trap guard + prototype de-dup (RED→GREEN)

**Files:**
- **Modify (test):** `packages/kernel/src/__tests__/api.export.integration.spec.ts` (append the Phase-4 cases — the writer + api methods already exist from Tasks 1-2, so this drives the *assembly-correctness* contract: pose-in-TopLoc, 2 colors survive, prototype de-dup).
- **Reference (read-only):** `packages/kernel/src/occt/StepIO.ts:5-14,162-179` (`readStep.solidColors` index-aligned to SOLID enumeration; `boundingBox`), `stepColor.helper.ts:36-42` (the documented color-loss trap this guards against).

- [ ] **Step 1: Append the failing Phase-4 cases.** Add to `packages/kernel/src/__tests__/api.export.integration.spec.ts` (inside the existing `describe`, after the Task-2 cases). These exercise `exportStepAssembly` with `ExportLeaf` at distinct poses + 2 different colors:

> **Un-posed prototype guard (addendum §4):** The color-loss trap is: if `trsfFromPose` bakes the location into the shape via `BRepBuilderAPI_Transform`, the XCAF writer drops all colors except the first. The guard below confirms BOTH colors survive a POSED assembly — it will RED if the bake-transform path is used instead of `TopLoc_Location_2`.

```ts
  it('exportStepAssembly: posed 2-component / 2-color assembly — BOTH colors survive + posed min-corner', async () => {
    const api = createKernelApi();
    await api.init();
    // Two registered parts (both executed → namedShapeCache warm).
    const redId = await makeBoxPart(api, 'Red', 10);
    const grnId = await makeBoxPart(api, 'Green', 10);
    await api.execute(redId);
    await api.execute(grnId);

    // Red at origin (identity); Green translated +50 along X. Different colors.
    const leaves: import('../api').ExportLeaf[] = [
      { partId: redId, name: 'Red',   pose: { translation: { x: 0,  y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const },  color: [1, 0, 0] as const },
      { partId: grnId, name: 'Green', pose: { translation: { x: 50, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const },  color: [0, 1, 0] as const },
    ];
    const bytes = await api.exportStepAssembly(leaves);

    const oc = await loadOcct();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const res = readStep(oc, ab);

    // (a) solidCount FIRST — a cold/empty export shows 0 → RED before colors.
    expect(res.solidCount).toBe(2);
    // (b) the color-loss-trap signature: BOTH distinct colors survive (the bug
    //     drops all but the first). sRGB-as-is, lowercase.
    expect(res.solidColors.filter(Boolean).sort()).toEqual(['#00ff00', '#ff0000']);
    // (c) pose lives in TopLoc only → posed bbox spans 0..60 (red 0..10, green 50..60).
    expect(res.boundingBox[0]!).toBeCloseTo(0, 3);   // red min-corner X
    expect(res.boundingBox[3]!).toBeCloseTo(60, 3);  // green max-corner X (50+10)
  }, 180_000);

  it('exportStepAssembly: 2 instances of ONE part → 1 prototype (AddShape once), 2 posed components', async () => {
    const api = createKernelApi();
    await api.init();
    const boxId = await makeBoxPart(api, 'Box', 10);
    await api.execute(boxId);

    // Same partId used twice (protoKey = partId → de-dup to 1 AddShape).
    const leaves: import('../api').ExportLeaf[] = [
      { partId: boxId, name: 'A', pose: { translation: { x: 0,  y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const } },
      { partId: boxId, name: 'B', pose: { translation: { x: 30, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const } },
    ];
    const bytes = await api.exportStepAssembly(leaves);

    const oc = await loadOcct();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const res = readStep(oc, ab);
    // Two distinct posed instances of the de-duped prototype.
    expect(res.solidCount).toBe(2);
    expect(res.boundingBox[0]!).toBeCloseTo(0, 3);
    expect(res.boundingBox[3]!).toBeCloseTo(40, 3); // B at 30..40
  }, 180_000);
```
> **Nested-`.ziasm` note (per brief):** the kernel `exportStepAssembly` consumes already-flattened `ExportLeaf[]` — the nested-`.ziasm`→leaves resolution lives app-side in `resolveExportLeaves` (Phase 5a chunk). The kernel's nested-derived case is therefore *structurally identical* to the 2-component posed case above (N leaves at composed world poses): the second test (2 instances of 1 part at distinct poses) IS the de-dup-under-nesting guard at the kernel boundary. The end-to-end nested-`.ziasm` proof is owned by Phase 5a + the e2e chunk, NOT duplicated here.

- [ ] **Step 2: Run — confirm RED for the right reason.**
```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx vitest run --config vitest.integration.config.ts src/__tests__/api.export.integration.spec.ts
```
**Expected:** the 4 cases run; the 2 NEW ones determine red/green. If the writer correctly poses-in-TopLoc and de-dups (Task 1 impl), they may pass immediately — **that is acceptable for a correctness guard added after the producing impl** (the contract's color-loss trap was already implemented in Task 1 per the proven helper). **If RED with `solidColors` showing only ONE color** (e.g. `['#ff0000']`) → the pose was baked into the shape (color-loss trap triggered); re-confirm `exportStepDoc` does NOT call `BRepBuilderAPI_Transform` and the pose flows only through `new TopLoc_Location_2(trsf)` in `AddComponent_1`. **If RED with `boundingBox[3]` ≈ 10 instead of 60** → the `TopLoc_Location` translation was dropped; re-check `trsfFromPose` `SetValues` puts `tx`/`ty`/`tz` in the 4th/8th/12th args.

- [ ] **Step 3: (only if Step 2 RED) Fix `exportStepDoc` per the diagnosis above, then re-run.** If Step 2 was already GREEN, skip. Re-run:
```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx vitest run --config vitest.integration.config.ts src/__tests__/api.export.integration.spec.ts
```
**Expected GREEN:** `4 passed`. Both new cases prove (a) 2 colors survive a POSED assembly (color-loss trap held), (b) posed min/max corners `toBeCloseTo` input, (c) prototype de-dup yields 2 posed instances.

- [ ] **Step 4: Full kernel integration suite — no regression across STEP I/O.**
```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx vitest run --config vitest.integration.config.ts src/occt/__tests__/stepColor.integration.spec.ts src/occt/__tests__/StepExport.integration.spec.ts src/__tests__/api.export.integration.spec.ts
```
**Expected GREEN:** all pass — the existing reader spec, the writer-core spec, and the api/assembly spec coexist (shared `readStep` round-trip, no shared mutable state).

- [ ] **Step 5: Type-check.**
```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx tsc --noEmit 2>&1 | grep -E 'api\.export|api\.ts|StepExport|StlExport' | grep -v node_modules || echo 'NO NEW tsc ERRORS'
```
**Expected:** `NO NEW tsc ERRORS`. (The `as const` quaternion literals satisfy `readonly [number,number,number,number]`; `color: [1,0,0] as const` satisfies `readonly [number,number,number]`.)

- [ ] **Step 6: Commit.**
```bash
cd /Users/lion/Documents/Projects/mine/zilventor && git add packages/kernel/src/__tests__/api.export.integration.spec.ts && git commit -m "$(printf 'test(kernel): Phase-4 posed assembly STEP guards — color-loss trap + de-dup\n\nPosed 2-component/2-color assembly asserts BOTH colors survive (color-loss\ntrap held: pose in TopLoc only, never baked) + posed min/max corner\ntoBeCloseTo; 2-instances-of-1-part proves prototype de-dup (1 AddShape,\n2 components). Nested .ziasm resolution is owned app-side (Phase 5a).\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

<!-- selfcritique:
FIXES APPLIED:
1. TCollection_ExtendedString_1 (no-arg) for doc format string — verbatim from helper:15. Removed single-arg TCollection_ExtendedString_2('XmlXCAF') call and arity-hiding cast.
2. TCollection_ExtendedString_2(name, true) with TWO args for name labels — cast now shows both args `new (s: string, isMultiByte: boolean) => unknown`, tsc validates arity.
3. All four methods (exportStepPart, exportStlPart, exportStepAssembly, exportStlAssembly) wired to KernelApi type AND returned object. STL methods import exportStlBinary + StlExportLeaf from Phase 1/2 chunk.
4. File uniqueness: api.export.integration.spec.ts owned here; Phase 6 gets api.export.e2e.integration.spec.ts.
5. Quantity_TOC_sRGB retained (was already correct; verified against helper:47).
6. Binding grep in Step 4 extended to include TCollection_ExtendedString + TDataStd_Name.
RISKS: (1) Phase 1/2 chunk must produce StlExport.ts before this chunk's Task 2 tsc check — documented. (2) StlExportLeaf type shape depends on Phase 1/2 chunk's actual definition. (3) TCollection_ExtendedString_2(name, true) BOOLEAN second arg — Embind Standard_Boolean is typically C++ bool, exposed as JS boolean; confirmed in .d.ts line 66737. Confidence: 91.
-->

---

## Phase 5a — leaf-resolution logic (app, pure TDD)

> **Base:** master (working tree at `3ecc2ff`). App package: `packages/app`. App suites run via `npx vitest run --config vitest.config.ts <file>` from `packages/app/` (jsdom). Re-`cd` to `/Users/lion/Documents/Projects/mine/zilventor/packages/app` for every Bash op (cwd persists, but be explicit). No manifest bump. No new tsc errors.
>
> **Verified against real code (corrections to the contract's aspirational anchors):**
> - Walkers live at `packages/app/src/assembly/walkers/` (NOT `src/walkers/`): `visibleLeaves.ts`, `composedPoses.ts`, `flattenForSolver.ts`. `computeInnerStaticPoses.ts` is at `packages/app/src/assembly/`.
> - `Pose` is exported from `assembly/walkers/flattenForSolver.ts` — `{ translation: Vec3; quaternion: [number,number,number,number] }`. It is NOT in `@zilventor/shared` (that's a *different* `Pose` in `jointMath.ts`). Use the walker's `Pose`.
> - `composedPoses(activeDoc, cache, { pathToUnknown, poses, rigidSubtreeRoots })` → `Map<pathKey, Pose>` (`composedPoses.ts:28`). The cache adapter type is `{ get(p): { kind:'ok'; doc; partPath; innerStaticPoses? } | undefined }`.
> - `visibleLeaves(activeDoc, cache)` → `VisibleLeaf[]` where `VisibleLeaf = { kind:'leaf'|'placeholder'; componentPath: ComponentPath; partPath: string; effectiveColor: ComponentColor | undefined }` (`visibleLeaves.ts:5`). `effectiveColor` is ALREADY resolved (palette/hex union); 5a only needs hex/palette→rgb.
> - `ComponentColor = { kind:'palette'; name } | { kind:'hex'; hex }` (`types.ts:92`). `AssemblyDocument.colors: Record<string,string>` (palette name → `#rrggbb`, `types.ts:127`).
> - `pathKey`, `ComponentPath`, `ComponentColor`, `AssemblyDocument` all from `@zilventor/shared`.
> - `resolvePartInfo(opfs, partPath, cache): Promise<PartInfo>` returns `{ name, … }`; on any failure → `{ name: '(missing part)' }` (`resolvePartInfo.ts:7`). **Full 3-arg signature: `(opfs: Opfs, partPath: string, cache: PartInfoCache) => Promise<PartInfo>`** — stubs in tests must match all three args.
> - `ExportLeaf`/`ExportPose` are authored by the kernel chunk in `packages/kernel/src/api.ts`; import as `import type { ExportLeaf, ExportPose } from '@zilventor/kernel/src/api'`. **If the kernel chunk has not yet landed those exports, confirm with `grep -n "export type ExportLeaf" /Users/lion/Documents/Projects/mine/zilventor/packages/kernel/src/api.ts` before Step 3 of Task 2. If they don't exist yet, declare the structural types inline in `resolveExportLeaves.ts` and add a `// TODO(5b-integration): replace with import type { ExportLeaf, ExportPose } from '@zilventor/kernel/src/api'` comment.**
>
> **Purity decision (scope-driven, BINDING — see addendum §2):**
> `resolveExportLeaves` does NOT do OPFS reads for sub-assemblies, `unpackAssembly`, or the self-warm sub-asm BFS — those are async I/O that the **5b command** performs and passes in. **5a receives the already-warmed sub-asm cache adapter** (`subAsmCache`), the `componentPoses` map, the `kernel.loadFromBytes` bridge, the `opfs` (for part bytes only), the `partInfoCache`, and the `resolvePartInfo` injected function. It remains a thin, deterministic resolver: `visibleLeaves` → placeholder-guard → world-pose zip → partPath→partId map → name → color → `ExportLeaf[]`. `effectiveColorToRgb` is a fully pure sync fn.
>
> **Required `resolveExportLeaves` arg list (canonical — 5b MUST match exactly):**
> ```ts
> {
>   assembly: AssemblyDocument;
>   kernel: { loadFromBytes(b: Uint8Array): Promise<string> };
>   opfs: { read(p: string): Promise<Uint8Array> };
>   subAsmCache: ExportSubAsmCache;           // built + warmed by 5b; plain { get: () => undefined } for flat assemblies
>   componentPoses: Map<string, Pose>;
>   partInfoCache: PartInfoCache;
>   resolvePartInfo: (opfs: { read(p: string): Promise<Uint8Array> }, partPath: string, cache: PartInfoCache) => Promise<{ name: string }>;
> }
> ```
> The 5b command builds the `subAsmCache` adapter verbatim from `App.tsx:3837–3841`:
> ```ts
> const { subAssemblyDocs, subAssemblyInnerPoses } = useAppStore.getState();
> const subAsmCache = {
>   get: (p: string) => subAssemblyDocs[p]
>     ? { kind: 'ok' as const, doc: subAssemblyDocs[p]!, partPath: p,
>         ...(subAssemblyInnerPoses[p] ? { innerStaticPoses: subAssemblyInnerPoses[p] } : {}) }
>     : undefined,
> };
> ```
> If the store is not yet warm (export fired before the App effect ran), 5b must run the BFS itself (mirror `App.tsx:3182–3208`). **5a does not self-warm — it only asserts that every placeholder is a hard error.**

---

### Task 1 — `effectiveColorToRgb` (pure color resolver, red→green→refactor)

**Files:**
- Create: `packages/app/src/assembly/resolveExportLeaves.ts` (this task adds `effectiveColorToRgb` only; Task 2 adds `resolveExportLeaves`)
- Create (Test): `packages/app/src/assembly/__tests__/resolveExportLeaves.spec.ts` (this task adds the `effectiveColorToRgb` describe block; Task 2/3 extend it)

**Addendum §2/§6 confirmation:** `effectiveColorToRgb` is self-contained with its own inline hex parse — it does NOT import `hexToRgb01` from `packages/kernel/src/occt/__tests__/stepColor.helper.ts` (that is a kernel test helper inaccessible to app code). The implementation below mirrors `App.tsx:3916-3918` exactly.

- [ ] **Step 1: Write the failing color-table test.** Create `packages/app/src/assembly/__tests__/resolveExportLeaves.spec.ts` with exactly:
```ts
import { describe, expect, it } from 'vitest';
import type { ComponentColor } from '@zilventor/shared';
import { effectiveColorToRgb } from '../resolveExportLeaves';

const hex = (h: string): ComponentColor => ({ kind: 'hex', hex: h });
const pal = (name: string): ComponentColor => ({ kind: 'palette', name });

describe('effectiveColorToRgb', () => {
  it('maps a hex color to 0–1 RGB', () => {
    expect(effectiveColorToRgb(hex('#ff8000'), {})).toEqual([255 / 255, 128 / 255, 0 / 255]);
  });

  it('maps a palette hit via assembly.colors', () => {
    expect(effectiveColorToRgb(pal('oak'), { oak: '#00ff00' })).toEqual([0, 1, 0]);
  });

  it('returns undefined for a palette miss (name not in colors)', () => {
    expect(effectiveColorToRgb(pal('walnut'), { oak: '#00ff00' })).toBeUndefined();
  });

  it('returns undefined for an undefined color', () => {
    expect(effectiveColorToRgb(undefined, { oak: '#00ff00' })).toBeUndefined();
  });

  it('accepts hex without leading # and 3-component values', () => {
    expect(effectiveColorToRgb(hex('0080ff'), {})).toEqual([0, 128 / 255, 1]);
  });
});
```

- [ ] **Step 2: Run — confirm RED for the expected reason.** From `/Users/lion/Documents/Projects/mine/zilventor/packages/app`:
```
npx vitest run --config vitest.config.ts src/assembly/__tests__/resolveExportLeaves.spec.ts
```
Expected: **RED** — `Failed to resolve import "../resolveExportLeaves"` / `effectiveColorToRgb is not a function` (module does not exist yet). This is the correct red (missing impl, not a typo).

- [ ] **Step 3: Minimal green — create the module with only `effectiveColorToRgb`.** Create `packages/app/src/assembly/resolveExportLeaves.ts`:
```ts
import type { ComponentColor } from '@zilventor/shared';

/**
 * Resolve a (pre-resolved) ComponentColor union to a 0–1 RGB triple, mirroring
 * the renderer's palette/hex resolution (App.tsx:3915-3919). A palette name not
 * present in `colors`, or an absent color, yields undefined (= unmaterialized;
 * the export omits a color label for that leaf).
 *
 * Self-contained hex parser — does NOT import the kernel test helper hexToRgb01
 * (that is inaccessible to app code). Inline parse mirrors App.tsx:3916-3918.
 */
export function effectiveColorToRgb(
  color: ComponentColor | undefined,
  colors: Record<string, string>,
): readonly [number, number, number] | undefined {
  let hexStr: string | undefined;
  if (!color) return undefined;
  if (color.kind === 'hex') hexStr = color.hex;
  else if (color.kind === 'palette') hexStr = colors[color.name];
  if (!hexStr) return undefined;
  const h = hexStr.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}
```

- [ ] **Step 4: Run — confirm GREEN.** From `packages/app`:
```
npx vitest run --config vitest.config.ts src/assembly/__tests__/resolveExportLeaves.spec.ts
```
Expected: **GREEN** — 5 passing tests in the `effectiveColorToRgb` describe block.

- [ ] **Step 5: Refactor check (no change expected).** The fn is already minimal (mirrors `App.tsx:3916-3918`); no dead code. Confirm no new tsc errors introduced — from `packages/app`:
```
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "resolveExportLeaves" || echo "0 errors in new file"
```
Expected: `0 errors in new file` (the new module is clean). Stay green.

- [ ] **Step 6: Commit.**
```
cd /Users/lion/Documents/Projects/mine/zilventor && git add packages/app/src/assembly/resolveExportLeaves.ts packages/app/src/assembly/__tests__/resolveExportLeaves.spec.ts && git commit -m "feat(export): effectiveColorToRgb pure color resolver (Phase 5a)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2 — `resolveExportLeaves` happy path: 2-instance assembly → 2 leaves (rgb + world poses + names)

**Files:**
- Modify: `packages/app/src/assembly/resolveExportLeaves.ts` (add `resolveExportLeaves` + its arg types)
- Modify (Test): `packages/app/src/assembly/__tests__/resolveExportLeaves.spec.ts` (add a `resolveExportLeaves` describe block with the 2-instance happy path AND a nested sub-asm case)

**Addendum §2 requirements applied here:**
1. The test passes `subAsmCache` (empty stub `{ get: () => undefined }`) for the flat assembly case — so the full 7-arg signature is exercised as 5b will call it.
2. A stub `subAsmCache` returning an `'ok'` nested doc is added to prove nested leaves resolve (not placeholders). This is a NEW test case added per the addendum.
3. The `resolvePartInfo` stub uses all 3 args `(_opfs, partPath, _cache)` matching the real 3-arg signature.

- [ ] **Step 1: Write the failing happy-path + nested-sub-asm tests.** Append to `packages/app/src/assembly/__tests__/resolveExportLeaves.spec.ts` (add these imports at the top of the file alongside the existing ones, then the new describe block at the end):
```ts
// --- add to the import block at the top ---
import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { resolveExportLeaves } from '../resolveExportLeaves';
import type { PartInfoCache } from '../../shell/resolvePartInfo';
```
```ts
// --- append at the end of the file ---

function asmDoc(over: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return {
    id: 'asm', name: 'asm', units: 'mm', parameters: {}, components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {},
    colorOverrides: {}, properties: {}, materials: [], hardware: [], ...over,
  };
}

// A fake opfs/kernel/resolvePartInfo bridge. loadFromBytes returns a stable id
// per partPath (the persisted-UUID contract); resolvePartInfo returns a name.
// NOTE: resolvePartInfo uses the full 3-arg signature matching the real function.
function makeBridge(opts: {
  bytesByPath: Record<string, Uint8Array>;
  idByPath: Record<string, string>;
  nameByPath: Record<string, string>;
}) {
  const reads: string[] = [];
  return {
    reads,
    kernel: {
      async loadFromBytes(b: Uint8Array): Promise<string> {
        const path = Object.keys(opts.bytesByPath).find((p) => opts.bytesByPath[p] === b);
        if (!path) throw new Error('unknown bytes');
        return opts.idByPath[path]!;
      },
    },
    opfs: {
      async read(p: string): Promise<Uint8Array> {
        reads.push(p);
        const b = opts.bytesByPath[p];
        if (!b) throw new Error(`no bytes for ${p}`);
        return b;
      },
      async exists(p: string): Promise<boolean> {
        return p in opts.bytesByPath;
      },
    },
    // 3-arg signature matching resolvePartInfo.ts:7
    resolvePartInfo: async (_opfs: unknown, p: string, _cache: unknown) => ({ name: opts.nameByPath[p] ?? '(missing part)' }),
  };
}

describe('resolveExportLeaves', () => {
  it('resolves a 2-instance assembly to 2 leaves with rgb + distinct world poses + names', async () => {
    const partBytes = new Uint8Array([1, 2, 3]);
    const assembly = asmDoc({
      colors: { oak: '#00ff00' },
      components: [
        { id: 'a', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'hex', hex: '#ff0000' } },
        { id: 'b', partPath: 'panel.zipt', position: { x: 100, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'palette', name: 'oak' } },
      ],
    });
    const bridge = makeBridge({
      bytesByPath: { 'panel.zipt': partBytes },
      idByPath: { 'panel.zipt': 'part-uuid-1' },
      nameByPath: { 'panel.zipt': 'Side Panel' },
    });
    // componentPoses already covers both top-level leaves (solver has run).
    const componentPoses = new Map([
      [pathKey(['a']), { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] }],
      [pathKey(['b']), { translation: { x: 100, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] }],
    ]);
    // subAsmCache is empty (no sub-assemblies in this flat doc) — exercising the full 7-arg signature.
    const subAsmCache = { get: (_p: string) => undefined };

    const leaves = await resolveExportLeaves({
      assembly,
      kernel: bridge.kernel,
      opfs: bridge.opfs,
      subAsmCache,
      componentPoses,
      partInfoCache: new Map() as PartInfoCache,
      resolvePartInfo: bridge.resolvePartInfo,
    });

    expect(leaves).toHaveLength(2);
    // both instances share one prototype id (de-dup is a kernel concern; app emits per-instance leaves)
    expect(leaves.map((l) => l.partId)).toEqual(['part-uuid-1', 'part-uuid-1']);
    expect(leaves.map((l) => l.name)).toEqual(['Side Panel', 'Side Panel']);
    // distinct world poses from componentPoses
    expect(leaves[0]!.pose.translation).toEqual({ x: 0, y: 0, z: 0 });
    expect(leaves[1]!.pose.translation).toEqual({ x: 100, y: 0, z: 0 });
    // colors: hex red, palette oak→green
    expect(leaves[0]!.color).toEqual([1, 0, 0]);
    expect(leaves[1]!.color).toEqual([0, 1, 0]);
    // each unique partPath read exactly once (the warm map de-dups by partPath)
    expect(bridge.reads.filter((p) => p === 'panel.zipt')).toHaveLength(1);
  });

  /**
   * Addendum §2 case: stub subAsmCache returns an 'ok' entry for a .ziasm path.
   * Proves that nested leaves from a warmed sub-assembly are RESOLVED (not placeholders)
   * when the cache is properly populated — the exact shape the 5b command will build
   * from the store's subAssemblyDocs/subAssemblyInnerPoses (App.tsx:3837-3841).
   */
  it('resolves leaves from a nested sub-assembly when subAsmCache returns ok', async () => {
    const partBytes = new Uint8Array([4, 5, 6]);
    // The inner sub-assembly doc (1 part component inside)
    const innerDoc = asmDoc({
      id: 'inner-asm',
      components: [
        { id: 'c', partPath: 'shelf.zipt', position: { x: 0, y: 0, z: 50 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    // The outer assembly references the inner as a .ziasm component
    const outerDoc = asmDoc({
      components: [
        { id: 'cabinet', partPath: 'cabinet.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    const bridge = makeBridge({
      bytesByPath: { 'shelf.zipt': partBytes },
      idByPath: { 'shelf.zipt': 'shelf-uuid' },
      nameByPath: { 'shelf.zipt': 'Shelf' },
    });
    // subAsmCache warmed with the inner doc (mirroring the 5b adapter from App.tsx:3837-3841).
    // innerStaticPoses maps pathKey(['c']) → inner pose (mirrors what computeInnerStaticPoses returns).
    const innerPoses = new Map([
      [pathKey(['c']), { translation: { x: 0, y: 0, z: 50 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] }],
    ]);
    const subAsmCache = {
      get: (p: string) =>
        p === 'cabinet.ziasm'
          ? ({ kind: 'ok' as const, doc: innerDoc, partPath: p, innerStaticPoses: innerPoses })
          : undefined,
    };
    // componentPoses covers the outer cabinet root; inner leaf pose will be composed by composedPoses
    const componentPoses = new Map([
      [pathKey(['cabinet']), { translation: { x: 10, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] }],
    ]);

    const leaves = await resolveExportLeaves({
      assembly: outerDoc,
      kernel: bridge.kernel,
      opfs: bridge.opfs,
      subAsmCache,
      componentPoses,
      partInfoCache: new Map() as PartInfoCache,
      resolvePartInfo: bridge.resolvePartInfo,
    });

    // The inner leaf is RESOLVED — not a placeholder and not thrown.
    expect(leaves).toHaveLength(1);
    expect(leaves[0]!.partId).toBe('shelf-uuid');
    expect(leaves[0]!.name).toBe('Shelf');
    // Pose: outer cabinet at x=10 + inner shelf at z=50 → composed via innerStaticPoses
    // composedPoses rigid branch: composePoses({x:10,y:0,z:0,q=[0,0,0,1]}, {x:0,y:0,z:50,q=[0,0,0,1]})
    // = translation {x:10, y:0, z:50}
    expect(leaves[0]!.pose.translation.x).toBeCloseTo(10);
    expect(leaves[0]!.pose.translation.z).toBeCloseTo(50);
  });
});
```

- [ ] **Step 2: Run — confirm RED for the expected reason.** From `packages/app`:
```
npx vitest run --config vitest.config.ts src/assembly/__tests__/resolveExportLeaves.spec.ts
```
Expected: **RED** — `resolveExportLeaves is not a function` / import resolves but symbol missing (the new export does not exist yet). The 5 `effectiveColorToRgb` tests still pass; the 2 new tests error on the missing function. Correct red.

> **Note (ExportLeaf type source):** `resolveExportLeaves`'s return type is `ExportLeaf[]` from `@zilventor/kernel/src/api`. Confirm with:
> ```
> grep -n "export type ExportLeaf" /Users/lion/Documents/Projects/mine/zilventor/packages/kernel/src/api.ts
> ```
> If the kernel chunk's `ExportLeaf`/`ExportPose` exports have **already landed**, import them with `import type { ExportLeaf, ExportPose } from '@zilventor/kernel/src/api'`. If **not yet landed**, declare the structural types inline (matching the contract §B exactly) and add `// TODO(5b-integration): replace with import type { ExportLeaf, ExportPose } from '@zilventor/kernel/src/api'`. Swap to the real import once kernel lands. Do NOT use `oc as {...}` casts in this file (they hide arity errors from tsc).

- [ ] **Step 3: Minimal green — add `resolveExportLeaves` + arg types.** Append to `packages/app/src/assembly/resolveExportLeaves.ts` (imports go at the top of the file):

> **Pre-step check:** If `ExportLeaf`/`ExportPose` are not yet in `@zilventor/kernel/src/api`, replace the import line below with the inline fallback block shown in the comment. Do not leave a broken import.

```ts
// --- add to the top of the file ---
import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { visibleLeaves } from './walkers/visibleLeaves';
import { composedPoses } from './walkers/composedPoses';
import { flattenForSolver, type Pose } from './walkers/flattenForSolver';
import type { PartInfoCache } from '../shell/resolvePartInfo';

// If ExportLeaf/ExportPose exist in the kernel chunk (confirmed by grep above), use:
import type { ExportLeaf, ExportPose } from '@zilventor/kernel/src/api';
// Otherwise replace the line above with the inline structural fallback:
// export type ExportPose = { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] };
// export type ExportLeaf = { partId: string; name: string; pose: ExportPose; color?: readonly [number, number, number] };
// // TODO(5b-integration): replace with import type { ExportLeaf, ExportPose } from '@zilventor/kernel/src/api'
```

```ts
/**
 * Sub-asm cache adapter shape consumed by visibleLeaves/composedPoses/flattenForSolver.
 *
 * CANONICAL ARG CONTRACT (addendum §2 — 5b MUST match exactly):
 *   assembly        — the top-level AssemblyDocument to export
 *   kernel          — { loadFromBytes(b): Promise<partId> } from the Comlink proxy
 *   opfs            — { read(p): Promise<Uint8Array> } for reading .zipt part bytes
 *   subAsmCache     — pre-warmed adapter built by the 5b command from the store
 *                     (App.tsx:3837–3841 shape; carries innerStaticPoses for rigid sub-asms)
 *   componentPoses  — solver-published Map<pathKey, Pose>; may be empty → forces recompute
 *   partInfoCache   — mutable Map<partPath, PartInfo>; passed through to resolvePartInfo
 *   resolvePartInfo — injected 3-arg fn matching resolvePartInfo.ts:7 signature
 *
 * This function is PURE — it does NOT run OPFS reads for sub-assemblies, call
 * unpackAssembly, or run the self-warm BFS. The 5b command builds the subAsmCache
 * adapter and passes it in. 5a only asserts that every placeholder is a hard error.
 */
type ExportSubAsmCache = {
  get(p: string): { kind: 'ok'; doc: AssemblyDocument; partPath: string; innerStaticPoses?: Map<string, Pose> } | undefined;
};

const IDENTITY_POSE: ExportPose = { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] };

export async function resolveExportLeaves(args: {
  assembly: AssemblyDocument;
  kernel: { loadFromBytes(b: Uint8Array): Promise<string> };
  opfs: { read(p: string): Promise<Uint8Array> };
  /** Pre-warmed sub-asm cache adapter — the 5b command builds this from
   *  useAppStore.getState().subAssemblyDocs + subAssemblyInnerPoses (App.tsx:3837–3841).
   *  For flat assemblies (no .ziasm children), pass { get: () => undefined }. */
  subAsmCache: ExportSubAsmCache;
  componentPoses: Map<string, Pose>;
  partInfoCache: PartInfoCache;
  /** Injected 3-arg function matching resolvePartInfo.ts:7 — (opfs, partPath, cache) → PartInfo */
  resolvePartInfo: (opfs: { read(p: string): Promise<Uint8Array> }, partPath: string, cache: PartInfoCache) => Promise<{ name: string }>;
}): Promise<ExportLeaf[]> {
  const { assembly, kernel, opfs, subAsmCache, componentPoses, partInfoCache, resolvePartInfo } = args;

  // 1. Visible leaves over the (already-warmed) sub-asm cache.
  const leaves = visibleLeaves(assembly, subAsmCache);

  // 2. Unresolved sub-assembly leaves are a hard error — never silently dropped.
  //    The 5b command MUST ensure subAsmCache is warm before calling here.
  for (const l of leaves) {
    if (l.kind === 'placeholder') {
      throw new Error(`export: unresolved sub-assembly leaf ${l.partPath}`);
    }
  }

  // 3. World poses. Prefer the already-solved componentPoses; if it doesn't
  //    cover every leaf (first render after a mutation), recompute via
  //    flattenForSolver + composedPoses against initial unknown poses.
  let composedMap: Map<string, Pose> = componentPoses;
  if (!leaves.every((l) => composedMap.has(pathKey(l.componentPath)))) {
    const flat = flattenForSolver(assembly, subAsmCache);
    composedMap = composedPoses(assembly, subAsmCache, {
      pathToUnknown: flat.pathToUnknown,
      poses: flat.unknowns,
      rigidSubtreeRoots: flat.rigidSubtreeRoots,
    });
  }

  // 4. partPath → kernel partId (the persisted-UUID bridge). loadFromBytes is
  //    stable per part doc; warm one id per unique partPath.
  const partIdByPath = new Map<string, string>();
  const nameByPath = new Map<string, string>();
  for (const pp of new Set(leaves.map((l) => l.partPath))) {
    const bytes = await opfs.read(pp);
    partIdByPath.set(pp, await kernel.loadFromBytes(bytes));
    const info = await resolvePartInfo(opfs, pp, partInfoCache);
    nameByPath.set(pp, info.name || pp.split('/').pop() || pp);
  }

  // 5. Build one ExportLeaf per visible instance (prototype de-dup is a kernel concern).
  return leaves.map((l) => {
    const pose = composedMap.get(pathKey(l.componentPath)) ?? IDENTITY_POSE;
    const color = effectiveColorToRgb(l.effectiveColor, assembly.colors);
    return {
      partId: partIdByPath.get(l.partPath)!,
      name: nameByPath.get(l.partPath)!,
      pose: { translation: { ...pose.translation }, quaternion: [...pose.quaternion] as ExportPose['quaternion'] },
      ...(color !== undefined ? { color } : {}),
    };
  });
}
```

> The `resolvePartInfo` arg is injected so the test can stub it without OPFS-unpacking real `.zipt` bytes. The 5b command passes the real `resolvePartInfo` from `../shell/resolvePartInfo`. The stub must match the 3-arg signature `(_opfs, partPath, _cache) => Promise<{ name }>`.

- [ ] **Step 4: Run — confirm GREEN.** From `packages/app`:
```
npx vitest run --config vitest.config.ts src/assembly/__tests__/resolveExportLeaves.spec.ts
```
Expected: **GREEN** — 7 passing (5 color + 1 flat happy-path + 1 nested sub-asm). The nested-sub-asm case confirms: 1 leaf, `partId: 'shelf-uuid'`, `name: 'Shelf'`, composed pose `{x:10, z:50}`, and NO placeholder throw.

- [ ] **Step 5: tsc gate.** From `packages/app`:
```
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "resolveExportLeaves" || echo "0 errors in resolveExportLeaves"
```
Expected: `0 errors in resolveExportLeaves`. (If `@zilventor/kernel/src/api` lacks `ExportLeaf` yet, use the inline structural fallback — see Step 2 note — to keep tsc clean. Do NOT leave a broken import or use `oc as {...}` casts to suppress errors.)

- [ ] **Step 6: Commit.**
```
cd /Users/lion/Documents/Projects/mine/zilventor && git add packages/app/src/assembly/resolveExportLeaves.ts packages/app/src/assembly/__tests__/resolveExportLeaves.spec.ts && git commit -m "feat(export): resolveExportLeaves happy path + nested sub-asm resolution (Phase 5a)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3 — `resolveExportLeaves` edge cases: placeholder throws + pose recompute fallback

**Files:**
- Modify (Test only): `packages/app/src/assembly/__tests__/resolveExportLeaves.spec.ts` (extend the `resolveExportLeaves` describe with 2 edge tests)

This task is pure red→green against the *already-written* impl — it locks the §17 placeholder-throw guard and the step-3 pose-recompute fallback. No new production code expected (if a test fails, fix the impl — that's the systematic-debugging branch).

- [ ] **Step 1: Write the placeholder + recompute tests.** Append inside the `describe('resolveExportLeaves', …)` block (after the two existing `it` blocks), still before the closing `}`):
```ts
  it('throws on an unresolved sub-assembly (placeholder) leaf — never silently dropped', async () => {
    const assembly = asmDoc({
      components: [
        // A .ziasm child with no cache entry → visibleLeaves emits a placeholder.
        { id: 's', partPath: 'sub.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    const bridge = makeBridge({ bytesByPath: {}, idByPath: {}, nameByPath: {} });
    await expect(
      resolveExportLeaves({
        assembly,
        kernel: bridge.kernel,
        opfs: bridge.opfs,
        subAsmCache: { get: (_p: string) => undefined },
        componentPoses: new Map(),
        partInfoCache: new Map() as PartInfoCache,
        resolvePartInfo: bridge.resolvePartInfo,
      }),
    ).rejects.toThrow(/unresolved sub-assembly leaf sub\.ziasm/);
  });

  it('recomputes world poses via flatten+composed when componentPoses is empty', async () => {
    const partBytes = new Uint8Array([9, 9]);
    const assembly = asmDoc({
      components: [
        { id: 'a', partPath: 'p.zipt', position: { x: 7, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'b', partPath: 'p.zipt', position: { x: 0, y: 13, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    const bridge = makeBridge({
      bytesByPath: { 'p.zipt': partBytes },
      idByPath: { 'p.zipt': 'uuid-p' },
      nameByPath: { 'p.zipt': 'Part P' },
    });
    const leaves = await resolveExportLeaves({
      assembly,
      kernel: bridge.kernel,
      opfs: bridge.opfs,
      subAsmCache: { get: (_p: string) => undefined },
      componentPoses: new Map(), // empty → forces the flatten+composed fallback (App.tsx:3856-3863)
      partInfoCache: new Map() as PartInfoCache,
      resolvePartInfo: bridge.resolvePartInfo,
    });
    expect(leaves).toHaveLength(2);
    // poses come from initialPose (declared position) via composedPoses
    expect(leaves[0]!.pose.translation).toEqual({ x: 7, y: 0, z: 0 });
    expect(leaves[1]!.pose.translation).toEqual({ x: 0, y: 13, z: 0 });
    // no color provided → color key omitted
    expect(leaves[0]!.color).toBeUndefined();
    expect('color' in leaves[0]!).toBe(false);
  });
```

- [ ] **Step 2: Run — confirm the edge tests pass (impl already handles them).** From `packages/app`:
```
npx vitest run --config vitest.config.ts src/assembly/__tests__/resolveExportLeaves.spec.ts
```
Expected: **GREEN** — 9 passing. If the placeholder test fails (e.g. impl dropped the throw) or the recompute test fails (e.g. fallback branch wrong), STOP and apply `superpowers:systematic-debugging`: reproduce, root-cause against `visibleLeaves.ts:30-31` (placeholder emission) / `composedPoses.ts:43` (declared-position initial pose), fix the impl, re-run to green. Do not weaken the test.

> **Why these are red-capable, not vacuous:** the placeholder test depends on `visibleLeaves` emitting `kind:'placeholder'` for an uncached `.ziasm` (`visibleLeaves.ts:30-31`) AND the impl's step-2 throw; remove either and it's RED. The recompute test passes an **empty** `componentPoses`, forcing the `!leaves.every(has)` branch (`resolveExportLeaves` step-3) → `flattenForSolver`+`composedPoses` must reproduce declared positions; bypass the branch and poses fall back to `IDENTITY_POSE` (0,0,0) → RED on `{x:7}`/`{y:13}`.

- [ ] **Step 3: Full Phase-5a file is green + no tsc regressions.** From `packages/app`:
```
npx vitest run --config vitest.config.ts src/assembly/__tests__/resolveExportLeaves.spec.ts && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "resolveExportLeaves" || echo "tsc clean for new file"
```
Expected: 9 passing tests; `tsc clean for new file` (or `0`). Confirm no NEW tsc-error files beyond the ~16 pre-existing baseline (the new file must not appear in tsc output).

- [ ] **Step 4: Commit.**
```
cd /Users/lion/Documents/Projects/mine/zilventor && git add packages/app/src/assembly/__tests__/resolveExportLeaves.spec.ts && git commit -m "test(export): placeholder-throw + pose-recompute edge cases for resolveExportLeaves (Phase 5a)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

<!-- selfcritique:
Verified every symbol against real code:
- Walker paths corrected from contract's src/walkers/ to src/assembly/walkers/ — confirmed by ls.
- Pose from flattenForSolver.ts, not @zilventor/shared — confirmed line 5.
- composedPoses/visibleLeaves signatures verified against actual files.
- ComponentColor/colors shape confirmed via types.ts ref.
- resolvePartInfo is 3-arg (opfs, partPath, cache) — confirmed resolvePartInfo.ts:7; updated stubs in all tests.
- ExportLeaf/ExportPose do NOT exist yet in kernel api.ts (grep returned empty) — inline fallback note prominent.
- effectiveColorToRgb uses self-contained inline hex parse (not kernel test helper hexToRgb01 which is inaccessible from app code) — addendum §2 confirmed.
- Added nested sub-asm test case per addendum §2 requirement — uses stub subAsmCache returning 'ok' entry with innerStaticPoses, proves leaves resolve and composedPoses rigid branch poses them correctly.
- subAsmCache type confirmed against SubAssemblyCache.ts:7 (SubAssemblyEntry 'ok' shape) and composedPoses.ts:26 (CacheEntry type).
- Addendum §2 canonical arg list documented verbatim in both function JSDoc and the phase preamble.

Assumptions: composedPoses rigid branch composes outerPose + innerStaticPose (confirmed composedPoses.ts:52-57: composePoses(myPose, innerPose)). For the nested test: outer {x:10,y:0,z:0,q=[0,0,0,1]} + inner {x:0,y:0,z:50,q=[0,0,0,1]} → {x:10,y:0,z:50} (no rotation applied since q=[0,0,0,1] → quatRotateVec returns identity of translation).

Risk: if composedPoses.ts rigid branch needs the full path including sub-asm prefix to find leaves (not just the component path from the outer doc), the nested-sub-asm test may fail. Checked composedPoses.ts:54-57: it uses parsePathKey(innerKey) and prefixes with [...path, ...innerPath], so pathKey(['cabinet','c']) is the composed key. The componentPoses map has only pathKey(['cabinet']), not the leaf — so the !leaves.every(has) branch will fire and recompute. composedPoses will emit the leaf at pathKey(['cabinet','c']). The rigid branch is entered because cabinet.flexible is undefined (falsy). innerStaticPoses has pathKey(['c']) → composePoses(cabinetPose, innerPose) = {x:10,z:50}. This should work correctly.

Confidence: 90 — all anchors verified against real files; only risk is the nested composedPoses path-key behavior under the recompute branch, which I traced through the real code.
-->

---

## Phases 5b & 6 — commands + FileTab + i18n + e2e (app)

> **Repo reality (verified 2026-06-11, master `a57b1f7`):** there is **no Playwright** in this repo (`grep @playwright/test` is clean; no `playwright.config.*`). The repo's "real-WASM e2e" idiom is a **real-OCCT vitest integration test** driven by `createKernelApi()` + `init()` (harness verbatim `packages/kernel/src/__tests__/api.integration.spec.ts:8-23`), and every sibling export command makes its bytes **e2e-inspectable by stashing them on `globalThis.__zilventor<X>Bytes`** (`ExportBoringDxfCommand.ts:6,20`, `ExportDrawingPdfCommand.ts:19-20`, `ExportNestPdfCommand.ts:9,17`). Phase 6 therefore = (a) a kernel-side **real-OCCT round-trip integration test** that exports a real PART and a real posed ASSEMBLY to STEP+STL and re-imports via the shipped `readStep` (`StepIO.ts:29`) + the test-only `parseBinaryStl` (§F), and (b) an **app-side jsdom command + FileTab-wiring test** proving the global-capture hook, the part/assembly branch dispatch, and `disabled` on a drawing tab. I mark the pure-UI button render/disable as **non-TDD** (visual structure) but still cover the disable predicate with a render assertion. This is the realistic substitute the brief's "Playwright e2e" maps to; flagged explicitly rather than silently inventing a Playwright harness.

> **Store/Opfs reality (verified):** the app store (`useAppStore.ts`) exposes `kernel` (a Comlink `KernelClient`, :143), `activeDocument` (:145), `activePart` (:146), `componentPoses` (:401), `subAssemblyDocs` (:316), `subAssemblyInnerPoses` (:317) — but **no `opfs` field and no `partInfoCache`**. FileTab constructs `Opfs.forNavigator()` on demand (`FileTab.tsx:144,170`) and passes a **fresh `new Map()` as the `PartInfoCache`** (`PartInfoCache = Map<string, PartInfo>`, `resolvePartInfo.ts:5`). The §G command sketch's `opfs`/`partInfoCache`/`componentPoses` ctor fields are therefore supplied by the FileTab handler, not the store.

> **Comlink note (verified):** `worker.ts` does `Comlink.expose(api, …)`, so the 4 new `KernelApi` methods are auto-exposed on the `KernelClient` proxy — **no `KernelClient`/worker edit** in this chunk.

> **Sub-assembly cache requirement (addendum §2, verdicts blocker 2):** `resolveExportLeaves` (Phase 5a) requires `subAsmCache` + `resolvePartInfo` as REQUIRED args. Both commands MUST build the sub-assembly cache adapter from the store and pass it — otherwise tsc errors out (missing required props) AND nested `.ziasm` components throw "unresolved sub-assembly leaf". The FileTab handlers build the adapter verbatim from `App.tsx:3835-3841`, plus run a cold-BFS if the store is empty.

---

### Task 1 — `ExportStepCommand` + `ExportStlCommand` (Phase 5b, app, TDD)

**Files:**
- **Create:** `packages/app/src/commands/ExportStepCommand.ts`
- **Create:** `packages/app/src/commands/ExportStlCommand.ts`
- **Create (test):** `packages/app/src/commands/__tests__/ExportStepCommand.spec.ts`
- **Create (test):** `packages/app/src/commands/__tests__/ExportStlCommand.spec.ts`
- **Reference (do not edit):** `packages/app/src/commands/ExportDrawingDxfCommand.ts:5-30` (mirror shape), `packages/app/src/commands/ExportBoringDxfCommand.ts:6,20` (global-capture idiom + jsdom URL stub), `packages/app/src/nesting/triggerDownload.ts:8` (download), `packages/app/src/assembly/resolveExportLeaves.ts` (Phase 5a — `resolveExportLeaves` + `ExportLeaf` re-export), `packages/kernel/src/api.ts` (`ExportLeaf` type, upstream chunk)

**Why a global-capture hook:** every sibling export command (`ExportBoringDxfCommand`, `ExportDrawingPdfCommand`, `ExportNestPdfCommand`) stashes its bytes on `globalThis.__zilventor<X>Bytes` so an e2e/browser run can read them back without a real OS save dialog. We mirror that so the Phase 6 app test and any future browser run can inspect the exact STEP/STL bytes.

**Sub-assembly cache contract (addendum §2):** for an assembly target, the command reads `subAssemblyDocs`/`subAssemblyInnerPoses` from the store and builds the adapter (App.tsx:3837-3841 shape). If the store is cold (export fires before the App.tsx BFS effect ran), the command runs its own BFS. It then passes `subAsmCache` + `resolvePartInfo` (from `../shell/resolvePartInfo`) into `resolveExportLeaves`, satisfying Phase 5a's required arg set and ensuring nested `.ziasm` leaves are NOT dropped.

- [ ] **Step 1: Write the RED test for `ExportStepCommand` (part branch + nested-asm integration).** Create `packages/app/src/commands/__tests__/ExportStepCommand.spec.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExportStepCommand } from '../ExportStepCommand';

// jsdom lacks URL.createObjectURL / showSaveFilePicker — stub so the download fallback is a no-op.
Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:stub'), writable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });

const STEP_BYTES = new TextEncoder().encode('ISO-10303-21;\nHEADER;\npart-step\nENDSEC;\n');

// Mock resolveExportLeaves so assembly branch doesn't need the full walker chain in unit tests.
vi.mock('../../assembly/resolveExportLeaves', () => ({
  resolveExportLeaves: vi.fn(async () => [
    { partId: 'p1', name: 'Side_A', pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
    { partId: 'p1', name: 'Side_B', pose: { translation: { x: 50, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
  ]),
}));

import { resolveExportLeaves } from '../../assembly/resolveExportLeaves';

describe('ExportStepCommand', () => {
  beforeEach(() => {
    (globalThis as { __zilventorStepBytes?: Uint8Array }).__zilventorStepBytes = undefined;
    vi.clearAllMocks();
  });

  it('part branch: calls exportStepPart(activePart.id) and stashes bytes for e2e capture', async () => {
    const exportStepPart = vi.fn(async (_id: string) => STEP_BYTES);
    const exportStepAssembly = vi.fn();
    const cmd = new ExportStepCommand({
      kernel: { exportStepPart, exportStepAssembly },
      activeDocument: { kind: 'part', document: { name: 'Bracket' } },
      activePart: { id: 'part-uuid-1' },
      opfs: { read: vi.fn(), exists: vi.fn(async () => false) },
      componentPoses: new Map(),
      partInfoCache: new Map(),
      subAssemblyDocs: {},
      subAssemblyInnerPoses: {},
    });
    await cmd.apply();
    expect(exportStepPart).toHaveBeenCalledWith('part-uuid-1');
    expect(exportStepAssembly).not.toHaveBeenCalled();
    const stashed = (globalThis as { __zilventorStepBytes?: Uint8Array }).__zilventorStepBytes;
    expect(stashed).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(stashed!)).toContain('ISO-10303-21');
  });

  it('assembly branch: builds subAsmCache from store and passes it to resolveExportLeaves', async () => {
    const exportStepAssembly = vi.fn(async () => STEP_BYTES);
    const subDoc = { name: 'Sub', components: [], colors: {} };
    const subPoses = new Map([['sub/leaf', { translation: { x: 5, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] }]]);
    const cmd = new ExportStepCommand({
      kernel: { exportStepPart: vi.fn(), exportStepAssembly, loadFromBytes: vi.fn(async () => 'p1') },
      activeDocument: { kind: 'assembly', document: { name: 'Cabinet', colors: {}, components: [] } as never },
      activePart: null,
      opfs: { read: vi.fn(async () => new Uint8Array()), exists: vi.fn(async () => false) },
      componentPoses: new Map(),
      partInfoCache: new Map(),
      subAssemblyDocs: { 'sub.ziasm': subDoc as never },
      subAssemblyInnerPoses: { 'sub.ziasm': subPoses },
    });
    await cmd.apply();
    // resolveExportLeaves was called with subAsmCache that can resolve 'sub.ziasm'
    expect(resolveExportLeaves).toHaveBeenCalledOnce();
    const callArg = (resolveExportLeaves as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.subAsmCache).toBeDefined();
    expect(callArg.subAsmCache.get('sub.ziasm')).toMatchObject({ kind: 'ok', doc: subDoc, partPath: 'sub.ziasm', innerStaticPoses: subPoses });
    expect(callArg.resolvePartInfo).toBeTypeOf('function');
  });

  it('revert is a no-op (non-undoable)', async () => {
    const cmd = new ExportStepCommand({
      kernel: { exportStepPart: vi.fn(async () => STEP_BYTES), exportStepAssembly: vi.fn() },
      activeDocument: { kind: 'part', document: { name: 'X' } },
      activePart: { id: 'p' },
      opfs: { read: vi.fn(), exists: vi.fn(async () => false) },
      componentPoses: new Map(),
      partInfoCache: new Map(),
      subAssemblyDocs: {},
      subAssemblyInnerPoses: {},
    });
    await expect(cmd.revert()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test — confirm RED for the expected reason (module missing).** From `packages/app`:
```
npx vitest run --config vitest.config.ts src/commands/__tests__/ExportStepCommand.spec.ts
```
Expected RED: `Failed to resolve import "../ExportStepCommand"` / `Cannot find module '../ExportStepCommand'` (file does not exist yet). This is the expected red — not an assertion mismatch.

- [ ] **Step 3: Write minimal `ExportStepCommand.ts` to GREEN.** Create `packages/app/src/commands/ExportStepCommand.ts` (complete, no placeholders):
```ts
import type { AssemblyDocument } from '@zilventor/shared';
import type { ExportLeaf } from '@zilventor/kernel/src/api';
import { triggerDownload } from '../nesting/triggerDownload';
import { resolveExportLeaves } from '../assembly/resolveExportLeaves';
import { resolvePartInfo, type PartInfoCache } from '../shell/resolvePartInfo';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { computeInnerStaticPoses } from '../assembly/computeInnerStaticPoses';

declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var __zilventorStepBytes: Uint8Array | undefined;
}

type ActiveDoc =
  | { kind: 'part'; document: { name: string } }
  | { kind: 'assembly'; document: AssemblyDocument }
  | { kind: 'drawing'; document: { name: string } };

type Pose = { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] };

export class ExportStepCommand {
  readonly name = 'ExportStep';

  constructor(
    private readonly opts: {
      kernel: {
        loadFromBytes?(b: Uint8Array): Promise<string>;
        exportStepPart(id: string): Promise<Uint8Array>;
        exportStepAssembly(leaves: readonly ExportLeaf[], opts?: { name?: string }): Promise<Uint8Array>;
      };
      activeDocument: ActiveDoc;
      activePart: { id: string } | null;
      opfs: { read(p: string): Promise<Uint8Array>; exists(p: string): Promise<boolean> };
      componentPoses: Map<string, Pose>;
      partInfoCache: PartInfoCache;
      subAssemblyDocs: Record<string, AssemblyDocument>;
      subAssemblyInnerPoses: Record<string, Map<string, Pose>>;
    },
  ) {}

  async apply(): Promise<void> {
    const { activeDocument, activePart, kernel } = this.opts;
    let bytes: Uint8Array;
    if (activeDocument.kind === 'part' && activePart) {
      bytes = await kernel.exportStepPart(activePart.id);
    } else if (activeDocument.kind === 'assembly') {
      const subAsmCache = await this._buildSubAsmCache();
      const leaves = await resolveExportLeaves({
        assembly: activeDocument.document,
        kernel: kernel as { loadFromBytes(b: Uint8Array): Promise<string> },
        opfs: this.opts.opfs,
        componentPoses: this.opts.componentPoses,
        partInfoCache: this.opts.partInfoCache,
        subAsmCache,
        resolvePartInfo: (opfs, partPath, cache) => resolvePartInfo(opfs as unknown as import("@zilventor/kernel/src/storage/Opfs").Opfs, partPath, cache),
      });
      bytes = await kernel.exportStepAssembly(leaves, { name: activeDocument.document.name });
    } else {
      throw new Error('ExportStep: no exportable document');
    }
    globalThis.__zilventorStepBytes = bytes;
    await triggerDownload(new Blob([bytes as BlobPart], { type: 'application/step' }), {
      suggestedName: `${activeDocument.document.name}.step`,
      mimeType: 'application/step',
      extension: 'step',
      description: 'STEP file',
    });
  }

  /**
   * Build the sub-assembly cache adapter verbatim from App.tsx:3835-3841.
   * If the store is cold (export fires before the App BFS effect ran), run a
   * BFS ourselves mirroring App.tsx:3182-3208 so nested .ziasm leaves are
   * not dropped (addendum §2, verifier blocker 2).
   */
  private async _buildSubAsmCache() {
    let docs = { ...this.opts.subAssemblyDocs };
    const innerPoses = { ...this.opts.subAssemblyInnerPoses };

    // If the store is cold, run a BFS to warm docs + compute inner poses.
    if (Object.keys(docs).length === 0 && this.opts.activeDocument.kind === 'assembly') {
      const opfs = this.opts.opfs;
      const stack: AssemblyDocument[] = [this.opts.activeDocument.document];
      const seen = new Set<string>();
      while (stack.length) {
        const d = stack.pop()!;
        for (const c of d.components) {
          if (!c.partPath.endsWith('.ziasm')) continue;
          if (seen.has(c.partPath)) continue;
          seen.add(c.partPath);
          if (docs[c.partPath]) { stack.push(docs[c.partPath]!); continue; }
          try {
            if (await opfs.exists(c.partPath)) {
              const sub = await unpackAssembly(await opfs.read(c.partPath));
              docs[c.partPath] = sub;
              innerPoses[c.partPath] = computeInnerStaticPoses(sub);
              stack.push(sub);
            }
          } catch { /* skip corrupt */ }
        }
      }
    } else {
      // Compute innerStaticPoses for any entry missing it (e.g. store had docs but not poses).
      for (const [p, d] of Object.entries(docs)) {
        if (!innerPoses[p]) {
          innerPoses[p] = computeInnerStaticPoses(d);
        }
      }
    }

    return {
      get: (p: string) => docs[p]
        ? ({
            kind: 'ok' as const,
            doc: docs[p]!,
            partPath: p,
            ...(innerPoses[p] ? { innerStaticPoses: innerPoses[p] } : {}),
          })
        : undefined,
    };
  }

  async revert(): Promise<void> { /* non-undoable */ }
}
```

- [ ] **Step 4: Run the test — confirm GREEN.** From `packages/app`:
```
npx vitest run --config vitest.config.ts src/commands/__tests__/ExportStepCommand.spec.ts
```
Expected GREEN: `3 passed`. (All `it` blocks pass; part branch stashes bytes; assembly branch passes subAsmCache with innerStaticPoses; revert resolves to `undefined`.)

- [ ] **Step 5: Write the RED test for `ExportStlCommand` (mirrors STEP, asserts assembly branch + subAsmCache).** Create `packages/app/src/commands/__tests__/ExportStlCommand.spec.ts`. Note the assembly branch needs `resolveExportLeaves` mocked — `vi.mock` it so we don't pull the real walker chain:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:stub'), writable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });

vi.mock('../../assembly/resolveExportLeaves', () => ({
  resolveExportLeaves: vi.fn(async () => [
    { partId: 'p1', name: 'Side', pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
    { partId: 'p1', name: 'Side', pose: { translation: { x: 100, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
  ]),
}));

import { ExportStlCommand } from '../ExportStlCommand';
import { resolveExportLeaves } from '../../assembly/resolveExportLeaves';

const STL_BYTES = new Uint8Array(84); // 80 header + 4-byte triCount=0; content irrelevant here

describe('ExportStlCommand', () => {
  beforeEach(() => {
    (globalThis as { __zilventorStlBytes?: Uint8Array }).__zilventorStlBytes = undefined;
    vi.clearAllMocks();
  });

  it('assembly branch: resolves leaves then calls exportStlAssembly with them', async () => {
    const exportStlAssembly = vi.fn(async () => STL_BYTES);
    const subDoc = { name: 'Sub', components: [], colors: {} };
    const subPoses = new Map([['sub/leaf', { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] }]]);
    const cmd = new ExportStlCommand({
      kernel: { exportStlPart: vi.fn(), exportStlAssembly, loadFromBytes: vi.fn(async () => 'p1') },
      activeDocument: { kind: 'assembly', document: { name: 'Cabinet', colors: {}, components: [] } as never },
      activePart: null,
      opfs: { read: vi.fn(async () => new Uint8Array()), exists: vi.fn(async () => false) },
      componentPoses: new Map(),
      partInfoCache: new Map(),
      subAssemblyDocs: { 'sub.ziasm': subDoc as never },
      subAssemblyInnerPoses: { 'sub.ziasm': subPoses },
    });
    await cmd.apply();
    expect(resolveExportLeaves).toHaveBeenCalledOnce();
    // Verify subAsmCache was passed with innerStaticPoses
    const callArg = (resolveExportLeaves as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.subAsmCache.get('sub.ziasm')).toMatchObject({ kind: 'ok', innerStaticPoses: subPoses });
    const [leaves, opts] = exportStlAssembly.mock.calls[0];
    expect(leaves).toHaveLength(2);
    expect(opts).toMatchObject({ binary: true });
    const stashed = (globalThis as { __zilventorStlBytes?: Uint8Array }).__zilventorStlBytes;
    expect(stashed).toBeInstanceOf(Uint8Array);
  });

  it('part branch: calls exportStlPart(activePart.id, { binary: true })', async () => {
    const exportStlPart = vi.fn(async () => STL_BYTES);
    const cmd = new ExportStlCommand({
      kernel: { exportStlPart, exportStlAssembly: vi.fn(), loadFromBytes: vi.fn() },
      activeDocument: { kind: 'part', document: { name: 'Bracket' } },
      activePart: { id: 'part-uuid-2' },
      opfs: { read: vi.fn(), exists: vi.fn(async () => false) },
      componentPoses: new Map(),
      partInfoCache: new Map(),
      subAssemblyDocs: {},
      subAssemblyInnerPoses: {},
    });
    await cmd.apply();
    expect(exportStlPart).toHaveBeenCalledWith('part-uuid-2', { binary: true });
  });
});
```

- [ ] **Step 6: Run — confirm RED (module missing).** From `packages/app`:
```
npx vitest run --config vitest.config.ts src/commands/__tests__/ExportStlCommand.spec.ts
```
Expected RED: `Cannot find module '../ExportStlCommand'`.

- [ ] **Step 7: Write `ExportStlCommand.ts` to GREEN.** Create `packages/app/src/commands/ExportStlCommand.ts` — identical structure to `ExportStepCommand` with STL signatures (`exportStlPart`/`exportStlAssembly`), `.stl` / `model/stl`, and `__zilventorStlBytes`:
```ts
import type { AssemblyDocument } from '@zilventor/shared';
import type { ExportLeaf } from '@zilventor/kernel/src/api';
import { triggerDownload } from '../nesting/triggerDownload';
import { resolveExportLeaves } from '../assembly/resolveExportLeaves';
import { resolvePartInfo, type PartInfoCache } from '../shell/resolvePartInfo';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { computeInnerStaticPoses } from '../assembly/computeInnerStaticPoses';

declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var __zilventorStlBytes: Uint8Array | undefined;
}

type ActiveDoc =
  | { kind: 'part'; document: { name: string } }
  | { kind: 'assembly'; document: AssemblyDocument }
  | { kind: 'drawing'; document: { name: string } };

type Pose = { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] };

export class ExportStlCommand {
  readonly name = 'ExportStl';

  constructor(
    private readonly opts: {
      kernel: {
        loadFromBytes?(b: Uint8Array): Promise<string>;
        exportStlPart(id: string, o?: { binary?: boolean }): Promise<Uint8Array>;
        exportStlAssembly(leaves: readonly ExportLeaf[], o?: { binary?: boolean }): Promise<Uint8Array>;
      };
      activeDocument: ActiveDoc;
      activePart: { id: string } | null;
      opfs: { read(p: string): Promise<Uint8Array>; exists(p: string): Promise<boolean> };
      componentPoses: Map<string, Pose>;
      partInfoCache: PartInfoCache;
      subAssemblyDocs: Record<string, AssemblyDocument>;
      subAssemblyInnerPoses: Record<string, Map<string, Pose>>;
    },
  ) {}

  async apply(): Promise<void> {
    const { activeDocument, activePart, kernel } = this.opts;
    let bytes: Uint8Array;
    if (activeDocument.kind === 'part' && activePart) {
      bytes = await kernel.exportStlPart(activePart.id, { binary: true });
    } else if (activeDocument.kind === 'assembly') {
      const subAsmCache = await this._buildSubAsmCache();
      const leaves = await resolveExportLeaves({
        assembly: activeDocument.document,
        kernel: kernel as { loadFromBytes(b: Uint8Array): Promise<string> },
        opfs: this.opts.opfs,
        componentPoses: this.opts.componentPoses,
        partInfoCache: this.opts.partInfoCache,
        subAsmCache,
        resolvePartInfo: (opfs, partPath, cache) => resolvePartInfo(opfs as unknown as import("@zilventor/kernel/src/storage/Opfs").Opfs, partPath, cache),
      });
      bytes = await kernel.exportStlAssembly(leaves, { binary: true });
    } else {
      throw new Error('ExportStl: no exportable document');
    }
    globalThis.__zilventorStlBytes = bytes;
    await triggerDownload(new Blob([bytes as BlobPart], { type: 'model/stl' }), {
      suggestedName: `${activeDocument.document.name}.stl`,
      mimeType: 'model/stl',
      extension: 'stl',
      description: 'STL file',
    });
  }

  /**
   * Build the sub-assembly cache adapter verbatim from App.tsx:3835-3841.
   * If the store is cold, run a BFS mirroring App.tsx:3182-3208 (addendum §2).
   */
  private async _buildSubAsmCache() {
    let docs = { ...this.opts.subAssemblyDocs };
    const innerPoses = { ...this.opts.subAssemblyInnerPoses };

    if (Object.keys(docs).length === 0 && this.opts.activeDocument.kind === 'assembly') {
      const opfs = this.opts.opfs;
      const stack: AssemblyDocument[] = [this.opts.activeDocument.document];
      const seen = new Set<string>();
      while (stack.length) {
        const d = stack.pop()!;
        for (const c of d.components) {
          if (!c.partPath.endsWith('.ziasm')) continue;
          if (seen.has(c.partPath)) continue;
          seen.add(c.partPath);
          if (docs[c.partPath]) { stack.push(docs[c.partPath]!); continue; }
          try {
            if (await opfs.exists(c.partPath)) {
              const sub = await unpackAssembly(await opfs.read(c.partPath));
              docs[c.partPath] = sub;
              innerPoses[c.partPath] = computeInnerStaticPoses(sub);
              stack.push(sub);
            }
          } catch { /* skip corrupt */ }
        }
      }
    } else {
      for (const [p, d] of Object.entries(docs)) {
        if (!innerPoses[p]) {
          innerPoses[p] = computeInnerStaticPoses(d);
        }
      }
    }

    return {
      get: (p: string) => docs[p]
        ? ({
            kind: 'ok' as const,
            doc: docs[p]!,
            partPath: p,
            ...(innerPoses[p] ? { innerStaticPoses: innerPoses[p] } : {}),
          })
        : undefined,
    };
  }

  async revert(): Promise<void> { /* non-undoable */ }
}
```

- [ ] **Step 8: Run both command tests + tsc — confirm GREEN.** From `packages/app`:
```
npx vitest run --config vitest.config.ts src/commands/__tests__/ExportStepCommand.spec.ts src/commands/__tests__/ExportStlCommand.spec.ts
npx tsc --noEmit -p packages/app/tsconfig.json 2>&1 | grep -E 'ExportStepCommand|ExportStlCommand' || echo "no new tsc errors in export commands"
```
Expected: vitest `5 passed` (3 ExportStep + 2 ExportStl). tsc grep prints `no new tsc errors in export commands` (must add **zero** new errors among the ~16 baseline files).

- [ ] **Step 9: Commit.** From repo root:
```
git add packages/app/src/commands/ExportStepCommand.ts packages/app/src/commands/ExportStlCommand.ts packages/app/src/commands/__tests__/ExportStepCommand.spec.ts packages/app/src/commands/__tests__/ExportStlCommand.spec.ts
git commit -m "$(cat <<'EOF'
feat(export): ExportStep/ExportStl commands (part + assembly branches, sub-asm cache, e2e-capture hook)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2 — FileTab wiring + i18n keys (Phase 5b, app; UI render = non-TDD, dispatch = TDD)

**Files:**
- **Modify:** `packages/app/src/shell/tabs/FileTab.tsx` (add 2 handlers after `handleExportImage` :39; add 2 buttons after the Export-Image button :278, `disabled={!activeDoc || activeDoc.kind === 'drawing'}` mirroring :274)
- **Modify:** `packages/app/src/i18n/locales/en.json` (`menu.file` block :593-602)
- **Modify:** `packages/app/src/i18n/locales/uk.json` (`menu.file` block — confirmed parallel block exists)
- **Create (test):** `packages/app/src/shell/tabs/__tests__/FileTab.export.spec.tsx`
- **Reference:** `packages/app/src/i18n/parity.test.ts:16-30` (parity gate), `packages/app/src/store/useAppStore.ts` (`kernel`, `activeDocument`, `activePart`, `componentPoses`, `subAssemblyDocs`, `subAssemblyInnerPoses`)

> **TDD split:** the **i18n keys** are gated by `parity.test.ts` (real failing test) → TDD. The **button render + `disabled` predicate** is a pure-UI structural change → **non-TDD per §4a (pure-visual)**, but I still pin it with one render assertion (the disable predicate is logic, not pixels). The **handler dispatch** (which kernel method fires per doc kind) is logic → TDD via a render+click test.

> **Sub-assembly cache in FileTab (addendum §2):** the handlers read `subAssemblyDocs`/`subAssemblyInnerPoses` from the store and pass them to the commands, which build the adapter internally. The store already has these fields (`useAppStore.ts:316-317`).

- [ ] **Step 1: Write the RED i18n parity expectation.** The parity test (`parity.test.ts:16-22`) goes RED the moment `en.json` has a key absent from `uk.json` (or vice-versa). To drive red-first, add the keys to **en.json only** in this step. Edit `packages/app/src/i18n/locales/en.json` `menu.file` block — insert alphabetically (parity sorts keys, so position is cosmetic; alphabetical keeps the diff clean):
```json
    "file": {
      "exportImage": "Export Image",
      "exportStep": "Export STEP",
      "exportStl": "Export STL",
      "importFromInventor": "Import from Inventor",
      "newAssembly": "New Assembly",
      "newPart": "New Part",
      "open": "Open…",
      "save": "Save",
      "saveAs": "Save As…",
      "transparent": "Transparent"
    }
```

- [ ] **Step 2: Run parity — confirm RED.** From `packages/app`:
```
npx vitest run --config vitest.config.ts src/i18n/parity.test.ts
```
Expected RED: the `identical key sets` test fails with `missingInUk: ['menu.file.exportStep', 'menu.file.exportStl']` (en has them, uk doesn't). This is the expected red.

- [ ] **Step 3: Add the uk keys to GREEN.** Edit `packages/app/src/i18n/locales/uk.json` `menu.file` block, alphabetical insert (Ukrainian values per Contract §G):
```json
    "file": {
      "exportImage": "Експорт зображення",
      "exportStep": "Експорт STEP",
      "exportStl": "Експорт STL",
      "importFromInventor": "Імпорт з Inventor",
      "newAssembly": "Нова збірка",
      "newPart": "Нова деталь",
      "open": "Відкрити…",
      "save": "Зберегти",
      "saveAs": "Зберегти як…",
      "transparent": "Прозорий"
    }
```

- [ ] **Step 4: Run parity — confirm GREEN.** From `packages/app`:
```
npx vitest run --config vitest.config.ts src/i18n/parity.test.ts
```
Expected GREEN: `2 passed` (`identical key sets` + `no Ukrainian value is empty` — both new uk values are non-empty).

- [ ] **Step 5: Write the RED FileTab dispatch+disable test.** Create `packages/app/src/shell/tabs/__tests__/FileTab.export.spec.tsx`. It renders `FileTab`, seeds the store with a part doc, clicks "Export STEP", and asserts `kernel.exportStepPart` fired; then re-renders with a drawing doc and asserts both buttons are `disabled`. Mock `triggerDownload` and `Opfs.forNavigator` so no real download / OPFS runs:
```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '../../../i18n'; // init i18next (test-setup also does, but explicit is safe)
import { useAppStore } from '../../../store/useAppStore';

vi.mock('../../../nesting/triggerDownload', () => ({ triggerDownload: vi.fn(async () => {}) }));
vi.mock('@zilventor/kernel/src/storage/Opfs', () => ({
  Opfs: { forNavigator: vi.fn(async () => ({ read: vi.fn(), exists: vi.fn(async () => false) })) },
}));

import FileTab from '../FileTab';

const exportStepPart = vi.fn(async () => new TextEncoder().encode('ISO-10303-21;'));
const exportStlPart = vi.fn(async () => new Uint8Array(84));

function seedPart() {
  useAppStore.setState({
    kernel: {
      exportStepPart,
      exportStlPart,
      exportStepAssembly: vi.fn(),
      exportStlAssembly: vi.fn(),
      loadFromBytes: vi.fn(),
    } as never,
    activeDocument: { kind: 'part', document: { name: 'Bracket' } } as never,
    activePart: { id: 'part-uuid-9', name: 'Bracket' } as never,
    componentPoses: new Map(),
    subAssemblyDocs: {},
    subAssemblyInnerPoses: {},
  });
}
function seedDrawing() {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: { name: 'Sheet' } } as never,
    activePart: null,
  });
}

describe('FileTab — STEP/STL export', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('clicking "Export STEP" with a part active calls exportStepPart', async () => {
    seedPart();
    render(<FileTab />);
    fireEvent.click(screen.getByText('Export STEP'));
    await waitFor(() => expect(exportStepPart).toHaveBeenCalledWith('part-uuid-9'));
  });

  it('clicking "Export STL" with a part active calls exportStlPart', async () => {
    seedPart();
    render(<FileTab />);
    fireEvent.click(screen.getByText('Export STL'));
    await waitFor(() => expect(exportStlPart).toHaveBeenCalledWith('part-uuid-9', expect.objectContaining({ binary: true })));
  });

  it('Export STEP and Export STL buttons are disabled on a drawing tab', () => {
    seedDrawing();
    render(<FileTab />);
    expect(screen.getByText('Export STEP').closest('button')).toBeDisabled();
    expect(screen.getByText('Export STL').closest('button')).toBeDisabled();
  });
});
```

- [ ] **Step 6: Run — confirm RED.** From `packages/app`:
```
npx vitest run --config vitest.config.ts src/shell/tabs/__tests__/FileTab.export.spec.tsx
```
Expected RED: `Unable to find an element with the text: Export STEP` (the buttons + handlers don't exist in `FileTab.tsx` yet). This is the expected red — the i18n keys resolve, but no element renders them.

- [ ] **Step 7: Add the two handlers to `FileTab.tsx` to GREEN.** Insert after `handleExportImage` (after the closing `};` of `handleExportImage` at line 39), modeled on `handleExportImage`. Read `subAssemblyDocs`/`subAssemblyInnerPoses` from the store and pass them to the commands:
```tsx
  const handleExportStep = async () => {
    const { kernel, activeDocument, activePart, componentPoses, subAssemblyDocs, subAssemblyInnerPoses } = useAppStore.getState();
    if (!kernel || !activeDocument || activeDocument.kind === 'drawing') return;
    try {
      const { ExportStepCommand } = await import('../../commands/ExportStepCommand');
      const opfs = await Opfs.forNavigator();
      await new ExportStepCommand({
        kernel, activeDocument, activePart, opfs, componentPoses, partInfoCache: new Map(),
        subAssemblyDocs, subAssemblyInnerPoses,
      }).apply();
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setErrorDialog(`Export failed: ${(e as Error).message}`);
    }
  };

  const handleExportStl = async () => {
    const { kernel, activeDocument, activePart, componentPoses, subAssemblyDocs, subAssemblyInnerPoses } = useAppStore.getState();
    if (!kernel || !activeDocument || activeDocument.kind === 'drawing') return;
    try {
      const { ExportStlCommand } = await import('../../commands/ExportStlCommand');
      const opfs = await Opfs.forNavigator();
      await new ExportStlCommand({
        kernel, activeDocument, activePart, opfs, componentPoses, partInfoCache: new Map(),
        subAssemblyDocs, subAssemblyInnerPoses,
      }).apply();
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setErrorDialog(`Export failed: ${(e as Error).message}`);
    }
  };
```
> `Opfs` is already imported at `FileTab.tsx:13`. `componentPoses`, `subAssemblyDocs`, and `subAssemblyInnerPoses` are all on the store (`useAppStore.ts:316-317,401`). The dynamic `import('../../commands/ExportStepCommand')` mirrors how FileTab lazy-loads `ImportStepAsComponentCommand` (:142,168) and keeps the export-command + resolver chain out of the FileTab initial bundle.

- [ ] **Step 8: Add the two buttons to `FileTab.tsx` to GREEN.** Insert directly after the Export-Image button block (after the `</button>` closing the Export-Image button at line 278), mirroring its className + disable predicate (:273-274):
```tsx
      <button
        className="hover:text-white disabled:text-neutral-500"
        disabled={!activeDoc || activeDoc.kind === 'drawing'}
        onClick={handleExportStep}
      >
        {t('menu.file.exportStep')}
      </button>
      <button
        className="hover:text-white disabled:text-neutral-500"
        disabled={!activeDoc || activeDoc.kind === 'drawing'}
        onClick={handleExportStl}
      >
        {t('menu.file.exportStl')}
      </button>
```

- [ ] **Step 9: Run the FileTab test + parity + tsc — confirm GREEN.** From `packages/app`:
```
npx vitest run --config vitest.config.ts src/shell/tabs/__tests__/FileTab.export.spec.tsx src/i18n/parity.test.ts
npx tsc --noEmit -p packages/app/tsconfig.json 2>&1 | grep -E 'FileTab|en\.json|uk\.json' || echo "no new tsc errors in FileTab/i18n"
```
Expected: vitest `5 passed` (3 FileTab + 2 parity). tsc grep prints `no new tsc errors in FileTab/i18n`.

- [ ] **Step 10: Commit.** From repo root:
```
git add packages/app/src/shell/tabs/FileTab.tsx packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/uk.json packages/app/src/shell/tabs/__tests__/FileTab.export.spec.tsx
git commit -m "$(cat <<'EOF'
feat(export): FileTab STEP/STL buttons + handlers + en/uk i18n keys (drawing-disabled, sub-asm cache)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3 — Real-OCCT round-trip integration test (Phase 6 "e2e", kernel; TDD)

> **Substitution flagged (verified):** the brief says "real-WASM Playwright e2e" but **this repo has no Playwright**. The repo's real-WASM e2e idiom is a **kernel integration test driven by `createKernelApi()` + real OCCT** + the shipped `readStep` (`StepIO.ts:29`) and the test-only `parseBinaryStl` (Contract §F). This is the strongest end-to-end proof available without inventing a browser harness. The app-side click→dispatch path is already covered by Task 2's FileTab test (`globalThis.__zilventor*Bytes` is the e2e-capture hook a future browser run would read). **If a Playwright harness is later stood up, this test's assertions port directly to a `page.evaluate(() => window.__zilventorStepBytes)` readback.**

> **DISTINCT FILE (addendum §3):** this task creates `packages/kernel/src/__tests__/api.export.e2e.integration.spec.ts` — NOT `api.export.integration.spec.ts` (which the kernel-step chunk owns for cold-cache + color-loss-trap guards). These are two separate files with non-overlapping test cases and non-overlapping `makeBoxPart` definitions.

**Files:**
- **Create (test):** `packages/kernel/src/__tests__/api.export.e2e.integration.spec.ts` (DISTINCT from the kernel-step chunk's `api.export.integration.spec.ts`)
- **Reference (must exist from upstream chunks before this runs):** the 4 kernel methods `exportStepPart`/`exportStlPart`/`exportStepAssembly`/`exportStlAssembly` (`api.ts`), `readStep` (`StepIO.ts:29`), `parseBinaryStl` (`occt/__tests__/binaryStlParser.ts`, Contract §F)
- **Reference:** `packages/kernel/src/occt/StepIO.ts:29` (`readStep(oc, bytes)` → `{ shape, faceCount, solidCount, boundingBox, solidColors }`)

> **OCCT loader (addendum §4):** `occtLoader.ts:18` exports `loadOcct` (NOT `getOcct`). Use `import { loadOcct } from '../occt/occtLoader'` and `await loadOcct()`.

> **Dependency gate (state explicitly to the executor):** this task can only go GREEN **after** the kernel-side chunks land `exportStepPart`/`exportStlPart`/`exportStepAssembly`/`exportStlAssembly` and `parseBinaryStl`. When executing the full plan in order, run Task 3 **last**. Its red-first step still demonstrates the expected red (methods/parser undefined) so the TDD shape holds.

- [ ] **Step 1: Write the RED real-OCCT round-trip test.** Create `packages/kernel/src/__tests__/api.export.e2e.integration.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createKernelApi } from '../api';
import { loadOcct } from '../occt/occtLoader';        // confirmed: occtLoader.ts:18 exports loadOcct
import { readStep } from '../occt/StepIO';
import { parseBinaryStl } from '../occt/__tests__/binaryStlParser';

/**
 * Build a real `w × d × h` mm box part and return its registered kernel partId.
 * This makeBoxPart is local to this e2e file; the kernel-step chunk's
 * api.export.integration.spec.ts has its own independent makeBoxPart.
 */
async function makeBoxPart(
  api: ReturnType<typeof createKernelApi>,
  name: string,
  w: number,
  d: number,
  h: number,
): Promise<string> {
  const id = await api.createPart(name);
  await api.setParameter(id, { name: 'h1', expression: String(h), value: h, unit: 'mm' });
  await api.addFeature(id, {
    kind: 'sketch',
    id: 's1',
    plane: { source: 'workPlane', featureId: 'origin.XY' },
    primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w, h: d }],
    constraints: [],
  });
  await api.addFeature(id, {
    kind: 'extrude',
    id: 'e1',
    sketchRef: 's1',
    distanceParam: 'h1',
    direction: 'forward',
    operation: 'new',
  });
  const res = await api.execute(id);
  expect(res.ok).toBe(true);
  return id;
}

describe('KernelApi 3D export — real OCCT e2e round-trip', () => {
  it('exportStepPart → readStep recovers a 10mm box with mm units', async () => {
    const api = createKernelApi();
    await api.init();
    const id = await makeBoxPart(api, 'Cube', 10, 10, 10);
    const bytes = await api.exportStepPart(id);

    expect(new TextDecoder().decode(bytes.slice(0, 13))).toBe('ISO-10303-21;');

    const oc = await loadOcct();
    const r = readStep(oc, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(r.solidCount).toBe(1);                        // cold-cache guard: empty export would be 0
    const [minX, minY, minZ, maxX, maxY, maxZ] = r.boundingBox;
    expect(maxX - minX).toBeCloseTo(10, 3);             // mm proof — strict
    expect(maxY - minY).toBeCloseTo(10, 3);
    expect(maxZ - minZ).toBeCloseTo(10, 3);
  }, 120_000);

  it('exportStlPart → parseBinaryStl recovers a 10mm box (triCount multiple-of-2 ≥ 12, mm span)', async () => {
    const api = createKernelApi();
    await api.init();
    const id = await makeBoxPart(api, 'Cube2', 10, 10, 10);
    const bytes = await api.exportStlPart(id, { binary: true });
    const { triCount, bbox } = parseBinaryStl(bytes);
    // OCCT may split faces; do not assert exactly 12. Assert even and >= 12 (addendum §5).
    expect(triCount % 2).toBe(0);
    expect(triCount).toBeGreaterThanOrEqual(12);
    expect(bbox[3] - bbox[0]).toBeCloseTo(10, 3);       // mm span, strict (the real unit proof)
    expect(bbox[5] - bbox[2]).toBeCloseTo(10, 3);
  }, 120_000);

  it('exportStepAssembly preserves 2 posed components with 2 DIFFERENT colors (color-loss trap)', async () => {
    const api = createKernelApi();
    await api.init();
    const partId = await makeBoxPart(api, 'Side', 10, 10, 10); // one prototype, two instances
    const leaves = [
      {
        partId,
        name: 'Side_A',
        pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const },
        color: [1, 0, 0] as const,
      },
      {
        partId,
        name: 'Side_B',
        pose: { translation: { x: 50, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const },
        color: [0, 0, 1] as const,
      },
    ];
    const bytes = await api.exportStepAssembly(leaves, { name: 'Pair' });
    expect(new TextDecoder().decode(bytes.slice(0, 13))).toBe('ISO-10303-21;');
    const txt = new TextDecoder().decode(bytes);
    expect(txt).toContain('Side_A');                    // component names survive (NameMode)
    expect(txt).toContain('Side_B');

    const oc = await loadOcct();
    const r = readStep(oc, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(r.solidCount).toBe(2);                       // BOTH instances present (assert FIRST per §C)
    const colors = r.solidColors.filter((c): c is string => !!c).map((c) => c.toLowerCase());
    expect(new Set(colors).size).toBe(2);               // TWO DISTINCT colors survived (the trap's signature)
    expect(colors).toContain('#ff0000');
    expect(colors).toContain('#0000ff');
    // Posed bbox: second instance shifted +50mm → overall span 50+10 = 60mm in X
    const [minX, , , maxX] = r.boundingBox;
    expect(maxX - minX).toBeCloseTo(60, 3);
  }, 120_000);
});
```

- [ ] **Step 2: Verify the OCCT loader + readStep arg shape against real code, then run RED.** The loader export is confirmed as `loadOcct` (`occtLoader.ts:18`). Also verify `readStep`'s expected arg type:
```
grep -n "export.*readStep\|readStep.*ArrayBuffer\|readStep.*Uint8Array" packages/kernel/src/occt/StepIO.ts | head -5
```
The contract states `readStep(oc, stepBytes: ArrayBuffer)` → `StepReadResult`; the `.buffer.slice(...)` call above produces an `ArrayBuffer`. Then run from `packages/kernel`:
```
npx vitest run --config vitest.integration.config.ts src/__tests__/api.export.e2e.integration.spec.ts
```
Expected RED **before** the kernel-export chunks land: `api.exportStepPart is not a function` / `Cannot find module '../occt/__tests__/binaryStlParser'`. This is the expected red (missing upstream impl), demonstrating the TDD shape.

- [ ] **Step 3: GREEN gate — run after the kernel-export chunks (Phases 1–4) + `binaryStlParser` are merged.** No new code in *this* task; the kernel chunks supply the impl. Re-run from `packages/kernel`:
```
npx vitest run --config vitest.integration.config.ts src/__tests__/api.export.e2e.integration.spec.ts
```
Expected GREEN: `3 passed`. Specifically:
- STEP part: header `ISO-10303-21;`, `solidCount === 1`, X/Y/Z spans `toBeCloseTo(10, 3)`.
- STL part: `triCount % 2 === 0 && triCount >= 12` (addendum §5 — OCCT may split faces), X/Z spans `toBeCloseTo(10, 3)`.
- STEP assembly: header present, both `Side_A`/`Side_B` substrings present, `solidCount === 2`, **2 distinct colors** including `#ff0000` + `#0000ff`, posed X-span `toBeCloseTo(60, 3)`.

If the color test fails with only ONE color present, that is the **§6 color-loss trap** (pose baked into the shape instead of the `TopLoc_Location`, or sRGB/RGB mismatch) — file a `superpowers:systematic-debugging` against the kernel `StepExport.ts` chunk; do **not** weaken the assertion to `>= 1`.

- [ ] **Step 4: Final tsc on both touched packages — confirm no NEW baseline errors.** From repo root:
```
npx tsc --noEmit -p packages/app/tsconfig.json 2>&1 | grep -cE 'error TS' ; echo "(compare to the ~16-file baseline; export/i18n/FileTab files must contribute 0)"
npx tsc --noEmit -p packages/kernel/tsconfig.json 2>&1 | grep -E 'api.export.e2e.integration' || echo "no new tsc errors in e2e export test"
```
Expected: the e2e export test contributes no `error TS`; the app error count is unchanged from baseline for the files this chunk touched (`ExportStepCommand.ts`, `ExportStlCommand.ts`, `FileTab.tsx`, `en.json`, `uk.json`, the 4 new specs).

- [ ] **Step 5: Commit.** From repo root:
```
git add packages/kernel/src/__tests__/api.export.e2e.integration.spec.ts
git commit -m "$(cat <<'EOF'
test(export): real-OCCT e2e round-trip — STEP/STL part + posed 2-color assembly (distinct from kernel-step integration spec)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

<!-- selfcritique: All three verifier blockers addressed: (1) Both commands now build _buildSubAsmCache() reproducing App.tsx:3835-3841 adapter + cold-BFS (mirrors App.tsx:3182-3208) and pass subAsmCache+resolvePartInfo into resolveExportLeaves — satisfying Phase 5a's required arg set. (2) Phase 6 e2e test uses DISTINCT file api.export.e2e.integration.spec.ts with its own makeBoxPart — no duplicate-path conflict. (3) `loadOcct` not `getOcct` confirmed against occtLoader.ts:18. Minor fixes: triCount asserts `% 2 === 0 && >= 12` not strict 12; command tests now assert subAsmCache.get() returns correct shape with innerStaticPoses. STL kernel wiring noted as blocker owned by kernel chunk (§addendum 1) — this chunk correctly calls kernel.exportStlPart/exportStlAssembly which the kernel chunk must wire. The _buildSubAsmCache private method is duplicated across ExportStep/ExportStl — DRY refactor is a follow-up; correctness first. Confidence: 88 — all addendum items addressed; remaining risk is that resolveExportLeaves Phase 5a signature may differ from what I modeled (it's not yet created), but the addendum is prescriptive about the required arg list. -->
