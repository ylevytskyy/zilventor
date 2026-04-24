import type { FaceName, TessellatedFace } from '@zilventor/shared';

/**
 * Maps a raycast hit (triangle index into the combined Mesh.indices
 * array, in units of triangles) to the FaceName of the face that owns
 * that triangle. Uses binary search into the sorted-by-triangleStart
 * `TessellatedFace[]` produced by `tessellateFaces`.
 *
 * The kernel emits ranges in ascending triangleStart order (same walk
 * as `tessellate`'s face enumeration), so binary search is safe
 * without an explicit re-sort.
 */
export class FacePickController {
  private faces: TessellatedFace[] = [];

  setCandidates(faces: TessellatedFace[]): void {
    // Defensive copy + sort by triangleStart in case upstream ever changes
    // ordering semantics.
    this.faces = [...faces].sort((a, b) => a.triangleStart - b.triangleStart);
  }

  /**
   * Look up the FaceName whose triangle range contains `triangleIndex`.
   * Returns null when the index falls outside every known range (e.g.
   * unnamed face triangles, or a stale mesh).
   */
  pickByTriangleIndex(triangleIndex: number): FaceName | null {
    if (this.faces.length === 0) return null;
    let lo = 0;
    let hi = this.faces.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const f = this.faces[mid]!;
      if (triangleIndex < f.triangleStart) {
        hi = mid - 1;
      } else if (triangleIndex >= f.triangleStart + f.triangleCount) {
        lo = mid + 1;
      } else {
        return f.name;
      }
    }
    return null;
  }
}
