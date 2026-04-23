import type { SketchPrimitive, SketchConstraint } from '@zilventor/shared';
import type { SnapEvent } from './types';

export async function inferFromSnaps(
  _p: SketchPrimitive,
  _snapEvents: SnapEvent[]
): Promise<SketchConstraint[]> {
  // Stub — fully implemented in Task 12.
  return [];
}
