import type { AssemblyDocument } from '@zilventor/shared';
import { writeTarGz, readTarGz } from './tarGzipUtil';

const FORMAT_VERSION = 7;

export async function packAssembly(
  doc: AssemblyDocument,
  thumbnail: Uint8Array,
): Promise<Uint8Array> {
  const manifest = {
    formatVersion: FORMAT_VERSION,
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

  let manifest: any;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data));
  } catch (e) {
    throw new Error(`AssemblyPacker: malformed manifest.json: ${(e as Error).message}`);
  }

  if (manifest.kind !== 'assembly') {
    throw new Error(
      `AssemblyPacker: expected kind: 'assembly', got kind: '${manifest.kind ?? 'undefined'}'`,
    );
  }
  if (manifest.formatVersion !== FORMAT_VERSION) {
    throw new Error(
      `AssemblyPacker: unsupported formatVersion ${manifest.formatVersion}`,
    );
  }

  return manifest.document as AssemblyDocument;
}
