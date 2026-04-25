import type { EdgeName } from '@zilventor/shared';

export type WorkPointPickMode = 'vertex' | 'workPoint';

export type WorkPointPickHit =
  | { kind: 'vertex'; edge: EdgeName; end: 'start' | 'end' }
  | { kind: 'workPoint'; featureId: string };

export type WorkPointPickOpts = {
  onPick: (hit: WorkPointPickHit) => void;
};

/**
 * Stateful router for point references during work-feature dialog flows.
 * Mirrors WorkPlanePickController. Vertex picks come from the viewport
 * by edge + end-tag (the same shape `WorkPointRef` 'vertex' source uses).
 */
export class WorkPointPickController {
  private active = false;
  private mode: WorkPointPickMode | null = null;
  constructor(private opts: WorkPointPickOpts) {}

  activate(mode: WorkPointPickMode): void {
    this.active = true;
    this.mode = mode;
  }

  deactivate(): void {
    this.active = false;
    this.mode = null;
  }

  isActive(): boolean { return this.active; }
  currentMode(): WorkPointPickMode | null { return this.mode; }

  pickFromViewport(hit: WorkPointPickHit): void {
    if (!this.active || hit.kind !== this.mode) return;
    this.opts.onPick(hit);
  }
}
