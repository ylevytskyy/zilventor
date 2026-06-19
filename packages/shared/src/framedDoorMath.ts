/**
 * framedDoorMath — shaker (rail + stile + center-panel) door frame sizing.
 *
 * A shaker door is a 5-member frame: two vertical stiles running the full door
 * height, two horizontal rails spanning the gap between the stiles, and a
 * center panel filling the inner opening. Butt-jointed (no groove tongue at
 * this slice — the groove rebate is added separately by the raised-panel path).
 *
 * Dims convention mirrors doorMath's DoorPanel: dims.length = the member's
 * vertical (height) extent, dims.width = its horizontal extent.
 *
 *   outer doorW × doorH, frame member width f:
 *     stiles      → length doorH,           width f
 *     rails       → length f,               width doorW − 2f
 *     centerPanel → length doorH − 2f,      width doorW − 2f
 */

export interface ShakerInput {
  doorW: number; // overall door width
  doorH: number; // overall door height
  thickness: number; // frame thickness (Td)
  frameWidth: number; // rail & stile width
  /** center-panel thickness; defaults to the frame thickness. */
  panelThickness?: number;
}

export type ShakerPartRole = 'doorStile' | 'doorRail' | 'doorCenterPanel';

type Vec3 = { x: number; y: number; z: number };
type Quaternion = [number, number, number, number];

export interface ShakerPart {
  role: ShakerPartRole;
  /** true for the left stile, false for the right; only set on stiles. */
  isLeft?: boolean;
  /** true for the top rail, false for the bottom; only set on rails. */
  isTop?: boolean;
  dims: { length: number; width: number; thickness: number };
  /** Pose in the door's part-local frame (origin = door center on the back
   *  face; part-X = vertical/height, part-Y = horizontal/width, part-Z =
   *  thickness). Quaternion is identity for every member because each member's
   *  dims convention already matches the door-part axes; only the translation
   *  differs. translation = memberCentroid − R·(0,0,T/2) = memberCentroid −
   *  (0,0,T/2) for the identity R. */
  pose: { translation: Vec3; quaternion: Quaternion };
}

export interface ShakerResult {
  parts: ShakerPart[];
  outer: { width: number; height: number; thickness: number };
}

export function computeShakerParts(input: ShakerInput): ShakerResult {
  const { doorW, doorH, thickness: Td, frameWidth: f } = input;
  const panelTd = input.panelThickness ?? Td;

  const innerW = doorW - 2 * f; // horizontal span between the two stiles
  const innerH = doorH - 2 * f; // vertical span between the two rails

  const IDENTITY: Quaternion = [0, 0, 0, 1];
  // Each member centroid in the door-part frame minus the part-Z thickness/2
  // offset (centroid_part = (0,0,T/2) → world offset (0,0,T/2) under identity R).
  // For full-thickness members (Tm = Td) the Z translation is 0; a thinner
  // center panel is recessed to the door mid-plane: z = (Td − panelTd) / 2.
  const railZ = 0; // Tm = Td
  const stileZ = 0; // Tm = Td
  const panelZ = (Td - panelTd) / 2;

  const parts: ShakerPart[] = [
    {
      role: 'doorStile',
      isLeft: true,
      dims: { length: doorH, width: f, thickness: Td },
      pose: { translation: { x: 0, y: -(doorW - f) / 2, z: stileZ }, quaternion: IDENTITY },
    },
    {
      role: 'doorStile',
      isLeft: false,
      dims: { length: doorH, width: f, thickness: Td },
      pose: { translation: { x: 0, y: (doorW - f) / 2, z: stileZ }, quaternion: IDENTITY },
    },
    {
      role: 'doorRail',
      isTop: false,
      dims: { length: f, width: innerW, thickness: Td },
      pose: { translation: { x: -(doorH - f) / 2, y: 0, z: railZ }, quaternion: IDENTITY },
    },
    {
      role: 'doorRail',
      isTop: true,
      dims: { length: f, width: innerW, thickness: Td },
      pose: { translation: { x: (doorH - f) / 2, y: 0, z: railZ }, quaternion: IDENTITY },
    },
    {
      role: 'doorCenterPanel',
      dims: { length: innerH, width: innerW, thickness: panelTd },
      pose: { translation: { x: 0, y: 0, z: panelZ }, quaternion: IDENTITY },
    },
  ];

  return { parts, outer: { width: doorW, height: doorH, thickness: Td } };
}
