/**
 * E2E §6: Parametric configurator — RuleEngine wiring (Milestone 2.3).
 *
 * Proves the conditional-rule engine is live in the real app bundle AND that the
 * App.tsx wiring loads a part's rules on activePart change, so a trigger-parameter
 * change cascades a thenSet assignment BEFORE execute.
 *
 * PROBE STRATEGY (headless viewport is BLACK — store/registry probes only):
 *   1. Create a New Part (gives a real activePart with an id + the module-level
 *      ParameterRegistry/RuleEngine singletons wired exactly as in production).
 *   2. Faithful wiring path: replace activePart via __zilventorStore.setActivePart
 *      with a NEW id carrying width/shelfCount parameters and ONE rule
 *      (trigger width, condition width>600, thenSet shelfCount=3). The id change
 *      makes App.tsx's part-sync effect repopulate the registry AND call
 *      ruleEngine.load(activePart.rules) — the integration under test.
 *   3. Trigger FALSE: set width=550 via the production registry → shelfCount stays 1.
 *   4. Trigger TRUE: set width=700 → the rule fires → shelfCount becomes 3.
 *   5. No unexpected browser errors.
 *
 * The trigger is driven through __zilventorParameterRegistry.setParameter — the same
 * production singleton the Parameters panel mutates — and the rules arrive via the
 * real setActivePart effect, so this is not a stubbed command path.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

test('rule-engine: activePart rules load on part change; trigger fires thenSet', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(60_000);

  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  await page.goto('/');
  await waitForKernelReady(page);

  // Create a real part so there is an activePart to clone.
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as Record<string, any>;
    return !!w.__zilventorStore?.getState().activePart;
  });

  // Replace activePart with a new id carrying parameters + one rule. The id change
  // drives App.tsx's part-sync effect → registry repopulation + ruleEngine.load(rules).
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    const store = w.__zilventorStore.getState();
    const cur = store.activePart;
    const newPart = {
      ...cur,
      id: `${cur.id}-rules`,
      parameters: {
        width: { name: 'width', expression: '500', value: 500, unit: 'mm' },
        shelfCount: { name: 'shelfCount', expression: '1', value: 1, unit: 'mm' },
      },
      rules: [
        {
          id: 'r1',
          trigger: ['width'],
          condition: 'width > 600',
          thenSet: [{ target: 'shelfCount', expression: '3' }],
        },
      ],
    };
    store.setActivePart(newPart);
  });

  // Wait for the part-sync effect to repopulate the registry from the new part.
  await page.waitForFunction(() => {
    const w = window as unknown as Record<string, any>;
    return w.__zilventorParameterRegistry?.getValue('width') === 500
        && w.__zilventorParameterRegistry?.getValue('shelfCount') === 1;
  });

  // FALSE branch: width still ≤ 600 → rule does not fire.
  const falseShelf = await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.__zilventorParameterRegistry.setParameter({ name: 'width', expression: '550', unit: 'mm' });
    return w.__zilventorParameterRegistry.getValue('shelfCount');
  });
  expect(falseShelf).toBe(1);

  // TRUE branch: width > 600 → rule fires → shelfCount = 3.
  const trueShelf = await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.__zilventorParameterRegistry.setParameter({ name: 'width', expression: '700', unit: 'mm' });
    return w.__zilventorParameterRegistry.getValue('shelfCount');
  });
  expect(trueShelf).toBe(3);

  // No unexpected browser errors (ignore benign ResizeObserver noise).
  const unexpected = consoleErrors.filter((e) => !/ResizeObserver/.test(e));
  expect(unexpected, `unexpected console errors:\n${unexpected.join('\n')}`).toEqual([]);
});
