/**
 * E2E §6: Edge-band gross cut-list sizes + new CSV columns.
 *
 * DONE-CRITERIA (all must pass):
 *  1. Build a base cabinet through the REAL CabinetDialog with a band material
 *     that has bandThicknessMm: 2.
 *  2. Trigger the REAL "Export CSV" button in the Cut List tab.
 *  3. Decode the probe `window.__zilventorCutListCsvBytes`.
 *  4. Assert the CSV header contains the exact gross-column header string.
 *  5. Assert at least one banded panel row has Gross W = net W + 2.
 *  6. Zero browser console errors (filter ResizeObserver / favicon noise).
 *
 * FALSE-GREEN guard: we exercise CabinetDialog submit → cabinet built →
 * cut-list aggregated by live useCutListResult → real Export CSV button →
 * CSV bytes. We do NOT construct a synthetic CutListResult.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

const CARCASS_ID   = 'm-carcass-18';
const CARCASS_T    = 18;
const BAND_ID      = 'm-band-2mm';
const BAND_T_MM    = 2;   // the bandThicknessMm we expect to see in grossW delta

const EXPECTED_HEADER =
  'Item#,QTY,Material,L (mm),W (mm),Gross L (mm),Gross W (mm),T (mm),Grain,Front,Back,Left,Right,Part Name,Part Path';

test(
  'edgeband-gross-cutlist: CabinetDialog → Export CSV → header has Gross columns, banded row grossW = netW + 2',
  async ({ page }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(120_000);

    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      console.log('BROWSER:', m.type(), m.text());
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => {
      console.log('PAGEERROR:', e.message);
      consoleErrors.push(`PAGEERROR: ${e.message}`);
    });

    // ── 1. Boot ──────────────────────────────────────────────────────────────────
    await page.goto('/');
    await waitForKernelReady(page);

    // ── 2. New assembly ──────────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'File' }).click();
    await page.getByRole('button', { name: /new assembly/i }).click();
    await page.waitForFunction(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
      };
      return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
    });
    console.log('[edgeband] new assembly created');

    // ── 3. Register carcass + band materials ─────────────────────────────────────
    await page.evaluate(
      (args: { carcassId: string; carcassT: number; bandId: string; bandT: number }) => {
        const w = window as unknown as {
          __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
        };
        const store = w.__zilventorStore.getState();
        store.addMaterial({
          id: args.carcassId,
          name: 'Birch 18',
          defaultThickness: args.carcassT,
          color: '#d8c896',
        });
        store.addMaterial({
          id: args.bandId,
          name: 'PVC 2mm',
          defaultThickness: 1,
          color: '#222222',
          bandThicknessMm: args.bandT,
        });
      },
      { carcassId: CARCASS_ID, carcassT: CARCASS_T, bandId: BAND_ID, bandT: BAND_T_MM },
    );
    console.log('[edgeband] materials registered');

    // ── 4. Open CabinetDialog via Furniture tab → "Base Cabinet" button ──────────
    await page.getByRole('tab', { name: 'Furniture' }).click();
    await page.getByRole('button', { name: 'Base Cabinet' }).click();

    // Dialog should appear with aria-label "Cabinet" (from t('aria.cabinet')).
    const dialog = page.getByRole('dialog', { name: 'Cabinet' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    console.log('[edgeband] CabinetDialog opened');

    // ── 5. Fill dialog fields ────────────────────────────────────────────────────
    // Carcass material
    await dialog.getByLabel('Carcass material').selectOption(CARCASS_ID);
    // Back material — use carcass material (thick-board back is fine for the test)
    await dialog.getByLabel('Back material').selectOption(CARCASS_ID);
    // Edge band material — the critical field
    await dialog.getByLabel('Edge band material').selectOption(BAND_ID);
    // Dimensions — defaults (600×560×720) are valid; no need to change them.
    // Verify no validation errors before submitting.
    const okBtn = dialog.getByRole('button', { name: 'OK' });
    await expect(okBtn).toBeEnabled({ timeout: 5_000 });

    console.log('[edgeband] dialog fields filled, clicking OK');
    await okBtn.click();

    // Dialog closes after successful submit.
    await expect(dialog).not.toBeVisible({ timeout: 60_000 });
    console.log('[edgeband] CabinetDialog closed — cabinet created');

    // ── 6. Wait for assembly to contain cabinet components ───────────────────────
    await page.waitForFunction(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeAssembly?: { components: unknown[] } | null };
        };
      };
      return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) >= 1;
    }, undefined, { timeout: 30_000 });
    console.log('[edgeband] assembly has components');

    // ── 7. Warm the panel-spec cache ─────────────────────────────────────────────
    await page.evaluate(async () => {
      const w = window as unknown as { __zilventorLoadCutListSpecs?: () => Promise<void> };
      await w.__zilventorLoadCutListSpecs?.();
    });
    console.log('[edgeband] panel spec cache warmed');

    // ── 8. Navigate to Cut List tab ──────────────────────────────────────────────
    // The BrowserPane is in the left sidebar. The Cut List tab button has
    // aria-label "Cut List tab" (t('aria.cut_list_tab') = "Cut List tab").
    await page.getByRole('button', { name: 'Cut List tab' }).click();
    console.log('[edgeband] Cut List tab activated');

    // Wait for at least one cut-list row to render.
    await page.waitForSelector('[data-cutlist-row]', { timeout: 30_000 });
    console.log('[edgeband] cut-list rows visible in DOM');

    // ── 9. Click "Export CSV" button ─────────────────────────────────────────────
    // There are multiple "Export CSV" buttons in the UI (FurnitureTab + BrowserPane).
    // We specifically want the one inside the BrowserPane cut-list table.
    const exportBtn = page.getByTestId('browser-pane').getByRole('button', { name: 'Export CSV' });
    await expect(exportBtn).toBeEnabled({ timeout: 10_000 });
    await exportBtn.click();
    console.log('[edgeband] Export CSV button clicked');

    // ── 10. Read CSV bytes from the probe ────────────────────────────────────────
    // ExportCutListCsvCommand sets globalThis.__zilventorCutListCsvBytes BEFORE
    // calling showSaveFilePicker, so the probe is always populated synchronously.
    const csvText = await page.evaluate(async () => {
      // Give the command's apply() a moment to complete (it's async but fires quickly).
      await new Promise<void>((r) => setTimeout(r, 500));
      const w = window as unknown as { __zilventorCutListCsvBytes?: Uint8Array };
      const bytes = w.__zilventorCutListCsvBytes;
      if (!bytes) return null;
      return new TextDecoder().decode(bytes);
    });

    expect(csvText, '__zilventorCutListCsvBytes must be set after Export CSV click').not.toBeNull();
    const csv = csvText!;

    // Print first few lines for evidence.
    const lines = csv.split('\n').filter((l) => l.trim() !== '');
    console.log('[edgeband] CSV header:', lines[0]);
    console.log('[edgeband] CSV line 2:', lines[1] ?? '(none)');

    // ── 11. Assert CSV header ─────────────────────────────────────────────────────
    const header = lines[0]!;
    expect(
      header,
      `CSV header must contain gross columns. Got: ${header}`,
    ).toBe(EXPECTED_HEADER);
    console.log('[edgeband] header assertion PASS');

    // ── 12. Assert at least one banded panel row has Gross W = net W + 2 ─────────
    // Header column indices:
    //   0=Item#, 1=QTY, 2=Material, 3=L(mm), 4=W(mm), 5=Gross L(mm), 6=Gross W(mm),
    //   7=T(mm), 8=Grain, 9=Front, 10=Back, 11=Left, 12=Right, 13=Part Name, 14=Part Path
    const dataLines = lines.slice(1);
    let foundBandedRow = false;
    let matchRow: string | null = null;
    let matchNetW: number | null = null;
    let matchGrossW: number | null = null;

    for (const line of dataLines) {
      // Skip section headers (Edge Band Material, # Hardware, etc.) and
      // non-data rows that start with non-numeric characters.
      if (!/^\d/.test(line)) continue;

      const cols = splitCsvLine(line);
      if (cols.length < 7) continue;

      const netW   = parseFloat(cols[4]!);
      const grossW = parseFloat(cols[6]!);
      if (isNaN(netW) || isNaN(grossW)) continue;

      // The front-banded panels (sides, top, bottom, shelf) get a front band of
      // thickness 2mm. grossWidth = width + front.thickness + back.thickness
      // = width + 2 + 0 = width + 2.
      if (Math.abs(grossW - (netW + BAND_T_MM)) < 0.001) {
        foundBandedRow = true;
        matchRow = line;
        matchNetW = netW;
        matchGrossW = grossW;
        break;
      }
    }

    console.log('[edgeband] banded row search result:', foundBandedRow ? 'FOUND' : 'NOT FOUND');
    if (matchRow) {
      console.log('[edgeband] matched row:', matchRow);
      console.log(`[edgeband] netW=${matchNetW} grossW=${matchGrossW} delta=+${BAND_T_MM}`);
    }

    expect(
      foundBandedRow,
      `At least one CSV data row must have Gross W == net W + ${BAND_T_MM}. ` +
      `Data rows checked:\n${dataLines.filter((l) => /^\d/.test(l)).join('\n')}`,
    ).toBe(true);

    console.log('[edgeband] banded row assertion PASS');

    // ── 13. Zero browser errors ───────────────────────────────────────────────────
    const realErrors = consoleErrors.filter(
      (e) =>
        !e.includes('ResizeObserver') &&
        !e.includes('favicon') &&
        !e.includes('showSaveFilePicker'),
    );
    if (realErrors.length > 0) {
      console.log('[edgeband] REAL BROWSER ERRORS:', realErrors);
    }
    expect(realErrors, 'no browser errors during edge-band gross CSV e2e flow').toHaveLength(0);
  },
);

/**
 * Minimal CSV line splitter that handles quoted fields.
 * Does NOT handle embedded newlines — sufficient for a single CSV line.
 */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === ',' && !inQuote) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}
