import type { AssemblyDocument } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION, migrateManifest } from '@zilventor/shared';
import { writeTarGz, readTarGz } from './tarGzipUtil';

export async function packAssembly(
  doc: AssemblyDocument,
  thumbnail: Uint8Array,
): Promise<Uint8Array> {
  const manifest = {
    formatVersion: CURRENT_FORMAT_VERSION,
    kind: 'assembly' as const,
    document: doc,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  return writeTarGz([
    { name: 'manifest.json', data: manifestBytes },
    { name: 'thumbnail.png', data: thumbnail },
  ]);
}

export async function unpackAssembly(bytes: Uint8Array): Promise<AssemblyDocument> {
  const entries = await readTarGz(bytes);

  const manifestEntry = entries.find((e) => e.name === 'manifest.json');
  if (!manifestEntry) {
    throw new Error('AssemblyPacker: manifest.json not found in archive');
  }

  let raw: any;
  try {
    raw = JSON.parse(new TextDecoder().decode(manifestEntry.data));
  } catch (e) {
    throw new Error(`AssemblyPacker: malformed manifest.json: ${(e as Error).message}`);
  }

  if (raw.kind !== 'assembly') {
    throw new Error(
      `AssemblyPacker: expected kind: 'assembly', got kind: '${raw.kind ?? 'undefined'}'`,
    );
  }

  const migrated = migrateManifest(raw);
  return (migrated as unknown as { document: AssemblyDocument }).document;
}
