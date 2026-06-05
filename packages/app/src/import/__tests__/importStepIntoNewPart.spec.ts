import { describe, it, expect, vi } from 'vitest';
import type { KernelApi } from '@zilventor/kernel/src/api';
import type { PartDocument } from '@zilventor/shared';
import { importStepIntoNewPart } from '../importStepIntoNewPart';
import { ORIGIN_FEATURES } from '../originFeatures';

function makeFile(name: string, bytes: ArrayBuffer): File {
  // jsdom's File lacks .arrayBuffer(); return a duck-typed object instead.
  return { name, arrayBuffer: async () => bytes } as unknown as File;
}

function makeKernelMock(): {
  kernel: Pick<KernelApi, 'importStep' | 'registerPart'>;
  importStep: ReturnType<typeof vi.fn>;
  registerPart: ReturnType<typeof vi.fn>;
} {
  const importStep = vi.fn(async () => ({
    brepBlobId: 'imp-abc-123',
    triangleCount: 12,
    boundingBox: [0, 0, 0, 10, 10, 10] as [number, number, number, number, number, number],
    faceCount: 6,
    solidCount: 1,
    solidColors: [] as (string | null)[],
  }));
  const registerPart = vi.fn(async () => undefined);
  return { kernel: { importStep, registerPart } as Pick<KernelApi, 'importStep' | 'registerPart'>, importStep, registerPart };
}

describe('importStepIntoNewPart', () => {
  it('builds a PartDocument with origin features + one ImportedFeature', async () => {
    const { kernel, importStep, registerPart } = makeKernelMock();
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const file = makeFile('MyKnob.step', bytes);

    const { partId, part } = await importStepIntoNewPart(file, kernel as unknown as KernelApi);

    expect(importStep).toHaveBeenCalledOnce();
    const arg = importStep.mock.calls[0]?.[0] as { stepBytes: ArrayBuffer; partName: string } | undefined;
    if (!arg) throw new Error('importStep call args missing');
    expect(arg.partName).toBe('MyKnob');
    expect(new Uint8Array(arg.stepBytes)).toEqual(new Uint8Array([1, 2, 3, 4]));

    expect(part.name).toBe('MyKnob');
    expect(part.units).toBe('mm');
    expect(part.parameters).toEqual({});
    expect(part.materials).toEqual([]);
    expect(part.hardware).toEqual([]);
    expect(part.featureTree.length).toBe(ORIGIN_FEATURES.length + 1);
    expect(part.featureTree.slice(0, ORIGIN_FEATURES.length)).toEqual(ORIGIN_FEATURES);

    const imported = part.featureTree[part.featureTree.length - 1];
    if (!imported || imported.kind !== 'imported') throw new Error('expected last feature to be imported');
    expect(imported.sourceStep).toBe('MyKnob.step');
    expect(imported.bodyRef).toBe('imp-abc-123');

    expect(registerPart).toHaveBeenCalledOnce();
    const registered = registerPart.mock.calls[0]?.[0] as PartDocument | undefined;
    if (!registered) throw new Error('registerPart call args missing');
    expect(registered.id).toBe(partId);
  });

  it('strips a .stp (uppercase) extension to compute the part name', async () => {
    const { kernel } = makeKernelMock();
    const file = makeFile('Hinge.STP', new Uint8Array([0]).buffer);
    const { part } = await importStepIntoNewPart(file, kernel as unknown as KernelApi);
    expect(part.name).toBe('Hinge');
  });

  it('propagates kernel.importStep failures', async () => {
    const importStep = vi.fn(async () => { throw new Error('readStep: STEP produced an empty shape'); });
    const registerPart = vi.fn();
    const kernel = { importStep, registerPart } as unknown as KernelApi;
    const file = makeFile('Empty.step', new Uint8Array([0]).buffer);
    await expect(importStepIntoNewPart(file, kernel)).rejects.toThrow(/empty shape/);
    expect(registerPart).not.toHaveBeenCalled();
  });
});
