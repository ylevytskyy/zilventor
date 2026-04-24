import type { FaceName } from '@zilventor/shared';
import type { OcctShape } from './SolidOps';

export type NamedShape = {
  shape: OcctShape;
  /** Parallel array of (name, TopoDS_Face handle). Linear lookup is fine
   *  at the scale of a single part's face count (dozens, not millions). */
  faceNames: Array<{ name: FaceName; face: unknown }>;
};

/**
 * Construct a FaceName. `instance` defaults to 0 (so roles with a single
 * face don't need the caller to pass 0 explicitly).
 */
export function namedFace(featureId: string, role: string, instance: number = 0): FaceName {
  return { featureId, role, instance };
}

export function faceNamesEqual(a: FaceName, b: FaceName): boolean {
  return a.featureId === b.featureId && a.role === b.role && (a.instance ?? 0) === (b.instance ?? 0);
}

/**
 * Attach a name to a face on a NamedShape. Mutates `nm.faceNames`.
 */
export function attachName(nm: NamedShape, face: unknown, name: FaceName): void {
  nm.faceNames.push({ name, face });
}

/** Re-export `canonicalEdgeName` so callers can import everything naming-
 *  related from this module. */
export { canonicalEdgeName } from '@zilventor/shared';
