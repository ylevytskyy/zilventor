import type { MaterialEntry } from '../material';
import type { PanelFeature } from '../panel-feature';
import {
  doorMath,
  DEFAULT_DOOR_THICKNESS,
  DEFAULT_REVEAL,
  DEFAULT_CLEARANCE,
  DEFAULT_CENTER_REVEAL,
} from '../doorMath';
import {
  hingeCountForHeight,
  hingePositions,
  hingeCupBores,
  hingePlateBores,
  PLATE_DEPTH,
} from '../hingeMath';
import { DOOR_CUP_FACE, LEFT_SIDE_INNER_FACE, RIGHT_SIDE_INNER_FACE } from '../prisadkaFaceConventions';
import type {
  BlindCornerCabinetParams,
  CabinetBuildOutput,
  CabinetComponentDef,
  CabinetPanelDef,
  PanelRole,
} from './types';
import { CabinetTemplateError } from './types';
import { rolePose, type Quat } from './rolePose';

const Td = DEFAULT_DOOR_THICKNESS;

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
): CabinetPanelDef {
  const panel: PanelFeature = {
    kind: 'panel',
    id: `pf-${role}`,
    length: lit(length),
    width: lit(width),
    thickness: lit(thickness),
    thicknessFromMaterial: true,
    materialId,
    grain: 'length',
    edgeBands: { front: null, back: null, left: null, right: null },
  };
  return { role, fileNameSuffix: suffix, panel };
}

function makeLayout(
  suffix: string,
  x: number,
  y: number,
  z: number,
  pose?: { translation: { x: number; y: number; z: number }; quaternion: Quat },
): CabinetComponentDef {
  return {
    fileNameSuffix: suffix,
    position: { x, y, z },
    rotation: { rx: 0, ry: 0, rz: 0 },
    ...(pose ? { pose } : {}),
  };
}

export function buildBlindCornerCabinet(
  params: BlindCornerCabinetParams,
  registry: ReadonlyArray<MaterialEntry>,
): CabinetBuildOutput {
  const { name, width: W, depth: D, height: H, toekickHeight: tkH, toekickSetback: tkS, openingWidth, blindSide } = params;
  const shelfCount = params.shelfCount ?? 0;

  // ─── Material resolution ────────────────────────────────────────────────────
  const carcass = registry.find(e => e.id === params.carcassMaterialId);
  if (!carcass) throw new CabinetTemplateError({ kind: 'carcassMaterialMissing' });
  const backMat = registry.find(e => e.id === params.backMaterialId);
  if (!backMat) throw new CabinetTemplateError({ kind: 'backMaterialMissing' });

  const Tc = carcass.defaultThickness;
  const Tb = backMat.defaultThickness;

  // ─── Validation ─────────────────────────────────────────────────────────────
  if (!name.trim()) throw new CabinetTemplateError({ kind: 'nameEmpty' });
  if (openingWidth < 2 * Tc) throw new CabinetTemplateError({ kind: 'blindOpeningTooSmall' });
  if (openingWidth >= W) throw new CabinetTemplateError({ kind: 'blindOpeningTooLarge' });

  const blindFillerW = W - openingWidth - Tc;
  // live side (where door is) is opposite to the blind side
  const openingSide: 'left' | 'right' = blindSide === 'left' ? 'right' : 'left';
  // X offset of opening's left edge from cabinet origin.
  // For blindSide='left': opening is on the right → offset = W − openingWidth.
  // For blindSide='right': opening is on the left, whose left edge is the inner
  //   face of the Left Side panel at x = Tc.
  const openingXOffset = blindSide === 'left' ? W - openingWidth : Tc;

  // ─── Panels ─────────────────────────────────────────────────────────────────
  const panels: CabinetPanelDef[] = [
    makePanel('leftSide',    'Left Side',    H,           D,      Tc, params.carcassMaterialId),
    makePanel('rightSide',   'Right Side',   H,           D,      Tc, params.carcassMaterialId),
    makePanel('bottom',      'Bottom',       W - 2 * Tc,  D - Tb, Tc, params.carcassMaterialId),
    makePanel('top',         'Top',          W - 2 * Tc,  D - Tb, Tc, params.carcassMaterialId),
    makePanel('back',        'Back',         W - 2 * Tc,  H - 2 * Tc, Tb, params.backMaterialId),
    makePanel('toekick',     'Toekick',      W - 2 * Tc,  tkH,    Tc, params.carcassMaterialId),
    makePanel('blindFiller', 'Blind Filler', H - 2 * Tc,  blindFillerW, Tc, params.carcassMaterialId),
  ];

  for (let i = 0; i < shelfCount; i++) {
    const shelfFeature: PanelFeature = {
      kind: 'panel',
      id: `pf-shelf-${i + 1}`,
      length: lit(W - 2 * Tc),
      width: lit(D - Tb),
      thickness: lit(Tc),
      thicknessFromMaterial: true,
      materialId: params.carcassMaterialId,
      grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
    };
    panels.push({ role: 'shelf', shelfIndex: i + 1, fileNameSuffix: `Shelf ${i + 1}`, panel: shelfFeature });
  }

  // Door — sized against openingWidth with X offset to the live side
  const doorResult = doorMath({
    cabinet: { width: W, height: H, depth: D, Tc, toekickHeight: tkH },
    count: 'single',
    overlay: 'full',
    hingeSide: openingSide,
    thickness: Td,
    reveal: DEFAULT_REVEAL,
    clearance: DEFAULT_CLEARANCE,
    centerReveal: DEFAULT_CENTER_REVEAL,
    openingWidth,
    openingXOffset,
  });
  const dp = doorResult[0]!;
  const doorW = dp.dims.width;
  const doorH = dp.dims.length;
  panels.push(makePanel('door', 'Door', doorH, doorW, Td, params.carcassMaterialId));

  // ─── Layout ─────────────────────────────────────────────────────────────────
  // Rotations follow cabinet-pose-fix plan §3.2 by role-analogy to baseCabinet:
  // leftSide/rightSide/blindFiller = side-panel family (ry=90, thickness->X);
  // back = back family (rx=90); toekick = toekick family (rx=-90);
  // bottom/top/shelf = translation-only (identity).
  const layout: CabinetComponentDef[] = [
    makeLayout('Left Side',  0,        0,   0,
      rolePose({ x: 0, y: D / 2, z: H / 2 }, { rx: 0, ry: 90, rz: 0 })),
    makeLayout('Right Side', W - Tc,   0,   0,
      rolePose({ x: W - Tc, y: D / 2, z: H / 2 }, { rx: 0, ry: 90, rz: 0 })),
    makeLayout('Bottom',     Tc,       Tb,  tkH,
      rolePose({ x: Tc + (W - 2 * Tc) / 2, y: Tb + (D - Tb) / 2, z: tkH }, { rx: 0, ry: 0, rz: 0 })),
    makeLayout('Top',        Tc,       Tb,  H - Tc,
      rolePose({ x: Tc + (W - 2 * Tc) / 2, y: Tb + (D - Tb) / 2, z: H - Tc }, { rx: 0, ry: 0, rz: 0 })),
    makeLayout('Back',       Tc,       0,   Tc,
      rolePose({ x: Tc + (W - 2 * Tc) / 2, y: Tb, z: Tc + (H - 2 * Tc) / 2 }, { rx: 90, ry: 0, rz: 0 })),
    makeLayout('Toekick',    Tc,       D - tkS - Tc, 0,
      rolePose({ x: Tc + (W - 2 * Tc) / 2, y: D - tkS - Tc, z: tkH / 2 }, { rx: -90, ry: 0, rz: 0 })),
  ];

  // Blind filler: face-forward on the dead side, between side panel and opening.
  // Side-panel family per plan §3.5: thickness->world X (horizontal), length
  // (H-2Tc)->world Z, width (blindFillerW)->world Y — same permutation as
  // leftSide/rightSide/cornerPost.
  if (blindSide === 'left') {
    layout.push(makeLayout('Blind Filler', Tc, D - blindFillerW, Tc,
      rolePose({ x: Tc, y: D - blindFillerW + blindFillerW / 2, z: Tc + (H - 2 * Tc) / 2 }, { rx: 0, ry: 90, rz: 0 })));
  } else {
    const fillerX = W - Tc - blindFillerW;
    layout.push(makeLayout('Blind Filler', fillerX, D - blindFillerW, Tc,
      rolePose({ x: fillerX, y: D - blindFillerW + blindFillerW / 2, z: Tc + (H - 2 * Tc) / 2 }, { rx: 0, ry: 90, rz: 0 })));
  }

  // Shelves: evenly distributed in the inner height
  if (shelfCount > 0) {
    const innerBottom = tkH + Tc;
    const innerTop = H - Tc;
    const span = innerTop - innerBottom;
    for (let i = 0; i < shelfCount; i++) {
      const z = innerBottom + (span / (shelfCount + 1)) * (i + 1);
      layout.push(makeLayout(`Shelf ${i + 1}`, Tc, Tb, z,
        rolePose({ x: Tc + (W - 2 * Tc) / 2, y: Tb + (D - Tb) / 2, z }, { rx: 0, ry: 0, rz: 0 })));
    }
  }

  // Door: store pose translation (center-based) so consumers and tests can use
  // the center X. Pushed as a literal layout object (not via makeLayout) so the
  // pose carries doorMath's DOOR_POSE.quaternion directly — makeLayout's own
  // pose param derives quaternions from Euler triples via rolePose, which
  // would be the wrong tool for the door's Shepperd-derived upright pose.
  layout.push({
    fileNameSuffix: 'Door',
    position: { x: dp.pose.translation.x, y: dp.pose.translation.y, z: dp.pose.translation.z },
    rotation: { rx: 0, ry: 0, rz: 0 },
    pose: { translation: dp.pose.translation, quaternion: dp.pose.quaternion },
  });

  // ─── Hinge boring ───────────────────────────────────────────────────────────
  const hingeCount = hingeCountForHeight(doorH);
  const uPositions = hingePositions(doorH, hingeCount);

  // Cup bores on door (Ø35, via hingeCupBores)
  const cupBores = hingeCupBores(
    { length: doorH, width: doorW, thickness: Td },
    DOOR_CUP_FACE,
    openingSide,
    'full',
    uPositions,
    'hinge-35mm-cup-full', // matches this template's hardware skuId below
  );

  // Plate bores on the live-side carcass panel via the shared `hingePlateBores`
  // helper (System-32 convention): 2 bores per hinge at u ± PLATE_PAIR_SPACING/2
  // (= ±16 mm along the panel height), all at the same v = frontSetback.
  const hingeSidePanel = openingSide === 'right' ? 'Right Side' : 'Left Side';
  const innerFace = openingSide === 'right' ? RIGHT_SIDE_INNER_FACE : LEFT_SIDE_INNER_FACE;
  const frontSetback = D - Td - PLATE_DEPTH;
  const plateBoresList = hingePlateBores(
    { length: H, width: D, thickness: Tc },
    innerFace,
    uPositions,
    frontSetback,
    undefined,
    'hinge-35mm-cup-full', // matches this template's hardware skuId below
  );

  return {
    panels,
    layout,
    doorBores: [{ doorSuffix: 'Door', cupBores }],
    plateBores: [{ panelSuffix: hingeSidePanel, plateBores: plateBoresList }],
    hardware: [{ skuId: 'hinge-35mm-cup-full', count: hingeCount }],
  };
}
