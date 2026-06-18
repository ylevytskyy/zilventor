import type { PanelFeature } from '../panel-feature';
import type { MaterialEntry, MaterialId } from '../material';

export type PanelRole =
  | 'leftSide'
  | 'rightSide'
  | 'bottom'
  | 'top'
  | 'back'
  | 'toekick'
  | 'hangingRail'
  | 'cornerPost'
  | 'shelf'
  | 'door'
  | 'drawerFront'
  | 'drawerBox-side'
  | 'drawerBox-front'
  | 'drawerBox-back'
  | 'drawerBox-bottom'
  | 'faceFrameStile'
  | 'faceFrameRail';

/**
 * Cabinet body type. 'base' (default when absent) is a floor-standing carcass
 * with a toekick; 'wall' is a hung upper (no toekick, with a top-back hanging
 * rail); 'tall' is a full-height carcass that is structurally identical to a
 * base cabinet — it differs only by dimension presets applied at the UI layer.
 */
export type CabinetType = 'base' | 'wall' | 'tall';

export interface BaseCabinetParams {
  readonly name: string;
  readonly cabinetType?: CabinetType;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly toekickHeight: number;
  readonly toekickSetback: number;
  readonly shelfCount: number;
  readonly carcassMaterialId: MaterialId;
  readonly backMaterialId: MaterialId;
  readonly bandMaterialId: MaterialId | null;
}

export type WallCabinetParams = BaseCabinetParams & { readonly cabinetType: 'wall' };
export type TallCabinetParams = BaseCabinetParams & { readonly cabinetType: 'tall' };

/**
 * L-corner cabinet (slice 1: no blind/diagonal door). Two legs meet at a shared
 * corner: leg 1 runs along +X with length `width1` and depth `depth1` (into the
 * room on Y); leg 2 runs along +Y with length `width2` and depth `depth2` (into
 * the room on X). The reentrant inner corner sits at (depth2, depth1) and carries
 * a full-height corner post. No toekick in slice 1 (the bottom seats at Z=0).
 */
export interface CornerCabinetParams {
  readonly name: string;
  readonly width1: number;
  readonly depth1: number;
  readonly width2: number;
  readonly depth2: number;
  readonly height: number;
  readonly carcassMaterialId: MaterialId;
  readonly backMaterialId: MaterialId;
  readonly bandMaterialId: MaterialId | null;
}

export interface CabinetPanelDef {
  readonly role: PanelRole;
  readonly shelfIndex?: number;
  readonly fileNameSuffix: string;
  readonly panel: PanelFeature;
}

export interface CabinetComponentDef {
  readonly fileNameSuffix: string;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly rotation: { readonly rx: number; readonly ry: number; readonly rz: number };
}

export interface CabinetBuildOutput {
  readonly panels: ReadonlyArray<CabinetPanelDef>;
  readonly layout: ReadonlyArray<CabinetComponentDef>;
}

export type CabinetTemplateErrorKind =
  | 'nameEmpty'
  | 'widthTooSmall'
  | 'depthTooSmall'
  | 'heightTooSmall'
  | 'toekickHeightTooLarge'
  | 'toekickSetbackTooLarge'
  | 'shelfCountTooLarge'
  | 'cornerWidthTooSmall'
  | 'cornerDepthTooSmall'
  | 'cornerLegTooShort'
  | 'carcassMaterialMissing'
  | 'backMaterialMissing';

export interface CabinetTemplateErrorDetails {
  readonly kind: CabinetTemplateErrorKind;
  readonly maxShelves?: number;
  readonly minDimension?: number;
}

export class CabinetTemplateError extends Error {
  readonly kind: CabinetTemplateErrorKind;
  readonly details: CabinetTemplateErrorDetails;
  constructor(details: CabinetTemplateErrorDetails) {
    super(`CabinetTemplateError: ${details.kind}`);
    this.name = 'CabinetTemplateError';
    this.kind = details.kind;
    this.details = details;
  }
}

export interface ResolvedCabinetMaterials {
  readonly carcass: MaterialEntry;
  readonly back: MaterialEntry;
  readonly band: MaterialEntry | null;
}
