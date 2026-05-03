import type { PanelFeature } from '../panel-feature';
import type { MaterialEntry, MaterialId } from '../material';

export type PanelRole =
  | 'leftSide'
  | 'rightSide'
  | 'bottom'
  | 'top'
  | 'back'
  | 'toekick'
  | 'shelf';

export interface BaseCabinetParams {
  readonly name: string;
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
