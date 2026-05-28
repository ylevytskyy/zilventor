// packages/app/src/store/syncPartMaterials.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MaterialEntry, PartDocument } from '@zilventor/shared';
import { useAppStore } from './useAppStore';
import { syncPartMaterials } from './syncPartMaterials';

const MAT: MaterialEntry = {
  id: 'mat-1', name: 'Birch 18', defaultThickness: 18, color: '#cfa84b',
};

function makePart(materials: MaterialEntry[] = [MAT]): PartDocument {
  return {
    id: 'part-id-1', name: 'P', units: 'mm', parameters: {}, properties: {},
    featureTree: [],
    materials,
    hardware: [],
  };
}

describe('syncPartMaterials', () => {
  beforeEach(() => {
    // Reset store to neutral state.
    useAppStore.setState({ activePart: null, activeAssembly: null } as never);
    vi.restoreAllMocks();
  });

  it('calls kernel.setMaterials with (part.id, part.materials) when a part is active', async () => {
    const part = makePart();
    const mockKernel = { setMaterials: vi.fn().mockResolvedValue(undefined) };
    useAppStore.setState({ activePart: part, kernel: mockKernel } as never);

    await syncPartMaterials();

    expect(mockKernel.setMaterials).toHaveBeenCalledOnce();
    expect(mockKernel.setMaterials).toHaveBeenCalledWith('part-id-1', part.materials);
  });

  it('does NOT call kernel.setMaterials when activePart is null (assembly active)', async () => {
    const mockKernel = { setMaterials: vi.fn().mockResolvedValue(undefined) };
    // activePart is null from beforeEach; kernel present but no activePart.
    useAppStore.setState({ activePart: null, kernel: mockKernel } as never);

    await syncPartMaterials();

    expect(mockKernel.setMaterials).not.toHaveBeenCalled();
  });

  it('does NOT call kernel.setMaterials when kernel is null', async () => {
    const part = makePart();
    useAppStore.setState({ activePart: part, kernel: null } as never);

    await syncPartMaterials();

    // No kernel — nothing to call. Should not throw.
  });
});
