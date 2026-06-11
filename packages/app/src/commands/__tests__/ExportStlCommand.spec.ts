import { describe, it, expect, beforeEach, vi } from 'vitest';

Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:stub'), writable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });

vi.mock('../../nesting/triggerDownload', () => ({ triggerDownload: vi.fn(async () => {}) }));

vi.mock('../../assembly/resolveExportLeaves', () => ({
  resolveExportLeaves: vi.fn(async () => [
    { partId: 'p1', name: 'Side', pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
    { partId: 'p1', name: 'Side', pose: { translation: { x: 100, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
  ]),
}));

import { ExportStlCommand } from '../ExportStlCommand';
import { resolveExportLeaves } from '../../assembly/resolveExportLeaves';

const STL_BYTES = new Uint8Array(84); // 80 header + 4-byte triCount=0; content irrelevant here

describe('ExportStlCommand', () => {
  beforeEach(() => {
    delete (globalThis as { __zilventorStlBytes?: Uint8Array }).__zilventorStlBytes;
    vi.clearAllMocks();
  });

  it('assembly branch: resolves leaves then calls exportStlAssembly with them', async () => {
    const exportStlAssembly = vi.fn(async () => STL_BYTES);
    const subDoc = { name: 'Sub', components: [], colors: {} };
    const subPoses = new Map([
      ['sub/leaf', { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] }],
    ]);
    const cmd = new ExportStlCommand({
      kernel: { exportStlPart: vi.fn(), exportStlAssembly, loadFromBytes: vi.fn(async () => 'p1') },
      activeDocument: { kind: 'assembly', document: { name: 'Cabinet', colors: {}, components: [] } as never },
      activePart: null,
      opfs: { read: vi.fn(async () => new Uint8Array()), exists: vi.fn(async () => false) },
      componentPoses: new Map(),
      partInfoCache: new Map(),
      subAssemblyDocs: { 'sub.ziasm': subDoc as never },
      subAssemblyInnerPoses: { 'sub.ziasm': subPoses },
    });
    await cmd.apply();
    expect(resolveExportLeaves).toHaveBeenCalledOnce();
    // Verify subAsmCache was passed with innerStaticPoses
    const callArg = ((resolveExportLeaves as ReturnType<typeof vi.fn>).mock.calls[0] as [Record<string, unknown>])[0];
    const subAsmCacheArg = callArg.subAsmCache as { get: (p: string) => unknown };
    expect(subAsmCacheArg.get('sub.ziasm')).toMatchObject({ kind: 'ok', innerStaticPoses: subPoses });
    const firstCall = exportStlAssembly.mock.calls[0] as unknown as [unknown[], { binary: boolean }];
    expect(firstCall[0]).toHaveLength(2);
    expect(firstCall[1]).toMatchObject({ binary: true });
    const stashed = (globalThis as { __zilventorStlBytes?: Uint8Array }).__zilventorStlBytes;
    expect(stashed).toBeDefined();
    expect(stashed!.byteLength).toBeGreaterThan(0);
  });

  it('part branch: calls exportStlPart(activePart.id, { binary: true })', async () => {
    const exportStlPart = vi.fn(async () => STL_BYTES);
    const cmd = new ExportStlCommand({
      kernel: { exportStlPart, exportStlAssembly: vi.fn(), loadFromBytes: vi.fn() },
      activeDocument: { kind: 'part', document: { name: 'Bracket' } },
      activePart: { id: 'part-uuid-2' },
      opfs: { read: vi.fn(), exists: vi.fn(async () => false) },
      componentPoses: new Map(),
      partInfoCache: new Map(),
      subAssemblyDocs: {},
      subAssemblyInnerPoses: {},
    });
    await cmd.apply();
    expect(exportStlPart).toHaveBeenCalledWith('part-uuid-2', { binary: true });
  });
});
