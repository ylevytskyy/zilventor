import type { OcctInstance } from './occtLoader';
import type { OcctShape } from './SolidOps';

/**
 * Reports whether `shape` is a valid, manifold (closed) B-Rep — i.e. safe to
 * bore, nest, or export. Wraps `ShapeAnalysis_Shell` (`LoadShells` +
 * `CheckOrientedShells(shape, alsofree=true, checkinternaledges=false)` +
 * `HasFreeEdges()`): a free edge (an edge bordering only one face, instead of
 * two) means the shell is open, i.e. not a closed manifold.
 *
 * Per D2 (P10 R1 hardening plan), the semantic the caller needs is "closed
 * manifold", not full B-Rep validity — `BRepCheck_Analyzer` (even with
 * GeomControls=false) additionally re-derives per-edge/per-face geometric
 * continuity across the whole compound and measured ~45% import overhead on
 * a 753KB fixture. `ShapeAnalysis_Shell`'s free-edge count is the same
 * topology signal at a fraction of the cost (pure edge/face adjacency
 * traversal, no per-entity geometric re-derivation).
 *
 * Existing kernel idiom for raw OCCT classes (SolidOps.ts): `new oc.ClassName_N(...)`
 * → call → explicit `.delete()`.
 */
export function checkManifold(oc: OcctInstance, shape: OcctShape): boolean {
  const analyzer = new oc.ShapeAnalysis_Shell();
  try {
    analyzer.LoadShells(shape.handle as never);
    analyzer.CheckOrientedShells(shape.handle as never, true as never, false as never);
    return !analyzer.HasFreeEdges();
  } finally {
    analyzer.delete();
  }
}
