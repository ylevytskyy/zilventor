import type { MaterialId } from '../material';
import type { GrainDirection } from '../panel-feature';

export interface NestInputRow {
  readonly itemNumber: number;
  readonly rowKey: string;
  readonly qty: number;
  readonly length: number;
  readonly width: number;
  readonly materialId: MaterialId;
  readonly grain: GrainDirection;
  /** Per-cut oversize allowance (mm) added to net length/width before packing. */
  readonly oversize?: { readonly lengthMm: number; readonly widthMm: number };
}
