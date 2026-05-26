/**
 * Pure serializer for DrawingDocument ↔ .zidw tar.gz envelope.
 *
 * Mirrors AssemblyPacker (packages/kernel/src/storage/AssemblyPacker.ts)
 * but for drawing documents. No store, no kernel, no OPFS coupling.
 */
import type { DrawingDocument } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION, migrateManifest } from '@zilventor/shared';
import { writeTarGz, readTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';

export async function packDrawing(doc: DrawingDocument): Promise<Uint8Array> {
  const manifest = {
    formatVersion: CURRENT_FORMAT_VERSION,
    kind: 'drawing' as const,
    createdAt: new Date().toISOString(),
    appVersion: '0.0.0',
    document: doc,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  return writeTarGz([{ name: 'manifest.json', data: manifestBytes }]);
}

export async function unpackDrawing(bytes: Uint8Array): Promise<DrawingDocument> {
  const entries = await readTarGz(bytes);

  const manifestEntry = entries.find((e) => e.name === 'manifest.json');
  if (!manifestEntry) {
    throw new Error('DrawingPacker: manifest.json not found in archive');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(manifestEntry.data));
  } catch (e) {
    throw new Error(`DrawingPacker: malformed manifest.json: ${(e as Error).message}`);
  }

  // Kind check BEFORE migrateManifest — mirrors AssemblyPacker.ts lines 36-42.
  // This way a wrong-kind archive (e.g. a .zipt opened as .zidw) is rejected with
  // a clear message before we attempt format migration.
  const rawAny = raw as { kind?: string; formatVersion?: number };
  if (rawAny.kind !== 'drawing') {
    throw new Error(
      `DrawingPacker: expected kind: 'drawing', got kind: '${rawAny.kind ?? 'undefined'}'`,
    );
  }

  // migrateManifest throws if formatVersion > CURRENT_FORMAT_VERSION ("newer version")
  // and migrates older versions up to CURRENT_FORMAT_VERSION.
  const migrated = migrateManifest(raw as Parameters<typeof migrateManifest>[0]);

  return (migrated as unknown as { document: DrawingDocument }).document;
}
