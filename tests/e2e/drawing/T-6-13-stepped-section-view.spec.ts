// tests/e2e/drawing/T-6-13-stepped-section-view.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * T-6-13 — Stepped section view (Drawing F1.2): drive AddSectionViewCommand with
 * mode='stepped' via the real command flow. Cases 1–4 map to spec §10.2:
 *   Case 1: 2-jog canonical (3 segments) — assertions (i)–(vii)
 *   Case 2: 3-jog variant (4 segments)   — len/hatch/polyline-points
 *   Case 3: empty-cut error              — command throws, sheet.views unchanged
 *   Case 4: byte-size verification gate  — canvas DOM <polyline> count + PNG size
 *
 * Pattern mirrors T-6-10 (F1.1): the command may be dispatched through the
 * `bus` so that undo/redo work via `bus.undo()`/`bus.redo()` for assertions (vi)
 * and (vii). When kernel cut succeeds we proceed with the real command flow;
 * empty-cut paths surface the upstream batch error verbatim.
 */

test.describe('T-6-13 — Stepped section view (F1.2)', () => {
  // Cases 1–4 appended below in Tasks 5.2–5.5.
});
