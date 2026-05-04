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
}
