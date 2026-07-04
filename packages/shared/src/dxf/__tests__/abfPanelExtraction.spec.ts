import { describe, it, expect } from 'vitest';
import { parseMaterialGroupToken, extractAbfPanels } from '../abfPanelExtraction';
import { face2DFrame } from '../../bore';
import type { ParsedDxf, DxfEntity } from '../types';

type Insert = Extract<DxfEntity, { type: 'INSERT' }>;

function insert(name: string, opts: Partial<Insert> = {}): Insert {
  return {
    type: 'INSERT', layer: '0', name, x: 0, y: 0, xscale: 1, yscale: 1, rotation: 0,
    columns: 1, rows: 1, colSpacing: 0, rowSpacing: 0,
    ...opts,
  };
}

function emptyDoc(): ParsedDxf {
  return { entities: [], blocks: {}, header: {}, layers: {}, blockBasePoints: {} };
}

function line(x1: number, y1: number, x2: number, y2: number, layer = 'ABF_cuttingLines'): DxfEntity {
  return { type: 'LINE', layer, x1, y1, x2, y2 };
}

function circle(
  cx: number, cy: number, r: number, layer: string,
  extrusion?: { x: number; y: number; z: number },
): DxfEntity {
  return { type: 'CIRCLE', layer, cx, cy, r, ...(extrusion ? { extrusion } : {}) };
}

/** 300x200mm rectangular outline authored at local (100,50)..(400,250), same as the outline
 *  suite above — reused so bore tests exercise the bbox-min-corner shift too. */
const OUTLINE_300X200 = [
  line(100, 50, 400, 50), line(400, 50, 400, 250), line(400, 250, 100, 250), line(100, 250, 100, 50),
];

/** A material group wrapping one panel-root block, ready for outline entities to be appended. */
function panelDoc(panelEntities: DxfEntity[]): ParsedDxf {
  const doc = emptyDoc();
  doc.entities = [insert('AUTO_THICKNESS_18')];
  doc.blocks['AUTO_THICKNESS_18'] = [
    insert('Group1#1', { attribs: [{ tag: 'Skp_GroupInstanceName', value: '__4. Дверка' }] }),
  ];
  doc.blocks['Group1#1'] = panelEntities;
  return doc;
}

describe('parseMaterialGroupToken', () => {
  it('parses a simple <MATERIAL>_THICKNESS_<mm> token', () => {
    expect(parseMaterialGroupToken('AUTO_THICKNESS_18')).toEqual({
      token: 'AUTO_THICKNESS_18', material: 'AUTO', thicknessMm: 18,
    });
  });

  it('keeps underscores within the material name (greedy up to the last _THICKNESS_)', () => {
    expect(parseMaterialGroupToken('SREE_PEARLS_2_THICKNESS_18')).toEqual({
      token: 'SREE_PEARLS_2_THICKNESS_18', material: 'SREE_PEARLS_2', thicknessMm: 18,
    });
  });

  it('returns null for a token with no _THICKNESS_ marker', () => {
    expect(parseMaterialGroupToken('Group1#1')).toBeNull();
  });
});

describe('extractAbfPanels — panel-root detection', () => {
  it('detects a panel-root INSERT nested inside a material-group block', () => {
    const doc = emptyDoc();
    doc.entities = [insert('AUTO_THICKNESS_18')];
    doc.blocks['AUTO_THICKNESS_18'] = [
      insert('Group1#1', { attribs: [{ tag: 'Skp_GroupInstanceName', value: '__4. Дверка' }] }),
    ];
    doc.blocks['Group1#1'] = [];
    const panels = extractAbfPanels(doc);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.name).toBe('__4. Дверка');
    expect(panels[0]!.materialGroup).toEqual({ token: 'AUTO_THICKNESS_18', material: 'AUTO', thicknessMm: 18 });
  });

  it('ignores non-panel-root INSERTs whose attrib value is an internal _ABF_ marker', () => {
    const doc = emptyDoc();
    doc.entities = [insert('AUTO_THICKNESS_18')];
    doc.blocks['AUTO_THICKNESS_18'] = [
      insert('Group1#1', { attribs: [{ tag: 'Skp_GroupInstanceName', value: '__4. Дверка' }] }),
    ];
    doc.blocks['Group1#1'] = [
      insert('HingeSymbol', { attribs: [{ tag: 'Skp_GroupInstanceName', value: '_ABF_hingeCup' }] }),
    ];
    doc.blocks['HingeSymbol'] = [];
    const panels = extractAbfPanels(doc);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.name).toBe('__4. Дверка');
  });

  it('skips a panel root whose material-group ancestor cannot be parsed (no context, documented gap)', () => {
    const doc = emptyDoc();
    doc.entities = [
      insert('Group1#1', { attribs: [{ tag: 'Skp_GroupInstanceName', value: '__4. Дверка' }] }),
    ];
    doc.blocks['Group1#1'] = [];
    expect(extractAbfPanels(doc)).toHaveLength(0);
  });
});

describe('extractAbfPanels — outline reconstruction', () => {
  it('reconstructs length/width from ABF_cuttingLines LINE segments and flags a true rectangle', () => {
    // Authored at a non-zero local origin (100,50)..(400,250) — proves the bbox-min-corner shift.
    const doc = panelDoc([
      line(100, 50, 400, 50),
      line(400, 50, 400, 250),
      line(400, 250, 100, 250),
      line(100, 250, 100, 50),
    ]);
    const [panel] = extractAbfPanels(doc);
    expect(panel!.length).toBeCloseTo(300, 9);
    expect(panel!.width).toBeCloseTo(200, 9);
    expect(panel!.rectangular).toBe(true);
    expect(panel!.outline).toEqual([
      { x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 200 },
    ]);
  });

  it('ignores degenerate (zero-length) segments when checking rectangularity', () => {
    const doc = panelDoc([
      line(100, 50, 400, 50),
      line(400, 50, 400, 250),
      line(400, 250, 100, 250),
      line(100, 250, 100, 50),
      line(250, 150, 250, 150), // vertical wall-trace projected to a point (interior, non-corner)
    ]);
    const [panel] = extractAbfPanels(doc);
    expect(panel!.rectangular).toBe(true);
  });

  it('flags rectangular:false when a non-corner point exists on the outline layer', () => {
    const doc = panelDoc([
      line(100, 50, 400, 50),
      line(400, 50, 400, 250),
      line(400, 250, 250, 150), // notch: introduces a genuine interior vertex
      line(250, 150, 100, 250),
      line(100, 250, 100, 50),
    ]);
    const [panel] = extractAbfPanels(doc);
    expect(panel!.rectangular).toBe(false);
    // v1 still reports the bbox L×W even for a flagged non-rectangular outline.
    expect(panel!.length).toBeCloseTo(300, 9);
    expect(panel!.width).toBeCloseTo(200, 9);
  });

  it('ignores LINE entities on layers other than ABF_cuttingLines when computing the outline', () => {
    const doc = panelDoc([
      line(100, 50, 400, 50),
      line(400, 50, 400, 250),
      line(400, 250, 100, 250),
      line(100, 250, 100, 50),
      line(0, 0, 9999, 9999, 'Untagged00'), // decoy on a different layer — must not blow up the bbox
    ]);
    const [panel] = extractAbfPanels(doc);
    expect(panel!.length).toBeCloseTo(300, 9);
    expect(panel!.width).toBeCloseTo(200, 9);
  });
});

describe('extractAbfPanels — bore circle classification', () => {
  it('classifies a face-oriented (0,0,-1) 35mm hinge-cup circle as a confident BoreOp on the Bottom face', () => {
    // Raw local (-119.5,72.5); OCS mirror for ext (0,0,-1) negates X -> (119.5,72.5);
    // bbox-local (min corner 100,50) -> (19.5, 22.5) — a 22.5mm inset, echoing the real sample.
    const doc = panelDoc([
      ...OUTLINE_300X200,
      circle(-119.5, 72.5, 17.5, 'DEPTH13-ARTICLE96053', { x: 0, y: 0, z: -1 }),
    ]);
    const [panel] = extractAbfPanels(doc);
    expect(panel!.circles).toHaveLength(1);
    const c = panel!.circles[0]!;
    if (c.kind !== 'bore') throw new Error('expected a bore');
    expect(c.diameter).toBeCloseTo(35, 9);
    expect(c.depth).toBeCloseTo(13, 9);
    expect(c.sku).toBe('96053');
    expect(c.faceRole).toBe('Bottom');
    expect(c.role).toBe('hingeCup');
    expect(c.connectorKind).toBe('hinge');
    expect(c.bestEffort).toBe(false);
    expect(c.u).toBeCloseTo(19.5, 9);
    expect(c.v).toBeCloseTo(200 - 22.5, 9);
  });

  it('classifies a face-oriented (0,0,+1) circle as the other broad face (Top)', () => {
    const doc = panelDoc([
      ...OUTLINE_300X200,
      circle(119.5, 72.5, 17.5, 'DEPTH13-ARTICLE96053', { x: 0, y: 0, z: 1 }),
    ]);
    const [panel] = extractAbfPanels(doc);
    const c = panel!.circles[0]!;
    if (c.kind !== 'bore') throw new Error('expected a bore');
    expect(c.faceRole).toBe('Top');
    expect(c.u).toBeCloseTo(19.5, 9);
    expect(c.v).toBeCloseTo(22.5, 9); // Top: no width-flip
  });

  it('imports an edge-oriented (in-plane extrusion) circle as reference-only, never a BoreOp — even on a DEPTH-family layer', () => {
    const doc = panelDoc([
      ...OUTLINE_300X200,
      circle(150, 100, 4, 'DEPTH12-ARTICLE38877', { x: 1, y: 0, z: 0 }),
    ]);
    const [panel] = extractAbfPanels(doc);
    const c = panel!.circles[0]!;
    expect(c.kind).toBe('reference');
    if (c.kind !== 'reference') throw new Error('expected reference-only');
    expect(c.diameter).toBeCloseTo(8, 9);
    expect(c.x).toBeCloseTo(50, 9); // 150 - bbox minX(100)
    expect(c.y).toBeCloseTo(50, 9); // 100 - bbox minY(50)
  });

  it('falls back to reference-only for a face-oriented circle on a layer with no DEPTH<mm> token (e.g. ABF-DSIDE-8)', () => {
    const doc = panelDoc([
      ...OUTLINE_300X200,
      circle(150, 100, 4, 'ABF-DSIDE-8'), // default extrusion -> face-oriented, but no depth signal
    ]);
    const [panel] = extractAbfPanels(doc);
    expect(panel!.circles[0]!.kind).toBe('reference');
  });

  it('applies a best-effort classification (flagged, never a new enum literal) for a face-oriented circle whose diameter matches no confident anchor', () => {
    const doc = panelDoc([...OUTLINE_300X200, circle(150, 100, 1, 'DEPTH3.0')]); // 2mm dia, no sku
    const [panel] = extractAbfPanels(doc);
    const c = panel!.circles[0]!;
    if (c.kind !== 'bore') throw new Error('expected a bore (face-oriented + parseable DEPTH layer)');
    expect(c.depth).toBeCloseTo(3, 9);
    expect(c.sku).toBeUndefined();
    expect(c.bestEffort).toBe(true);
  });

  it('resolves a bore nested two INSERT levels inside the panel block via composed affine transforms', () => {
    const doc = panelDoc([
      ...OUTLINE_300X200,
      insert('HingeSymbol', { x: 100, y: 50, rotation: 90 }),
    ]);
    doc.blocks['HingeSymbol'] = [circle(10, 0, 17.5, 'DEPTH13-ARTICLE96053')]; // default ext (face, Top)
    const [panel] = extractAbfPanels(doc);
    const c = panel!.circles[0]!;
    if (c.kind !== 'bore') throw new Error('expected a bore');
    // world/panel-local = insertion(100,50) + rotate90(10,0)=(0,10) = (100,60); bbox-local (0,10).
    expect(c.u).toBeCloseTo(0, 9);
    expect(c.v).toBeCloseTo(10, 9);
    expect(c.faceRole).toBe('Top');
  });

  it('u/v round-trips through face2DFrame back to the panel-centered world position (regression lock: u/v are CORNER-based, not centered)', () => {
    const doc = panelDoc([
      ...OUTLINE_300X200,
      circle(-119.5, 72.5, 17.5, 'DEPTH13-ARTICLE96053', { x: 0, y: 0, z: -1 }),
    ]);
    const [panel] = extractAbfPanels(doc);
    const c = panel!.circles[0]!;
    if (c.kind !== 'bore') throw new Error('expected a bore');
    const frame = face2DFrame({ length: panel!.length, width: panel!.width, thickness: 18 }, c.faceRole);
    const world = { x: frame.origin.x + c.u * frame.uDir.x + c.v * frame.vDir.x,
      y: frame.origin.y + c.u * frame.uDir.y + c.v * frame.vDir.y };
    // Independently-derived expectation: bbox-local (19.5,22.5) shifted to the panel-centered
    // frame (origin at panel center, per PanelOps.buildPanelBox) = (19.5-150, 22.5-100).
    expect(world.x).toBeCloseTo(19.5 - panel!.length / 2, 9);
    expect(world.y).toBeCloseTo(22.5 - panel!.width / 2, 9);
  });
});

describe('extractAbfPanels — full extraction across multiple panels/material groups', () => {
  it('returns one record per detected panel, each carrying its own material group', () => {
    const doc = emptyDoc();
    doc.entities = [insert('AUTO_THICKNESS_18'), insert('SREE_PEARLS_2_THICKNESS_18')];
    doc.blocks['AUTO_THICKNESS_18'] = [
      insert('Group1#1', { attribs: [{ tag: 'Skp_GroupInstanceName', value: '__9. Дно' }] }),
    ];
    doc.blocks['Group1#1'] = OUTLINE_300X200;
    doc.blocks['SREE_PEARLS_2_THICKNESS_18'] = [
      insert('Group2#1', { attribs: [{ tag: 'Skp_GroupInstanceName', value: '__13. ЗАД' }] }),
    ];
    doc.blocks['Group2#1'] = [line(0, 0, 500, 0), line(500, 0, 500, 100), line(500, 100, 0, 100), line(0, 100, 0, 0)];
    const panels = extractAbfPanels(doc);
    expect(panels).toHaveLength(2);
    const byName = new Map(panels.map((p) => [p.name, p]));
    expect(byName.get('__9. Дно')!.materialGroup.token).toBe('AUTO_THICKNESS_18');
    expect(byName.get('__9. Дно')!.length).toBeCloseTo(300, 9);
    expect(byName.get('__13. ЗАД')!.materialGroup.token).toBe('SREE_PEARLS_2_THICKNESS_18');
    expect(byName.get('__13. ЗАД')!.length).toBeCloseTo(500, 9);
  });
});
