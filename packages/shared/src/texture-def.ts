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
 * Built-in texture library.
 * URLs are stubs until Task 11 places the actual CC0 asset files under
 * `packages/app/public/textures/`. physicalWidthMm/physicalHeightMm values
 * must be updated to match the real-world size of the sourced images.
 */
export const BUILTIN_TEXTURE_DEFS: readonly TextureDef[] = [
  { id: 'oak', name: 'Oak', albedoUrl: '/textures/oak/albedo.jpg', normalUrl: '/textures/oak/normal.png', roughnessUrl: '/textures/oak/roughness.png', physicalWidthMm: 400, physicalHeightMm: 400 },
  { id: 'walnut', name: 'Walnut', albedoUrl: '/textures/walnut/albedo.jpg', normalUrl: '/textures/walnut/normal.png', roughnessUrl: '/textures/walnut/roughness.png', physicalWidthMm: 400, physicalHeightMm: 400 },
  { id: 'beech', name: 'Beech', albedoUrl: '/textures/beech/albedo.jpg', normalUrl: '/textures/beech/normal.png', roughnessUrl: '/textures/beech/roughness.png', physicalWidthMm: 400, physicalHeightMm: 400 },
  { id: 'white-melamine', name: 'White Melamine', albedoUrl: '/textures/white-melamine/albedo.jpg', physicalWidthMm: 400, physicalHeightMm: 400 },
  { id: 'black-melamine', name: 'Black Melamine', albedoUrl: '/textures/black-melamine/albedo.jpg', physicalWidthMm: 400, physicalHeightMm: 400 },
  { id: 'laminate-light', name: 'Laminate Light', albedoUrl: '/textures/laminate-light/albedo.jpg', normalUrl: '/textures/laminate-light/normal.png', roughnessUrl: '/textures/laminate-light/roughness.png', physicalWidthMm: 400, physicalHeightMm: 400 },
];

/** Look up a TextureDef by id. Returns `undefined` if not found. */
export function findTextureDef(id: string): TextureDef | undefined {
  return BUILTIN_TEXTURE_DEFS.find((d) => d.id === id);
}
