import type { Opfs } from '@zilventor/kernel/src/storage/Opfs';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import type { PartInfo } from '@zilventor/shared';

export type PartInfoCache = Map<string, PartInfo>;

export async function resolvePartInfo(opfs: Opfs, partPath: string, cache: PartInfoCache): Promise<PartInfo> {
  const hit = cache.get(partPath);
  if (hit !== undefined) return hit;
  try {
    const bytes = await opfs.read(partPath);
    const project = await unpackProject(bytes);
    const manifest = project.manifest as { document?: { name?: string; properties?: Record<string, string | number | boolean> } } | null;
    const doc = manifest?.document;
    const props = doc?.properties ?? {};
    const info: PartInfo = {
      name: doc?.name ?? '(missing part)',
      ...(typeof props.partNumber === 'string' ? { partNumber: props.partNumber } : {}),
      ...(typeof props.description === 'string' ? { description: props.description } : {}),
    };
    cache.set(partPath, info);
    return info;
  } catch {
    const info: PartInfo = { name: '(missing part)' };
    cache.set(partPath, info);
    return info;
  }
}
