import type { Command } from './Command';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { PartDocument, SketchConstraint, SketchPrimitive } from '@zilventor/shared';
import type { SketcherClient } from '../sketcher/SketcherClient';

type Ctx = {
  kernel: KernelClient;
  sketcherClient?: SketcherClient | undefined;
  store: { getActivePart(): PartDocument | null; setActivePart(p: PartDocument | null): void };
  sketchId: string;
  primitive: SketchPrimitive;
};

/** Constraints live only in the Zustand store (the kernel has no addConstraint API).
 *  Whenever we replace activePart with a fresh kernel snapshot we must re-graft
 *  the existing constraints back in, otherwise they are silently wiped. */
function graftsConstraints(
  next: PartDocument,
  constraintsBySketchId: Map<string, SketchConstraint[]>
): PartDocument {
  if (constraintsBySketchId.size === 0) return next;
  return {
    ...next,
    featureTree: next.featureTree.map((f) => {
      if (f.kind !== 'sketch') return f;
      const cs = constraintsBySketchId.get(f.id);
      return cs && cs.length > 0 ? { ...f, constraints: cs } : f;
    })
  };
}

export class AddPrimitiveCommand implements Command {
  readonly name = 'AddPrimitive';
  private prior: PartDocument | null = null;

  constructor(private ctx: Ctx) {}

  async apply(): Promise<void> {
    const part = this.ctx.store.getActivePart();
    if (!part) throw new Error('no active part');
    this.prior = part;

    await this.ctx.kernel.addPrimitive(part.id, this.ctx.sketchId, this.ctx.primitive);
    // Mirror into the sketcher worker so dim/constraint add + drag + solve all
    // see primitives drawn after the initial loadSketch. Without this the
    // worker's GcsSystem only knows about primitives present at sketch entry.
    if (this.ctx.sketcherClient) {
      await this.ctx.sketcherClient.addPrimitive(this.ctx.primitive);
    }
    const raw = await this.ctx.kernel.getPart(part.id);

    // The kernel has no concept of sketch constraints — they live only in the
    // Zustand store. Re-read activePart *now* (after the async round-trip) so we
    // capture any constraints that inferFromSnaps may have already written while
    // the kernel RPCs were in flight, then graft them onto the fresh kernel snapshot.
    const current = this.ctx.store.getActivePart();
    const constraintsBySketchId = new Map<string, SketchConstraint[]>();
    if (current) {
      for (const f of current.featureTree) {
        if (f.kind === 'sketch' && f.constraints.length > 0) {
          constraintsBySketchId.set(f.id, f.constraints);
        }
      }
    }
    const next = raw ? graftsConstraints(raw, constraintsBySketchId) : raw;
    this.ctx.store.setActivePart(next);
  }

  async revert(): Promise<void> {
    if (!this.prior) return;
    await this.ctx.kernel.removePrimitive(this.prior.id, this.ctx.sketchId, this.ctx.primitive.id);
    if (this.ctx.sketcherClient) {
      await this.ctx.sketcherClient.removePrimitive(this.ctx.primitive.id);
    }
    this.ctx.store.setActivePart(this.prior);
  }
}
