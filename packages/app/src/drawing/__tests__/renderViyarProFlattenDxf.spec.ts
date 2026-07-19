import { describe, it, expect } from 'vitest';
import { renderViyarProFlattenDxf } from '../renderViyarProFlattenDxf';
import type { PanelManufacturingInput } from '../renderPanelManufacturingDxf';
import type { BoreOp, AssemblyDocument, ComponentInstance } from '@zilventor/shared';
import type { PanelSpec } from '@zilventor/shared/src/panel-feature';
import type { MaterialEntry } from '@zilventor/shared/src/material';
import { aggregateCutListRecursive } from '../../assembly/walkers/aggregateCutListRecursive';
import { aggregatePanelManufacturing } from '../../assembly/walkers/aggregatePanelManufacturing';

function panel(over: Partial<PanelManufacturingInput> = {}): PanelManufacturingInput {
  return {
    itemNumber: 1,
    partName: 'Door',
    materialName: 'AUTO',
    qty: 1,
    spec: {
      length: 400, width: 300, thickness: 18, materialId: 'm1', grain: 'none',
      edgeBands: { front: null, back: null, left: null, right: null },
    } as any,
    bores: [],
    grooves: [],
    ...over,
  };
}

function bore(role: string, u: number, v: number, diameter: number,
              depth: number | 'throughAll', extra: Partial<BoreOp> = {}): BoreOp {
  const face: BoreOp['face'] = { featureId: 'panel', role, instance: 0 };
  return { id: `b-${role}-${u}-${v}`, face, u, v, diameter, depth, role: 'shelfPin-system32', ...extra } as BoreOp;
}

describe('renderViyarProFlattenDxf — two-level BLOCK structure', () => {
  it('emits a top-level material BLOCK named <MATERIAL>_THICKNESS_<mm>', () => {
    const dxf = renderViyarProFlattenDxf([panel()]);
    expect(dxf).toContain('AUTO_THICKNESS_18');
  });

  it('nested panel BLOCK is INSERTd inside the material block with ATTRIB Skp_GroupInstanceName = "<partName> {<itemNumber>}"', () => {
    const dxf = renderViyarProFlattenDxf([panel({ partName: 'Дверка', itemNumber: 10 })]);
    expect(dxf).toContain('Skp_GroupInstanceName');
    expect(dxf).toContain('Дверка {10}');
    expect(dxf).toContain('Group1#1');
  });

  it('ENTITIES INSERT carries ATTRIB Skp_ComponentInstanceName = literal ABF_Flatten', () => {
    const dxf = renderViyarProFlattenDxf([panel()]);
    expect(dxf).toContain('Skp_ComponentInstanceName');
    expect(dxf).toContain('ABF_Flatten');
  });

  it('two panels of the same material are grouped into ONE material block (single ENTITIES INSERT)', () => {
    const dxf = renderViyarProFlattenDxf([
      panel({ itemNumber: 1, partName: 'A' }),
      panel({ itemNumber: 2, partName: 'B' }),
    ]);
    expect(dxf).toContain('A {1}');
    expect(dxf).toContain('B {2}');
    const entitiesSection = dxf.slice(dxf.indexOf('\n  2\nENTITIES\n'));
    const materialInsertCount = (entitiesSection.match(/AUTO_THICKNESS_18/g) ?? []).length;
    expect(materialInsertCount).toBe(1);
  });

  it('two different materials produce two material blocks and two ENTITIES INSERTs', () => {
    const dxf = renderViyarProFlattenDxf([
      panel({ materialName: 'AUTO' }),
      panel({ materialName: 'SREE_PEARLS_2' }),
    ]);
    expect(dxf).toContain('AUTO_THICKNESS_18');
    expect(dxf).toContain('SREE_PEARLS_2_THICKNESS_18');
    const entitiesSection = dxf.slice(dxf.indexOf('\n  2\nENTITIES\n'));
    expect((entitiesSection.match(/AUTO_THICKNESS_18/g) ?? []).length).toBe(1);
    expect((entitiesSection.match(/SREE_PEARLS_2_THICKNESS_18/g) ?? []).length).toBe(1);
  });
});

describe('renderViyarProFlattenDxf — layer grammar', () => {
  it('face bore with sku goes on DEPTH<depth>-ARTICLE<sku>', () => {
    const b = bore('Top', 50, 40, 5, 12, { sku: 'X123' });
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    expect(dxf).toContain('DEPTH12-ARTICLEX123');
  });

  // ABF-DSIDE-<dia> was live-disqualified 2026-07-19 (see the describe block below) — a
  // finite-depth edge bore now shares the face bore's DEPTH<depth>[-ARTICLE<sku>] family.
  it('edge bore with finite depth goes on DEPTH<depth>, same family as a face bore', () => {
    const b = bore('Front', 9, 100, 5, 32);
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    expect(dxf).toContain('DEPTH32');
    expect(dxf).not.toContain('ABF-DSIDE');
  });

  it('throughAll bore with sku goes on D<diameter>-DEPTHF-<sku>', () => {
    const b = bore('Bottom', 50, 40, 7, 'throughAll', { sku: '$44817' });
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    expect(dxf).toContain('D7-DEPTHF-$44817');
  });

  it('panel outline lives on ABF_cuttingLines (now via the R2 nested cutline block, not an LWPOLYLINE — see the R2 describe block below for the byte-level structure)', () => {
    const dxf = renderViyarProFlattenDxf([panel()]);
    expect(dxf).toContain('ABF_cuttingLines');
  });
});

describe('renderViyarProFlattenDxf — R2 nested cutting-line block (replaces the LWPOLYLINE outline)', () => {
  // The live-accepted golden reference (.vp-native/variants/f4.dxf) has NO LWPOLYLINE outline
  // at all — the panel's outline lives in its OWN child BLOCK, INSERT'd from the panel block.
  it('the outline is now a nested child BLOCK ("Group1_cutline#1"), NOT an LWPOLYLINE inside the panel block', () => {
    const dxf = renderViyarProFlattenDxf([panel()]);
    expect(dxf).not.toContain('LWPOLYLINE');
    expect(dxf).toContain('Group1_cutline#1');
  });

  it('the cutline child block contains a legacy (AcDb3dPolyline) closed contour, not an LWPOLYLINE', () => {
    const dxf = renderViyarProFlattenDxf([panel()]);
    expect(dxf).toContain('AcDb3dPolyline');
    expect(dxf).toMatch(/\s70\n\s*9\n/); // closed + 3D flag
  });

  it('the INSERT referencing the cutline block carries the Skp_GroupInstanceName ATTRIB = "_ABF_cuttingLines", on layer ABF_cuttingLines, at insertion Z = panel thickness', () => {
    const dxf = renderViyarProFlattenDxf([panel({ spec: { length: 400, width: 300, thickness: 18, materialId: 'm1', grain: 'none', edgeBands: { front: null, back: null, left: null, right: null } } as any })]);
    const insertIdx = dxf.indexOf('\nINSERT\n');
    const nearby = dxf.slice(insertIdx, insertIdx + 400);
    expect(nearby).toContain('Group1_cutline#1');
    expect(nearby).toContain('_ABF_cuttingLines');
    expect(nearby).toContain('ABF_cuttingLines');
    expect(nearby).toMatch(/\s30\n18\.0000\n/);
    expect(nearby).toMatch(/\s66\n\s*1\n/);
  });
});

describe('renderViyarProFlattenDxf — R3 solid representation (box faces + edges)', () => {
  it('emits 6 polyface-mesh POLYLINE entities (AcDbPolyFaceMesh, 71=4, 72=2) on layer Untagged00', () => {
    const dxf = renderViyarProFlattenDxf([panel()]);
    const faceCount = (dxf.match(/AcDbPolyFaceMesh\n/g) ?? []).length;
    expect(faceCount).toBe(6);
    expect(dxf).toContain('Untagged00');
  });

  it('emits 24 edge LINE entities (12 unique box edges, each emitted twice) on layer ABF_cuttingLines', () => {
    const dxf = renderViyarProFlattenDxf([panel({ spec: { length: 400, width: 300, thickness: 18, materialId: 'm1', grain: 'none', edgeBands: { front: null, back: null, left: null, right: null } } as any })]);
    // count LINE entities whose group-8 layer is ABF_cuttingLines (not counting the polyline3d
    // cutline contour's own POLYLINE/VERTEX entities, which are a different entity type)
    const lineOnCuttingLines = (dxf.match(/LINE\n\s*5\n[0-9A-F]+\n330\n[0-9A-F]+\n100\nAcDbEntity\n\s*8\nABF_cuttingLines\n100\nAcDbLine\n/g) ?? []).length;
    expect(lineOnCuttingLines).toBe(24);
  });

  it('Untagged00 is declared in the LAYER table', () => {
    const dxf = renderViyarProFlattenDxf([panel()]);
    expect(dxf).toMatch(/LAYER\n\s*5\n[0-9A-F]+\n100\nAcDbSymbolTableRecord\n100\nAcDbLayerTableRecord\n\s*2\nUntagged00\n/);
  });
});

describe('renderViyarProFlattenDxf — R1 sketchupCompat TABLES/OBJECTS richness', () => {
  it('DIMSTYLE table has 3 entries (Standard/DimStyle1/Dimensions), STYLE has Tahoma, OBJECTS declares the 3 required dictionary keys', () => {
    const dxf = renderViyarProFlattenDxf([panel()]);
    const dimstyleHeader = /2\nDIMSTYLE\n\s*5\n[0-9A-F]+\n\s*70\n\s*(\d+)/.exec(dxf);
    expect(dimstyleHeader![1]).toBe('3');
    expect(dxf).toContain('DimStyle1');
    expect(dxf).toContain('Dimensions');
    expect(dxf).toContain('Tahoma');
    expect(dxf).toContain('ACAD_SECTIONVIEWSTYLE');
    expect(dxf).toContain('ACDB_RECOMPOSE_DATA');
    expect(dxf).toContain('AcDbVariableDictionary');
  });

  it('HEADER declares $DIMALTF=25.4 (the header var the server\'s InvalidScaleError check reads)', () => {
    const dxf = renderViyarProFlattenDxf([panel()]);
    expect(dxf).toContain('$DIMALTF');
  });
});

describe('renderViyarProFlattenDxf — H1 material block name truncation', () => {
  it('a long material name keeps the "_THICKNESS_<mm>" suffix intact (budget-truncate BEFORE appending, not after)', () => {
    const dxf = renderViyarProFlattenDxf([panel({ materialName: 'DSP_18mm_Dub_sonoma' })]);
    expect(dxf).toContain('_THICKNESS_18');
    // the old bug sliced the concatenated string to 26 chars AFTER appending, clipping the suffix
    expect(dxf).not.toContain('_THICKN\n'); // truncated mid-suffix marker from the old bug
  });
});

describe('renderViyarProFlattenDxf — H2/R-THROUGHBORE skuless throughAll face bore layer', () => {
  // The server documents through-holes via the literal phrase DEPTHF in the layer name
  // ("Наскрізне вказується фразою 'DEPTHF'") — live debugging showed DEPTH<thickness>
  // (the original H2 fix) still triggers a "depth not specified" warning. D<dia>-DEPTHF
  // matches the sku'd variant's own grammar (D<dia>-DEPTHF-$<sku>) minus the sku.
  it('a throughAll face bore with NO sku goes on D<diameter>-DEPTHF (not DEPTH<thickness>, not the native BORES-FRONT-*MM fallback)', () => {
    const b = bore('Top', 50, 40, 7, 'throughAll');
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    expect(dxf).toContain('D7-DEPTHF');
    expect(dxf).not.toContain('DEPTH18');
    expect(dxf).not.toContain('BORES-FRONT');
  });

  it('an edge (non-face) throughAll bore with no sku is unaffected — still falls back to the native edge layer', () => {
    const b = bore('Front', 9, 100, 5, 'throughAll');
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    expect(dxf).toContain('BORES-EDGE-Front-5MM');
  });
});

describe('renderViyarProFlattenDxf — R-BORE nested bore groups (fixes silent hole-dropping)', () => {
  it('bores are nested in a child BLOCK ("Group1_bores1#1"), INSERTd with Skp_GroupInstanceName="_ABF_bore", layer 0, at the bore\'s panel-local position (Z=0)', () => {
    const b = bore('Top', 50, 40, 7, 12);
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    expect(dxf).toContain('Group1_bores1#1');
    expect(dxf).toContain('_ABF_bore');

    const insertMatch = /INSERT\n\s*5\n[0-9A-F]+\n330\n[0-9A-F]+\n100\nAcDbEntity\n\s*8\n0\n347\n[0-9A-F]+\n100\nAcDbBlockReference\n\s*66\n\s*1\n\s*2\nGroup1_bores1#1\n\s*10\n([\d.]+)\n\s*20\n([\d.]+)\n\s*30\n0\.0\n/.exec(dxf);
    expect(insertMatch, 'INSERT referencing the bore-group block, layer 0, Z literal 0.0').not.toBeNull();
    expect(Number(insertMatch![1])).toBeCloseTo(50);
    expect(Number(insertMatch![2])).toBeCloseTo(40);
  });

  it('the CIRCLE inside the bore-group block uses block-local coordinates (0,0 for a single-bore group\'s own reference point)', () => {
    const b = bore('Top', 50, 40, 7, 12);
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    expect(dxf).toMatch(/CIRCLE\n\s*5\n[0-9A-F]+\n330\n[0-9A-F]+\n100\nAcDbEntity\n\s*8\nDEPTH12\n100\nAcDbCircle\n\s*10\n0\.0000\n\s*20\n0\.0000\n/);
  });

  it('no bare CIRCLE remains directly in a panel block when bores exist — every CIRCLE is owned by its own bore-group BLOCK_RECORD, not the panel\'s', () => {
    const b = bore('Top', 50, 40, 7, 12);
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    const panelBlockRecordMatch = /BLOCK_RECORD\n\s*5\n([0-9A-F]+)\n100\nAcDbSymbolTableRecord\n100\nAcDbBlockTableRecord\n\s*2\nGroup1#1\n/.exec(dxf);
    expect(panelBlockRecordMatch).not.toBeNull();
    const panelHandle = panelBlockRecordMatch![1];
    const bareCircleOwnedByPanel = new RegExp(`CIRCLE\\n\\s*5\\n[0-9A-F]+\\n330\\n${panelHandle}\\n`).test(dxf);
    expect(bareCircleOwnedByPanel).toBe(false);
  });

  it('two bores on different layers get two separate bore-group blocks ("Group1_bores1#1", "Group1_bores2#1")', () => {
    const faceBore = bore('Top', 50, 40, 7, 12);
    // finite-depth edge bore now shares the DEPTH<depth> layer family, a DIFFERENT layer
    // than the face bore's DEPTH12 — still two distinct groups (see the describe block below).
    const edgeBore = bore('Front', 9, 100, 5, 20);
    const dxf = renderViyarProFlattenDxf([panel({ bores: [faceBore, edgeBore] })]);
    expect(dxf).toContain('Group1_bores1#1');
    expect(dxf).toContain('Group1_bores2#1');
  });
});

describe('renderViyarProFlattenDxf — finite-depth edge bores route through DEPTH<depth> (fixes "Некоректна глибина"/"Не вказана глибина" import errors)', () => {
  // ROOT CAUSE (locked 2026-07-19): the R-DSIDE encoding (ABF-DSIDE-<dia> layer, a CIRCLE +
  // companion 3D-POLYLINE "depth rectangle" pair) was live-bisected against viyar.pro's
  // importer across 3 independent single-variable uploads — mutating the depth-rect's
  // magnitude (34→30mm), splitting ABF-DSIDE-5 into two direction-specific layers, and
  // finally rerouting a PLAIN CIRCLE onto a DEPTH34 layer instead. Only the last one cleared
  // BOTH warnings; the first two reproduced the identical failure byte-for-byte, proving
  // viyar.pro never reads depth from the ABF-DSIDE circle+polyline geometry at all. The fix
  // is layer-scheme-only: finite-depth edge bores now go through the exact same flat-CIRCLE
  // R-BORE group path as face bores, on a DEPTH<depth>[-ARTICLE<sku>] layer.
  it('a finite-depth edge bore is a bare flat CIRCLE (no extrusion, no companion polyline) — same shape as a face bore', () => {
    const b = bore('Front', 9, 100, 5, 32);
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    // the panel's own R2 cutline block always emits an unrelated AcDb3dPolyline (the outline
    // contour) — the DEPTH32 layer itself must carry ONLY a CIRCLE, never a POLYLINE.
    expect(dxf).not.toMatch(/0\nPOLYLINE\n[\s\S]{0,300}?\s8\nDEPTH32\n/);
    const allCircleBlocks = [...dxf.matchAll(/0\nCIRCLE\n[\s\S]{0,300}?(?=\n\s*0\n|$)/g)].map((m) => m[0]);
    const depth32Circles = allCircleBlocks.filter((c) => c.includes('\n  8\nDEPTH32\n'));
    expect(depth32Circles.length).toBe(1);
    for (const c of depth32Circles) expect(c).not.toMatch(/210\n/); // no extrusion group
  });

  it('is grouped via the existing R-BORE _ABF_bore mechanism, not a dedicated side-drill sub-block', () => {
    const b = bore('Front', 9, 100, 5, 32);
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    expect(dxf).toContain('_ABF_bore');
    expect(dxf).not.toContain('_ABF_sideDrill');
    expect(dxf).not.toContain('Group1_dside');
  });

  it('a DIFFERENT depth (25mm) on the same diameter/role lands on a DIFFERENT DEPTH<depth> layer — depth is read from BoreOp.depth, not a fixed constant', () => {
    const b = bore('Front', 9, 100, 5, 25);
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    expect(dxf).toContain('DEPTH25');
    expect(dxf).not.toContain('DEPTH32');
  });

  it('Left/Right/Front/Back edge roles all land on the SAME DEPTH<depth> layer family — orientation no longer affects the layer name', () => {
    for (const role of ['Left', 'Right', 'Front', 'Back']) {
      const b = bore(role, 9, 50, 5, 20);
      const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
      expect(dxf).toContain('DEPTH20');
      expect(dxf).not.toContain('ABF-DSIDE');
    }
  });

  it('two edge bores at the same depth share ONE bore-group block (grouped by layer, like face bores)', () => {
    const b1 = bore('Front', 9, 100, 5, 32);
    const b2 = bore('Front', 9, 200, 5, 32);
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b1, b2] })]);
    expect(dxf).toContain('Group1_bores1#1');
    expect(dxf).not.toContain('Group1_bores2#1');
    const circleCount = (dxf.match(/0\nCIRCLE\n[\s\S]{0,200}?\s8\nDEPTH32\n/g) ?? []).length;
    expect(circleCount).toBe(2);
  });

  it('an edge bore with a sku gets DEPTH<depth>-ARTICLE<sku>, same as a face bore (sku no longer discarded)', () => {
    const b = bore('Front', 9, 100, 5, 32, { sku: 'X99' });
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    expect(dxf).toContain('DEPTH32-ARTICLEX99');
  });

  it('a throughAll edge bore is UNCHANGED — still the flat native-layer CIRCLE (existing R-THROUGHBORE behavior)', () => {
    const b = bore('Front', 9, 100, 5, 'throughAll');
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    expect(dxf).toContain('BORES-EDGE-Front-5MM');
    expect(dxf).not.toContain('DEPTH');
  });

  it('a face (Top/Bottom) bore is byte-for-byte unaffected — still routed through the existing _ABF_bore flat-circle group', () => {
    const b = bore('Top', 50, 40, 7, 12);
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    expect(dxf).toContain('_ABF_bore');
    expect(dxf).toContain('DEPTH12');
  });
});

describe('renderViyarProFlattenDxf — R-QTY panel-quantity instancing (fixes silent qty-drop)', () => {
  it('a qty=2 aggregated row emits TWO panel BLOCKs sharing the same base group id ("Group1#1", "Group1#2"), not one', () => {
    const dxf = renderViyarProFlattenDxf([panel({ qty: 2, partNames: ['Right Side', 'Left Side'] })]);
    expect(dxf).toContain('Group1#1');
    expect(dxf).toContain('Group1#2');
  });

  it('each instance\'s Skp_GroupInstanceName ATTRIB uses partNames[i], falling back to partName when partNames is absent/short', () => {
    const dxf = renderViyarProFlattenDxf([panel({ qty: 2, itemNumber: 5, partNames: ['Right Side', 'Left Side'] })]);
    expect(dxf).toContain('Right Side {5}');
    expect(dxf).toContain('Left Side {5}');
  });

  it('qty=2 with no partNames falls back to partName for BOTH instances', () => {
    const dxf = renderViyarProFlattenDxf([panel({ qty: 2, partName: 'Shelf', itemNumber: 3 })]);
    const count = (dxf.match(/Shelf \{3\}/g) ?? []).length;
    expect(count).toBe(2);
  });

  it('the material block INSERTs the panel block exactly twice for a qty=2 row (not once)', () => {
    const dxf = renderViyarProFlattenDxf([panel({ qty: 2, partNames: ['Right Side', 'Left Side'] })]);
    const insertCount = (dxf.match(/100\nAcDbBlockReference\n\s*66\n\s*1\n\s*2\nGroup1#\d\n/g) ?? []).length;
    expect(insertCount).toBe(2);
  });

  it('the two instances are laid out at DIFFERENT (non-overlapping) positions', () => {
    const dxf = renderViyarProFlattenDxf([panel({ qty: 2, partNames: ['Right Side', 'Left Side'] })]);
    const insertRe = /\s2\nGroup1#(\d)\n\s*10\n([\d.-]+)\n\s*20\n([\d.-]+)\n/g;
    const positions: Array<{ inst: string; x: string; y: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = insertRe.exec(dxf))) positions.push({ inst: m[1]!, x: m[2]!, y: m[3]! });
    expect(positions.length).toBe(2);
    expect(positions[0]!.x === positions[1]!.x && positions[0]!.y === positions[1]!.y).toBe(false);
  });

  it('bore sub-blocks stay unique per physical instance (no duplicate BLOCK_RECORD names) when a qty=2 row has bores', () => {
    const b = bore('Top', 50, 40, 7, 12);
    const dxf = renderViyarProFlattenDxf([panel({ qty: 2, bores: [b], partNames: ['Right Side', 'Left Side'] })]);
    const blockRecordNames = [...dxf.matchAll(/BLOCK_RECORD\n\s*5\n[0-9A-F]+\n100\nAcDbSymbolTableRecord\n100\nAcDbBlockTableRecord\n\s*2\n([^\n]+)\n/g)]
      .map((mm) => mm[1]!);
    const dupes = blockRecordNames.filter((n, i) => blockRecordNames.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it('a qty=1 row is byte-for-byte unaffected (still "Group1#1", still ONE INSERT)', () => {
    const dxf = renderViyarProFlattenDxf([panel({ qty: 1 })]);
    expect(dxf).toContain('Group1#1');
    expect(dxf).not.toContain('Group1#2');
  });
});

describe('renderViyarProFlattenDxf — full pipeline: twin instances get their OWN name (live ViyarPro bug)', () => {
  const MAT: MaterialEntry[] = [
    { id: 'm-white' as any, name: 'White 18', defaultThickness: 18, color: '#ffffff' },
  ];
  const SPEC = (over: Partial<PanelSpec> = {}): PanelSpec => ({
    length: 700, width: 500, thickness: 18, materialId: 'm-white' as any, grain: 'length',
    edgeBands: { front: null, back: null, left: null, right: null },
    ...over,
  } as PanelSpec);
  const cmp = (id: string, partPath: string): ComponentInstance => ({
    id, partPath,
    position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true,
  } as ComponentInstance);
  const asm = (components: ComponentInstance[]): AssemblyDocument => ({
    id: 'a', name: 'a', units: 'mm', parameters: {}, components, constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {},
    colorOverrides: {},
  } as unknown as AssemblyDocument);

  it('two physically-distinct panels (Left Side / Right Side) that share a cut-list row each get their own ATTRIB name in the DXF, not a duplicate', () => {
    const assembly = asm([cmp('c1', 'p/left.zipt'), cmp('c2', 'p/right.zipt')]);
    const specs = new Map<string, PanelSpec | null>([
      ['p/left.zipt', SPEC()],
      ['p/right.zipt', SPEC()], // identical geometry/material -> same cut-list row
    ]);
    const partInfo = new Map([
      ['p/left.zipt', { name: 'Left Side' }],
      ['p/right.zipt', { name: 'Right Side' }],
    ]);
    const cutList = aggregateCutListRecursive(assembly, { get: () => undefined }, specs, MAT, partInfo);
    const manufacturingInputs = aggregatePanelManufacturing(cutList, { panels: [] }, new Map());

    const dxf = renderViyarProFlattenDxf(manufacturingInputs);

    expect(dxf).toContain('Left Side');
    expect(dxf).toContain('Right Side');
    // The literal bug: BOTH instances silently reusing the first component's name.
    expect((dxf.match(/Left Side \{/g) ?? []).length).toBe(1);
    expect((dxf.match(/Right Side \{/g) ?? []).length).toBe(1);
  });
});

describe('renderViyarProFlattenDxf — HEADER', () => {
  it('HEADER declares AC1021 / INSUNITS 4 / MEASUREMENT 1', () => {
    const dxf = renderViyarProFlattenDxf([panel()]);
    expect(dxf).toMatch(/\$ACADVER\n\s*1\nAC1021\n/);
    expect(dxf).toMatch(/\$INSUNITS\n\s*70\n\s*4\n/);
    expect(dxf).toMatch(/\$MEASUREMENT\n\s*70\n\s*1\n/);
  });

  it('$EXTMIN/$EXTMAX match the real computed layout bbox for a single panel at (0,0)', () => {
    const dxf = renderViyarProFlattenDxf([panel()]); // 400x300 panel, single item → grid places it at (0,0)
    expect(dxf).toMatch(/\$EXTMIN\n\s*10\n0\.0000\n\s*20\n0\.0000\n/);
    expect(dxf).toMatch(/\$EXTMAX\n\s*10\n400\.0000\n\s*20\n300\.0000\n/);
  });

  it('$EXTMIN/$EXTMAX are never the AutoCAD sentinel (±1e20)', () => {
    const dxf = renderViyarProFlattenDxf([panel()]);
    expect(dxf).not.toMatch(/1e\+?20/i);
    expect(dxf).not.toContain('99999999999999999999');
  });
});
