import type { EdgeName, FaceName } from '@zilventor/shared';

export type WorkAxisPickMode = 'cylindricalFace' | 'edge' | 'workAxis';

export type WorkAxisPickHit =
  | { kind: 'cylindricalFace'; face: FaceName }
  | { kind: 'edge'; edge: EdgeName }
  | { kind: 'workAxis'; featureId: string };

export type WorkAxisPickOpts = {
  onPick: (hit: WorkAxisPickHit) => void;
};

/**
 * Stateful router for axis references during work-feature dialog flows.
 * Mirrors WorkPlanePickController. `activate(mode)` arms the next
 * viewport pick; `pickFromViewport` forwards a matching hit to `onPick`
 * only while active.
 */
export class WorkAxisPickController {
  private active = false;
  private mode: WorkAxisPickMode | null = null;
  constructor(private opts: WorkAxisPickOpts) {}

  activate(mode: WorkAxisPickMode): void {
    this.active = true;
    this.mode = mode;
  }

  deactivate(): void {
    this.active = false;
    this.mode = null;
  }

  isActive(): boolean { return this.active; }
  currentMode(): WorkAxisPickMode | null { return this.mode; }

  pickFromViewport(hit: WorkAxisPickHit): void {
    if (!this.active || hit.kind !== this.mode) return;
    this.opts.onPick(hit);
  }
}
