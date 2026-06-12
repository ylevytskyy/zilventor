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
