import { describe, it, expect } from 'vitest';
import { ParameterRegistry } from '../ParameterRegistry';

describe('ParameterRegistry smoke', () => {
  it('constructs empty', () => {
    const r = new ParameterRegistry();
    expect(r.getAll()).toEqual([]);
  });

  it('setParameter adds a literal value', () => {
    const r = new ParameterRegistry();
    const result = r.setParameter({ name: 'd0', expression: '50', unit: 'mm' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toBe(50);
    }
  });

  it('getValue returns the computed value', () => {
    const r = new ParameterRegistry();
    r.setParameter({ name: 'width', expression: '100', unit: 'mm' });
    expect(r.getValue('width')).toBe(100);
  });
});
