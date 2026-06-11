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
 * prototype handle (from namedShapeCache). `protoKey` groups leaves by their
 * part id so a single XCAF prototype label is created once per distinct part;
 * each leaf then becomes a component reference (AddComponent_1) with a
 * TopLoc_Location carrying the world pose. This is the TRUE STRUCTURED approach.
 */
export type KernelExportLeaf = {
  shape: OcctShape;
  /** Dedup key — equals the kernel partId. One AddShape per distinct protoKey. */
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
 * Build a TRUE STRUCTURED XCAF assembly document from `leaves` and write it
 * to STEP bytes via STEPCAFControl_Writer.
 *
 * **Design — STRUCTURED XCAF assembly:**
 * 1. One prototype label per distinct `protoKey` (AddShape once, UN-POSED shape).
 *    Name + color are set on the prototype label.
 * 2. One assembly root label (shapeTool.NewShape()).
 * 3. Per leaf: AddComponent_1(asmRoot, protoLabel, TopLoc_Location_2(trsf)) — the
 *    world pose lives ONLY in the TopLoc_Location, never baked into the shape.
 *    Per-instance name + color are also set on the returned component label.
 * 4. shapeTool.UpdateAssemblies() — required for the STEP writer to serialize the
 *    assembly structure correctly (without this, NAUOs are not emitted).
 *
 * This produces a STEP file with NEXT_ASSEMBLY_USAGE_OCCURRENCE entries — the
 * AP214/AP242 marker of true assembly hierarchy. The flat baked approach did not
 * produce these. Instancing: two leaves sharing the same protoKey yield two NAUOs
 * pointing to one prototype → the STEP file is smaller and semantically correct.
 *
 * Colors are set on BOTH prototype labels AND component labels. On the component
 * label, per-instance overrides are applied. This dual placement allows both
 * structured-assembly XCAF readers (component-label color) and simpler readers
 * (proto-label color fallback) to find the colors.
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
      NewShape(): unknown;
      AddComponent_1(assembly: unknown, comp: unknown, loc: unknown): unknown;
      UpdateAssemblies(): void;
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

  // TopLoc_Location_2(trsf: gp_Trsf) — wraps a gp_Trsf in a TopoDS location.
  // This is what AddComponent_1 uses to position the component in the assembly.
  // d.ts line 97292-97294: constructor(T: gp_Trsf).
  const TopLocCtor = (oc as { TopLoc_Location_2: new (t: unknown) => unknown }).TopLoc_Location_2;

  // --- Step 1: Build one prototype label per distinct protoKey ---
  // proto label = un-posed shape (the raw namedShape.shape.handle from the cache).
  // Name + color are set here; per-instance overrides go on the component label.
  const protoLabels = new Map<string, unknown>(); // protoKey → TDF_Label

  for (const leaf of leaves) {
    if (protoLabels.has(leaf.protoKey)) continue; // de-dup: only one AddShape per part

    const protoLabel = shapeTool.AddShape(leaf.shape.handle, false, true);
    // Use the component name as the prototype name (first occurrence wins for de-dup).
    NameSet.Set_1(protoLabel, new TExtStr2(leaf.name, true));

    if (leaf.color) {
      const [r, g, b] = leaf.color;
      const qcol = new QColor(r, g, b, QTOC);
      colorTool.SetColor_2(protoLabel, qcol, SURF);
    }

    protoLabels.set(leaf.protoKey, protoLabel);
  }

  // --- Step 2: Assembly root label ---
  // NewShape() creates an empty TDF_Label that will become the assembly root.
  // The STEP writer marks it as an assembly (PRODUCT_DEFINITION) containing
  // N component references (NEXT_ASSEMBLY_USAGE_OCCURRENCE).
  const asmLabel = shapeTool.NewShape();
  NameSet.Set_1(asmLabel, new TExtStr2('Assembly', true));

  // --- Step 3: One component per leaf — pose in TopLoc_Location, NOT baked ---
  for (const leaf of leaves) {
    const protoLabel = protoLabels.get(leaf.protoKey)!;

    // Build gp_Trsf from pose quaternion + translation (same math as TransformOps.ts:49-67,
    // but we do NOT call BRepBuilderAPI_Transform — that would bake the pose into a deep
    // copy and lose the shared-prototype relationship).
    const trsf = trsfFromPose(oc, leaf.pose);

    // Wrap the trsf in a TopLoc_Location — this is what XCAF / STEP uses for instance pose.
    const loc = new TopLocCtor(trsf);

    // AddComponent_1(assembly, proto, loc) → returns the component label.
    const compLabel = shapeTool.AddComponent_1(asmLabel, protoLabel, loc);

    // Per-instance name on the component label (overrides the proto name for this instance).
    NameSet.Set_1(compLabel, new TExtStr2(leaf.name, true));

    // Per-instance color on the component label. Setting on both proto AND component
    // ensures round-trip readers that look at either level find the color.
    if (leaf.color) {
      const [r, g, b] = leaf.color;
      const qcol = new QColor(r, g, b, QTOC);
      colorTool.SetColor_2(compLabel, qcol, SURF);
    }

    // Clean up OCCT objects we own.
    (trsf as { delete?(): void }).delete?.();
    // TopLoc_Location value object — release if OCCT exposes delete.
    (loc as { delete?(): void }).delete?.();
  }

  // --- Step 4: UpdateAssemblies — CRITICAL ---
  // Without this call, STEPCAFControl_Writer does NOT emit NEXT_ASSEMBLY_USAGE_OCCURRENCE
  // entries for the components. The assembly structure is only serialized correctly
  // after UpdateAssemblies finalizes the internal XCAF shape compound.
  shapeTool.UpdateAssemblies();

  // --- Step 5: Write via STEPCAFControl_Writer (helper :64-77) ---
  // Transfer_1 takes the HANDLE docH + 4 args.
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
