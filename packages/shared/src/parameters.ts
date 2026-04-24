export type ParameterUnit = 'mm' | 'deg';

export type SketchParameter = {
  name: string;        // e.g., 'd0', 'width', 'cabinetHeight'
  expression: string;  // e.g., '50', 'd0 / 2', '2 * width + 10'
  value: number;       // cached computed value (recalculated by ParameterRegistry)
  unit: ParameterUnit;
};
