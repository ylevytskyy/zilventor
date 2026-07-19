import { createDxfDocument, worldToOcs, type DxfDocument, type Vec3 } from './dxfWriter';
import { layoutCombinedGrid, type GridPosition } from './layoutCombinedGrid';
import { abfBoreLayer, ABF_OUTLINE_LAYER, sanitizeSkuForLayer } from './abfLayerScheme';
import { boreToFlat, boreOrientation, type PanelManufacturingInput } from './renderPanelManufacturingDxf';
import type { BoreOp } from '@zilventor/shared';

export type { PanelManufacturingInput };

const GRID_GUTTER = 50;
const MAX_BLOCK_NAME_LENGTH = 26;
/** ATTRIB tags per the ViyarPro/ABF flatten dialect (see docs/abf-plugin/05-parity/04). */
const GROUP_INSTANCE_TAG = 'Skp_GroupInstanceName';
const COMPONENT_INSTANCE_TAG = 'Skp_ComponentInstanceName';
/** Literal value proven by a live viyar.pro import round-trip — NOT the material name. */
const COMPONENT_INSTANCE_VALUE = 'ABF_Flatten';
/** Skp_GroupInstanceName value on the nested cutting-line block's INSERT (R2). */
const CUTLINE_ATTRIB_VALUE = '_ABF_cuttingLines';
/** Layer carrying the R3 solid-representation polyface-mesh faces (legacy "flat duplicate"). */
const SOLID_FACE_LAYER = 'Untagged00';
/** Skp_GroupInstanceName value on each nested bore-group block's INSERT (R-BORE). */
const BORE_GROUP_ATTRIB_VALUE = '_ABF_bore';

/** Effective DXF layer for a bore under the ABF grammar, falling back to the native
 *  (non-ABF) layer name computed by boreToFlat when abfBoreLayer has no convention
 *  for this bore. A skuless throughAll FACE bore (Top/Bottom) — the one case
 *  abfBoreLayer deliberately declines (no invented THRU convention) — routes to
 *  `D<diameter>-DEPTHF` (R-THROUGHBORE: the server documents through-holes via the
 *  literal phrase DEPTHF in the layer name; matches the sku'd variant's own grammar,
 *  `D<diameter>-DEPTHF-$<sku>`, minus the sku — NOT `DEPTH<panelThickness>`, the
 *  original H2 fix, which still triggered a "depth not specified" warning live). A
 *  finite-depth edge bore now routes through the SAME `DEPTH<depth>[-ARTICLE<sku>]`
 *  family as a face bore (abfBoreLayer no longer branches on orientation for that
 *  case) — see abfLayerScheme.ts's abfBoreLayer docstring for the live-disqualified
 *  ABF-DSIDE-<dia> alternative. A throughAll edge bore keeps the native fallback. */
function panelBoreLayer(b: BoreOp, nativeLayer: string): string {
  const orientation = boreOrientation(b.face.role);
  const abfLayer = abfBoreLayer(b, orientation);
  if (abfLayer !== null) return abfLayer;
  if (b.depth === 'throughAll' && orientation === 'face') return `D${b.diameter}-DEPTHF`;
  return nativeLayer;
}

/**
 * Inward drill-axis normal (flat-model coords) per edge face — the direction the drill
 * enters the panel from that edge. Live-bisected 2026-07-19: a plain flat CIRCLE on the
 * DEPTH<depth> layer clears the depth warnings but the importer still reads it as a FACE
 * hole at 0mm edge distance; tilting the circle's plane via this normal (as a DXF OCS
 * extrusion, group 210/220/230) makes it read as a genuine ТОРЦЕВИЙ (edge) hole. Sign
 * convention is proven only by shape (X- vs Y-normal) so far — the exact sign→"Сторона"
 * mapping awaits a later live viyar.pro upload; kept as its own lookup so a sign flip is
 * a one-line change.
 */
const EDGE_BORE_NORMAL: Record<'Left' | 'Right' | 'Back' | 'Front', Vec3> = {
  Left: [1, 0, 0],
  Right: [-1, 0, 0],
  Back: [0, 1, 0],
  Front: [0, -1, 0],
};

/** The OCS extrusion normal for `b`'s drill axis, or null when the flat (Z-normal)
 *  encoding is correct as-is: face (Top/Bottom) bores, and throughAll edge bores (which
 *  stay on the native/DEPTHF layer family — unaffected by the DEPTH<depth> edge-bore
 *  fix, see abfLayerScheme.ts's abfBoreLayer docstring). */
function edgeBoreDrillAxis(b: BoreOp): Vec3 | null {
  if (b.depth === 'throughAll' || boreOrientation(b.face.role) !== 'edge') return null;
  return EDGE_BORE_NORMAL[b.face.role as 'Left' | 'Right' | 'Back' | 'Front'];
}

type PositionedBore = { b: BoreOp; x: number; y: number };

/** This panel's bores, grouped by their effective DXF layer, each with its panel-local
 *  (x,y) position (from boreToFlat). Shared by neededLayers() and drawPanelBoreGroups()
 *  so the layer computation isn't duplicated. */
function groupBoresByLayer(bores: readonly BoreOp[], len: number, wid: number): Map<string, PositionedBore[]> {
  const groups = new Map<string, PositionedBore[]>();
  for (const b of bores) {
    const f = boreToFlat(b, len, wid);
    if (!f) continue;
    const layer = panelBoreLayer(b, f.layer);
    const group = groups.get(layer) ?? [];
    group.push({ b, x: f.x, y: f.y });
    groups.set(layer, group);
  }
  return groups;
}

/** Every ABF-scheme layer this panel's outline + bores + solid representation actually
 *  draw into. ABF_OUTLINE_LAYER and SOLID_FACE_LAYER are always used (R2/R3). */
function neededLayers(input: PanelManufacturingInput): string[] {
  const layers = new Set<string>([ABF_OUTLINE_LAYER, SOLID_FACE_LAYER]);
  for (const layer of groupBoresByLayer(input.bores, input.spec.length, input.spec.width).keys()) layers.add(layer);
  return [...layers];
}

/**
 * R-BORE: nests each panel's bores (grouped by DXF layer) into their own child BLOCK —
 * live debugging showed bare CIRCLEs directly in the panel block silently drop on
 * import (holes never appear in the planner). Each group's reference point is its
 * first bore's panel-local position; the child block draws its CIRCLEs in
 * block-local coordinates relative to that point, and the panel INSERTs the block AT
 * the reference point (Z=0) with layer '0' and an Skp_GroupInstanceName="_ABF_bore"
 * ATTRIB (group 66=1). A finite-depth EDGE bore (edgeBoreDrillAxis) additionally gets a
 * DXF OCS extrusion normal equal to its drill axis, re-centered at world Z=thickness/2
 * (mid-thickness — where a confirmat pilot physically enters) before the OCS transform
 * — the live-bisected fix for the importer's "FACE hole at 0mm edge distance" warning
 * (see EDGE_BORE_NORMAL docstring). Face bores and throughAll edge bores keep the flat
 * Z=0, no-extrusion encoding (byte-identical to before).
 */
function drawPanelBoreGroups(doc: DxfDocument, bores: readonly BoreOp[], len: number, wid: number, thickness: number, panelIndex: number): void {
  const groups = groupBoresByLayer(bores, len, wid);
  let boreGroupCounter = 0;
  for (const [layer, group] of groups) {
    boreGroupCounter++;
    const boreBlockName = `Group${panelIndex}_bores${boreGroupCounter}#1`;
    const ref = group[0]!;
    doc.namedBlock(boreBlockName, () => {
      for (const g of group) {
        const normal = edgeBoreDrillAxis(g.b);
        if (normal) {
          const [ox, oy, oz] = worldToOcs([g.x - ref.x, g.y - ref.y, thickness / 2], normal);
          doc.circle(layer, ox, oy, g.b.diameter / 2, undefined, normal, oz);
        } else {
          doc.circle(layer, g.x - ref.x, g.y - ref.y, g.b.diameter / 2);
        }
      }
    });
    doc.insert(boreBlockName, ref.x, ref.y, [{ tag: GROUP_INSTANCE_TAG, value: BORE_GROUP_ATTRIB_VALUE }]);
  }
}

/**
 * The 6 quads of a [0,len]x[0,wid]x[0,thick] box, in the exact vertex order the
 * accepted golden reference uses (.vp-native/variants/f4.dxf) — verified per-face
 * against a live-accepted export, not derived generically, since the ordering
 * (position within each quad) is what a real ezdxf/SketchUp-exporter emits and this
 * dialect must match structurally.
 */
function boxFaces(len: number, wid: number, thick: number): ReadonlyArray<readonly [Vec3, Vec3, Vec3, Vec3]> {
  const L = len, W = wid, T = thick;
  return [
    [[0, W, T], [L, W, 0], [0, W, 0], [L, W, T]], // +Y
    [[L, W, 0], [L, 0, T], [L, 0, 0], [L, W, T]], // +X
    [[0, W, 0], [L, 0, 0], [0, 0, 0], [L, W, 0]], // -Z (bottom)
    [[0, 0, T], [0, W, 0], [0, 0, 0], [0, W, T]], // -X
    [[L, 0, T], [0, W, T], [0, 0, T], [L, W, T]], // +Z (top)
    [[L, 0, T], [0, 0, 0], [L, 0, 0], [0, 0, T]], // -Y
  ];
}

/** The 12 unique edges of the same box, in golden-reference order: 4 bottom-rect (z=0),
 *  4 top-rect (z=thick), 4 verticals. */
function boxEdges(len: number, wid: number, thick: number): ReadonlyArray<readonly [Vec3, Vec3]> {
  const L = len, W = wid, T = thick;
  const bottom: Array<[Vec3, Vec3]> = [
    [[0, 0, 0], [L, 0, 0]], [[L, 0, 0], [L, W, 0]], [[L, W, 0], [0, W, 0]], [[0, W, 0], [0, 0, 0]],
  ];
  const top: Array<[Vec3, Vec3]> = [
    [[0, 0, T], [L, 0, T]], [[L, 0, T], [L, W, T]], [[L, W, T], [0, W, T]], [[0, W, T], [0, 0, T]],
  ];
  const verticals: Array<[Vec3, Vec3]> = [
    [[0, 0, 0], [0, 0, T]], [[L, 0, 0], [L, 0, T]], [[L, W, 0], [L, W, T]], [[0, W, 0], [0, W, T]],
  ];
  return [...bottom, ...top, ...verticals];
}

/** R3 solid representation: 6 single-quad polyface meshes (one per box face, layer
 *  SOLID_FACE_LAYER) + the 12 box edges emitted TWICE (layer ABF_OUTLINE_LAYER) — the
 *  proven-sufficient template (.vp-native/variants/f4.dxf), not a from-scratch minimal
 *  derivation. */
function drawPanelSolid(doc: DxfDocument, len: number, wid: number, thickness: number): void {
  for (const face of boxFaces(len, wid, thickness)) doc.polyfaceMesh(SOLID_FACE_LAYER, face);
  const edges = boxEdges(len, wid, thickness);
  for (const [a, b] of [...edges, ...edges]) doc.line3d(ABF_OUTLINE_LAYER, a, b);
}

/** `<MATERIAL>_THICKNESS_<mm>` — sanitized (transliterated + ASCII-safe, reusing
 *  sanitizeSkuForLayer), truncated to MAX_BLOCK_NAME_LENGTH characters TOTAL. H1 fix:
 *  the material part alone is truncated to a budget (26 minus the suffix's own length)
 *  BEFORE the suffix is appended, so "_THICKNESS_<mm>" always survives intact — the
 *  prior bug sliced the already-concatenated string, clipping the suffix for long names. */
function materialBlockName(materialName: string, thickness: number): string {
  const suffix = `_THICKNESS_${thickness}`;
  const budget = Math.max(0, MAX_BLOCK_NAME_LENGTH - suffix.length);
  return sanitizeSkuForLayer(materialName).slice(0, budget) + suffix;
}

type MaterialGroup = {
  materialName: string;
  thickness: number;
  items: PanelManufacturingInput[];
};

function groupByMaterial(inputs: readonly PanelManufacturingInput[]): MaterialGroup[] {
  const groups = new Map<string, MaterialGroup>();
  for (const input of inputs) {
    const key = `${input.materialName} ${input.spec.thickness}`;
    let g = groups.get(key);
    if (!g) {
      g = { materialName: input.materialName, thickness: input.spec.thickness, items: [] };
      groups.set(key, g);
    }
    g.items.push(input);
  }
  return [...groups.values()];
}

/**
 * One PHYSICAL panel copy. R-QTY: aggregatePanelManufacturing dedups physically distinct
 * panels sharing a machining signature into one `PanelManufacturingInput` with `qty > 1`
 * (e.g. Left Side + Right Side of a wall cabinet) — each copy must still reach the DXF as
 * its own panel-group instance, or half the cabinet silently never gets ordered. Per the
 * genuine ABF-plugin sample (Стелаж flatten.dxf): repeated physical instances of the same
 * aggregated panel share one base group id and increment the `#<instance>` suffix
 * (`Group57#1`, `Group57#2`, …) — NOT fresh `GroupN#1` blocks each.
 */
type PanelInstance = { item: PanelManufacturingInput; groupId: number; instanceIndex: number };

function expandInstances(items: readonly PanelManufacturingInput[], groupIdSeq: { next: number }): PanelInstance[] {
  const out: PanelInstance[] = [];
  for (const item of items) {
    const groupId = groupIdSeq.next++;
    for (let instanceIndex = 1; instanceIndex <= item.qty; instanceIndex++) {
      out.push({ item, groupId, instanceIndex });
    }
  }
  return out;
}

/**
 * Renders every input panel into a single DXF document in the "ViyarPro flatten" dialect
 * that viyar.pro's Конвертація importer accepts (empirically proven via a live server
 * round-trip — see docs/abf-plugin/05-parity/04-abf-flatten-dxf-sample-analysis.md).
 *
 * Structure: per (materialName, thickness) group, a top-level named BLOCK
 * (`<MATERIAL>_THICKNESS_<mm>`) whose body INSERTs one nested named panel BLOCK
 * (`Group<N>#1`) per panel, each carrying an Skp_GroupInstanceName ATTRIB with the
 * panel's label. ENTITIES holds one INSERT per material block at (0,0), each carrying
 * an Skp_ComponentInstanceName ATTRIB = the literal "ABF_Flatten" (not the material
 * name — resolved against the live-accepted sample). HEADER declares AC1021/INSUNITS
 * 4/MEASUREMENT 1 and a real (non-sentinel) bbox computed as the union of every
 * group's laid-out panel extents (all material INSERTs share world origin (0,0), so
 * groups overlap — matching the accepted sample).
 *
 * Each panel BLOCK (`Group<N>#1`) additionally draws (per the fully-accepted golden
 * reference, .vp-native/variants/f4.dxf — see DXF2VIYARPRO-SPEC.md): its bores, nested
 * one child `Group<N>_bores<i>#1` BLOCK per DXF layer (R-BORE — bare CIRCLEs directly
 * in the panel block silently drop on import; layer grammar per H2/R-THROUGHBORE,
 * skuless throughAll face bores → `D<diameter>-DEPTHF`; finite-depth bores of EITHER
 * orientation → `DEPTH<depth>[-ARTICLE<sku>]`, per abfLayerScheme.ts — a live
 * 2026-07-19 bisection disqualified the once-tried `ABF-DSIDE-<dia>` circle+
 * companion-polyline encoding for edge bores: viyar.pro never read depth from it. A
 * SECOND 2026-07-19 live bisection found that a plain flat DEPTH<depth> CIRCLE cleared
 * the depth warnings but was still read as a FACE hole at 0mm edge distance — the fix
 * (edgeBoreDrillAxis/EDGE_BORE_NORMAL) tilts a finite-depth edge bore's CIRCLE onto its
 * drill axis via a DXF OCS extrusion normal (group 210/220/230, world center re-based
 * to Z=thickness/2 before the worldToOcs transform), which the importer reads as a
 * genuine edge (ТОРЦЕВИЙ) hole; throughAll edge bores are unaffected, still flat);
 * an INSERT of a nested
 * `Group<N>_cutline#1` child BLOCK (a legacy 3D-polyline closed contour) carrying the
 * ATTRIB `Skp_GroupInstanceName = "_ABF_cuttingLines"` on layer ABF_cuttingLines at
 * insertion Z = the panel's thickness (R2 — replaces the old bare LWPOLYLINE outline,
 * which the accepted dialect does not use); and a "solid representation" (R3) of 6
 * single-quad polyface meshes (one per box face, layer Untagged00) plus the box's 12
 * edges emitted twice as LINEs (layer ABF_cuttingLines). `createDxfDocument`'s
 * `sketchupCompat: true` (R1) adds the DIMSTYLE/STYLE/OBJECTS/$DIMALTF richness the
 * server's InvalidScaleError check requires.
 */
export function renderViyarProFlattenDxf(inputs: PanelManufacturingInput[]): string {
  const groupIdSeq = { next: 1 };
  const groups = groupByMaterial(inputs).map((g) => {
    const instances = expandInstances(g.items, groupIdSeq);
    return {
      ...g,
      instances,
      positions: layoutCombinedGrid(
        instances.map((inst) => ({ width: inst.item.spec.length, height: inst.item.spec.width })),
        GRID_GUTTER,
      ),
    };
  });

  const allLayers = new Set<string>();
  for (const input of inputs) for (const layer of neededLayers(input)) allLayers.add(layer);

  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  let first = true;
  for (const g of groups) {
    g.instances.forEach((inst, idx) => {
      const pos = g.positions[idx] as GridPosition;
      const x0 = pos.x, y0 = pos.y;
      const x1 = pos.x + inst.item.spec.length, y1 = pos.y + inst.item.spec.width;
      if (first) { minX = x0; minY = y0; maxX = x1; maxY = y1; first = false; }
      else {
        minX = Math.min(minX, x0); minY = Math.min(minY, y0);
        maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1);
      }
    });
  }

  const doc = createDxfDocument([...allLayers], {
    acadVersion: 'AC1021',
    insunits: 4,
    measurement: 1,
    bbox: { minX, minY, maxX, maxY },
    sketchupCompat: true,
  });

  // Unique per PHYSICAL panel instance (unlike groupId, which is shared across an
  // aggregated item's qty copies) — feeds the `_cutline`/`_bores` sub-block
  // names, so two copies of the same panel never collide on a BLOCK_RECORD name.
  let instanceCounter = 0;
  for (const g of groups) {
    const blockName = materialBlockName(g.materialName, g.thickness);
    const panelInserts: Array<{ blockName: string; x: number; y: number; label: string }> = [];

    g.instances.forEach((inst, idx) => {
      instanceCounter++;
      const { item, groupId, instanceIndex } = inst;
      const panelBlockName = `Group${groupId}#${instanceIndex}`;
      const cutlineBlockName = `Group${instanceCounter}_cutline#1`;
      const len = item.spec.length, wid = item.spec.width, thickness = item.spec.thickness;
      doc.namedBlock(cutlineBlockName, () => {
        doc.polyline3d(ABF_OUTLINE_LAYER, [[0, 0], [len, 0], [len, wid], [0, wid]], true);
      });
      doc.namedBlock(panelBlockName, () => {
        drawPanelBoreGroups(doc, item.bores, len, wid, thickness, instanceCounter);
        doc.insert(cutlineBlockName, 0, 0, [{ tag: GROUP_INSTANCE_TAG, value: CUTLINE_ATTRIB_VALUE }], { z: thickness, layer: ABF_OUTLINE_LAYER });
        drawPanelSolid(doc, len, wid, thickness);
      });
      const pos = g.positions[idx] as GridPosition;
      const label = item.partNames?.[instanceIndex - 1] ?? item.partName;
      panelInserts.push({
        blockName: panelBlockName, x: pos.x, y: pos.y,
        label: `${label} {${item.itemNumber}}`,
      });
    });

    doc.namedBlock(blockName, () => {
      for (const p of panelInserts) {
        doc.insert(p.blockName, p.x, p.y, [{ tag: GROUP_INSTANCE_TAG, value: p.label }]);
      }
    });

    doc.insert(blockName, 0, 0, [{ tag: COMPONENT_INSTANCE_TAG, value: COMPONENT_INSTANCE_VALUE }]);
  }

  return doc.toString();
}
