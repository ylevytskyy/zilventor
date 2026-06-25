import { describe, it, expect } from 'vitest';
import type { BoreRole, BoreConnectorKind, BoreOp } from '../bore';

describe('bore.ts — tandem role/kind members', () => {
  it('BoreRole accepts tandem-cabinet, tandem-drawer-bottom, tandem-drawer-back', () => {
    const r1: BoreRole = 'tandem-cabinet';
    const r2: BoreRole = 'tandem-drawer-bottom';
    const r3: BoreRole = 'tandem-drawer-back';
    expect(r1).toBe('tandem-cabinet');
    expect(r2).toBe('tandem-drawer-bottom');
    expect(r3).toBe('tandem-drawer-back');
  });

  it('BoreConnectorKind accepts tandem', () => {
    const k: BoreConnectorKind = 'tandem';
    expect(k).toBe('tandem');
  });

  it('BoreOp round-trips a tandem-cabinet bore with correct shape', () => {
    const b: BoreOp = {
      id: 'tc-0',
      face: { featureId: 'panel', role: 'Top', instance: 0 },
      u: 150,
      v: 37,
      diameter: 5,
      depth: 12,
      role: 'tandem-cabinet',
      connectorId: 'tandem-0-L',
      connectorKind: 'tandem',
    };
    expect(b.role).toBe('tandem-cabinet');
    expect(b.connectorKind).toBe('tandem');
  });
});
