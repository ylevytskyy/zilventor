import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import uk from './locales/uk.json';

/** Recursively collect dotted key paths from a nested translation object. */
function keyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v !== null && typeof v === 'object'
      ? keyPaths(v as Record<string, unknown>, path)
      : [path];
  });
}

describe('locale parity', () => {
  it('en.json and uk.json have identical key sets', () => {
    const enKeys = keyPaths(en).sort();
    const ukKeys = keyPaths(uk).sort();
    const missingInUk = enKeys.filter((k) => !ukKeys.includes(k));
    const missingInEn = ukKeys.filter((k) => !enKeys.includes(k));
    expect({ missingInUk, missingInEn }).toEqual({ missingInUk: [], missingInEn: [] });
  });

  it('no Ukrainian value is empty', () => {
    const empties = keyPaths(uk).filter((path) => {
      const val = path.split('.').reduce<any>((o, k) => o?.[k], uk);
      return typeof val === 'string' && val.trim() === '';
    });
    expect(empties).toEqual([]);
  });
});
