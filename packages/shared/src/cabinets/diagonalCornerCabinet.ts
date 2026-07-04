/**
 * buildDiagonalCornerCabinet — pure shared builder, M4 Slice E Task 5.
 *
 * Spec: docs/superpowers/specs/2026-06-26-m4-sliceE-blind-diagonal-corner-cabinets-design.md §4
 *
 * Pentagon plan: origin at room corner, walls along +X and +Y.
 * Shorthands: W1=wallWidth1, W2=wallWidth2, D1=returnDepth1, D2=returnDepth2.
 *
 * Vertices (CCW from +Z):
 *   V0=(0,0), V1=(W1,0), V2=(W1,D1), V3=(D2,W2), V4=(0,W2)
 *
 * Diagonal edge V2→V3 carries two front stiles (stileWidth wide) and a slab door.
 */
import type { MaterialEntry } from '../material';
import type { PanelFeature } from '../panel-feature';
import { DEFAULT_DOOR_THICKNESS, DEFAULT_REVEAL } from '../doorMath';
import {
  hingeCountForHeight,
  hingePositions,
  hingeCupBores,
  hingePlateBores,
  CUP_SETBACK,
} from '../hingeMath';
import { DOOR_CUP_FACE } from '../prisadkaFaceConventions';
import type {
  DiagonalCornerCabinetParams,
  CabinetBuildOutput,
  CabinetComponentDef,
  CabinetPanelDef,
  PanelRole,
} from './types';
import { CabinetTemplateError } from './types';
import { rolePose } from './rolePose';

const Td = DEFAULT_DOOR_THICKNESS; // 18 mm
const MIN_DOOR_WIDTH = 100;        // mm (spec §4.2)

/**
 * The stile's inner face (faces toward the door space) in the stile's local boring
 * frame. Both stile and door use intrinsic Euler (rx=−90°, ry=arcsin(dY), rz=−90°)
 * which maps:
 *   part-X (length=doorH) → world+Z  (panel stands upright)
 *   part-Z (+local-Z = Top outward normal) → (dY,−dX,0)  (outward from cabinet front)
 *
 * Derivation of 'Top': Top face outward normal is +local-Z, which maps to the outward
 * normal of the diagonal face (dY,−dX,0) — i.e. toward the door opening. Therefore
 * the Top face IS the inner (door-facing) face. Proven by the Phase-0 world-space
 * alignment test in diagonalCornerCabinet.spec.ts (spec §11 Risk 2).
 */
const DIAGONAL_STILE_INNER_FACE = 'Top' as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function lit(value: number) {
  return { kind: 'literal' as const, value };
}

function makePanel(
  role: PanelRole,
  suffix: string,
  length: number,
  width: number,
  thickness: number,
  materialId: string,
  outline?: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): CabinetPanelDef {
  const panel: PanelFeature = {
    kind: 'panel',
    id: `pf-${suffix.toLowerCase().replace(/\s+/g, '-')}`,
    length: lit(length),
    width: lit(width),
    thickness: lit(thickness),
    thicknessFromMaterial: true,
    materialId,
    grain: 'length',
    edgeBands: { front: null, back: null, left: null, right: null },
    ...(outline ? { outline } : {}),
  };
  return { role, fileNameSuffix: suffix, panel };
}

/**
 * Additive pose correction per cabinet-pose-fix plan §3.2/§3.5: `poseSpec`'s
 * (dx,dy,dz) is the translation offset from the stored min-corner `position`
 * to the pose's world-space translation (per role-family, mirrors baseCabinet/
 * cornerCabinet), and (rx,ry,rz) is the Euler triple whose quaternion
 * compensates buildPanelBox's centered/edge-anchored local box convention.
 * Stored `position`/`rotation` numbers are never changed by this correction.
 */
function makeLayout(
  suffix: string,
  x: number,
  y: number,
  z: number,
  rz = 0,
  poseSpec?: { dx: number; dy: number; dz: number; rx: number; ry: number; rz: number },
): CabinetComponentDef {
  return {
    fileNameSuffix: suffix,
    position: { x, y, z },
    rotation: { rx: 0, ry: 0, rz },
    ...(poseSpec
      ? {
          pose: rolePose(
            { x: x + poseSpec.dx, y: y + poseSpec.dy, z: z + poseSpec.dz },
            { rx: poseSpec.rx, ry: poseSpec.ry, rz: poseSpec.rz },
          ),
        }
      : {}),
  };
}

// ─── Builder ────────────────────────────────────────────────────────────────

export function buildDiagonalCornerCabinet(
  params: DiagonalCornerCabinetParams,
  registry: ReadonlyArray<MaterialEntry>,
): CabinetBuildOutput {
  const {
    name,
    wallWidth1: W1, wallWidth2: W2,
    returnDepth1: D1, returnDepth2: D2,
    height: H, toekickHeight: tkH,
    stileWidth,
  } = params;

  // ─── Material resolution ────────────────────────────────────────────────
  const carcass = registry.find(e => e.id === params.carcassMaterialId);
  if (!carcass) throw new CabinetTemplateError({ kind: 'carcassMaterialMissing' });
  const backMat = registry.find(e => e.id === params.backMaterialId);
  if (!backMat) throw new CabinetTemplateError({ kind: 'backMaterialMissing' });

  const Tc = carcass.defaultThickness;
  const Tb = backMat.defaultThickness;

  // ─── Input validation ───────────────────────────────────────────────────
  if (!name.trim()) throw new CabinetTemplateError({ kind: 'nameEmpty' });
  if (stileWidth <= 0) throw new CabinetTemplateError({ kind: 'stileWidthInvalid' });

  // ─── Pentagon geometry (spec §4.3) ──────────────────────────────────────
  // diagonalLength = |V2V3| = sqrt((W1−D2)² + (D1−W2)²)
  const diagLen = Math.sqrt((W1 - D2) ** 2 + (D1 - W2) ** 2);
  if (diagLen <= 0) throw new CabinetTemplateError({ kind: 'diagonalDoorTooNarrow' });

  // Unit vector along diagonal V2→V3
  const dX = (D2 - W1) / diagLen;
  const dY = (W2 - D1) / diagLen;

  // Upright rotation: part-X→world+Z, part-Z→outward normal (dY,−dX,0).
  // Intrinsic XYZ Euler: rx=−90°, ry=arcsin(dY), rz=−90°.
  // Valid for typical configs where D2≤W1 (dX≤0); spec §4.4.
  const ryDeg = Math.asin(dY) * 180 / Math.PI;

  // Door dimensions (spec §4.5)
  const doorW = diagLen - 2 * stileWidth - 2 * DEFAULT_REVEAL;
  if (doorW < MIN_DOOR_WIDTH) throw new CabinetTemplateError({ kind: 'diagonalDoorTooNarrow' });

  const doorH = H - 2 * DEFAULT_REVEAL;

  // ─── Pentagon outline (spec §4.4, CCW from +Z) ─────────────────────────
  const pentOutline = [
    { x: 0,  y: 0  }, // V0 — room corner
    { x: W1, y: 0  }, // V1 — wall-1 far end
    { x: W1, y: D1 }, // V2 — front-right return corner
    { x: D2, y: W2 }, // V3 — front-left  return corner
    { x: 0,  y: W2 }, // V4 — wall-2 far end
  ] as const;

  // ─── Panels (spec §4.4) ─────────────────────────────────────────────────
  const panels: CabinetPanelDef[] = [
    makePanel('bottom',     'Bottom',        W1,            W2,        Tc, params.carcassMaterialId, pentOutline),
    makePanel('top',        'Top',           W1,            W2,        Tc, params.carcassMaterialId, pentOutline),
    makePanel('back',       'Back 1',        W1,            H,         Tb, params.backMaterialId),
    makePanel('back',       'Back 2',        W2,            H,         Tb, params.backMaterialId),
    makePanel('leftSide',   'Return Side 1', H,             D1,        Tc, params.carcassMaterialId),
    makePanel('rightSide',  'Return Side 2', H,             D2,        Tc, params.carcassMaterialId),
    makePanel('toekick',    'Toekick 1',     W1 - 2 * Tc,  tkH,       Tc, params.carcassMaterialId),
    makePanel('toekick',    'Toekick 2',     W2 - 2 * Tc,  tkH,       Tc, params.carcassMaterialId),
    makePanel('frontStile', 'Front Stile 1', doorH,         stileWidth, Tc, params.carcassMaterialId),
    makePanel('frontStile', 'Front Stile 2', doorH,         stileWidth, Tc, params.carcassMaterialId),
    makePanel('door',       'Door',          doorH,         doorW,     Td, params.carcassMaterialId),
  ];

  // ─── Stile and door world-XY centers (spec §4.4) ────────────────────────
  // Stile 1 center: V2 + (stileWidth/2)*(dX,dY)
  const stile1X = W1 + (stileWidth / 2) * dX;
  const stile1Y = D1 + (stileWidth / 2) * dY;

  // Stile 2 center: V3 − (stileWidth/2)*(dX,dY)
  const stile2X = D2 - (stileWidth / 2) * dX;
  const stile2Y = W2 - (stileWidth / 2) * dY;

  // Door center: midpoint of diagonal
  const doorCenterX = (W1 + D2) / 2;
  const doorCenterY = (D1 + W2) / 2;

  // ─── Layout (spec §4.4) ─────────────────────────────────────────────────
  // Stile and door use the SAME upright rotation (rx=−90, ry=ryDeg, rz=−90)
  // so that part-X (length=doorH) → world+Z and both panels stand vertically.
  const uprightRot = { rx: -90, ry: ryDeg, rz: -90 } as const;

  const layout: CabinetComponentDef[] = [
    // Bottom/Top: pentagon-outline panels; buildOutlinePrism re-centers the
    // outline to buildPanelBox's convention (PanelOps.ts:182-184), so the
    // translation-only family (identity rotation) applies exactly like
    // baseCabinet/cornerCabinet bottom/top.
    makeLayout('Bottom',        0,          0,          0,       0, { dx: W1 / 2, dy: W2 / 2, dz: 0, rx: 0, ry: 0, rz: 0 }),
    makeLayout('Top',           0,          0,          H - Tc,  0, { dx: W1 / 2, dy: W2 / 2, dz: 0, rx: 0, ry: 0, rz: 0 }),
    // Back family, matches baseCabinet/cornerCabinet back (rx=90 for the
    // wall-1-aligned back; rx=0,ry=90,rz=90 permutation for the wall-2-aligned
    // back — same permutation cornerCabinet's Back 2 uses).
    makeLayout('Back 1',        0,          0,          Tc,      0, { dx: W1 / 2, dy: Tb, dz: H / 2, rx: 90, ry: 0, rz: 0 }),
    makeLayout('Back 2',        0,          0,          Tc,      90, { dx: 0, dy: W2 / 2, dz: H / 2, rx: 0, ry: 90, rz: 90 }),  // rz=90 to run along +Y
    // Side-panel family, identical dims/position to cornerCabinet's Leg 1
    // End / Leg 2 End — same pose formulas apply verbatim.
    makeLayout('Return Side 1', W1 - Tc,    0,          0,       0, { dx: 0, dy: D1 / 2, dz: H / 2, rx: 0, ry: 90, rz: 0 }),
    makeLayout('Return Side 2', 0,          W2 - Tc,    0,       0, { dx: D2 / 2, dy: 0, dz: H / 2, rx: -90, ry: 0, rz: -90 }),
    // Toekick family, matches baseCabinet toekick (rx=-90) for the wall-1
    // toekick; wall-2 toekick needs the same axis permutation as Back 2
    // (rx=0,ry=90,rz=90) since its length runs along Y, thickness along X.
    makeLayout('Toekick 1',     Tc,         0,          0,       0, { dx: (W1 - 2 * Tc) / 2, dy: 0, dz: tkH / 2, rx: -90, ry: 0, rz: 0 }),
    makeLayout('Toekick 2',     0,          Tc,         0,       0, { dx: 0, dy: (W2 - 2 * Tc) / 2, dz: tkH / 2, rx: 0, ry: 90, rz: 90 }),
    {
      fileNameSuffix: 'Front Stile 1',
      position: { x: stile1X, y: stile1Y, z: H / 2 },
      rotation: uprightRot,
    },
    {
      fileNameSuffix: 'Front Stile 2',
      position: { x: stile2X, y: stile2Y, z: H / 2 },
      rotation: uprightRot,
    },
    {
      fileNameSuffix: 'Door',
      position: { x: doorCenterX, y: doorCenterY, z: H / 2 },
      rotation: uprightRot,
    },
  ];

  // ─── Hinge boring (spec §4.6) ───────────────────────────────────────────
  const hingeCount = hingeCountForHeight(doorH);
  const uPositions = hingePositions(doorH, hingeCount);

  // Ø35 cup bores on door (hingeSide='right' = hinge stile 1 side, overlay='full')
  const cupBores = hingeCupBores(
    { length: doorH, width: doorW, thickness: Td },
    DOOR_CUP_FACE,
    'right',
    'full',
    uPositions,
  );

  // Ø5 plate bores on Front Stile 1 (the hinge stile)
  // frontSetback per spec §4.6: Td + (CUP_SETBACK['full'] − Tc/2)
  const frontSetback = Td + (CUP_SETBACK['full'] - Tc / 2);
  const plateBoresList = hingePlateBores(
    { length: doorH, width: stileWidth, thickness: Tc },
    DIAGONAL_STILE_INNER_FACE,
    uPositions,
    frontSetback,
  );

  return {
    panels,
    layout,
    doorBores:  [{ doorSuffix: 'Door', cupBores }],
    plateBores: [{ panelSuffix: 'Front Stile 1', plateBores: plateBoresList }],
    hardware:   [{ skuId: 'hinge-35mm-cup-full', count: hingeCount }],
  };
}
