/**
 * E2E: присадка slice 5 — real-DOM-pointer drag-gizmo gate (Task H).
 *
 * THIS IS THE FALSE-GREEN GATE. It drives real page.mouse events (not probe shortcuts)
 * at the bore marker's screen coordinates from worldToScreen3d. If the drag handler
 * were unwired, the OrbitControls would NOT be disabled mid-drag and no MoveConnector
 * command would fire — both assertions would fail.
 *
 * Assertions (§9.C):
 *   (a) MoveConnectorCommand went through bus.execute (bus.lastExecutedName() === 'MoveConnector')
 *   (b1) u changed after drag (uAfter !== uBefore)
 *   (b2) undo restores (uUndo ≈ uBefore)  ← 3-step undo total
 *   (c) OrbitControls disabled MID-gesture (between pointerdown and pointerup)
 *       + camera matrixWorld.elements unchanged across the whole drag
 *   (d) OrbitControls re-enabled after pointerup
 *
 * HEADLESS NOTE: headless Chrome renders the 3D viewport BLACK — but worldToScreen3d
 * projects through the real camera matrix regardless. The bore marker position is
 * determined by the kernel geometry + cabinet pose (origin), so it projects to a
 * determinate pixel location even without visual rendering.
 *
 * PC15: command name string is 'MoveConnector' (not 'MoveConnectorCommand').
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

test(
  'drag-gizmo: real pointer drag → MoveConnector command, undo reverts, orbit disabled mid-drag',
  async ({ page }) => {
    test.setTimeout(360_000);
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

    // ── Step 1: seed a cabinet with carcass bores ─────────────────────────────
    // Uses the __zilventorSeedCabinetWithBores probe (App.tsx dev block).
    // This creates a new assembly, builds a base cabinet, and runs GenerateCarcassBoresCommand.
    await page.evaluate(async () => {
      const w = window as unknown as { __zilventorSeedCabinetWithBores(): Promise<void> };
      await w.__zilventorSeedCabinetWithBores();
    });

    // Wait until the active assembly has exactly 1 component (the cabinet .ziasm).
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

    // ── Step 2: warm sub-assembly docs + wait for bore markers ────────────────
    // The bore-marker effect needs subAssemblyDocs to be populated for the cabinet
    // .ziasm so it can find leaf panel partPaths and load their bores.
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorSubAsmInvalidateAll(): Promise<void>;
      };
      await w.__zilventorSubAsmInvalidateAll();
    });

    // Wait for bore markers to render (proves bore cache populated + markers built).
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const store = (
              window as unknown as {
                __zilventorStore: { getState(): { viewport: unknown } };
              }
            ).__zilventorStore.getState();
            const vp = store.viewport as { getSceneManager?(): unknown } | null;
            const sm = vp?.getSceneManager?.() as { boreMarkerCount(): number } | null;
            return sm?.boreMarkerCount?.() ?? -1;
          }),
        {
          timeout: 60_000,
          message: 'bore markers must render > 0 (proves partBoresCacheRef populated + sub-asm loaded)',
        },
      )
      .toBeGreaterThan(0);

    const markerCount = await page.evaluate(() => {
      const store = (
        window as unknown as {
          __zilventorStore: { getState(): { viewport: unknown } };
        }
      ).__zilventorStore.getState();
      const vp = store.viewport as { getSceneManager?(): unknown } | null;
      const sm = vp?.getSceneManager?.() as { boreMarkerCount(): number } | null;
      return sm?.boreMarkerCount?.() ?? -1;
    });
    console.log('[drag-gizmo] bore marker count =', markerCount);

    // ── Step 2b: fit camera to scene so bore projects to valid screen coords ──
    // frameToModel() reframes the camera to the current scene geometry.
    // Without this, the default camera (400,400,400) may not have the cabinet
    // geometry in its frustum, causing worldToScreen3d to return off-canvas coords.
    await page.evaluate(() => {
      const store = (
        window as unknown as {
          __zilventorStore: {
            getState(): {
              viewport: { getSceneManager(): { frameToModel(): boolean } | null } | null;
            };
          };
        }
      ).__zilventorStore.getState();
      store.viewport?.getSceneManager()?.frameToModel();
    });
    // Give the camera a frame to settle after reframing.
    await page.waitForTimeout(500);

    // ── Step 3: pick the first draggable bore, project to screen ─────────────
    // Select the bore so the gizmo appears (triggers the selectedBore useEffect).
    // Read its world position via boreWorldPos and project to canvas-relative pixels.
    const target = await page.evaluate(() => {
      const store = (
        window as unknown as {
          __zilventorStore: {
            getState(): {
              viewport: {
                getSceneManager(): {
                  firstDraggableBore(): { boreId: string; partPath: string } | null;
                  boreWorldPos(boreId: string, partPath: string): { x: number; y: number; z: number } | null;
                  boreMarkerHitPoint(boreId: string, partPath: string): { x: number; y: number; z: number } | null;
                } | null;
              } | null;
              setSelectedBore(boreId: string | null, partPath: string | null): void;
            };
          };
          __zilventorWorldToScreen3d(wx: number, wy: number, wz: number): { x: number; y: number };
          __zilventorReadBoreUV(boreId: string, partPath: string): { u: number; v: number } | null;
        }
      ).__zilventorStore.getState();

      const sm = store.viewport?.getSceneManager?.();
      if (!sm) return { error: 'no scene manager' };

      const draggable = sm.firstDraggableBore();
      if (!draggable) return { error: 'no draggable bore found' };

      // Select the bore so the gizmo renders (useEffect in App.tsx fires on selectedBoreId change)
      store.setSelectedBore(draggable.boreId, draggable.partPath);

      const worldPos = sm.boreWorldPos(draggable.boreId, draggable.partPath);
      if (!worldPos) return { error: 'boreWorldPos returned null' };

      // boreMarkerHitPoint returns a world point ON the ring face (not the center hole).
      // RingGeometry is hollow at center — clicking center misses; use the ring's midpoint.
      const hitPoint = sm.boreMarkerHitPoint(draggable.boreId, draggable.partPath) ?? worldPos;

      // worldToScreen3d returns canvas-relative px (not page-relative).
      const w = window as unknown as { __zilventorWorldToScreen3d(wx: number, wy: number, wz: number): { x: number; y: number } };
      const screenCenter = w.__zilventorWorldToScreen3d(worldPos.x, worldPos.y, worldPos.z);
      const screenHit = w.__zilventorWorldToScreen3d(hitPoint.x, hitPoint.y, hitPoint.z);

      const uv = (window as unknown as { __zilventorReadBoreUV(b: string, p: string): { u: number; v: number } | null }).__zilventorReadBoreUV(draggable.boreId, draggable.partPath);

      return {
        boreId: draggable.boreId,
        partPath: draggable.partPath,
        worldPos,
        hitPoint,
        // Use the ring face hit point for clicking, not the hollow center
        sx: screenHit.x,
        sy: screenHit.y,
        // Also return center for diagnostics
        centerSx: screenCenter.x,
        centerSy: screenCenter.y,
        uBefore: uv?.u ?? null,
        vBefore: uv?.v ?? null,
      };
    });

    // Type narrowing for error case
    if ('error' in target) {
      throw new Error(`Bore selection failed: ${(target as { error: string }).error}`);
    }

    const typedTarget = target as {
      boreId: string;
      partPath: string;
      worldPos: { x: number; y: number; z: number };
      hitPoint: { x: number; y: number; z: number };
      sx: number;
      sy: number;
      centerSx: number;
      centerSy: number;
      uBefore: number | null;
      vBefore: number | null;
    };

    console.log('[drag-gizmo] target =', JSON.stringify({
      boreId: typedTarget.boreId,
      sx: typedTarget.sx.toFixed(2),
      sy: typedTarget.sy.toFixed(2),
      centerSx: typedTarget.centerSx.toFixed(2),
      centerSy: typedTarget.centerSy.toFixed(2),
      uBefore: typedTarget.uBefore,
      vBefore: typedTarget.vBefore,
      worldPos: typedTarget.worldPos,
      hitPoint: typedTarget.hitPoint,
    }));

    // FAIL LOUDLY if worldToScreen3d returns (0,0) — degenerate projection means the
    // camera hasn't been positioned yet or the bore geometry isn't loaded.
    expect(
      typedTarget.centerSx,
      `worldToScreen3d(bore center) returned sx=0 — bore at world (${typedTarget.worldPos?.x?.toFixed(1)},${typedTarget.worldPos?.y?.toFixed(1)},${typedTarget.worldPos?.z?.toFixed(1)}) projects to origin; check camera position`,
    ).toBeGreaterThan(1);
    expect(
      typedTarget.centerSy,
      `worldToScreen3d(bore center) returned sy=0 — degenerate camera projection`,
    ).toBeGreaterThan(1);

    expect(typedTarget.uBefore, 'uBefore must be a number (bore in cache)').not.toBeNull();

    // ── Step 4: snapshot camera matrix ────────────────────────────────────────
    const camBefore = await page.evaluate(() => {
      const store = (
        window as unknown as {
          __zilventorStore: {
            getState(): { viewport: { getSceneManager(): { getCamera(): { matrixWorld: { elements: number[] } } } | null } | null };
          };
        }
      ).__zilventorStore.getState();
      const cam = store.viewport?.getSceneManager()?.getCamera();
      return cam ? JSON.stringify(cam.matrixWorld.elements) : null;
    });
    console.log('[drag-gizmo] camera captured before drag');

    // ── Step 5: drive real mouse events ──────────────────────────────────────
    // worldToScreen3d is canvas-relative; add canvas bounding box to get page coords.
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas bounding box is null');

    const pageX = box.x + typedTarget.sx;
    const pageY = box.y + typedTarget.sy;
    console.log('[drag-gizmo] pointer at page (', pageX.toFixed(1), ',', pageY.toFixed(1), '), canvas box:', JSON.stringify({ x: box.x.toFixed(1), y: box.y.toFixed(1), w: box.width.toFixed(1), h: box.height.toFixed(1) }));

    // Move to position first, then down, then drag 60px to the right in 8 steps.
    // 60px = measurable delta at any common screen resolution without going off-canvas.
    await page.mouse.move(pageX, pageY);
    await page.mouse.down();

    // (c) probe OrbitControls disabled MID-gesture (between down and up)
    const enabledMid = await page.evaluate(() => {
      const store = (
        window as unknown as {
          __zilventorStore: {
            getState(): {
              viewport: { getSceneManager(): { getControls(): { enabled: boolean } } | null } | null;
            };
          };
        }
      ).__zilventorStore.getState();
      return store.viewport?.getSceneManager()?.getControls()?.enabled ?? null;
    });
    console.log('[drag-gizmo] controls.enabled mid-drag =', enabledMid);
    expect(enabledMid, 'OrbitControls must be disabled between pointerdown and pointerup').toBe(false);

    // Drag 60px right in 8 steps (produces a measurable bore u shift)
    await page.mouse.move(pageX + 60, pageY, { steps: 8 });
    await page.mouse.up();

    // ── Step 6: assert post-drag state ───────────────────────────────────────
    // MoveConnectorCommand is fired fire-and-forget (`void bus.execute(...)`), and
    // only reaches the top of the undo stack once its apply() resolves — apply() does
    // variable-duration OPFS + .zipt unpack/repack, so a fixed sleep here is flaky.
    // The bore U/V cache (read via __zilventorReadBoreUV) is written as part of that
    // same apply() but can observably lag one tick behind the lastExecutedName() flip
    // (measured: lastCmd already 'MoveConnector' while uAfter was still null) — so the
    // poll predicate below waits for BOTH lastCmd AND the moved U/V to land, not just
    // lastCmd. A real regression (command never fires, or bore never moves) still
    // fails the test with a clear message once the deadline elapses.
    //
    // Under full-suite worker contention, apply() settling can genuinely take close
    // to (and occasionally over) 10s — instrumented repro under synthetic CPU load +
    // 6 parallel workers measured settle times up to ~10.5s, right at the old poll
    // deadline, and never lost (an extended 60s poll passed 15/15 in the same
    // contention profile that produced 5/15 failures at 10s). 60s gives headroom
    // matching the class of fix used for other contention-settling flakes on this
    // branch (see corner-cabinet-create fix af5f2f54).
    let afterDrag!: {
      uAfter: number | null;
      vAfter: number | null;
      lastCmd: string | null | undefined;
      controlsEnabled: boolean | null;
    };
    await expect
      .poll(
        async () => {
          afterDrag = await page.evaluate(
            (params: { boreId: string; partPath: string }) => {
              const store = (
                window as unknown as {
                  __zilventorStore: {
                    getState(): {
                      bus: {
                        lastExecutedName(): string | null;
                      };
                      viewport: { getSceneManager(): { getControls(): { enabled: boolean } } | null } | null;
                    };
                  };
                  __zilventorReadBoreUV(boreId: string, partPath: string): { u: number; v: number } | null;
                }
              ).__zilventorStore.getState();

              const uv = (window as unknown as { __zilventorReadBoreUV(b: string, p: string): { u: number; v: number } | null }).__zilventorReadBoreUV(params.boreId, params.partPath);
              const lastCmd = store.bus.lastExecutedName?.();
              const controlsEnabled = store.viewport?.getSceneManager()?.getControls()?.enabled ?? null;

              return {
                uAfter: uv?.u ?? null,
                vAfter: uv?.v ?? null,
                lastCmd,
                controlsEnabled,
              };
            },
            { boreId: typedTarget.boreId, partPath: typedTarget.partPath },
          );
          if (afterDrag.lastCmd !== 'MoveConnector' || afterDrag.uAfter === null) return false;
          const uvDist = Math.hypot(
            (afterDrag.uAfter ?? 0) - (typedTarget.uBefore ?? 0),
            (afterDrag.vAfter ?? 0) - (typedTarget.vBefore ?? 0),
          );
          return uvDist > 0.1;
        },
        {
          timeout: 60_000,
          message:
            'MoveConnector must execute (bus.lastExecutedName()) and the bore U/V cache must reflect the completed move (fire-and-forget apply() had not settled in time)',
        },
      )
      .toBe(true);

    console.log('[drag-gizmo] after drag:', JSON.stringify(afterDrag), 'uvDist=', Math.hypot((afterDrag.uAfter ?? 0) - (typedTarget.uBefore ?? 0), (afterDrag.vAfter ?? 0) - (typedTarget.vBefore ?? 0)).toFixed(4));

    // (a) MoveConnector command ran through the bus
    expect(afterDrag.lastCmd, 'bus.lastExecutedName() must be "MoveConnector"').toBe('MoveConnector');

    // (b1) bore position changed after drag (u OR v may change depending on joint axis orientation)
    expect(
      afterDrag.uAfter,
      'uAfter must be a number (bore still in cache after command)',
    ).not.toBeNull();
    // The bore moves along its jointDir. Depending on the panel's face orientation,
    // this may change u, v, or both. Check that the bore moved (uv distance > 0.1mm).
    const uvDistAfter = Math.hypot(
      (afterDrag.uAfter ?? 0) - (typedTarget.uBefore ?? 0),
      (afterDrag.vAfter ?? 0) - (typedTarget.vBefore ?? 0),
    );
    expect(
      uvDistAfter,
      `bore must move after drag: u ${typedTarget.uBefore}→${afterDrag.uAfter}, v ${typedTarget.vBefore}→${afterDrag.vAfter}`,
    ).toBeGreaterThan(0.1);

    // (d) OrbitControls re-enabled after pointerup
    expect(afterDrag.controlsEnabled, 'OrbitControls must be re-enabled after drag').toBe(true);

    // Camera matrix unchanged across the whole drag (§9.B: orbit disabled = no camera movement)
    const camAfter = await page.evaluate(() => {
      const store = (
        window as unknown as {
          __zilventorStore: {
            getState(): { viewport: { getSceneManager(): { getCamera(): { matrixWorld: { elements: number[] } } } | null } | null };
          };
        }
      ).__zilventorStore.getState();
      const cam = store.viewport?.getSceneManager()?.getCamera();
      return cam ? JSON.stringify(cam.matrixWorld.elements) : null;
    });
    expect(camAfter, 'camera matrixWorld must be identical before and after drag').toBe(camBefore);

    // ── Step 7: undo restores the bore to uBefore (b2) ───────────────────────
    await page.evaluate(async () => {
      const store = (
        window as unknown as {
          __zilventorStore: { getState(): { bus: { undo(): Promise<boolean> } } };
        }
      ).__zilventorStore.getState();
      await store.bus.undo();
    });

    // Give the undo a moment to write to OPFS and update partBoresCacheRef.
    await page.waitForTimeout(300);

    const uvUndo = await page.evaluate(
      (params: { boreId: string; partPath: string }) => {
        const uv = (
          window as unknown as {
            __zilventorReadBoreUV(b: string, p: string): { u: number; v: number } | null;
          }
        ).__zilventorReadBoreUV(params.boreId, params.partPath);
        return uv ?? null;
      },
      { boreId: typedTarget.boreId, partPath: typedTarget.partPath },
    );

    console.log('[drag-gizmo] after undo: uv =', uvUndo, 'expected u≈', typedTarget.uBefore, 'v≈', typedTarget.vBefore);
    expect(uvUndo?.u ?? null, 'undo must restore u to uBefore').toBeCloseTo(typedTarget.uBefore!, 3);
    expect(uvUndo?.v ?? null, 'undo must restore v to vBefore').toBeCloseTo(typedTarget.vBefore!, 3);

    // ── Final: no browser errors ─────────────────────────────────────────────
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
    );
    if (realErrors.length > 0) {
      console.error('[drag-gizmo] browser errors:', realErrors);
    }
    expect(realErrors, 'no browser errors during drag-gizmo e2e').toHaveLength(0);
  },
);
