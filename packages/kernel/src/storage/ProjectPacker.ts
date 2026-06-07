import { writeTarGz, readTarGz, type TarEntry } from './tarGzipUtil';

export type ProjectArchiveInput = {
  manifest: unknown;
  blobs: Record<string, Uint8Array>;
  thumbnail?: Uint8Array;
  textures?: Record<string, Uint8Array>;
};

export type ProjectArchiveOutput = {
  manifest: unknown;
  blobs: Record<string, Uint8Array>;
  thumbnail?: Uint8Array;
  textures?: Record<string, Uint8Array>;
};

export async function packProject(input: ProjectArchiveInput): Promise<Uint8Array> {
  const manifestBytes = new TextEncoder().encode(JSON.stringify(input.manifest));
  const entries: TarEntry[] = [{ name: 'manifest.json', data: manifestBytes }];

  for (const [id, bytes] of Object.entries(input.blobs)) {
    entries.push({ name: `blobs/${id}.brep`, data: bytes });
  }
  if (input.textures) {
    for (const [id, bytes] of Object.entries(input.textures)) {
      entries.push({ name: `textures/${id}.jpg`, data: bytes });
    }
  }
  if (input.thumbnail) {
    entries.push({ name: 'thumbnail.png', data: input.thumbnail });
  }

  return writeTarGz(entries);
}

export async function unpackProject(archive: Uint8Array): Promise<ProjectArchiveOutput> {
  const entries = await readTarGz(archive);
  const result: ProjectArchiveOutput = { manifest: null, blobs: {} };

  for (const entry of entries) {
    if (entry.name === 'manifest.json') {
      result.manifest = JSON.parse(new TextDecoder().decode(entry.data));
    } else if (entry.name.startsWith('blobs/') && entry.name.endsWith('.brep')) {
      const id = entry.name.slice('blobs/'.length, -'.brep'.length);
      result.blobs[id] = entry.data;
    } else if (entry.name.startsWith('textures/') && entry.name.endsWith('.jpg')) {
      const id = entry.name.slice('textures/'.length, -'.jpg'.length);
      (result.textures ??= {})[id] = entry.data;
    } else if (entry.name === 'thumbnail.png') {
      result.thumbnail = entry.data;
    }
  }

  return result;
}
