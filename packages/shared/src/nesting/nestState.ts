import type { MaterialId } from '../material';

export interface PlacedPanel {
  readonly itemNumber: number;
  readonly rowKey: string;
  readonly x: number;
  readonly y: number;
  readonly length: number;
  readonly width: number;
  readonly rotated: boolean;
}

export interface NestSheet {
  readonly materialId: MaterialId;
  readonly sheetIndex: number;
  readonly sheetLengthMm: number;
  readonly sheetWidthMm: number;
  readonly panels: readonly PlacedPanel[];
  readonly utilizationPct: number;
}

export type NestExclusionReason = 'no-sheet-stock' | 'panel-exceeds-sheet';

export interface NestExclusion {
  readonly materialId: MaterialId;
  readonly reason: NestExclusionReason;
  readonly itemNumbers: readonly number[];
}

export interface NestState {
  readonly params: {
    readonly kerfMm: number;
    readonly oversize?: { readonly lengthMm: number; readonly widthMm: number };
  };
  readonly generatedAt: number;
  readonly inputFingerprint: string;
  readonly sheets: readonly NestSheet[];
  readonly excluded: readonly NestExclusion[];
}
