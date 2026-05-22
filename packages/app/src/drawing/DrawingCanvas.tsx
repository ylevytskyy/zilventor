// packages/app/src/drawing/DrawingCanvas.tsx
import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useToolModeStore } from './toolMode';
import { TitleBlock } from './TitleBlock';
import { ViewElement } from './ViewElement';
import { SectionLineOverlay } from './SectionLineOverlay';
import { DimensionElement } from './DimensionElement';
import { AnnotationElement } from './AnnotationElement';
import { AddDrawingDimensionCommand } from '../commands/AddDrawingDimensionCommand';
import { AddDrawingAnnotationCommand } from '../commands/AddDrawingAnnotationCommand';
import { AddSectionViewCommand } from '../commands/AddSectionViewCommand';
import { AddDetailViewCommand } from '../commands/AddDetailViewCommand';
import { AddBreakCommand } from '../commands/AddBreakCommand';
import { AutoDimCommand } from '../commands/AutoDimCommand';
import { AddBreakDialog } from './AddBreakDialog';
import { DetailRegionOverlay } from './DetailRegionOverlay';
import { HalfSectionSidePreview } from './HalfSectionSidePreview';
import { allocateCalloutLabel } from '@zilventor/shared/src/drawing/sectionLabel';
import type { DrawingDocument, DrawingSheet, SectionView, DetailView, BaseView, ProjectedView, IsoView } from '@zilventor/shared';

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
  const breakState = useToolModeStore((s) => s.breakState);

  // Pan/zoom state
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [cursorMm, setCursorMm] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const middleDragRef = useRef<{ startX: number; startY: number; startPan: { x: number; y: number } } | null>(null);

  // Tool-mode click accumulation (up to 2 clicks for linear dims / centerline)
  const [clickAccum, setClickAccum] = useState<ClickPoint[]>([]);
  const [addBreakDialogOpen, setAddBreakDialogOpen] = useState(false);

  // Per-view stale flags
  const [staleViews, setStaleViews] = useState<Set<string>>(new Set());

  const source = useAppStore((s) => s.activePart ?? s.activeAssembly);

  if (!drawing) {
    return <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">No drawing open.</div>;
  }

  const sheet = drawing.sheets.find((s) => s.id === drawing.activeSheetId) ?? drawing.sheets[0];
  if (!sheet) return null;

  const { w: sheetW, h: sheetH } = sheetDims(sheet);
  // Stable string IDs for use in useEffect dep arrays (avoids TS null-narrowing issues)
  const drawingId = drawing.id;
  const sheetId = sheet.id;

  // Detect stale views on mount (views with projection but no fingerprint)
  useEffect(() => {
    const stale = new Set<string>();
    for (const v of sheet.views) {
      if (v.projection && !v.inputFingerprint) stale.add(v.id);
    }
    setStaleViews(stale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing.id, sheet.id]);

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
        useToolModeStore.getState().breakCancel();
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
            regionCenter: ds.center,
            regionRadiusMm: ds.radiusMm,
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

    // Other modes (addRadial, addDiametric, addLeader, addBalloon, placeBase) → wired in Phase 8 batch 2
    setClickAccum([]);
  }, [toolMode, clickAccum, sheet, bus, sheetW, sheetH, drawing, sectionMode]);

  const handleRegenerate = useCallback((viewId: string) => {
    setStaleViews((prev) => { const next = new Set(prev); next.delete(viewId); return next; });
  }, []);

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
