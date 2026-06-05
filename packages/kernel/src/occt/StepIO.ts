import type { OcctInstance } from './occtLoader';
import { type OcctShape, computeBoundingBox } from './SolidOps';
import type { BoundingBox } from '@zilventor/shared';

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
      solids.push({ brepBlobId, boundingBox, shape: subShape });
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

