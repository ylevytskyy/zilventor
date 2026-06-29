import type { OcctInstance } from './occtLoader';
import { type OcctShape, computeBoundingBox } from './SolidOps';
import type { BoundingBox } from '@zilventor/shared';

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

/**
 * Reads STEP bytes (AP203 / AP214) into a single TopoDS_Shape compound.
 * Multiple solids in the STEP are returned as one compound shape — the
 * caller decides how to surface them (1.5 wraps them as an ImportedFeature
 * with a single brep blob).
 *
 * Uses STEPCAFControl_Reader with a TDocStd_Document (color mode on) so that
 * per-solid XCAF colors are extracted in the same parse. solidColors is
 * index-aligned with the canonical TopExp_Explorer_2(shape, SOLID, SHAPE)
 * enumeration used by splitImportedShapeHelper.
 *
 * Caller owns the returned `shape`; dispose via SolidOps.disposeShape.
 */
export function readStep(oc: OcctInstance, stepBytes: ArrayBuffer): StepReadResult {
  const tmpPath = `/_step_in_${Math.random().toString(36).slice(2, 10)}.step`;
  oc.FS.writeFile(tmpPath, new Uint8Array(stepBytes));

  let rawShape: unknown;
  let solidColors: (string | null)[] = [];

  try {
    // --- XCAF document + CAF reader (color mode on) ---
    const appHandle = (oc as {
      XCAFApp_Application: { GetApplication(): { get(): { NewDocument_2(f: unknown, d: unknown): void } } }
    }).XCAFApp_Application.GetApplication();

    const TExtStr = (oc as { TCollection_ExtendedString_1: new () => unknown }).TCollection_ExtendedString_1;
    const docHandle = new (oc as { Handle_TDocStd_Document_1: new () => unknown }).Handle_TDocStd_Document_1();
    const tExtStr = new TExtStr();
    appHandle.get().NewDocument_2(tExtStr, docHandle as unknown as { get(): { Main(): unknown } });
    (tExtStr as { delete?(): void }).delete?.();

    const ProgressRange = (oc as { Message_ProgressRange_1?: new () => unknown }).Message_ProgressRange_1
      ?? (oc as { Message_ProgressRange?: new () => unknown }).Message_ProgressRange;
    if (!ProgressRange) throw new Error('readStep: Message_ProgressRange binding not found');

    const ReaderCtor = (oc as { STEPCAFControl_Reader_1?: new () => unknown }).STEPCAFControl_Reader_1
      ?? (oc as { STEPCAFControl_Reader?: new () => unknown }).STEPCAFControl_Reader;
    if (!ReaderCtor) {
      throw new Error('readStep: STEPCAFControl_Reader binding not found in opencascade.js');
    }
    const reader = new (ReaderCtor as new () => {
      ReadFile(p: string): unknown;
      SetColorMode(v: boolean): void;
      Transfer_1(doc: unknown, progress: unknown): boolean;
      delete(): void;
    })();
    reader.SetColorMode(true);

    const status = reader.ReadFile(tmpPath);
    const RetDone = (oc as { IFSelect_ReturnStatus?: { IFSelect_RetDone?: unknown } })
      .IFSelect_ReturnStatus?.IFSelect_RetDone;
    if (RetDone !== undefined && status !== RetDone) {
      throw new Error(`readStep: failed to parse STEP (IFSelect status=${String(status)})`);
    }

    const progressRange = new ProgressRange();
    const ok = reader.Transfer_1(docHandle, progressRange);
    (progressRange as { delete?(): void }).delete?.();
    if (!ok) {
      reader.delete();
      throw new Error('readStep: STEPCAFControl_Reader.Transfer failed');
    }
    reader.delete();

    const docObj = (docHandle as unknown as { get(): { Main(): unknown } }).get();
    const mainLabel = docObj.Main();

    const shapeTool = (oc as {
      XCAFDoc_DocumentTool: {
        ShapeTool(l: unknown): { get(): {
          GetFreeShapes(roots: unknown): void;
        } }
      }
    }).XCAFDoc_DocumentTool.ShapeTool(mainLabel).get();

    const colorTool = (oc as {
      XCAFDoc_DocumentTool: {
        ColorTool(l: unknown): { get(): {
          GetColor_4(label: unknown, type: unknown, color: unknown): boolean;
          GetColor_7(shape: unknown, type: unknown, color: unknown): boolean;
        } }
      }
    }).XCAFDoc_DocumentTool.ColorTool(mainLabel).get();

    const ColorType = (oc as { XCAFDoc_ColorType: { XCAFDoc_ColorSurf: unknown; XCAFDoc_ColorGen: unknown } }).XCAFDoc_ColorType;
    const QColorCtor = (oc as { Quantity_Color_1: new () => { Red(): number; Green(): number; Blue(): number; delete?(): void } }).Quantity_Color_1;

    // XCAFDoc_ShapeTool.GetShape_2 is a static method — access via oc class, not instance
    const GetShapeStatic = (oc as {
      XCAFDoc_ShapeTool: { GetShape_2(label: unknown): unknown }
    }).XCAFDoc_ShapeTool.GetShape_2.bind((oc as { XCAFDoc_ShapeTool: unknown }).XCAFDoc_ShapeTool);

    // XCAFDoc_ShapeTool.IsAssembly + GetComponents are static methods (d.ts:13855,13881)
    const IsAssemblyStatic = (oc as {
      XCAFDoc_ShapeTool: { IsAssembly(l: unknown): boolean }
    }).XCAFDoc_ShapeTool.IsAssembly.bind((oc as { XCAFDoc_ShapeTool: unknown }).XCAFDoc_ShapeTool);

    const GetComponentsStatic = (oc as {
      XCAFDoc_ShapeTool: { GetComponents(l: unknown, labels: unknown, getsubchilds: boolean): boolean }
    }).XCAFDoc_ShapeTool.GetComponents.bind((oc as { XCAFDoc_ShapeTool: unknown }).XCAFDoc_ShapeTool);

    const TDF_LabelSeqCtor = (oc as { TDF_LabelSequence_1: new () => { Length(): number; Value(i: number): unknown; delete?(): void } }).TDF_LabelSequence_1;

    /** Extract surface or generic color from a TopoDS_Shape (shape-bound colors,
     *  e.g. STYLED_ITEM on MANIFOLD_SOLID_BREP in AP214 files). Returns null if
     *  none found. Mirrors extractLabelColor but uses GetColor_7 (shape overload). */
    function extractShapeColor(shape: unknown): string | null {
      const colSurf = new QColorCtor();
      try {
        const gotSurf = colorTool.GetColor_7(shape, ColorType.XCAFDoc_ColorSurf, colSurf);
        if (gotSurf) return quantityColorToHex(colSurf);
      } finally {
        colSurf.delete?.();
      }
      const colGen = new QColorCtor();
      try {
        const gotGen = colorTool.GetColor_7(shape, ColorType.XCAFDoc_ColorGen, colGen);
        if (gotGen) return quantityColorToHex(colGen);
      } finally {
        colGen.delete?.();
      }
      return null;
    }

    /** Extract surface or generic color from a label. Returns null if none found. */
    function extractLabelColor(label: unknown): string | null {
      const colSurf = new QColorCtor();
      try {
        const gotSurf = colorTool.GetColor_4(label, ColorType.XCAFDoc_ColorSurf, colSurf);
        if (gotSurf) return quantityColorToHex(colSurf);
      } finally {
        colSurf.delete?.();
      }
      const colGen = new QColorCtor();
      try {
        const gotGen = colorTool.GetColor_4(label, ColorType.XCAFDoc_ColorGen, colGen);
        if (gotGen) return quantityColorToHex(colGen);
      } finally {
        colGen.delete?.();
      }
      return null;
    }

    // OneShape equivalent: assemble all free shapes into one compound so the
    // downstream geometry path is unchanged vs STEPControl_Reader.OneShape().
    // At the same time, extract per-free-shape color from labels and map it to
    // the solid sub-shapes via TopExp enumeration order.
    //
    // Strategy (two-tier):
    //  1. FLAT STEP: each free label is a standalone shape with its own color.
    //     → GetColor_4(label) works directly; enumerate solids in that shape.
    //  2. STRUCTURED XCAF assembly: the free label is an assembly root with no
    //     direct color. Colors are on COMPONENT labels (children of the root).
    //     → If IsAssembly(label) is true, traverse GetComponents and extract
    //       per-component colors; enumerate solids in each component's shape.
    //
    // Both cases produce the same labelSolidColors[] in TopExp_Explorer order.
    const builder = new (oc as { BRep_Builder: new () => { MakeCompound(c: unknown): void; Add(c: unknown, s: unknown): void; delete(): void } }).BRep_Builder();
    const comp = new (oc as { TopoDS_Compound: new () => unknown }).TopoDS_Compound();
    builder.MakeCompound(comp);

    const ExplorerCtor2 = (oc as { TopExp_Explorer_2: new (s: unknown, t: unknown, a: unknown) => { More(): boolean; Next(): void; Current(): unknown; delete?(): void } }).TopExp_Explorer_2;
    const TAS2 = (oc as { TopAbs_ShapeEnum: { TopAbs_SOLID: unknown; TopAbs_SHAPE: unknown } }).TopAbs_ShapeEnum;

    // labelSolidColors: accumulated per-solid colors from label traversal,
    // in the order that TopExp_Explorer_2 visits them on each free shape.
    const labelSolidColors: (string | null)[] = [];

    const roots = new TDF_LabelSeqCtor();
    shapeTool.GetFreeShapes(roots);

    if (roots.Length() === 0) {
      (roots as { delete?(): void }).delete?.();
      throw new Error('readStep: STEP produced no free shapes');
    }

    try {
      for (let i = 1; i <= roots.Length(); i++) {
        const label = roots.Value(i);
        const freeShape = GetShapeStatic(label);
        builder.Add(comp, freeShape);

        if (IsAssemblyStatic(label)) {
          // STRUCTURED assembly path: colors are on COMPONENT labels, not the root.
          // Traverse direct components (getsubchilds=false) to get per-instance colors,
          // then count solids in each component's shape.
          const compSeq = new TDF_LabelSeqCtor();
          try {
            GetComponentsStatic(label, compSeq, false);
            for (let ci = 1; ci <= compSeq.Length(); ci++) {
              const compLabel = compSeq.Value(ci);
              const compColor = extractLabelColor(compLabel);
              const compShape = GetShapeStatic(compLabel);

              // Count solids within this component's posed shape.
              // Try shape-bound color first (AP214 STYLED_ITEM on solid), fall back to label color.
              const solidExpC = new ExplorerCtor2(compShape, TAS2.TopAbs_SOLID, TAS2.TopAbs_SHAPE);
              try {
                while (solidExpC.More()) {
                  const solidShape = solidExpC.Current();
                  const solidColor = extractShapeColor(solidShape) ?? compColor;
                  labelSolidColors.push(solidColor);
                  solidExpC.Next();
                }
              } finally {
                solidExpC.delete?.();
              }
            }
          } finally {
            (compSeq as { delete?(): void }).delete?.();
          }
        } else {
          // FLAT path: color is directly on the free label.
          const labelColor = extractLabelColor(label);

          // Count solids inside this free shape and assign color to each.
          // Try shape-bound color first (AP214 STYLED_ITEM on solid), fall back to label color.
          const solidExpL = new ExplorerCtor2(freeShape, TAS2.TopAbs_SOLID, TAS2.TopAbs_SHAPE);
          try {
            while (solidExpL.More()) {
              const solidShape = solidExpL.Current();
              const solidColor = extractShapeColor(solidShape) ?? labelColor;
              labelSolidColors.push(solidColor);
              solidExpL.Next();
            }
          } finally {
            solidExpL.delete?.();
          }
        }
      }
    } finally {
      (roots as { delete?(): void }).delete?.();
    }

    builder.delete();
    rawShape = comp;

    solidColors = labelSolidColors;

    // Clean up the XCAF doc — colors are now extracted
    (docHandle as unknown as { delete?(): void }).delete?.();
  } finally {
    try { oc.FS.unlink(tmpPath); } catch { /* ignore */ }
  }

  if (rawShape == null) throw new Error('readStep: STEP produced an empty shape');
  const wrapped: OcctShape = { __brand: 'OcctShape', handle: rawShape };

  // Topology counts via TopExp_Explorer_2
  const TAS = (oc as { TopAbs_ShapeEnum: { TopAbs_FACE: unknown; TopAbs_SOLID: unknown; TopAbs_SHAPE: unknown } }).TopAbs_ShapeEnum;
  const ExplorerCtor = (oc as { TopExp_Explorer_2: new (s: unknown, t: unknown, a: unknown) => { More(): boolean; Next(): void; delete?(): void } }).TopExp_Explorer_2;

  let faceCount = 0;
  const faceExp = new ExplorerCtor(rawShape, TAS.TopAbs_FACE, TAS.TopAbs_SHAPE);
  while (faceExp.More()) { faceCount++; faceExp.Next(); }
  if (typeof faceExp.delete === 'function') faceExp.delete();

  let solidCount = 0;
  const solidExp = new ExplorerCtor(rawShape, TAS.TopAbs_SOLID, TAS.TopAbs_SHAPE);
  while (solidExp.More()) { solidCount++; solidExp.Next(); }
  if (typeof solidExp.delete === 'function') solidExp.delete();

  const boundingBox = computeBoundingBox(oc, wrapped);

  return { shape: wrapped, faceCount, solidCount, boundingBox, solidColors };
}

/** Quantity_Color → #rrggbb.
 *  OCCT stores Quantity_Color values in linear RGB when constructed with
 *  Quantity_TOC_RGB, or in sRGB when constructed with Quantity_TOC_sRGB.
 *  The STEP importer reads colors as-is from the file (sRGB by design for AP214),
 *  and Red()/Green()/Blue() return the values in whatever space the color was
 *  constructed with. We use raw component values → hex since our fixture uses
 *  Quantity_TOC_sRGB and STEP files carry sRGB values. */
function quantityColorToHex(col: { Red(): number; Green(): number; Blue(): number }): string {
  const to255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  const h = (v: number) => to255(v).toString(16).padStart(2, '0');
  return `#${h(col.Red())}${h(col.Green())}${h(col.Blue())}`;
}

export type ExtractedSolid = {
  brepBlobId: string;
  boundingBox: BoundingBox;
  shape: OcctShape;
  /** Per-body color as #rrggbb from the STEP XCAF data; undefined when none. */
  color?: string;
};

export type SplitImportedShapeResult = {
  solids: ExtractedSolid[];
  /** Merged compound of all shells NOT enclosed in any solid (open shells,
   *  surface models, etc.). Null when none exist. */
  surfaces: { brepBlobId: string; shape: OcctShape } | null;
};

/**
 * Splits a compound (as returned by `importStep` / `readStep`) into
 * per-solid pieces and one merged "surfaces" bucket for non-solid geometry.
 *
 * Strategy:
 *  1. Enumerate all TopAbs_SOLID shapes with TopExp_Explorer_2 (recursive,
 *     handles any nesting depth including assembly compounds). Each solid is
 *     wrapped in a fresh compound and pushed to `solids[]`.
 *  2. Enumerate all TopAbs_SHELL shapes that are NOT enclosed in any solid
 *     (avoid=TopAbs_SOLID) — i.e. open shells / surface models. Any found are
 *     collected into a single merged compound → `surfaces`.
 *  3. Enumerate all TopAbs_FACE shapes that are NOT enclosed in any shell
 *     (avoid=TopAbs_SHELL) — i.e. free faces not already inside a shell. Any
 *     found are added to the SAME `surfaces` compound as pass-2. The
 *     avoid=TopAbs_SHELL already prevents these from being solid-internal faces
 *     (shells can't appear inside faces), so there is no double-add risk.
 *
 * This explorer-based approach wraps each solid in a fresh compound and handles
 * single-solid STEP files (where OneShape() returns a TopoDS_Solid, not a
 * compound) as well as multi-product assembly compounds (any nesting depth).
 *
 * Throws if both buckets are empty.
 *
 * Lifetime: all returned shapes must be owned and eventually disposed by the caller.
 */
export function splitImportedShapeHelper(
  oc: OcctInstance,
  compound: OcctShape,
  solidColors?: (string | null)[],
): SplitImportedShapeResult {
  const TAS = (oc as {
    TopAbs_ShapeEnum: {
      TopAbs_SOLID: unknown;
      TopAbs_SHELL: unknown;
      TopAbs_FACE: unknown;
      TopAbs_SHAPE: unknown;
    };
  }).TopAbs_ShapeEnum;

  const ExplorerCtor = (oc as {
    TopExp_Explorer_2: new (s: unknown, t: unknown, a: unknown) => {
      More(): boolean;
      Next(): void;
      Current(): unknown;
      delete?(): void;
    };
  }).TopExp_Explorer_2;

  const BuilderCtor = (oc as {
    BRep_Builder: new () => {
      MakeCompound(c: unknown): void;
      Add(c: unknown, s: unknown): void;
      delete(): void;
    };
  }).BRep_Builder;

  const CompoundCtor = (oc as {
    TopoDS_Compound: new () => unknown;
  }).TopoDS_Compound;

  // --- Pass 1: collect all solids (wrap each in a fresh compound for serialization) ---
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

  // Shared surfaces compound — created once and reused by both pass-2 and pass-3.
  // We create it eagerly so both passes can call Add() without conditional branching.
  const surfBuilder = new BuilderCtor();
  const surfComp = new CompoundCtor();
  surfBuilder.MakeCompound(surfComp);
  let hasSurfaces = false;

  // --- Pass 2: collect shells NOT inside any solid (open shells / surface models) ---
  // avoid=TopAbs_SOLID: the explorer stops descending into solids, so every
  // shell found here is definitionally outside all solids.
  const shellExp = new ExplorerCtor(compound.handle, TAS.TopAbs_SHELL, TAS.TopAbs_SOLID);
  try {
    while (shellExp.More()) {
      surfBuilder.Add(surfComp, shellExp.Current());
      hasSurfaces = true;
      shellExp.Next();
    }
  } finally {
    shellExp.delete?.();
  }

  // --- Pass 3: collect free faces NOT inside any shell ---
  // avoid=TopAbs_SHELL: the explorer stops descending into shells (which include
  // solid-internal shells), so only truly free faces (not inside any shell,
  // hence not inside any solid) reach here. No double-add with pass-2 because
  // pass-2 enumerated shells; their contained faces are never emitted again by
  // an explorer that avoids TopAbs_SHELL.
  const faceExp = new ExplorerCtor(compound.handle, TAS.TopAbs_FACE, TAS.TopAbs_SHELL);
  try {
    while (faceExp.More()) {
      surfBuilder.Add(surfComp, faceExp.Current());
      hasSurfaces = true;
      faceExp.Next();
    }
  } finally {
    faceExp.delete?.();
  }

  surfBuilder.delete();

  if (solids.length === 0 && !hasSurfaces) {
    throw new Error(
      'splitImportedShapeHelper: compound contains no solids, no non-solid shells, and no free faces',
    );
  }

  const surfaces: { brepBlobId: string; shape: OcctShape } | null = hasSurfaces
    ? {
        brepBlobId: `imp-${crypto.randomUUID()}`,
        shape: { __brand: 'OcctShape' as const, handle: surfComp },
      }
    : null;

  return { solids, surfaces };
}

