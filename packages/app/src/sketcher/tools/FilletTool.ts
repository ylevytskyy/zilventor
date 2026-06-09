import type { SketchConstraint, SketchPrimitive } from '@zilventor/shared';
import { computeFillet, diffLine } from '../geometry/fillet';
import { pickPrimitiveAt } from './pick';

type Line = Extract<SketchPrimitive, { kind: 'line' }>;
type Pt = { x: number; y: number };

export type FilletToolOpts = {
  radius: number;
  emitArc: (arc: Extract<SketchPrimitive, { kind: 'arc' }>) => Promise<void> | void;
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

  async onPointerClick(pt: Pt): Promise<void> {
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

    // Emit the arc primitive first and AWAIT completion so that AddPrimitiveCommand's
    // setActivePart(kernelSnapshot) settles before the trim patches are applied.
    // Without this sequencing, the stale kernel snapshot (taken before UpdatePrimitive runs)
    // overwrites the trim coord patches — the pre-existing race fixed here.
    await this.opts.emitArc(arc);

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

    // Emit two coincident constraints pinning arc endpoints to the trimmed line endpoints.
    // arc.startAngle corresponds to one tangent point (t1 or t2 depending on angle swap in
    // computeFillet). Determine the mapping by comparing the arc's start/end geometric points
    // to each line's changed (corner-trimmed) endpoint.
    const arcStartPt = {
      x: arc.cx + arc.r * Math.cos(arc.startAngle),
      y: arc.cy + arc.r * Math.sin(arc.startAngle),
    };

    // Detect which endpoint of each line was the corner by comparing trimmed vs original.
    const l1CornerIsStart = trimmedL1.x1 !== l1.x1 || trimmedL1.y1 !== l1.y1;
    const l1TrimmedPt = l1CornerIsStart
      ? { x: trimmedL1.x1, y: trimmedL1.y1 }
      : { x: trimmedL1.x2, y: trimmedL1.y2 };

    // If the arc start point is close to l1's trimmed endpoint, map arc.start ↔ l1, arc.end ↔ l2.
    // Otherwise map arc.start ↔ l2, arc.end ↔ l1.
    const distArcStartToL1 = Math.hypot(arcStartPt.x - l1TrimmedPt.x, arcStartPt.y - l1TrimmedPt.y);
    const arcStartMapsToL1 = distArcStartToL1 < arc.r * 0.01 + 1e-4;

    const l2CornerIsStart = trimmedL2.x1 !== l2.x1 || trimmedL2.y1 !== l2.y1;
    const l1Anchor: 'start' | 'end' = l1CornerIsStart ? 'start' : 'end';
    const l2Anchor: 'start' | 'end' = l2CornerIsStart ? 'start' : 'end';

    if (arcStartMapsToL1) {
      this.opts.emitConstraint({
        id: `c-co-${arc.id}-start`,
        kind: 'coincident',
        a: { primitiveId: arc.id, anchor: 'start' },
        b: { primitiveId: l1.id, anchor: l1Anchor },
      });
      this.opts.emitConstraint({
        id: `c-co-${arc.id}-end`,
        kind: 'coincident',
        a: { primitiveId: arc.id, anchor: 'end' },
        b: { primitiveId: l2.id, anchor: l2Anchor },
      });
    } else {
      this.opts.emitConstraint({
        id: `c-co-${arc.id}-start`,
        kind: 'coincident',
        a: { primitiveId: arc.id, anchor: 'start' },
        b: { primitiveId: l2.id, anchor: l2Anchor },
      });
      this.opts.emitConstraint({
        id: `c-co-${arc.id}-end`,
        kind: 'coincident',
        a: { primitiveId: arc.id, anchor: 'end' },
        b: { primitiveId: l1.id, anchor: l1Anchor },
      });
    }
  }

  onEscapePressed(): void {
    this.firstPick = null;
  }
}
