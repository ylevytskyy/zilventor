// packages/app/src/drawing/DrawingCanvas.tsx
import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useToolModeStore } from './toolMode';
import { TitleBlock } from './TitleBlock';
import { ViewElement } from './ViewElement';
import { SectionLineOverlay } from './SectionLineOverlay';
import { DimensionElement } from './DimensionElement';
import { AnnotationElement } from './AnnotationElement';
import { computeStaleViewIds } from './computeStaleViewIds';
import { AddDrawingDimensionCommand } from '../commands/AddDrawingDimensionCommand';
import { AddDrawingAnnotationCommand } from '../commands/AddDrawingAnnotationCommand';
import { AddSectionViewCommand } from '../commands/AddSectionViewCommand';
import { AddDetailViewCommand } from '../commands/AddDetailViewCommand';
import { AddBreakCommand } from '../commands/AddBreakCommand';
import { AutoDimCommand } from '../commands/AutoDimCommand';
import { AddDimensionGroupCommand } from '../commands/AddDimensionGroupCommand';
import { AddBaselineMemberCommand } from '../commands/AddBaselineMemberCommand';
import { AddOrdinateMemberCommand } from '../commands/AddOrdinateMemberCommand';
import { AddAngularDimCommand } from '../commands/AddAngularDimCommand';
import { DeleteDimensionGroupCommand } from '../commands/DeleteDimensionGroupCommand';
import { AddHoleTableCommand } from '../commands/AddHoleTableCommand';
import { extractHolesInView, assignHoleTags } from '@zilventor/shared/src/drawing/holeTable';
import { AddBreakDialog } from './AddBreakDialog';
import { DetailRegionOverlay } from './DetailRegionOverlay';
import { DetailRegionEditHandles } from './DetailRegionEditHandles';
import { HalfSectionSidePreview } from './HalfSectionSidePreview';
import { EditDetailRegionCommand } from '../commands/EditDetailRegionCommand';
import { AddBaseViewCommand } from '../commands/AddBaseViewCommand';
import { AddProjectedViewCommand } from '../commands/AddProjectedViewCommand';
import { AddIsoViewCommand } from '../commands/AddIsoViewCommand';
import type { Region } from './toolMode';
import { allocateCalloutLabel } from '@zilventor/shared/src/drawing/sectionLabel';
import type { DrawingDocument, DrawingSheet, SectionView, DetailView, BaseView, ProjectedView, IsoView } from '@zilventor/shared';
import { RegenerateViewCommand } from '../commands/RegenerateViewCommand';
import { projectViewFromSource } from './projectViewFromSource';
import { deriveProjectedOrientation } from '@zilventor/shared/src/drawing/deriveProjectedOrientation';
import type { ViewOrientation } from '@zilventor/shared';

// ISO sheet sizes in mm (landscape orientation)
const ISO_MM: Record<string, { w: number; h: number }> = {
  A0: { w: 1189, h: 841 }, A1: { w: 841, h: 594 },
  A2: { w: 594, h: 420 },  A3: { w: 420, h: 297 },
  A4: { w: 297, h: 210 },
};

function sheetDims(sheet: DrawingSheet): { w: number; h: number } {
  if (sheet.size.kind === 'custom') {
    return sheet.orientation === 'landscape'
      ? { w: sheet.size.widthMm, h: sheet.size.heightMm }
      : { w: sheet.size.heightMm, h: sheet.size.widthMm };
  }
  const base = ISO_MM[sheet.size.size] ?? { w: 420, h: 297 };
  return sheet.orientation === 'landscape' ? base : { w: base.h, h: base.w };
}

type ClickPoint = { x: number; y: number; edgeId: string | undefined; viewId: string | undefined };

// Helper: return view id whose bounding rect contains the given sheet-space point.
// Falls back to the data-view-id attribute of the click target when available.
function getViewAtPoint(
  views: DrawingSheet['views'],
  sheetPt: { x: number; y: number },
  targetViewId: string | undefined,
): string | undefined {
  if (targetViewId) {
    const hit = views.find((v) => v.id === targetViewId);
    if (hit) return hit.id;
  }
  // Coarse hit-test: each view occupies a 200×150 mm bounding box by default.
  // Implementer note: replace with actual view-extent tracking when available.
  for (const v of views) {
    const { x, y } = v.positionMm;
    if (
      sheetPt.x >= x && sheetPt.x <= x + 200 &&
      sheetPt.y >= y && sheetPt.y <= y + 150
    ) {
      return v.id;
    }
  }
  return undefined;
}

function sheetToParentLocal(
  sheetPt: { x: number; y: number },
  parentView: DrawingSheet['views'][number],
): { x: number; y: number } {
  const scale = parentView.scale.numerator / parentView.scale.denominator;
  return {
    x: (sheetPt.x - parentView.positionMm.x) / scale,
    y: (sheetPt.y - parentView.positionMm.y) / scale,
  };
}

export function DrawingCanvas() {
  const drawing = useAppStore((s) => s.activeDrawing);
  const bus = useAppStore((s) => s.bus);
  const toolMode = useToolModeStore((s) => s.mode);
  const sectionState = useToolModeStore((s) => s.sectionState);
  const sectionMode = useToolModeStore((s) => s.sectionMode);
  const detailState = useToolModeStore((s) => s.detailState);
  const detailRectState = useToolModeStore((s) => s.detailRectState);
  const breakState = useToolModeStore((s) => s.breakState);
  const editDetailRegionState = useToolModeStore((s) => s.editDetailRegionState);

  // Pan/zoom state
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [cursorMm, setCursorMm] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const middleDragRef = useRef<{ startX: number; startY: number; startPan: { x: number; y: number } } | null>(null);

  // F5 session refs — useRef to avoid triggering re-render on phase transitions
  type BaselineSession =
    | { phase: 'pick-datum' }
    | { phase: 'pick-members'; groupId: string; viewId: string; memberCount: number };
  type OrdinateSession =
    | { phase: 'pick-origin' }
    | { phase: 'pick-members'; groupId: string; viewId: string; memberCount: number; originSheetPt: { x: number; y: number } };
  type AngularSession =
    | { phase: 'pick-edge-1' }
    | { phase: 'pick-edge-2'; viewId: string; edge1: { viewId: string; edgeId: string } };

  const baselineSessionRef = useRef<BaselineSession>({ phase: 'pick-datum' });
  const ordinateSessionRef = useRef<OrdinateSession>({ phase: 'pick-origin' });
  const angularSessionRef = useRef<AngularSession>({ phase: 'pick-edge-1' });

  // Tool-mode click accumulation (up to 2 clicks for linear dims / centerline)
  const [clickAccum, setClickAccum] = useState<ClickPoint[]>([]);
  const [addBreakDialogOpen, setAddBreakDialogOpen] = useState(false);

  // Per-view stale flags
  const [staleViews, setStaleViews] = useState<Set<string>>(new Set());

  const source = useAppStore((s) => s.activePart ?? s.activeAssembly);
  const activeDrawingSourceFingerprint = useAppStore((s) => s.activeDrawingSourceFingerprint);

  if (!drawing) {
    return <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">No drawing open.</div>;
  }

  const sheet = drawing.sheets.find((s) => s.id === drawing.activeSheetId) ?? drawing.sheets[0];
  if (!sheet) return null;

  const { w: sheetW, h: sheetH } = sheetDims(sheet);
  // Stable string IDs for use in useEffect dep arrays (avoids TS null-narrowing issues)
  const drawingId = drawing.id;
  const sheetId = sheet.id;

  // Detect stale views on drawing activation / source fingerprint change.
  // Reads activeDrawingSourceFingerprint (bytes hash set by loadDrawingSource in B0).
  // Uses computeStaleViewIds() for the two staleness conditions.
  //
  // NOTE: do NOT use fingerprintPartState(activePart) here — activePart is null in the live
  // drawing context (reset by drawingDocState). The bytes-based fingerprint slot is correct.
  useEffect(() => {
    setStaleViews(computeStaleViewIds(sheet.views, activeDrawingSourceFingerprint));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing.id, sheet.id, activeDrawingSourceFingerprint]);

  // F5: Reset sessions when toolMode changes away from them
  useEffect(() => {
    if (toolMode !== 'baseline') {
      const s = baselineSessionRef.current;
      if (s.phase === 'pick-members' && s.memberCount === 0) {
        void bus.execute(new DeleteDimensionGroupCommand({ sheetId, groupId: s.groupId }));
      }
      baselineSessionRef.current = { phase: 'pick-datum' };
    }
    if (toolMode !== 'ordinate') {
      const s = ordinateSessionRef.current;
      if (s.phase === 'pick-members' && s.memberCount === 0) {
        void bus.execute(new DeleteDimensionGroupCommand({ sheetId, groupId: s.groupId }));
      }
      ordinateSessionRef.current = { phase: 'pick-origin' };
    }
    if (toolMode !== 'angular') {
      angularSessionRef.current = { phase: 'pick-edge-1' };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolMode]);

  // ESC / Enter / Arrow keys for section/detail/break tool
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // CRITICAL: read live state at event time — closed-over render-scope value is stale
      const liveState = useToolModeStore.getState().sectionState;

      if (liveState.stage === 'pickCutSide') {
        if (e.key === 'Escape') {
          useToolModeStore.getState().sectionCancel();
          return;
        }
        if (e.key === 'ArrowRight') {
          useToolModeStore.getState().sectionPickCutSide(1);
          return;
        }
        if (e.key === 'ArrowLeft') {
          useToolModeStore.getState().sectionPickCutSide(-1);
          return;
        }
        if (e.key === 'Enter') {
          // Capture fields BEFORE committing (commit resets state)
          const captured = liveState;
          useToolModeStore.getState().sectionCommitCutSide((cutSide, dropAt) => {
            void bus.execute(new AddSectionViewCommand({
              drawingId: drawingId,
              sheetId: sheetId,
              parentViewId: captured.parentViewId,
              p0: captured.p0,
              p1: captured.p1,
              arrowDirection: captured.arrowDirection,
              dropAt,
              mode: 'half',
              cutSide,
            }));
          });
          return;
        }
      }

      // Existing fallback: Escape cancels section/detail/break at any other stage
      if (e.key === 'Escape') {
        useToolModeStore.getState().sectionCancel();
        useToolModeStore.getState().detailCancel();
        useToolModeStore.getState().detailRectCancel();
        useToolModeStore.getState().breakCancel();

        // F2.4 — ESC during editDetailRegion:
        // Per spec §5.3, a mid-drag ESC must revert the live document preview to startRegion
        // BEFORE calling editDetailCancel() (which only resets tool state, not the document).
        const liveEditState = useToolModeStore.getState().editDetailRegionState;
        if (
          liveEditState.stage === 'draggingCenter' ||
          liveEditState.stage === 'draggingRadius' ||
          liveEditState.stage === 'draggingCorner'
        ) {
          // Read the live drawing to find the active sheet
          const liveDrawing = useAppStore.getState().activeDrawing;
          const liveSheet = liveDrawing?.sheets.find((s) => s.id === liveDrawing.activeSheetId)
            ?? liveDrawing?.sheets[0];
          if (liveSheet) {
            // Revert document preview to startRegion (cancels the in-progress drag)
            useAppStore.getState().updateDetailRegionLive(
              liveSheet.id,
              liveEditState.detailViewId,
              liveEditState.startRegion,
            );
          }
        }
        useToolModeStore.getState().editDetailCancel();
        // F5 — cancel active sessions
        const liveDrwEsc = useAppStore.getState().activeDrawing;
        const liveSheetEsc = liveDrwEsc?.sheets.find((s) => s.id === liveDrwEsc.activeSheetId) ?? liveDrwEsc?.sheets[0];
        const bSess = baselineSessionRef.current;
        if (bSess.phase === 'pick-members' && bSess.memberCount === 0 && liveSheetEsc) {
          void bus.execute(new DeleteDimensionGroupCommand({ sheetId: liveSheetEsc.id, groupId: bSess.groupId }));
        }
        baselineSessionRef.current = { phase: 'pick-datum' };
        const oSess = ordinateSessionRef.current;
        if (oSess.phase === 'pick-members' && oSess.memberCount === 0 && liveSheetEsc) {
          void bus.execute(new DeleteDimensionGroupCommand({ sheetId: liveSheetEsc.id, groupId: oSess.groupId }));
        }
        ordinateSessionRef.current = { phase: 'pick-origin' };
        angularSessionRef.current = { phase: 'pick-edge-1' };
        const liveMode = useToolModeStore.getState().mode;
        if (liveMode === 'baseline' || liveMode === 'ordinate' || liveMode === 'angular') {
          useToolModeStore.getState().setMode('idle');
        }
        // F6 — holeTable ESC
        if (liveMode === 'holeTable') {
          useToolModeStore.getState().holeTableCancel();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [bus, drawingId, sheetId]);

  // Pan/zoom handlers
  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.1, Math.min(20, z * delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button === 1) {
      middleDragRef.current = { startX: e.clientX, startY: e.clientY, startPan: pan };
    }
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (middleDragRef.current) {
      const dx = e.clientX - middleDragRef.current.startX;
      const dy = e.clientY - middleDragRef.current.startY;
      setPan({ x: middleDragRef.current.startPan.x + dx, y: middleDragRef.current.startPan.y + dy });
    }
    // Track cursor for live preview
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    const hasSize = rect && rect.width > 0 && rect.height > 0;
    if (hasSize) {
      setCursorMm({
        x: (e.clientX - rect.left) / (rect.width / sheetW),
        y: (e.clientY - rect.top) / (rect.height / sheetH),
      });
    } else {
      // In test environment, use client coords directly as mm
      setCursorMm({ x: e.clientX, y: e.clientY });
    }
  }, [pan, sheetW, sheetH]);

  const handleMouseUp = useCallback(() => {
    middleDragRef.current = null;
  }, []);

  // Tool-mode click dispatch
  const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (toolMode === 'idle') return;

    const target = e.target as SVGElement;
    const edgeId = target.getAttribute('data-edge-id') ?? undefined;
    const viewId = target.getAttribute('data-view-id') ?? undefined;

    // Convert client coords to SVG page-space mm
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    const hasSize = rect && rect.width > 0 && rect.height > 0;
    const svgX = hasSize ? ((e.clientX - rect.left) / (rect.width / sheetW)) : e.clientX;
    const svgY = hasSize ? ((e.clientY - rect.top) / (rect.height / sheetH)) : e.clientY;
    const clickPt: ClickPoint = { x: svgX, y: svgY, edgeId, viewId };

    if (toolMode === 'section') {
      const toolState = useToolModeStore.getState().sectionState;
      const sheetPt = { x: svgX, y: svgY };
      const hitViewId = getViewAtPoint(sheet.views, sheetPt, viewId);

      if (toolState.stage === 'idle') {
        if (hitViewId) {
          useToolModeStore.getState().sectionPickParent(hitViewId);
        }
        return;
      }

      if (toolState.stage === 'pickP0') {
        // Must click inside the locked parent view
        const parentView = sheet.views.find((v) => v.id === toolState.parentViewId);
        if (!parentView) return;
        const inParent = getViewAtPoint([parentView], sheetPt, viewId) != null;
        if (!inParent) return; // click outside parent — ignore
        // Convert sheet-space → view-space (subtract view origin, divide by scale)
        const scale = parentView.scale.numerator / parentView.scale.denominator;
        const viewPt = {
          x: (sheetPt.x - parentView.positionMm.x) / scale,
          y: (sheetPt.y - parentView.positionMm.y) / scale,
        };
        useToolModeStore.getState().sectionPickP0(viewPt);
        return;
      }

      if (toolState.stage === 'pickP1') {
        const parentView = sheet.views.find((v) => v.id === toolState.parentViewId);
        if (!parentView) return;
        const inParent = getViewAtPoint([parentView], sheetPt, viewId) != null;
        if (!inParent) return;
        const scale = parentView.scale.numerator / parentView.scale.denominator;
        const viewPt = {
          x: (sheetPt.x - parentView.positionMm.x) / scale,
          y: (sheetPt.y - parentView.positionMm.y) / scale,
        };
        useToolModeStore.getState().sectionPickP1(viewPt);
        return;
      }

      if (toolState.stage === 'pickDrop') {
        if (sectionMode === 'half') {
          // half-section: sectionPickDrop transitions to pickCutSide; onDispatch unused
          useToolModeStore.getState().sectionPickDrop(sheetPt, () => {});
        } else {
          useToolModeStore.getState().sectionPickDrop(sheetPt, () => {
            void bus.execute(new AddSectionViewCommand({
              drawingId: drawing.id,
              sheetId: sheet.id,
              parentViewId: toolState.parentViewId,
              p0: toolState.p0,
              p1: toolState.p1,
              arrowDirection: toolState.arrowDirection,
              dropAt: sheetPt,
              mode: 'full',
            }));
          });
        }
        return;
      }

      return;
    }

    if (toolMode === 'detail') {
      const ds = useToolModeStore.getState().detailState;
      const sheetPt = { x: svgX, y: svgY };
      const hitViewId = getViewAtPoint(sheet.views, sheetPt, viewId);

      if (ds.stage === 'idle') {
        if (hitViewId) {
          useToolModeStore.getState().detailPickParent(hitViewId);
        }
        return;
      }

      if (ds.stage === 'pickRegionCenter') {
        const parentView = sheet.views.find((v) => v.id === ds.parentViewId);
        if (!parentView) return;
        const parentLocalPt = sheetToParentLocal(sheetPt, parentView);
        useToolModeStore.getState().detailPickCenter(parentLocalPt);
        return;
      }

      if (ds.stage === 'pickRegionRadius') {
        const parentView = sheet.views.find((v) => v.id === ds.parentViewId);
        if (!parentView) return;
        const parentLocalPt = sheetToParentLocal(sheetPt, parentView);
        useToolModeStore.getState().detailPickRadius(parentLocalPt);
        return;
      }

      if (ds.stage === 'pickDrop') {
        useToolModeStore.getState().detailPickDrop(sheetPt, () => {
          void bus.execute(new AddDetailViewCommand({
            drawingId: drawing.id,
            sheetId: sheet.id,
            parentViewId: ds.parentViewId,
            regionParent: { kind: 'circle', center: ds.center, radiusMm: ds.radiusMm },
            dropAt: sheetPt,
          }));
        });
        return;
      }

      return;
    }

    if (toolMode === 'detailRect') {
      const drs = useToolModeStore.getState().detailRectState;
      const sheetPt = { x: svgX, y: svgY };

      if (drs.stage === 'idle') {
        const hitViewId = getViewAtPoint(sheet.views, sheetPt, viewId);
        if (hitViewId) {
          useToolModeStore.getState().detailRectPickParent(hitViewId);
        }
        return;
      }

      if (drs.stage === 'pickFirstCorner') {
        const parentView = sheet.views.find((v) => v.id === drs.parentViewId);
        if (!parentView) return;
        const localPt = sheetToParentLocal(sheetPt, parentView);
        useToolModeStore.getState().detailRectPickFirstCorner(localPt);
        return;
      }

      if (drs.stage === 'pickSecondCorner') {
        const parentView = sheet.views.find((v) => v.id === drs.parentViewId);
        if (!parentView) return;
        const localPt = sheetToParentLocal(sheetPt, parentView);
        useToolModeStore.getState().detailRectPickSecondCorner(localPt);
        return;
      }

      if (drs.stage === 'pickDrop') {
        useToolModeStore.getState().detailRectPickDrop(sheetPt, () => {
          void bus.execute(new AddDetailViewCommand({
            drawingId: drawing.id,
            sheetId: sheet.id,
            parentViewId: drs.parentViewId,
            regionParent: {
              kind: 'rect',
              center: drs.center,
              widthMm: drs.widthMm,
              heightMm: drs.heightMm,
            },
            dropAt: sheetPt,
          }));
        });
        return;
      }

      return;
    }

    if (toolMode === 'break') {
      const bs = useToolModeStore.getState().breakState;
      const sheetPt = { x: svgX, y: svgY };

      if (bs.stage === 'pickParent') {
        const hitViewId = getViewAtPoint(sheet.views, sheetPt, viewId);
        if (!hitViewId) return;
        const hitView = sheet.views.find((v) => v.id === hitViewId);
        if (!hitView) return;
        if (hitView.kind === 'section' || hitView.kind === 'detail') {
          return;
        }
        useToolModeStore.getState().breakPickParent(hitViewId);
        setAddBreakDialogOpen(true);
        return;
      }

      if (bs.stage === 'pickP0') {
        const parentView = sheet.views.find((v) => v.id === bs.viewId);
        if (!parentView) return;
        const localPt = sheetToParentLocal(sheetPt, parentView);
        const coord = bs.axis === 'x' ? localPt.x : localPt.y;
        useToolModeStore.getState().breakPickP0(coord);
        return;
      }

      if (bs.stage === 'pickP1') {
        const parentView = sheet.views.find((v) => v.id === bs.viewId);
        if (!parentView) return;
        const localPt = sheetToParentLocal(sheetPt, parentView);
        const coord = bs.axis === 'x' ? localPt.x : localPt.y;
        useToolModeStore.getState().breakPickP1(coord, (coordA, coordB) => {
          void bus.execute(new AddBreakCommand({
            drawingId: drawing.id,
            sheetId: sheet.id,
            viewId: bs.viewId,
            axis: bs.axis,
            coordA,
            coordB,
            gapMm: 5,
          }));
        });
        return;
      }

      return;
    }

    if (toolMode === 'autoDim') {
      // CRITICAL: read live state (avoids stale-closure bug, per F1.1 pattern)
      const liveDrw = useAppStore.getState().activeDrawing;
      const liveSheet = liveDrw?.sheets.find((s) => s.id === liveDrw.activeSheetId) ?? liveDrw?.sheets[0];
      if (!liveDrw || !liveSheet) return;
      const sheetPt = { x: svgX, y: svgY };
      const hitViewId = getViewAtPoint(liveSheet.views, sheetPt, viewId);
      if (hitViewId) {
        void bus.execute(new AutoDimCommand({
          drawingId: liveDrw.id,
          sheetId: liveSheet.id,
          viewId: hitViewId,
        }));
        useToolModeStore.getState().setMode('idle');
      }
      return;
    }

    if (toolMode === 'baseline') {
      // CRITICAL: read live state to avoid stale closure (see F1.1 pattern)
      const liveDrw = useAppStore.getState().activeDrawing;
      const liveSheet = liveDrw?.sheets.find((s) => s.id === liveDrw.activeSheetId) ?? liveDrw?.sheets[0];
      if (!liveDrw || !liveSheet) return;

      const clickedEdgeId = (e.target as SVGElement).getAttribute('data-edge-id') ?? undefined;
      const clickedViewId = (e.target as SVGElement).getAttribute('data-view-id') ?? undefined;
      if (!clickedEdgeId) return; // require edge click

      const sess = baselineSessionRef.current;

      if (sess.phase === 'pick-datum') {
        const hitViewId = getViewAtPoint(liveSheet.views, { x: svgX, y: svgY }, clickedViewId);
        if (!hitViewId) return;

        const groupId = crypto.randomUUID();
        const group = {
          kind: 'baseline' as const,
          id: groupId,
          viewId: hitViewId,
          datum: { kind: 'edge-endpoint' as const, edgeId: clickedEdgeId, end: 'start' as const },
          direction: 'h' as const,
          baseOffsetMm: 20,
          spacingMm: 10,
        };
        void bus.execute(new AddDimensionGroupCommand({ sheetId: liveSheet.id, group }));
        baselineSessionRef.current = { phase: 'pick-members', groupId, viewId: hitViewId, memberCount: 0 };
        return;
      }

      if (sess.phase === 'pick-members') {
        const memberTo = { kind: 'edge-endpoint' as const, edgeId: clickedEdgeId, end: 'start' as const };
        void bus.execute(new AddBaselineMemberCommand({ sheetId: liveSheet.id, groupId: sess.groupId, to: memberTo }));
        baselineSessionRef.current = { ...sess, memberCount: sess.memberCount + 1 };
        return;
      }

      return;
    }

    if (toolMode === 'ordinate') {
      const liveDrw = useAppStore.getState().activeDrawing;
      const liveSheet = liveDrw?.sheets.find((s) => s.id === liveDrw.activeSheetId) ?? liveDrw?.sheets[0];
      if (!liveDrw || !liveSheet) return;

      const clickedEdgeId = (e.target as SVGElement).getAttribute('data-edge-id') ?? undefined;
      const clickedViewId = (e.target as SVGElement).getAttribute('data-view-id') ?? undefined;
      if (!clickedEdgeId) return;

      const sess = ordinateSessionRef.current;

      if (sess.phase === 'pick-origin') {
        const hitViewId = getViewAtPoint(liveSheet.views, { x: svgX, y: svgY }, clickedViewId);
        if (!hitViewId) return;

        const groupId = crypto.randomUUID();
        const group = {
          kind: 'ordinate' as const,
          id: groupId,
          viewId: hitViewId,
          origin: { kind: 'edge-endpoint' as const, edgeId: clickedEdgeId, end: 'start' as const },
          xColumnOffsetMm: 20,
          yColumnOffsetMm: 20,
        };
        void bus.execute(new AddDimensionGroupCommand({ sheetId: liveSheet.id, group }));
        ordinateSessionRef.current = {
          phase: 'pick-members',
          groupId,
          viewId: hitViewId,
          memberCount: 0,
          originSheetPt: { x: svgX, y: svgY },
        };
        return;
      }

      if (sess.phase === 'pick-members') {
        // Axis inference: greater absolute delta determines axis direction
        const dx = Math.abs(svgX - sess.originSheetPt.x);
        const dy = Math.abs(svgY - sess.originSheetPt.y);
        // Shift-click flips the inferred axis
        let axis: 'x' | 'y' = dx > dy ? 'y' : 'x';
        if (e.shiftKey) axis = axis === 'x' ? 'y' : 'x';

        const memberTo = { kind: 'edge-endpoint' as const, edgeId: clickedEdgeId, end: 'start' as const };
        void bus.execute(new AddOrdinateMemberCommand({ sheetId: liveSheet.id, groupId: sess.groupId, to: memberTo, axis }));
        ordinateSessionRef.current = { ...sess, memberCount: sess.memberCount + 1 };
        return;
      }

      return;
    }

    if (toolMode === 'angular') {
      const liveDrw = useAppStore.getState().activeDrawing;
      const liveSheet = liveDrw?.sheets.find((s) => s.id === liveDrw.activeSheetId) ?? liveDrw?.sheets[0];
      if (!liveDrw || !liveSheet) return;

      const clickedEdgeId = (e.target as SVGElement).getAttribute('data-edge-id') ?? undefined;
      const clickedViewId = (e.target as SVGElement).getAttribute('data-view-id') ?? undefined;
      const clickedEdgeKind = (e.target as SVGElement).getAttribute('data-edge-kind') ?? 'outline';
      if (!clickedEdgeId) return;

      const hitViewId = getViewAtPoint(liveSheet.views, { x: svgX, y: svgY }, clickedViewId);
      if (!hitViewId) return;

      const sess = angularSessionRef.current;

      if (sess.phase === 'pick-edge-1') {
        if (clickedEdgeKind === 'arc') {
          // Single-arc shortcut: immediate dispatch
          void bus.execute(new AddAngularDimCommand({
            sheetId: liveSheet.id,
            viewId: hitViewId,
            ref: { kind: 'arc', edge: { viewId: hitViewId, edgeId: clickedEdgeId } },
          }));
          angularSessionRef.current = { phase: 'pick-edge-1' };
          useToolModeStore.getState().setMode('idle');
          return;
        }
        // Line edge: store edge1 and advance to pick-edge-2
        angularSessionRef.current = {
          phase: 'pick-edge-2',
          viewId: hitViewId,
          edge1: { viewId: hitViewId, edgeId: clickedEdgeId },
        };
        return;
      }

      if (sess.phase === 'pick-edge-2') {
        void bus.execute(new AddAngularDimCommand({
          sheetId: liveSheet.id,
          viewId: sess.viewId,
          ref: {
            kind: 'two-edges',
            edge1: sess.edge1,
            edge2: { viewId: hitViewId, edgeId: clickedEdgeId },
          },
        }));
        angularSessionRef.current = { phase: 'pick-edge-1' };
        useToolModeStore.getState().setMode('idle');
        return;
      }

      return;
    }

    if (toolMode === 'holeTable') {
      // CRITICAL: read live state to avoid stale-closure bug (per F1.1 pattern)
      const liveDrw = useAppStore.getState().activeDrawing;
      const liveSheet = liveDrw?.sheets.find((s) => s.id === liveDrw.activeSheetId)
        ?? liveDrw?.sheets[0];
      if (!liveDrw || !liveSheet) return;

      const hs = useToolModeStore.getState().holeTableState;
      const sheetPt = { x: svgX, y: svgY };

      if (hs.stage === 'idle') {
        // First click: require an edge click inside a projected view to establish datum.
        const clickedEdgeId = (e.target as SVGElement).getAttribute('data-edge-id') ?? undefined;
        const clickedViewId = (e.target as SVGElement).getAttribute('data-view-id') ?? undefined;
        if (!clickedEdgeId || !clickedViewId) return;

        const targetView = liveSheet.views.find((v) => v.id === clickedViewId);
        if (!targetView || !targetView.projection) return; // must be a projected view

        // Collect all edges from the view projection
        const allEdges = [
          ...targetView.projection.visibleEdges,
          ...targetView.projection.hiddenEdges,
        ];
        const clickedEdge = allEdges.find((ed) => ed.id === clickedEdgeId);
        if (!clickedEdge) return;

        // Use arc-center for feature edges (likely hole circles), edge-endpoint otherwise.
        const datum: import('@zilventor/shared/src/drawing/types').PointRef =
          clickedEdge.kind === 'feature'
            ? { kind: 'arc-center', edgeId: clickedEdgeId }
            : { kind: 'edge-endpoint', edgeId: clickedEdgeId, end: 'start' };

        useToolModeStore.getState().holeTablePickDatum(clickedViewId, datum);
        return;
      }

      if (hs.stage === 'pickDatum') {
        // Second click: any sheet point → commit the table.
        useToolModeStore.getState().holeTablePickPlacement(
          sheetPt,
          (viewId, datum, posMm) => {
            const part = useAppStore.getState().activePart;
            if (!part) return;

            const targetView = liveSheet.views.find((v) => v.id === viewId);
            if (!targetView) return;

            const resolveParam = (p: import('@zilventor/shared').ParamOrLiteral): number =>
              p.kind === 'literal'
                ? p.value
                : (part.parameters[p.paramName]?.value ?? 0);

            const holes = extractHolesInView(targetView, part);
            const tagMap = assignHoleTags(holes, new Map(), resolveParam);
            const entries = Array.from(tagMap.entries()).map(([holeFeatureId, tag]) => ({
              holeFeatureId,
              tag,
            }));

            // No holes detected in this view — skip command so no empty table enters undo history.
            if (entries.length === 0) return;

            const ann: import('@zilventor/shared').HoleTableAnnotation = {
              kind: 'holeTable',
              id: crypto.randomUUID(),
              viewId,
              datum,
              positionMm: posMm,
              entries,
            };
            void bus.execute(new AddHoleTableCommand({ sheetId: liveSheet.id, ann }));
          },
        );
        return;
      }

      return;
    }

    if (toolMode === 'addLinearH' || toolMode === 'addLinearV' || toolMode === 'addAligned') {
      const next = [...clickAccum, clickPt];
      if (next.length >= 2) {
        const [p1, p2] = next as [ClickPoint, ClickPoint];
        const v = sheet.views.find((vw) => vw.id === (p1.viewId ?? p2.viewId));
        const viewId_ = v?.id ?? (sheet.views[0]?.id ?? 'unknown');
        const kind = toolMode === 'addLinearH' ? 'linear-h' as const
                   : toolMode === 'addLinearV' ? 'linear-v' as const : 'aligned' as const;
        void bus.execute(new AddDrawingDimensionCommand({
          sheetId: sheet.id,
          dim: {
            id: `dim-${Date.now()}`,
            kind,
            viewId: viewId_,
            from: { kind: 'edge-endpoint', edgeId: p1.edgeId ?? 'unknown', end: 'start' },
            to:   { kind: 'edge-endpoint', edgeId: p2.edgeId ?? 'unknown', end: 'start' },
            offsetMm: 15,
          },
        }));
        setClickAccum([]);
      } else {
        setClickAccum(next);
      }
      return;
    }

    if (toolMode === 'addCenterline') {
      const next = [...clickAccum, clickPt];
      if (next.length >= 2) {
        const [p1, p2] = next as [ClickPoint, ClickPoint];
        const v = sheet.views.find((vw) => vw.id === (p1.viewId ?? p2.viewId));
        const viewId_ = v?.id ?? (sheet.views[0]?.id ?? 'unknown');
        void bus.execute(new AddDrawingAnnotationCommand({
          sheetId: sheet.id,
          ann: {
            id: `ann-${Date.now()}`,
            kind: 'centerline',
            viewId: viewId_,
            edgeIdA: p1.edgeId ?? 'unknown',
            edgeIdB: p2.edgeId ?? 'unknown',
          },
        }));
        setClickAccum([]);
      } else {
        setClickAccum(next);
      }
      return;
    }

    if (toolMode === 'addCenterMark') {
      if (edgeId) {
        const v = sheet.views.find((vw) => vw.id === viewId);
        const viewId_ = v?.id ?? (sheet.views[0]?.id ?? 'unknown');
        void bus.execute(new AddDrawingAnnotationCommand({
          sheetId: sheet.id,
          ann: { id: `ann-${Date.now()}`, kind: 'center-mark', viewId: viewId_, edgeId },
        }));
      }
      setClickAccum([]);
      return;
    }

    if (toolMode === 'placeBase') {
      const params = useToolModeStore.getState().pendingViewParams;
      if (params?.kind !== 'base') { setClickAccum([]); return; }
      const sheetPt = { x: svgX, y: svgY };
      void bus.execute(new AddBaseViewCommand({
        sheetId: sheet.id,
        positionMm: sheetPt,
        orientation: params.orientation,
        scale: { numerator: params.scale.n, denominator: params.scale.d },
      }));
      useToolModeStore.getState().reset();
      setClickAccum([]);
      return;
    }

    if (toolMode === 'placeProjected') {
      const params = useToolModeStore.getState().pendingViewParams;
      if (params?.kind !== 'projected') { setClickAccum([]); return; }
      const sheetPt = { x: svgX, y: svgY };
      void bus.execute(new AddProjectedViewCommand({
        sheetId: sheet.id,
        baseViewId: params.baseViewId,
        direction: params.direction,
        positionMm: sheetPt,
      }));
      useToolModeStore.getState().reset();
      setClickAccum([]);
      return;
    }

    if (toolMode === 'placeIso') {
      const params = useToolModeStore.getState().pendingViewParams;
      if (params?.kind !== 'iso') { setClickAccum([]); return; }
      const sheetPt = { x: svgX, y: svgY };
      void bus.execute(new AddIsoViewCommand({
        sheetId: sheet.id,
        positionMm: sheetPt,
        corner: params.corner,
        scale: { numerator: params.scale.n, denominator: params.scale.d },
      }));
      useToolModeStore.getState().reset();
      setClickAccum([]);
      return;
    }

    // Other modes (addRadial, addDiametric, addLeader, addBalloon)
    setClickAccum([]);
  }, [toolMode, clickAccum, sheet, bus, sheetW, sheetH, drawing, sectionMode]);

  const handleRegenerate = useCallback((viewId: string) => {
    const view = sheet.views.find((v) => v.id === viewId);
    if (!view || view.kind === 'section' || view.kind === 'detail') {
      // Section/detail regenerate is out of scope for this pass (requires kernel re-cut).
      // Still clear the stale marker so the UI isn't permanently stuck.
      setStaleViews((prev) => { const next = new Set(prev); next.delete(viewId); return next; });
      return;
    }

    // Derive orientation for the view.
    let orientation: ViewOrientation;
    if (view.kind === 'base') {
      orientation = view.orientation;
    } else if (view.kind === 'iso') {
      orientation = `iso-${view.corner}` as ViewOrientation;
    } else if (view.kind === 'projected') {
      const baseView = sheet.views.find(
        (v): v is BaseView => v.id === view.baseViewId && v.kind === 'base'
      );
      if (!baseView) {
        setStaleViews((prev) => { const next = new Set(prev); next.delete(viewId); return next; });
        return;
      }
      orientation = deriveProjectedOrientation(baseView.orientation, view.direction);
    } else {
      setStaleViews((prev) => { const next = new Set(prev); next.delete(viewId); return next; });
      return;
    }

    void (async () => {
      try {
        const { projection, inputFingerprint } = await projectViewFromSource(orientation);
        await bus.execute(new RegenerateViewCommand({
          sheetId: sheet.id,
          viewId,
          projection,
          inputFingerprint,
        }));
        setStaleViews((prev) => { const next = new Set(prev); next.delete(viewId); return next; });
      } catch (err) {
        console.error('[handleRegenerate] failed:', err);
        // Do not clear the stale marker on error — leave it for the user to retry.
      }
    })();
  }, [sheet, bus]);

  // viewBox incorporating pan/zoom (at zero pan/zoom = "0 0 sheetW sheetH")
  const vbX = -pan.x / zoom;
  const vbY = -pan.y / zoom;
  const vbW = sheetW / zoom;
  const vbH = sheetH / zoom;

  return (
    <Fragment>
    <svg
      ref={svgRef}
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%', display: 'block', background: '#e5e7eb' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
    >
      {/* Sheet border */}
      <rect
        data-sheet-border
        x={0} y={0} width={sheetW} height={sheetH}
        fill="white" stroke="#888" strokeWidth={0.5}
      />

      {/* Views */}
      {sheet.views.map((v) => (
        <ViewElement
          key={v.id}
          view={v}
          isStale={staleViews.has(v.id)}
          onRegenerate={handleRegenerate}
        />
      ))}

      {/* Section line overlays — one per section view over its parent */}
      {sheet.views
        .filter((v): v is SectionView => v.kind === 'section')
        .map((sv) => {
          const parent = sheet.views.find((v) => v.id === sv.parentViewId);
          if (!parent || (parent.kind !== 'base' && parent.kind !== 'projected')) return null;
          return (
            <SectionLineOverlay
              key={`overlay-${sv.id}`}
              parentView={parent as BaseView | ProjectedView}
              sectionView={sv}
              zoom={zoom}
            />
          );
        })}

      {/* Detail callout overlays — circle + letter on parent view for each detail view */}
      {sheet.views
        .filter((v): v is DetailView => v.kind === 'detail')
        .map((dv) => {
          const parent = sheet.views.find((v) => v.id === dv.parentViewId);
          if (!parent) return null;
          return (
            <DetailRegionOverlay
              key={`detail-overlay-${dv.id}`}
              parentView={parent as BaseView | ProjectedView | IsoView | SectionView}
              detailView={dv}
              zoom={zoom}
            />
          );
        })}

      {/* Edit-detail-region handles — shown only in editDetailRegion mode (Drawing F2.4) */}
      {toolMode === 'editDetailRegion' && sheet.views
        .filter((v): v is DetailView => v.kind === 'detail')
        .map((dv) => {
          const parent = sheet.views.find((v) => v.id === dv.parentViewId);
          if (!parent || !parent.projection) return null;
          return (
            <DetailRegionEditHandles
              key={`edit-handles-${dv.id}`}
              parentView={parent as (BaseView | ProjectedView | IsoView | SectionView) & { projection: NonNullable<(BaseView | ProjectedView | IsoView | SectionView)['projection']> }}
              detailView={dv}
              zoom={zoom}
              onUpdateLive={(region: Region) => {
                useAppStore.getState().updateDetailRegionLive(sheet.id, dv.id, region);
              }}
              onCommit={(prevRegion: Region, newRegion: Region) => {
                void bus.execute(new EditDetailRegionCommand({
                  sheetId: sheet.id,
                  detailViewId: dv.id,
                  prevRegion,
                  newRegion,
                }));
              }}
              svgRef={svgRef}
              sheetW={sheetW}
              sheetH={sheetH}
            />
          );
        })}

      {/* Rubber-band circle preview during pickRegionRadius */}
      {toolMode === 'detail' && detailState.stage === 'pickRegionRadius' && cursorMm && (() => {
        const ds = detailState;
        const parentView = sheet.views.find((v) => v.id === ds.parentViewId);
        if (!parentView) return null;
        const parentScale = parentView.scale.numerator / parentView.scale.denominator;
        // Center in sheet space
        const cx = parentView.positionMm.x + ds.center.x * parentScale;
        const cy = parentView.positionMm.y + ds.center.y * parentScale;
        // Radius = distance from sheet-space center to cursor
        const dx = cursorMm.x - cx;
        const dy = cursorMm.y - cy;
        const r = Math.sqrt(dx * dx + dy * dy);
        return (
          <circle
            key="detail-preview-circle"
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="black"
            strokeWidth={0.35}
            strokeDasharray="2 1"
            data-role="detail-preview-circle"
          />
        );
      })()}

      {/* Ghost bbox rect preview during pickDrop */}
      {toolMode === 'detail' && detailState.stage === 'pickDrop' && cursorMm && (() => {
        const ds = detailState;
        // Default detail scale 2:1 (the command uses this at apply time)
        const detailScale = 2;
        const side = 2 * ds.radiusMm * detailScale;
        return (
          <rect
            key="detail-drop-ghost"
            x={cursorMm.x - side / 2}
            y={cursorMm.y - side / 2}
            width={side}
            height={side}
            fill="none"
            stroke="black"
            strokeWidth={0.35}
            strokeDasharray="3 1.5"
            opacity={0.5}
            data-role="detail-drop-ghost"
          />
        );
      })()}

      {/* Rubber-band rect preview during pickSecondCorner (detailRect) */}
      {/* [no-TDD: pure-visual, verified via Playwright in Batch 5] — jsdom getBoundingClientRect returns 0 for SVGSVGElement */}
      {toolMode === 'detailRect' && detailRectState.stage === 'pickSecondCorner' && cursorMm && (() => {
        const drs = detailRectState;
        const parentView = sheet.views.find((v) => v.id === drs.parentViewId);
        if (!parentView) return null;
        const parentScale = parentView.scale.numerator / parentView.scale.denominator;
        // firstCorner is in parent-local mm → convert to sheet space
        const c1SheetX = parentView.positionMm.x + drs.firstCorner.x * parentScale;
        const c1SheetY = parentView.positionMm.y + drs.firstCorner.y * parentScale;
        const x = Math.min(c1SheetX, cursorMm.x);
        const y = Math.min(c1SheetY, cursorMm.y);
        const w = Math.abs(cursorMm.x - c1SheetX);
        const h = Math.abs(cursorMm.y - c1SheetY);
        return (
          <rect
            key="detail-rect-preview"
            x={x}
            y={y}
            width={w}
            height={h}
            fill="none"
            stroke="black"
            strokeWidth={0.35}
            strokeDasharray="2 1"
            data-role="detail-rect-preview"
          />
        );
      })()}

      {/* Ghost bbox rect preview during pickDrop (detailRect) */}
      {/* [no-TDD: pure-visual, verified via Playwright in Batch 5] — jsdom getBoundingClientRect returns 0 for SVGSVGElement */}
      {toolMode === 'detailRect' && detailRectState.stage === 'pickDrop' && cursorMm && (() => {
        const drs = detailRectState;
        const detailScale = 2;
        const w = drs.widthMm * detailScale;
        const h = drs.heightMm * detailScale;
        return (
          <rect
            key="detail-rect-drop-ghost"
            x={cursorMm.x - w / 2}
            y={cursorMm.y - h / 2}
            width={w}
            height={h}
            fill="none"
            stroke="black"
            strokeWidth={0.35}
            strokeDasharray="3 1.5"
            opacity={0.5}
            data-role="detail-rect-drop-ghost"
          />
        );
      })()}

      {/* Live preview overlay during section tool pickDrop stage */}
      {toolMode === 'section' && sectionState.stage === 'pickDrop' && (() => {
        const ds = sectionState;
        const parent = sheet.views.find((v) => v.id === ds.parentViewId);
        if (!parent || (parent.kind !== 'base' && parent.kind !== 'projected')) return null;
        const existingLabels = sheet.views
          .filter((v): v is SectionView | DetailView =>
            v.kind === 'section' || v.kind === 'detail')
          .map((v) => v.label);
        const previewLabel = allocateCalloutLabel(existingLabels);
        const previewView: SectionView = {
          id: 'preview',
          kind: 'section',
          label: previewLabel,
          parentViewId: ds.parentViewId,
          sectionLine: { p0: ds.p0, p1: ds.p1 },
          arrowDirection: ds.arrowDirection,
          positionMm: { x: 0, y: 0 },
          scale: { numerator: 1, denominator: 1 },
          showHidden: false,
          mode: 'full',
          hatchSegments: [],
          fingerprint: '',
          projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
        };
        return (
          <SectionLineOverlay
            key="overlay-preview"
            parentView={parent as BaseView | ProjectedView}
            sectionView={previewView}
            zoom={zoom}
          />
        );
      })()}

      {/* Dimensions */}
      {sheet.dimensions.map((dim) => {
        const v = sheet.views.find((vw) => vw.id === dim.viewId);
        if (!v) return null;
        return <DimensionElement key={dim.id} dim={dim} view={v} />;
      })}

      {/* Annotations */}
      {sheet.annotations.map((ann) => {
        const v = sheet.views.find((vw) => vw.id === ann.viewId);
        if (!v) return null;
        return <AnnotationElement key={ann.id} ann={ann} view={v} />;
      })}

      {/* Title block (source may be null during loading) */}
      {source && (
        <TitleBlock
          drawing={drawing}
          sheet={sheet}
          source={source}
          sheetIndex={drawing.sheets.findIndex((s) => s.id === sheet.id)}
          sheetCount={drawing.sheets.length}
          createdAt=""
        />
      )}

      {/* Break axis hint badge during pickAxis stage */}
      {toolMode === 'break' && breakState.stage === 'pickAxis' && cursorMm && (
        <g data-role="break-axis-guide" key="break-axis-hint">
          <rect
            x={cursorMm.x - 10}
            y={cursorMm.y - 4}
            width={20}
            height={8}
            fill="rgba(0,0,0,0.6)"
            rx={2}
          />
          <text
            x={cursorMm.x}
            y={cursorMm.y + 2}
            textAnchor="middle"
            fontSize={3}
            fill="white"
            fontFamily="sans-serif"
          >
            Choose axis in dialog
          </text>
        </g>
      )}

      {/* Break coordA guide line during pickP1 stage */}
      {toolMode === 'break' && breakState.stage === 'pickP1' && cursorMm && (() => {
        const bs = breakState;
        const parentView = sheet.views.find((v) => v.id === bs.viewId);
        if (!parentView) return null;
        const s = parentView.scale.numerator / parentView.scale.denominator;
        const coordASheet = bs.axis === 'x'
          ? parentView.positionMm.x + bs.coordA * s
          : parentView.positionMm.y + bs.coordA * s;
        return (
          <line
            key="break-p1-guide"
            data-role="break-axis-guide"
            x1={bs.axis === 'x' ? coordASheet : 0}
            y1={bs.axis === 'x' ? 0 : coordASheet}
            x2={bs.axis === 'x' ? coordASheet : sheetW}
            y2={bs.axis === 'x' ? sheetH : coordASheet}
            stroke="rgba(30,100,255,0.6)"
            strokeWidth={0.4}
            strokeDasharray="3 2"
          />
        );
      })()}
      {/* F5 — Baseline pick-members ghost dim line */}
      {/* NOTE (F5): Preview overlays re-render on every cursorMm update because DrawingCanvas
          has no React.memo boundary (F4 structural-dependency caveat — see spec §Risks).
          If performance is a concern, extract these into React.memo overlay components. */}
      {toolMode === 'baseline' && baselineSessionRef.current.phase === 'pick-members' && cursorMm && (() => {
        return (
          <line
            key="baseline-dim-preview"
            data-role="dim-preview"
            x1={0}
            y1={cursorMm.y - 20}
            x2={sheetW}
            y2={cursorMm.y - 20}
            stroke="rgba(30,100,255,0.5)"
            strokeWidth={0.35}
            strokeDasharray="2 1.5"
          />
        );
      })()}

      {/* F5 — Ordinate pick-members ghost L-leader */}
      {toolMode === 'ordinate' && ordinateSessionRef.current.phase === 'pick-members' && cursorMm && (() => {
        const sess = ordinateSessionRef.current;
        if (sess.phase !== 'pick-members') return null;
        const colX = sess.originSheetPt.x + 20;
        return (
          <path
            key="ordinate-leader-preview"
            data-role="dim-preview"
            d={`M ${cursorMm.x} ${cursorMm.y} L ${colX} ${cursorMm.y} L ${colX} ${sess.originSheetPt.y}`}
            fill="none"
            stroke="rgba(30,100,255,0.5)"
            strokeWidth={0.35}
            strokeDasharray="2 1.5"
          />
        );
      })()}

      {/* F5 — Angular pick-edge-2 ghost arc */}
      {toolMode === 'angular' && angularSessionRef.current.phase === 'pick-edge-2' && cursorMm && (() => {
        // Ghost: small dashed circle at cursor position, radius 15mm
        const r = 15;
        return (
          <circle
            key="angular-arc-preview"
            data-role="dim-preview"
            cx={cursorMm.x}
            cy={cursorMm.y}
            r={r}
            fill="none"
            stroke="rgba(30,100,255,0.5)"
            strokeWidth={0.35}
            strokeDasharray="2 1.5"
          />
        );
      })()}

      {/* Half-section cut-side picker overlay — rendered inside SVG in sheet-space mm */}
      {toolMode === 'section' && sectionState.stage === 'pickCutSide' && (
        <HalfSectionSidePreview
          sectionLine={{ p0: sectionState.p0, p1: sectionState.p1 }}
          pendingCutSide={sectionState.pendingCutSide}
          zoom={zoom}
          dropAt={sectionState.dropAt}
          onSideHover={(side) => useToolModeStore.getState().sectionPickCutSide(side)}
          onCommit={(cutSide) => {
            // Read live state for dispatch — do NOT use closed-over sectionState
            const live = useToolModeStore.getState().sectionState;
            if (live.stage !== 'pickCutSide') return;
            const { parentViewId, p0, p1, arrowDirection, dropAt } = live;
            useToolModeStore.getState().sectionCommitCutSide((_side, _drop) => {
              void bus.execute(new AddSectionViewCommand({
                drawingId,
                sheetId,
                parentViewId,
                p0,
                p1,
                arrowDirection,
                dropAt,
                mode: 'half',
                cutSide,
              }));
            });
          }}
        />
      )}
    </svg>

    <AddBreakDialog
      open={addBreakDialogOpen && toolMode === 'break' && breakState.stage === 'pickAxis'}
      onConfirm={(axis) => {
        setAddBreakDialogOpen(false);
        useToolModeStore.getState().breakSetAxis(axis);
      }}
      onCancel={() => {
        setAddBreakDialogOpen(false);
        useToolModeStore.getState().breakCancel();
      }}
    />
    </Fragment>
  );
}
