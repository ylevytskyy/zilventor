/** A user-uploaded PBR texture set persisted into the project file.
 *  Blob ids point at `textures/<blobId>.jpg` tar entries (uniform JPEG). */
export interface CustomTextureDef {
  readonly id: string;            // 'custom-<ulid>'
  readonly name: string;
  readonly physicalWidthMm: number;
  readonly physicalHeightMm: number;
  readonly albedoBlobId: string;
  readonly normalBlobId?: string;
  readonly roughnessBlobId?: string;
}

function isPositiveFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export function isCustomTextureDef(v: unknown): v is CustomTextureDef {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  if (!isNonEmptyString(d.id) || !isNonEmptyString(d.name)) return false;
  if (!isPositiveFinite(d.physicalWidthMm) || !isPositiveFinite(d.physicalHeightMm)) return false;
  if (!isNonEmptyString(d.albedoBlobId)) return false;
  if (d.normalBlobId !== undefined && !isNonEmptyString(d.normalBlobId)) return false;
  if (d.roughnessBlobId !== undefined && !isNonEmptyString(d.roughnessBlobId)) return false;
  return true;
}
