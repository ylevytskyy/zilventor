/** Single source of truth for drawer-bank geometry (присадка slice 4). */
export const SLIDE_CLEARANCE_PER_SIDE = 12.5; // mm box side ↔ cabinet side
export const BOX_PANEL_THICKNESS = 16;
export const BOX_BOTTOM_THICKNESS = 12;
export const BOX_VERT_CLEARANCE = 12; // box height inset within its slot (top+bottom each)
export const BOX_BACK_CLEARANCE = 10; // box stops short of cabinet back
export const DRAWER_FRONT_GAP = 3; // gap between adjacent fronts (no collision)
export const DRAWER_FRONT_THICKNESS = 18;
export const SLIDE_GRID_PITCH = 32; // Система-32
export const DRAWER_SLIDE_FRONT_SETBACK = 37; // first hole offset from front edge
export const DRAWER_SLIDE_HOLE_DIAMETER = 5;
export const DRAWER_SLIDE_HOLE_DEPTH = 12; // blind into 16mm wall
export const DRAWER_SLIDE_MIN_HOLES = 2; // ≥2 holes per side
/** full overlay overhang covers a carcass panel of thickness Tc; half = Tc/2; inset = 0. */
export function overlayOverhang(overlay: 'full' | 'half' | 'inset', Tc: number): number {
  return overlay === 'full' ? Tc : overlay === 'half' ? Tc / 2 : 0;
}
