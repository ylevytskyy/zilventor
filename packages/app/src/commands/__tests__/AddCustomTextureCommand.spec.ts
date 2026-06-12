// packages/app/src/commands/__tests__/AddCustomTextureCommand.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { AddCustomTextureCommand } from '../AddCustomTextureCommand';
import { createCustomTextureRegistry } from '../../textures/customTextureRegistry';
import type { CustomTextureDef } from '@zilventor/shared';

// jsdom doesn't implement URL.createObjectURL — stub it so registry.register() works.
beforeEach(() => {
  let counter = 0;
  (globalThis as any).URL.createObjectURL = vi.fn(() => `blob:fake-${counter++}`);
  (globalThis as any).URL.revokeObjectURL = vi.fn();
});

function seedPartWithEmptyCustomTextures(): void {
  const part = {
    id: 'p', name: 'P', units: 'mm' as const, parameters: {}, properties: {},
    featureTree: [],
    materials: [],
    hardware: [],
    customTextures: [],
  };
  useAppStore.setState({
    activePart: part,
    activeAssembly: null,
    activeDocument: { kind: 'part', document: part },
    kernel: {
      registerCustomTexture: vi.fn().mockResolvedValue(undefined),
      setCustomTextures: vi.fn().mockResolvedValue(undefined),
    },
  } as never);
}

const def: CustomTextureDef = {
  id: 'custom-1',
  name: 'Mine',
  physicalWidthMm: 1000,
  physicalHeightMm: 1000,
  albedoBlobId: 'a',
};

describe('AddCustomTextureCommand', () => {
  beforeEach(() => {
    seedPartWithEmptyCustomTextures();
  });

  it('apply appends the def to the active part and registers bytes; revert removes it', async () => {
    const reg = createCustomTextureRegistry();
    const cmd = new AddCustomTextureCommand({
      def,
      bytes: { a: new Uint8Array([1, 2]) },
      registry: reg,
    });

    await cmd.apply();
    expect(useAppStore.getState().activePart!.customTextures!.map((d) => d.id)).toContain('custom-1');
    expect(reg.get('custom-1')).toBeTruthy();

    await cmd.revert();
    expect(useAppStore.getState().activePart!.customTextures!).toEqual([]);
  });

  it('apply registers ALL present blobs (albedo + normal + roughness) to the kernel', async () => {
    const reg = createCustomTextureRegistry();
    const defWithMaps: CustomTextureDef = {
      ...def,
      normalBlobId: 'n',
      roughnessBlobId: 'r',
    };
    const cmd = new AddCustomTextureCommand({
      def: defWithMaps,
      bytes: {
        a: new Uint8Array([1]),
        n: new Uint8Array([2]),
        r: new Uint8Array([3]),
      },
      registry: reg,
    });

    await cmd.apply();

    const { kernel } = useAppStore.getState();
    const registerMock = kernel!.registerCustomTexture as ReturnType<typeof vi.fn>;
    const registeredBlobIds = registerMock.mock.calls.map((call: unknown[]) => call[0] as string);
    expect(registeredBlobIds).toContain('a');
    expect(registeredBlobIds).toContain('n');
    expect(registeredBlobIds).toContain('r');
  });

  it('apply calls setCustomTextures with updated defs after store write', async () => {
    const reg = createCustomTextureRegistry();
    const cmd = new AddCustomTextureCommand({
      def,
      bytes: { a: new Uint8Array([1]) },
      registry: reg,
    });

    await cmd.apply();

    const { kernel } = useAppStore.getState();
    const setCustomTexturesMock = kernel!.setCustomTextures as ReturnType<typeof vi.fn>;
    expect(setCustomTexturesMock).toHaveBeenCalledWith('p', expect.arrayContaining([expect.objectContaining({ id: 'custom-1' })]));
  });

  it('apply writes to both activePart and activeDocument (no divergence)', async () => {
    const reg = createCustomTextureRegistry();
    const cmd = new AddCustomTextureCommand({
      def,
      bytes: { a: new Uint8Array([1]) },
      registry: reg,
    });

    await cmd.apply();

    const s = useAppStore.getState();
    const docTextures = (s.activeDocument!.document as NonNullable<typeof s.activePart>).customTextures;
    expect(docTextures).toEqual(s.activePart!.customTextures);
  });
});
