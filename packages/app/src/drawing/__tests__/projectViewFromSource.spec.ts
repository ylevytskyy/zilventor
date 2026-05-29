// packages/app/src/drawing/__tests__/projectViewFromSource.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { projectViewFromSource } from '../projectViewFromSource';
import type { PartDocument } from '@zilventor/shared';

vi.mock('../../store/useAppStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/useAppStore')>();
  return { ...actual };
});

const MOCK_PROJECTOR_INPUT = {
  triangles: [[[0,0,0],[1,0,0],[0,1,0]]] as [[number,number,number],[number,number,number],[number,number,number]][],
  edges: [{ id: 'e0', points: [[0,0,0],[1,0,0]] as [number,number,number][], adjacentFaces: [] }],
  bbox: [0, 0, 0, 1, 1, 1] as [number,number,number,number,number,number],
};

const MOCK_PART: PartDocument = {
  id: 'test-part-uuid', name: 'Test', units: 'mm',
  parameters: {}, featureTree: [], properties: {}, materials: [], hardware: [],
};

const MOCK_KERNEL_PART_ID = 'kernel-part-uuid-abc';
const MOCK_SOURCE_FINGERPRINT = 'fp-bytes-hash-abc123';

describe('projectViewFromSource', () => {
  beforeEach(() => {
    useAppStore.setState({
      kernel: null,
      activePart: null,
      activeDocument: null,
      activeDrawing: null,
      activeDrawingSourcePartId: null,
      activeDrawingSourceFingerprint: null,
      activeDrawingSourceComponents: null,
    } as never);
  });

  it('throws KERNEL_NOT_READY when kernel is null', async () => {
    useAppStore.setState({
      activeDrawingSourcePartId: MOCK_KERNEL_PART_ID,
      activeDrawingSourceFingerprint: MOCK_SOURCE_FINGERPRINT,
    } as never);
    await expect(projectViewFromSource('front')).rejects.toThrow('KERNEL_NOT_READY');
  });

  it('throws PART_NOT_IN_STORE when both activeDrawingSourcePartId and activePart are null', async () => {
    const mockKernel = { getProjectorInput: vi.fn() };
    useAppStore.setState({
      kernel: mockKernel as never,
      activeDrawingSourcePartId: null,
      activeDrawingSourceFingerprint: null,
      activePart: null,
    } as never);
    await expect(projectViewFromSource('front')).rejects.toThrow('PART_NOT_IN_STORE');
  });

  it('uses activeDrawingSourcePartId + activeDrawingSourceFingerprint in live-app path', async () => {
    const mockKernel = {
      getProjectorInput: vi.fn().mockResolvedValue(MOCK_PROJECTOR_INPUT),
    };
    useAppStore.setState({
      kernel: mockKernel as never,
      activeDrawingSourcePartId: MOCK_KERNEL_PART_ID,
      activeDrawingSourceFingerprint: MOCK_SOURCE_FINGERPRINT,
      activePart: null,
    } as never);

    const result = await projectViewFromSource('front');
    expect(result.projection).toBeDefined();
    expect(result.projection.visibleEdges).toBeDefined();
    expect(result.projection.bbox).toBeDefined();
    // inputFingerprint MUST equal activeDrawingSourceFingerprint (bytes hash), NOT djb2(kernelId)
    expect(result.inputFingerprint).toBe(MOCK_SOURCE_FINGERPRINT);
    expect(mockKernel.getProjectorInput).toHaveBeenCalledWith({ kind: 'part', partId: MOCK_KERNEL_PART_ID });
  });

  it('different activeDrawingSourceFingerprint → different inputFingerprint (staleness trigger)', async () => {
    const mockKernel = {
      getProjectorInput: vi.fn().mockResolvedValue(MOCK_PROJECTOR_INPUT),
    };
    useAppStore.setState({
      kernel: mockKernel as never,
      activeDrawingSourcePartId: MOCK_KERNEL_PART_ID,
      activeDrawingSourceFingerprint: 'fp-version-1',
      activePart: null,
    } as never);
    const r1 = await projectViewFromSource('front');

    // Simulate source edit: fingerprint changes (new bytes in the .zipt)
    useAppStore.setState({ activeDrawingSourceFingerprint: 'fp-version-2' } as never);
    const r2 = await projectViewFromSource('front');

    expect(r1.inputFingerprint).toBe('fp-version-1');
    expect(r2.inputFingerprint).toBe('fp-version-2');
    // B5 comparison: r1.inputFingerprint !== activeDrawingSourceFingerprint → view is stale
    expect(r1.inputFingerprint).not.toBe(r2.inputFingerprint);
  });

  it('falls back to activePart.id + fingerprintPartState when source slots are null (unit-test path)', async () => {
    const mockKernel = {
      getProjectorInput: vi.fn().mockResolvedValue(MOCK_PROJECTOR_INPUT),
    };
    useAppStore.setState({
      kernel: mockKernel as never,
      activeDrawingSourcePartId: null,
      activeDrawingSourceFingerprint: null,
      activePart: MOCK_PART,
    } as never);

    const result = await projectViewFromSource('front');
    expect(mockKernel.getProjectorInput).toHaveBeenCalledWith({ kind: 'part', partId: 'test-part-uuid' });
    expect(typeof result.inputFingerprint).toBe('string');
    expect(result.inputFingerprint.length).toBeGreaterThan(0);
  });

  it('throws GEOMETRY_NOT_CACHED when getProjectorInput returns null (part not in kernel cache)', async () => {
    // NOTE: getProjectorInput returns null (NOT throws) on cache miss — api.ts:93 confirms this.
    const mockKernel = {
      getProjectorInput: vi.fn().mockResolvedValue(null),
    };
    useAppStore.setState({
      kernel: mockKernel as never,
      activeDrawingSourcePartId: MOCK_KERNEL_PART_ID,
      activeDrawingSourceFingerprint: MOCK_SOURCE_FINGERPRINT,
      activePart: null,
    } as never);
    await expect(projectViewFromSource('front')).rejects.toThrow('GEOMETRY_NOT_CACHED');
  });

  it('assembly branch: uses activeDrawingSourceComponents when sourceKind is assembly', async () => {
    const comps = [
      { partId: 'pid-asm-A', pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number,number,number,number] } },
    ];
    const mockKernel = {
      getProjectorInput: vi.fn().mockResolvedValue(MOCK_PROJECTOR_INPUT),
    };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          id: 'drw-asm', name: 'Asm Drawing', units: 'mm',
          source: { partPath: 'assemblies/cabinet.ziasm', sourceKind: 'assembly' },
          properties: {}, sheets: [], activeSheetId: 's1',
        },
      },
      activeDrawing: {
        id: 'drw-asm', name: 'Asm Drawing', units: 'mm',
        source: { partPath: 'assemblies/cabinet.ziasm', sourceKind: 'assembly' },
        properties: {}, sheets: [], activeSheetId: 's1',
      },
      activePart: null,
      activeAssembly: null,
      activeDrawingSourcePartId: null,
      activeDrawingSourceFingerprint: 'fp-asm-composite',
      activeDrawingSourceComponents: comps,
      kernel: mockKernel as never,
    } as never);

    const result = await projectViewFromSource('front');

    // kernel.getProjectorInput must be called with kind:'assembly' + the components
    expect(mockKernel.getProjectorInput).toHaveBeenCalledWith({ kind: 'assembly', components: comps });

    // Returns a ProjectViewResult with inputFingerprint from activeDrawingSourceFingerprint
    expect(result.inputFingerprint).toBe('fp-asm-composite');
    expect(result.projection).toBeDefined();
  });

  it('assembly branch: throws PART_NOT_IN_STORE when components slot is null', async () => {
    const mockKernel = {
      getProjectorInput: vi.fn().mockResolvedValue(MOCK_PROJECTOR_INPUT),
    };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          id: 'drw-asm2', name: 'D2', units: 'mm',
          source: { partPath: 'assemblies/w.ziasm', sourceKind: 'assembly' },
          properties: {}, sheets: [], activeSheetId: 's1',
        },
      },
      activeDrawing: {
        id: 'drw-asm2', name: 'D2', units: 'mm',
        source: { partPath: 'assemblies/w.ziasm', sourceKind: 'assembly' },
        properties: {}, sheets: [], activeSheetId: 's1',
      },
      activePart: null,
      activeAssembly: null,
      activeDrawingSourceComponents: null,
      activeDrawingSourceFingerprint: null,
      kernel: mockKernel as never,
    } as never);

    await expect(projectViewFromSource('front')).rejects.toThrow('PART_NOT_IN_STORE');
  });
});
