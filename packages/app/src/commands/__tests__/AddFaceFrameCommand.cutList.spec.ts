// @vitest-environment node
/**
 * Cut-list reach test for face-frame members.
 *
 * Closes the verification gap: proves that faceFrameStile / faceFrameRail ComponentInstances
 * added by AddFaceFrameCommand actually produce cut-list ROWS via aggregateCutListRecursive.
 *
 * The "present-in-doc ≠ appears-in-cut-list" false-green class (drawer-bank slice memory) is
 * exactly the failure mode being guarded here.  The test constructs a real panelSpecs map by
 * reading every .zipt back through resolvePanelSpec (same path as production) so if the OPFS
 * file is missing or the PanelFeature is absent / malformed, the spec will be null and the row
 * will NOT appear — making the assertion truly RED in that scenario.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AddFaceFrameCommand } from '../AddFaceFrameCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AssemblyDocument, PartDocument } from '@zilventor/shared';
import { aggregateCutListRecursive } from '../../assembly/walkers/aggregateCutListRecursive';
import { resolvePanelSpec } from '../../shell/resolvePanelSpec';
import type { MaterialEntry } from '@zilventor/shared/src/material';

// ---------------------------------------------------------------------------
// MemOpfs — in-memory OPFS stand-in (verbatim from AddFaceFrameCommand.spec.ts)
// ---------------------------------------------------------------------------
class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string): Promise<Uint8Array> {
    const b = this.files.get(p);
    if (!b) throw new Error(`no file ${p}`);
    return b;
  }
  async write(p: string, b: Uint8Array): Promise<void> { this.files.set(p, b); }
  async exists(p: string): Promise<boolean> { return this.files.has(p); }
  async delete(p: string): Promise<void> { this.files.delete(p); }
}

function makeKernel() {
  const registered = new Set<string>();
  return {
    registered,
    async registerPart(p: PartDocument) { registered.add(p.id); },
    async deletePart(id: string) { registered.delete(id); },
  };
}

// ---------------------------------------------------------------------------
// Panel part builder — verbatim from AddFaceFrameCommand.spec.ts
// ---------------------------------------------------------------------------
function panelPart(id: string, length: number, width: number, thickness: number): PartDocument {
  return {
    id, name: id, units: 'mm', parameters: {},
    featureTree: [{
      kind: 'panel', id: 'panel',
      length: { kind: 'literal', value: length },
      width: { kind: 'literal', value: width },
      thickness: { kind: 'literal', value: thickness },
      thicknessFromMaterial: false,
      materialId: 'm', grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
    }],
    properties: {},
    materials: [{ id: 'm', name: 'MDF', defaultThickness: 18, color: '#ccc' }],
    hardware: [],
  } as unknown as PartDocument;
}

// ---------------------------------------------------------------------------
// seedCabinet — verbatim from AddFaceFrameCommand.spec.ts
// W=600, H=720, D=560, Tc=18, tkH=100
// ---------------------------------------------------------------------------
const MAT: MaterialEntry[] = [
  { id: 'm', name: 'MDF', defaultThickness: 18, color: '#ccc' },
];

async function seedCabinet(opfs: MemOpfs): Promise<string> {
  const cabinetPath = 'proj/cab1.ziasm';
  const leftPath    = 'proj/cab-left.zipt';
  const rightPath   = 'proj/cab-right.zipt';
  const bottomPath  = 'proj/cab-bottom.zipt';

  const part = (id: string, l: number, w: number, t: number) =>
    packProject({
      manifest: { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part', document: panelPart(id, l, w, t) },
      blobs: {},
    });

  await opfs.write(leftPath,   await part('left',   720, 560, 18));
  await opfs.write(rightPath,  await part('right',  720, 560, 18));
  await opfs.write(bottomPath, await part('bottom', 564, 560, 18));

  const cabinet: AssemblyDocument = {
    id: 'cab1', name: 'cab1', units: 'mm',
    components: [
      { id: 'L', partPath: leftPath,   position: { x: 0,   y: 0, z: 0   }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'leftSide' },
      { id: 'R', partPath: rightPath,  position: { x: 582, y: 0, z: 0   }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'rightSide' },
      { id: 'B', partPath: bottomPath, position: { x: 0,   y: 0, z: 100 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'bottom' },
    ],
    constraints: [], groundedComponentPaths: [['C1']], colors: {}, bomItemNumbers: {},
    cutListItemNumbers: {}, colorOverrides: {},
    materials: MAT,
    hardware: [],
  } as unknown as AssemblyDocument;

  await opfs.write(cabinetPath, await packAssembly(cabinet, new Uint8Array()));
  useAppStore.getState().setSubAssemblyDocs({ [cabinetPath]: cabinet });
  return cabinetPath;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------
describe('AddFaceFrameCommand → cut-list rows', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
  });

  it('face-frame members appear as real cut-list rows with correct dims and qty', async () => {
    // Cabinet dims: W=600, H=720, D=560, Tc=18, tkH=100
    // rows=2, cols=2, stileWidth=38, railWidth=38, thickness=19
    //   frameH = 720 - 100 = 620
    //   ow     = (600 - 3*38) / 2 = 243
    //   oh     = (620 - 3*38) / 2 = 253
    //   stiles : cols+1 = 3  × { length=620, width=38,  thickness=19 }
    //   rails  : cols*(rows+1) = 6 × { length=38, width=243, thickness=19 }
    //   NOTE: grain='length' for stiles → L stays 620; grain='width' for rails → normalizeLW swaps
    //         to L=max(38,243)=243, W=min(38,243)=38 ... but grain='width' is NOT 'none',
    //         so normalizeLW does NOT swap (only 'none' triggers the swap). See cutListRow.ts:5-8.
    //         Rail dims emitted: length=38, width=243 (as written by AddFaceFrameCommand).

    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    const cmd = new AddFaceFrameCommand({
      cabinetPath,
      params: { rows: 2, cols: 2, stileWidth: 38, railWidth: 38, thickness: 19 },
      opfs, kernel, store: useAppStore,
    });
    await cmd.apply();

    // Read back the cabinet with face-frame components attached.
    const updatedCab = await unpackAssembly(await opfs.read(cabinetPath));

    // Collect all .zipt paths referenced in the updated cabinet (carcass panels + face-frame members).
    const zipts = updatedCab.components
      .filter((c) => c.partPath.endsWith('.zipt'))
      .map((c) => c.partPath);
    expect(zipts.length).toBeGreaterThan(0);

    // Build the panelSpecs map via resolvePanelSpec — same path as production code.
    const panelSpecs = new Map<string, import('@zilventor/shared/src/panel-feature').PanelSpec | null>();
    for (const path of zipts) {
      await resolvePanelSpec(opfs, path, panelSpecs);
    }

    // Verify all face-frame member paths resolved to non-null specs.
    const ffStiles = updatedCab.components.filter((c) => c.role === 'faceFrameStile');
    const ffRails  = updatedCab.components.filter((c) => c.role === 'faceFrameRail');
    expect(ffStiles).toHaveLength(3);
    expect(ffRails).toHaveLength(6);

    for (const c of [...ffStiles, ...ffRails]) {
      expect(panelSpecs.get(c.partPath),
        `panelSpec must be non-null for ${c.partPath} (role=${String(c.role)})`
      ).not.toBeNull();
    }

    // Build the sub-assembly cache: top-level project points at the cabinet .ziasm.
    const subAsmCache = {
      get: (p: string) =>
        p === cabinetPath
          ? { kind: 'ok' as const, doc: updatedCab, partPath: p }
          : undefined,
    };

    // A minimal top-level assembly that references the cabinet.
    const topDoc: AssemblyDocument = {
      id: 'project', name: 'project', units: 'mm',
      parameters: {}, components: [
        {
          id: 'cab',
          partPath: cabinetPath,
          position: { x: 0, y: 0, z: 0 },
          rotation: { rx: 0, ry: 0, rz: 0 },
          visible: true,
        },
      ],
      constraints: [], groundedComponentPaths: [],
      colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: MAT, hardware: [],
    } as unknown as AssemblyDocument;

    const result = aggregateCutListRecursive(
      topDoc,
      subAsmCache,
      panelSpecs,
      MAT,
      new Map(), // partInfo — only affects partName string, not row presence
    );

    // -----------------------------------------------------------------------
    // Core assertions: face-frame members MUST appear as cut-list rows.
    // -----------------------------------------------------------------------

    // 1. Stile row: length=620, width=38, thickness=19, qty=3
    const stileRow = result.rows.find(
      (r) => r.thickness === 19 && r.length === 620 && r.width === 38,
    );
    expect(stileRow, 'stile row (L=620, W=38, T=19) not found in cut-list').toBeDefined();
    expect(stileRow!.qty).toBe(3); // cols+1 = 3

    // 2. Rail row: length=38, width=243, thickness=19, qty=6
    //    (grain='width', no swap — normalizeLW only swaps on grain='none')
    const railRow = result.rows.find(
      (r) => r.thickness === 19 && r.length === 38 && r.width === 243,
    );
    expect(railRow, 'rail row (L=38, W=243, T=19) not found in cut-list').toBeDefined();
    expect(railRow!.qty).toBe(6); // cols*(rows+1) = 2*3 = 6

    // 3. Carcass panels (3 carcass .zipts) should also be in the cut-list.
    //    They have thickness=18 — confirm they are not confused with face-frame rows (T=19).
    const carcassRows = result.rows.filter((r) => r.thickness === 18);
    expect(carcassRows.length).toBeGreaterThan(0);

    // 4. No face-frame members should appear in the excluded count.
    //    The 3 carcass panels (left, right, bottom) all have panelSpecs.
    expect(result.excluded.componentCount).toBe(0);
  });
});
