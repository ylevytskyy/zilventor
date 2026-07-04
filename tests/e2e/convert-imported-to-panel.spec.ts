/**
 * E2E — "Convert imported STEP part to panel" (BrowserPane leaf context menu).
 *
 * Right-clicking a leaf component in an exploded STEP assembly and typing
 * "convert" into the window.prompt derives a PanelFeature draft from the
 * part's cached bbox and opens PanelDialog. OK dispatches
 * ConvertImportedPartToPanelCommand, which replaces the part's `imported`
 * feature with a `panel` feature in place (manifest-only repack, byte-exact
 * undo) and invalidates the panelSpecCacheRef/partInfoCacheRef caches so the
 * Cut List reflects the new panel immediately instead of serving a stale
 * null spec.
 *
 * This test drives the real UI end to end: open STEP → explode → right-click
 * → convert → PanelDialog OK → OPFS featureTree flips to 'panel' → Cut List
 * gains a row (proves the cache-eviction fix) → undo reverts both.
 *
 * Headless viewport is a black 3D canvas — no visual assertions; everything
 * is probed via window.__zilventorStore + OPFS bytes, per project convention
 * (see step-explode-into-assembly.spec.ts / repair-cabinet-pose.spec.ts).
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from './helpers/buildBox';

const TWO_BODIES = resolve(
  __dirname,
  '../../packages/kernel/src/occt/__tests__/fixtures/step/two-bodies.step',
);

type OpfsWindow = {
  __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
  __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
};

async function readFeatureKinds(page: Page, partPath: string): Promise<string[] | { error: string }> {
  return page.evaluate(async (pp) => {
    const w = window as unknown as OpfsWindow;
    try {
      const opfs = await w.__zilventorGetOpfs();
      const bytes = await opfs.read(pp);
      const proj = await w.__zilventorUnpackProject(bytes);
      const doc = (proj.manifest as { document: { featureTree: Array<{ kind: string }> } }).document;
      return doc.featureTree.map((f) => f.kind);
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, partPath);
}

test(
  'Convert imported STEP part to panel: right-click leaf → convert → PanelDialog OK → cut-list row → undo',
  async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto('/');
    await waitForKernelReady(page);

    // ── 1. Open two-bodies.step (mirrors step-explode-into-assembly.spec.ts) ──
    const stepBytes = readFileSync(TWO_BODIES);
    await page.evaluate(
      async ([bytes]: [number[]]) => {
        const fakeFile = {
          name: 'two-bodies.step',
          arrayBuffer: async () => new Uint8Array(bytes).buffer,
        };
        const fakeHandle = { getFile: async () => fakeFile };
        (window as any).showOpenFilePicker = async () => [fakeHandle];
      },
      [Array.from(stepBytes)] as [number[]],
    );

    await page.getByRole('tab', { name: 'File' }).click();
    await page.getByRole('button', { name: /open/i }).click();
    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeDocument?.kind === 'part',
      undefined,
      { timeout: 60_000 },
    );

    // ── 2. Explode into Assembly (Model tab button) ──
    await page.getByRole('tab', { name: /^model$/i }).click();
    const explodeBtn = page.getByRole('button', { name: /explode into assembly/i });
    await expect(explodeBtn).toBeEnabled({ timeout: 5_000 });
    await explodeBtn.click();

    await page.waitForFunction(
      () => {
        const doc = (window as any).__zilventorStore?.getState().activeDocument;
        return doc?.kind === 'assembly' && doc.document.components.length === 2;
      },
      undefined,
      { timeout: 30_000 },
    );

    // ── 3. Add a material to the assembly registry. deriveImportedPanelDraft
    // defaults the panel's materialId to the assembly's first registered
    // material; without one, ConvertImportedPartToPanelCommand still applies
    // but resolvePanelSpec's R1 preflight rejects an empty materialId
    // ('panel.preflight.missingMaterial'), which would exclude the row from
    // the Cut List for a reason unrelated to the cache-eviction fix under
    // test here. ──
    await page.evaluate(() => {
      (window as any).__zilventorStore.getState().addMaterial({
        id: 'm-conv', name: 'Conv Material', defaultThickness: 18, color: '#cccccc',
      });
    });

    // ── 4. Identify the first leaf component's row (rendered as "{id} — {fileName}"). ──
    const leaf = await page.evaluate(() => {
      const doc = (window as any).__zilventorStore.getState().activeDocument;
      const c = doc.document.components[0];
      return { id: c.id as string, partPath: c.partPath as string };
    });
    const partFileName = leaf.partPath.replace(/\.zipt$/, '');

    // Pre-condition: the leaf part starts as 'imported', not 'panel'.
    const initialKinds = await readFeatureKinds(page, leaf.partPath);
    if (!Array.isArray(initialKinds)) throw new Error(`readFeatureKinds failed: ${initialKinds.error}`);
    expect(initialKinds).toContain('imported');
    expect(initialKinds).not.toContain('panel');

    // ── 5. Right-click the leaf row → accept "convert" on the window.prompt
    // (window.prompt → Playwright dialog; must be registered BEFORE the click). ──
    page.once('dialog', (d) => { void d.accept('convert'); });
    await page
      .locator('[data-testid="browser-pane"]')
      .getByText(partFileName, { exact: false })
      .first()
      .click({ button: 'right' });

    // ── 6. PanelDialog appears → click OK. ──
    const panelDialog = page.getByRole('dialog', { name: 'Panel' });
    await expect(panelDialog).toBeVisible({ timeout: 10_000 });
    await expect(panelDialog.getByRole('button', { name: 'OK' })).toBeEnabled({ timeout: 5_000 });
    await panelDialog.getByRole('button', { name: 'OK' }).click();

    // ── 7. Poll OPFS bytes: featureTree now has 'panel', no more 'imported'. ──
    await expect
      .poll(
        async () => {
          const kinds = await readFeatureKinds(page, leaf.partPath);
          if (!Array.isArray(kinds)) {
            console.log('transient OPFS read error (retrying):', kinds.error);
            return null;
          }
          return { hasPanel: kinds.includes('panel'), hasImported: kinds.includes('imported') };
        },
        { timeout: 30_000, message: 'ConvertImportedPartToPanelCommand must replace imported with panel' },
      )
      .toEqual({ hasPanel: true, hasImported: false });

    // ── 8. Open the Cut List tab → a row for the converted part appears.
    // This is the functional proof of the panelSpecCacheRef/partInfoCacheRef
    // eviction fix: before it, invalidatePartPaths left the stale (null) spec
    // cached and the Cut List would stay empty forever. ──
    await page.getByRole('button', { name: 'Cut List tab' }).click();
    await expect(page.locator('[data-cutlist-row]')).toHaveCount(1, { timeout: 15_000 });

    // ── 9. Ctrl+Z (undo) → featureTree reverts to 'imported'; cut-list row disappears. ──
    await page.keyboard.press('Control+z');

    await expect
      .poll(
        async () => {
          const kinds = await readFeatureKinds(page, leaf.partPath);
          if (!Array.isArray(kinds)) {
            console.log('transient OPFS read error (retrying):', kinds.error);
            return null;
          }
          return { hasPanel: kinds.includes('panel'), hasImported: kinds.includes('imported') };
        },
        { timeout: 30_000, message: 'Undo must restore the imported feature byte-exactly' },
      )
      .toEqual({ hasPanel: false, hasImported: true });

    await expect(page.locator('[data-cutlist-row]')).toHaveCount(0, { timeout: 15_000 });

    // ── 10. No uncaught page errors. ──
    expect(pageErrors).toHaveLength(0);
  },
);
