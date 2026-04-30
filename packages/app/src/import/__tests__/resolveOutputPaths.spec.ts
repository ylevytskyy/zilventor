import { describe, expect, it } from 'vitest';
import { mapInputPathToOpfs, avoidCollision } from '../resolveOutputPaths';

describe('mapInputPathToOpfs', () => {
  it('part: a/b.ipt.json → a/b.zipt', () => {
    const r = mapInputPathToOpfs('a/b.ipt.json');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.path).toBe('a/b.zipt');
  });

  it('asm: a/b.iam.json → a/b.ziasm', () => {
    const r = mapInputPathToOpfs('a/b.iam.json');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.path).toBe('a/b.ziasm');
  });

  it('preserves nested folders', () => {
    const r = mapInputPathToOpfs('Cabinet/Door/Hinge.ipt.json');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.path).toBe('Cabinet/Door/Hinge.zipt');
  });

  it('preserves _external/ prefix', () => {
    const r = mapInputPathToOpfs('_external/Hardware/Hinge.ipt.json');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.path).toBe('_external/Hardware/Hinge.zipt');
  });

  it('rejects .. path segments', () => {
    const r = mapInputPathToOpfs('../leak.ipt.json');
    expect(r.ok).toBe(false);
  });

  it('rejects absolute paths', () => {
    const r = mapInputPathToOpfs('/abs/x.ipt.json');
    expect(r.ok).toBe(false);
  });

  it('rejects non-importer extensions', () => {
    const r = mapInputPathToOpfs('a/b.json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/extension/);
  });
});

describe('avoidCollision', () => {
  it('returns target unchanged when it does not exist', () => {
    expect(avoidCollision('a/b.zipt', () => false)).toBe('a/b.zipt');
  });

  it('appends __<hash> to the basename when target exists', () => {
    let calls = 0;
    const exists = (p: string) => {
      calls++;
      return p === 'a/b.zipt';
    };
    const result = avoidCollision('a/b.zipt', exists);
    expect(result).not.toBe('a/b.zipt');
    expect(result).toMatch(/^a\/b__[a-z0-9]{4}\.zipt$/);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('handles paths without extension', () => {
    let first = true;
    const exists = (p: string) => {
      if (first && p === 'a/b') {
        first = false;
        return true;
      }
      return false;
    };
    const result = avoidCollision('a/b', exists);
    expect(result).toMatch(/^a\/b__[a-z0-9]{4}$/);
  });
});
