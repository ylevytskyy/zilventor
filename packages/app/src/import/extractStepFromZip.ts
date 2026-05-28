import { unzipSync } from 'fflate';

export type ExtractedStep = {
  /** The basename of the STEP entry inside the archive (e.g. 'Cadeira_preta.stp'). */
  fileName: string;
  /** Raw STEP bytes. */
  stepBytes: ArrayBuffer;
};

/**
 * Pure: searches a ZIP archive for the first .step/.stp entry (case-insensitive,
 * nested directories OK) and returns its bytes + basename. Returns null if no
 * STEP entry exists.
 *
 * Throws on a malformed zip (fflate's own InvalidZipError propagates).
 */
export function extractStepFromZip(zipBytes: Uint8Array): ExtractedStep | null {
  const entries = unzipSync(zipBytes);
  // Object key iteration order in modern JS = insertion order, which mirrors
  // central-directory order in fflate's output → deterministic.
  for (const [path, bytes] of Object.entries(entries)) {
    if (/\.(step|stp)$/i.test(path)) {
      const fileName = path.split('/').pop() ?? path;
      // Copy into a fresh ArrayBuffer — bytes.buffer is typed ArrayBuffer | SharedArrayBuffer
      // under stricter lib typings, and the caller's contract requires plain ArrayBuffer.
      const buf = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buf).set(bytes);
      return { fileName, stepBytes: buf };
    }
  }
  return null;
}
