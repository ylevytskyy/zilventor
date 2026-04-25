export type ComponentPickOpts = { onPick: (componentId: string) => void };

export class ComponentPickController {
  private active = false;
  constructor(private opts: ComponentPickOpts) {}
  activate(): void { this.active = true; }
  deactivate(): void { this.active = false; }
  isActive(): boolean { return this.active; }
  selectFromViewport(componentId: string): void {
    if (!this.active) return;
    this.opts.onPick(componentId);
  }
}
