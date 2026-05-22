// packages/app/src/commands/AutoDimCommand.ts
import type { Command } from './Command';
import type {
  DrawingDocument,
  DrawingDimension,
  DrawingView,
  PartDocument,
  Feature,
} from '@zilventor/shared';
import type { DimensionConstraint } from '@zilventor/shared/src/constraints';
// Fact #1: Two distinct PointRef types — alias both to avoid collision
import type { PointRef as DimPointRef } from '@zilventor/shared/src/drawing/types';
import { useAppStore } from '../store/useAppStore';
import {
  findMatchingEdge2D,
  greedyPlaceDims,
} from '@zilventor/shared/src/drawing/autoDim';

export type AutoDimPayload = {
  drawingId: string;
  sheetId: string;
  viewId: string;
};

export class AutoDimCommand implements Command {
  readonly name = 'AutoDimCommand';
  /** IDs of every dim placed by this command; consumed by revert(). */
  placedIds: string[] = [];

  constructor(private readonly payload: AutoDimPayload) {}

  // -------------------------------------------------------------------------
  // apply
  // -------------------------------------------------------------------------
  async apply(): Promise<void> {
    // Fact #7: missing-projection THROWS; all other empty cases TOAST-SUCCEED.
    // The _apply() propagates the throw; other early-returns silently succeed.
    await this._apply();
  }

  private async _apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const activePart = state.activePart;
    if (!activePart) return;

    const drawing = doc.document;

    // Locate sheet
    const sheet = drawing.sheets.find((s) => s.id === this.payload.sheetId);
    if (!sheet) throw new Error('sheet-not-found');

    // Locate view
    const view = sheet.views.find((v) => v.id === this.payload.viewId) as DrawingView | undefined;
    if (!view) throw new Error('view-not-found');

    // Guard: projection must exist — THROWS per Fact #7 / spec §5.4
    if (!view.projection) throw new Error('view-projection-missing');

    // Resolve base extrude sketch
    const { sketchFeature, extrudeFeature } = resolveBaseExtrude(activePart);
    if (!sketchFeature || !extrudeFeature) {
      useAppStore.getState().setStatus('No parametric dimensions found on base sketch.');
      return;
    }

    // Filter parametric dimension constraints
    const dimConstraints = (sketchFeature.constraints as DimensionConstraint[]).filter(
      (c): c is DimensionConstraint =>
        c.kind === 'dim-length' || c.kind === 'dim-distance',
    );

    if (dimConstraints.length === 0) {
      useAppStore.getState().setStatus('No parametric dimensions found on base sketch.');
      return;
    }

    // Resolve extrudeDepth and viewOrientation
    const extrudeDepth =
      activePart.parameters[extrudeFeature.distanceParam]?.value ?? 0;
    const viewOrientation = resolveViewOrientation(view);

    // Build candidates
    const candidates: DrawingDimension[] = [];

    for (const c of dimConstraints) {
      if (c.kind === 'dim-length') {
        // Single primitive lookup
        const prim = sketchFeature.primitives.find((p) => p.id === c.line);
        if (!prim) continue;

        const matched = findMatchingEdge2D(prim, extrudeDepth, viewOrientation, view);
        if (!matched) continue;

        const dimKind = classifyEdge(matched);
        const from: DimPointRef = { kind: 'edge-endpoint', edgeId: matched.id, end: 'start' };
        const to: DimPointRef   = { kind: 'edge-endpoint', edgeId: matched.id, end: 'end' };
        candidates.push({
          id: '',   // assigned after greedy placement
          kind: dimKind,
          viewId: this.payload.viewId,
          from,
          to,
          offsetMm: 0,
          sourceParameterName: c.paramName,
        } as DrawingDimension);
      } else if (c.kind === 'dim-distance') {
        // dim-distance: two primitives
        const primA = sketchFeature.primitives.find((p) => p.id === c.a.primitiveId);
        const primB = sketchFeature.primitives.find((p) => p.id === c.b.primitiveId);
        if (!primA || !primB) continue;

        const matchedA = findMatchingEdge2D(primA, extrudeDepth, viewOrientation, view);
        const matchedB = findMatchingEdge2D(primB, extrudeDepth, viewOrientation, view);
        if (!matchedA || !matchedB) continue;

        // Displacement direction between edge midpoints determines dim kind
        const midAx = (matchedA.points[0]![0] + matchedA.points[matchedA.points.length - 1]![0]) / 2;
        const midAy = (matchedA.points[0]![1] + matchedA.points[matchedA.points.length - 1]![1]) / 2;
        const midBx = (matchedB.points[0]![0] + matchedB.points[matchedB.points.length - 1]![0]) / 2;
        const midBy = (matchedB.points[0]![1] + matchedB.points[matchedB.points.length - 1]![1]) / 2;
        const dx = Math.abs(midBx - midAx);
        const dy = Math.abs(midBy - midAy);
        const dimKind: 'linear-h' | 'linear-v' | 'aligned' =
          dy < 1e-3 ? 'linear-h' : dx < 1e-3 ? 'linear-v' : 'aligned';

        const from: DimPointRef = { kind: 'edge-endpoint', edgeId: matchedA.id, end: 'start' };
        const to: DimPointRef   = { kind: 'edge-endpoint', edgeId: matchedB.id, end: 'start' };
        candidates.push({
          id: '',
          kind: dimKind,
          viewId: this.payload.viewId,
          from,
          to,
          offsetMm: 0,
          sourceParameterName: c.paramName,
        } as DrawingDimension);
      }
    }

    // Run greedy placement to assign offsetMm
    const placed = greedyPlaceDims(candidates, view.projection.bbox);

    // Assign stable IDs
    const placedDims: DrawingDimension[] = placed.map((d) => ({
      ...d,
      id: crypto.randomUUID(),
    }));

    this.placedIds = placedDims.map((d) => d.id);

    if (placedDims.length === 0) {
      useAppStore.getState().setStatus('No parametric dimensions found on base sketch.');
      return;
    }

    // Atomic store write — mirrors AddSectionViewCommand pattern (Fact #2)
    const nextDoc: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map((s) =>
        s.id === this.payload.sheetId
          ? { ...s, dimensions: [...s.dimensions, ...placedDims] }
          : s,
      ),
    };
    // Fact #2: update BOTH activeDocument AND activeDrawing
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: nextDoc },
      activeDrawing: nextDoc,
    });
  }

  // -------------------------------------------------------------------------
  // revert
  // -------------------------------------------------------------------------
  async revert(): Promise<void> {
    if (this.placedIds.length === 0) return;

    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const idSet = new Set(this.placedIds);

    const nextDoc: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map((s) =>
        s.id === this.payload.sheetId
          ? { ...s, dimensions: s.dimensions.filter((d) => !idSet.has(d.id)) }
          : s,
      ),
    };
    // Fact #2: update BOTH activeDocument AND activeDrawing
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: nextDoc },
      activeDrawing: nextDoc,
    });

    this.placedIds = [];
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type SketchAndExtrude = {
  sketchFeature: Extract<Feature, { kind: 'sketch' }> | null;
  extrudeFeature: Extract<Feature, { kind: 'extrude' }> | null;
};

/** Walk featureTree; return the first extrude and its referenced sketch. */
function resolveBaseExtrude(part: PartDocument): SketchAndExtrude {
  const extrudeFeature = part.featureTree.find(
    (f): f is Extract<Feature, { kind: 'extrude' }> => f.kind === 'extrude',
  ) ?? null;

  if (!extrudeFeature) return { sketchFeature: null, extrudeFeature: null };

  const sketchFeature = part.featureTree.find(
    (f): f is Extract<Feature, { kind: 'sketch' }> =>
      f.kind === 'sketch' && f.id === extrudeFeature.sketchRef,
  ) ?? null;

  return { sketchFeature, extrudeFeature };
}

/** Classify a matched Edge2D into a linear dim kind. */
function classifyEdge(edge: { points: ReadonlyArray<readonly [number, number]> }): 'linear-h' | 'linear-v' | 'aligned' {
  const p0 = edge.points[0]!;
  const p1 = edge.points[edge.points.length - 1]!;
  const dx = Math.abs(p1[0] - p0[0]);
  const dy = Math.abs(p1[1] - p0[1]);
  if (dy < 1e-3) return 'linear-h';
  if (dx < 1e-3) return 'linear-v';
  return 'aligned';
}

/** Extract the orientation string for view-matrix selection. */
function resolveViewOrientation(view: DrawingView): string {
  if (view.kind === 'base') return view.orientation;
  if (view.kind === 'projected') return view.direction;
  if (view.kind === 'iso') return `iso-${view.corner}`;
  return 'front';
}
