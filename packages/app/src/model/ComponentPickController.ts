import type { ComponentPath } from '@zilventor/shared';

export type ComponentPickOpts = { onPick: (componentPath: ComponentPath) => void };

/**
 * T30 (4d Phase 9): pick callback now receives a `ComponentPath` so picks can
 * resolve to leaves anywhere in the recursive sub-assembly tree, not just
 * top-level components.
 */
export class ComponentPickController {
  private active = false;
  constructor(private opts: ComponentPickOpts) {}
  activate(): void { this.active = true; }
  deactivate(): void { this.active = false; }
  isActive(): boolean { return this.active; }
  selectFromViewport(componentPath: ComponentPath): void {
    if (!this.active) return;
    this.opts.onPick(componentPath);
  }
}
