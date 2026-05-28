// packages/app/src/drawing/regenerateSectionView.ts
import type { SectionView } from '@zilventor/shared';
import { resolveSectionSource, getHatchSpec } from '@zilventor/shared';
import type { CommandBus } from '../commands/CommandBus';
import {
  cutBySectionPlane,
  cutByStepSegments,
  cutAssemblyComponentsBySectionPlane,
  cutAssemblyComponentsByStepSegments,
} from '../kernel/cutBySectionPlane';
import { projectSectionView } from './projectSectionView';
import { deriveSectionPlane, deriveStepPlanes } from '@zilventor/shared/src/drawing/sectionPlane';
import { drawingDocState } from '../store/drawingDocState';
import { useAppStore } from '../store/useAppStore';
import type { DrawingDocument } from '@zilventor/shared';
import type { Mat4 } from '@zilventor/shared/src/drawing/viewMatrix';
// NOTE: RegenerateViewCommand is intentionally NOT imported here.
// Section regenerate writes projection + hatchSegments + inputFingerprint atomically
// via a single useAppStore.setState(drawingDocState(...)). Routing through
// RegenerateViewCommand would require a second setState for hatchSegments,
// creating a transiently inconsistent render frame. Base/projected/iso views
// continue using RegenerateViewCommand unchanged.

/**
 * Async helper for handleRegenerate — section-view path.
 *
 * Re-runs the same kernel cut used at creation (cutBySectionPlane /
 * cutAssemblyBySectionPlane / cutByStepSegments / cutAssemblyByStepSegments),
 * re-projects via projectSectionView (including hatch recompute), and
 * atomically commits projection + hatchSegments + inputFingerprint in a single
 * useAppStore.setState(drawingDocState(...)) call (NOT via RegenerateViewCommand,
 * which would require a second setState for hatchSegments).
 *
 * Throws on kernel errors — caller (handleRegenerate) catches and leaves
 * the stale marker intact.
 *
 * The `_bus` parameter is accepted for API symmetry with regenerateDetailView
 * (detail views route through the bus; section views bypass it for atomic writes).
 */
export async function regenerateSectionView(
  view: SectionView,
  sheetId: string,
  _bus: CommandBus,
): Promise<void> {
  const state = useAppStore.getState();
  const doc = state.activeDocument;
  if (!doc || doc.kind !== 'drawing') throw new Error('REGEN_SECTION: no active drawing');
  const drawing = doc.document as DrawingDocument;

  // 1. Resolve the source (part vs assembly).
  const source = resolveSectionSource(view, drawing);

  // 2. Run the kernel cut for the right source kind and mode.
  let compound: unknown;
  let faceTags: Map<string, unknown>;

  if (source.kind === 'assembly') {
    // Assembly-sourced section: use pose-aware components cut.
    // activeDrawingSourceComponents is set at every activation path (CreateDrawingCommand /
    // activateDrawingDocument) and preserved across drawingDocState resets.
    const components = state.activeDrawingSourceComponents;
    if (!components || components.length === 0) {
      throw new Error('REGEN_SECTION: assembly components not loaded — reopen the drawing.');
    }
    if (view.mode === 'stepped') {
      if (!view.stepSegments || view.stepSegments.length < 2) {
        throw new Error('REGEN_SECTION: stepped view missing stepSegments');
      }
      const parentView = drawing.sheets
        .flatMap((s) => s.views)
        .find((v) => v.id === view.parentViewId);
      const viewMatrix = ((parentView as { viewMatrix?: number[] })?.viewMatrix
        ?? new Array(16).fill(0) as number[]) as Mat4;
      const planes = deriveStepPlanes(view.stepSegments, viewMatrix, view.arrowDirection);
      const result = await cutAssemblyComponentsByStepSegments(components, planes, view.arrowDirection);
      if (!result.ok) throw new Error(`REGEN_SECTION assembly stepped cut failed: ${result.reason}`);
      compound = result.compound;
      faceTags = result.faceTags;
    } else {
      // full or half
      if (!view.plane) throw new Error('REGEN_SECTION: full/half view missing plane');
      const result = await cutAssemblyComponentsBySectionPlane(
        components, view.plane, view.arrowDirection, view.splitPlane, view.cutSide,
      );
      if (!result.ok) throw new Error(`REGEN_SECTION assembly cut failed: ${result.reason}`);
      compound = result.compound;
      faceTags = result.faceTags;
    }
  } else {
    // Part-sourced section: resolve the kernel UUID and run the part cut.
    // Priority: live slot (activeDrawingSourcePartId) → activePart → stored source.id.
    const kernelId: string = state.activeDrawingSourcePartId ?? state.activePart?.id ?? source.id;

    if (view.mode === 'stepped') {
      if (!view.stepSegments || view.stepSegments.length < 2) {
        throw new Error('REGEN_SECTION: stepped view missing stepSegments');
      }
      // Find the parent view's viewMatrix to re-derive step planes.
      const parentView = drawing.sheets
        .flatMap((s) => s.views)
        .find((v) => v.id === view.parentViewId);
      const viewMatrix = ((parentView as { viewMatrix?: number[] })?.viewMatrix
        ?? new Array(16).fill(0) as number[]) as Mat4;
      const planes = deriveStepPlanes(view.stepSegments, viewMatrix, view.arrowDirection);
      const result = await cutByStepSegments(kernelId, planes, view.arrowDirection);
      if (!result.ok) throw new Error(`REGEN_SECTION stepped cut failed: ${result.reason}`);
      compound = result.compound;
      faceTags = result.faceTags;
    } else {
      // full or half
      if (!view.plane) throw new Error('REGEN_SECTION: full/half view missing plane');
      const result = await cutBySectionPlane(kernelId, view.plane, view.arrowDirection, view.splitPlane, view.cutSide);
      if (!result.ok) throw new Error(`REGEN_SECTION cut failed: ${result.reason}`);
      compound = result.compound;
      faceTags = result.faceTags;
    }
  }

  // 4. Re-derive sectionViewMatrix for projection.
  const parentView = drawing.sheets
    .flatMap((s) => s.views)
    .find((v) => v.id === view.parentViewId);
  const viewMatrix = ((parentView as { viewMatrix?: number[] })?.viewMatrix
    ?? new Array(16).fill(0) as number[]) as Mat4;
  const scale = view.scale.numerator / view.scale.denominator;

  let sectionViewMatrix: Mat4 | undefined;
  if (view.mode === 'stepped' && view.stepSegments && view.stepSegments.length >= 2) {
    const p0 = view.stepSegments[0]!.startSheet;
    const p1 = view.stepSegments[view.stepSegments.length - 1]!.endSheet;
    ({ sectionViewMatrix } = deriveSectionPlane({ p0, p1 }, viewMatrix, scale, view.arrowDirection));
  } else {
    ({ sectionViewMatrix } = deriveSectionPlane(view.sectionLine, viewMatrix, scale, view.arrowDirection));
  }

  // 5. Resolve materials for hatch lookup.
  const materials = state.activePart?.materials ?? state.activeAssembly?.materials ?? [];
  const hatchLookup = (materialId: string): { angleDeg: number; spacingMm: number } => {
    // Empty materialId is the single-part case (kernel stamps '' on every faceTag for non-assembly cuts).
    // Fall back to materials[0] as the implicit "primary material" — symmetric with colorForFace's part-source fallback.
    const mat = materialId
      ? materials.find((m) => m.id === materialId)
      : materials[0];
    return getHatchSpec(mat ?? { id: materialId, name: '', defaultThickness: 0, color: '#808080' });
  };

  const colorForFace = (partId: string): string =>
    state.activeDrawingSourceComponentColors?.[partId]
    ?? state.activePart?.materials?.[0]?.color
    ?? '#808080';

  // 6. Re-project: edges + hatchSegments in one call.
  const { edges, hatchSegments } = projectSectionView(
    compound as Parameters<typeof projectSectionView>[0],
    faceTags as Parameters<typeof projectSectionView>[1],
    scale,
    hatchLookup,
    sectionViewMatrix,
    view,
    colorForFace, // 7th arg: per-component color resolver
  );

  // 7. Atomic store write: projection + hatchSegments + inputFingerprint in ONE setState.
  //    Do NOT route through RegenerateViewCommand — that command only writes projection +
  //    inputFingerprint, forcing a second mutation for hatchSegments (transient inconsistency).
  //    Sections take their own atomic-write path; base/projected/iso continue using
  //    RegenerateViewCommand unchanged (no churn on those 15+ tests).
  const inputFingerprint = state.activeDrawingSourceFingerprint ?? source.id;
  const freshDoc = useAppStore.getState().activeDocument;
  if (!freshDoc || freshDoc.kind !== 'drawing') return;
  const freshDrawing = freshDoc.document as DrawingDocument;

  const nextProjection = {
    visibleEdges: edges,
    hiddenEdges: [] as typeof edges,
    bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
  const nextDrawing: DrawingDocument = {
    ...freshDrawing,
    sheets: freshDrawing.sheets.map((s) =>
      s.id !== sheetId ? s : {
        ...s,
        views: s.views.map((v) => {
          if (v.id !== view.id) return v;
          // One atomic patch: projection + hatchSegments + inputFingerprint together.
          // No render-observable intermediate state.
          return {
            ...v,
            projection: nextProjection,
            hatchSegments,
            inputFingerprint,
          } as typeof v;
        }),
      }
    ),
  };
  useAppStore.setState(drawingDocState(nextDrawing));
}
