import type { FaceName } from '@zilventor/shared';

export type WorkPlanePickMode = 'face' | 'workPlane';

export type WorkPlanePickHit =
  | { kind: 'face'; face: FaceName }
  | { kind: 'workPlane'; featureId: string };

export type WorkPlanePickOpts = {
  onPick: (hit: WorkPlanePickHit) => void;
};

/**
 * Stateful router for plane references during work-feature dialog flows.
 * The dialog calls `activate(mode)` to set what the next viewport click
 * should resolve to; `pickFromViewport` is invoked by the viewport raycast
 * with the hit it found and forwards it to `onPick` only when active and
 * the hit's kind matches the current mode.
 */
export class WorkPlanePickController {
  private active = false;
  private mode: WorkPlanePickMode | null = null;
  constructor(private opts: WorkPlanePickOpts) {}

  activate(mode: WorkPlanePickMode): void {
    this.active = true;
    this.mode = mode;
  }

  deactivate(): void {
    this.active = false;
    this.mode = null;
  }

  isActive(): boolean { return this.active; }
  currentMode(): WorkPlanePickMode | null { return this.mode; }

  pickFromViewport(hit: WorkPlanePickHit): void {
    if (!this.active || hit.kind !== this.mode) return;
    this.opts.onPick(hit);
  }
}
