import type { Feature } from '@zilventor/shared';

/**
 * The canonical 7 origin work-geometry features that every part document
 * starts with. Shared between the Inventor importer (buildPartDocument)
 * and the stand-alone STEP importer (importStepIntoNewPart).
 */
export const ORIGIN_FEATURES: ReadonlyArray<Feature> = [
  { kind: 'workAxis',  id: 'origin.X',  visible: false, source: { mode: 'origin', axis: 'X' } },
  { kind: 'workAxis',  id: 'origin.Y',  visible: false, source: { mode: 'origin', axis: 'Y' } },
  { kind: 'workAxis',  id: 'origin.Z',  visible: false, source: { mode: 'origin', axis: 'Z' } },
  { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
  { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
  { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
  { kind: 'workPoint', id: 'origin.O',  visible: false, source: { mode: 'origin' } },
];

/**
 * Strips a trailing `.step` or `.stp` (case-insensitive) from a path or filename,
 * returning the basename. Used to derive the part name from a STEP file.
 */
export function stepFilenameBasename(input: string): string {
  const leaf = input.split('/').pop() ?? input;
  return leaf.replace(/\.(step|stp)$/i, '');
}
