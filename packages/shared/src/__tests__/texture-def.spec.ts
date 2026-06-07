import { describe, it, expect } from 'vitest';
import { BUILTIN_TEXTURE_DEFS, findTextureDef } from '../texture-def';

describe('BUILTIN_TEXTURE_DEFS', () => {
  it('has at least 6 entries', () => {
    expect(BUILTIN_TEXTURE_DEFS.length).toBeGreaterThanOrEqual(6);
  });
  it('every entry has required fields with valid values', () => {
    for (const def of BUILTIN_TEXTURE_DEFS) {
      expect(typeof def.id).toBe('string');
      expect(def.id.length).toBeGreaterThan(0);
      expect(typeof def.name).toBe('string');
      expect(def.name.length).toBeGreaterThan(0);
      expect(typeof def.albedoUrl).toBe('string');
      expect(def.albedoUrl.length).toBeGreaterThan(0);
      expect(def.physicalWidthMm).toBeGreaterThan(0);
      expect(def.physicalHeightMm).toBeGreaterThan(0);
    }
  });
  it('all ids are unique', () => {
    const ids = BUILTIN_TEXTURE_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('contains oak, walnut, beech, white-melamine, black-melamine, laminate-light', () => {
    const ids = new Set(BUILTIN_TEXTURE_DEFS.map((d) => d.id));
    for (const expected of ['oak', 'walnut', 'beech', 'white-melamine', 'black-melamine', 'laminate-light']) {
      expect(ids.has(expected)).toBe(true);
    }
  });
});

describe('findTextureDef', () => {
  it('returns the def for a known id', () => {
    const d = findTextureDef('oak');
    expect(d).toBeDefined();
    expect(d!.id).toBe('oak');
    expect(d!.albedoUrl).toBeTruthy();
  });
  it('returns undefined for an unknown id', () => {
    expect(findTextureDef('nonexistent-xyz')).toBeUndefined();
  });
});
