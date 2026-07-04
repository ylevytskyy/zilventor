import type { MaterialEntry, MaterialId } from '../material';
import type { GrainDirection, PanelFeature } from '../panel-feature';
import type {
  BaseCabinetParams,
  CabinetBuildOutput,
  CabinetComponentDef,
  CabinetPanelDef,
  PanelRole,
  ResolvedCabinetMaterials,
} from './types';
import { CabinetTemplateError } from './types';

const SHELF_DEPTH_SHRINK_MM = 20;
const HANGING_RAIL_HEIGHT_MM = 80;

type Quat = [number, number, number, number];

/**
 * Local duplicate of kernel/src/assembly/quat.ts's quatFromEulerXYZ (intrinsic
 * XYZ Euler → quaternion, degrees). `packages/shared` cannot depend on
 * `@zilventor/kernel` (kernel depends on shared), so per-role pose
 * quaternions are computed from this private copy — mirrors the existing
 * fileFormat.ts eulerXYZToQuat duplicate (cabinet-pose-fix plan §2.5).
 */
function localQuatFromEulerXYZ(rxDeg: number, ryDeg: number, rzDeg: number): Quat {
  const rx = (rxDeg * Math.PI) / 180;
  const ry = (ryDeg * Math.PI) / 180;
  const rz = (rzDeg * Math.PI) / 180;
  const cx = Math.cos(rx / 2), sx = Math.sin(rx / 2);
  const cy = Math.cos(ry / 2), sy = Math.sin(ry / 2);
  const cz = Math.cos(rz / 2), sz = Math.sin(rz / 2);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

/**
 * Builds the additive `pose` field per cabinet-pose-fix plan §3.2: pose is
 * purely additive (stored `position`/`rotation` numbers never change).
 * `translation` is the caller-computed world translation (position + the
 * role's half-extent/thickness correction); `rotationDeg` is the Euler triple
 * whose quaternion compensates buildPanelBox's local box convention
 * (X∈[-L/2,L/2], Y∈[-W/2,W/2], Z∈[0,T]).
 */
function rolePose(
  translation: { x: number; y: number; z: number },
  rotationDeg: { rx: number; ry: number; rz: number },
): { translation: { x: number; y: number; z: number }; quaternion: Quat } {
  return {
    translation,
    quaternion: localQuatFromEulerXYZ(rotationDeg.rx, rotationDeg.ry, rotationDeg.rz),
  };
}

export function buildBaseCabinet(
  params: BaseCabinetParams,
  registry: ReadonlyArray<MaterialEntry>,
): CabinetBuildOutput {
  const materials = resolveMaterials(params, registry);

  const Tc = materials.carcass.defaultThickness;
  const Tb = materials.back.defaultThickness;
  const isWall = params.cabinetType === 'wall';
  // Wall cabinets hang on the wall — no toekick regardless of the passed value.
  const tkH = isWall ? 0 : params.toekickHeight;
  const { width: W, depth: D, height: H, toekickSetback: tkS } = params;

  validate(params, materials, tkH);

  const panels: CabinetPanelDef[] = [];
  const layout: CabinetComponentDef[] = [];

  {
    const position = { x: 0, y: 0, z: 0 };
    pushPanel(panels, layout, {
      role: 'leftSide', fileNameSuffix: 'Left Side',
      length: H, width: D, thickness: Tc,
      materialId: materials.carcass.id, grain: 'length',
      bands: bandsForRole('leftSide', materials.band ?? null),
      position,
      pose: rolePose(
        { x: position.x, y: position.y + D / 2, z: position.z + H / 2 },
        { rx: 0, ry: 90, rz: 0 },
      ),
    });
  }

  {
    const position = { x: W - Tc, y: 0, z: 0 };
    pushPanel(panels, layout, {
      role: 'rightSide', fileNameSuffix: 'Right Side',
      length: H, width: D, thickness: Tc,
      materialId: materials.carcass.id, grain: 'length',
      bands: bandsForRole('rightSide', materials.band ?? null),
      position,
      pose: rolePose(
        { x: position.x, y: position.y + D / 2, z: position.z + H / 2 },
        { rx: 0, ry: 90, rz: 0 },
      ),
    });
  }

  {
    const position = { x: Tc, y: Tb, z: tkH };
    pushPanel(panels, layout, {
      role: 'bottom', fileNameSuffix: 'Bottom',
      length: W - 2 * Tc, width: D - Tb, thickness: Tc,
      materialId: materials.carcass.id, grain: 'length',
      bands: bandsForRole('bottom', materials.band ?? null),
      position,
      pose: rolePose(
        { x: position.x + (W - 2 * Tc) / 2, y: position.y + (D - Tb) / 2, z: position.z },
        { rx: 0, ry: 0, rz: 0 },
      ),
    });
  }

  {
    const position = { x: Tc, y: Tb, z: H - Tc };
    pushPanel(panels, layout, {
      role: 'top', fileNameSuffix: 'Top',
      length: W - 2 * Tc, width: D - Tb, thickness: Tc,
      materialId: materials.carcass.id, grain: 'length',
      bands: bandsForRole('top', materials.band ?? null),
      position,
      pose: rolePose(
        { x: position.x + (W - 2 * Tc) / 2, y: position.y + (D - Tb) / 2, z: position.z },
        { rx: 0, ry: 0, rz: 0 },
      ),
    });
  }

  {
    const position = { x: 0, y: 0, z: 0 };
    pushPanel(panels, layout, {
      role: 'back', fileNameSuffix: 'Back',
      length: W, width: H, thickness: Tb,
      materialId: materials.back.id, grain: 'length',
      bands: bandsForRole('back', materials.band ?? null),
      position,
      pose: rolePose(
        { x: position.x + W / 2, y: position.y + Tb, z: position.z + H / 2 },
        { rx: 90, ry: 0, rz: 0 },
      ),
    });
  }

  if (tkH > 0) {
    const position = { x: Tc, y: D - tkS - Tc, z: 0 };
    pushPanel(panels, layout, {
      role: 'toekick', fileNameSuffix: 'Toekick',
      length: W - 2 * Tc, width: tkH, thickness: Tc,
      materialId: materials.carcass.id, grain: 'length',
      bands: bandsForRole('toekick', materials.band ?? null),
      position,
      pose: rolePose(
        { x: position.x + (W - 2 * Tc) / 2, y: position.y, z: position.z + tkH / 2 },
        { rx: -90, ry: 0, rz: 0 },
      ),
    });
  }

  if (isWall) {
    // Top-back nailer for hanging the cabinet: spans the inner width, tucked
    // under the top panel and flush against the back.
    const position = { x: Tc, y: Tb, z: H - Tc - HANGING_RAIL_HEIGHT_MM };
    pushPanel(panels, layout, {
      role: 'hangingRail', fileNameSuffix: 'Hanging Rail',
      length: W - 2 * Tc, width: HANGING_RAIL_HEIGHT_MM, thickness: Tc,
      materialId: materials.carcass.id, grain: 'length',
      bands: bandsForRole('hangingRail', materials.band ?? null),
      position,
      pose: rolePose(
        { x: position.x + (W - 2 * Tc) / 2, y: position.y, z: position.z + HANGING_RAIL_HEIGHT_MM / 2 },
        { rx: -90, ry: 0, rz: 0 },
      ),
    });
  }

  if (params.shelfCount > 0) {
    const innerBottom = tkH + Tc;
    const innerTop = H - Tc;
    const span = innerTop - innerBottom;
    const step = span / (params.shelfCount + 1);
    const shelfWidth = D - Tb - SHELF_DEPTH_SHRINK_MM;
    for (let i = 1; i <= params.shelfCount; i++) {
      const z = innerBottom + i * step;
      const position = { x: Tc, y: Tb, z };
      pushPanel(panels, layout, {
        role: 'shelf', shelfIndex: i, fileNameSuffix: `Shelf ${i}`,
        length: W - 2 * Tc, width: shelfWidth, thickness: Tc,
        materialId: materials.carcass.id, grain: 'length',
        bands: bandsForRole('shelf', materials.band ?? null),
        position,
        pose: rolePose(
          { x: position.x + (W - 2 * Tc) / 2, y: position.y + shelfWidth / 2, z: position.z },
          { rx: 0, ry: 0, rz: 0 },
        ),
      });
    }
  }

  return { panels, layout };
}

interface PushArgs {
  role: PanelRole;
  shelfIndex?: number;
  fileNameSuffix: string;
  length: number;
  width: number;
  thickness: number;
  materialId: MaterialId;
  grain: GrainDirection;
  bands: PanelFeature['edgeBands'];
  position: { x: number; y: number; z: number };
  pose: { translation: { x: number; y: number; z: number }; quaternion: Quat };
}

function pushPanel(
  panels: CabinetPanelDef[],
  layout: CabinetComponentDef[],
  args: PushArgs,
): void {
  const panel: PanelFeature = {
    kind: 'panel',
    id: `pf-${args.role}${args.shelfIndex !== undefined ? `-${args.shelfIndex}` : ''}`,
    length: { kind: 'literal', value: args.length },
    width: { kind: 'literal', value: args.width },
    thickness: { kind: 'literal', value: args.thickness },
    thicknessFromMaterial: true,
    materialId: args.materialId,
    grain: args.grain,
    edgeBands: args.bands,
  };
  panels.push({
    role: args.role,
    ...(args.shelfIndex !== undefined ? { shelfIndex: args.shelfIndex } : {}),
    fileNameSuffix: args.fileNameSuffix,
    panel,
  });
  layout.push({
    fileNameSuffix: args.fileNameSuffix,
    position: args.position,
    rotation: { rx: 0, ry: 0, rz: 0 },
    pose: args.pose,
  });
}

function bandsForRole(role: PanelRole, band: MaterialEntry | null): PanelFeature['edgeBands'] {
  const empty = { front: null, back: null, left: null, right: null } as const;
  if (band === null) return empty;
  if (role === 'leftSide' || role === 'rightSide' || role === 'bottom' || role === 'top' || role === 'shelf') {
    return { front: { materialId: band.id, thickness: band.bandThicknessMm ?? 0.4 }, back: null, left: null, right: null };
  }
  return empty;
}

function resolveMaterials(
  params: BaseCabinetParams,
  registry: ReadonlyArray<MaterialEntry>,
): ResolvedCabinetMaterials {
  const carcass = registry.find((m) => m.id === params.carcassMaterialId);
  if (!carcass) throw new CabinetTemplateError({ kind: 'carcassMaterialMissing' });
  const back = registry.find((m) => m.id === params.backMaterialId);
  if (!back) throw new CabinetTemplateError({ kind: 'backMaterialMissing' });
  // If bandMaterialId points to a missing entry, silently degrade to null
  // (matches spec §5.1 — only carcass/back are hard-required).
  const band = params.bandMaterialId === null
    ? null
    : registry.find((m) => m.id === params.bandMaterialId) ?? null;
  return { carcass, back, band };
}

function validate(
  params: BaseCabinetParams,
  materials: ResolvedCabinetMaterials,
  effectiveToekickHeight: number,
): void {
  const Tc = materials.carcass.defaultThickness;
  const tkH = effectiveToekickHeight;
  if (params.name.trim() === '') throw new CabinetTemplateError({ kind: 'nameEmpty' });
  if (params.width <= 2 * Tc) throw new CabinetTemplateError({ kind: 'widthTooSmall', minDimension: 2 * Tc });
  if (params.depth <= 2 * Tc) throw new CabinetTemplateError({ kind: 'depthTooSmall', minDimension: 2 * Tc });
  if (params.height <= 2 * Tc + tkH) throw new CabinetTemplateError({ kind: 'heightTooSmall' });
  if (tkH >= params.height / 2) throw new CabinetTemplateError({ kind: 'toekickHeightTooLarge' });
  if (params.toekickSetback >= params.depth - Tc) throw new CabinetTemplateError({ kind: 'toekickSetbackTooLarge' });
  const innerH = params.height - tkH - 2 * Tc;
  const maxShelves = Math.max(0, Math.floor(innerH / 100));
  if (params.shelfCount > maxShelves) {
    throw new CabinetTemplateError({ kind: 'shelfCountTooLarge', maxShelves });
  }
}
