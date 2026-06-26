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

const Td = DEFAULT_DOOR_THICKNESS; // 18 mm
const MIN_DOOR_WIDTH = 100;        // mm (spec §4.2)

/**
 * The stile's inner face (faces toward the door space) in the stile's local
 * boring frame. Derivation mirrors LEFT_SIDE_INNER_FACE in prisadkaFaceConventions.ts:
 * the stile is placed with rz=θ (rotation around world-Z only); part-Z (Top) stays
 * in world+Z, which is the "broad face" direction used by hingePlateBores. The actual
 * face toward the opening is encoded by the hinge geometry (cup setback on door side
 * equals plate setback from stile front edge per spec §4.6).
 * REQUIRES a Phase-0 integration test for final verification (spec §11 Risk 2).
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

function makeLayout(
  suffix: string,
  x: number,
  y: number,
  z: number,
  rz = 0,
): CabinetComponentDef {
  return {
    fileNameSuffix: suffix,
    position: { x, y, z },
    rotation: { rx: 0, ry: 0, rz },
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

  // Unit vector along diagonal V2→V3
  const dX = (D2 - W1) / diagLen;
  const dY = (W2 - D1) / diagLen;

  // Rotation angle of diagonal direction around +Z (degrees)
  const thetaDeg = Math.atan2(dY, dX) * 180 / Math.PI;

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
    makePanel('frontStile', 'Front Stile 1', H,             stileWidth, Tc, params.carcassMaterialId),
    makePanel('frontStile', 'Front Stile 2', H,             stileWidth, Tc, params.carcassMaterialId),
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

  // Door rotation (spec §4.4): rx=90 to stand door upright, rz to align with
  // outward normal direction. Outward normal: nX=dY, nY=−dX (rotate d by −90°).
  // doorRzDeg = angle from world+Y to outward normal in XY plane.
  const doorRzDeg = Math.atan2(-dX, dY) * 180 / Math.PI;

  // ─── Layout (spec §4.4) ─────────────────────────────────────────────────
  const layout: CabinetComponentDef[] = [
    makeLayout('Bottom',        0,          0,          0),
    makeLayout('Top',           0,          0,          H - Tc),
    makeLayout('Back 1',        0,          0,          Tc),
    makeLayout('Back 2',        0,          0,          Tc,      90),  // rz=90 to run along +Y
    makeLayout('Return Side 1', W1 - Tc,    0,          0),
    makeLayout('Return Side 2', 0,          W2 - Tc,    0),
    makeLayout('Toekick 1',     Tc,         0,          0),
    makeLayout('Toekick 2',     0,          Tc,         0),
    {
      fileNameSuffix: 'Front Stile 1',
      position: { x: stile1X, y: stile1Y, z: H / 2 },
      rotation: { rx: 0, ry: 0, rz: thetaDeg },
    },
    {
      fileNameSuffix: 'Front Stile 2',
      position: { x: stile2X, y: stile2Y, z: H / 2 },
      rotation: { rx: 0, ry: 0, rz: thetaDeg },
    },
    {
      fileNameSuffix: 'Door',
      position: { x: doorCenterX, y: doorCenterY, z: H / 2 },
      rotation: { rx: 90, ry: 0, rz: doorRzDeg },
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
    { length: H, width: stileWidth, thickness: Tc },
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
