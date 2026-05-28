import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';
import { extractStepFromZip } from '../extractStepFromZip';

/**
 * Build a zip in-memory without binary fixtures.
 *
 * Two gotchas in the Vite-bundled fflate test environment:
 *
 * 1. fflate.zipSync checks `data instanceof Uint8Array` against the *Vite*
 *    module realm, not the jsdom realm.  TextEncoder.encode() returns a
 *    jsdom-realm Uint8Array, so the instanceof check fails and zipSync
 *    treats the data as a plain iterable (iterating numeric index keys),
 *    producing spurious entries like 'model.step/0/', 'model.step/1/', …
 *    Fix: wrap each value with `new Uint8Array(data)` to get a Vite-realm
 *    Uint8Array before handing it to zipSync.
 *
 * 2. Same wrapping makes the [data, options] tuple syntax unnecessary; a
 *    plain Vite-realm Uint8Array value is accepted correctly.
 */
function makeZip(files: Record<string, Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(files)) {
    // Ensure Vite-realm Uint8Array (not jsdom-realm from TextEncoder)
    entries[name] = new Uint8Array(data);
  }
  return zipSync(entries);
}

const enc = new TextEncoder();
const FAKE_STEP_BYTES = new Uint8Array(enc.encode('ISO-10303-21;\n; fake step data\nEND-ISO-10303-21;'));

describe('extractStepFromZip', () => {
  it('returns null when archive has no STEP entry', () => {
    const zip = makeZip({
      'photo.jpg': enc.encode('fake jpg bytes'),
      'model.SLDPRT': enc.encode('fake solidworks bytes'),
    });
    expect(extractStepFromZip(zip)).toBeNull();
  });

  it('returns the first .step entry when archive contains one', () => {
    const zip = makeZip({
      'model.step': FAKE_STEP_BYTES,
      'readme.txt': enc.encode('readme'),
    });
    const result = extractStepFromZip(zip);
    expect(result).not.toBeNull();
    expect(result!.fileName).toBe('model.step');
    const bytes = new Uint8Array(result!.stepBytes);
    expect(bytes).toEqual(FAKE_STEP_BYTES);
  });

  it('returns the first .stp entry when archive contains one', () => {
    const zip = makeZip({
      'Cadeira_preta.stp': FAKE_STEP_BYTES,
      'thumbnail.png': enc.encode('fake png'),
    });
    const result = extractStepFromZip(zip);
    expect(result).not.toBeNull();
    expect(result!.fileName).toBe('Cadeira_preta.stp');
  });

  it('is case-insensitive on extension', () => {
    const zip = makeZip({
      'MODEL.STEP': FAKE_STEP_BYTES,
      'other.txt': enc.encode('other'),
    });
    const result = extractStepFromZip(zip);
    expect(result).not.toBeNull();
    expect(result!.fileName.toLowerCase()).toMatch(/\.(step|stp)$/);
  });

  it('finds STEP nested in subdirectory', () => {
    const zip = makeZip({
      'Shelving Unit/readme.txt': enc.encode('readme'),
      'Shelving Unit/parts/cube.step': FAKE_STEP_BYTES,
    });
    const result = extractStepFromZip(zip);
    expect(result).not.toBeNull();
    // fileName should be just the basename, not the full path
    expect(result!.fileName).toBe('cube.step');
    const bytes = new Uint8Array(result!.stepBytes);
    expect(bytes).toEqual(FAKE_STEP_BYTES);
  });

  it('returns the FIRST step when multiple are present', () => {
    // fflate preserves insertion order → 'a.step' is before 'b.step'
    const contentA = new Uint8Array(enc.encode('step content A'));
    const contentB = new Uint8Array(enc.encode('step content B'));
    const zip = makeZip({
      'a.step': contentA,
      'b.step': contentB,
    });
    const result = extractStepFromZip(zip);
    expect(result).not.toBeNull();
    expect(result!.fileName).toBe('a.step');
    const bytes = new Uint8Array(result!.stepBytes);
    expect(bytes).toEqual(contentA);
  });

  it('throws on malformed zip bytes', () => {
    expect(() => extractStepFromZip(new Uint8Array([1, 2, 3]))).toThrow();
  });
});
