// Work around a bug in `b4a@1.8.0/browser.js` where `write(buf, str, offset)`
// (called with 3 args) miscomputes slice bounds and writes nothing.
// tar-stream's header encoder relies on that 3-arg form, so tar archives
// produced in the browser have all-zero header fields and fail to parse.
//
// vite.config.ts aliases the bare specifier `b4a` to this file. We reach
// the REAL `b4a/browser.js` via a relative traversal (that subpath is not
// in the package's `exports` map, so we can't just re-import it by name).

// eslint-disable-next-line import/no-relative-packages
import realDefault from '../../../../node_modules/.pnpm/b4a@1.8.0/node_modules/b4a/browser.js';

const originalWrite = realDefault.write;

function fixedWrite(buffer, string, offset, length, encoding) {
  if (typeof offset === 'string') {
    encoding = offset;
    offset = 0;
    length = buffer.byteLength;
  } else if (typeof length === 'string') {
    encoding = length;
    length = buffer.byteLength - (offset || 0);
  }
  if (offset === undefined) offset = 0;
  if (length === undefined) length = Math.max(0, buffer.byteLength - offset);
  return originalWrite(buffer, string, offset, length, encoding);
}

// Build a flat, plain-object exports map. CJS consumers — tar-stream uses
// `require('b4a').xxx` — see every key directly; ESM consumers that do
// `import b4a from 'b4a'` get the same object as the default export.
const patched = { ...realDefault, write: fixedWrite };

// Re-export every entry as a named export so `import { write } from 'b4a'`
// (if anyone ever does that) picks up the patched version.
export const {
  isBuffer,
  isEncoding,
  alloc,
  allocUnsafe,
  allocUnsafeSlow,
  byteLength,
  compare,
  concat,
  copy,
  equals,
  fill,
  from,
  includes,
  indexOf,
  lastIndexOf,
  swap16,
  swap32,
  swap64,
  toBuffer,
  toString,
  readDoubleBE,
  readDoubleLE,
  readFloatBE,
  readFloatLE,
  readInt32BE,
  readInt32LE,
  readUInt32BE,
  readUInt32LE,
  writeDoubleBE,
  writeDoubleLE,
  writeFloatBE,
  writeFloatLE,
  writeInt32BE,
  writeInt32LE,
  writeUInt32BE,
  writeUInt32LE
} = patched;
export const write = fixedWrite;
export default patched;
