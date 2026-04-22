import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from './helpers/buildBox';

// Extend Window with our test-injected fields.
declare global {
  interface Window {
    __savedBytes?: Uint8Array;
    __seedBytes?: Uint8Array;
  }
}

// The pickers run on the main page, but the handle they return is forwarded
// to the kernel worker via Comlink. A class instance on the main thread
// structured-clones into an empty object on the worker side, losing its
// methods. To preserve them we wrap every method-carrying fake with
// `Comlink.proxy(...)`; the app conveniently exposes Comlink on `window`
// for exactly this purpose.
const installFilePickerStubs = `
  (() => {
    function proxy(obj) {
      const C = window.__comlink;
      return C ? C.proxy(obj) : obj;
    }
    class FakeWritable {
      constructor() { this._chunks = []; }
      async write(chunk) {
        const data = chunk instanceof Uint8Array ? chunk :
                     chunk instanceof ArrayBuffer ? new Uint8Array(chunk) :
                     chunk && chunk.data ? new Uint8Array(chunk.data) : new Uint8Array(0);
        this._chunks.push(data);
      }
      async close() {
        const total = this._chunks.reduce((n, c) => n + c.byteLength, 0);
        const flat = new Uint8Array(total);
        let off = 0;
        for (const c of this._chunks) { flat.set(c, off); off += c.byteLength; }
        window.__savedBytes = flat;
      }
    }
    class FakeFile {
      constructor(bytes) { this._bytes = bytes; }
      async arrayBuffer() { return this._bytes.slice().buffer; }
    }
    class FakeHandle {
      async createWritable() { return proxy(new FakeWritable()); }
      async getFile() { return proxy(new FakeFile(window.__seedBytes || new Uint8Array())); }
    }
    window.showSaveFilePicker = async () => proxy(new FakeHandle());
    window.showOpenFilePicker = async () => [proxy(new FakeHandle())];
  })();
`;

test('Workflow 4 — save a box and reopen it, geometry round-trips', async ({ page }) => {
  // Install the pickers before any page script runs; this applies to every
  // navigation (including the reload below).
  await page.addInitScript(installFilePickerStubs);

  await page.goto('/');
  await waitForKernelReady(page);

  // Step 1: build a box
  await buildBox(page, { width: 100, height: 200, depth: 50 });
  const triangleCountBefore = await page
    .locator('[data-triangle-count]')
    .getAttribute('data-triangle-count');
  expect(Number(triangleCountBefore)).toBeGreaterThan(0);

  // Step 2: save
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: 'Save As…' }).click();
  // The status bar reports "Saved at HH:MM:SS" once the kernel finishes.
  await expect(page.getByText(/Saved at/)).toBeVisible({ timeout: 30_000 });

  // Step 3: pull the saved bytes out of the page (base64 so we can round-trip
  // them across the Playwright boundary).
  const savedBase64 = await page.evaluate(() => {
    const u8 = window.__savedBytes;
    if (!u8) throw new Error('no saved bytes');
    let bin = '';
    for (const b of u8) bin += String.fromCharCode(b);
    return btoa(bin);
  });
  expect(savedBase64.length).toBeGreaterThan(0);

  // Step 4: reload to a fresh session. We install a second init script that
  // (a) re-installs the picker stubs (they'd be lost on reload) and
  // (b) seeds __seedBytes from the base64 we captured, so Open reads our file.
  await page.addInitScript(
    ({ code, b64 }) => {
      // Seed the bytes first so any script the page loads (including our
      // stubs) can read them.
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      window.__seedBytes = u8;
      // Now run the stub installer.
      // eslint-disable-next-line no-eval
      (0, eval)(code);
    },
    { code: installFilePickerStubs, b64: savedBase64 }
  );

  await page.reload();
  await waitForKernelReady(page);

  // Step 5: open the file
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: 'Open…' }).click();

  // Expect the part, its features, and a rendered mesh
  await expect(page.getByText('Part1')).toBeVisible();
  await expect(page.getByText(/Sketch1/)).toBeVisible();
  await expect(page.getByText(/Extrusion1/)).toBeVisible();
  await expect(page.locator('[data-triangle-count]')).toHaveAttribute(
    'data-triangle-count',
    /[1-9]\d*/
  );
  // Triangle count should match — tessellation is deterministic for a fixed
  // geometry.
  const triangleCountAfter = await page
    .locator('[data-triangle-count]')
    .getAttribute('data-triangle-count');
  expect(Number(triangleCountAfter)).toBe(Number(triangleCountBefore));
});
