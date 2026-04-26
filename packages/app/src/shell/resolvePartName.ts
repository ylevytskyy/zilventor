import type { Opfs } from '@zilventor/kernel/src/storage/Opfs';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';

export type PartNameCache = Map<string, string>;

export async function resolvePartName(opfs: Opfs, partPath: string, cache: PartNameCache): Promise<string> {
  const hit = cache.get(partPath);
  if (hit !== undefined) return hit;
  try {
    const bytes = await opfs.read(partPath);
    const project = await unpackProject(bytes);
    const manifest = project.manifest as { document?: { name?: string } } | null;
    const name = manifest?.document?.name ?? '(missing part)';
    cache.set(partPath, name);
    return name;
  } catch {
    cache.set(partPath, '(missing part)');
    return '(missing part)';
  }
}
