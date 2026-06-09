import type { SketchConstraint, SketchPrimitive } from '@zilventor/shared';
import { computeChamfer, diffLine } from '../geometry/fillet';
import { pickPrimitiveAt } from './pick';

type Line = Extract<SketchPrimitive, { kind: 'line' }>;
type Pt = { x: number; y: number };

export type ChamferToolOpts = {
  setback: number;
  emitLine: (line: Line) => Promise<void> | void;
  updateLine: (id: string, patch: Partial<Line>) => void;
  emitConstraint: (c: SketchConstraint) => void;
};

/**
 * ChamferTool — a picking tool that collects two LINE picks sharing a corner,
 * then calls computeChamfer and emits:
 *   - the chamfer connecting line primitive
 *   - trim patches for both source lines
 *   - two `coincident` constraints tying the chamfer line's endpoints to the
 *     trimmed corner endpoints of each source line
 *
 * NOT wired to the controller ribbon yet (that's Task 11).
 */
export class ChamferTool {
  private primitives: SketchPrimitive[] = [];
  private firstPick: Line | null = null;

  constructor(private readonly opts: ChamferToolOpts) {}

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

    // Second pick — attempt to compute the chamfer.
    const l1 = this.firstPick;
    const l2 = prim;
    this.firstPick = null; // reset before emit so escape state is clean on re-entry

    const result = computeChamfer(l1, l2, this.opts.setback);
    if (!result) return; // lines don't share a corner or setback is too large — reset, no emit

    const { line, trimmedL1, trimmedL2, l1CornerAnchor, l2CornerAnchor } = result;

    // Emit the chamfer connecting line first and AWAIT completion so that
    // AddPrimitiveCommand's setActivePart(kernelSnapshot) settles before trim patches apply.
    // Same sequencing fix as FilletTool — see FilletTool.ts for full explanation.
    await this.opts.emitLine(line);

    // Emit trim patches — only the fields that changed vs the originals.
    this.opts.updateLine(l1.id, diffLine(l1, trimmedL1));
    this.opts.updateLine(l2.id, diffLine(l2, trimmedL2));

    // Emit coincident constraints tying chamfer line endpoints to source-line corner endpoints.
    // Chamfer line: p1 = line start, p2 = line end.
    // p1 sits at the trimmed corner of l1; p2 sits at the trimmed corner of l2.
    const c1Id = `c-coin-${line.id}-${l1.id}`;
    this.opts.emitConstraint({
      id: c1Id,
      kind: 'coincident',
      a: { primitiveId: line.id, anchor: 'start' },
      b: { primitiveId: l1.id, anchor: l1CornerAnchor },
    });

    const c2Id = `c-coin-${line.id}-${l2.id}`;
    this.opts.emitConstraint({
      id: c2Id,
      kind: 'coincident',
      a: { primitiveId: line.id, anchor: 'end' },
      b: { primitiveId: l2.id, anchor: l2CornerAnchor },
    });
  }

  onEscapePressed(): void {
    this.firstPick = null;
  }
}
