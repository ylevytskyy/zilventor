import type { MaterialEntry, MaterialId } from '../material';
import type { GrainDirection, PanelFeature } from '../panel-feature';
import type {
  CabinetBuildOutput,
  CabinetComponentDef,
  CabinetPanelDef,
  CornerCabinetParams,
  PanelRole,
  ResolvedCabinetMaterials,
} from './types';
import { CabinetTemplateError } from './types';
import { rolePose, type Quat } from './rolePose';

/**
 * Build an L-corner cabinet (slice 1). Geometry follows the same flat-slab,
 * zero-rotation, min-corner-position convention as {@link buildBaseCabinet}:
 * panels are positioned by their reference corner in cabinet XYZ (X = plan
 * width, Y = plan depth, Z = height) and never rotated.
 *
 * Footprint (plan view): leg 1 occupies X∈[0,width1], Y∈[0,depth1]; leg 2
 * occupies X∈[0,depth2], Y∈[0,width2]. They share the corner zone
 * X∈[0,depth2], Y∈[0,depth1]; the reentrant inner corner is at (depth2,depth1)
 * where the corner post stands. The L-floor is two non-overlapping bottom
 * panels (full leg-1 floor + the leg-2 strip beyond the corner zone), mirrored
 * by two top panels. Two backs sit against the two room walls, and each leg
 * gets one outer side panel at its far end.
 */
export function buildCornerCabinet(
  params: CornerCabinetParams,
  registry: ReadonlyArray<MaterialEntry>,
): CabinetBuildOutput {
  const materials = resolveMaterials(params, registry);
  const Tc = materials.carcass.defaultThickness;
  const Tb = materials.back.defaultThickness;
  const { width1: W1, depth1: D1, width2: W2, depth2: D2, height: H } = params;

  validate(params, Tc);

  const panels: CabinetPanelDef[] = [];
  const layout: CabinetComponentDef[] = [];
  const bandId = materials.band?.id ?? null;

  // Leg-1 outer side (far +X end): vertical, thin in X, spans leg-1 depth.
  // Side-panel family (rotation ry=90), matches baseCabinet leftSide/rightSide:
  // local length(H)->world Z, local width(D1)->world Y, local thickness(Tc)->world X.
  {
    const position = { x: W1 - Tc, y: 0, z: 0 };
    pushPanel(panels, layout, {
      role: 'rightSide', fileNameSuffix: 'Leg 1 End',
      length: H, width: D1, thickness: Tc,
      materialId: materials.carcass.id, bandId,
      position,
      pose: rolePose(
        { x: position.x, y: position.y + D1 / 2, z: position.z + H / 2 },
        { rx: 0, ry: 90, rz: 0 },
      ),
    });
  }

  // Leg-2 outer side (far +Y end): vertical, thin in Y, spans leg-2 depth.
  // Leg 2 runs along Y, so its width (D2, depth-into-room-on-X) maps to world
  // X and its thickness maps to world Y — a different axis permutation than
  // Leg 1 End, hand-verified against the physical AABB (locking test).
  {
    const position = { x: 0, y: W2 - Tc, z: 0 };
    pushPanel(panels, layout, {
      role: 'leftSide', fileNameSuffix: 'Leg 2 End',
      length: H, width: D2, thickness: Tc,
      materialId: materials.carcass.id, bandId,
      position,
      pose: rolePose(
        { x: position.x + D2 / 2, y: position.y, z: position.z + H / 2 },
        { rx: -90, ry: 0, rz: -90 },
      ),
    });
  }

  // Back against the leg-1 wall (Y=0), spanning the full leg-1 length.
  // Back family (rotation rx=90), matches baseCabinet back: length(W1)->world X.
  {
    const position = { x: 0, y: 0, z: 0 };
    pushPanel(panels, layout, {
      role: 'back', fileNameSuffix: 'Back 1',
      length: W1, width: H, thickness: Tb,
      materialId: materials.back.id, bandId,
      position,
      pose: rolePose(
        { x: position.x + W1 / 2, y: position.y + Tb, z: position.z + H / 2 },
        { rx: 90, ry: 0, rz: 0 },
      ),
    });
  }

  // Back against the leg-2 wall (X=0), spanning the full leg-2 length.
  // Leg 2 runs along Y, so this back's length (W2) maps to world Y (not X
  // like Back 1) — a different axis permutation, hand-verified against the
  // physical AABB (locking test).
  {
    const position = { x: 0, y: 0, z: 0 };
    pushPanel(panels, layout, {
      role: 'back', fileNameSuffix: 'Back 2',
      length: W2, width: H, thickness: Tb,
      materialId: materials.back.id, bandId,
      position,
      pose: rolePose(
        { x: position.x, y: position.y + W2 / 2, z: position.z + H / 2 },
        { rx: 0, ry: 90, rz: 90 },
      ),
    });
  }

  // L-floor: leg-1 floor (full) + leg-2 strip beyond the shared corner zone.
  // Translation-only family (rotation identity), matches baseCabinet bottom/top.
  {
    const position = { x: 0, y: 0, z: 0 };
    pushPanel(panels, layout, {
      role: 'bottom', fileNameSuffix: 'Bottom 1',
      length: W1, width: D1, thickness: Tc,
      materialId: materials.carcass.id, bandId,
      position,
      pose: rolePose(
        { x: position.x + W1 / 2, y: position.y + D1 / 2, z: position.z },
        { rx: 0, ry: 0, rz: 0 },
      ),
    });
  }
  {
    const position = { x: 0, y: D1, z: 0 };
    pushPanel(panels, layout, {
      role: 'bottom', fileNameSuffix: 'Bottom 2',
      length: D2, width: W2 - D1, thickness: Tc,
      materialId: materials.carcass.id, bandId,
      position,
      pose: rolePose(
        { x: position.x + D2 / 2, y: position.y + (W2 - D1) / 2, z: position.z },
        { rx: 0, ry: 0, rz: 0 },
      ),
    });
  }

  // L-top mirrors the L-floor at Z = H − Tc.
  {
    const position = { x: 0, y: 0, z: H - Tc };
    pushPanel(panels, layout, {
      role: 'top', fileNameSuffix: 'Top 1',
      length: W1, width: D1, thickness: Tc,
      materialId: materials.carcass.id, bandId,
      position,
      pose: rolePose(
        { x: position.x + W1 / 2, y: position.y + D1 / 2, z: position.z },
        { rx: 0, ry: 0, rz: 0 },
      ),
    });
  }
  {
    const position = { x: 0, y: D1, z: H - Tc };
    pushPanel(panels, layout, {
      role: 'top', fileNameSuffix: 'Top 2',
      length: D2, width: W2 - D1, thickness: Tc,
      materialId: materials.carcass.id, bandId,
      position,
      pose: rolePose(
        { x: position.x + D2 / 2, y: position.y + (W2 - D1) / 2, z: position.z },
        { rx: 0, ry: 0, rz: 0 },
      ),
    });
  }

  // Full-height square corner post at the reentrant inner corner (depth2,depth1).
  // Side-panel family (rotation ry=90), same as leftSide/rightSide/Leg 1 End.
  {
    const position = { x: D2 - Tc, y: D1 - Tc, z: 0 };
    pushPanel(panels, layout, {
      role: 'cornerPost', fileNameSuffix: 'Corner Post',
      length: H, width: Tc, thickness: Tc,
      materialId: materials.carcass.id, bandId,
      position,
      pose: rolePose(
        { x: position.x, y: position.y + Tc / 2, z: position.z + H / 2 },
        { rx: 0, ry: 90, rz: 0 },
      ),
    });
  }

  return { panels, layout };
}

interface PushArgs {
  role: PanelRole;
  fileNameSuffix: string;
  length: number;
  width: number;
  thickness: number;
  materialId: MaterialId;
  bandId: MaterialId | null;
  position: { x: number; y: number; z: number };
  pose: { translation: { x: number; y: number; z: number }; quaternion: Quat };
}

function pushPanel(
  panels: CabinetPanelDef[],
  layout: CabinetComponentDef[],
  args: PushArgs,
): void {
  // Part-local feature id derived from the (unique) file-name suffix so that
  // two same-role panels (e.g. the two backs) never collide.
  const idSlug = args.fileNameSuffix.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const grain: GrainDirection = 'length';
  const panel: PanelFeature = {
    kind: 'panel',
    id: `pf-${idSlug}`,
    length: { kind: 'literal', value: args.length },
    width: { kind: 'literal', value: args.width },
    thickness: { kind: 'literal', value: args.thickness },
    thicknessFromMaterial: true,
    materialId: args.materialId,
    grain,
    edgeBands: { front: null, back: null, left: null, right: null },
  };
  panels.push({ role: args.role, fileNameSuffix: args.fileNameSuffix, panel });
  layout.push({
    fileNameSuffix: args.fileNameSuffix,
    position: args.position,
    rotation: { rx: 0, ry: 0, rz: 0 },
    pose: args.pose,
  });
}

function resolveMaterials(
  params: CornerCabinetParams,
  registry: ReadonlyArray<MaterialEntry>,
): ResolvedCabinetMaterials {
  const carcass = registry.find((m) => m.id === params.carcassMaterialId);
  if (!carcass) throw new CabinetTemplateError({ kind: 'carcassMaterialMissing' });
  const back = registry.find((m) => m.id === params.backMaterialId);
  if (!back) throw new CabinetTemplateError({ kind: 'backMaterialMissing' });
  const band = params.bandMaterialId === null
    ? null
    : registry.find((m) => m.id === params.bandMaterialId) ?? null;
  return { carcass, back, band };
}

function validate(params: CornerCabinetParams, Tc: number): void {
  const { width1: W1, depth1: D1, width2: W2, depth2: D2, height: H } = params;
  if (params.name.trim() === '') throw new CabinetTemplateError({ kind: 'nameEmpty' });
  if (W1 <= 2 * Tc) throw new CabinetTemplateError({ kind: 'cornerWidthTooSmall', minDimension: 2 * Tc });
  if (W2 <= 2 * Tc) throw new CabinetTemplateError({ kind: 'cornerWidthTooSmall', minDimension: 2 * Tc });
  if (D1 <= 2 * Tc) throw new CabinetTemplateError({ kind: 'cornerDepthTooSmall', minDimension: 2 * Tc });
  if (D2 <= 2 * Tc) throw new CabinetTemplateError({ kind: 'cornerDepthTooSmall', minDimension: 2 * Tc });
  if (H <= 2 * Tc) throw new CabinetTemplateError({ kind: 'heightTooSmall' });
  // Each leg must extend past the shared corner zone, else the footprint is not
  // an L (and the leg-2 floor strip width W2 − D1 must be positive).
  if (W1 <= D2) throw new CabinetTemplateError({ kind: 'cornerLegTooShort' });
  if (W2 <= D1) throw new CabinetTemplateError({ kind: 'cornerLegTooShort' });
}
