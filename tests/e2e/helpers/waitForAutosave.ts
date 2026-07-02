// tests/e2e/helpers/waitForAutosave.ts
import type { Page } from '@playwright/test';

/**
 * Wait until the OPFS autosave has caught up with the last store mutation.
 * Strategy: poll-until-idle on two combined signals rather than assuming a
 * fixed delay is enough:
 *
 *  1. `window.__zilventorAutosaveStats().writeCount` incrementing beyond its
 *     starting value — a fresh write definitely landed.
 *  2. `window.__zilventorStore.getState().saveState` staying out of
 *     'saving' continuously for a settle window (> the 500ms debounce) —
 *     proves no write is in flight or about to start.
 *
 * Signal 2 matters because under heavy batch/parallel CPU load the debounced
 * write can complete *before* this helper starts polling (the caller reaches
 * `waitForAutosave` well after the triggering mutation, e.g. after several
 * intervening assertions). In that case `writeCount` has already advanced
 * past its pre-mutation value and will never increment again, so waiting for
 * "increment beyond a snapshot taken now" alone hangs forever even though
 * the state is already saved. Requiring writeCount to increment OR the
 * saveState to have been stably non-'saving' for the settle window handles
 * both the "write still pending" and "write already completed" cases.
 *
 * Falls back to a fixed 700ms wait if __zilventorAutosaveStats is not exposed
 * (provides a baseline for environments where the stats hook is not installed).
 */
export async function waitForAutosave(page: Page, timeoutMs = 20_000): Promise<void> {
  const statsAvailable: boolean = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorAutosaveStats?: () => { writeCount: number };
    };
    return typeof w.__zilventorAutosaveStats === 'function';
  });

  if (!statsAvailable) {
    // Baseline fallback: 700ms covers the 500ms debounce with margin.
    await page.waitForTimeout(700);
    return;
  }

  const writtenBefore: number = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorAutosaveStats?: () => { writeCount: number };
    };
    return w.__zilventorAutosaveStats?.()?.writeCount ?? 0;
  });

  const settleMs = 700; // > the 500ms debounce, with margin.
  const deadline = Date.now() + timeoutMs;
  let stableSince: number | null = null;

  while (Date.now() < deadline) {
    const { writeCount, saveState } = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorAutosaveStats?: () => { writeCount: number };
        __zilventorStore?: { getState: () => { saveState?: string } };
      };
      return {
        writeCount: w.__zilventorAutosaveStats?.()?.writeCount ?? 0,
        saveState: w.__zilventorStore?.getState?.()?.saveState,
      };
    });

    if (writeCount > writtenBefore) return;

    if (saveState === 'saving') {
      stableSince = null;
    } else {
      if (stableSince === null) stableSince = Date.now();
      if (Date.now() - stableSince >= settleMs) return;
    }

    await page.waitForTimeout(100);
  }

  throw new Error(`waitForAutosave: no autosave write detected within ${timeoutMs}ms`);
}
