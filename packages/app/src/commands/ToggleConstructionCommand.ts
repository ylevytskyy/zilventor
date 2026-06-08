import type { Command } from './Command';
import type { SketchPrimitive } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

type PriorEntry = { id: string; construction: boolean | undefined };

export class ToggleConstructionCommand implements Command {
  readonly name = 'ToggleConstruction';
  private prior: PriorEntry[] = [];

  constructor(
    private readonly opts: {
      primitiveIds: string[];
      sketchId: string;
    }
  ) {}

  async apply(): Promise<void> {
    const part = useAppStore.getState().activePart;
    if (!part) return;

    const sketch = part.featureTree.find(
      (f): f is Extract<typeof f, { kind: 'sketch' }> =>
        f.kind === 'sketch' && f.id === this.opts.sketchId
    );
    if (!sketch) return;

    // Capture prior state for revert
    this.prior = this.opts.primitiveIds.map((id) => {
      const p = sketch.primitives.find((pr) => pr.id === id);
      return { id, construction: p?.construction };
    });

    const idSet = new Set(this.opts.primitiveIds);
    const updatedPrimitives = sketch.primitives.map((p) => {
      if (!idSet.has(p.id)) return p;
      return { ...p, construction: !p.construction } as SketchPrimitive;
    });

    const nextPart = {
      ...part,
      featureTree: part.featureTree.map((f) =>
        f.kind === 'sketch' && f.id === this.opts.sketchId
          ? { ...f, primitives: updatedPrimitives }
          : f
      ),
    };
    useAppStore.getState().setActivePart(nextPart);
  }

  async revert(): Promise<void> {
    if (this.prior.length === 0) return;
    const part = useAppStore.getState().activePart;
    if (!part) return;

    const priorMap = new Map(this.prior.map((e) => [e.id, e.construction]));

    const sketch = part.featureTree.find(
      (f): f is Extract<typeof f, { kind: 'sketch' }> =>
        f.kind === 'sketch' && f.id === this.opts.sketchId
    );
    if (!sketch) return;

    const restoredPrimitives = sketch.primitives.map((p) => {
      if (!priorMap.has(p.id)) return p;
      const was = priorMap.get(p.id);
      return { ...p, construction: was } as SketchPrimitive;
    });

    const nextPart = {
      ...part,
      featureTree: part.featureTree.map((f) =>
        f.kind === 'sketch' && f.id === this.opts.sketchId
          ? { ...f, primitives: restoredPrimitives }
          : f
      ),
    };
    useAppStore.getState().setActivePart(nextPart);
  }
}
