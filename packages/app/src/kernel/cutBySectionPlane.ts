// packages/app/src/kernel/cutBySectionPlane.ts
//
// App-level bridge to the kernel section-cut pipeline.
// Delegates to the kernel worker via KernelClient (Comlink proxy).
// In tests these functions are mocked via vi.mock.

import type { Plane } from '@zilventor/shared/src/drawing/sectionPlane';
import type { FaceTagMap } from '@zilventor/shared/src/drawing/projectSectionView';
import type { ProjectorInput } from '@zilventor/shared';
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
