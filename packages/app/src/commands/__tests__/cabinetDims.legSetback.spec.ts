// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { deriveCabinetDims } from '../cabinetDims';
import { packProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AssemblyDocument, Feature, PartDocument } from '@zilventor/shared';

const Tc = 18, W = 600, D = 560, H = 720, TKH = 100, TKS = 50;

/** Builds and packs a panel part with the real PanelFeature shape used in AddDrawerBankCommand.spec. */
async function makePanelPart(length: number, width: number, thickness: number, id: string): Promise<Uint8Array> {
  const doc: Partial<PartDocument> = {
    id, name: id, units: 'mm', parameters: {},
    featureTree: [{
      kind: 'panel', id: 'panel',
      length: { kind: 'literal', value: length },
      width: { kind: 'literal', value: width },
      thickness: { kind: 'literal', value: thickness },
      thicknessFromMaterial: true, materialId: 'm', grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
    } as unknown as Feature],
  };
  return packProject({
    manifest: { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc },
    blobs: {},
  });
}

/** Minimal read-only OPFS backed by a plain object. */
function makeOpfs(parts: Record<string, Uint8Array>) {
  return {
    read: async (p: string): Promise<Uint8Array> => {
      const b = parts[p];
      if (!b) throw new Error(`makeOpfs: no file at "${p}"`);
      return b;
    },
  };
}

describe('deriveCabinetDims — toekickSetback', () => {
  it('derives toekickSetback from the toekick component Y position', async () => {
    // TKS = 50, so toekick y = D - TKS - Tc = 560 - 50 - 18 = 492
    // Formula inversion: toekickSetback = D - Tc - y = 560 - 18 - 492 = 50
    const parts: Record<string, Uint8Array> = {
      'L.zipt': await makePanelPart(H, D, Tc, 'L.zipt'),
    };

    const cab: AssemblyDocument = {
      id: 'A_TK_TEST', name: 'Cab', units: 'mm', parameters: {}, properties: {},
      components: [
        { id: 'C1', partPath: 'L.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'leftSide' },
        { id: 'C2', partPath: 'R.zipt', position: { x: W - Tc, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'rightSide' },
        { id: 'C3', partPath: 'B.zipt', position: { x: Tc, y: 0, z: TKH }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'bottom' },
        { id: 'TK', partPath: 'TK.zipt', position: { x: Tc, y: D - TKS - Tc, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'toekick' },
      ],
      constraints: [], groundedComponentPaths: [['C1']], colors: {},
      bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [], hardware: [],
    };

    const dims = await deriveCabinetDims(cab, makeOpfs(parts));
    expect(dims.toekickSetback).toBeCloseTo(TKS, 3);
    expect(dims.toekickHeight).toBeCloseTo(TKH, 3);
  });

  it('returns toekickSetback = 0 when no toekick component exists', async () => {
    const parts: Record<string, Uint8Array> = {
      'L.zipt': await makePanelPart(H, D, Tc, 'L.zipt'),
    };

    const cab: AssemblyDocument = {
      id: 'A_NO_TK', name: 'Cab2', units: 'mm', parameters: {}, properties: {},
      components: [
        { id: 'C1', partPath: 'L.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'leftSide' },
        { id: 'C2', partPath: 'R.zipt', position: { x: W - Tc, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'rightSide' },
        { id: 'C3', partPath: 'B.zipt', position: { x: Tc, y: 0, z: TKH }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'bottom' },
      ],
      constraints: [], groundedComponentPaths: [['C1']], colors: {},
      bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [], hardware: [],
    };

    const dims = await deriveCabinetDims(cab, makeOpfs(parts));
    expect(dims.toekickSetback).toBe(0);
  });
});
