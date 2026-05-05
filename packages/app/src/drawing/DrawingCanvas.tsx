// packages/app/src/drawing/DrawingCanvas.tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useToolModeStore } from './toolMode';
import { TitleBlock } from './TitleBlock';
import { ViewElement } from './ViewElement';
import { DimensionElement } from './DimensionElement';
import { AnnotationElement } from './AnnotationElement';
import { AddDrawingDimensionCommand } from '../commands/AddDrawingDimensionCommand';
import { AddDrawingAnnotationCommand } from '../commands/AddDrawingAnnotationCommand';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';

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

export function DrawingCanvas() {
  const drawing = useAppStore((s) => s.activeDrawing);
  const bus = useAppStore((s) => s.bus);
  const toolMode = useToolModeStore((s) => s.mode);

  // Pan/zoom state
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);
  const middleDragRef = useRef<{ startX: number; startY: number; startPan: { x: number; y: number } } | null>(null);

  // Tool-mode click accumulation (up to 2 clicks for linear dims / centerline)
  const [clickAccum, setClickAccum] = useState<ClickPoint[]>([]);

  // Per-view stale flags
  const [staleViews, setStaleViews] = useState<Set<string>>(new Set());

  const source = useAppStore((s) => s.activePart ?? s.activeAssembly);

  if (!drawing) {
    return <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">No drawing open.</div>;
  }

  const sheet = drawing.sheets.find((s) => s.id === drawing.activeSheetId) ?? drawing.sheets[0];
  if (!sheet) return null;

  const { w: sheetW, h: sheetH } = sheetDims(sheet);

  // Detect stale views on mount (views with projection but no fingerprint)
  useEffect(() => {
    const stale = new Set<string>();
    for (const v of sheet.views) {
      if (v.projection && !v.inputFingerprint) stale.add(v.id);
    }
    setStaleViews(stale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing.id, sheet.id]);

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
    if (!middleDragRef.current) return;
    const dx = e.clientX - middleDragRef.current.startX;
    const dy = e.clientY - middleDragRef.current.startY;
    setPan({ x: middleDragRef.current.startPan.x + dx, y: middleDragRef.current.startPan.y + dy });
  }, []);

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
    const svgX = rect ? ((e.clientX - rect.left) / (rect.width / sheetW)) : e.clientX;
    const svgY = rect ? ((e.clientY - rect.top) / (rect.height / sheetH)) : e.clientY;
    const clickPt: ClickPoint = { x: svgX, y: svgY, edgeId, viewId };

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
  }, [toolMode, clickAccum, sheet, bus, sheetW, sheetH]);

  const handleRegenerate = useCallback((viewId: string) => {
    setStaleViews((prev) => { const next = new Set(prev); next.delete(viewId); return next; });
  }, []);

  // viewBox incorporating pan/zoom (at zero pan/zoom = "0 0 sheetW sheetH")
  const vbX = -pan.x / zoom;
  const vbY = -pan.y / zoom;
  const vbW = sheetW / zoom;
  const vbH = sheetH / zoom;

  return (
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
    </svg>
  );
}
