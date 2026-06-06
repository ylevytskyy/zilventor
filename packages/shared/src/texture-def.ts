/** A PBR texture set definition. URLs are relative to the app's public root (served by Vite). */
export interface TextureDef {
  readonly id: string;
  readonly name: string;
  /** Albedo (base color) map URL. Always required. */
  readonly albedoUrl: string;
  /** Normal map URL (optional). */
  readonly normalUrl?: string;
  /** Roughness map URL (optional). */
  readonly roughnessUrl?: string;
  /** Physical width the image spans in the real world, in millimeters.
   *  Used to compute Three.js texture.repeat: repeat.x = 1 / physicalWidthMm. */
  readonly physicalWidthMm: number;
  /** Physical height the image spans in the real world, in millimeters.
   *  Used to compute Three.js texture.repeat: repeat.y = 1 / physicalHeightMm. */
  readonly physicalHeightMm: number;
}

/**
 * Built-in texture library sourced from ambientCG (CC0 1.0).
 * Files live under `packages/app/public/textures/<id>/`.
 * Physical dimensions derived from ambientCG API `dimensionX`/`dimensionY` (meters × 1000 = mm).
 * Assets with no API dimension data default to 1000 × 1000 mm.
 *
 * Asset provenance:
 *   oak            → ambientCG Wood063  (brown/orange warm wood)
 *   walnut         → ambientCG Wood038  (dark rough wood)
 *   beech          → ambientCG Wood049  (pale natural oak-like wood)
 *   white-melamine → ambientCG Concrete014 (clean light smooth surface)
 *   black-melamine → ambientCG Concrete015 (clean dark smooth surface)
 *   laminate-light → ambientCG Wood048  (light plain smooth wood)
 */
export const BUILTIN_TEXTURE_DEFS: readonly TextureDef[] = [
  { id: 'oak', name: 'Oak', albedoUrl: '/textures/oak/albedo.jpg', normalUrl: '/textures/oak/normal.jpg', roughnessUrl: '/textures/oak/roughness.jpg', physicalWidthMm: 1000, physicalHeightMm: 1000 },
  { id: 'walnut', name: 'Walnut', albedoUrl: '/textures/walnut/albedo.jpg', normalUrl: '/textures/walnut/normal.jpg', roughnessUrl: '/textures/walnut/roughness.jpg', physicalWidthMm: 1000, physicalHeightMm: 1000 },
  { id: 'beech', name: 'Beech', albedoUrl: '/textures/beech/albedo.jpg', normalUrl: '/textures/beech/normal.jpg', roughnessUrl: '/textures/beech/roughness.jpg', physicalWidthMm: 800, physicalHeightMm: 800 },
  { id: 'white-melamine', name: 'White Melamine', albedoUrl: '/textures/white-melamine/albedo.jpg', physicalWidthMm: 1000, physicalHeightMm: 1000 },
  { id: 'black-melamine', name: 'Black Melamine', albedoUrl: '/textures/black-melamine/albedo.jpg', physicalWidthMm: 1000, physicalHeightMm: 1000 },
  { id: 'laminate-light', name: 'Laminate Light', albedoUrl: '/textures/laminate-light/albedo.jpg', normalUrl: '/textures/laminate-light/normal.jpg', roughnessUrl: '/textures/laminate-light/roughness.jpg', physicalWidthMm: 800, physicalHeightMm: 800 },
];

/** Look up a TextureDef by id. Returns `undefined` if not found. */
export function findTextureDef(id: string): TextureDef | undefined {
  return BUILTIN_TEXTURE_DEFS.find((d) => d.id === id);
}
