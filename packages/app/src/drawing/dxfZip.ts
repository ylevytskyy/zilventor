import { zipSync, strToU8 } from 'fflate';

/** Packs a set of named DXF strings into a single .zip (synchronous, in-memory). */
export function buildDxfZip(entries: Record<string, string>): Uint8Array {
  const data: Record<string, Uint8Array> = {};
  for (const [name, dxf] of Object.entries(entries)) {
    // Wrap in new Uint8Array to ensure same-realm typed array (guards jsdom cross-realm instanceof check)
    data[name] = new Uint8Array(strToU8(dxf));
  }
  return zipSync(data);
}
