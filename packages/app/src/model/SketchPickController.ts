export type SketchPickOpts = {
  onPick: (sketchId: string) => void;
};

export class SketchPickController {
  private active = false;
  constructor(private opts: SketchPickOpts) {}

  activate(): void { this.active = true; }
  deactivate(): void { this.active = false; }
  isActive(): boolean { return this.active; }

  /** Triggered when the user clicks a sketch node in the browser pane. */
  selectFromBrowser(sketchId: string): void {
    if (!this.active) return;
    this.opts.onPick(sketchId);
  }
}
