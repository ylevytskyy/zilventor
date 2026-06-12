import { it, expect, vi, beforeEach } from 'vitest';
import { createCustomTextureRegistry } from '../customTextureRegistry';
import type { CustomTextureDef } from '@zilventor/shared';

const created: string[] = [];
const revoked: string[] = [];
beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  (globalThis as any).URL.createObjectURL = vi.fn(() => {
    const u = `blob:${created.length}`;
    created.push(u);
    return u;
  });
  (globalThis as any).URL.revokeObjectURL = vi.fn((u: string) => {
    revoked.push(u);
  });
});

const def: CustomTextureDef = {
  id: 'custom-1',
  name: 'Mine',
  physicalWidthMm: 1000,
  physicalHeightMm: 800,
  albedoBlobId: 'a',
};

it('builds a runtime TextureDef with blob URLs + physical mm from container bytes', () => {
  const reg = createCustomTextureRegistry();
  reg.register([def], { a: new Uint8Array([1]) });
  const td = reg.get('custom-1')!;
  expect(td.albedoUrl).toMatch(/^blob:/);
  expect(td.physicalWidthMm).toBe(1000);
  expect(td.physicalHeightMm).toBe(800);
  expect(td.normalUrl).toBeUndefined();
});

it('includes optional normal/roughness URLs when blob ids present', () => {
  const reg = createCustomTextureRegistry();
  reg.register(
    [{ ...def, normalBlobId: 'n', roughnessBlobId: 'r' }],
    { a: new Uint8Array([1]), n: new Uint8Array([2]), r: new Uint8Array([3]) },
  );
  const td = reg.get('custom-1')!;
  expect(td.normalUrl).toMatch(/^blob:/);
  expect(td.roughnessUrl).toMatch(/^blob:/);
});

it('get returns undefined for built-in / unknown ids', () => {
  expect(createCustomTextureRegistry().get('oak')).toBeUndefined();
});

it('exposes raw bytes for persistence threading', () => {
  const reg = createCustomTextureRegistry();
  reg.register([def], { a: new Uint8Array([9]) });
  expect(Array.from(reg.getBytes('a')!)).toEqual([9]);
});

it('revokeAll revokes every created object URL and clears the registry', () => {
  const reg = createCustomTextureRegistry();
  reg.register([{ ...def, normalBlobId: 'n' }], { a: new Uint8Array([1]), n: new Uint8Array([2]) });
  reg.revokeAll();
  expect(revoked.length).toBe(2);
  expect(reg.get('custom-1')).toBeUndefined();
});
