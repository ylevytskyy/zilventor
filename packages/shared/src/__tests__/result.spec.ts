import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr, mapOk, unwrap } from '../result';

describe('Result', () => {
  it('ok wraps a value and isOk returns true', () => {
    const r = ok(42);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    if (isOk(r)) expect(r.value).toBe(42);
  });

  it('err wraps an error and isErr returns true', () => {
    const r = err('boom');
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error).toBe('boom');
  });

  it('mapOk transforms only the ok branch', () => {
    expect(mapOk(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
    expect(mapOk(err('x'), (n: number) => n * 3)).toEqual({ ok: false, error: 'x' });
  });

  it('unwrap returns value on ok and throws on err', () => {
    expect(unwrap(ok('hi'))).toBe('hi');
    expect(() => unwrap(err('oops'))).toThrow('oops');
  });
});
