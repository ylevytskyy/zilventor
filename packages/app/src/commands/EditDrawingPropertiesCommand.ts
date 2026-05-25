import type { Command } from './Command';
import type { DrawingDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';

export class EditDrawingPropertiesCommand implements Command {
  readonly name = 'EditDrawingProperties';
  private priorProperties: Record<string, string | number | boolean> | undefined;
  private reverted = false;

  constructor(private readonly opts: { properties: Record<string, string | number | boolean> }) {}

  async apply(): Promise<void> {
    this.reverted = false;
    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    this.priorProperties = doc.document.properties;
    const next: DrawingDocument = { ...doc.document, properties: this.opts.properties };
    useAppStore.setState(drawingDocState(next));
  }

  async revert(): Promise<void> {
    if (this.priorProperties === undefined || this.reverted) return;
    this.reverted = true;
    const prior = this.priorProperties;
    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = { ...doc.document, properties: prior };
    useAppStore.setState(drawingDocState(next));
  }
}
