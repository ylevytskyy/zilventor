import { gzip, ungzip } from 'pako';
import { extract as tarExtract } from 'tar-stream';
// `streamx` has no published types. tar-stream already depends on it, so
// it's on disk; we re-use its Writable to collect extract output in a
// way that works in both Node and the browser Web Worker.
// @ts-expect-error missing type declarations for streamx
import { Writable } from 'streamx';

export type TarEntry = { name: string; data: Uint8Array<ArrayBufferLike> };

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

// ---------------------------------------------------------------------------
// Pure synchronous tar builder — works on the browser main thread, in Web
// Workers, and in Node without needing a streaming event loop.
//
// Background: tar-stream's Pack is a streamx Readable. Its pipe/drain cycle
// is driven by queueMicrotask, which requires multiple event-loop turns to
// propagate backpressure signals.  On the browser main thread that chain
// stalls indefinitely when a long-running async function (e.g. page.evaluate)
// consumes all microtask budget, causing packDrawing to hang regardless of the
// Pack's highWaterMark.  The solution is to skip streaming entirely and
// assemble the tar bytes directly with typed arrays.
//
// Format: POSIX ustar (same as what tar-stream produces).
// Each entry: 512-byte header block + data padded to 512 boundary.
// Archive ends with 2 × 512-byte zero blocks.
// ---------------------------------------------------------------------------
const USTAR_MAGIC = new Uint8Array([0x75, 0x73, 0x74, 0x61, 0x72, 0x00]); // "ustar\0"
const USTAR_VERSION = new Uint8Array([0x30, 0x30]); // "00"

function buildTarEntry(name: string, data: Uint8Array, mtime = 0): Uint8Array {
  const enc = new TextEncoder();
  const nameBytes = enc.encode(name);
  if (nameBytes.byteLength > 100) {
    throw new Error(`tar entry name too long (max 100 bytes): ${name}`);
  }

  const header = new Uint8Array(512);

  // name (0–99)
  header.set(nameBytes, 0);
  // mode (100–107): '0000644\0'
  header.set(enc.encode('0000644\0'), 100);
  // uid (108–115)
  header.set(enc.encode('0000000\0'), 108);
  // gid (116–123)
  header.set(enc.encode('0000000\0'), 116);
  // size (124–135): 11-digit octal + null
  header.set(enc.encode(data.byteLength.toString(8).padStart(11, '0') + '\0'), 124);
  // mtime (136–147): 11-digit octal + null
  header.set(enc.encode(mtime.toString(8).padStart(11, '0') + '\0'), 136);
  // checksum placeholder — 8 spaces (148–155)
  header.fill(0x20, 148, 156);
  // type flag (156): '0' = regular file
  header[156] = 0x30;
  // ustar magic (257–262)
  header.set(USTAR_MAGIC, 257);
  // ustar version (263–264)
  header.set(USTAR_VERSION, 263);

  // Checksum: sum of all 512 bytes (checksum field treated as spaces)
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i]!;
  // Write: 6 octal digits + null + space
  header.set(enc.encode(checksum.toString(8).padStart(6, '0')), 148);
  header[154] = 0x00;
  header[155] = 0x20;

  // Data padded to 512-byte boundary
  const paddedSize = Math.ceil(data.byteLength / 512) * 512;
  const paddedData = new Uint8Array(paddedSize);
  paddedData.set(data, 0);

  // Combine header + padded data
  const entry = new Uint8Array(512 + paddedSize);
  entry.set(header, 0);
  entry.set(paddedData, 512);
  return entry;
}

export async function writeTarGz(entries: TarEntry[]): Promise<Uint8Array> {
  // Build all entry bytes synchronously — no streaming, no event-loop dependency.
  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    parts.push(buildTarEntry(entry.name, entry.data));
  }
  // POSIX tar EOF: two 512-byte zero blocks
  parts.push(new Uint8Array(1024));
  return gzip(concatBytes(parts));
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
