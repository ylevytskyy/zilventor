import { describe, it, expect } from 'vitest';
import { isCustomTextureDef, type CustomTextureDef } from '../custom-texture-def';

describe('CustomTextureDef', () => {
  const valid: CustomTextureDef = {
    id: 'custom-01HZ', name: 'My Oak',
    physicalWidthMm: 1000, physicalHeightMm: 800,
    albedoBlobId: 'tex-abc',
  };
  it('accepts a minimal albedo-only def', () => {
    expect(isCustomTextureDef(valid)).toBe(true);
  });
  it('accepts optional normal + roughness blob ids', () => {
    expect(isCustomTextureDef({ ...valid, normalBlobId: 'n1', roughnessBlobId: 'r1' })).toBe(true);
  });
  it('rejects a def missing albedoBlobId', () => {
    const { albedoBlobId: _omit, ...rest } = valid;
    expect(isCustomTextureDef(rest)).toBe(false);
  });
  it('rejects a non-positive physical width', () => {
    expect(isCustomTextureDef({ ...valid, physicalWidthMm: 0 })).toBe(false);
  });
  it('rejects an empty id', () => {
    expect(isCustomTextureDef({ ...valid, id: '' })).toBe(false);
  });
});
