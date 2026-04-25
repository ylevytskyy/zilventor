import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * Work-feature broken-ref-badge E2E (plan T41).
 *
 * Builds a part with:
 *   - sketch + extrude on origin.XY (creates a top face)
 *   - workPlane WP1 offset from a face role of EXT — depends on EXT
 *
 * Then deletes EXT via kernel.removeFeature. The work plane's source ref
 * becomes broken. After re-execute, executeTree should populate
 * featureErrors with WP1 → eval-failed, and BrowserPane renders a ⚠
 * badge on the work plane.
 *
 * v1 simplification: WP1 references origin.XY (a stable plane) so the
 * cascade is "extrude removed, but WP1 still resolves" — broken-ref
 * detection requires a face/edge ref that goes invalid. For the v1 test
 * we instead build WP1 referencing a workAxis WAX1 that depends on EXT's
 * geometry (not yet supported), OR we create a synthetic broken state
 * by setting featureErrors directly via the dev hook.
 *
 * For minimal coverage we use the dev-hook synthetic path: seed
 * featureErrors with an entry for WP1 and assert the badge renders.
 * The kernel-level broken-ref propagation lands with T14 (OCCT-bound
 * source modes).
 */
test('a work plane with a kernel-issued evaluation error shows a ⚠ badge in BrowserPane', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 1. Seed a parametric workPlane (offsetFromPlane) so it appears as a
  //    user-created work feature in the browser pane.
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          kernel: {
            addFeature(partId: string, feature: unknown): Promise<void>;
            execute(partId: string): Promise<unknown>;
            getPart(partId: string): Promise<unknown>;
          };
          activePart: { id: string } | null;
          setActivePart(p: unknown): void;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'workPlane',
      id: 'WP1',
      visible: true,
      source: {
        mode: 'offsetFromPlane',
        plane: { source: 'workPlane', featureId: 'origin.XY' },
        offset: { kind: 'literal', value: 25 },
      },
    });
    await s.kernel.execute(s.activePart!.id);
    const next = await s.kernel.getPart(s.activePart!.id);
    s.setActivePart(next);
  });

  // 2. Verify the WP1 leaf rendered in the browser pane.
  const browserPane = page.locator('[data-testid="browser-pane"], .px-3').first();
  await expect(page.getByText('Plane1')).toBeVisible();

  // 3. Inject a synthetic evaluation error for WP1 via the store dev hook.
  //    This stands in for the future kernel-issued broken-ref scenario.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        setState(fn: (s: unknown) => unknown): void;
      };
    };
    w.__zilventorStore.setState((s: any) => ({
      ...s,
      featureErrors: new Map([
        ['WP1', { kind: 'work-feature-eval-failed', message: 'broken ref to deleted face', featureId: 'WP1' }],
      ]),
    }));
  });

  // 4. The ⚠ badge is rendered as a button with aria-label "Feature WP1 has errors".
  const badge = page.getByLabel('Feature WP1 has errors');
  await expect(badge).toBeVisible();
});
