import type { OcctInstance } from './occtLoader';
import { type OcctShape, computeBoundingBox } from './SolidOps';
import type { BoundingBox } from '@zilventor/shared';
import { writeBRep } from './BRepIO';

export type StepReadResult = {
  shape: OcctShape;
  faceCount: number;
  solidCount: number;
  boundingBox: BoundingBox;
};

/**
 * Reads STEP bytes (AP203 / AP214) into a single TopoDS_Shape compound.
 * Multiple solids in the STEP are returned as one compound shape — the
 * caller decides how to surface them (1.5 wraps them as an ImportedFeature
 * with a single brep blob).
 *
 * Caller owns the returned `shape`; dispose via SolidOps.disposeShape.
 */
export function readStep(oc: OcctInstance, stepBytes: ArrayBuffer): StepReadResult {
  // Write to OCCT's in-memory FS so the reader can consume it
  const tmpPath = `/_step_in_${Math.random().toString(36).slice(2, 10)}.step`;
  oc.FS.writeFile(tmpPath, new Uint8Array(stepBytes));

  let rawShape: unknown;
  try {
    const ReaderCtor = (oc as { STEPControl_Reader_1?: new () => unknown }).STEPControl_Reader_1
      ?? (oc as { STEPControl_Reader?: new () => unknown }).STEPControl_Reader;
    if (!ReaderCtor) {
      throw new Error('readStep: STEPControl_Reader binding not found in opencascade.js');
    }
    const reader = new (ReaderCtor as new () => {
      ReadFile(p: string): unknown;
      TransferRoots(progress: unknown): unknown;
      OneShape(): { IsNull(): boolean };
      delete?(): void;
    })();
    const status = reader.ReadFile(tmpPath);
    // IFSelect_RetDone is the success status — its numeric value is implementation-defined
    // across opencascade.js versions, so compare via the enum.
    const RetDone = (oc as { IFSelect_ReturnStatus?: { IFSelect_RetDone?: unknown } })
      .IFSelect_ReturnStatus?.IFSelect_RetDone;
    if (RetDone !== undefined && status !== RetDone) {
      throw new Error(`readStep: failed to parse STEP (IFSelect status=${String(status)})`);
    }
    const ProgressRange = (oc as { Message_ProgressRange_1?: new () => unknown }).Message_ProgressRange_1
      ?? (oc as { Message_ProgressRange?: new () => unknown }).Message_ProgressRange;
    if (!ProgressRange) throw new Error('readStep: Message_ProgressRange binding not found');
    reader.TransferRoots(new ProgressRange());
    const shape = reader.OneShape();
    if (shape.IsNull()) throw new Error('readStep: STEP produced an empty shape');
    rawShape = shape;
    if (typeof reader.delete === 'function') reader.delete();
  } finally {
    try { oc.FS.unlink(tmpPath); } catch { /* ignore */ }
  }

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

  return { shape: wrapped, faceCount, solidCount, boundingBox };
}

export type ExtractedSolid = {
  brepBlobId: string;
  boundingBox: BoundingBox;
  shape: OcctShape;
};

/**
 * Walks the sub-solids of a STEP file and returns one entry per
 * TopAbs_SOLID. Each entry holds a fresh brepBlobId and the bounding box of
 * that sub-solid. Throws if the STEP contains zero solids.
 *
 * Direct writeBRep path: each raw handle from explorer.Current() is wrapped
 * in an OcctShape and passed directly to writeBRep. If OCCT serialization of
 * sub-shapes misbehaves on the pinned opencascade.js build, the caller should
 * switch to the compound-wrap fallback (see Task 1.4 in the plan).
 */
export function extractStepSolids(
  oc: OcctInstance,
  stepBytes: ArrayBuffer,
): ExtractedSolid[] {
  const parent = readStep(oc, stepBytes);
  if (parent.solidCount === 0) {
    throw new Error('STEP file contains no solids');
  }

  const TAS = (oc as { TopAbs_ShapeEnum: { TopAbs_SOLID: unknown; TopAbs_SHAPE: unknown } }).TopAbs_ShapeEnum;
  const ExplorerCtor = (oc as {
    TopExp_Explorer_2: new (s: unknown, t: unknown, a: unknown) => {
      More(): boolean;
      Next(): void;
      Current(): unknown;
      delete?(): void;
    };
  }).TopExp_Explorer_2;

  const solids: ExtractedSolid[] = [];
  const exp = new ExplorerCtor(parent.shape.handle as unknown, TAS.TopAbs_SOLID, TAS.TopAbs_SHAPE);
  try {
    while (exp.More()) {
      const handle = exp.Current();
      // Wrap in a fresh TopoDS_Compound so writeBRep gets a rooted shape
      // (sub-shapes from the explorer may not serialize cleanly on their own).
      const builder = new (oc as {
        BRep_Builder: new () => {
          MakeCompound(c: unknown): void;
          Add(c: unknown, s: unknown): void;
          delete(): void;
        };
      }).BRep_Builder();
      const comp = new (oc as { TopoDS_Compound: new () => unknown }).TopoDS_Compound();
      builder.MakeCompound(comp);
      builder.Add(comp, handle);
      builder.delete();

      const subShape: OcctShape = { __brand: 'OcctShape' as const, handle: comp };
      const boundingBox = computeBoundingBox(oc, subShape);
      const brepBytes = writeBRep(oc, subShape);
      void brepBytes; // bytes used downstream by saveToBytes; registering via brepBlobId
      const brepBlobId = `imp-${crypto.randomUUID()}`;
      solids.push({ brepBlobId, boundingBox, shape: subShape });
      exp.Next();
    }
  } finally {
    exp.delete?.();
  }

  return solids;
}
