// packages/app/src/drawing/__tests__/fingerprintPartState.spec.ts
import { describe, it, expect } from 'vitest';
import { fingerprintPartState } from '../fingerprintPartState';
import type { PartDocument } from '@zilventor/shared';

function makePart(overrides?: Partial<PartDocument>): PartDocument {
  return {
    id: 'p1', name: 'Part', units: 'mm',
    parameters: {},
    featureTree: [],
    properties: {},
    materials: [],
    hardware: [],
    ...overrides,
  };
}

describe('fingerprintPartState', () => {
  it('returns a non-empty string', () => {
    expect(typeof fingerprintPartState(makePart())).toBe('string');
    expect(fingerprintPartState(makePart()).length).toBeGreaterThan(0);
  });

  it('same featureTree + parameters → same hash', () => {
    const a = makePart({ featureTree: [{ id: 'f1', kind: 'extrude' } as never] });
    const b = makePart({ featureTree: [{ id: 'f1', kind: 'extrude' } as never] });
    expect(fingerprintPartState(a)).toBe(fingerprintPartState(b));
  });

  it('different featureTree → different hash', () => {
    const a = makePart({ featureTree: [{ id: 'f1', kind: 'extrude' } as never] });
    const b = makePart({ featureTree: [{ id: 'f2', kind: 'extrude' } as never] });
    expect(fingerprintPartState(a)).not.toBe(fingerprintPartState(b));
  });

  it('different parameters → different hash', () => {
    const a = makePart({ parameters: { w: { name: 'w', value: 10, unit: 'mm' } as never } });
    const b = makePart({ parameters: { w: { name: 'w', value: 20, unit: 'mm' } as never } });
    expect(fingerprintPartState(a)).not.toBe(fingerprintPartState(b));
  });

  it('name/id/materials changes do NOT change the hash (only featureTree+parameters matter)', () => {
    const a = makePart({ id: 'p1', name: 'A', materials: [] });
    const b = makePart({ id: 'p2', name: 'B', materials: [{ id: 'm1', name: 'Oak', defaultThickness: 18, color: '#fff' }] });
    expect(fingerprintPartState(a)).toBe(fingerprintPartState(b));
  });
});
