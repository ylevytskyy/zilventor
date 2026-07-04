import { describe, it, expect } from 'vitest';
import { flipBoreFace, faceExtents } from '../bore';
import type { BoreOp } from '../bore';

/**
 * flipBoreFace — Step 1 of 3 for the ratified "Flip bore face" feature
 * (docs/superpowers/plans/2026-07-04-flip-fence-ratification.md, Q1=A/Q2=A/Q3=D/Q4=C).
 *
 * Mirrors renderPanelManufacturingDxf.ts's boreToFlat Bottom-face convention
 * (pinned in renderPanelManufacturingDxf.spec.ts: v' = vLen - v, u unchanged),
 * applied symmetrically Top<->Bottom. No-op for the four edge faces.
 */
const PANEL_DIMS = { length: 800, width: 600, thickness: 18 };

function makeBore(role: 'Top' | 'Bottom' | 'Front' | 'Back' | 'Left' | 'Right', u: number, v: number): BoreOp {
  return {
    id: 'probe', face: { featureId: 'panel', role, instance: 0 },
    u, v, diameter: 7, depth: 'throughAll', role: 'confirmat-face',
    connectorId: 'confirmat-0', connectorKind: 'confirmat',
  };
}

describe('flipBoreFace', () => {
  it('flips Top -> Bottom, mirrors v (u unchanged), marks edited, new face object', () => {
    const bore = makeBore('Top', 10, 20); // 800x600 panel, vLen(Top)=width=600
    const flipped = flipBoreFace(bore, PANEL_DIMS);
    expect(flipped.face.role).toBe('Bottom');
    expect(flipped.u).toBe(10);
    expect(flipped.v).toBe(580); // 600 - 20
    expect(flipped.edited).toBe(true);
    expect(flipped.face).not.toBe(bore.face);
  });

  it('flips Bottom -> Top with the same mirror', () => {
    const bore = makeBore('Bottom', 10, 20);
    const flipped = flipBoreFace(bore, PANEL_DIMS);
    expect(flipped.face.role).toBe('Top');
    expect(flipped.u).toBe(10);
    expect(flipped.v).toBe(580); // 600 - 20
    expect(flipped.edited).toBe(true);
  });

  it('vLen is role-symmetric for Top and Bottom (computed, not assumed)', () => {
    const topExtents = faceExtents(PANEL_DIMS, 'Top');
    const bottomExtents = faceExtents(PANEL_DIMS, 'Bottom');
    expect(topExtents.vLen).toBe(bottomExtents.vLen);
    expect(topExtents.vLen).toBe(PANEL_DIMS.width);
  });

  it.each(['Front', 'Back', 'Left', 'Right'] as const)('is a no-op (same reference) for %s', (role) => {
    const bore = makeBore(role, 10, 20);
    const flipped = flipBoreFace(bore, PANEL_DIMS);
    expect(flipped).toBe(bore);
    expect(flipped.edited).toBeUndefined();
  });

  it('does not mutate the input bore on the flip path', () => {
    const bore = makeBore('Top', 10, 20);
    flipBoreFace(bore, PANEL_DIMS);
    expect(bore.face.role).toBe('Top');
    expect(bore.v).toBe(20);
    expect(bore.edited).toBeUndefined();
  });
});
