import type { AssemblyDocument } from '@zilventor/shared';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import type { OpfsLike } from './SubAssemblyCache';

export async function wouldCreateCycle(
  _activeDoc: AssemblyDocument,
  activeDocPath: string,
  candidatePath: string,
  opfs: OpfsLike,
): Promise<boolean> {
  if (candidatePath === activeDocPath) return true;
  const queue: string[] = [candidatePath];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    if (next === activeDocPath) return true;
    if (!(await opfs.exists(next))) continue;
    try {
      const doc = await unpackAssembly(await opfs.read(next));
      for (const c of doc.components) {
        if (c.partPath.endsWith('.ziasm')) queue.push(c.partPath);
      }
    } catch {
      continue;
    }
  }
  return false;
}
