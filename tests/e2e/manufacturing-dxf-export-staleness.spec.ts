/**
 * E2E: Manufacturing DXF export must reflect real, current bore data
 * IMMEDIATELY after Generate Carcass Boring — without ever opening the Cut
 * List tab first.
 *
 * Root cause (pre-fix): useBoringResult()'s useMemo depends on ref *objects*
 * (partBoresCacheRef, identity never changes on `.current` mutation) plus
 * activeAssembly/subAssemblyDocs identity. GenerateCarcassBoresCommand's
 * boreCacheInvalidator bumps activeAssembly identity SYNCHRONOUSLY (evicting
 * the bore cache) before the async mesh-sync effect has re-populated
 * partBoresCacheRef from OPFS. The memo recomputes once at eviction time
 * (seeing 0 bores) and never again until something ELSE bumps
 * activeAssembly/subAssemblyDocs identity — which is exactly what opening the
 * Cut List tab does (via warmCutListCache's setActiveDocument). This test
 * drives the REAL rendered "Export DXF (Manufacturing)" button on the
 * Furniture tab and never touches the Cut List tab, to catch the staleness.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';
import { unzipSync, strFromU8 } from 'fflate';

test(
  'manufacturing DXF export reflects fresh bores without opening Cut List tab first',
  async ({ page }) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(60_000);

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => {
      console.log('PAGEERROR:', e.message);
      pageErrors.push(`PAGEERROR: ${e.message}`);
    });

    await page.goto('/');
    await waitForKernelReady(page);

    // ── New assembly ─────────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'File' }).click();
    await page.getByRole('button', { name: /new assembly/i }).click();
    await page.waitForFunction(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
      };
      return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
    });

    // ── Register the two cabinet materials ──────────────────────────────────
    await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
      };
      const add = w.__zilventorStore.getState().addMaterial;
      add({ id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
      add({ id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' });
    });

    // ── CreateCabinetCommand (base cabinet) ──────────────────────────────────
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
        }>;
      };
      const { CreateCabinetCommand } = await import('/src/commands/CreateCabinetCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const cmd = new CreateCabinetCommand({
        template: 'baseCabinet',
        params: {
          name: 'Staleness Cabinet',
          width: 600,
          depth: 560,
          height: 720,
          toekickHeight: 100,
          toekickSetback: 50,
          shelfCount: 1,
          carcassMaterialId: 'm-birch-18',
          backMaterialId: 'm-hb-6',
          bandMaterialId: null,
        },
        opfs,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    });
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): { activeAssembly: { components: unknown[] } | null };
          };
        };
        return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 1;
      },
      undefined,
      { timeout: 30_000 },
    );

    // ── Open the Furniture tab BEFORE generating bores — this is exactly the
    //    real-world flow (the Generate Carcass Boring dialog + the Export
    //    buttons all live on this tab), and it's what establishes
    //    useBoringResult()'s memo at a point when bores don't exist yet. Ribbon
    //    tabs unmount/remount their panel on tab switch (Ribbon.tsx `panels[
    //    resolvedActive]`), so switching tabs AFTER generating bores would
    //    remount FurnitureTab fresh and mask the staleness bug entirely. ──────
    await page.getByRole('tab', { name: 'Furniture' }).click();

    // ── Wait for the (bores-independent) baseline: cutListResult settling its
    //    rows from the freshly created cabinet, via the existing eager
    //    partInfo-resolve + mesh-sync effects — no bores exist yet, so this
    //    only proves panelManufacturingInputs.length > 0 (Export enabled), not
    //    anything about the bug under test. Generous timeout: this baseline
    //    settling is orthogonal to (and can lag behind, under load) the bore
    //    staleness fix. ─────────────────────────────────────────────────────
    const exportButton = page.getByRole('button', { name: 'Export DXF (Manufacturing)' });
    await expect(exportButton).toBeEnabled({ timeout: 60_000 });

    // ── GenerateCarcassBoresCommand (confirmat only) — while still on the
    //    already-mounted Furniture tab, never touching Cut List. ─────────────
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
        }>;
      };
      const { GenerateCarcassBoresCommand } = await import(
        '/src/commands/GenerateCarcassBoresCommand.ts'
      );
      const opfs = await w.__zilventorGetOpfs();
      const cmd = new GenerateCarcassBoresCommand({
        params: {
          endSetback: 60,
          maxSpacing: 250,
          minCount: 2,
          confirmat: true,
          minifix: false,
          dowel: false,
        },
        opfs,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    });

    // ── Poll the fresh (non-memoized) aggregate hook until bores actually
    //    landed in the cache. This does NOT race the buggy memo — it recomputes
    //    from partBoresCacheRef.current on every call. ─────────────────────────
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __zilventorBoringAggregate?: () => { panels: Array<{ bores: unknown[] }> };
        };
        const agg = w.__zilventorBoringAggregate?.();
        return !!agg && agg.panels.some((p) => p.bores.length > 0);
      },
      undefined,
      { timeout: 30_000 },
    );

    // ── Stub showSaveFilePicker to abort so apply() stashes bytes only ───────
    await page.evaluate(() => {
      (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
        throw new DOMException('cancelled', 'AbortError');
      };
    });

    // ── Click the REAL rendered Export button on the (already-mounted, never
    //    re-navigated) Furniture tab. Never touch the Cut List tab — that's
    //    the whole point of this regression test. Read back zip bytes, unzip,
    //    decode every .dxf entry, count CIRCLEs. Polled (not one-shot): the
    //    OPFS/cache write (polled above)
    //    and React's own re-render of the memoized boringResult are two
    //    separate async completions — the fix makes the memo recompute
    //    correctly, but the click can still land a beat before that render
    //    commits. Each click re-reads whatever the CURRENT render's closure
    //    captured, so re-clicking after a short wait is a legitimate poll of
    //    settled state, not a retry-until-green loop: pre-fix, boringResult
    //    never updates at all (the whole bug), so this poll exhausts its
    //    budget and reports 0 — it does not mask the bug. ────────────────────
    let circleCount = 0;
    let dxfEntryCount = 0;
    await expect.poll(
      async () => {
        await exportButton.click();
        const zipB64 = await page.evaluate((): string | null => {
          const w = window as unknown as { __zilventorManufacturingDxfBytes?: Uint8Array };
          if (!w.__zilventorManufacturingDxfBytes) return null;
          const bytes = w.__zilventorManufacturingDxfBytes;
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
          return btoa(binary);
        });
        if (!zipB64) return 0;
        const zipBytes = new Uint8Array(Buffer.from(zipB64, 'base64'));
        const entries = unzipSync(zipBytes);
        const dxfNames = Object.keys(entries).filter((n) => n.endsWith('.dxf'));
        dxfEntryCount = dxfNames.length;
        let count = 0;
        for (const name of dxfNames) {
          const text = strFromU8(entries[name]!);
          const matches = text.match(/\nCIRCLE\n/g);
          count += matches?.length ?? 0;
        }
        circleCount = count;
        return count;
      },
      {
        timeout: 30_000,
        message:
          'manufacturing DXF export must contain real bore CIRCLEs immediately after Generate ' +
          'Carcass Boring, without opening the Cut List tab first',
      },
    ).toBeGreaterThan(0);

    console.log('[staleness] manufacturing DXF CIRCLE count:', circleCount, 'dxf entries:', dxfEntryCount);
    expect(dxfEntryCount, 'zip must contain at least one .dxf entry').toBeGreaterThan(0);

    expect(pageErrors, 'no browser page errors during the flow').toHaveLength(0);
  },
);
