import { gzip, ungzip } from 'pako';
import { pack as tarPack, extract as tarExtract } from 'tar-stream';
// `streamx` has no published types. tar-stream already depends on it, so
// it's on disk; we re-use its Writable to collect pack/extract output in a
// way that works in both Node and the browser Web Worker.
// @ts-expect-error missing type declarations for streamx
import { Writable } from 'streamx';

export type TarEntry = { name: string; data: Uint8Array<ArrayBufferLike> };

const DETERMINISTIC_HEADER = {
  mtime: new Date(0),
  uid: 0,
  gid: 0,
  uname: '',
  gname: '',
  mode: 0o644,
};

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const flat = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    flat.set(c, off);
    off += c.byteLength;
  }
  return flat;
}

function addEntry(
  tar: ReturnType<typeof tarPack>,
  header: Parameters<ReturnType<typeof tarPack>['entry']>[0],
  body: Uint8Array,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // `@types/tar-stream` types `body` as `Buffer | string` but the runtime
    // (b4a-backed) accepts any Uint8Array in both Node and the browser.
    tar.entry(
      { ...header, size: body.byteLength },
      body as unknown as Buffer,
      (err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
}

export async function writeTarGz(entries: TarEntry[]): Promise<Uint8Array> {
  // Use a large highWaterMark to avoid backpressure stalls in the browser main thread.
  // The default 16 KiB causes push() to return false for large manifests, and the
  // drain/resume path through queueMicrotask does not complete in all browser contexts.
  const tar = tarPack({ highWaterMark: 1 << 24 }); // 16 MiB — no practical limit for .zidw
  const chunks: Uint8Array[] = [];

  // Pipe the tar output into a collector Writable. Using streamx's `pipe`
  // delivers chunks reliably across Node and the browser Web Worker, where
  // the event-emitter / async-iterator paths did not pump as expected.
  const collector = new Writable({
    write(c: Uint8Array, cb: (err?: Error | null) => void) {
      chunks.push(new Uint8Array(c.buffer, c.byteOffset, c.byteLength));
      cb(null);
    },
  });
  const collectDone = new Promise<void>((resolve, reject) => {
    collector.on('finish', () => resolve());
    collector.on('error', (e: Error) => reject(e));
  });
  (tar as unknown as { pipe(w: Writable): void }).pipe(collector);

  for (const entry of entries) {
    await addEntry(tar, { ...DETERMINISTIC_HEADER, name: entry.name }, entry.data);
  }
  tar.finalize();

  await collectDone;
  return gzip(concatBytes(chunks));
}

export async function readTarGz(archive: Uint8Array): Promise<TarEntry[]> {
  let tarBytes: Uint8Array;
  try {
    tarBytes = ungzip(archive);
  } catch (e) {
    throw new Error(`archive is corrupt (gzip): ${(e as Error).message}`);
  }

  const extract = tarExtract();
  const result: TarEntry[] = [];

  const done = new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const bufs: Uint8Array[] = [];
      // Drain each entry stream into a collector Writable so we reliably
      // receive every chunk in Node and in the browser Web Worker.
      const sink = new Writable({
        write(c: Uint8Array, cb: (err?: Error | null) => void) {
          bufs.push(new Uint8Array(c.buffer, c.byteOffset, c.byteLength));
          cb(null);
        },
        final(cb: (err?: Error | null) => void) {
          result.push({ name: header.name, data: concatBytes(bufs) });
          cb(null);
          next();
        },
      });
      (stream as unknown as { pipe(w: Writable): void }).pipe(sink);
    });
    extract.on('finish', () => resolve());
    extract.on('error', (e) =>
      reject(new Error(`archive is corrupt (tar): ${(e as Error).message}`)),
    );
  });

  extract.end(tarBytes);
  await done;
  return result;
}
