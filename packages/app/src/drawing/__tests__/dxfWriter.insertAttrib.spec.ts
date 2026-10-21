// packages/app/src/drawing/__tests__/dxfWriter.insertAttrib.spec.ts
import { describe, it, expect } from 'vitest';
import { createDxfDocument } from '../dxfWriter';

describe('dxfWriter — INSERT/ATTRIB (DXF-INSERT)', () => {
  it('DXF-INSERT-1: insert() with attribs emits INSERT -> ATTRIB -> SEQEND in order, with 66=1 flag', () => {
    const doc = createDxfDocument();
    doc.insert('AUTO_THICKNESS_18', 10, 20, [{ tag: 'Skp_ComponentInstanceName', value: 'ABF_Flatten' }]);
    const out = doc.toString();

    const insertIdx = out.indexOf('\nINSERT\n');
    const attribIdx = out.indexOf('\nATTRIB\n');
    const seqendIdx = out.indexOf('\nSEQEND\n');
    expect(insertIdx).toBeGreaterThan(-1);
    expect(attribIdx).toBeGreaterThan(insertIdx);
    expect(seqendIdx).toBeGreaterThan(attribIdx);

    // INSERT entity group codes, in order: 5,330,100,8,347,100,66,2,10,20,30
    const insertBlock = out.slice(insertIdx, attribIdx);
    expect(insertBlock).toMatch(
      /INSERT\n\s*5\n[0-9A-F]+\n330\n[0-9A-F]+\n100\nAcDbEntity\n\s*8\n0\n347\n[0-9A-F]+\n100\nAcDbBlockReference\n\s*66\n\s*1\n\s*2\nAUTO_THICKNESS_18\n\s*10\n10\.0000\n\s*20\n20\.0000\n\s*30\n0\.0\n/,
    );

    // ATTRIB entity group codes, in order: 5,330(=insert handle),100,8,100,10,20,30,40,1,100,2,70,280
    const attribBlock = out.slice(attribIdx, seqendIdx);
    expect(attribBlock).toMatch(
      /ATTRIB\n\s*5\n[0-9A-F]+\n330\n[0-9A-F]+\n100\nAcDbEntity\n\s*8\n0\n100\nAcDbText\n\s*10\n0\.0\n\s*20\n0\.0\n\s*30\n0\.0\n\s*40\n1\.0\n\s*1\nABF_Flatten\n100\nAcDbAttribute\n\s*2\nSkp_ComponentInstanceName\n\s*70\n\s*1\n280\n\s*0\n/,
    );

    // SEQEND owner (330) must equal the INSERT's own handle (group 5 of INSERT)
    const insertHandleMatch = /INSERT\n\s*5\n([0-9A-F]+)/.exec(insertBlock);
    const seqendOwnerMatch = /SEQEND\n\s*5\n[0-9A-F]+\n330\n([0-9A-F]+)/.exec(out.slice(seqendIdx));
    expect(insertHandleMatch).not.toBeNull();
    expect(seqendOwnerMatch).not.toBeNull();
    expect(seqendOwnerMatch![1]).toBe(insertHandleMatch![1]);

    // ATTRIB's owner (330) must ALSO equal the INSERT's handle
    const attribOwnerMatch = /ATTRIB\n\s*5\n[0-9A-F]+\n330\n([0-9A-F]+)/.exec(attribBlock);
    expect(attribOwnerMatch![1]).toBe(insertHandleMatch![1]);
  });

  it('DXF-INSERT-2: insert() without attribs emits a bare INSERT — no 66 flag, no SEQEND', () => {
    const doc = createDxfDocument();
    doc.insert('SREE_PEARLS_2_THICKNESS_18', 1, 2);
    const out = doc.toString();
    expect(out).toContain('INSERT');
    expect(out).not.toContain('ATTRIB');
    expect(out).not.toMatch(/\nSEQEND\n/);
    expect(out).not.toMatch(/\s66\n\s*1\n/);
  });

  it('DXF-INSERT-3: multiple attribs emit one ATTRIB per entry, single SEQEND', () => {
    const doc = createDxfDocument();
    doc.insert('BLK', 0, 0, [
      { tag: 'TAG_A', value: 'valA' },
      { tag: 'TAG_B', value: 'valB' },
    ]);
    const out = doc.toString();
    const attribCount = (out.match(/\nATTRIB\n/g) ?? []).length;
    const seqendCount = (out.match(/\nSEQEND\n/g) ?? []).length;
    expect(attribCount).toBe(2);
    expect(seqendCount).toBe(1);
    expect(out).toContain('TAG_A');
    expect(out).toContain('valA');
    expect(out).toContain('TAG_B');
    expect(out).toContain('valB');
  });

  it('DXF-INSERT-4: Cyrillic ATTRIB value passes through untouched', () => {
    const doc = createDxfDocument();
    doc.insert('Group39#4', 0, 0, [{ tag: 'Skp_GroupInstanceName', value: '__4. Дверка' }]);
    const out = doc.toString();
    expect(out).toContain('__4. Дверка');
  });
});

describe('dxfWriter — named BLOCK (DXF-NAMEDBLOCK)', () => {
  it('DXF-NAMEDBLOCK-1: namedBlock() emits BLOCK/ENDBLK with flag 70=0 (named, not anonymous)', () => {
    const doc = createDxfDocument();
    doc.namedBlock('AUTO_THICKNESS_18', () => {
      doc.insert('Group39#4', -316, -2, [{ tag: 'Skp_GroupInstanceName', value: 'Дверка' }]);
    });
    const out = doc.toString();

    // Anchor on the block name itself (group 2/3) to skip past the always-present
    // *Model_Space/*Paper_Space BLOCK definitions that precede blockDefs.
    // BLOCK group codes, in order: 5,330(=block_record handle),100,8,100,2,70,10,20,30,3,1
    const blockMatch = /0\nBLOCK\n\s*5\n([0-9A-F]+)\n330\n([0-9A-F]+)\n100\nAcDbEntity\n\s*8\n0\n100\nAcDbBlockBegin\n\s*2\nAUTO_THICKNESS_18\n\s*70\n\s*0\n\s*10\n0\.0\n\s*20\n0\.0\n\s*30\n0\.0\n\s*3\nAUTO_THICKNESS_18\n\s*1\n\n/.exec(out);
    expect(blockMatch, 'named BLOCK group codes must match').not.toBeNull();
    const blockOwner = blockMatch![2];

    // Find the ENDBLK whose owner (330) matches this BLOCK's owner — the shared block_record handle.
    const endblkRe = /0\nENDBLK\n\s*5\n([0-9A-F]+)\n330\n([0-9A-F]+)\n100\nAcDbEntity\n\s*8\n0\n100\nAcDbBlockEnd\n/g;
    let matching: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    while ((m = endblkRe.exec(out)) !== null) {
      if (m[2] === blockOwner) { matching = m; break; }
    }
    expect(matching, 'ENDBLK with owner matching the named BLOCK').not.toBeNull();
  });

  it('DXF-NAMEDBLOCK-2: named block gets its own BLOCK_RECORD table entry in TABLES', () => {
    const doc = createDxfDocument();
    doc.namedBlock('MY_PANEL', () => {});
    const out = doc.toString();
    expect(out).toMatch(
      /0\nBLOCK_RECORD\n\s*5\n[0-9A-F]+\n100\nAcDbSymbolTableRecord\n100\nAcDbBlockTableRecord\n\s*2\nMY_PANEL\n/,
    );
    // Must appear inside TABLES, before BLOCKS section
    const tablesPos = out.indexOf('TABLES');
    const blocksPos = out.indexOf('BLOCKS');
    const recordPos = out.indexOf('MY_PANEL');
    expect(recordPos).toBeGreaterThan(tablesPos);
    expect(recordPos).toBeLessThan(blocksPos);
  });

  it('DXF-NAMEDBLOCK-3: two namedBlock() calls each get distinct BLOCK_RECORD entries, count bumped', () => {
    const doc = createDxfDocument();
    doc.namedBlock('PANEL_A', () => {});
    doc.namedBlock('PANEL_B', () => {});
    const out = doc.toString();
    expect(out).toContain('PANEL_A');
    expect(out).toContain('PANEL_B');
    // BLOCK_RECORD TABLE count (group 70 on the TABLE row) must be 2 (Model/Paper) + 2 named = 4
    const tableHeaderMatch = /2\nBLOCK_RECORD\n\s*5\n[0-9A-F]+\n\s*70\n\s*(\d+)/.exec(out);
    expect(tableHeaderMatch).not.toBeNull();
    expect(tableHeaderMatch![1]).toBe('4');
  });

  it('DXF-NAMEDBLOCK-4 (regression): unused namedBlock() leaves BLOCK_RECORD table at count 2', () => {
    const out = createDxfDocument().toString();
    const tableHeaderMatch = /2\nBLOCK_RECORD\n\s*5\n[0-9A-F]+\n\s*70\n\s*(\d+)/.exec(out);
    expect(tableHeaderMatch![1]).toBe('2');
  });
});

describe('dxfWriter — nested INSERT inside namedBlock (DXF-NESTED)', () => {
  it('DXF-NESTED-1: insert() called inside namedBlock() build callback lands in BLOCKS, not top-level ENTITIES', () => {
    const doc = createDxfDocument();
    doc.namedBlock('MATERIAL_BLOCK', () => {
      doc.insert('PANEL_BLOCK', 5, 6, [{ tag: 'Skp_GroupInstanceName', value: 'Panel' }]);
    });
    doc.line('VISIBLE', 0, 0, 1, 1); // a top-level entity, for contrast
    const out = doc.toString();

    const blocksPos = out.indexOf('BLOCKS');
    const entitiesPos = out.search(/\n\s*0\nSECTION\n\s*2\nENTITIES\n/);
    const insertPos = out.indexOf('\nINSERT\n');
    const topLevelLinePos = out.lastIndexOf('\nLINE\n');

    expect(insertPos).toBeGreaterThan(blocksPos);
    expect(insertPos).toBeLessThan(entitiesPos);
    expect(entitiesPos).toBeGreaterThan(blocksPos);
    expect(topLevelLinePos).toBeGreaterThan(entitiesPos);
  });

  it('DXF-NESTED-2: nested insert() owner (330) is the enclosing namedBlock\'s block_record handle', () => {
    const doc = createDxfDocument();
    doc.namedBlock('OUTER', () => {
      doc.insert('INNER', 0, 0);
    });
    const out = doc.toString();

    const blockRecordMatch = /0\nBLOCK_RECORD\n\s*5\n([0-9A-F]+)\n100\nAcDbSymbolTableRecord\n100\nAcDbBlockTableRecord\n\s*2\nOUTER\n/.exec(out);
    expect(blockRecordMatch).not.toBeNull();
    const blockRecordHandle = blockRecordMatch![1];

    const insertIdx = out.indexOf('\nINSERT\n');
    const insertOwnerMatch = /INSERT\n\s*5\n[0-9A-F]+\n330\n([0-9A-F]+)/.exec(out.slice(insertIdx));
    expect(insertOwnerMatch![1]).toBe(blockRecordHandle);
  });
});

describe('dxfWriter — HEADER opt-in variables (DXF-HDR)', () => {
  it('DXF-HDR-1: without opts, header is unchanged — AC1015, no INSUNITS/MEASUREMENT/EXTMIN/EXTMAX', () => {
    const out = createDxfDocument().toString();
    expect(out).toMatch(/\$ACADVER\n\s*1\nAC1015\n/);
    expect(out).not.toContain('$INSUNITS');
    expect(out).not.toContain('$MEASUREMENT');
    expect(out).not.toContain('$EXTMIN');
    expect(out).not.toContain('$EXTMAX');
  });

  it('DXF-HDR-2: opts.acadVersion selects AC1021', () => {
    const out = createDxfDocument([], { acadVersion: 'AC1021' }).toString();
    expect(out).toMatch(/\$ACADVER\n\s*1\nAC1021\n/);
  });

  it('DXF-HDR-3: opts.insunits/measurement/bbox emit real (non-sentinel) HEADER variables', () => {
    const out = createDxfDocument([], {
      insunits: 4,
      measurement: 1,
      bbox: { minX: -10, minY: -20, maxX: 100, maxY: 200 },
    }).toString();
    expect(out).toMatch(/\$INSUNITS\n\s*70\n\s*4\n/);
    expect(out).toMatch(/\$MEASUREMENT\n\s*70\n\s*1\n/);
    expect(out).toMatch(/\$EXTMIN\n\s*10\n-10\.0000\n\s*20\n-20\.0000\n\s*30\n0\.0\n/);
    expect(out).toMatch(/\$EXTMAX\n\s*10\n100\.0000\n\s*20\n200\.0000\n\s*30\n0\.0\n/);
  });
});

describe('dxfWriter — insert() z/layer opts (DXF-INSERT-5)', () => {
  it('opts.z overrides the INSERT/ATTRIB group-30 coordinate; opts.layer overrides group-8 (SEQEND stays layer 0)', () => {
    const doc = createDxfDocument();
    doc.insert('Group1_cutline#1', 0, 0, [{ tag: 'Skp_GroupInstanceName', value: '_ABF_cuttingLines' }], { z: 18, layer: 'ABF_cuttingLines' });
    const out = doc.toString();

    const insertIdx = out.indexOf('\nINSERT\n');
    const attribIdx = out.indexOf('\nATTRIB\n');
    const seqendIdx = out.indexOf('\nSEQEND\n');
    const insertBlock = out.slice(insertIdx, attribIdx);
    const attribBlock = out.slice(attribIdx, seqendIdx);
    const seqendBlock = out.slice(seqendIdx);

    expect(insertBlock).toMatch(/\s8\nABF_cuttingLines\n/);
    expect(insertBlock).toMatch(/\s30\n18\.0000\n/);
    expect(attribBlock).toMatch(/\s8\nABF_cuttingLines\n/);
    expect(attribBlock).toMatch(/\s30\n18\.0000\n/);
    expect(seqendBlock).toMatch(/SEQEND\n\s*5\n[0-9A-F]+\n330\n[0-9A-F]+\n100\nAcDbEntity\n\s*8\n0\n/);
  });

  it('omitting opts keeps the exact prior byte output (layer "0", z "0.0" literal)', () => {
    const doc = createDxfDocument();
    doc.insert('AUTO_THICKNESS_18', 10, 20, [{ tag: 'Skp_ComponentInstanceName', value: 'ABF_Flatten' }]);
    const out = doc.toString();
    expect(out).toMatch(/INSERT\n\s*5\n[0-9A-F]+\n330\n[0-9A-F]+\n100\nAcDbEntity\n\s*8\n0\n347\n[0-9A-F]+\n100\nAcDbBlockReference\n\s*66\n\s*1\n\s*2\nAUTO_THICKNESS_18\n\s*10\n10\.0000\n\s*20\n20\.0000\n\s*30\n0\.0\n/);
  });
});

describe('dxfWriter — legacy 3D polyline (DXF-POLY3D)', () => {
  it('polyline3d emits a closed AcDb3dPolyline: flags 70=9, VERTEX flags=32, first vertex repeated at the end, SEQEND', () => {
    const doc = createDxfDocument();
    doc.polyline3d('ABF_cuttingLines', [[0, 0], [720, 0], [720, 560], [0, 560]], true);
    const out = doc.toString();

    expect(out).toMatch(/POLYLINE\n\s*5\n[0-9A-F]+\n330\n[0-9A-F]+\n100\nAcDbEntity\n\s*8\nABF_cuttingLines\n100\nAcDb3dPolyline\n\s*66\n\s*1\n\s*10\n0\.0\n\s*20\n0\.0\n\s*30\n0\.0\n\s*70\n\s*9\n/);

    const vertexBlocks = out.match(/AcDb3dPolylineVertex\n\s*10\n[-\d.]+\n\s*20\n[-\d.]+\n\s*30\n0\.0\n\s*70\n\s*32\n/g) ?? [];
    // 4 corners + 1 repeated first vertex = 5
    expect(vertexBlocks.length).toBe(5);
    const firstCoords = vertexBlocks[0];
    const lastCoords = vertexBlocks[4];
    expect(lastCoords).toBe(firstCoords);

    expect(out).toMatch(/SEQEND\n\s*5\n[0-9A-F]+\n330\n[0-9A-F]+\n100\nAcDbEntity\n\s*8\nABF_cuttingLines\n/);
  });

  it('open (non-closed) polyline3d has flags 70=8 and does NOT repeat the first vertex', () => {
    const doc = createDxfDocument();
    doc.polyline3d('SOMELAYER', [[0, 0], [10, 0], [10, 10]], false);
    const out = doc.toString();
    expect(out).toMatch(/\s70\n\s*8\n/);
    const vertexCount = (out.match(/AcDb3dPolylineVertex/g) ?? []).length;
    expect(vertexCount).toBe(3);
  });
});

describe('dxfWriter — polyface-mesh solid (DXF-PFACE)', () => {
  it('polyfaceMesh emits POLYLINE(70=64,71=4,72=2) + 4 position VERTEX(flags=192) + 2 face-record VERTEX(flags=192, coords 0,0,0, indices -1/2/3 and -2/1/4) + SEQEND', () => {
    const doc = createDxfDocument();
    doc.polyfaceMesh('Untagged00', [[0, 560, 18], [720, 560, 0], [0, 560, 0], [720, 560, 18]]);
    const out = doc.toString();

    expect(out).toMatch(/POLYLINE\n\s*5\n[0-9A-F]+\n330\n[0-9A-F]+\n100\nAcDbEntity\n\s*8\nUntagged00\n100\nAcDbPolyFaceMesh\n\s*66\n\s*1\n\s*10\n0\.0\n\s*20\n0\.0\n\s*30\n0\.0\n\s*70\n\s*64\n\s*71\n\s*4\n\s*72\n\s*2\n/);

    const vertexFlagCount = (out.match(/AcDbPolyFaceMeshVertex\n[\s\S]{0,80}?70\n\s*192\n/g) ?? []).length;
    expect(vertexFlagCount).toBe(6); // 4 position + 2 face-record, ALL flag 192 (golden reference, not the AutoCAD-doc "128 alone" value)

    expect(out).toMatch(/71\n\s*-1\n\s*72\n\s*2\n\s*73\n\s*3\n/);
    expect(out).toMatch(/71\n\s*-2\n\s*72\n\s*1\n\s*73\n\s*4\n/);

    // face-record vertices carry coords 0,0,0 (not real geometry)
    const faceRecordSection = out.slice(out.indexOf('71\n     -1'));
    expect(faceRecordSection).toMatch(/10\n0\.0\n\s*20\n0\.0\n\s*30\n0\.0\n/);

    expect(out).toMatch(/SEQEND\n\s*5\n[0-9A-F]+\n330\n[0-9A-F]+\n100\nAcDbEntity\n\s*8\nUntagged00\n/);
  });
});

describe('dxfWriter — 3D LINE (DXF-LINE3D)', () => {
  it('line3d emits a LINE with distinct Z on each endpoint', () => {
    const doc = createDxfDocument();
    doc.line3d('ABF_cuttingLines', [0, 0, 0], [0, 0, 18]);
    const out = doc.toString();
    expect(out).toMatch(/LINE\n\s*5\n[0-9A-F]+\n330\n[0-9A-F]+\n100\nAcDbEntity\n\s*8\nABF_cuttingLines\n100\nAcDbLine\n\s*10\n0\.0000\n\s*20\n0\.0000\n\s*30\n0\.0000\n\s*11\n0\.0000\n\s*21\n0\.0000\n\s*31\n18\.0000\n/);
  });
});

describe('dxfWriter — sketchupCompat opt-in richness (DXF-SKPCOMPAT)', () => {
  it('omitted (default): DIMSTYLE has 1 entry, STYLE has 1 entry, no OBJECTS richness — byte-identical to prior behavior', () => {
    const out = createDxfDocument().toString();
    const dimstyleHeader = /2\nDIMSTYLE\n\s*5\n[0-9A-F]+\n\s*70\n\s*(\d+)/.exec(out);
    const styleHeader = /2\nSTYLE\n\s*5\n[0-9A-F]+\n\s*70\n\s*(\d+)/.exec(out);
    expect(dimstyleHeader![1]).toBe('1');
    expect(styleHeader![1]).toBe('1');
    expect(out).not.toContain('DimStyle1');
    expect(out).not.toContain('Dimensions');
    expect(out).not.toContain('Tahoma');
    expect(out).not.toContain('ACAD_SECTIONVIEWSTYLE');
    expect(out).not.toContain('ACDB_RECOMPOSE_DATA');
    expect(out).not.toContain('AcDbVariableDictionary');
    expect(out).not.toContain('$DIMALTF');
  });

  it('sketchupCompat:true adds DimStyle1 + Dimensions DIMSTYLE entries (3 total), a Tahoma STYLE entry (2 total), OBJECTS root-dictionary entries, and $DIMALTF=25.4 in HEADER', () => {
    const out = createDxfDocument([], { sketchupCompat: true }).toString();
    const dimstyleHeader = /2\nDIMSTYLE\n\s*5\n[0-9A-F]+\n\s*70\n\s*(\d+)/.exec(out);
    const styleHeader = /2\nSTYLE\n\s*5\n[0-9A-F]+\n\s*70\n\s*(\d+)/.exec(out);
    expect(dimstyleHeader![1]).toBe('3');
    expect(styleHeader![1]).toBe('2');
    expect(out).toContain('DimStyle1');
    expect(out).toContain('Dimensions');
    expect(out).toContain('Tahoma');
    expect(out).toContain('ACAD_SECTIONVIEWSTYLE');
    expect(out).toContain('ACDB_RECOMPOSE_DATA');
    expect(out).toContain('AcDbVariableDictionary');

    // $DIMALTF must live in the HEADER section, before TABLES
    expect(out).toMatch(/\$DIMALTF\n\s*40\n25\.4\n/);
    const headerPos = out.indexOf('\n  2\nHEADER\n');
    const dimaltfPos = out.indexOf('$DIMALTF');
    const tablesPos = out.indexOf('\n  2\nTABLES\n');
    expect(dimaltfPos).toBeGreaterThan(headerPos);
    expect(dimaltfPos).toBeLessThan(tablesPos);

    // the 3 dictionary entries must live under the OBJECTS section's root DICTIONARY,
    // referenced via group 350 handles, before ENDSEC
    const objectsPos = out.indexOf('\n  2\nOBJECTS\n');
    const sectionViewPos = out.indexOf('ACAD_SECTIONVIEWSTYLE');
    expect(sectionViewPos).toBeGreaterThan(objectsPos);
  });
});
