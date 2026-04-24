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

describe('ParameterRegistry variable references', () => {
  it('evaluates expressions that reference other parameters', () => {
    const r = new ParameterRegistry();
    r.setParameter({ name: 'a', expression: '10', unit: 'mm' });
    const r2 = r.setParameter({ name: 'b', expression: 'a * 2', unit: 'mm' });
    expect(r2.ok).toBe(true);
    expect(r.getValue('b')).toBe(20);
  });

  it('cascades changes to dependents on re-set', () => {
    const r = new ParameterRegistry();
    r.setParameter({ name: 'a', expression: '10', unit: 'mm' });
    r.setParameter({ name: 'b', expression: 'a + 1', unit: 'mm' });
    r.setParameter({ name: 'c', expression: 'b * 2', unit: 'mm' });
    expect(r.getValue('c')).toBe(22);
    r.setParameter({ name: 'a', expression: '100', unit: 'mm' });
    expect(r.getValue('b')).toBe(101);
    expect(r.getValue('c')).toBe(202);
  });

  it('detects a direct self-reference cycle', () => {
    const r = new ParameterRegistry();
    const res = r.setParameter({ name: 'a', expression: 'a + 1', unit: 'mm' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('cycle');
  });

  it('detects a 3-hop cycle a → b → c → a', () => {
    const r = new ParameterRegistry();
    r.setParameter({ name: 'a', expression: '1', unit: 'mm' });
    r.setParameter({ name: 'b', expression: 'a', unit: 'mm' });
    r.setParameter({ name: 'c', expression: 'b', unit: 'mm' });
    const res = r.setParameter({ name: 'a', expression: 'c + 1', unit: 'mm' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('cycle');
  });

  it('rejects unknown variables', () => {
    const r = new ParameterRegistry();
    const res = r.setParameter({ name: 'a', expression: 'b + 1', unit: 'mm' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('unknown-var');
  });

  it('rejects non-whitelisted functions', () => {
    const r = new ParameterRegistry();
    const res = r.setParameter({ name: 'a', expression: 'sin(0)', unit: 'mm' });
    expect(res.ok).toBe(false);
    // either parse-error OR a specific whitelist-check — either is acceptable; assert it fails.
  });

  it('accepts whitelisted functions min/max/abs/sqrt/floor/ceil/round', () => {
    const r = new ParameterRegistry();
    for (const e of ['min(1,2)', 'max(1,2)', 'abs(-5)', 'sqrt(16)', 'floor(3.7)', 'ceil(3.2)', 'round(3.5)']) {
      const res = r.setParameter({ name: `p_${e.replace(/\W/g, '')}`, expression: e, unit: 'mm' });
      expect(res.ok, `expression '${e}' should parse`).toBe(true);
    }
  });
});

describe('ParameterRegistry rename', () => {
  it('renames a parameter and updates all references', () => {
    const r = new ParameterRegistry();
    r.setParameter({ name: 'a', expression: '10', unit: 'mm' });
    r.setParameter({ name: 'b', expression: 'a + 1', unit: 'mm' });
    const res = r.renameParameter('a', 'width');
    expect(res.ok).toBe(true);
    expect(r.getValue('width')).toBe(10);
    expect(r.getValue('b')).toBe(11);
    expect(r.getValue('a')).toBeUndefined();
    const b = r.getAll().find((p) => p.name === 'b')!;
    expect(b.expression).toContain('width');
  });

  it('rejects rename that would collide with existing name', () => {
    const r = new ParameterRegistry();
    r.setParameter({ name: 'a', expression: '10', unit: 'mm' });
    r.setParameter({ name: 'b', expression: '20', unit: 'mm' });
    const res = r.renameParameter('a', 'b');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('name-in-use');
  });
});

describe('ParameterRegistry remove', () => {
  it('removes a parameter with no references', () => {
    const r = new ParameterRegistry();
    r.setParameter({ name: 'a', expression: '10', unit: 'mm' });
    const res = r.removeParameter('a');
    expect(res.ok).toBe(true);
    expect(r.getValue('a')).toBeUndefined();
  });

  it('rejects removal of a referenced parameter', () => {
    const r = new ParameterRegistry();
    r.setParameter({ name: 'a', expression: '10', unit: 'mm' });
    r.setParameter({ name: 'b', expression: 'a + 1', unit: 'mm' });
    const res = r.removeParameter('a');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('referenced');
      if (res.error.code === 'referenced') expect(res.error.referencedBy).toContain('b');
    }
  });
});

describe('ParameterRegistry subscribe', () => {
  it('fires listeners on any successful mutation', () => {
    const r = new ParameterRegistry();
    let fires = 0;
    const unsub = r.subscribe(() => fires++);
    r.setParameter({ name: 'a', expression: '10', unit: 'mm' });
    r.setParameter({ name: 'a', expression: '20', unit: 'mm' });
    expect(fires).toBe(2);
    unsub();
    r.setParameter({ name: 'b', expression: '1', unit: 'mm' });
    expect(fires).toBe(2);
  });
});
