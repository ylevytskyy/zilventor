import { describe, expect, it } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';
import { resolveLeafPartPath } from '../resolveLeafPartPath';

function doc(over: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return {
    id: 'x', name: 'x', units: 'mm', parameters: {},
    components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {}, properties: {},
    ...over,
  };
}

describe('resolveLeafPartPath', () => {
  it('returns the leaf partPath for a top-level component', () => {
    const top = doc({ components: [
      { id: 'a', partPath: 'parts/cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const cache = { get: () => undefined };
    expect(resolveLeafPartPath(['a'], top, cache)).toBe('parts/cube.zipt');
  });

  it('walks into a sub-asm doc and returns the inner leaf partPath', () => {
    const sub = doc({ components: [
      { id: 'inner', partPath: 'parts/bolt.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 'sub1', partPath: 'sub.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const cache = {
      get: (p: string) => p === 'sub.ziasm' ? { kind: 'ok' as const, doc: sub } : undefined,
    };
    expect(resolveLeafPartPath(['sub1', 'inner'], top, cache)).toBe('parts/bolt.zipt');
  });

  it('returns null when an intermediate segment is missing', () => {
    const top = doc({ components: [
      { id: 'a', partPath: 'parts/cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const cache = { get: () => undefined };
    expect(resolveLeafPartPath(['nonexistent', 'leaf'], top, cache)).toBeNull();
  });

  it('returns null when a non-final segment is a .zipt (not .ziasm)', () => {
    const top = doc({ components: [
      { id: 'a', partPath: 'parts/cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const cache = { get: () => undefined };
    expect(resolveLeafPartPath(['a', 'leaf'], top, cache)).toBeNull();
  });

  it('returns null when the sub-asm cache misses', () => {
    const top = doc({ components: [
      { id: 'sub1', partPath: 'sub.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const cache = { get: () => undefined };
    expect(resolveLeafPartPath(['sub1', 'inner'], top, cache)).toBeNull();
  });

  it('returns null when the leaf id is not found in the (sub-asm) doc', () => {
    const sub = doc({ components: [
      { id: 'inner', partPath: 'parts/bolt.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 'sub1', partPath: 'sub.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const cache = {
      get: (p: string) => p === 'sub.ziasm' ? { kind: 'ok' as const, doc: sub } : undefined,
    };
    expect(resolveLeafPartPath(['sub1', 'wrong-id'], top, cache)).toBeNull();
  });

  it('returns null for an empty path', () => {
    const top = doc({ components: [] });
    const cache = { get: () => undefined };
    expect(resolveLeafPartPath([], top, cache)).toBeNull();
  });

  it('walks through multiple sub-asm levels', () => {
    const inner = doc({ components: [
      { id: 'leaf', partPath: 'parts/screw.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const middle = doc({ components: [
      { id: 'inner', partPath: 'inner.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 'mid', partPath: 'middle.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const cache = {
      get: (p: string) => {
        if (p === 'middle.ziasm') return { kind: 'ok' as const, doc: middle };
        if (p === 'inner.ziasm') return { kind: 'ok' as const, doc: inner };
        return undefined;
      },
    };
    expect(resolveLeafPartPath(['mid', 'inner', 'leaf'], top, cache)).toBe('parts/screw.zipt');
  });
});
