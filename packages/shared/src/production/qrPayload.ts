export interface ParsedQrPayload {
  itemNumber: number;
  copyIndex: number;
  qty: number;
  length: number;
  width: number;
  thickness: number;
  materialName: string;
}

// Matches the encoder in packages/app/src/drawing/buildPanelLabels.ts:
// `Z|${itemNumber}|${copyIndex}/${qty}|${length}x${width}x${thickness}|${materialName}`
// Dimensions may be non-integer (decimal mm), so digits accept an optional fractional part.
const QR_PAYLOAD_RE =
  /^Z\|(\d+)\|(\d+)\/(\d+)\|(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)\|(.+)$/;

/** Parse a shop-label QR payload; returns null (never throws) on any mismatch. */
export function parseQrPayload(payload: string): ParsedQrPayload | null {
  const match = QR_PAYLOAD_RE.exec(payload);
  if (!match) return null;
  const [, itemNumber, copyIndex, qty, length, width, thickness, materialName] = match;
  return {
    itemNumber: Number(itemNumber),
    copyIndex: Number(copyIndex),
    qty: Number(qty),
    length: Number(length),
    width: Number(width),
    thickness: Number(thickness),
    materialName: materialName!,
  };
}

/** Key into AssemblyDocument.producedPanels for a given physical panel copy. */
export function producedPanelKey(itemNumber: number, copyIndex: number): string {
  return `${itemNumber}:${copyIndex}`;
}
