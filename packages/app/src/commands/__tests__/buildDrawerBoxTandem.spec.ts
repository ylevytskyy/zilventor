// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildDrawerBox, writeBoxBottomBores, writeBoxBackBores } from '../buildDrawerBox';
import { drawerBoxMath } from '@zilventor/shared/src/drawerBoxMath';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import type { BoreOp } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string): Promise<Uint8Array> {
    const b = this.files.get(p);
    if (!b) throw new Error(`MemOpfs: no file at ${p}`);
    return b;
  }
  async write(p: string, b: Uint8Array): Promise<void> { this.files.set(p, b); }
  async exists(p: string): Promise<boolean> { return this.files.has(p); }
  async delete(p: string): Promise<void> { this.files.delete(p); }
}

async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const project = await unpackProject(await opfs.read(path));
  return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
}

describe('buildDrawerBox — writeBoxBottomBores / writeBoxBackBores', () => {
  const slot = { bottomZ: 0, topZ: 200 };
  const opening = { openW: 600, innerD: 560, slideSystem: 'tandem' as const };

  it('writeBoxBottomBores writes bores to the drawerBox-bottom panel', async () => {
    const opfs = new MemOpfs();
    const box = drawerBoxMath(slot, opening);
    const { bytes, panelPaths } = await buildDrawerBox(box, { boxId: 'box1', name: 'Box 1' }, opfs);

    const fakeBore: BoreOp = {
      id: 'tb-0', face: { featureId: 'panel', role: 'Bottom', instance: 0 },
      u: 16, v: 9, diameter: 5, depth: 12,
      role: 'tandem-drawer-bottom', connectorId: 'tc-0', connectorKind: 'tandem',
    };
    const { priorBores } = await writeBoxBottomBores(bytes, [fakeBore], opfs);

    // Exactly one panel path in priorBores (the bottom panel)
    expect(priorBores.size).toBe(1);
    const [bottomPath] = [...priorBores.keys()];
    expect(bottomPath).toBeDefined();

    // The bore was written to that panel
    const written = await boresOf(opfs, bottomPath!);
    expect(written.filter((b) => b.role === 'tandem-drawer-bottom')).toHaveLength(1);
    expect(panelPaths.some((p) => p === bottomPath)).toBe(true);
  });

  it('writeBoxBackBores writes bores to the drawerBox-back panel', async () => {
    const opfs = new MemOpfs();
    const box = drawerBoxMath(slot, opening);
    const { bytes, panelPaths } = await buildDrawerBox(box, { boxId: 'box2', name: 'Box 2' }, opfs);

    const fakeBore: BoreOp = {
      id: 'tbk-0', face: { featureId: 'panel', role: 'Bottom', instance: 0 },
      u: 16, v: 10, diameter: 10, depth: 12,
      role: 'tandem-drawer-back', connectorId: 'tc-0', connectorKind: 'tandem',
    };
    const { priorBores } = await writeBoxBackBores(bytes, [fakeBore], opfs);

    expect(priorBores.size).toBe(1);
    const [backPath] = [...priorBores.keys()];
    expect(backPath).toBeDefined();

    const written = await boresOf(opfs, backPath!);
    expect(written.filter((b) => b.role === 'tandem-drawer-back')).toHaveLength(1);
    expect(panelPaths.some((p) => p === backPath)).toBe(true);
  });

  it('priorBores snapshot: second call does not overwrite prior', async () => {
    const opfs = new MemOpfs();
    const box = drawerBoxMath(slot, opening);
    const { bytes } = await buildDrawerBox(box, { boxId: 'box3', name: 'Box 3' }, opfs);

    const bore1: BoreOp = {
      id: 'tb-1', face: { featureId: 'panel', role: 'Bottom', instance: 0 },
      u: 16, v: 9, diameter: 5, depth: 12,
      role: 'tandem-drawer-bottom', connectorId: 'tc-0', connectorKind: 'tandem',
    };
    const { priorBores: prior1 } = await writeBoxBottomBores(bytes, [bore1], opfs);
    // Prior snapshot should be empty (no bores before first call)
    const [path1] = [...prior1.keys()];
    expect(prior1.get(path1!)).toHaveLength(0);
  });
});
