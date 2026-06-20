/**
 * E2E §6: Parametric configurator — feature suppression wiring (Milestone 2.4).
 *
 * Proves the full production path is live in the real app bundle:
 *   rule fires (trigger param change) → RuleEngine thenSuppress toggle →
 *   App.tsx suppression handler → kernelClient.suppressFeature + store mirror.
 *
 * The real-OCCT geometry effect (suppressed groove → volume restored) is proven by
 * the kernel integration test (FeatureSuppression.integration.spec.ts). Here we
 * prove the WIRING reaches the kernel's part document, bidirectionally, through the
 * production singletons (registry + RuleEngine + setActivePart effect).
 *
 * PROBE STRATEGY (headless viewport is BLACK — store/kernel probes only):
 *   1. New Part → real activePart + registered kernel part + wired singletons.
 *   2. Register a cloned part (new id) carrying a panel + groove featureTree, a
 *      `width` parameter, and ONE rule (trigger width, condition width>600,
 *      thenSuppress ['gr-1']). setActivePart's id change drives App.tsx's part-sync
 *      effect → ruleEngine.load(rules).
 *   3. TRUE branch: width=700 → rule fires → groove suppressed on BOTH the kernel
 *      part (getPart) and the store part.
 *   4. FALSE branch: width=500 → rule un-suppresses → absent on both (toggle).
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

test('feature-suppression: rule thenSuppress toggles the kernel + store part', async ({ page }) => {
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

  // Register a new part (panel + groove) carrying a thenSuppress rule, then activate
  // it. registerPart makes the kernel aware of it so suppressFeature/execute resolve.
  await page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    const store = w.__zilventorStore.getState();
    const cur = store.activePart;
    const newPart = {
      ...cur,
      id: `${cur.id}-sup`,
      parameters: {
        width: { name: 'width', expression: '500', value: 500, unit: 'mm' },
      },
      featureTree: [
        ...cur.featureTree,
        {
          kind: 'panel', id: 'pf-1',
          length: { kind: 'literal', value: 600 },
          width: { kind: 'literal', value: 400 },
          thickness: { kind: 'literal', value: 18 },
          thicknessFromMaterial: true,
          materialId: 'mat-1',
          grain: 'length',
          edgeBands: { front: null, back: null, left: null, right: null },
        },
        { kind: 'groove', id: 'gr-1', faceRole: 'Top', axis: 'u', position: 200, width: 6, depth: 9 },
      ],
      rules: [
        { id: 'r1', trigger: ['width'], condition: 'width > 600', thenSet: [], thenSuppress: ['gr-1'] },
      ],
    };
    await store.kernel.registerPart(newPart);
    store.setActivePart(newPart);
  });

  // Part-sync effect repopulated the registry from the new part.
  await page.waitForFunction(() => {
    const w = window as unknown as Record<string, any>;
    return w.__zilventorParameterRegistry?.getValue('width') === 500;
  });

  // TRUE branch: width > 600 → rule fires → groove suppressed on kernel + store.
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.__zilventorParameterRegistry.setParameter({ name: 'width', expression: '700', unit: 'mm' });
  });
  await page.waitForFunction(() => {
    const w = window as unknown as Record<string, any>;
    const p = w.__zilventorStore.getState().activePart;
    return Array.isArray(p?.suppressedFeatureIds) && p.suppressedFeatureIds.includes('gr-1');
  });
  const kernelSuppressed = await page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    const p = w.__zilventorStore.getState().activePart;
    const kp = await w.__zilventorStore.getState().kernel.getPart(p.id);
    return kp?.suppressedFeatureIds ?? [];
  });
  expect(kernelSuppressed).toContain('gr-1');

  // FALSE branch: width ≤ 600 → rule un-suppresses (toggle) → absent on both.
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.__zilventorParameterRegistry.setParameter({ name: 'width', expression: '500', unit: 'mm' });
  });
  await page.waitForFunction(() => {
    const w = window as unknown as Record<string, any>;
    const p = w.__zilventorStore.getState().activePart;
    const ids = p?.suppressedFeatureIds ?? [];
    return !ids.includes('gr-1');
  });
  const kernelAfterToggle = await page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    const p = w.__zilventorStore.getState().activePart;
    const kp = await w.__zilventorStore.getState().kernel.getPart(p.id);
    return kp?.suppressedFeatureIds ?? [];
  });
  expect(kernelAfterToggle).not.toContain('gr-1');

  const unexpected = consoleErrors.filter((e) => !/ResizeObserver/.test(e));
  expect(unexpected, `unexpected console errors:\n${unexpected.join('\n')}`).toEqual([]);
});
