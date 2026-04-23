import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';

describe('OCCT loader (integration)', () => {
  let occt: OcctInstance;
  beforeAll(async () => {
    occt = await loadOcct();
  }, 60_000);

  it('instantiates and exposes gp_Pnt', () => {
    expect(occt).toBeDefined();
    const p = new occt.gp_Pnt_3(1, 2, 3);
    expect(p.X()).toBe(1);
    expect(p.Y()).toBe(2);
    expect(p.Z()).toBe(3);
    p.delete();
  });
});
