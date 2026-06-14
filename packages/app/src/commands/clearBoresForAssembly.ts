/**
 * clearBoresForAssembly — recursive OPFS walk to collect panel docs with bores.
 *
 * Used by FurnitureTab's "Clear Присадку" button to find all .zipt panels that
 * have non-empty bores[], including those nested inside .ziasm sub-assemblies.
 *
 * Returns one entry per panel path that has at least one BoreOp.
 */

import type { AssemblyDocument, BoreOp } from '@zilventor/shared';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';

type OpfsReader = { read(p: string): Promise<Uint8Array> };

export type BoreDocEntry = {
  partPath: string;
  doc: { bores?: BoreOp[] };
};

/**
 * Recursively walks an AssemblyDocument and returns one BoreDocEntry per
 * .zipt panel that has a non-empty bores[].
 *
 * Skips:
 *   - .ziasm entries (recursed into, not returned directly)
 *   - hardware/ paths (no PanelFeature, never have bores)
 *   - panels with no bores or an empty bores[]
 */
export async function collectBoreDocsForClear(
  asm: AssemblyDocument,
  opfs: OpfsReader,
): Promise<BoreDocEntry[]> {
  const results: BoreDocEntry[] = [];

  for (const comp of asm.components) {
    const p = comp.partPath;

    if (p.endsWith('.ziasm')) {
      // Recurse into sub-assembly.
      try {
        const subBytes = await opfs.read(p);
        const subDoc = await unpackAssembly(subBytes);
        const nested = await collectBoreDocsForClear(subDoc, opfs);
        results.push(...nested);
      } catch {
        // sub-assembly not yet in OPFS (not yet saved) — skip
      }
      continue;
    }

    if (!p.endsWith('.zipt')) continue;
    if (p.startsWith('hardware/')) continue;

    try {
      const bytes = await opfs.read(p);
      const project = await unpackProject(bytes);
      const doc = (project.manifest as { document: { bores?: BoreOp[] } }).document;
      if (!doc.bores || doc.bores.length === 0) continue;
      results.push({ partPath: p, doc });
    } catch {
      // panel not yet in OPFS (not yet saved) — skip
    }
  }

  return results;
}
