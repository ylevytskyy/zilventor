import type { MaterialId } from '../material';
import type { GrainDirection } from '../panel-feature';

export interface PlacedPanel {
  readonly itemNumber: number;
  readonly rowKey: string;
  readonly instanceIndex: number;
  readonly x: number;
  readonly y: number;
  readonly length: number;
  readonly width: number;
  readonly rotated: boolean;
  readonly grain: GrainDirection;
  /** Cosmetic flip marker. Never set by the packer — only ever set later by the P7 editor. */
  readonly mirrored?: boolean;
}

export interface NestSheet {
  readonly materialId: MaterialId;
  readonly sheetIndex: number;
  readonly sheetLengthMm: number;
  readonly sheetWidthMm: number;
  readonly panels: readonly PlacedPanel[];
  readonly utilizationPct: number;
  /** Largest leftover free rectangle on the sheet, if any (>= 100mm in both dimensions). */
  readonly remnant?: { readonly x: number; readonly y: number; readonly length: number; readonly width: number };
  /** Set only by the P7 edit command when a user manually repositions a panel. */
  readonly manuallyEdited?: boolean;
}

export type NestExclusionReason = 'no-sheet-stock' | 'panel-exceeds-sheet' | 'grain-locked-exceeds-sheet';

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
