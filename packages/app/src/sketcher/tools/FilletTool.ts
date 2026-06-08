import type { SketchConstraint, SketchPrimitive } from '@zilventor/shared';
import { computeFillet } from '../geometry/fillet';
import { pickPrimitiveAt } from './pick';

type Line = Extract<SketchPrimitive, { kind: 'line' }>;
type Pt = { x: number; y: number };

export type FilletToolOpts = {
  radius: number;
  emitArc: (arc: Extract<SketchPrimitive, { kind: 'arc' }>) => void;
  updateLine: (id: string, patch: Partial<Line>) => void;
  emitConstraint: (c: SketchConstraint) => void;
};

/**
 * FilletTool — a picking tool that collects two LINE picks sharing a corner,
 * then calls computeFillet and emits:
 *   - the fillet arc primitive
 *   - trim patches for both source lines
 *   - two `tangent` constraints (one per line/arc pair)
 *   - one `dim-radius` constraint on the arc
 *
 * NOT wired to the controller ribbon yet (that's Task 11).
 */
export class FilletTool {
  private primitives: SketchPrimitive[] = [];
  private firstPick: Line | null = null;

  constructor(private readonly opts: FilletToolOpts) {}

  setPrimitives(primitives: SketchPrimitive[]): void {
    this.primitives = primitives;
  }

  onPointerClick(pt: Pt): void {
    const hit = pickPrimitiveAt(this.primitives, pt);
    if (!hit) return;

    const prim = this.primitives.find((p) => p.id === hit.primitiveId);
    if (!prim || prim.kind !== 'line') return;

    if (!this.firstPick) {
      this.firstPick = prim;
      return;
    }

    // Second pick — attempt to compute the fillet.
    const l1 = this.firstPick;
    const l2 = prim;
    this.firstPick = null; // reset before emit so escape state is clean on re-entry

    const result = computeFillet(l1, l2, this.opts.radius);
    if (!result) return; // lines don't share a corner or fillet is degenerate — reset, no emit

    const { arc, trimmedL1, trimmedL2 } = result;

    // Emit the arc primitive.
    this.opts.emitArc(arc);

    // Emit trim patches — only the fields that changed vs the originals.
    this.opts.updateLine(l1.id, diffLine(l1, trimmedL1));
    this.opts.updateLine(l2.id, diffLine(l2, trimmedL2));

    // Emit tangent constraints.
    const t1Id = `c-tan-${l1.id}-${arc.id}`;
    const t2Id = `c-tan-${l2.id}-${arc.id}`;
    this.opts.emitConstraint({ id: t1Id, kind: 'tangent', line: l1.id, arc: arc.id });
    this.opts.emitConstraint({ id: t2Id, kind: 'tangent', line: l2.id, arc: arc.id });

    // Emit dim-radius constraint.
    const paramName = `r-fil-${arc.id}`;
    this.opts.emitConstraint({
      id: `c-dr-${arc.id}`,
      kind: 'dim-radius',
      circle: arc.id,
      value: { kind: 'literal', value: this.opts.radius },
      paramName,
    });
  }

  onEscapePressed(): void {
    this.firstPick = null;
  }
}

/** Returns only the keys in `next` that differ from `orig`. */
function diffLine(orig: Line, next: Line): Partial<Line> {
  const patch: Partial<Line> = {};
  if (next.x1 !== orig.x1) patch.x1 = next.x1;
  if (next.y1 !== orig.y1) patch.y1 = next.y1;
  if (next.x2 !== orig.x2) patch.x2 = next.x2;
  if (next.y2 !== orig.y2) patch.y2 = next.y2;
  return patch;
}
