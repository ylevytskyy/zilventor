import { describe, it, expect, vi } from 'vitest';
import type * as THREE from 'three';
import type { TextureDef } from '@zilventor/shared';
import { createTextureCache } from '../textureCache';

function makeFakeTexture(url: string) {
  return {
    _url: url,
    wrapS: 0 as number,
    wrapT: 0 as number,
    repeat: { set: vi.fn() },
    dispose: vi.fn(),
  };
}

function makeMockLoader() {
  const textures = new Map<string, ReturnType<typeof makeFakeTexture>>();
  return {
    load: vi.fn((url: string) => {
      const t = makeFakeTexture(url);
      textures.set(url, t);
      return t as unknown as THREE.Texture;
    }),
    textures,
  };
}

const OAK: TextureDef = {
  id: 'oak', name: 'Oak',
  albedoUrl: '/textures/oak/albedo.jpg',
  normalUrl: '/textures/oak/normal.png',
  roughnessUrl: '/textures/oak/roughness.png',
  physicalWidthMm: 400, physicalHeightMm: 200,
};
const MELAMINE: TextureDef = {
  id: 'white-melamine', name: 'White Melamine',
  albedoUrl: '/textures/white-melamine/albedo.jpg',
  physicalWidthMm: 600, physicalHeightMm: 600,
};

describe('createTextureCache', () => {
  it('loadTextureSet returns the same object on repeated calls (caching)', () => {
    const mock = makeMockLoader();
    const cache = createTextureCache(() => mock as unknown as THREE.TextureLoader);
    const a = cache.loadTextureSet(OAK);
    const b = cache.loadTextureSet(OAK);
    expect(a).toBe(b);
    expect(mock.load).toHaveBeenCalledTimes(3);
  });
  it('albedo repeat is set to (1/physicalWidthMm, 1/physicalHeightMm)', () => {
    const mock = makeMockLoader();
    const cache = createTextureCache(() => mock as unknown as THREE.TextureLoader);
    const set = cache.loadTextureSet(OAK);
    expect(set.albedo.repeat.set).toHaveBeenCalledWith(1 / 400, 1 / 200);
  });
  it('normal and roughness maps are loaded when present', () => {
    const mock = makeMockLoader();
    const cache = createTextureCache(() => mock as unknown as THREE.TextureLoader);
    const set = cache.loadTextureSet(OAK);
    expect(set.normal).toBeDefined();
    expect(set.roughness).toBeDefined();
  });
  it('normal and roughness are absent when def has no urls', () => {
    const mock = makeMockLoader();
    const cache = createTextureCache(() => mock as unknown as THREE.TextureLoader);
    const set = cache.loadTextureSet(MELAMINE);
    expect(set.normal).toBeUndefined();
    expect(set.roughness).toBeUndefined();
  });
  it('disposeTextures clears cache so next load creates new textures', () => {
    const mock = makeMockLoader();
    const cache = createTextureCache(() => mock as unknown as THREE.TextureLoader);
    const a = cache.loadTextureSet(OAK);
    cache.disposeTextures();
    const b = cache.loadTextureSet(OAK);
    expect(a).not.toBe(b);
  });
  it('disposeTextures calls dispose() on each cached texture', () => {
    const mock = makeMockLoader();
    const cache = createTextureCache(() => mock as unknown as THREE.TextureLoader);
    const set = cache.loadTextureSet(OAK);
    cache.disposeTextures();
    expect((set.albedo as unknown as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalled();
    expect((set.normal as unknown as { dispose: ReturnType<typeof vi.fn> } | undefined)?.dispose).toHaveBeenCalled();
  });
});
