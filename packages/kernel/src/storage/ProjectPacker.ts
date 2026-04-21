import { gzip, ungzip } from 'pako';
import { pack as tarPack, extract as tarExtract } from 'tar-stream';

export type ProjectArchiveInput = {
  manifest: unknown;
  blobs: Record<string, Uint8Array>;
  thumbnail?: Uint8Array;
};

export type ProjectArchiveOutput = {
  manifest: unknown;
  blobs: Record<string, Uint8Array>;
  thumbnail?: Uint8Array;
};

const DETERMINISTIC_HEADER = {
  mtime: new Date(0),
  uid: 0,
  gid: 0,
  uname: '',
  gname: '',
  mode: 0o644
};

export async function packProject(input: ProjectArchiveInput): Promise<Uint8Array> {
  const tar = tarPack();
  const chunks: Uint8Array[] = [];
  tar.on('data', (c: Buffer) => chunks.push(new Uint8Array(c)));

  const manifestBytes = new TextEncoder().encode(JSON.stringify(input.manifest));
  tar.entry({ ...DETERMINISTIC_HEADER, name: 'manifest.json' }, Buffer.from(manifestBytes));

  for (const [id, bytes] of Object.entries(input.blobs)) {
    tar.entry({ ...DETERMINISTIC_HEADER, name: `blobs/${id}.brep` }, Buffer.from(bytes));
  }
  if (input.thumbnail) {
    tar.entry({ ...DETERMINISTIC_HEADER, name: 'thumbnail.png' }, Buffer.from(input.thumbnail));
  }
  tar.finalize();

  await new Promise<void>((resolve) => tar.on('end', () => resolve()));
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const flat = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { flat.set(c, off); off += c.byteLength; }
  return gzip(flat);
}

export async function unpackProject(archive: Uint8Array): Promise<ProjectArchiveOutput> {
  let tarBytes: Uint8Array;
  try { tarBytes = ungzip(archive); }
  catch (e) { throw new Error(`archive is corrupt (gzip): ${(e as Error).message}`); }

  const extract = tarExtract();
  const result: ProjectArchiveOutput = { manifest: null, blobs: {} };

  const done = new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const bufs: Buffer[] = [];
      stream.on('data', (c: Buffer) => bufs.push(c));
      stream.on('end', () => {
        const data = new Uint8Array(Buffer.concat(bufs));
        if (header.name === 'manifest.json') {
          result.manifest = JSON.parse(new TextDecoder().decode(data));
        } else if (header.name.startsWith('blobs/') && header.name.endsWith('.brep')) {
          const id = header.name.slice('blobs/'.length, -'.brep'.length);
          result.blobs[id] = data;
        } else if (header.name === 'thumbnail.png') {
          result.thumbnail = data;
        }
        next();
      });
      stream.resume();
    });
    extract.on('finish', () => resolve());
    extract.on('error', (e) => reject(new Error(`archive is corrupt (tar): ${(e as Error).message}`)));
  });

  extract.end(Buffer.from(tarBytes));
  await done;
  return result;
}
