import type { Command } from './Command';
import type { DrawingDocument, DrawingDimension, DrawingView } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

type EdgeRef = { readonly viewId: string; readonly edgeId: string };
type AngularRef =
  | { readonly kind: 'two-edges'; readonly edge1: EdgeRef; readonly edge2: EdgeRef }
  | { readonly kind: 'arc';       readonly edge: EdgeRef };

function findEdgeInView(view: DrawingView, edgeId: string): boolean {
  const proj = view.projection;
  if (!proj) return false;
  return (
    proj.visibleEdges.some((e) => e.id === edgeId) ||
    proj.hiddenEdges.some((e) => e.id === edgeId)
  );
}

export class AddAngularDimCommand implements Command {
  readonly name = 'AddAngularDimCommand';
  private placedId: string | null = null;

  constructor(private readonly opts: {
    sheetId: string;
    viewId: string;
    ref: AngularRef;
    arcSide?: 'inside' | 'outside';
    offsetMm?: number;
    opts?: { sourceParameterName?: string; textOverride?: string };
  }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find((s) => s.id === this.opts.sheetId);
    if (!sheet) throw new Error('sheet-not-found');

    const view = sheet.views.find((v) => v.id === this.opts.viewId) as DrawingView | undefined;
    if (!view) throw new Error('view-not-found');

    // Validate edges exist in view
    const ref = this.opts.ref;
    if (ref.kind === 'two-edges') {
      if (!findEdgeInView(view, ref.edge1.edgeId)) throw new Error('edge-not-in-view');
      if (!findEdgeInView(view, ref.edge2.edgeId)) throw new Error('edge-not-in-view');
    } else {
      if (!findEdgeInView(view, ref.edge.edgeId)) throw new Error('edge-not-in-view');
    }

    // Compute offsetMm default: max(15, bbox.height * 0.1)
    const proj = view.projection;
    const bboxH = proj ? proj.bbox.maxY - proj.bbox.minY : 0;
    const offsetMm = this.opts.offsetMm ?? Math.max(15, bboxH * 0.1);
    const arcSide = this.opts.arcSide ?? 'inside';

    const id = crypto.randomUUID();
    this.placedId = id;

    const newDim = {
      id,
      kind: 'angular' as const,
      viewId: this.opts.viewId,
      ref,
      arcSide,
      offsetMm,
      ...(this.opts.opts?.sourceParameterName !== undefined
        ? { sourceParameterName: this.opts.opts.sourceParameterName }
        : {}),
      ...(this.opts.opts?.textOverride !== undefined
        ? { textOverride: this.opts.opts.textOverride }
        : {}),
    } as unknown as DrawingDimension;

    const nextDoc: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((s) =>
        s.id === this.opts.sheetId
          ? { ...s, dimensions: [...s.dimensions, newDim] }
          : s,
      ),
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: nextDoc },
      activeDrawing: nextDoc,
    });
  }

  async revert(): Promise<void> {
    if (!this.placedId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const id = this.placedId;
    const nextDoc: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((s) =>
        s.id === this.opts.sheetId
          ? { ...s, dimensions: s.dimensions.filter((d) => d.id !== id) }
          : s,
      ),
    };
    this.placedId = null;
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: nextDoc },
      activeDrawing: nextDoc,
    });
  }
}
