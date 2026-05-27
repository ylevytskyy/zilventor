// packages/app/src/commands/__tests__/CreateDrawingCommand.color.spec.ts
// Tests that CreateDrawingCommand correctly sets and reverts activeDrawingSourceComponentColors.
import { describe, it, expect, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { CreateDrawingCommand } from '../CreateDrawingCommand';
import type { AssemblyDocument } from '@zilventor/shared';

// ---- Module mocks (mirror CreateDrawingCommand.spec.ts exactly) ----
vi.mock('../../storage/saveDrawingToOpfs', () => ({
  saveDrawingToOpfs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../storage/deleteDrawingFromOpfs', () => ({
  deleteDrawingFromOpfs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../drawing/loadDrawingSource', () => ({
  loadDrawingSource: vi.fn().mockResolvedValue({
    partId: 'kernel-part-uuid-from-load',
    sourceFingerprint: 'fp-bytes-hash-abc',
    sourceDocument: null,
  }),
  _clearLoadDrawingSourceCache: vi.fn(),
}));

// loadAssemblyForProjection mock: returns NEW componentColors { 'pid-A': '#ffffff' }
vi.mock('../../drawing/loadAssemblyForProjection', () => ({
  loadAssemblyForProjection: vi.fn().mockResolvedValue({
    components: [
      { partId: 'pid-A', pose: { translation: { x: 10, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
    ],
    sourceFingerprint: 'fp-asm-mock',
    componentColors: { 'pid-A': '#ffffff' },
  }),
}));

vi.mock('@zilventor/kernel/src/storage/Opfs', () => ({
  Opfs: {
    forNavigator: vi.fn().mockResolvedValue({
      read: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      exists: vi.fn().mockResolvedValue(true),
    }),
  },
}));

function makeAsmDoc(): AssemblyDocument {
  return {
    id: 'asm-1', name: 'Cabinet', units: 'mm',
    parameters: {}, properties: {}, components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
    cutListItemNumbers: {}, colorOverrides: {}, materials: [], hardware: [],
  };
}

describe('CreateDrawingCommand componentColors', () => {
  it('apply (assembly source): sets activeDrawingSourceComponentColors', async () => {
    useAppStore.setState({
      activeDocument: null,
      activePart: null,
      activeAssembly: makeAsmDoc(),
      activeDrawingSourcePartId: null,
      activeDrawingSourceFingerprint: null,
      activeDrawingSourceComponents: null,
      activeDrawingSourceComponentColors: null,
      kernel: { loadFromBytes: vi.fn(), execute: vi.fn() } as never,
    } as never);

    const cmd = new CreateDrawingCommand({
      sourcePath: 'assemblies/cabinet.ziasm',
      sourceKind: 'assembly',
    });
    await cmd.apply();

    const s = useAppStore.getState() as unknown as {
      activeDrawingSourceComponentColors: Record<string, string> | null;
    };
    expect(s.activeDrawingSourceComponentColors).toEqual({ 'pid-A': '#ffffff' });
  });

  it('revert (assembly source): restores prior activeDrawingSourceComponentColors', async () => {
    // Seed store with prior (OLD) colors
    useAppStore.setState({
      activeDocument: null,
      activePart: null,
      activeAssembly: makeAsmDoc(),
      activeDrawingSourcePartId: null,
      activeDrawingSourceFingerprint: null,
      activeDrawingSourceComponents: null,
      activeDrawingSourceComponentColors: { OLD: '#000000' },
      kernel: { loadFromBytes: vi.fn(), execute: vi.fn() } as never,
    } as never);

    const cmd = new CreateDrawingCommand({
      sourcePath: 'assemblies/cabinet.ziasm',
      sourceKind: 'assembly',
    });
    await cmd.apply();

    // After apply, the new colors should be set
    const afterApply = (useAppStore.getState() as unknown as {
      activeDrawingSourceComponentColors: Record<string, string> | null;
    }).activeDrawingSourceComponentColors;
    expect(afterApply).toEqual({ 'pid-A': '#ffffff' });

    await cmd.revert();

    // After revert, restored to OLD colors
    const afterRevert = (useAppStore.getState() as unknown as {
      activeDrawingSourceComponentColors: Record<string, string> | null;
    }).activeDrawingSourceComponentColors;
    expect(afterRevert).toEqual({ OLD: '#000000' });
  });

  it('apply (part source): nulls activeDrawingSourceComponentColors (no stale-color-bleed)', async () => {
    // Seed a stale assembly color map from a previously-opened assembly drawing.
    useAppStore.setState({
      activeDocument: null,
      activePart: null,
      activeAssembly: null,
      activeDrawingSourcePartId: null,
      activeDrawingSourceFingerprint: null,
      activeDrawingSourceComponents: null,
      activeDrawingSourceComponentColors: { STALE: '#123456' },
      kernel: { loadFromBytes: vi.fn(), execute: vi.fn() } as never,
    } as never);

    const cmd = new CreateDrawingCommand({
      sourcePath: 'parts/cabinet1.zipt',
      sourceKind: 'part',
    });
    await cmd.apply();

    // Part drawings must null the color slot — no per-component colors apply.
    const s = useAppStore.getState() as unknown as {
      activeDrawingSourceComponentColors: Record<string, string> | null;
    };
    expect(s.activeDrawingSourceComponentColors).toBeNull();
  });
});
