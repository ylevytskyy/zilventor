import type { SketchPrimitive, SketchConstraint } from '@zilventor/shared';
import type { SnapEvent } from './types';

export async function inferFromSnaps(
  p: SketchPrimitive,
  snapEvents: SnapEvent[]
): Promise<SketchConstraint[]> {
  const out: SketchConstraint[] = [];
  for (const ev of snapEvents) {
    if (ev.kind === 'endpoint') {
      // Our side: for line/arc the most recently committed endpoint is 'end'; for other kinds use 'center'.
      const myAnchor: 'start' | 'end' | 'center' = p.kind === 'line' || p.kind === 'arc' ? 'end' : 'center';
      // Sort sides lexicographically so ID is stable regardless of order — matches inferFromGeometry pattern.
      const keyA = `${p.id}-${myAnchor}`;
      const keyB = `${ev.primitiveId}-${ev.anchor}`;
      const [sideL, sideR] = keyA <= keyB
        ? [{ primitiveId: p.id, anchor: myAnchor }, { primitiveId: ev.primitiveId, anchor: ev.anchor }]
        : [{ primitiveId: ev.primitiveId, anchor: ev.anchor }, { primitiveId: p.id, anchor: myAnchor }];
      out.push({
        id: `c-snap-coi-${sideL.primitiveId}-${sideL.anchor}-${sideR.primitiveId}-${sideR.anchor}`,
        kind: 'coincident',
        a: { primitiveId: sideL.primitiveId, anchor: sideL.anchor },
        b: { primitiveId: sideR.primitiveId, anchor: sideR.anchor },
        source: 'auto-snap',
      });
    } else if (ev.kind === 'axis') {
      if (p.kind !== 'line') continue;
      if (ev.axis === 'h') {
        out.push({ id: `c-snap-h-${p.id}`, kind: 'horizontal', line: p.id, source: 'auto-snap' });
      } else {
        out.push({ id: `c-snap-v-${p.id}`, kind: 'vertical', line: p.id, source: 'auto-snap' });
      }
    }
  }
  return out;
}
