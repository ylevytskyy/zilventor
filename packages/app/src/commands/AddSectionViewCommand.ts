// packages/app/src/commands/AddSectionViewCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, SectionView, DetailView } from '@zilventor/shared';
import { resolveSectionSource, getHatchSpec } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { deriveSectionPlane, deriveSplitPlane } from '@zilventor/shared/src/drawing/sectionPlane';
import { cutBySectionPlane, cutAssemblyBySectionPlane } from '../kernel/cutBySectionPlane';
import { projectSectionView } from '../drawing/projectSectionView';
import { sectionCache } from '../drawing/sectionCache';
import { fingerprintPlane } from '../drawing/planeFingerprint';
import { allocateCalloutLabel } from '@zilventor/shared/src/drawing/sectionLabel';

import type { Vec2 } from '@zilventor/shared';
import type { FaceTagMap } from '../drawing/projectSectionView';

export type AddSectionViewPayload = {
  drawingId: string;
  sheetId: string;
  parentViewId: string;
  p0: Vec2;   // parent view-space mm
  p1: Vec2;   // parent view-space mm
  arrowDirection: -1 | 1;
  dropAt: Vec2; // sheet-space mm
  // --- F1.1 Half-section fields ---
  mode: 'full' | 'half';
  cutSide?: -1 | 1;   // required when mode === 'half'
};

export class AddSectionViewCommand implements Command {
  readonly name = 'AddSectionView';
  private newViewId: string | null = null;
  private cacheKey: string | null = null;

  constructor(private readonly payload: AddSectionViewPayload) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const sheet = drawing.sheets.find((s) => s.id === this.payload.sheetId);
    if (!sheet) throw new Error(`sheet ${this.payload.sheetId} not found`);

    const parentView = sheet.views.find((v) => v.id === this.payload.parentViewId);
    if (!parentView) throw new Error('parent view not found');

    // Build a minimal SectionView for resolveSectionSource lookup purposes.
    const source = resolveSectionSource(
      {
        id: '__pending__',
        kind: 'section',
        parentViewId: this.payload.parentViewId,
        sectionLine: { p0: this.payload.p0, p1: this.payload.p1 },
        arrowDirection: this.payload.arrowDirection,
        label: '',
        positionMm: this.payload.dropAt,
        scale: parentView.scale,
        showHidden: false,
        mode: 'full',
        hatchSegments: [],
        fingerprint: '',
      } satisfies SectionView,
      drawing,
    );

    const { plane, sectionViewMatrix } = deriveSectionPlane(
      { p0: this.payload.p0, p1: this.payload.p1 },
      ((parentView as { viewMatrix?: number[] }).viewMatrix ?? (new Array(16).fill(0) as number[])) as import('@zilventor/shared/src/drawing/viewMatrix').Mat4,
      parentView.scale.numerator / parentView.scale.denominator,
      this.payload.arrowDirection,
    );

    // Derive split plane for half-section mode
    let splitPlane: { origin: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } } | undefined;
    if (this.payload.mode === 'half') {
      if (this.payload.cutSide === undefined) {
        throw new Error('half-section-invariant-violated');
      }
      splitPlane = deriveSplitPlane(
        { p0: this.payload.p0, p1: this.payload.p1 },
        ((parentView as { viewMatrix?: number[] }).viewMatrix ?? (new Array(16).fill(0) as number[])) as import('@zilventor/shared/src/drawing/viewMatrix').Mat4,
        this.payload.cutSide,
      );
    }

    // Build cache key — half-section includes splitPlane fingerprint + cutSide
    let key: string;
    if (this.payload.mode === 'half' && splitPlane !== undefined && this.payload.cutSide !== undefined) {
      const splitPlaneFp = fingerprintPlane(splitPlane);
      key = `${source.id}::${fingerprintPlane(plane)}::${splitPlaneFp}::${this.payload.cutSide}`;
    } else {
      key = `${source.id}::${fingerprintPlane(plane)}`;
    }
    this.cacheKey = key;

    let compound: unknown;
    let faceTags: FaceTagMap;
    const cached = await sectionCache.get(key);
    if (cached) {
      compound = cached.brep;
      faceTags = cached.faceTags;
    } else {
      // Use the active kernel part/assembly UUID so namedShapeCache lookup succeeds.
      // For an assembly, cutAssemblyBySectionPlane iterates all cached parts.
      const kernelId = source.kind === 'assembly'
        ? (state.activeAssembly?.id ?? source.id)
        : (state.activePart?.id ?? source.id);
      const result = source.kind === 'assembly'
        ? await cutAssemblyBySectionPlane(kernelId, plane, this.payload.arrowDirection, splitPlane, this.payload.cutSide)
        : await cutBySectionPlane(kernelId, plane, this.payload.arrowDirection, splitPlane, this.payload.cutSide);

      if (!result.ok) {
        if (result.reason === 'tangent') {
          throw new Error('section plane tangent to geometry; nudge by 0.01mm');
        }
        throw new Error('section plane misses geometry');
      }
      compound = result.compound;
      faceTags = result.faceTags;
      await sectionCache.put(key, compound, faceTags);
    }

    const materials =
      state.activePart?.materials ??
      state.activeAssembly?.materials ??
      [];
    const hatchLookup = (materialId: string): { angleDeg: number; spacingMm: number } => {
      const mat = materials.find((m) => m.id === materialId);
      return getHatchSpec(mat ?? { id: materialId, name: '', defaultThickness: 0, color: '#808080' });
    };

    // Pass hatchLookup so per-material hatch patterns are applied.
    const scale = parentView.scale.numerator / parentView.scale.denominator;
    const { edges, hatchSegments, fingerprint } = projectSectionView(
      compound as Parameters<typeof projectSectionView>[0],
      faceTags,
      scale,
      hatchLookup,
      sectionViewMatrix,
    );

    const existingLabels = sheet.views
      .filter((v): v is SectionView | DetailView =>
        v.kind === 'section' || v.kind === 'detail')
      .map((v) => v.label);
    const label = allocateCalloutLabel(existingLabels);

    const newId = crypto.randomUUID();
    this.newViewId = newId;

    const sectionView: SectionView = {
      id: newId,
      kind: 'section',
      parentViewId: this.payload.parentViewId,
      sectionLine: { p0: this.payload.p0, p1: this.payload.p1 },
      arrowDirection: this.payload.arrowDirection,
      label,
      positionMm: this.payload.dropAt,
      scale: parentView.scale,
      showHidden: false,
      mode: this.payload.mode,
      ...(this.payload.cutSide !== undefined ? { cutSide: this.payload.cutSide } : {}),
      ...(splitPlane !== undefined ? { splitPlane } : {}),
      hatchSegments,
      fingerprint,
      plane,
      projection: {
        visibleEdges: edges,
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      },
      ...(sectionViewMatrix ? { inputFingerprint: Array.from(sectionViewMatrix).slice(0, 4).join(',') } : {}),
    };

    // α-invariant check: half-section must have both cutSide and splitPlane
    if (sectionView.mode === 'half' && (sectionView.cutSide === undefined || sectionView.splitPlane === undefined)) {
      throw new Error('half-section-invariant-violated');
    }

    const nextDoc: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map((s) =>
        s.id === this.payload.sheetId
          ? { ...s, views: [...s.views, sectionView] }
          : s,
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
  }

  async revert(): Promise<void> {
    if (!this.newViewId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;

    if (this.cacheKey) {
      await sectionCache.delete(this.cacheKey);
      this.cacheKey = null;
    }

    const nextDoc: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map((s) =>
        s.id === this.payload.sheetId
          ? { ...s, views: s.views.filter((v) => v.id !== this.newViewId) }
          : s,
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
    this.newViewId = null;
  }
}
