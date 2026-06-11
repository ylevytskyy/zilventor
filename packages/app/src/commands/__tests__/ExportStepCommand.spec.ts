import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExportStepCommand } from '../ExportStepCommand';

// jsdom lacks URL.createObjectURL / showSaveFilePicker — stub so the download fallback is a no-op.
Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:stub'), writable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });

vi.mock('../../nesting/triggerDownload', () => ({ triggerDownload: vi.fn(async () => {}) }));

const STEP_BYTES = new TextEncoder().encode('ISO-10303-21;\nHEADER;\npart-step\nENDSEC;\n');

// Mock resolveExportLeaves so assembly branch doesn't need the full walker chain in unit tests.
vi.mock('../../assembly/resolveExportLeaves', () => ({
  resolveExportLeaves: vi.fn(async () => [
    { partId: 'p1', name: 'Side_A', pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
    { partId: 'p1', name: 'Side_B', pose: { translation: { x: 50, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
  ]),
}));

import { resolveExportLeaves } from '../../assembly/resolveExportLeaves';

describe('ExportStepCommand', () => {
  beforeEach(() => {
    delete (globalThis as { __zilventorStepBytes?: Uint8Array }).__zilventorStepBytes;
    vi.clearAllMocks();
  });

  it('part branch: calls exportStepPart(activePart.id) and stashes bytes for e2e capture', async () => {
    const exportStepPart = vi.fn(async (_id: string) => STEP_BYTES);
    const exportStepAssembly = vi.fn();
    const cmd = new ExportStepCommand({
      kernel: { exportStepPart, exportStepAssembly },
      activeDocument: { kind: 'part', document: { name: 'Bracket' } },
      activePart: { id: 'part-uuid-1' },
      opfs: { read: vi.fn(), exists: vi.fn(async () => false) },
      componentPoses: new Map(),
      partInfoCache: new Map(),
      subAssemblyDocs: {},
      subAssemblyInnerPoses: {},
    });
    await cmd.apply();
    expect(exportStepPart).toHaveBeenCalledWith('part-uuid-1');
    expect(exportStepAssembly).not.toHaveBeenCalled();
    const stashed = (globalThis as { __zilventorStepBytes?: Uint8Array }).__zilventorStepBytes;
    expect(stashed).toBeDefined();
    expect(stashed!.byteLength).toBeGreaterThan(0);
    expect(new TextDecoder().decode(stashed!)).toContain('ISO-10303-21');
  });

  it('assembly branch: builds subAsmCache from store and passes it to resolveExportLeaves', async () => {
    const exportStepAssembly = vi.fn(async () => STEP_BYTES);
    const subDoc = { name: 'Sub', components: [], colors: {} };
    const subPoses = new Map([
      ['sub/leaf', { translation: { x: 5, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] }],
    ]);
    const cmd = new ExportStepCommand({
      kernel: { exportStepPart: vi.fn(), exportStepAssembly, loadFromBytes: vi.fn(async () => 'p1') },
      activeDocument: { kind: 'assembly', document: { name: 'Cabinet', colors: {}, components: [] } as never },
      activePart: null,
      opfs: { read: vi.fn(async () => new Uint8Array()), exists: vi.fn(async () => false) },
      componentPoses: new Map(),
      partInfoCache: new Map(),
      subAssemblyDocs: { 'sub.ziasm': subDoc as never },
      subAssemblyInnerPoses: { 'sub.ziasm': subPoses },
    });
    await cmd.apply();
    // resolveExportLeaves was called with subAsmCache that can resolve 'sub.ziasm'
    expect(resolveExportLeaves).toHaveBeenCalledOnce();
    const callArg = ((resolveExportLeaves as ReturnType<typeof vi.fn>).mock.calls[0] as [Record<string, unknown>])[0];
    const subAsmCache = callArg.subAsmCache as { get: (p: string) => unknown };
    expect(subAsmCache).toBeDefined();
    expect(subAsmCache.get('sub.ziasm')).toMatchObject({
      kind: 'ok',
      doc: subDoc,
      partPath: 'sub.ziasm',
      innerStaticPoses: subPoses,
    });
    expect(callArg.resolvePartInfo).toBeTypeOf('function');
  });

  it('revert is a no-op (non-undoable)', async () => {
    const cmd = new ExportStepCommand({
      kernel: { exportStepPart: vi.fn(async () => STEP_BYTES), exportStepAssembly: vi.fn() },
      activeDocument: { kind: 'part', document: { name: 'X' } },
      activePart: { id: 'p' },
      opfs: { read: vi.fn(), exists: vi.fn(async () => false) },
      componentPoses: new Map(),
      partInfoCache: new Map(),
      subAssemblyDocs: {},
      subAssemblyInnerPoses: {},
    });
    await expect(cmd.revert()).resolves.toBeUndefined();
  });
});
