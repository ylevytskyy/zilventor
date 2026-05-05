// packages/app/src/kernel/cutBySectionPlane.ts
//
// App-level wrapper stubs for the kernel section-cut pipeline.
// The real implementations run in the kernel worker (via KernelClient).
// These stubs are thin async wrappers used by AddSectionViewCommand;
// in tests they are fully mocked via vi.mock.

import type { Plane } from '@zilventor/shared/src/drawing/sectionPlane';
import type { FaceTagMap } from '@zilventor/shared/src/drawing/projectSectionView';

export type CutResult =
  | { ok: true; compound: unknown; faceTags: FaceTagMap }
  | { ok: false; reason: 'tangent' | 'empty' };

/**
 * Cut a part BREP (identified by file path) with the given plane.
 * Delegates to the kernel worker. Returns a serialised cut compound + face tags.
 */
export async function cutBySectionPlane(
  _sourceId: string,
  _plane: Plane,
): Promise<CutResult> {
  // TODO: delegate to KernelClient when wired in Phase 7+
  throw new Error('cutBySectionPlane: kernel worker not yet wired');
}

/**
 * Cut every part in an assembly by the given plane and merge results.
 */
export async function cutAssemblyBySectionPlane(
  _sourceId: string,
  _plane: Plane,
): Promise<CutResult> {
  // TODO: delegate to KernelClient when wired in Phase 7+
  throw new Error('cutAssemblyBySectionPlane: kernel worker not yet wired');
}
