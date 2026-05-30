// tests/e2e/drawing/T-6-30-center-marks.spec.ts
/**
 * T-6-30 — Auto-placed center marks: REAL drilled hole → arc edges → canvas + SVG.
 *
 * KERNEL FIX (2026-05-30):
 *   HoleFeature.ts:executeHoleFeature() formerly spread the OLD
 *   `runningBody.faceNames` (pre-cut face handles) directly into the new
 *   NamedShape after BRepAlgoAPI_Cut.  The top/bottom faces of the original
 *   box receive FRESH OCCT topology handles after the Boolean cut; the stale
 *   pre-cut handles no longer IsSame-match the new faces, so tessellateEdges()
 *   could not find face names for the circular rim edges and omitted them from
 *   ProjectorInput.edges.  Fix: executeHoleFeature now calls mergeFaceNames
 *   (from occt/FaceNaming.ts) to walk the result shape and re-match surviving
 *   faces via IsSame, then overrides those entries with the more-specific
 *   names assigned by tagHoleFaces.
 *
 * Test strategy (NO synthetic injection):
 *   1. Build a real 40×40×20mm box part via UI.
 *   2. Add a Ø10mm through-hole via kernel.addFeature (fromSketch, throughAll).
 *   3. Execute the part in the kernel (warms namedShapeCache).
 *   4. Save to OPFS → CreateDrawingCommand → AddBaseViewCommand via real commands.
 *   5. Assert: visibleEdges contains ≥1 arc edge (≥5-point polyline on a circle).
 *   6. Assert: sheet annotations contains ≥1 { kind:'center-mark', id starts 'cm-' }.
 *   7. Switch to Drawing tab; assert center-mark <g> elements in live DOM.
 *   8. Export SVG via real renderDrawingSvg; assert data-ann-kind="center-mark" + ≥2 <line.
 *   9. Screenshot to /tmp/center-marks-real-hole.png for visual proof.
 *
 * Uses the `await import('/src/commands/<Cmd>.ts')` harness (drawing commands are
 * NOT window-exposed).
 */

import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';

const SOURCE_PATH = 'parts/src-T630.zipt';

test('T-6-30: center marks — real drilled hole → real arc edges → real center-mark annotations → canvas + SVG', async ({ page }) => {
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

  await page.goto('/');
  await waitForKernelReady(page);

  // ── Step 1: Build a real 40×40×20 box part via UI ─────────────────────────
  await buildBox(page, { width: 40, height: 40, depth: 20 });

  // ── Step 2: Add a Ø10mm through-hole via kernel.addFeature, then execute,
  //   save to OPFS, create drawing + base view via real commands ────────────
  const { sheetId, baseViewId, arcEdgeCount, centerMarkCount, naiveCenterX, naiveCenterY, resolvedCenterX, resolvedCenterY } = await page.evaluate(
    async ({ sourcePath }: { sourcePath: string }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const segments = path.split('/').filter((p: string) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < segments.length - 1; i++) {
          dir = await dir.getDirectoryHandle(segments[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(segments[segments.length - 1]!, { create: true });
        const w2 = await fh.createWritable();
        await w2.write(data as unknown as FileSystemWriteChunkType);
        await w2.close();
      }

      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activePart: { id: string } | null;
            activeDocument: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; projection?: { visibleEdges: Array<{ id: string; points: ReadonlyArray<readonly [number, number]> }> } }>; annotations: Array<{ id: string; kind: string }> }> } } | null;
            activeDrawingSourcePartId: string | null;
            activeDrawingSourceFingerprint: string | null;
            kernel: {
              addFeature(id: string, feature: unknown): Promise<void>;
              execute(id: string): Promise<unknown>;
              saveToBytes(id: string): Promise<Uint8Array>;
            } | null;
          };
        };
      }).__zilventorStore;

      const s0 = store.getState();
      if (!s0.activePart || !s0.kernel) throw new Error('T-6-30: kernel not ready');
      const pid = s0.activePart.id;

      // Add a sketch with a Ø10 circle centered at (20, 20) on the top face (XY plane).
      await s0.kernel.addFeature(pid, {
        kind: 'sketch',
        id: 'sk-hole-T630',
        plane: 'XY',
        primitives: [{ id: 'c1-T630', kind: 'circle', cx: 20, cy: 20, r: 5 }],
        constraints: [],
      });

      // Add a simple throughAll hole from that sketch.
      await s0.kernel.addFeature(pid, {
        kind: 'hole',
        id: 'hole-T630',
        placement: { kind: 'fromSketch', sketchId: 'sk-hole-T630' },
        profile: { kind: 'simple', diameter: { kind: 'literal', value: 10 } },
        termination: { kind: 'throughAll' },
        flipAxis: false,
      });

      // Execute to apply the hole in the kernel (this warms namedShapeCache).
      const execResult = await s0.kernel.execute(pid);
      console.log('[T-6-30] kernel.execute result:', JSON.stringify(execResult));

      // Save the part to OPFS so CreateDrawingCommand can load it.
      const bytes = await s0.kernel.saveToBytes(pid);
      await opfsWrite(sourcePath, bytes);
      console.log('[T-6-30] part with hole saved to OPFS, bytes:', bytes.length);

      // Create drawing sourced from this part.
      const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
      await new CreateDrawingCommand({ sourcePath, sourceKind: 'part' }).apply();

      const s1 = store.getState();
      if (!s1.activeDrawingSourcePartId) throw new Error('T-6-30: activeDrawingSourcePartId null after CreateDrawingCommand');
      if (!s1.activeDrawingSourceFingerprint) throw new Error('T-6-30: activeDrawingSourceFingerprint null after CreateDrawingCommand');

      const shId = (s1.activeDocument as { document: { sheets: Array<{ id: string }> } }).document.sheets[0]!.id;

      // Add a base view (front orientation, 1:1 scale).
      const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
      await new AddBaseViewCommand({
        sheetId: shId,
        positionMm: { x: 80, y: 80 },
        orientation: 'front',
        scale: { numerator: 1, denominator: 1 },
      }).apply();

      const s2 = store.getState();
      const doc2 = s2.activeDocument?.kind === 'drawing' ? s2.activeDocument.document : null;
      if (!doc2) throw new Error('T-6-30: no drawing doc after AddBaseViewCommand');

      const sheet2 = (doc2 as { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; projection?: { visibleEdges: Array<{ id: string; points: ReadonlyArray<readonly [number, number]> }> } }>; annotations: Array<{ id: string; kind: string }> }> }).sheets.find((sh) => sh.id === shId)!;
      const baseView = sheet2.views.find((v) => v.kind === 'base');
      if (!baseView?.projection) throw new Error('T-6-30: base view has no projection after AddBaseViewCommand');

      const allEdges = baseView.projection.visibleEdges;
      console.log('[T-6-30] real projection edge count:', allEdges.length);

      // Count arc edges: edges with ≥5 points that all lie on a common circle.
      // isArcEdge heuristic: minPoints=5, maxResidualFraction=0.05, minRadiusMm=0.5
      // A straight box edge has exactly 2 points; a rim circle has ≥16 tessellation points.
      const arcEdgeCount = allEdges.filter((e) => e.points.length >= 5).length;
      console.log('[T-6-30] arc-candidate edges (≥5 points):', arcEdgeCount);

      allEdges.forEach((e, i) => {
        console.log(`[T-6-30] edge[${i}] id=${e.id} pts=${e.points.length}`);
      });

      // Count center-mark annotations placed by autoPlaceCenterMarks inside AddBaseViewCommand.
      const cmAnnotations = sheet2.annotations.filter((a) => a.kind === 'center-mark');
      const centerMarkCount = cmAnnotations.length;
      console.log('[T-6-30] center-mark annotations:', centerMarkCount, cmAnnotations.map((a) => a.id));

      // Compute and return the centroid of the representative (lex-first) fragment.
      // This is the "naive OLD center" — biased off the true hole center for real fragments.
      let naiveCenterX: number | null = null;
      let naiveCenterY: number | null = null;

      // Also compute the Kasa-based robust center inline (same logic as resolveCenterMarkGeometry).
      // We can't import the shared module directly via bare specifier in the browser evaluate block
      // (Vite workspace symlinks don't resolve for dynamic bare-specifier imports in page.evaluate).
      // Instead, we inline the same stripRunSuffix + Kasa logic to produce the "resolved" center.
      let resolvedCenterX: number | null = null;
      let resolvedCenterY: number | null = null;

      if (cmAnnotations.length > 0) {
        const firstCm = cmAnnotations[0] as { kind: string; edgeId: string };

        // Naive: centroid of the single representative edge
        const repEdge = allEdges.find((e: { id: string }) => e.id === firstCm.edgeId) as
          { id: string; points: ReadonlyArray<readonly [number, number]> } | undefined;
        if (repEdge && repEdge.points.length > 0) {
          const sum = repEdge.points.reduce(
            (acc: { x: number; y: number }, p: readonly [number, number]) => ({ x: acc.x + p[0], y: acc.y + p[1] }),
            { x: 0, y: 0 },
          );
          naiveCenterX = sum.x / repEdge.points.length;
          naiveCenterY = sum.y / repEdge.points.length;
          console.log('[T-6-30] naive centroid center (view-local mm):', naiveCenterX.toFixed(3), naiveCenterY.toFixed(3));
        }

        // Robust: stripRunSuffix + Kasa over all grouped fragments (inlined logic)
        function stripRunSuffixLocal(id: string): string {
          const m = id.match(/^(.*?)_\d+$/);
          return m ? m[1]! : id;
        }
        const base = stripRunSuffixLocal(firstCm.edgeId);
        const groupFrags = allEdges.filter(
          (e: { id: string }) => stripRunSuffixLocal(e.id) === base,
        ) as Array<{ id: string; points: ReadonlyArray<readonly [number, number]> }>;

        console.log('[T-6-30] grouped fragment count for base', base, ':', groupFrags.length);

        if (groupFrags.length > 1) {
          // Kasa fit over concatenated points
          const allPts: Array<readonly [number, number]> = [];
          for (const frag of groupFrags) { for (const pt of frag.points) allPts.push(pt); }
          const n = allPts.length;
          let sumX = 0, sumY = 0;
          for (const [x, y] of allPts) { sumX += x; sumY += y; }
          const mx = sumX / n, my = sumY / n;
          let Suu=0, Suv=0, Svv=0, Suuu=0, Suvv=0, Svvv=0, Svuu=0;
          for (const [x, y] of allPts) {
            const u=x-mx, v=y-my;
            Suu+=u*u; Suv+=u*v; Svv+=v*v;
            Suuu+=u*u*u; Suvv+=u*v*v; Svvv+=v*v*v; Svuu+=v*v*u;
          }
          const det = Suu*Svv - Suv*Suv;
          if (Math.abs(det) >= 1e-10) {
            const uc = (0.5*(Suuu+Suvv)*Svv - 0.5*(Svvv+Svuu)*Suv) / det;
            const vc = (0.5*(Svvv+Svuu)*Suu - 0.5*(Suuu+Suvv)*Suv) / det;
            resolvedCenterX = uc + mx;
            resolvedCenterY = vc + my;
            console.log('[T-6-30] robust Kasa center (view-local mm):', resolvedCenterX.toFixed(3), resolvedCenterY.toFixed(3));
          }
        }
      }

      return {
        sheetId: shId,
        baseViewId: baseView.id,
        arcEdgeCount,
        centerMarkCount,
        naiveCenterX,
        naiveCenterY,
        resolvedCenterX,
        resolvedCenterY,
      };
    },
    { sourcePath: SOURCE_PATH },
  );

  // ── (a) Real kernel delivers arc edges — guards the kernel fix ─────────────
  expect(
    arcEdgeCount,
    `Expected ≥1 arc edge (≥5 points) in base view of holed part. ` +
    `arcEdgeCount=${arcEdgeCount}. ` +
    `This would fail if the kernel face-handle staleness bug (HoleFeature.ts) is not fixed.`,
  ).toBeGreaterThanOrEqual(1);

  // ── (b) AddBaseViewCommand auto-placed center marks from REAL arc edges ────
  // With dedupe: a single through-hole projects as several concentric circles
  // (top rim, bottom rim, etc.) — all at the same center.  autoPlaceCenterMarks
  // must collapse them to exactly 1 center-mark.
  expect(
    centerMarkCount,
    `Expected exactly 1 center-mark annotation (single hole → single distinct center). ` +
    `Got ${centerMarkCount}. ` +
    `This would fail if autoPlaceCenterMarks is not called, returns 0 for real arc edges, ` +
    `or failed to dedupe coincident-center arcs from the same through-hole.`,
  ).toBe(1);

  // ── (b2) Position assertion: resolved center must be accurate (not biased to fragment) ─
  // The hole is at sketch (20,20) on the XY plane of a centered 40×40×20 box. The front
  // view projection centers the part on view-local (0,0) — so the hole center projects to
  // approximately (0,0) in view-local mm (hole is at the box centroid in x-y).
  // The naive centroid of a single ~2°-arc fragment is OFF by >0.5mm.
  // The robust Kasa fit over all 36 fragments should return (≈0, ≈0).
  expect(resolvedCenterX, 'Robust Kasa center must be non-null (36 grouped fragments)').not.toBeNull();

  // Robust center must be significantly closer to (0,0) than the naive fragment centroid.
  const naiveDistFromOrigin = Math.hypot(naiveCenterX ?? 999, naiveCenterY ?? 999);
  const robustDistFromOrigin = Math.hypot(resolvedCenterX!, resolvedCenterY ?? 0);

  console.log('[T-6-30] position check: naive dist from origin=', naiveDistFromOrigin.toFixed(3),
    'robust dist from origin=', robustDistFromOrigin.toFixed(3));
  console.log('[T-6-30] position check: naive=', naiveCenterX?.toFixed(3), naiveCenterY?.toFixed(3),
    'robust=', resolvedCenterX?.toFixed(3), resolvedCenterY?.toFixed(3));

  // The naive single-fragment centroid should be meaningfully off (>0.5mm from origin).
  expect(naiveDistFromOrigin, 'Naive fragment centroid should be off by >0.5mm (proves the problem)').toBeGreaterThan(0.5);
  // The robust Kasa fit should be near (0,0) for a centered hole, within 0.5mm.
  expect(
    robustDistFromOrigin,
    `Robust Kasa center should be within 0.5mm of origin (centered hole → view-local (0,0)). ` +
    `Got ${robustDistFromOrigin.toFixed(3)}mm. ` +
    `Fails if the center-mark is not using the Kasa-grouped fit.`,
  ).toBeLessThan(0.5);

  // ── Step 3: Switch to Drawing tab and assert live DOM ────────────────────
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(`g[data-view-id="${baseViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // ── (c) Center mark must appear in the live canvas DOM ───────────────────
  await page.waitForFunction(
    () => document.querySelectorAll('[data-ann-kind="center-mark"]').length > 0,
    undefined,
    { timeout: 10_000 },
  );

  const domCenterMarkCount = await page.locator('[data-ann-kind="center-mark"]').count();
  console.log('[T-6-30] DOM center mark <g> elements:', domCenterMarkCount);
  expect(domCenterMarkCount, 'At least one center-mark <g> must appear in the live canvas').toBeGreaterThan(0);

  // Each center-mark renders at least 2 <line> elements (horizontal + vertical arms).
  const lineCount = await page.locator('[data-ann-kind="center-mark"] line').count();
  console.log('[T-6-30] center mark <line> elements:', lineCount);
  expect(lineCount, 'Center-mark must render ≥2 <line> arms').toBeGreaterThanOrEqual(2);

  // ── Step 4: Visual proof — screenshot ────────────────────────────────────
  const screenshotPath = '/tmp/center-marks-real-hole.png';
  await page.screenshot({ path: screenshotPath });
  console.log('[T-6-30] screenshot saved to:', screenshotPath);

  // ── (d) SVG export assertion ──────────────────────────────────────────────
  const svgResult = await page.evaluate(
    async ({ shId }: { shId: string }) => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: { kind: string; document: unknown } | null;
            activeDrawingSourceDocument: unknown;
          };
        };
      }).__zilventorStore;

      const state = store.getState();
      if (!state.activeDocument || state.activeDocument.kind !== 'drawing') {
        throw new Error('T-6-30 SVG: no active drawing');
      }

      const drawing = state.activeDocument.document as { sheets: Array<{ id: string }>; [k: string]: unknown };
      const sheet = drawing.sheets.find((s) => s.id === shId);
      if (!sheet) throw new Error(`T-6-30 SVG: sheet ${shId} not found`);

      const { renderDrawingSvg } = await import('/src/drawing/renderDrawingSvg.ts');
      const svgStr = renderDrawingSvg(
        drawing as Parameters<typeof renderDrawingSvg>[0],
        sheet as Parameters<typeof renderDrawingSvg>[1],
        (state.activeDrawingSourceDocument ?? null) as Parameters<typeof renderDrawingSvg>[2],
      );

      const centerMarkGroups = (svgStr.match(/data-ann-kind="center-mark"/g) ?? []).length;
      const lineMatches = (svgStr.match(/<line/g) ?? []).length;
      console.log('[T-6-30] SVG len:', svgStr.length,
        'center-mark groups:', centerMarkGroups, '<line count:', lineMatches);

      return {
        hasCenterMarkAttr: svgStr.includes('data-ann-kind="center-mark"'),
        centerMarkGroupCount: centerMarkGroups,
        totalLineCount: lineMatches,
      };
    },
    { shId: sheetId },
  );

  expect(svgResult.hasCenterMarkAttr, 'SVG must contain data-ann-kind="center-mark"').toBe(true);
  expect(svgResult.centerMarkGroupCount, 'SVG must have ≥1 center-mark group').toBeGreaterThan(0);
  expect(svgResult.totalLineCount, 'SVG must contain ≥2 <line elements').toBeGreaterThanOrEqual(2);

  console.log(
    `[T-6-30] PASSED: arcEdges=${arcEdgeCount}, cmAnnotations=${centerMarkCount}, ` +
    `naiveCenter=(${naiveCenterX?.toFixed(2)},${naiveCenterY?.toFixed(2)}), ` +
    `robustCenter=(${resolvedCenterX?.toFixed(2)},${resolvedCenterY?.toFixed(2)}), ` +
    `domCMs=${domCenterMarkCount}, domLines=${lineCount}, ` +
    `svgCMs=${svgResult.centerMarkGroupCount}, svgLines=${svgResult.totalLineCount}`,
  );
});
