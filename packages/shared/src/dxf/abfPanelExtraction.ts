/**
 * Extraction of ABF-flatten-DXF panels from an already-parsed DXF (see
 * docs/superpowers/plans/2026-07-04-abf-import-as-panels.md and
 * docs/abf-plugin/05-parity/04-abf-flatten-dxf-sample-analysis.md).
 *
 * Pure, no I/O: walks `ParsedDxf.blocks`/`entities`, keeping `layer`/`attribs` alive
 * (unlike `toSketch`'s `expandInsert`, which discards both).
 */
import type { DxfEntity, ParsedDxf } from './types';
import type { BoreRole, BoreConnectorKind } from '../bore';
import { DOOR_CUP_FACE } from '../prisadkaFaceConventions';

/** ABF's panel-outline layer (docs/abf-plugin/05-parity/04-abf-flatten-dxf-sample-analysis.md §3
 *  Rule 5). Duplicated from `packages/app/src/drawing/abfLayerScheme.ts`'s `ABF_OUTLINE_LAYER`
 *  rather than imported: `shared` cannot depend on `app` (the dependency runs the other way).
 *  Keep this literal in sync with that source of truth. */
const ABF_OUTLINE_LAYER = 'ABF_cuttingLines';

const MATERIAL_GROUP_RE = /^(.+)_THICKNESS_(\d+(?:\.\d+)?)$/;
const PANEL_ROOT_ATTRIB_TAG = 'Skp_GroupInstanceName';
const PANEL_ROOT_NAME_RE = /^__\d+\.\s/;
/** `DEPTH<mm>[-ARTICLE<sku>]`, e.g. `DEPTH13-ARTICLE96053` or the bare `DEPTH3.0`
 *  (sample-doc §3 Rules 1/4). `ABF-DSIDE-<dia>` and `D<n>-DEPTHF-$<sku>` never match this —
 *  they fall back to reference-only circles regardless of face/edge orientation (§6d). */
const DEPTH_LAYER_RE = /^DEPTH(\d+(?:\.\d+)?)(?:-ARTICLE(\w+))?$/;
const MAX_BLOCK_DEPTH = 16; // mirrors toSketch.ts's expandInsert nesting guard
const EPS = 1e-6;
/** The OTHER broad face from the door-cup convention (bore.ts's `PanelFaceRole` restricted to
 *  Top/Bottom has exactly two members, so "not DOOR_CUP_FACE" is unambiguous). */
const OTHER_BROAD_FACE: 'Top' | 'Bottom' = DOOR_CUP_FACE === 'Bottom' ? 'Top' : 'Bottom';

/**
 * Best-effort diameter->hardware anchor table (plan §6c): `BoreRole`/`BoreConnectorKind` are
 * closed string-literal unions with no generic/"unknown" member, so an unmatched circle must
 * still resolve to one of these 9 existing kinds — never a 10th, invented literal. Several
 * roles share an identical Ø5 nominal diameter (shelfPin-system32, hingePlate, drawerSlide-cabinet,
 * drawerSlide-box, handleScrew-face, tandem-cabinet, etc.) and are diameter-indistinguishable;
 * `shelfPin-system32` is picked as the representative default for that bucket. Only the Ø35
 * hinge cup is diameter-unique across the whole enum, so only it is treated as a confident
 * (non-best-effort) match.
 */
const HARDWARE_ANCHORS: ReadonlyArray<{ readonly diameter: number; readonly role: BoreRole; readonly connectorKind: BoreConnectorKind; readonly confident: boolean }> = [
  { diameter: 35, role: 'hingeCup', connectorKind: 'hinge', confident: true },
  { diameter: 15, role: 'minifix-cam', connectorKind: 'minifix', confident: false },
  { diameter: 8, role: 'dowel-face', connectorKind: 'dowel', confident: false },
  { diameter: 7, role: 'confirmat-face', connectorKind: 'confirmat', confident: false },
  { diameter: 5, role: 'shelfPin-system32', connectorKind: 'shelfPin', confident: false },
  { diameter: 4, role: 'legLeveler', connectorKind: 'legLeveler', confident: false },
];

export interface AbfMaterialGroup {
  readonly token: string;
  readonly material: string;
  readonly thicknessMm: number;
}

/** A face-oriented circle on a parseable `DEPTH<mm>[-ARTICLE<sku>]` layer — enough to build a
 *  `BoreOp` (v1 face bores only). `u`/`v` are CORNER-based (0..length / 0..width), matching
 *  `face2DFrame`'s actual forward formula and every real BoreOp-generating call site — NOT the
 *  panel-centered convention the plan doc claimed (see the S1 worker report). */
export interface AbfBoreResult {
  readonly kind: 'bore';
  readonly diameter: number;
  readonly depth: number;
  readonly faceRole: 'Top' | 'Bottom';
  readonly role: BoreRole;
  readonly connectorKind: BoreConnectorKind;
  readonly u: number;
  readonly v: number;
  /** True when the diameter->hardware match is a representative pick among an inherently
   *  diameter-ambiguous set (plan §6c), not a confident/unique identification. */
  readonly bestEffort: boolean;
  readonly sku?: string;
}

/** An edge-oriented circle, or a face-oriented circle with no parseable depth signal — imported
 *  as plain reference geometry (no `BoreOp`), per plan §6d. Coordinates are panel-local
 *  (bbox min corner -> origin), same frame as `outline`. */
export interface AbfReferenceCircle {
  readonly kind: 'reference';
  readonly diameter: number;
  readonly x: number;
  readonly y: number;
}

export type AbfCircleResult = AbfBoreResult | AbfReferenceCircle;

export interface AbfPanelRecord {
  /** Verbatim `Skp_GroupInstanceName` ATTRIB value, e.g. "__4. Дверка" — kept as-is. */
  readonly name: string;
  readonly materialGroup: AbfMaterialGroup;
  /** Bbox X extent (mm) of the reconstructed `ABF_cuttingLines` outline. */
  readonly length: number;
  /** Bbox Y extent (mm). */
  readonly width: number;
  /** False when the outline layer's distinct points are anything other than exactly the 4 bbox
   *  corners (an L-shape, notch, etc.) — v1 still uses the bbox for length/width either way,
   *  per the plan's flagged (not solved) non-rectangular-outline risk. */
  readonly rectangular: boolean;
  /** The 4 bbox corners, min-corner-origin, CCW: (0,0)→(L,0)→(L,W)→(0,W). Always bbox-derived,
   *  even when `rectangular` is false (v1 scope). */
  readonly outline: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly circles: ReadonlyArray<AbfCircleResult>;
}

// ── Affine + OCS helpers ─────────────────────────────────────────────────────────────
// Duplicated from toSketch.ts's private (non-exported) insertMatrix/afMul/afApply/ocsXY —
// this module cannot import them, so the algorithm is re-implemented here verbatim rather
// than re-derived; toSketch.ts + its block-internal-OCS regression tests remain the source
// of truth for the math (see docs/abf-plugin/05-parity/04-abf-flatten-dxf-sample-analysis.md §5).
type V3 = { x: number; y: number; z: number };
type Affine = { a: number; b: number; c: number; d: number; e: number; f: number };
const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const afApply = (m: Affine, x: number, y: number): { x: number; y: number } =>
  ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
const afMul = (m: Affine, n: Affine): Affine => ({
  a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
  e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f,
});

/** Build the composite affine for one INSERT cell: T(ins) ∘ R(rotation) ∘ S(xscale,yscale) ∘ T(-base). */
function insertMatrix(
  ins: { x: number; y: number; xscale: number; yscale: number; rotation: number },
  base: { x: number; y: number },
): Affine {
  const r = (ins.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const scaleBase: Affine = { a: ins.xscale, b: 0, c: 0, d: ins.yscale, e: -base.x * ins.xscale, f: -base.y * ins.yscale };
  const rot: Affine = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  const trans: Affine = { a: 1, b: 0, c: 0, d: 1, e: ins.x, f: ins.y };
  return afMul(trans, afMul(rot, scaleBase));
}

const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (v: V3): V3 => { const m = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / m, y: v.y / m, z: v.z / m }; };

/** Arbitrary Axis Algorithm: OCS basis vectors for extrusion n. */
function ocsBasis(n: V3): { ax: V3; ay: V3 } {
  const wy: V3 = { x: 0, y: 1, z: 0 };
  const wz: V3 = { x: 0, y: 0, z: 1 };
  const ax = norm((Math.abs(n.x) < 1 / 64 && Math.abs(n.y) < 1 / 64) ? cross(wy, n) : cross(wz, n));
  const ay = norm(cross(n, ax));
  return { ax, ay };
}

/** Map an OCS (px,py) point to WCS XY, dropping z (2D import) — e.g. extrusion (0,0,-1) mirrors X. */
function ocsXY(ext: V3 | undefined, px: number, py: number): { x: number; y: number } {
  if (!ext || (ext.x === 0 && ext.y === 0 && ext.z === 1)) return { x: px, y: py };
  const { ax, ay } = ocsBasis(ext);
  return { x: px * ax.x + py * ay.x, y: px * ax.y + py * ay.y };
}
// ────────────────────────────────────────────────────────────────────────────────────

interface ResolvedSegment { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
interface ResolvedCircle { readonly x: number; readonly y: number; readonly diameter: number; readonly layer: string; readonly extZ: number }

/** Recursively resolve a panel-root INSERT's own block subtree into panel-local (unit-scale,
 *  identity-rooted at the panel's own block — NOT the panel's placement in the material group)
 *  segments (on the outline layer) and circles (any layer), composing nested-INSERT affines. */
function resolvePanelGeometry(blockName: string, parsed: ParsedDxf): { segments: ResolvedSegment[]; circles: ResolvedCircle[] } {
  const segments: ResolvedSegment[] = [];
  const circles: ResolvedCircle[] = [];
  const walk = (name: string, xf: Affine, depth: number): void => {
    if (depth > MAX_BLOCK_DEPTH) return;
    const body = parsed.blocks[name];
    if (!body) return;
    for (const be of body) {
      if (be.type === 'INSERT') {
        const subBase = parsed.blockBasePoints[be.name] ?? { x: 0, y: 0 };
        walk(be.name, afMul(xf, insertMatrix(be, subBase)), depth + 1);
        continue;
      }
      if (be.type === 'CIRCLE') {
        const ext = be.extrusion ?? { x: 0, y: 0, z: 1 };
        const mag = Math.hypot(ext.x, ext.y, ext.z) || 1;
        const extZ = ext.z / mag;
        // The Rule-5 OCS mirror only makes sense for a face-oriented circle, whose OCS plane
        // coincides with the panel's own face plane. An edge-oriented circle's OCS plane is
        // roughly perpendicular to the face (it's a side/edge-view circle); reconstructing its
        // true position in the panel's face-plane XY is out of scope for v1 — use its raw local
        // (cx,cy) as a best-effort placement for reference-only geometry instead.
        const local = Math.abs(extZ) > 0.5 ? ocsXY(be.extrusion, be.cx, be.cy) : { x: be.cx, y: be.cy };
        const p = afApply(xf, local.x, local.y);
        circles.push({ x: p.x, y: p.y, diameter: be.r * 2, layer: be.layer, extZ });
        continue;
      }
      if (be.type === 'LINE' && be.layer === ABF_OUTLINE_LAYER) {
        const a = afApply(xf, be.x1, be.y1);
        const b = afApply(xf, be.x2, be.y2);
        segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
      // Legacy-POLYLINE outline duplicates and the flat-vs-3D-silhouette distinction (sample-doc
      // §4/§5) are not handled by v1 — LINE-only, a documented gap (see the S1 worker report).
    }
  };
  walk(blockName, IDENTITY, 0);
  return { segments, circles };
}

interface OutlineResult {
  readonly length: number;
  readonly width: number;
  readonly rectangular: boolean;
  readonly outline: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  /** Bbox min corner in the panel-local (identity-rooted) frame — needed to shift bore/reference
   *  circle positions (computed in the same frame) onto the same min-corner-origin as `outline`. */
  readonly minX: number;
  readonly minY: number;
}

/** Bbox from all non-degenerate segment endpoints on the outline layer, min-corner shifted to
 *  the origin. `rectangular` is true only when the distinct point set is exactly the 4 bbox
 *  corners — anything else (an L-shape, notch, extra vertex) is flagged, not silently discarded
 *  (per the plan's §3 risk note), while v1 still reports the bbox L×W either way. */
function computeOutline(segments: readonly ResolvedSegment[]): OutlineResult {
  const points: Array<{ x: number; y: number }> = [];
  for (const s of segments) {
    if (Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < EPS) continue; // degenerate vertical wall-trace
    points.push({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 });
  }
  if (points.length === 0) return { length: 0, width: 0, rectangular: false, outline: [], minX: 0, minY: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const distinct: Array<{ x: number; y: number }> = [];
  for (const p of points) {
    if (!distinct.some((q) => Math.abs(q.x - p.x) < EPS && Math.abs(q.y - p.y) < EPS)) distinct.push(p);
  }
  const corners = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
  const isCorner = (p: { x: number; y: number }): boolean =>
    corners.some((c) => Math.abs(c.x - p.x) < EPS && Math.abs(c.y - p.y) < EPS);
  const rectangular = distinct.length === 4 && distinct.every(isCorner);
  return {
    length: maxX - minX,
    width: maxY - minY,
    rectangular,
    outline: corners.map((c) => ({ x: c.x - minX, y: c.y - minY })),
    minX, minY,
  };
}

/** Classify one resolved circle against the panel's bbox. `raw.x/y` are in the panel-local
 *  (identity-rooted, pre-bbox-shift) frame — shifted here by (minX,minY). */
function classifyCircle(raw: ResolvedCircle, minX: number, minY: number, width: number): AbfCircleResult {
  const x = raw.x - minX, y = raw.y - minY;
  const faceOriented = Math.abs(raw.extZ) > 0.5;
  const depthInfo = faceOriented ? DEPTH_LAYER_RE.exec(raw.layer) : null;
  if (!faceOriented || !depthInfo) {
    return { kind: 'reference', diameter: raw.diameter, x, y };
  }
  const depth = Number(depthInfo[1]);
  const sku = depthInfo[2];
  const faceRole: 'Top' | 'Bottom' = raw.extZ < 0 ? DOOR_CUP_FACE : OTHER_BROAD_FACE;
  let anchor = HARDWARE_ANCHORS[0]!;
  let bestDelta = Infinity;
  for (const a of HARDWARE_ANCHORS) {
    const delta = Math.abs(raw.diameter - a.diameter);
    if (delta < bestDelta) { bestDelta = delta; anchor = a; }
  }
  const bestEffort = !(anchor.confident && bestDelta < 0.5);
  return {
    kind: 'bore',
    diameter: raw.diameter,
    depth,
    faceRole,
    role: anchor.role,
    connectorKind: anchor.connectorKind,
    u: x,
    v: faceRole === 'Top' ? y : width - y,
    bestEffort,
    ...(sku !== undefined ? { sku } : {}),
  };
}

interface FoundPanelRoot {
  readonly name: string;
  readonly blockName: string;
  readonly materialToken: string | null;
}

/** DFS from modelspace through the BLOCKS tree, tracking the nearest `<MATERIAL>_THICKNESS_<mm>`
 *  ancestor block name as context. A panel root is any INSERT whose `Skp_GroupInstanceName`
 *  ATTRIB matches `/^__\d+\.\s/` — internal `_ABF_*` marker sub-blocks never match this and are
 *  walked past (not collected), per the plan's EXEC-verified 10-roots-vs-165-markers split. */
function findPanelRoots(parsed: ParsedDxf): FoundPanelRoot[] {
  const found: FoundPanelRoot[] = [];
  const walk = (entities: readonly DxfEntity[], materialToken: string | null, depth: number): void => {
    if (depth > MAX_BLOCK_DEPTH) return;
    for (const e of entities) {
      if (e.type !== 'INSERT') continue;
      const attrib = e.attribs?.find((a) => a.tag === PANEL_ROOT_ATTRIB_TAG);
      if (attrib && PANEL_ROOT_NAME_RE.test(attrib.value)) {
        found.push({ name: attrib.value, blockName: e.name, materialToken });
        continue; // a panel root's own subtree holds hardware/label markers, never nested panel roots
      }
      const nextToken = MATERIAL_GROUP_RE.test(e.name) ? e.name : materialToken;
      const body = parsed.blocks[e.name];
      if (body) walk(body, nextToken, depth + 1);
    }
  };
  walk(parsed.entities, null, 0);
  return found;
}

/** Parse a wrapping BLOCK name of the form `<MATERIAL>_THICKNESS_<mm>`. Returns null when the
 *  token doesn't carry the marker (e.g. a panel's own `Group<N>#<M>` block name). */
export function parseMaterialGroupToken(token: string): AbfMaterialGroup | null {
  const m = MATERIAL_GROUP_RE.exec(token);
  if (!m) return null;
  const thicknessMm = Number(m[2]);
  if (!Number.isFinite(thicknessMm)) return null;
  return { token, material: m[1]!, thicknessMm };
}

export function extractAbfPanels(parsed: ParsedDxf): AbfPanelRecord[] {
  const records: AbfPanelRecord[] = [];
  for (const root of findPanelRoots(parsed)) {
    const materialGroup = root.materialToken ? parseMaterialGroupToken(root.materialToken) : null;
    if (!materialGroup) continue; // no material/thickness context — cannot build a panel; skip
    const { segments, circles: rawCircles } = resolvePanelGeometry(root.blockName, parsed);
    const { length, width, rectangular, outline, minX, minY } = computeOutline(segments);
    const circles = rawCircles.map((c) => classifyCircle(c, minX, minY, width));
    records.push({ name: root.name, materialGroup, length, width, rectangular, outline, circles });
  }
  return records;
}
