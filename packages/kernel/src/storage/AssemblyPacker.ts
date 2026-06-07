import type { AssemblyDocument } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION, migrateManifest } from '@zilventor/shared';
import { writeTarGz, readTarGz, type TarEntry } from './tarGzipUtil';

export async function packAssembly(
  doc: AssemblyDocument,
  thumbnail: Uint8Array,
  textures?: Record<string, Uint8Array>,
): Promise<Uint8Array> {
  const manifest = {
    formatVersion: CURRENT_FORMAT_VERSION,
    kind: 'assembly' as const,
    document: doc,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const entries: TarEntry[] = [
    { name: 'manifest.json', data: manifestBytes },
    { name: 'thumbnail.png', data: thumbnail },
  ];

  if (textures) {
    for (const [id, bytes] of Object.entries(textures)) {
      entries.push({ name: `textures/${id}.jpg`, data: bytes });
    }
  }

  return writeTarGz(entries);
}

export async function unpackAssemblyWithTextures(
  bytes: Uint8Array,
): Promise<{ doc: AssemblyDocument; textures: Record<string, Uint8Array> }> {
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
  const doc = (migrated as unknown as { document: AssemblyDocument }).document;

  const textures: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    if (entry.name.startsWith('textures/') && entry.name.endsWith('.jpg')) {
      const id = entry.name.slice('textures/'.length, -'.jpg'.length);
      textures[id] = entry.data;
    }
  }

  return { doc, textures };
}

export async function unpackAssembly(bytes: Uint8Array): Promise<AssemblyDocument> {
  return (await unpackAssemblyWithTextures(bytes)).doc;
}
