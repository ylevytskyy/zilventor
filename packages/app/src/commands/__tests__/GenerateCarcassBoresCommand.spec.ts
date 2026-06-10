// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { GenerateCarcassBoresCommand } from '../GenerateCarcassBoresCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AssemblyDocument, BoreOp, PanelRole, PartDocument } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async exists(p: string) { return this.files.has(p); }
}

/**
 * Write a minimal panel .zipt using the REAL baseCabinet dim convention:
 *   length = panel HEIGHT (longest dim; maps to world-Z for side panels, world-X for horizontal panels),
 *   width  = panel DEPTH  (Y),
 *   thickness = board thickness (T).
 * GenerateCarcassBoresCommand swaps L↔T for leftSide/rightSide roles to get correct world AABBs.
 */
async function writePanel(
  opfs: MemOpfs, path: string,
  length: number, width: number, thickness: number,
  bores?: BoreOp[],
) {
  const doc: Partial<PartDocument> = {
    id: path, name: path, units: 'mm', parameters: {},
    featureTree: [{
      kind: 'panel', id: 'panel',
      length: { kind: 'literal', value: length },
      width: { kind: 'literal', value: width },
      thickness: { kind: 'literal', value: thickness },
      thicknessFromMaterial: true,
      materialId: 'm', grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
    } as unknown as import('@zilventor/shared').Feature],
    ...(bores ? { bores } : {}),
  };
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
  await opfs.write(path, await packProject({ manifest, blobs: {} }));
}

function instance(
  id: string, partPath: string, role: PanelRole,
  pos: { x: number; y: number; z: number },
) {
  return { id, partPath, position: pos, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role };
}

/**
 * Cabinet fixture — 600×560×720mm carcass, Tc=18mm, Tb=6mm, no toekick.
 *
 * Uses REAL baseCabinet dimension convention (length = HEIGHT for side panels):
 *   Left  side: dims=(L=720, W=560, T=18), pos=(0,0,0)     → world X[0,18], Y[0,560], Z[0,720]
 *   Right side: dims=(L=720, W=560, T=18), pos=(582,0,0)   → world X[582,600], Y[0,560], Z[0,720]
 *   Bottom:     dims=(L=564, W=554, T=18), pos=(18,6,0)    → world X[18,582], Y[6,560], Z[0,18]
 *   Top:        dims=(L=564, W=554, T=18), pos=(18,6,702)  → world X[18,582], Y[6,560], Z[702,720]
 *
 * The command swaps L↔T for side panels so jointMath sees:
 *   Left side effective dims=(L=18, W=560, T=720), center=(9,280,360)
 *   World AABB: X[0,18], Y[0,560], Z[0,720] — thin in X ✓, contacts Bottom at X=18.
 *
 * Left side ↔ Bottom joint: contact at X=18. Joint line runs along Y (Y-overlap=[6,560], len=554mm).
 * With PARAMS (endSetback=60, maxSpacing=250, minCount=2):
 *   count = max(2, ceil((554-120)/250)+1) = 3; u=[60, 277, 494]; v=T_bottom/2=9.
 */
const W = 600, D = 560, H = 720, Tc = 18, Tb = 6;

function seedCabinetAssembly(opfs: MemOpfs): AssemblyDocument {
  const doc: AssemblyDocument = {
    id: 'A1', name: 'Cab', units: 'mm', parameters: {}, properties: {},
    components: [
      instance('C1', 'L.zipt', 'leftSide',  { x: 0,      y: 0, z: 0 }),
      instance('C2', 'R.zipt', 'rightSide', { x: W - Tc, y: 0, z: 0 }),
      instance('C3', 'B.zipt', 'bottom',    { x: Tc,     y: Tb, z: 0 }),
      instance('C4', 'T.zipt', 'top',       { x: Tc,     y: Tb, z: H - Tc }),
    ],
    constraints: [], groundedComponentPaths: [['C1']], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
  return doc;
}

async function writeCabinetPanels(opfs: MemOpfs) {
  // REAL baseCabinet dims: length = HEIGHT for side panels, T = board thickness.
  await writePanel(opfs, 'L.zipt', H,         D,      Tc);  // Left  side: 720×560×18
  await writePanel(opfs, 'R.zipt', H,         D,      Tc);  // Right side: 720×560×18
  await writePanel(opfs, 'B.zipt', W - 2*Tc,  D - Tb, Tc);  // Bottom:     564×554×18
  await writePanel(opfs, 'T.zipt', W - 2*Tc,  D - Tb, Tc);  // Top:        564×554×18
}

async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const project = await unpackProject(await opfs.read(path));
  return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
}

const PARAMS = {
  endSetback: 60, maxSpacing: 250, minCount: 2,
  confirmat: true, minifix: false, dowel: false,
};

describe('GenerateCarcassBoresCommand — auto', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('writes bores to the involved panels and links A/B by connectorId', async () => {
    const opfs = new MemOpfs();
    await writeCabinetPanels(opfs);
    seedCabinetAssembly(opfs);

    await new GenerateCarcassBoresCommand({ params: PARAMS, opfs }).apply();

    const lBores = await boresOf(opfs, 'L.zipt');
    const bBores = await boresOf(opfs, 'B.zipt');
    expect(lBores.length).toBeGreaterThan(0);
    expect(bBores.length).toBeGreaterThan(0);
    // A-side and B-side bores share connectorIds
    const lConn = new Set(lBores.map((x) => x.connectorId));
    const bConn = new Set(bBores.map((x) => x.connectorId));
    expect([...bConn].some((id) => lConn.has(id))).toBe(true);
    // all confirmat
    expect(lBores.every((b) => b.connectorKind === 'confirmat')).toBe(true);
  });

  it('right side bores mirror the left side count', async () => {
    const opfs = new MemOpfs();
    await writeCabinetPanels(opfs);
    seedCabinetAssembly(opfs);
    await new GenerateCarcassBoresCommand({ params: PARAMS, opfs }).apply();
    expect((await boresOf(opfs, 'L.zipt')).length).toBe((await boresOf(opfs, 'R.zipt')).length);
  });

  /**
   * LOCKING TEST: real baseCabinet dims + corner positions → correct joints + correct bore coords.
   *
   * Left side ↔ Bottom joint geometry (empirically computed):
   *   - Contact at X=18 (left side inner face X, bottom left end X).
   *   - Joint line runs along Y: p0=(18,6,9)→p1=(18,560,9), length=554mm.
   *   - count=3, u=[60, 277, 494], v=T_bottom/2=9.
   *   - Face-drilled bores on leftSide face 'Left' at u values [60,277,494], v=9.
   *   - This test FAILS if the side-panel dim swap is missing (wrong center formula produces
   *     no butt joint → 0 bores).
   */
  it('REAL-CABINET: side-panel dim swap → correct world joints + bore u-coords on leftSide', async () => {
    const opfs = new MemOpfs();
    await writeCabinetPanels(opfs);
    seedCabinetAssembly(opfs);

    await new GenerateCarcassBoresCommand({ params: PARAMS, opfs }).apply();

    // All 4 panels receive bores (joints on both sides × bottom + top).
    for (const path of ['L.zipt', 'R.zipt', 'B.zipt', 'T.zipt']) {
      expect((await boresOf(opfs, path)).length).toBeGreaterThan(0);
    }

    // leftSide gets bores from 2 joints (bottom + top). Each joint has 3 confirmat bores.
    // Joint length (left↔bottom) = Y-overlap = 560−6 = 554mm.
    // count = max(2, ceil(434/250)+1) = 3 per joint → 6 face-drilled bores on leftSide.
    const lBores = await boresOf(opfs, 'L.zipt');
    expect(lBores.length).toBeGreaterThanOrEqual(6);

    // Verify leftSide bore u-values come from the correct joint geometry.
    // Left↔bottom joint: length=554mm, endSetback=60, maxSpacing=250:
    //   usable=434, count=max(2,ceil(434/250)+1)=max(2,3)=3, step=217
    //   u=[60, 60+217=277, 277+217=494], v=T_bottom/2=9.
    // Left↔top joint: same length and params → same u and v.
    // So leftSide has 3+3=6 bores total. Each bore must have u∈{60,277,494} and v=9.
    const expectedUs = [60, 277, 494];
    for (const b of lBores) {
      const matchesU = expectedUs.some((eu) => Math.abs(b.u - eu) < 1);
      expect(matchesU).toBe(true);
      // v = half of the other panel's thickness (bottom or top both have T=18 → v=9)
      expect(b.v).toBeCloseTo(9, 1);
    }
  });
});

describe('GenerateCarcassBoresCommand — revert', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('removes the bores key entirely when the panel had none before', async () => {
    const opfs = new MemOpfs();
    await writeCabinetPanels(opfs);
    seedCabinetAssembly(opfs);
    const cmd = new GenerateCarcassBoresCommand({ params: PARAMS, opfs });
    await cmd.apply();
    expect((await boresOf(opfs, 'L.zipt')).length).toBeGreaterThan(0);

    await cmd.revert();

    // Key must be ABSENT from the document, not set to [] — exactOptionalPropertyTypes contract.
    const project = await unpackProject(await opfs.read('L.zipt'));
    const doc = (project.manifest as { document: Record<string, unknown> }).document;
    expect('bores' in doc).toBe(false);
  });

  it('restores the prior bores[] when the panel already had some', async () => {
    const opfs = new MemOpfs();
    const seedBore: BoreOp = {
      id: 'pre', face: { featureId: 'panel', role: 'Front', instance: 0 },
      u: 10, v: 10, diameter: 5, depth: 12,
      role: 'dowel-face', connectorId: 'pre-conn', connectorKind: 'dowel',
    };
    // Write L.zipt with a pre-existing bore (real baseCabinet dims)
    await writePanel(opfs, 'L.zipt', H,        D,      Tc, [seedBore]);
    await writePanel(opfs, 'R.zipt', H,        D,      Tc);
    await writePanel(opfs, 'B.zipt', W - 2*Tc, D - Tb, Tc);
    await writePanel(opfs, 'T.zipt', W - 2*Tc, D - Tb, Tc);
    seedCabinetAssembly(opfs);
    const cmd = new GenerateCarcassBoresCommand({ params: PARAMS, opfs });
    await cmd.apply();
    // After apply: L.zipt should have seedBore plus new bores
    expect((await boresOf(opfs, 'L.zipt')).length).toBeGreaterThan(1);

    await cmd.revert();

    // After revert: only the original seedBore remains
    const after = await boresOf(opfs, 'L.zipt');
    expect(after).toEqual([seedBore]);
  });
});

// ---------------------------------------------------------------------------
// LOCKING TEST: nested sub-assembly structure (the REAL structure that
// CreateCabinetCommand produces).
//
// Structure:
//   Top-level active assembly:
//     components[0] = { id:'TOP1', partPath:'Base Cabinet 1.ziasm', role:undefined }  ← role-less wrapper
//
//   'Base Cabinet 1.ziasm' (sub-assembly):
//     components = [
//       { id:'C1', partPath:'Base Cabinet 1 - Left.zipt',   role:'leftSide',  pos:{0,0,0}      }
//       { id:'C2', partPath:'Base Cabinet 1 - Right.zipt',  role:'rightSide', pos:{582,0,0}     }
//       { id:'C3', partPath:'Base Cabinet 1 - Bottom.zipt', role:'bottom',    pos:{18,6,0}      }
//       { id:'C4', partPath:'Base Cabinet 1 - Top.zipt',    role:'top',       pos:{18,6,702}    }
//     ]
//
// This is the EXACT same nested layout used in the real app.
// The test FAILS against the pre-fix code (0 bores — bug: role-less wrapper is skipped).
// After the fix it PASSES, asserting bore coords identical to the flat-panel locking test.
// ---------------------------------------------------------------------------
describe('GenerateCarcassBoresCommand — nested sub-assembly (REAL cabinet structure)', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  const CAB = 'Base Cabinet 1';
  const LP  = `${CAB} - Left.zipt`;
  const RP  = `${CAB} - Right.zipt`;
  const BP  = `${CAB} - Bottom.zipt`;
  const TP  = `${CAB} - Top.zipt`;
  const ZIASM = `${CAB}.ziasm`;

  async function buildNestedStructure(opfs: MemOpfs): Promise<void> {
    // 1. Write the four panel .zipt files (same dims as flat-panel fixture).
    await writePanel(opfs, LP, H,         D,      Tc);  // leftSide
    await writePanel(opfs, RP, H,         D,      Tc);  // rightSide
    await writePanel(opfs, BP, W - 2*Tc,  D - Tb, Tc);  // bottom
    await writePanel(opfs, TP, W - 2*Tc,  D - Tb, Tc);  // top

    // 2. Write the .ziasm sub-assembly — exactly what CreateCabinetCommand.buildCabinetAssembly() produces.
    const cabinetDoc: AssemblyDocument = {
      id: 'A_CAB', name: CAB, units: 'mm', parameters: {}, properties: {},
      components: [
        { id: 'C1', partPath: LP, position: { x: 0,      y: 0,  z: 0      }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'leftSide'  },
        { id: 'C2', partPath: RP, position: { x: W - Tc, y: 0,  z: 0      }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'rightSide' },
        { id: 'C3', partPath: BP, position: { x: Tc,     y: Tb, z: 0      }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'bottom'    },
        { id: 'C4', partPath: TP, position: { x: Tc,     y: Tb, z: H - Tc }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'top'       },
      ],
      constraints: [], groundedComponentPaths: [['C1']], colors: {},
      bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [], hardware: [],
    };
    const ziasmBytes = await packAssembly(cabinetDoc, new Uint8Array());
    await opfs.write(ZIASM, ziasmBytes);

    // 3. Set up top-level active assembly with a ROLE-LESS wrapper pointing to .ziasm.
    const topDoc: AssemblyDocument = {
      id: 'A_TOP', name: 'Room', units: 'mm', parameters: {}, properties: {},
      components: [
        // No `role` on the top-level component — exactly what PlaceComponentCommand produces.
        { id: 'TOP1', partPath: ZIASM, position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [], groundedComponentPaths: [['TOP1']], colors: {},
      bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [], hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: topDoc });
  }

  it('LOCKING — nested sub-asm: bores are written to panel .zipt files (fails pre-fix with 0 bores)', async () => {
    const opfs = new MemOpfs();
    await buildNestedStructure(opfs);

    await new GenerateCarcassBoresCommand({ params: PARAMS, opfs }).apply();

    // All four panels must receive bores.
    for (const path of [LP, RP, BP, TP]) {
      expect((await boresOf(opfs, path)).length, `${path} must have bores`).toBeGreaterThan(0);
    }

    // leftSide bore u-coords must match the flat-panel locking test (same geometry).
    // Left↔Bottom joint: length=554mm, endSetback=60, maxSpacing=250 → count=3, u=[60,277,494], v=9.
    const lBores = await boresOf(opfs, LP);
    expect(lBores.length, 'leftSide: 3 bottom + 3 top = 6').toBeGreaterThanOrEqual(6);
    const expectedUs = [60, 277, 494];
    for (const b of lBores) {
      expect(expectedUs.some((eu) => Math.abs(b.u - eu) < 1), `u=${b.u} not in ${expectedUs}`).toBe(true);
      expect(b.v).toBeCloseTo(9, 1);
    }
  });

  it('LOCKING — nested sub-asm: revert removes bores written into sub-asm panels', async () => {
    const opfs = new MemOpfs();
    await buildNestedStructure(opfs);

    const cmd = new GenerateCarcassBoresCommand({ params: PARAMS, opfs });
    await cmd.apply();
    expect((await boresOf(opfs, LP)).length).toBeGreaterThan(0);

    await cmd.revert();

    // After revert: bores key must be absent from each panel.
    for (const path of [LP, RP, BP, TP]) {
      const project = await unpackProject(await opfs.read(path));
      const doc = (project.manifest as { document: Record<string, unknown> }).document;
      expect('bores' in doc, `${path}: bores key must be absent after revert`).toBe(false);
    }
  });
});
