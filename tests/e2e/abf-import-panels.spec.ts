/**
 * E2E: Import ABF flatten DXF as panels (S6).
 *
 * Drives the real UI flow against a trimmed (~44KB) real-sample fixture derived from
 * `~/Downloads/Стелаж flatten.dxf` (see docs/superpowers/plans/2026-07-04-abf-import-as-panels.md).
 *
 * Flow:
 *   A. New assembly + seed one material (so the ABF dialog's material picker has an option).
 *   B. File tab → "Import ABF flatten DXF…" — stub window.showOpenFilePicker (FSA API,
 *      present in Chromium) to return the fixture DXF, matching the existing
 *      m4-custom-hardware-sku.spec.ts stub pattern.
 *   C. Fill the per-material-group dialog (2 rows: AUTO_THICKNESS_18, SREE_PEARLS_2_THICKNESS_18)
 *      and confirm.
 *   D. Assert via window.__zilventorStore: a new assembly is active with 2 components.
 *   E. Assert verbatim Cyrillic part names + door panel's real hinge-cup BoreOps, read back
 *      from OPFS via the __zilventorUnpackProject hook (prisadka-carcass-boring.spec.ts pattern).
 *   F. Assert undo removes the imported assembly (component count reverts).
 *   G. Assert 0 browser console errors.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from './helpers/buildBox';

const FIXTURE_PATH = resolve(__dirname, 'fixtures/abf-flatten-sample.dxf');

test(
  'ABF flatten DXF import: 2 panels, verbatim Cyrillic names, real hinge-cup bores, undo',
  async ({ page }) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(90_000);

    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      console.log('BROWSER:', m.type(), m.text());
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => {
      console.log('PAGEERROR:', e.message);
      consoleErrors.push(`PAGEERROR: ${e.message}`);
    });

    await page.goto('/');
    await waitForKernelReady(page);

    // ── A. New assembly + seed a material ───────────────────────────────────────
    await page.getByRole('tab', { name: 'File' }).click();
    await page.getByRole('button', { name: /new assembly/i }).click();
    await page.waitForFunction(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
      };
      return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
    });
    const priorAssemblyId = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { activeDocument?: { kind: string; document: { id: string } } } };
      };
      return w.__zilventorStore.getState().activeDocument?.document.id;
    });

    await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
      };
      w.__zilventorStore.getState().addMaterial({
        id: 'm-e2e-abf-18', name: 'E2E ABF 18mm', defaultThickness: 18, color: '#c8a878',
      });
    });

    // ── B. Stub the file picker, then click "Import ABF flatten DXF…" ──────────
    const dxfContent = readFileSync(FIXTURE_PATH, 'utf-8');
    await page.evaluate((content: string) => {
      const fakeFile = { name: 'abf-flatten-sample.dxf', text: async () => content, size: content.length };
      const fakeHandle = { getFile: async () => fakeFile };
      (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = async () => [fakeHandle];
    }, dxfContent);

    await page.getByRole('button', { name: /import abf flatten dxf/i }).click();

    // ── C. Fill + confirm the per-material-group dialog ─────────────────────────
    const dialog = page.getByRole('dialog', { name: /import abf flatten dxf/i });
    await expect(dialog).toBeVisible();

    const materialAuto = page.getByLabel('Material for AUTO_THICKNESS_18');
    const materialSree = page.getByLabel('Material for SREE_PEARLS_2_THICKNESS_18');
    await expect(materialAuto).toBeVisible();
    await expect(materialSree).toBeVisible();
    await materialAuto.selectOption('m-e2e-abf-18');
    await materialSree.selectOption('m-e2e-abf-18');

    await expect(page.getByLabel('Thickness for AUTO_THICKNESS_18')).toHaveValue('18');
    await expect(page.getByLabel('Thickness for SREE_PEARLS_2_THICKNESS_18')).toHaveValue('18');

    await page.getByRole('button', { name: /^import$/i }).click();

    // ── D. Wait for the new assembly with 2 components ─────────────────────────
    await page.waitForFunction(
      (priorId) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              activeDocument?: { kind: string; document: { id: string; components: unknown[] } };
            };
          };
        };
        const doc = w.__zilventorStore.getState().activeDocument;
        return doc?.kind === 'assembly' && doc.document.id !== priorId && doc.document.components.length === 2;
      },
      priorAssemblyId,
      { timeout: 30_000 },
    );

    const { partPaths, status } = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: { kind: string; document: { components: Array<{ partPath: string }> } };
            statusMessage?: string;
          };
        };
      };
      const s = w.__zilventorStore.getState();
      const doc = s.activeDocument!.document as { components: Array<{ partPath: string }> };
      return { partPaths: doc.components.map((c) => c.partPath), status: s.statusMessage };
    });
    expect(partPaths).toHaveLength(2);
    console.log('[abf-import] status:', status);
    console.log('[abf-import] partPaths:', partPaths);
    expect(status).toMatch(/2/);
    expect(status).toMatch(/9/); // bores imported (door panel's 3 hinge-cup + 6 leg-leveler)
    expect(status).toMatch(/18/); // reference-only circles (side panel)

    // ── E. Read back both PartDocuments from OPFS: verbatim names + real bores ──
    const parts = await page.evaluate(async (paths: string[]) => {
      const w = window as unknown as {
        __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
        __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
      };
      const opfs = await w.__zilventorGetOpfs();
      const results: Array<{ path: string; name: string; bores: unknown[] }> = [];
      for (const p of paths) {
        const bytes = await opfs.read(p);
        const project = await w.__zilventorUnpackProject(bytes);
        const doc = (project.manifest as { document: { name: string; bores?: unknown[] } }).document;
        results.push({ path: p, name: doc.name, bores: doc.bores ?? [] });
      }
      return results;
    }, partPaths);

    const names = parts.map((p) => p.name).sort();
    expect(names).toEqual(['__11. Бік Пр', '__4. Дверка'].sort());

    const doorPart = parts.find((p) => p.name === '__4. Дверка')!;
    expect(doorPart.bores).toHaveLength(9);
    const hingeCups = (doorPart.bores as Array<{ role: string; connectorKind: string; sku?: string; diameter: number }>)
      .filter((b) => b.role === 'hingeCup');
    expect(hingeCups).toHaveLength(3);
    for (const b of hingeCups) {
      expect(b).toMatchObject({ role: 'hingeCup', connectorKind: 'hinge', sku: '96053', diameter: 35 });
    }

    const sidePart = parts.find((p) => p.name === '__11. Бік Пр')!;
    expect(sidePart.bores).toHaveLength(0); // all 18 circles are reference-only, no BoreOps

    // ── F. Undo removes the imported assembly ───────────────────────────────────
    await page.evaluate(() => {
      const w = window as unknown as { __zilventorStore: { getState(): { bus: { undo(): Promise<void> } } } };
      return w.__zilventorStore.getState().bus.undo();
    });
    await page.waitForFunction(
      (priorId) => {
        const w = window as unknown as {
          __zilventorStore: { getState(): { activeDocument?: { kind: string; document: { id: string } } } };
        };
        return w.__zilventorStore.getState().activeDocument?.document.id === priorId;
      },
      priorAssemblyId,
      { timeout: 30_000 },
    );
    const afterUndoCount = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeDocument?: { kind: string; document: { components: unknown[] } } };
        };
      };
      return w.__zilventorStore.getState().activeDocument?.document.components.length;
    });
    expect(afterUndoCount).toBe(0);

    // ── G. 0 browser console errors ─────────────────────────────────────────────
    const realErrors = consoleErrors.filter((e) => !e.includes('ResizeObserver') && !e.includes('favicon'));
    expect(realErrors, 'no browser errors during ABF flatten DXF import').toHaveLength(0);
  },
);
