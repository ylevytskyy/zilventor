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

export function buildBaseCabinet(
  params: BaseCabinetParams,
  registry: ReadonlyArray<MaterialEntry>,
): CabinetBuildOutput {
  const materials = resolveMaterials(params, registry);
  validate(params, materials);

  const Tc = materials.carcass.defaultThickness;
  const Tb = materials.back.defaultThickness;
  const { width: W, depth: D, height: H, toekickHeight: tkH, toekickSetback: tkS } = params;

  const panels: CabinetPanelDef[] = [];
  const layout: CabinetComponentDef[] = [];

  pushPanel(panels, layout, {
    role: 'leftSide', fileNameSuffix: 'Left Side',
    length: H, width: D, thickness: Tc,
    materialId: materials.carcass.id, grain: 'length',
    bands: bandsForRole('leftSide', materials.band?.id ?? null),
    position: { x: 0, y: 0, z: 0 },
  });

  pushPanel(panels, layout, {
    role: 'rightSide', fileNameSuffix: 'Right Side',
    length: H, width: D, thickness: Tc,
    materialId: materials.carcass.id, grain: 'length',
    bands: bandsForRole('rightSide', materials.band?.id ?? null),
    position: { x: W - Tc, y: 0, z: 0 },
  });

  pushPanel(panels, layout, {
    role: 'bottom', fileNameSuffix: 'Bottom',
    length: W - 2 * Tc, width: D - Tb, thickness: Tc,
    materialId: materials.carcass.id, grain: 'length',
    bands: bandsForRole('bottom', materials.band?.id ?? null),
    position: { x: Tc, y: Tb, z: tkH },
  });

  pushPanel(panels, layout, {
    role: 'top', fileNameSuffix: 'Top',
    length: W - 2 * Tc, width: D - Tb, thickness: Tc,
    materialId: materials.carcass.id, grain: 'length',
    bands: bandsForRole('top', materials.band?.id ?? null),
    position: { x: Tc, y: Tb, z: H - Tc },
  });

  pushPanel(panels, layout, {
    role: 'back', fileNameSuffix: 'Back',
    length: W, width: H, thickness: Tb,
    materialId: materials.back.id, grain: 'length',
    bands: bandsForRole('back', materials.band?.id ?? null),
    position: { x: 0, y: 0, z: 0 },
  });

  if (tkH > 0) {
    pushPanel(panels, layout, {
      role: 'toekick', fileNameSuffix: 'Toekick',
      length: W - 2 * Tc, width: tkH, thickness: Tc,
      materialId: materials.carcass.id, grain: 'length',
      bands: bandsForRole('toekick', materials.band?.id ?? null),
      position: { x: Tc, y: D - tkS - Tc, z: 0 },
    });
  }

  if (params.shelfCount > 0) {
    const innerBottom = tkH + Tc;
    const innerTop = H - Tc;
    const span = innerTop - innerBottom;
    const step = span / (params.shelfCount + 1);
    for (let i = 1; i <= params.shelfCount; i++) {
      const z = innerBottom + i * step;
      pushPanel(panels, layout, {
        role: 'shelf', shelfIndex: i, fileNameSuffix: `Shelf ${i}`,
        length: W - 2 * Tc, width: D - Tb - SHELF_DEPTH_SHRINK_MM, thickness: Tc,
        materialId: materials.carcass.id, grain: 'length',
        bands: bandsForRole('shelf', materials.band?.id ?? null),
        position: { x: Tc, y: Tb, z },
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
  });
}

function bandsForRole(role: PanelRole, bandId: MaterialId | null): PanelFeature['edgeBands'] {
  const empty = { front: null, back: null, left: null, right: null } as const;
  if (bandId === null) return empty;
  if (role === 'leftSide' || role === 'rightSide' || role === 'bottom' || role === 'top' || role === 'shelf') {
    return { front: { materialId: bandId }, back: null, left: null, right: null };
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

function validate(params: BaseCabinetParams, materials: ResolvedCabinetMaterials): void {
  const Tc = materials.carcass.defaultThickness;
  if (params.name.trim() === '') throw new CabinetTemplateError({ kind: 'nameEmpty' });
  if (params.width <= 2 * Tc) throw new CabinetTemplateError({ kind: 'widthTooSmall', minDimension: 2 * Tc });
  if (params.depth <= 2 * Tc) throw new CabinetTemplateError({ kind: 'depthTooSmall', minDimension: 2 * Tc });
  if (params.height <= 2 * Tc + params.toekickHeight) throw new CabinetTemplateError({ kind: 'heightTooSmall' });
  if (params.toekickHeight >= params.height / 2) throw new CabinetTemplateError({ kind: 'toekickHeightTooLarge' });
  if (params.toekickSetback >= params.depth - Tc) throw new CabinetTemplateError({ kind: 'toekickSetbackTooLarge' });
  const innerH = params.height - params.toekickHeight - 2 * Tc;
  const maxShelves = Math.max(0, Math.floor(innerH / 100));
  if (params.shelfCount > maxShelves) {
    throw new CabinetTemplateError({ kind: 'shelfCountTooLarge', maxShelves });
  }
}
