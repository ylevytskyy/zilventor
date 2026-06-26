import type { BoreOp } from '../bore';
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
  CUP_SETBACK,
  PLATE_DIAMETER,
  PLATE_DEPTH,
  PLATE_PAIR_SPACING,
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

function makeLayout(suffix: string, x: number, y: number, z: number): CabinetComponentDef {
  return { fileNameSuffix: suffix, position: { x, y, z }, rotation: { rx: 0, ry: 0, rz: 0 } };
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
  // X offset of opening's left edge from cabinet origin
  const openingXOffset = blindSide === 'left' ? W - openingWidth : 0;

  // ─── Panels ─────────────────────────────────────────────────────────────────
  const panels: CabinetPanelDef[] = [
    makePanel('leftSide',    'Left Side',    H,           D,      Tc, params.carcassMaterialId),
    makePanel('rightSide',   'Right Side',   H,           D,      Tc, params.carcassMaterialId),
    makePanel('bottom',      'Bottom',       W - 2 * Tc,  D - Tb, Tc, params.carcassMaterialId),
    makePanel('top',         'Top',          W - 2 * Tc,  D - Tb, Tc, params.carcassMaterialId),
    makePanel('back',        'Back',         W - 2 * Tc,  H - 2 * Tc, Tb, params.backMaterialId),
    makePanel('toekick',     'Toekick',      W - 2 * Tc,  tkH,    Tc, params.carcassMaterialId),
    makePanel('blindFiller', 'Blind Filler', H - 2 * Tc,  blindFillerW, Tc, params.carcassMaterialId),
    makePanel('frontStile',  'Front Stile',  H - 2 * Tc,  Tc,     Tc, params.carcassMaterialId),
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
  const layout: CabinetComponentDef[] = [
    makeLayout('Left Side',  0,        0,   0),
    makeLayout('Right Side', W - Tc,   0,   0),
    makeLayout('Bottom',     Tc,       Tb,  tkH),
    makeLayout('Top',        Tc,       Tb,  H - Tc),
    makeLayout('Back',       Tc,       0,   Tc),
    makeLayout('Toekick',    Tc,       D - tkS - Tc, 0),
  ];

  // Blind filler: face-forward on the dead side, between side panel and opening
  if (blindSide === 'left') {
    layout.push(makeLayout('Blind Filler', Tc, D - blindFillerW, Tc));
    // Front stile: live side (right), at the front face, inner edge of the opening
    layout.push(makeLayout('Front Stile', W - Tc, D - Tc, Tc));
  } else {
    layout.push(makeLayout('Blind Filler', W - Tc - blindFillerW, D - blindFillerW, Tc));
    // Front stile: live side (left), at the front face
    layout.push(makeLayout('Front Stile', Tc, D - Tc, Tc));
  }

  // Shelves: evenly distributed in the inner height
  if (shelfCount > 0) {
    const innerBottom = tkH + Tc;
    const innerTop = H - Tc;
    const span = innerTop - innerBottom;
    for (let i = 0; i < shelfCount; i++) {
      const z = innerBottom + (span / (shelfCount + 1)) * (i + 1);
      layout.push(makeLayout(`Shelf ${i + 1}`, Tc, Tb, z));
    }
  }

  // Door: store pose translation (center-based) so consumers and tests can use the center X
  layout.push(makeLayout('Door', dp.pose.translation.x, dp.pose.translation.y, dp.pose.translation.z));

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
  );

  // Plate bores on the live-side carcass panel: 2 bores per hinge at the SAME
  // U (same height as the cup, so alignment holds) but different V (depth from
  // cabinet front). This satisfies both the count assertion (hingeCount*2) and
  // the alignment assertion (unique plate U == cup U set).
  const hingeSidePanel = openingSide === 'right' ? 'Right Side' : 'Left Side';
  const innerFace = openingSide === 'right' ? RIGHT_SIDE_INNER_FACE : LEFT_SIDE_INNER_FACE;
  const frontSetback = D - Td - CUP_SETBACK['full'];
  const half = PLATE_PAIR_SPACING / 2;
  const plateBoresList: BoreOp[] = uPositions.flatMap((u, i) => [
    {
      id: `hinge-${i}-plate-0`,
      face: { featureId: 'panel' as const, role: innerFace, instance: 0 },
      u,
      v: frontSetback - half,
      diameter: PLATE_DIAMETER,
      depth: PLATE_DEPTH,
      role: 'hingePlate' as const,
      connectorId: `hinge-${i}`,
      connectorKind: 'hinge' as const,
    },
    {
      id: `hinge-${i}-plate-1`,
      face: { featureId: 'panel' as const, role: innerFace, instance: 0 },
      u,
      v: frontSetback + half,
      diameter: PLATE_DIAMETER,
      depth: PLATE_DEPTH,
      role: 'hingePlate' as const,
      connectorId: `hinge-${i}`,
      connectorKind: 'hinge' as const,
    },
  ]);

  return {
    panels,
    layout,
    doorBores: [{ doorSuffix: 'Door', cupBores }],
    plateBores: [{ panelSuffix: hingeSidePanel, plateBores: plateBoresList }],
    hardware: [{ skuId: 'hinge-35mm-cup-full', count: hingeCount }],
  };
}
