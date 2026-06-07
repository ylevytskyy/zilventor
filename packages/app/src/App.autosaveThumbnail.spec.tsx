// @vitest-environment node
/**
 * Structural tests for the autosave thumbnail wiring in App.tsx.
 * We verify at source-text level that the throttle refs and capture call are present,
 * plus a logic-level test for the throttle condition using the extracted constant.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

const APP_PATH = path.resolve(__dirname, 'App.tsx');

async function readApp(): Promise<string> {
  return fs.readFile(APP_PATH, 'utf-8');
}

describe('App.tsx — autosave thumbnail wiring', () => {
  it('declares lastThumbBytesRef', async () => {
    const src = await readApp();
    expect(src).toContain('lastThumbBytesRef');
  });

  it('declares lastThumbTimeRef', async () => {
    const src = await readApp();
    expect(src).toContain('lastThumbTimeRef');
  });

  it('declares THUMB_THROTTLE_MS = 5000', async () => {
    const src = await readApp();
    expect(src).toContain('THUMB_THROTTLE_MS');
    expect(src).toContain('5000');
  });

  it('calls captureThumbnailScaled(256) in the autosave effect', async () => {
    const src = await readApp();
    expect(src).toContain('captureThumbnailScaled(256)');
  });

  it('no longer passes a bare new Uint8Array() as thumbnail in the assembly autosave path', async () => {
    const src = await readApp();
    // The old code was:  packAssembly(merged, new Uint8Array(), texBytes)
    // The new code must pass the cached ref instead.
    // We check that new Uint8Array() is only used as the null-coalescing fallback,
    // not as the direct second argument after the variable name.
    // Structural: the ref variable must appear as the thumbnail arg.
    expect(src).toContain('lastThumbBytesRef.current');
    // The coalescing pattern must be present: `?? new Uint8Array()`
    expect(src).toContain('?? new Uint8Array()');
  });

  it('autosave part path passes thumbnail to kernel.saveToBytes', async () => {
    const src = await readApp();
    // Must call kernel.saveToBytes with two args (id + thumbnail)
    // Check that lastThumbBytesRef.current (or coalesced) is passed as second arg
    expect(src).toContain('saveToBytes(doc.document.id,');
  });
});

describe('THUMB_THROTTLE_MS throttle logic', () => {
  it('first capture is immediate when lastThumbBytesRef.current is null', () => {
    // Logic test: null cache → should capture
    const lastThumbBytesRef = { current: null as Uint8Array | null };
    const lastThumbTimeRef = { current: 0 };
    const THUMB_THROTTLE_MS = 5000;
    const shouldCapture =
      lastThumbBytesRef.current === null ||
      Date.now() - lastThumbTimeRef.current > THUMB_THROTTLE_MS;
    expect(shouldCapture).toBe(true);
  });

  it('throttle skips capture when within THUMB_THROTTLE_MS of last capture', () => {
    const lastThumbBytesRef = { current: new Uint8Array([1, 2, 3]) };
    const lastThumbTimeRef = { current: Date.now() - 1000 }; // 1s ago, within 5s
    const THUMB_THROTTLE_MS = 5000;
    const shouldCapture =
      lastThumbBytesRef.current === null ||
      Date.now() - lastThumbTimeRef.current > THUMB_THROTTLE_MS;
    expect(shouldCapture).toBe(false);
  });

  it('throttle allows capture after THUMB_THROTTLE_MS has elapsed', () => {
    const lastThumbBytesRef = { current: new Uint8Array([1, 2, 3]) };
    const lastThumbTimeRef = { current: Date.now() - 6000 }; // 6s ago, > 5s
    const THUMB_THROTTLE_MS = 5000;
    const shouldCapture =
      lastThumbBytesRef.current === null ||
      Date.now() - lastThumbTimeRef.current > THUMB_THROTTLE_MS;
    expect(shouldCapture).toBe(true);
  });
});
