/**
 * Persists a DrawingDocument to OPFS under `drawings/<id>.zidw`.
 *
 * The file is a gzipped-tar envelope matching the pattern used by
 * AssemblyPacker — manifest.json inside a tar.gz archive.
 *
 * NOTE: This module is dynamically imported by CreateDrawingCommand so
 * that unit tests can easily mock it with vi.mock.
 */
import type { DrawingDocument } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { Opfs } from '@zilventor/kernel/src/storage/Opfs';

export async function saveDrawingToOpfs(doc: DrawingDocument): Promise<void> {
  const manifest = {
    formatVersion: CURRENT_FORMAT_VERSION,
    kind: 'drawing' as const,
    createdAt: new Date().toISOString(),
    appVersion: '0.0.0',
    document: doc,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const bytes = await writeTarGz([{ name: 'manifest.json', data: manifestBytes }]);

  const opfs = await Opfs.forNavigator();
  await opfs.write(`drawings/${doc.id}.zidw`, bytes);
}
