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
});
