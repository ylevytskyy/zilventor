import { describe, it, expect } from 'vitest';
import { renderViyarProFlattenDxf } from '../renderViyarProFlattenDxf';
import type { PanelManufacturingInput } from '../renderPanelManufacturingDxf';
import type { BoreOp } from '@zilventor/shared';

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

  it('edge bore goes on ABF-DSIDE-<diameter>', () => {
    const b = bore('Front', 9, 100, 5, 32);
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    expect(dxf).toContain('ABF-DSIDE-5');
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
    // throughAll (not finite-depth) — stays on the flat-circle path (R-DSIDE only
    // redirects finite-depth edge bores; see the R-DSIDE describe block above).
    const edgeBore = bore('Front', 9, 100, 5, 'throughAll');
    const dxf = renderViyarProFlattenDxf([panel({ bores: [faceBore, edgeBore] })]);
    expect(dxf).toContain('Group1_bores1#1');
    expect(dxf).toContain('Group1_bores2#1');
  });
});

describe('renderViyarProFlattenDxf — R-DSIDE finite-depth edge bore 3D encoding (fixes "no depth" import warning)', () => {
  it('a finite-depth edge (ABF-DSIDE) bore is NOT a bare flat CIRCLE in the panel block — every CIRCLE on that layer carries a 210/220/230 extrusion', () => {
    const b = bore('Front', 9, 100, 5, 32);
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    // find every CIRCLE entity block and check each one whose layer is ABF-DSIDE-5 has an extrusion
    const circleBlocks = [...dxf.matchAll(/0\nCIRCLE\n[\s\S]{0,300}?(?=\n\s*0\n|$)/g)].map((m) => m[0]);
    const dsideCircles = circleBlocks.filter((c) => c.includes('\n  8\nABF-DSIDE-5\n'));
    expect(dsideCircles.length).toBeGreaterThan(0);
    for (const c of dsideCircles) expect(c).toMatch(/210\n/);
  });

  it('emits a CIRCLE on ABF-DSIDE-5 INSERTed via an ATTRIB "_ABF_sideDrill" sub-block', () => {
    const b = bore('Front', 9, 100, 5, 32);
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    expect(dxf).toContain('_ABF_sideDrill');
  });

  it('emits a closed 3D-polyline depth rectangle on ABF-DSIDE-5 INSERTed via an ATTRIB "_ABF_sideDrillDepth" sub-block', () => {
    const b = bore('Front', 9, 100, 5, 32);
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    expect(dxf).toContain('_ABF_sideDrillDepth');
    expect(dxf).toContain('AcDb3dPolyline');
    expect(dxf).toMatch(/\s70\n\s*9\n/); // closed 3D flag
  });

  it('the depth rectangle encodes the bore\'s ACTUAL depth (32mm) and diameter (5mm, r=2.5) as vertex coordinates — Front axis is (0,-1,0), so depth is negative', () => {
    const b = bore('Front', 9, 100, 5, 32);
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    expect(dxf).toContain('-32.0000'); // depth-axis extent
    expect(dxf).toContain('2.5000');   // +radius (diameter-axis extent)
    expect(dxf).toContain('-2.5000');  // -radius
  });

  it('a DIFFERENT depth (25mm) on the same diameter produces a DIFFERENT depth-axis extent — depth is read from BoreOp.depth, not a fixed constant', () => {
    const b = bore('Front', 9, 100, 5, 25);
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    expect(dxf).toContain('-25.0000');
    expect(dxf).not.toContain('-32.0000');
  });

  it('Left/Right edge bores drill along X — axis (±1,0,0), not Y', () => {
    const bLeft = bore('Left', 9, 50, 5, 20);
    const dxfLeft = renderViyarProFlattenDxf([panel({ bores: [bLeft] })]);
    expect(dxfLeft).toMatch(/210\n1\.0000\n220\n0\.0000\n230\n0\.0000\n/);

    const bRight = bore('Right', 9, 50, 5, 20);
    const dxfRight = renderViyarProFlattenDxf([panel({ bores: [bRight] })]);
    expect(dxfRight).toMatch(/210\n-1\.0000\n220\n0\.0000\n230\n0\.0000\n/);
  });

  it('two edge bores on the same panel get their OWN distinct circle/rect sub-block pairs (uniqueness)', () => {
    const b1 = bore('Front', 9, 100, 5, 32);
    const b2 = bore('Front', 9, 200, 5, 32);
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b1, b2] })]);
    expect(dxf).toContain('Group1_dside1#1');
    expect(dxf).toContain('Group1_dside2#1');
    expect(dxf).toContain('Group1_dsideDepth1#1');
    expect(dxf).toContain('Group1_dsideDepth2#1');
  });

  it('a throughAll edge bore is UNCHANGED — no _ABF_sideDrill, still the flat native-layer CIRCLE (existing R-THROUGHBORE behavior)', () => {
    const b = bore('Front', 9, 100, 5, 'throughAll');
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    expect(dxf).toContain('BORES-EDGE-Front-5MM');
    expect(dxf).not.toContain('_ABF_sideDrill');
  });

  it('a face (Top/Bottom) bore is UNCHANGED — no _ABF_sideDrill, still routed through the existing _ABF_bore flat-circle group', () => {
    const b = bore('Top', 50, 40, 7, 12);
    const dxf = renderViyarProFlattenDxf([panel({ bores: [b] })]);
    expect(dxf).toContain('_ABF_bore');
    expect(dxf).not.toContain('_ABF_sideDrill');
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
