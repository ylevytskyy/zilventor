/**
 * Forward AutoCAD Color Index (ACI) -> 0xRRGGBB.
 * Returns undefined for ACI 0 (BYBLOCK), 7 (white/foreground), 256 (BYLAYER),
 * and any unmapped index -> caller uses the renderer's native default colour.
 * Only the deterministic common colours are mapped; full 256-entry palette deferred.
 */
const ACI_RGB: Readonly<Record<number, number>> = {
  1: 0xff0000, 2: 0xffff00, 3: 0x00ff00, 4: 0x00ffff,
  5: 0x0000ff, 6: 0xff00ff, 8: 0x808080, 9: 0xc0c0c0,
  30: 0xff7f00, 40: 0x804000,
  250: 0x333333, 251: 0x4d4d4d, 252: 0x666666, 253: 0x808080, 254: 0x999999, 255: 0xb3b3b3,
};

export function aciToRgb(aci: number): number | undefined {
  if (aci === 0 || aci === 7 || aci === 256) return undefined;
  return ACI_RGB[aci];
}
