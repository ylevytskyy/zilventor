import type { Command } from './Command';
import type { DrawingDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class EditDrawingPropertiesCommand implements Command {
  readonly name = 'EditDrawingProperties';
  private priorProperties: Record<string, string | number | boolean> | undefined;
  private reverted = false;

  constructor(private readonly opts: { properties: Record<string, string | number | boolean> }) {}

  async apply(): Promise<void> {
    this.reverted = false;
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      this.priorProperties = doc.properties;
      const next: DrawingDocument = { ...doc, properties: this.opts.properties };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }

  async revert(): Promise<void> {
    if (this.priorProperties === undefined || this.reverted) return;
    this.reverted = true;
    const prior = this.priorProperties;
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      const next: DrawingDocument = { ...doc, properties: prior };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }
}
