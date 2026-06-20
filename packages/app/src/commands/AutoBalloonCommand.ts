import type { Command } from './Command';
import type { DrawingDocument, DrawingAnnotation } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';

export class AutoBalloonCommand implements Command {
  readonly name = 'AutoBalloon';

  constructor(
    private readonly opts: {
      sheetId: string;
      balloons: ReadonlyArray<Extract<DrawingAnnotation, { kind: 'balloon' }>>;
    },
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((sh) =>
        sh.id === this.opts.sheetId
          ? { ...sh, annotations: [...sh.annotations, ...this.opts.balloons] }
          : sh,
      ),
    };
    useAppStore.setState(drawingDocState(next));
  }

  async revert(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const ids = new Set(this.opts.balloons.map((b) => b.id));

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((sh) =>
        sh.id === this.opts.sheetId
          ? { ...sh, annotations: sh.annotations.filter((a) => !ids.has(a.id)) }
          : sh,
      ),
    };
    useAppStore.setState(drawingDocState(next));
  }
}
