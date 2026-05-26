// packages/app/src/drawing/loadDrawingSource.ts
/**
 * Load a drawing's source part into the kernel and return the kernel part id
 * plus a content-based fingerprint of the source bytes.
 *
 * Called by CreateDrawingCommand.apply() immediately after creating the drawing.
 * Mirrors the assembly leaf-load pattern at App.tsx:3187-3189.
 *
 * Returns:
 *   partId           — kernel UUID from loadFromBytes (used by getProjectorInput).
 *   sourceFingerprint — djb2 hash of the raw OPFS bytes. Changes when the source
 *                       .zipt file changes → used by projectViewFromSource as
 *                       inputFingerprint and by the B5 staleness effect.
 *                       A kernel UUID is stable per-session, so hashing it would
 *                       NEVER detect edits — bytes are the correct content detector.
 *
 * Cache: module-level Map<partPath, { partId, sourceFingerprint }>. Keyed by OPFS
 * path so the same part opened N times in a session is only loaded once PER ACTIVATION
 * PASS. The cache must be cleared between drawing activations to pick up edits.
 * Use _clearLoadDrawingSourceCache() in tests; CreateDrawingCommand clears it on each apply().
 *
 * Fallback (test-fixture path): when OPFS read fails and partPath stem matches activePartId,
 * the part is already in the kernel. Returns { partId: activePartId, sourceFingerprint: djb2(activePartId) }.
 * The djb2(partId) fingerprint is acceptable ONLY here — real OPFS reads must hash bytes.
 */

/** djb2 over a string — browser-safe, synchronous. */
function djb2Str(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** djb2 over a Uint8Array — treats each byte as an unsigned integer. */
function djb2Bytes(bytes: Uint8Array): string {
  let h = 5381;
  for (let i = 0; i < bytes.length; i++) {
    h = ((h << 5) + h) ^ bytes[i]!;
    h = h >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export type LoadDrawingSourceResult = {
  /** Kernel UUID from loadFromBytes — pass to getProjectorInput({ kind: 'part', partId }). */
  partId: string;
  /** djb2 hash of raw OPFS bytes (REAL path) or djb2 of partId (fallback test path only).
   *  Changes whenever the source .zipt file changes → staleness detection is reliable. */
  sourceFingerprint: string;
};

const cache = new Map<string, LoadDrawingSourceResult>(); // partPath → result

export type KernelForLoad = {
  loadFromBytes(bytes: Uint8Array): Promise<string>;
  execute(partId: string): Promise<{ ok: boolean; value?: unknown; error?: unknown }>;
};

export type OpfsForLoad = {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<Uint8Array>;
};

export type LoadDrawingSourceArgs = {
  partPath: string;
  kernel: KernelForLoad;
  opfs: OpfsForLoad;
  /** Kernel id of the currently-active part (if any), used as fallback when OPFS read fails. */
  activePartId?: string | undefined;
};

export async function loadDrawingSource(args: LoadDrawingSourceArgs): Promise<LoadDrawingSourceResult> {
  const { partPath, kernel, opfs, activePartId } = args;

  // Cache hit: already loaded this activation pass
  const cached = cache.get(partPath);
  if (cached !== undefined) return cached;

  try {
    // REAL PATH: hash bytes for a content-based fingerprint, then load into kernel.
    const bytes = await opfs.read(partPath);
    const sourceFingerprint = djb2Bytes(bytes);  // changes on any source edit
    const partId = await kernel.loadFromBytes(bytes);
    const res = await kernel.execute(partId);
    if (!res.ok) {
      throw new Error(`kernel.execute failed: ${String((res as { error?: unknown }).error)}`);
    }
    const result: LoadDrawingSourceResult = { partId, sourceFingerprint };
    cache.set(partPath, result);
    return result;
  } catch (opfsErr) {
    // FALLBACK (test-fixture path): source.partPath = `${partId}.zipt` where partId is a
    // kernel UUID already in the cache (no real OPFS file). The part geometry is warm.
    // Fingerprint is djb2 of the partId — acceptable ONLY here since fixtures don't exercise
    // real edits. Real OPFS reads always hash bytes (above).
    const stem = partPath.replace(/\.[^.]+$/, '');
    if (activePartId && stem === activePartId) {
      const result: LoadDrawingSourceResult = {
        partId: activePartId,
        sourceFingerprint: djb2Str(activePartId),  // synthetic; test-fixture path only
      };
      cache.set(partPath, result);
      return result;
    }
    throw new Error(`OPFS_READ_FAILED: cannot load source part "${partPath}": ${String(opfsErr)}`);
  }
}

/** Exposed for testing + for CreateDrawingCommand to clear stale cache between activations. */
export function _clearLoadDrawingSourceCache(): void {
  cache.clear();
}
