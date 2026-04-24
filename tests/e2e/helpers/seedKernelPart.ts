import type { Page } from '@playwright/test';

export type SeedSketchPrimitive =
  | { id: string; kind: 'rectangle'; x: number; y: number; w: number; h: number }
  | { id: string; kind: 'line'; x1: number; y1: number; x2: number; y2: number };

export type SeedSketch = {
  id: string;
  plane?: 'XY' | 'XZ' | 'YZ';
  primitives: SeedSketchPrimitive[];
};

export type SeedParameter = {
  name: string;
  expression: string;
  value: number;
  unit: 'mm' | 'deg';
};

export type SeedExtrude = {
  id: string;
  sketchRef: string;
  distanceParam: string;
  direction?: 'forward' | 'symmetric';
  operation: 'new' | 'join' | 'cut';
};

export type SeedRevolve = {
  id: string;
  sketchRef: string;
  axisPrimitiveId: string;
  angleParam: string;
  direction?: 'normal' | 'symmetric' | 'flipped';
  operation: 'new' | 'join' | 'cut';
};

export type SeedKernelPartOptions = {
  sketches?: SeedSketch[];
  parameters?: SeedParameter[];
  extrudes?: SeedExtrude[];
  revolves?: SeedRevolve[];
};

/**
 * Seeds the kernel's active part with sketches, parameters, extrudes, and
 * revolves by directly calling kernel.addFeature / kernel.setParameter via
 * the page's __zilventorStore dev hook. Mirrors the kernel's updated part
 * back into the store so React sees the new tree.
 *
 * Requirements:
 *   - Kernel must be initialized (`waitForKernelReady`).
 *   - An active part must exist (call New Part via UI first).
 *
 * Order of writes: parameters, then sketches, then extrudes+revolves in
 * array order. A single setActivePart at the end keeps the store synced.
 *
 * This is the shared seed helper used by all revolve E2E/perf tests.
 */
export async function seedKernelPart(page: Page, opts: SeedKernelPartOptions): Promise<void> {
  await page.evaluate(async (o) => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          kernel: {
            addFeature(partId: string, feature: unknown): Promise<void>;
            setParameter(partId: string, p: unknown): Promise<void>;
            getPart(partId: string): Promise<unknown>;
          };
          activePart: { id: string } | null;
          setActivePart(p: unknown): void;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    if (!s.kernel || !s.activePart) {
      throw new Error(
        'seedKernelPart: kernel or activePart missing. Did you wait for kernel ready and create a Part?'
      );
    }
    for (const p of o.parameters ?? []) {
      await s.kernel.setParameter(s.activePart.id, p);
    }
    for (const sk of o.sketches ?? []) {
      await s.kernel.addFeature(s.activePart.id, {
        kind: 'sketch',
        id: sk.id,
        plane: sk.plane ?? 'XY',
        primitives: sk.primitives,
        constraints: [],
      });
    }
    for (const ex of o.extrudes ?? []) {
      await s.kernel.addFeature(s.activePart.id, {
        kind: 'extrude',
        id: ex.id,
        sketchRef: ex.sketchRef,
        distanceParam: ex.distanceParam,
        direction: ex.direction ?? 'forward',
        operation: ex.operation,
      });
    }
    for (const rv of o.revolves ?? []) {
      await s.kernel.addFeature(s.activePart.id, {
        kind: 'revolve',
        id: rv.id,
        sketchRef: rv.sketchRef,
        axisPrimitiveId: rv.axisPrimitiveId,
        angleParam: rv.angleParam,
        direction: rv.direction ?? 'normal',
        operation: rv.operation,
      });
    }
    const next = await s.kernel.getPart(s.activePart.id);
    s.setActivePart(next);
  }, opts);
}
