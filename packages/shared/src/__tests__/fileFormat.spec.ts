import { describe, it, expect } from 'vitest';
import { CURRENT_FORMAT_VERSION, migrateManifest } from '../fileFormat';

describe('fileFormat', () => {
  it('exports a locked current version', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(1);
  });

  it('returns the manifest unchanged when already current', () => {
    const m = { formatVersion: 1, kind: 'part' as const };
    expect(migrateManifest(m)).toEqual(m);
  });

  it('throws a typed error when the manifest is from a newer version', () => {
    const m = { formatVersion: 99, kind: 'part' as const };
    expect(() => migrateManifest(m)).toThrow(/newer/i);
  });

  it('throws when formatVersion is missing', () => {
    expect(() => migrateManifest({} as unknown as { formatVersion: number })).toThrow(/formatVersion/);
  });
});
