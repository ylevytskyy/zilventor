export type HardwareCategory =
  | 'hinges'
  | 'shelfPins'
  | 'drawerHandles'
  | 'drawerSlides'
  | 'legLevelers'
  | 'softCloseHinges';

export type HardwareRegistry = readonly HardwareEntry[];

export interface HardwareEntry {
  readonly id: string;
  readonly name: string;
  readonly category: HardwareCategory;
  readonly vendor: string;
  readonly notes: string;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface AttachPoint {
  readonly name: string;
  readonly position: Vec3;
  readonly normal?: Vec3;
}

export interface HardwareFeature {
  readonly kind: 'hardware';
  readonly id: string;
  readonly hardwareSkuId: string;
  readonly bboxMm: { readonly l: number; readonly w: number; readonly h: number };
  readonly attachPoints: readonly AttachPoint[];
}

export interface LegLevelerSpec {
  readonly screwCount: 4;
  readonly patternW: number;   // square pattern width  (mm)
  readonly patternD: number;   // square pattern depth  (mm)
  readonly screwDiameter: number; // mm
  readonly screwDepth: number;    // mm
}

export function isHardwareFeature(f: unknown): f is HardwareFeature {
  return (
    f !== null &&
    typeof f === 'object' &&
    (f as Record<string, unknown>).kind === 'hardware'
  );
}
