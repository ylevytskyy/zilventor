import { describe, it, expect } from 'vitest';
import { mergeBores } from './mergeBores';
import type { BoreOp } from './bore';

function makeBore(id: string, connectorId: string, u = 10, v = 5, overrides: Partial<BoreOp> = {}): BoreOp {
  return {
    id, face: { featureId: 'panel', role: 'Front', instance: 0 },
    u, v, diameter: 7, depth: 12,
    role: 'confirmat-face', connectorId, connectorKind: 'confirmat',
    ...overrides,
  };
}

describe('mergeBores', () => {
  it('returns fresh bores when existing is empty and nothing suppressed', () => {
    const fresh = [makeBore('b1', 'c0'), makeBore('b2', 'c1')];
    const result = mergeBores(fresh, [], undefined);
    expect(result).toEqual(fresh);
  });

  it('edited bore in existing is preserved when fresh has same id', () => {
    const editedBore: BoreOp = { ...makeBore('confirmat-0-A-0', 'confirmat-0'), u: 99, edited: true };
    const freshBore = makeBore('confirmat-0-A-0', 'confirmat-0');
    const result = mergeBores([freshBore], [editedBore], undefined);
    expect(result).toHaveLength(1);
    expect(result[0]!.u).toBe(99);
    expect(result[0]!.edited).toBe(true);
  });

  it('non-edited bore in existing is NOT preserved (replaced by fresh)', () => {
    const oldBore: BoreOp = { ...makeBore('b1', 'c0'), u: 50 };
    const freshBore = makeBore('b1', 'c0', 10);
    const result = mergeBores([freshBore], [oldBore], undefined);
    expect(result[0]!.u).toBe(10);
    expect('edited' in result[0]!).toBe(false);
  });

  it('suppressed connectorId removes fresh bores with that connectorId', () => {
    const fresh = [makeBore('b1', 'c0'), makeBore('b2', 'c1')];
    const result = mergeBores(fresh, [], ['c0']);
    expect(result).toHaveLength(1);
    expect(result[0]!.connectorId).toBe('c1');
  });

  it('suppressed bore id removes fresh bore with that id', () => {
    const fresh = [makeBore('bore-special', 'c0'), makeBore('b2', 'c0')];
    const result = mergeBores(fresh, [], ['bore-special']);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('b2');
  });

  it('does NOT append to existing — result equals fresh count (not fresh+existing)', () => {
    const existing = [makeBore('old1', 'c9')];
    const fresh = [makeBore('b1', 'c0'), makeBore('b2', 'c1')];
    const result = mergeBores(fresh, existing, undefined);
    // Full replacement: result length equals fresh.length (2), not fresh+existing (3).
    expect(result).toHaveLength(2);
  });

  it('exactOptionalPropertyTypes: edited bore absent key is not reified as false', () => {
    const freshBore = makeBore('b1', 'c0');
    const result = mergeBores([freshBore], [], undefined);
    // edited key must be absent, not false/undefined
    expect('edited' in result[0]!).toBe(false);
  });
});
