import type { PanelRole } from './cabinets/types';

export type ClashKind = 'interference' | 'clearance';

export interface ClashPair {
  aIndex: number;
  bIndex: number;
  kind: ClashKind;
  volume?: number;   // mm³, interference only
  distance?: number; // mm, clearance only
}

export interface ClashLeafMeta {
  componentPath: readonly string[];
  componentPathKey: string;
  partName: string;
  /** Carcass/furniture role — populated from ComponentInstance.role via the export-leaf pipeline. */
  role?: string;
}

/** The role union as it appears on ComponentInstance.role (mirror of types.ts:125). */
type ComponentRole = PanelRole | 'drawerFront' | 'drawerBox' | 'drawerHandle';

/**
 * Exhaustive carcass/non-carcass classification of every ComponentInstance role.
 * Keyed by the full role union (the Record<Union,…> exhaustiveness idiom, like
 * CONNECTOR_BOM_CATALOG) so adding a new PanelRole without classifying it here is
 * a COMPILE ERROR. `true` = purely structural carcass panel that overlaps by
 * construction in the flat-slab cabinet model (no rotation); `false` =
 * movable/hardware whose clashes with carcass panels can be real and are kept.
 */
const ROLE_IS_CARCASS: Record<ComponentRole, boolean> = {
  leftSide: true,
  rightSide: true,
  top: true,
  bottom: true,
  back: true,
  toekick: true,
  shelf: true,
  door: false,
  drawerFront: false,
  drawerBox: false,
  'drawerBox-side': false,
  'drawerBox-front': false,
  'drawerBox-back': false,
  'drawerBox-bottom': false,
  drawerHandle: false,
  faceFrameStile: false,
  faceFrameRail: false,
};

/**
 * The structural carcass roles, derived from the exhaustive classification above.
 * Pairs where BOTH leaves have a role in this set AND share the same immediate
 * parent sub-assembly are suppressed as expected structural noise.
 */
export const CARCASS_ROLES: ReadonlySet<string> = new Set(
  Object.entries(ROLE_IS_CARCASS)
    .filter(([, isCarcass]) => isCarcass)
    .map(([role]) => role),
);

/**
 * Returns true if a clash pair should be suppressed as expected structural noise.
 *
 * Suppression rule — suppress IFF ALL of:
 *   (1) both leaves have a role AND both roles are in CARCASS_ROLES, AND
 *   (2) both componentPath arrays have length >= 2 (nested inside a sub-assembly), AND
 *   (3) their prefixes (all elements except the last) are deep-equal — i.e. same immediate
 *       parent sub-assembly, meaning same cabinet.
 *
 * Any cross-cabinet pair, absent-role pair, top-level pair, or pair involving
 * a door/drawer/handle is kept (returns false).
 */
export function isSameCabinetCarcassNoise(a: ClashLeafMeta, b: ClashLeafMeta): boolean {
  // (1) Both must have a role in CARCASS_ROLES
  if (!a.role || !b.role) return false;
  if (!CARCASS_ROLES.has(a.role) || !CARCASS_ROLES.has(b.role)) return false;

  // (2) Both must be nested (path length >= 2)
  if (a.componentPath.length < 2 || b.componentPath.length < 2) return false;

  // (3) Same immediate parent (prefix = all but last element)
  const aPrefix = a.componentPath.slice(0, -1);
  const bPrefix = b.componentPath.slice(0, -1);
  if (aPrefix.length !== bPrefix.length) return false;
  for (let i = 0; i < aPrefix.length; i++) {
    if (aPrefix[i] !== bPrefix[i]) return false;
  }

  return true;
}

export interface ClashReportRow {
  aPathKey: string;
  bPathKey: string;
  /** ComponentPath arrays needed for setSelectedComponentPaths (SC-7) */
  aPath: string[];
  bPath: string[];
  aName: string;
  bName: string;
  kind: ClashKind;
  volume?: number;
  distance?: number;
}

/**
 * Internal constant — NOT user-facing. Volume in mm³ below which a
 * Common() result is treated as face-touching rather than real interference.
 * SC-10: this value is grounded by the real-OCCT touching-face test.
 */
export const VOLUME_THRESHOLD_MM3 = 1.0;

/** Default minimum clearance (mm) shown in the dialog. */
export const CLEARANCE_DEFAULT_MM = 1.0;

/**
 * Pure mapper from ClashPair[] + leaf metadata to display rows.
 * Does NOT classify — classification is done by checkInterference in the kernel.
 * SC-7: each row carries both ComponentPath (for setSelectedComponentPaths) and
 * ComponentPathKey (for getComponentMesh/setClashHighlight).
 */
export function buildClashReport(
  pairs: ClashPair[],
  leafMeta: readonly ClashLeafMeta[],
): ClashReportRow[] {
  return pairs.map((pair) => {
    const a = leafMeta[pair.aIndex]!;
    const b = leafMeta[pair.bIndex]!;
    const row: ClashReportRow = {
      aPathKey: a.componentPathKey,
      bPathKey: b.componentPathKey,
      aPath: [...a.componentPath],
      bPath: [...b.componentPath],
      aName: a.partName,
      bName: b.partName,
      kind: pair.kind,
    };
    if (pair.volume !== undefined) row.volume = pair.volume;
    if (pair.distance !== undefined) row.distance = pair.distance;
    return row;
  });
}
