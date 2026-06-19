/**
 * E2E §6: iPart configurations — ConfigurationsPanel wiring (Milestone 2.6).
 *
 * Proves the design-table UI is live in the real app bundle AND that activating a
 * configuration through the REAL panel (ribbon button → row click, not a stubbed
 * command) bulk-sets the active part's parameters through the production
 * ParameterRegistry singleton in one batched burst, and that "Add Row" persists a
 * new configuration onto the active part document.
 *
 * PROBE STRATEGY (headless viewport is BLACK — store/registry probes only):
 *   1. New Part → real activePart + wired module-level singletons.
 *   2. Replace activePart with a new id carrying width/height params + two configs.
 *      The id change drives App.tsx's part-sync effect → registry repopulation.
 *   3. Open the panel via the real ribbon "Configurations…" button.
 *   4. Click the "Large" row → activateConfiguration runs → width 500→900, height
 *      700→1200 in the production registry; the row shows aria-current.
 *   5. Click "Add Row" → a 3rd configuration is persisted on activePart capturing
 *      the now-current params (width=900).
 *   6. No unexpected browser errors.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

test('configurations: panel activates a config through the registry; Add Row persists', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(60_000);

  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  await page.goto('/');
  await waitForKernelReady(page);

  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as Record<string, any>;
    return !!w.__zilventorStore?.getState().activePart;
  });

  // Replace activePart with a new id carrying parameters + two configurations.
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    const store = w.__zilventorStore.getState();
    const cur = store.activePart;
    store.setActivePart({
      ...cur,
      id: `${cur.id}-configs`,
      parameters: {
        width: { name: 'width', expression: '500', value: 500, unit: 'mm' },
        height: { name: 'height', expression: '700', value: 700, unit: 'mm' },
      },
      configurations: [
        { name: 'Large', values: { width: '900', height: '1200' } },
        { name: 'Small', values: { width: '300', height: '400' } },
      ],
    });
  });

  await page.waitForFunction(() => {
    const w = window as unknown as Record<string, any>;
    return w.__zilventorParameterRegistry?.getValue('width') === 500
        && w.__zilventorParameterRegistry?.getValue('height') === 700;
  });

  // Open the panel via the REAL ribbon button.
  await page.getByRole('button', { name: /Configurations/ }).click();
  await expect(page.getByTestId('config-row-Large')).toBeVisible();

  // Activate "Large" by clicking its row → registry bulk-set.
  await page.getByTestId('config-row-Large').click();
  await page.waitForFunction(() => {
    const w = window as unknown as Record<string, any>;
    return w.__zilventorParameterRegistry?.getValue('width') === 900
        && w.__zilventorParameterRegistry?.getValue('height') === 1200;
  });
  await expect(page.getByTestId('config-row-Large')).toHaveAttribute('aria-current', 'true');

  // Add Row captures the now-current params (width=900) as a new configuration.
  await page.getByTestId('config-add-row').click();
  const after = await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    const configs = w.__zilventorStore.getState().activePart.configurations as Array<{ name: string; values: Record<string, string> }>;
    return { count: configs.length, last: configs[configs.length - 1] };
  });
  expect(after.count).toBe(3);
  expect(after.last.values.width).toBe('900');

  const unexpected = consoleErrors.filter((e) => !/ResizeObserver/.test(e));
  expect(unexpected, `unexpected console errors:\n${unexpected.join('\n')}`).toEqual([]);
});
