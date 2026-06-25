// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { AddHardwareCommand, HardwareSkuNotFoundError } from './AddHardwareCommand';
import { readTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async read(p: string) {
    const b = this.files.get(p);
    if (!b) throw new Error(`ENOENT: ${p}`);
    return b;
  }
  async exists(p: string) { return this.files.has(p); }
  async delete(p: string) { this.files.delete(p); }
  async listAll() { return [...this.files.keys()]; }
}

function makeAssembly(): AssemblyDocument {
  return {
    id: 'asm-hw-test',
    name: 'HwTestAssembly',
    units: 'mm',
    parameters: {},
    components: [],
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {},
    cutListItemNumbers: {},
    colorOverrides: {},
    properties: {},
    materials: [],
    hardware: [],
  };
}

const custom = {
  id: 'acme-pull-128',
  name: 'ACME Pull 128mm',
  category: 'drawerHandles' as const,
  vendor: '',
  notes: '',
  bboxMm: { l: 140, w: 12, h: 30 },
  attachPoints: [{ name: 'screw-a', position: { x: 6, y: 0, z: 0 } }],
};

describe('AddHardwareCommand with a custom SKU', () => {
  let opfs: MemOpfs;

  beforeEach(() => {
    opfs = new MemOpfs();
    const asm = makeAssembly();
    useAppStore.setState({
      activePart: null,
      activeAssembly: asm,
      activeDocument: { kind: 'assembly', document: asm },
    } as never);
  });

  it('throws HardwareSkuNotFoundError for an unknown id (regression)', async () => {
    const cmd = new AddHardwareCommand({ skuId: 'does-not-exist', opfs });
    await expect(cmd.apply()).rejects.toThrow(HardwareSkuNotFoundError);
  });

  it('places a custom SKU once imported (was previously SkuNotFound)', async () => {
    // Before importing: placing the custom SKU must fail (proves the bug)
    const cmdBefore = new AddHardwareCommand({ skuId: 'acme-pull-128', opfs });
    await expect(cmdBefore.apply()).rejects.toThrow(HardwareSkuNotFoundError);

    // Import the custom SKU into the active assembly
    useAppStore.getState().addCustomHardware([custom]);

    // Now placing must succeed
    const cmd = new AddHardwareCommand({ skuId: 'acme-pull-128', opfs });
    await expect(cmd.apply()).resolves.not.toThrow();

    // The synthesized .zipt file must contain a HardwareFeature with the custom id
    const bytes = await opfs.read('hardware/acme-pull-128.zipt');
    const entries = await readTarGz(bytes);
    const manifestEntry = entries.find((e) => e.name === 'manifest.json');
    expect(manifestEntry).toBeDefined();
    const manifest = JSON.parse(new TextDecoder().decode(manifestEntry!.data));
    const hwFeature = (manifest.document.featureTree as Array<{ kind: string; hardwareSkuId?: string }>)
      .find((f) => f.kind === 'hardware');
    expect(hwFeature?.hardwareSkuId).toBe('acme-pull-128');

    // The component must be placed in the active assembly
    const placed = useAppStore.getState().activeAssembly?.components ?? [];
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.at(-1)?.partPath).toBe('hardware/acme-pull-128.zipt');
  });
});
