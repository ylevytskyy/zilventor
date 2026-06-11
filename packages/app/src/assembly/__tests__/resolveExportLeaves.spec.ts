import { describe, expect, it } from 'vitest';
import type { AssemblyDocument, ComponentColor } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { effectiveColorToRgb, resolveExportLeaves } from '../resolveExportLeaves';
import type { PartInfoCache } from '../../shell/resolvePartInfo';

const hex = (h: string): ComponentColor => ({ kind: 'hex', hex: h });
const pal = (name: string): ComponentColor => ({ kind: 'palette', name });

describe('effectiveColorToRgb', () => {
  it('maps a hex color to 0–1 RGB', () => {
    expect(effectiveColorToRgb(hex('#ff8000'), {})).toEqual([255 / 255, 128 / 255, 0 / 255]);
  });

  it('maps a palette hit via assembly.colors', () => {
    expect(effectiveColorToRgb(pal('oak'), { oak: '#00ff00' })).toEqual([0, 1, 0]);
  });

  it('returns undefined for a palette miss (name not in colors)', () => {
    expect(effectiveColorToRgb(pal('walnut'), { oak: '#00ff00' })).toBeUndefined();
  });

  it('returns undefined for an undefined color', () => {
    expect(effectiveColorToRgb(undefined, { oak: '#00ff00' })).toBeUndefined();
  });

  it('accepts hex without leading # and 3-component values', () => {
    expect(effectiveColorToRgb(hex('0080ff'), {})).toEqual([0, 128 / 255, 1]);
  });
});

// ---------------------------------------------------------------------------
// resolveExportLeaves helpers
// ---------------------------------------------------------------------------

function asmDoc(over: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return {
    id: 'asm', name: 'asm', units: 'mm', parameters: {}, components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {},
    colorOverrides: {}, properties: {}, materials: [], hardware: [], ...over,
  };
}

// A fake opfs/kernel/resolvePartInfo bridge. loadFromBytes returns a stable id
// per partPath (the persisted-UUID contract); resolvePartInfo returns a name.
// NOTE: resolvePartInfo uses the full 3-arg signature matching the real function.
function makeBridge(opts: {
  bytesByPath: Record<string, Uint8Array>;
  idByPath: Record<string, string>;
  nameByPath: Record<string, string>;
}) {
  const reads: string[] = [];
  return {
    reads,
    kernel: {
      async loadFromBytes(b: Uint8Array): Promise<string> {
        const path = Object.keys(opts.bytesByPath).find((p) => opts.bytesByPath[p] === b);
        if (!path) throw new Error('unknown bytes');
        return opts.idByPath[path]!;
      },
    },
    opfs: {
      async read(p: string): Promise<Uint8Array> {
        reads.push(p);
        const b = opts.bytesByPath[p];
        if (!b) throw new Error(`no bytes for ${p}`);
        return b;
      },
      async exists(p: string): Promise<boolean> {
        return p in opts.bytesByPath;
      },
    },
    // 3-arg signature matching resolvePartInfo.ts:7
    resolvePartInfo: async (_opfs: unknown, p: string, _cache: unknown) => ({ name: opts.nameByPath[p] ?? '(missing part)' }),
  };
}

describe('resolveExportLeaves', () => {
  it('resolves a 2-instance assembly to 2 leaves with rgb + distinct world poses + names', async () => {
    const partBytes = new Uint8Array([1, 2, 3]);
    const assembly = asmDoc({
      colors: { oak: '#00ff00' },
      components: [
        { id: 'a', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'hex', hex: '#ff0000' } },
        { id: 'b', partPath: 'panel.zipt', position: { x: 100, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'palette', name: 'oak' } },
      ],
    });
    const bridge = makeBridge({
      bytesByPath: { 'panel.zipt': partBytes },
      idByPath: { 'panel.zipt': 'part-uuid-1' },
      nameByPath: { 'panel.zipt': 'Side Panel' },
    });
    // componentPoses already covers both top-level leaves (solver has run).
    const componentPoses = new Map([
      [pathKey(['a']), { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] }],
      [pathKey(['b']), { translation: { x: 100, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] }],
    ]);
    // subAsmCache is empty (no sub-assemblies in this flat doc) — exercising the full 7-arg signature.
    const subAsmCache = { get: (_p: string) => undefined };

    const leaves = await resolveExportLeaves({
      assembly,
      kernel: bridge.kernel,
      opfs: bridge.opfs,
      subAsmCache,
      componentPoses,
      partInfoCache: new Map() as PartInfoCache,
      resolvePartInfo: bridge.resolvePartInfo,
    });

    expect(leaves).toHaveLength(2);
    // both instances share one prototype id (de-dup is a kernel concern; app emits per-instance leaves)
    expect(leaves.map((l) => l.partId)).toEqual(['part-uuid-1', 'part-uuid-1']);
    expect(leaves.map((l) => l.name)).toEqual(['Side Panel', 'Side Panel']);
    // distinct world poses from componentPoses
    expect(leaves[0]!.pose.translation).toEqual({ x: 0, y: 0, z: 0 });
    expect(leaves[1]!.pose.translation).toEqual({ x: 100, y: 0, z: 0 });
    // colors: hex red, palette oak→green
    expect(leaves[0]!.color).toEqual([1, 0, 0]);
    expect(leaves[1]!.color).toEqual([0, 1, 0]);
    // each unique partPath read exactly once (the warm map de-dups by partPath)
    expect(bridge.reads.filter((p) => p === 'panel.zipt')).toHaveLength(1);
  });

  /**
   * Addendum §2 case: stub subAsmCache returns an 'ok' entry for a .ziasm path.
   * Proves that nested leaves from a warmed sub-assembly are RESOLVED (not placeholders)
   * when the cache is properly populated — the exact shape the 5b command will build
   * from the store's subAssemblyDocs/subAssemblyInnerPoses (App.tsx:3837-3841).
   */
  it('resolves leaves from a nested sub-assembly when subAsmCache returns ok', async () => {
    const partBytes = new Uint8Array([4, 5, 6]);
    // The inner sub-assembly doc (1 part component inside)
    const innerDoc = asmDoc({
      id: 'inner-asm',
      components: [
        { id: 'c', partPath: 'shelf.zipt', position: { x: 0, y: 0, z: 50 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    // The outer assembly references the inner as a .ziasm component.
    // The cabinet is at declared position {x:10} so the composed leaf ends up at {x:10, z:50}.
    const outerDoc = asmDoc({
      components: [
        { id: 'cabinet', partPath: 'cabinet.ziasm', position: { x: 10, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    const bridge = makeBridge({
      bytesByPath: { 'shelf.zipt': partBytes },
      idByPath: { 'shelf.zipt': 'shelf-uuid' },
      nameByPath: { 'shelf.zipt': 'Shelf' },
    });
    // subAsmCache warmed with the inner doc (mirroring the 5b adapter from App.tsx:3837-3841).
    // innerStaticPoses maps pathKey(['c']) → inner pose (mirrors what computeInnerStaticPoses returns).
    const innerPoses = new Map([
      [pathKey(['c']), { translation: { x: 0, y: 0, z: 50 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] }],
    ]);
    const subAsmCache = {
      get: (p: string) =>
        p === 'cabinet.ziasm'
          ? ({ kind: 'ok' as const, doc: innerDoc, partPath: p, innerStaticPoses: innerPoses })
          : undefined,
    };
    // componentPoses does NOT have the composed leaf key (['cabinet','c']) — only the root.
    // This forces the flatten+composedPoses recompute branch which derives the leaf pose from
    // innerStaticPoses: composePoses(cabinet@{x:10}, inner@{z:50}) → {x:10, z:50}.
    const componentPoses = new Map([
      [pathKey(['cabinet']), { translation: { x: 10, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] }],
    ]);

    const leaves = await resolveExportLeaves({
      assembly: outerDoc,
      kernel: bridge.kernel,
      opfs: bridge.opfs,
      subAsmCache,
      componentPoses,
      partInfoCache: new Map() as PartInfoCache,
      resolvePartInfo: bridge.resolvePartInfo,
    });

    // The inner leaf is RESOLVED — not a placeholder and not thrown.
    expect(leaves).toHaveLength(1);
    expect(leaves[0]!.partId).toBe('shelf-uuid');
    expect(leaves[0]!.name).toBe('Shelf');
    // Pose: outer cabinet at x=10 + inner shelf at z=50 → composed via innerStaticPoses
    // composedPoses rigid branch: composePoses({x:10,y:0,z:0,q=[0,0,0,1]}, {x:0,y:0,z:50,q=[0,0,0,1]})
    // = translation {x:10, y:0, z:50}
    expect(leaves[0]!.pose.translation.x).toBeCloseTo(10);
    expect(leaves[0]!.pose.translation.z).toBeCloseTo(50);
  });

  it('throws on an unresolved sub-assembly (placeholder) leaf — never silently dropped', async () => {
    const assembly = asmDoc({
      components: [
        // A .ziasm child with no cache entry → visibleLeaves emits a placeholder.
        { id: 's', partPath: 'sub.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    const bridge = makeBridge({ bytesByPath: {}, idByPath: {}, nameByPath: {} });
    await expect(
      resolveExportLeaves({
        assembly,
        kernel: bridge.kernel,
        opfs: bridge.opfs,
        subAsmCache: { get: (_p: string) => undefined },
        componentPoses: new Map(),
        partInfoCache: new Map() as PartInfoCache,
        resolvePartInfo: bridge.resolvePartInfo,
      }),
    ).rejects.toThrow(/unresolved sub-assembly leaf sub\.ziasm/);
  });

  it('recomputes world poses via flatten+composed when componentPoses is empty', async () => {
    const partBytes = new Uint8Array([9, 9]);
    const assembly = asmDoc({
      components: [
        { id: 'a', partPath: 'p.zipt', position: { x: 7, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'b', partPath: 'p.zipt', position: { x: 0, y: 13, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    const bridge = makeBridge({
      bytesByPath: { 'p.zipt': partBytes },
      idByPath: { 'p.zipt': 'uuid-p' },
      nameByPath: { 'p.zipt': 'Part P' },
    });
    const leaves = await resolveExportLeaves({
      assembly,
      kernel: bridge.kernel,
      opfs: bridge.opfs,
      subAsmCache: { get: (_p: string) => undefined },
      componentPoses: new Map(), // empty → forces the flatten+composed fallback (App.tsx:3856-3863)
      partInfoCache: new Map() as PartInfoCache,
      resolvePartInfo: bridge.resolvePartInfo,
    });
    expect(leaves).toHaveLength(2);
    // poses come from initialPose (declared position) via composedPoses
    expect(leaves[0]!.pose.translation).toEqual({ x: 7, y: 0, z: 0 });
    expect(leaves[1]!.pose.translation).toEqual({ x: 0, y: 13, z: 0 });
    // no color provided → color key omitted
    expect(leaves[0]!.color).toBeUndefined();
    expect('color' in leaves[0]!).toBe(false);
  });
});
