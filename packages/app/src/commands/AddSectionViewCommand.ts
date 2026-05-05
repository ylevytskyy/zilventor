// packages/app/src/commands/AddSectionViewCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, SectionView } from '@zilventor/shared';
import { resolveSectionSource, getHatchSpec } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { deriveSectionPlane } from '@zilventor/shared/src/drawing/sectionPlane';
import { cutBySectionPlane, cutAssemblyBySectionPlane } from '../kernel/cutBySectionPlane';
import { projectSectionView } from '../drawing/projectSectionView';
import { sectionCache } from '../drawing/sectionCache';
import { fingerprintPlane } from '../drawing/planeFingerprint';
import { allocateSectionLabel } from '@zilventor/shared/src/drawing/sectionLabel';

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

    // 1. Resolve parent view
    const parentView = sheet.views.find((v) => v.id === this.payload.parentViewId);
    if (!parentView) throw new Error('parent view not found');

    // 2. Resolve source body/assembly — build a minimal SectionView for lookup purposes
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
        hatchSegments: [],
        fingerprint: '',
      } satisfies SectionView,
      drawing,
    );

    // 3. Derive section plane and view matrix
    const { plane, sectionViewMatrix } = deriveSectionPlane(
      { p0: this.payload.p0, p1: this.payload.p1 },
      ((parentView as { viewMatrix?: number[] }).viewMatrix ?? (new Array(16).fill(0) as number[])) as import('@zilventor/shared/src/drawing/viewMatrix').Mat4,
      parentView.scale.numerator / parentView.scale.denominator,
      this.payload.arrowDirection,
    );

    // 4. Cache key — source.id is the file path (unique per project)
    const key = `${source.id}::${fingerprintPlane(plane)}`;
    this.cacheKey = key;

    // 5. Cache lookup or kernel cut
    let compound: unknown;
    let faceTags: FaceTagMap;
    const cached = await sectionCache.get(key);
    if (cached) {
      compound = cached.brep;
      faceTags = cached.faceTags;
    } else {
      const result = source.kind === 'assembly'
        ? await cutAssemblyBySectionPlane(source.id, plane, this.payload.arrowDirection)
        : await cutBySectionPlane(source.id, plane, this.payload.arrowDirection);

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

    // 6. Build material-registry hatch callback (wired per Batch 6 requirement)
    const materials =
      state.activePart?.materials ??
      state.activeAssembly?.materials ??
      [];
    const hatchLookup = (materialId: string): { angleDeg: number; spacingMm: number } => {
      const mat = materials.find((m) => m.id === materialId);
      return getHatchSpec(mat ?? { id: materialId, name: '', defaultThickness: 0, color: '#808080' });
    };

    // 7. Project — pass hatchLookup so per-material hatch patterns are applied
    const scale = parentView.scale.numerator / parentView.scale.denominator;
    const { edges, hatchSegments, fingerprint } = projectSectionView(
      compound as Parameters<typeof projectSectionView>[0],
      faceTags,
      scale,
      hatchLookup,
    );

    // 8. Auto-label
    const existingLabels = sheet.views
      .filter((v) => v.kind === 'section')
      .map((v) => (v as SectionView).label);
    const label = allocateSectionLabel(existingLabels);

    // 9. Build section view
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

    const nextDoc: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map((s) =>
        s.id === this.payload.sheetId
          ? { ...s, views: [...s.views, sectionView] }
          : s,
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc } });
  }

  async revert(): Promise<void> {
    if (!this.newViewId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;

    // Free cache entry
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
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc } });
    this.newViewId = null;
  }
}
