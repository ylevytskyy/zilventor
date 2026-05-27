// packages/app/src/kernel/cutBySectionPlane.ts
//
// App-level bridge to the kernel section-cut pipeline.
// Delegates to the kernel worker via KernelClient (Comlink proxy).
// In tests these functions are mocked via vi.mock.

import type { Plane } from '@zilventor/shared/src/drawing/sectionPlane';
import type { FaceTagMap } from '@zilventor/shared/src/drawing/projectSectionView';
import type { ProjectorInput } from '@zilventor/shared';
import type { AssemblyComponentInput } from '@zilventor/kernel/src/adapter/drawing/getProjectorInput';
import { useAppStore } from '../store/useAppStore';

export type CutResult =
  | { ok: true; compound: ProjectorInput; faceTags: FaceTagMap }
  | { ok: false; reason: 'tangent' | 'empty' };

/**
 * Cut a part (by partId) with the given plane.
 * The kernel worker runs the OCCT cut and tessellation in-process, returning
 * a serializable ProjectorInput. The caller passes this directly to
 * projectSectionView.
 * Pass `splitPlane`/`splitSide` to produce a half-section view (F1.1).
 */
export async function cutBySectionPlane(
  partId: string,
  plane: Plane,
  arrowDirection: -1 | 1 = 1,
  splitPlane?: Plane,
  splitSide?: -1 | 1,
): Promise<CutResult> {
  const kernel = useAppStore.getState().kernel;
  if (!kernel) throw new Error('cutBySectionPlane: kernel not ready');
  const r = await kernel.cutBySectionPlane(partId, plane, arrowDirection, splitPlane, splitSide);
  if (!r.ok) return r;
  const faceTags: FaceTagMap = new Map(r.faceTags);
  return { ok: true, compound: r.projectorInput, faceTags };
}

/**
 * Cut every part in an assembly by the given plane and merge results.
 * Pass `splitPlane`/`splitSide` to produce a half-section view (F1.1).
 */
export async function cutAssemblyBySectionPlane(
  asmId: string,
  plane: Plane,
  arrowDirection: -1 | 1 = 1,
  splitPlane?: Plane,
  splitSide?: -1 | 1,
): Promise<CutResult> {
  const kernel = useAppStore.getState().kernel;
  if (!kernel) throw new Error('cutAssemblyBySectionPlane: kernel not ready');
  const r = await kernel.cutAssemblyBySectionPlane(asmId, plane, arrowDirection, splitPlane, splitSide);
  if (!r.ok) return r;
  const faceTags: FaceTagMap = new Map(r.faceTags);
  return { ok: true, compound: r.projectorInput, faceTags };
}

/**
 * Cut a part (by partId) with a polyline of N axis-aligned half-spaces (one per
 * stepped-section segment, Drawing F1.2). Each plane is derived upstream from
 * one `StepSegment` via `deriveStepPlanes`. The kernel worker runs N sequential
 * BRepAlgoAPI_Cut_3 calls and tessellates the result.
 *
 * Throws 'stepped-section-invariant-violated' (relayed from kernel) when
 * planes.length < 2 or > 8. Returns { ok: false, reason: 'empty' } when the
 * cumulative cut produces no solid; never returns 'tangent' (per-segment
 * tangents are skipped non-fatally in the kernel).
 */
export async function cutByStepSegments(
  partId: string,
  planes: readonly Plane[],
  arrowDirection: -1 | 1 = 1,
): Promise<CutResult> {
  const kernel = useAppStore.getState().kernel;
  if (!kernel) throw new Error('cutByStepSegments: kernel not ready');
  const r = await kernel.cutByStepSegments(partId, planes, arrowDirection);
  if (!r.ok) return r;
  const faceTags: FaceTagMap = new Map(r.faceTags);
  return { ok: true, compound: r.projectorInput, faceTags };
}

/**
 * Stepped-section assembly variant of cutByStepSegments. Cuts every cached part
 * in the assembly with the same N-segment polyline and merges per-component
 * results.
 */
export async function cutAssemblyByStepSegments(
  asmId: string,
  planes: readonly Plane[],
  arrowDirection: -1 | 1 = 1,
): Promise<CutResult> {
  const kernel = useAppStore.getState().kernel;
  if (!kernel) throw new Error('cutAssemblyByStepSegments: kernel not ready');
  const r = await kernel.cutAssemblyByStepSegments(asmId, planes, arrowDirection);
  if (!r.ok) return r;
  const faceTags: FaceTagMap = new Map(r.faceTags);
  return { ok: true, compound: r.projectorInput, faceTags };
}

/** Pose-aware components-based assembly section cut (full/half). */
export async function cutAssemblyComponentsBySectionPlane(
  components: readonly AssemblyComponentInput[],
  plane: Plane,
  arrowDirection: -1 | 1 = 1,
  splitPlane?: Plane,
  splitSide?: -1 | 1,
): Promise<CutResult> {
  const kernel = useAppStore.getState().kernel;
  if (!kernel) throw new Error('cutAssemblyComponentsBySectionPlane: kernel not ready');
  const r = await kernel.cutAssemblyComponentsBySectionPlane(components, plane, arrowDirection, splitPlane, splitSide);
  if (!r.ok) return r;
  return { ok: true, compound: r.projectorInput, faceTags: new Map(r.faceTags) };
}

/** Pose-aware components-based assembly stepped-section cut. */
export async function cutAssemblyComponentsByStepSegments(
  components: readonly AssemblyComponentInput[],
  planes: readonly Plane[],
  arrowDirection: -1 | 1 = 1,
): Promise<CutResult> {
  const kernel = useAppStore.getState().kernel;
  if (!kernel) throw new Error('cutAssemblyComponentsByStepSegments: kernel not ready');
  const r = await kernel.cutAssemblyComponentsByStepSegments(components, planes, arrowDirection);
  if (!r.ok) return r;
  return { ok: true, compound: r.projectorInput, faceTags: new Map(r.faceTags) };
}
