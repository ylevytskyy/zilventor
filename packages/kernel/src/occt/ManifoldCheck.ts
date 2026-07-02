import type { OcctInstance } from './occtLoader';
import type { OcctShape } from './SolidOps';

/**
 * Reports whether `shape` is a valid, manifold (closed) B-Rep — i.e. safe to
 * bore, nest, or export. Wraps `BRepCheck_Analyzer(shape, GeomControls, theIsParallel)`.
 *
 * Per D2 (P10 R1 hardening plan), this runs topology-only checks
 * (GeomControls=false — closed-shell/free-edge validity) rather than full
 * geometric self-intersection analysis (GeomControls=true), to bound
 * worst-case cost on large imported compounds. Not run in parallel
 * (theIsParallel=false) — a single shape check is not worth thread overhead.
 *
 * Existing kernel idiom for raw OCCT classes (SolidOps.ts): `new oc.ClassName_N(...)`
 * → call → explicit `.delete()`.
 */
export function checkManifold(oc: OcctInstance, shape: OcctShape): boolean {
  const analyzer = new oc.BRepCheck_Analyzer(shape.handle as never, false as never, false as never);
  try {
    return analyzer.IsValid_2();
  } finally {
    analyzer.delete();
  }
}
