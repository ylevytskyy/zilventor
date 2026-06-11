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
 * prototype handle (from namedShapeCache). `protoKey` is available for external
 * logic but the XCAF writer uses a flat AddShape per leaf (copy=true transform),
 * which is the correct approach for STEP color-round-trip compatibility with the
 * shipped readStep (label-level flat extraction). See design note below.
 */
export type KernelExportLeaf = {
  shape: OcctShape;
  protoKey: string;
  name: string;
  pose: ExportPose;
  color?: readonly [number, number, number];
};

/**
 * Quaternion [x,y,z,w] + translation → a gp_Trsf.
 * Math is identical to TransformOps.transformShapeByPose:49-67.
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
  const trsf = new (oc as { gp_Trsf_1: new () => { SetValues: (...a: number[]) => void } }).gp_Trsf_1();
  trsf.SetValues(r00, r01, r02, tx, r10, r11, r12, ty, r20, r21, r22, tz);
  return trsf;
}

/**
 * Check if a pose is identity (no rotation, no translation).
 */
function isIdentityPose(pose: ExportPose): boolean {
  const { x, y, z } = pose.translation;
  const [qx, qy, qz, qw] = pose.quaternion;
  return x === 0 && y === 0 && z === 0 && qx === 0 && qy === 0 && qz === 0 && qw === 1;
}

/**
 * Build a XCAF document from `leaves` and write it to STEP bytes via
 * STEPCAFControl_Writer.
 *
 * **Design note — FLAT (not assembly) approach:**
 * For each leaf, this creates a DEEP-COPY transformed shape (BRepBuilderAPI_Transform_2
 * with copy=true) positioned at the world pose, then calls AddShape for each resulting
 * shape. A deep-copy transform produces a shape with NO TopoDS location wrapper (all
 * vertex coordinates are at the absolute world position), so XCAF treats each as a
 * standalone shape — the color on its label is preserved in the STEP file and can be
 * read back by the shipped readStep's label-level GetColor_4 lookup.
 *
 * The assembly XCAF approach (NewShape + AddComponent_1) requires readStep to traverse
 * component labels for colors rather than the free-shape labels — a larger change to
 * pre-existing code. The flat approach avoids this and is compatible with readStep as
 * shipped. The color-loss trap (from stepColor.helper.ts) refers specifically to
 * BRepBuilderAPI_Transform with copy=false (shallow copy with location) — copy=true
 * avoids it.
 *
 * sRGB color type matches the shipped reader (StepIO.ts:211-215).
 * Pure OCCT — no parts/cache access. Caller resolves leaf.shape + leaf.pose.
 */
export function exportStepDoc(oc: OcctInstance, leaves: readonly KernelExportLeaf[]): Uint8Array {
  if (leaves.length === 0) throw new Error('exportStepDoc: no leaves to export');

  // --- doc bootstrap (verbatim from stepColor.helper.ts:12-19) ---
  // TCollection_ExtendedString_1 = no-arg ctor (proven verbatim: helper.ts:15).
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
    } } };
  }).XCAFDoc_DocumentTool.ShapeTool(main).get();

  const colorTool = (oc as {
    XCAFDoc_DocumentTool: { ColorTool(l: unknown): { get(): {
      SetColor_2(label: unknown, color: unknown, type: unknown): void;
    } } };
  }).XCAFDoc_DocumentTool.ColorTool(main).get();

  // TCollection_ExtendedString_2: TWO args (astring: Standard_CString, isMultiByte: Standard_Boolean).
  // d.ts line 66737.
  const TExtStr2 = (oc as { TCollection_ExtendedString_2: new (s: string, isMultiByte: boolean) => unknown }).TCollection_ExtendedString_2;
  const QColor = (oc as { Quantity_Color_3: new (a: number, b: number, c: number, t: unknown) => unknown }).Quantity_Color_3;
  // Quantity_TOC_sRGB — matches the shipped reader (StepIO.ts:211-215) and helper (:47).
  const QTOC = (oc as { Quantity_TypeOfColor: { Quantity_TOC_sRGB: unknown } }).Quantity_TypeOfColor.Quantity_TOC_sRGB;
  const SURF = (oc as { XCAFDoc_ColorType: { XCAFDoc_ColorSurf: unknown } }).XCAFDoc_ColorType.XCAFDoc_ColorSurf;
  const NameSet = (oc as { TDataStd_Name: { Set_1(l: unknown, s: unknown): unknown } }).TDataStd_Name;

  // BRepBuilderAPI_Transform_2(shape, trsf, copy=true) — deep copy with baked vertices,
  // no TopoDS location wrapper. This is the key to avoiding the color-loss trap:
  // a shape with a location wrapper is treated as a "reference" by XCAF, not standalone.
  const TransformCtor = (oc as {
    BRepBuilderAPI_Transform_2: new (s: unknown, t: unknown, copy: unknown) => {
      Shape(): unknown;
      delete(): void;
    }
  }).BRepBuilderAPI_Transform_2;

  // Add each leaf as a FLAT, STANDALONE shape (deep-copy-transformed to world position).
  // This is the same pattern as stepColor.helper.ts which creates shapes at absolute
  // positions and adds them flat — compatible with readStep's label-level color extraction.
  for (const leaf of leaves) {
    // For identity pose: use the shape as-is (no transform needed, avoids a no-op copy).
    let worldShape: unknown;
    let ownedTransform: { delete(): void } | null = null;

    if (isIdentityPose(leaf.pose)) {
      worldShape = leaf.shape.handle;
    } else {
      const trsf = trsfFromPose(oc, leaf.pose);
      const xform = new TransformCtor(leaf.shape.handle, trsf, true as never);
      worldShape = xform.Shape();
      ownedTransform = xform;
      (trsf as { delete?(): void }).delete?.();
    }

    const label = shapeTool.AddShape(worldShape, false, true);
    // TCollection_ExtendedString_2(name, true) — isMultiByte=true, both args required.
    NameSet.Set_1(label, new TExtStr2(leaf.name, true));

    if (leaf.color) {
      const [r, g, b] = leaf.color;
      const qcol = new QColor(r, g, b, QTOC);
      colorTool.SetColor_2(label, qcol, SURF);
    }

    ownedTransform?.delete();
  }

  // Write via STEPCAFControl_Writer (helper :64-77) — Transfer_1 takes the HANDLE + 4 args.
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
  const ProgressRangeCtor = (oc as { Message_ProgressRange_1?: new () => unknown }).Message_ProgressRange_1
    ?? (oc as { Message_ProgressRange?: new () => unknown }).Message_ProgressRange;
  if (!ProgressRangeCtor) throw new Error('exportStepDoc: Message_ProgressRange binding not found');

  const tmp = `/_step_export_${Math.random().toString(36).slice(2, 10)}.step`;
  const ok = writer.Transfer_1(docH, AsIs, null, new ProgressRangeCtor());
  if (!ok) {
    writer.delete();
    (docH as unknown as { delete?(): void }).delete?.();
    throw new Error('exportStepDoc: STEPCAFControl_Writer.Transfer_1 failed');
  }
  writer.Write(tmp);
  writer.delete();

  // --- FS readback (helper :79-81 / BRepIO.ts:21) ---
  const bytes = (oc as { FS: { readFile(p: string): Uint8Array; unlink(p: string): void } }).FS.readFile(tmp);
  (oc as { FS: { readFile(p: string): Uint8Array; unlink(p: string): void } }).FS.unlink(tmp);
  (docH as unknown as { delete?(): void }).delete?.();
  return bytes.slice(); // copy out of the MEMFS view
}
