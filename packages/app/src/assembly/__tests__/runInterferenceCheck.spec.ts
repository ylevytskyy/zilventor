import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runInterferenceCheck } from '../runInterferenceCheck';
import type { AssemblyDocument } from '@zilventor/shared';

// Minimal flat assembly with 2 components pointing to real-path stubs
const asm: AssemblyDocument = {
  id: 'asm1', name: 'Test', units: 'mm', parameters: {}, properties: {},
  components: [
    { id: 'c1', partPath: 'parts/panel-a.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    { id: 'c2', partPath: 'parts/panel-b.zipt', position: { x: 100, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ],
  constraints: [],
  groundedComponentPaths: [],
  colors: {},
  bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
  materials: [],
  hardware: [],
};

/** Minimal nested fixture: one cabinet sub-assembly with carcass panels. */
function makeNestedFixture(): {
  topAsm: AssemblyDocument;
  cabinetDoc: AssemblyDocument;
  subAsmCache: { get: (p: string) => { kind: 'ok'; doc: AssemblyDocument; partPath: string } | undefined };
} {
  const cabinetDoc: AssemblyDocument = {
    id: 'cab1', name: 'Cabinet', units: 'mm', parameters: {}, properties: {},
    components: [
      { id: 'left', partPath: 'parts/left.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'leftSide' },
      { id: 'right', partPath: 'parts/right.zipt', position: { x: 700, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'rightSide' },
      { id: 'bot', partPath: 'parts/bot.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'bottom' },
    ],
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [],
    hardware: [],
  };

  const topAsm: AssemblyDocument = {
    id: 'top', name: 'Top', units: 'mm', parameters: {}, properties: {},
    components: [
      { id: 'cabInst', partPath: 'assemblies/cabinet.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ],
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [],
    hardware: [],
  };

  const subAsmCache = {
    get: (p: string) => p === 'assemblies/cabinet.ziasm'
      ? { kind: 'ok' as const, doc: cabinetDoc, partPath: 'assemblies/cabinet.ziasm' }
      : undefined,
  };

  return { topAsm, cabinetDoc, subAsmCache };
}

/** Two-cabinet fixture: same-cabinet + cross-cabinet pairs. */
function makeTwoCabinetFixture(): {
  topAsm: AssemblyDocument;
  subAsmCache: { get: (p: string) => { kind: 'ok'; doc: AssemblyDocument; partPath: string } | undefined };
} {
  function cabinetDoc(id: string, leftPath: string, rightPath: string): AssemblyDocument {
    return {
      id, name: `Cabinet ${id}`, units: 'mm', parameters: {}, properties: {},
      components: [
        { id: 'left', partPath: leftPath, position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'leftSide' },
        { id: 'right', partPath: rightPath, position: { x: 700, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'rightSide' },
      ],
      constraints: [],
      groundedComponentPaths: [],
      colors: {},
      bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [],
      hardware: [],
    };
  }

  const cabADoc = cabinetDoc('cabA', 'parts/a-left.zipt', 'parts/a-right.zipt');
  const cabBDoc = cabinetDoc('cabB', 'parts/b-left.zipt', 'parts/b-right.zipt');

  const topAsm: AssemblyDocument = {
    id: 'top', name: 'Top', units: 'mm', parameters: {}, properties: {},
    components: [
      { id: 'cabA', partPath: 'assemblies/cabinet-a.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'cabB', partPath: 'assemblies/cabinet-b.ziasm', position: { x: 800, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ],
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [],
    hardware: [],
  };

  const subAsmCache = {
    get: (p: string) => {
      if (p === 'assemblies/cabinet-a.ziasm') return { kind: 'ok' as const, doc: cabADoc, partPath: p };
      if (p === 'assemblies/cabinet-b.ziasm') return { kind: 'ok' as const, doc: cabBDoc, partPath: p };
      return undefined;
    },
  };

  return { topAsm, subAsmCache };
}

const MOCK_PAIRS = [{ aIndex: 0, bIndex: 1, kind: 'interference' as const, volume: 1800 }];

describe('runInterferenceCheck', () => {
  let kernel: { checkInterference: ReturnType<typeof vi.fn>; loadFromBytes: ReturnType<typeof vi.fn> };
  let opfs: { read: ReturnType<typeof vi.fn>; exists: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    kernel = {
      checkInterference: vi.fn().mockResolvedValue(MOCK_PAIRS),
      loadFromBytes: vi.fn().mockResolvedValue('kernel-id-1'),
    };
    opfs = {
      read: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      exists: vi.fn().mockResolvedValue(true),
    };
  });

  it('calls kernel.checkInterference and returns ClashReportRow[]', async () => {
    const rows = await runInterferenceCheck({
      assembly: asm,
      kernel: kernel as any,
      opfs: opfs as any,
      subAsmCache: { get: () => undefined },
      componentPoses: new Map(),
      partInfoCache: new Map(),
      resolvePartInfo: vi.fn().mockResolvedValue({ name: 'Panel A' }),
      clearanceThreshold: 1.0,
    });

    expect(kernel.checkInterference).toHaveBeenCalledOnce();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('interference');
    expect(rows[0]!.volume).toBeCloseTo(1800);
  });

  it('returns empty rows when kernel returns no pairs', async () => {
    kernel.checkInterference.mockResolvedValue([]);
    const rows = await runInterferenceCheck({
      assembly: asm,
      kernel: kernel as any,
      opfs: opfs as any,
      subAsmCache: { get: () => undefined },
      componentPoses: new Map(),
      partInfoCache: new Map(),
      resolvePartInfo: vi.fn().mockResolvedValue({ name: 'Panel A' }),
      clearanceThreshold: 1.0,
    });
    expect(rows).toHaveLength(0);
  });

  it('passes volumeThreshold from shared constant and clearanceThreshold from arg', async () => {
    await runInterferenceCheck({
      assembly: asm,
      kernel: kernel as any,
      opfs: opfs as any,
      subAsmCache: { get: () => undefined },
      componentPoses: new Map(),
      partInfoCache: new Map(),
      resolvePartInfo: vi.fn().mockResolvedValue({ name: 'Panel' }),
      clearanceThreshold: 2.5,
    });
    const call = kernel.checkInterference.mock.calls[0]!;
    // opts is the second argument
    expect(call[1].clearanceThreshold).toBe(2.5);
    // volumeThreshold must match the shared constant (not hardcoded 1.0)
    const { VOLUME_THRESHOLD_MM3 } = await import('@zilventor/shared');
    expect(call[1].volumeThreshold).toBe(VOLUME_THRESHOLD_MM3);
  });

  // C1: carcass-noise filter tests

  describe('C1 carcass-noise filter', () => {
    it('suppresses all same-cabinet carcass×carcass pairs → zero rows', async () => {
      const { topAsm, subAsmCache } = makeNestedFixture();
      // The cabinet has 3 panels: (left,right), (left,bot), (right,bot) = 3 pairs, all carcass
      // pathPrefix for all = ['cabInst'], so all pairs are same-cabinet carcass noise → suppressed
      kernel.checkInterference.mockResolvedValue([
        { aIndex: 0, bIndex: 1, kind: 'interference' as const, volume: 200 },
        { aIndex: 0, bIndex: 2, kind: 'interference' as const, volume: 150 },
        { aIndex: 1, bIndex: 2, kind: 'interference' as const, volume: 100 },
      ]);

      // loadFromBytes returns distinct ids per unique path (left/right/bot)
      let callCount = 0;
      kernel.loadFromBytes.mockImplementation(() => Promise.resolve(`kid-${callCount++}`));

      const rows = await runInterferenceCheck({
        assembly: topAsm,
        kernel: kernel as any,
        opfs: opfs as any,
        subAsmCache,
        componentPoses: new Map(),
        partInfoCache: new Map(),
        resolvePartInfo: vi.fn().mockResolvedValue({ name: 'Panel' }),
        clearanceThreshold: 1.0,
      });

      expect(rows).toHaveLength(0);
    });

    it('keeps a drawerFront×carcass pair in the same cabinet', async () => {
      // drawerFront is not in CARCASS_ROLES → pair is NOT suppressed
      const cabinetDocWithDrawer: AssemblyDocument = {
        id: 'cab-df', name: 'Cabinet', units: 'mm', parameters: {}, properties: {},
        components: [
          { id: 'left', partPath: 'parts/df-left.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'leftSide' },
          { id: 'df', partPath: 'parts/df-front.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'drawerFront' },
        ],
        constraints: [],
        groundedComponentPaths: [],
        colors: {},
        bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
        materials: [],
        hardware: [],
      };

      const topAsmDf: AssemblyDocument = {
        id: 'top-df', name: 'Top', units: 'mm', parameters: {}, properties: {},
        components: [
          { id: 'cabDf', partPath: 'assemblies/cabinet-df.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        ],
        constraints: [],
        groundedComponentPaths: [],
        colors: {},
        bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
        materials: [],
        hardware: [],
      };

      const dfSubAsmCache = {
        get: (p: string) => p === 'assemblies/cabinet-df.ziasm'
          ? { kind: 'ok' as const, doc: cabinetDocWithDrawer, partPath: p }
          : undefined,
      };

      // 1 pair: left(carcass) × drawerFront → should NOT be suppressed
      kernel.checkInterference.mockResolvedValue([
        { aIndex: 0, bIndex: 1, kind: 'interference' as const, volume: 300 },
      ]);

      let cnt = 0;
      kernel.loadFromBytes.mockImplementation(() => Promise.resolve(`dfkid-${cnt++}`));

      const rows = await runInterferenceCheck({
        assembly: topAsmDf,
        kernel: kernel as any,
        opfs: opfs as any,
        subAsmCache: dfSubAsmCache,
        componentPoses: new Map(),
        partInfoCache: new Map(),
        resolvePartInfo: vi.fn().mockResolvedValue({ name: 'Panel' }),
        clearanceThreshold: 1.0,
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]!.kind).toBe('interference');
    });

    it('keeps cross-cabinet carcass×carcass pair (different parent prefix)', async () => {
      const { topAsm, subAsmCache } = makeTwoCabinetFixture();
      // 4 leaves: cabA/left, cabA/right, cabB/left, cabB/right
      // Within-cabinet pairs (0,1) and (2,3) → suppressed
      // Cross-cabinet pairs (0,2), (0,3), (1,2), (1,3) → kept
      kernel.checkInterference.mockResolvedValue([
        { aIndex: 0, bIndex: 1, kind: 'interference' as const, volume: 50 },   // same cabinet A → suppressed
        { aIndex: 2, bIndex: 3, kind: 'interference' as const, volume: 50 },   // same cabinet B → suppressed
        { aIndex: 1, bIndex: 2, kind: 'interference' as const, volume: 999 },  // cross-cabinet → kept
      ]);

      let cnt = 0;
      kernel.loadFromBytes.mockImplementation(() => Promise.resolve(`tck-${cnt++}`));

      const rows = await runInterferenceCheck({
        assembly: topAsm,
        kernel: kernel as any,
        opfs: opfs as any,
        subAsmCache,
        componentPoses: new Map(),
        partInfoCache: new Map(),
        resolvePartInfo: vi.fn().mockResolvedValue({ name: 'Panel' }),
        clearanceThreshold: 1.0,
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]!.volume).toBeCloseTo(999);
    });
  });
});
