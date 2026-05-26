// packages/app/src/drawing/DetailRegionEditHandles.tsx
import React, { useCallback, useRef } from 'react';
import type { DetailView, DrawingView } from '@zilventor/shared';
import { useToolModeStore } from './toolMode';
import type { Region } from './toolMode';

const HANDLE_SIZE_MM = 3; // screen-constant handle side in sheet-mm at zoom=1; scales with 1/zoom

interface Props {
  parentView: DrawingView & { projection: NonNullable<DrawingView['projection']> };
  detailView: DetailView;
  zoom: number;
  onUpdateLive: (region: Region) => void;
  onCommit: (prevRegion: Region, newRegion: Region) => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
  sheetW: number;
  sheetH: number;
}

function screenToSheet(
  clientX: number,
  clientY: number,
  svg: SVGSVGElement | null,
  sheetW: number,
  sheetH: number,
): { x: number; y: number } {
  const rect = svg?.getBoundingClientRect();
  const hasSize = rect && rect.width > 0 && rect.height > 0;
  return {
    x: hasSize ? ((clientX - rect.left) / (rect.width / sheetW)) : clientX,
    y: hasSize ? ((clientY - rect.top) / (rect.height / sheetH)) : clientY,
  };
}

function sheetToParentLocal(
  sheetPt: { x: number; y: number },
  parentView: DrawingView,
): { x: number; y: number } {
  const scale = parentView.scale.numerator / parentView.scale.denominator;
  return {
    x: (sheetPt.x - parentView.positionMm.x) / scale,
    y: (sheetPt.y - parentView.positionMm.y) / scale,
  };
}

// Shared drag wiring — attaches window pointermove/pointerup, RAF-throttled
function startDrag(
  svg: SVGSVGElement | null,
  sheetW: number,
  sheetH: number,
  parentView: DrawingView,
  rafPendingRef: React.MutableRefObject<boolean>,
  onMove: (localPt: { x: number; y: number }) => void,
  onUp: () => void,
): void {
  const handleMove = (ev: PointerEvent) => {
    if (rafPendingRef.current) return;
    rafPendingRef.current = true;
    requestAnimationFrame(() => {
      rafPendingRef.current = false;
      const sheetPt = screenToSheet(ev.clientX, ev.clientY, svg, sheetW, sheetH);
      const localPt = sheetToParentLocal(sheetPt, parentView);
      onMove(localPt);
    });
  };
  const handleUp = () => {
    onUp();
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
  };
  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', handleUp);
}

export function DetailRegionEditHandles({
  parentView,
  detailView,
  zoom,
  onUpdateLive,
  onCommit,
  svgRef,
  sheetW,
  sheetH,
}: Props) {
  const parentScale = parentView.scale.numerator / parentView.scale.denominator;
  const rp = detailView.regionParent;
  const hs = HANDLE_SIZE_MM / zoom;
  const rafPendingRef = useRef(false);

  // ── Pre-compute rect geometry (used by rect hooks below; safe for circle branch too as unused)
  const rectCenter = rp.kind === 'rect' ? rp.center : { x: 0, y: 0 };
  const rectWidthMm = rp.kind === 'rect' ? rp.widthMm : 0;
  const rectHeightMm = rp.kind === 'rect' ? rp.heightMm : 0;
  const sheetCx = parentView.positionMm.x + rectCenter.x * parentScale;
  const sheetCy = parentView.positionMm.y + rectCenter.y * parentScale;
  const hw = (rectWidthMm / 2) * parentScale;
  const hh = (rectHeightMm / 2) * parentScale;

  // ── Circle branch hooks (must be at top-level, unconditionally) ──────────
  const circleCenter = rp.kind === 'circle' ? rp.center : { x: 0, y: 0 };
  const circleRadiusMm = rp.kind === 'circle' ? rp.radiusMm : 0;
  const circleCx = parentView.positionMm.x + circleCenter.x * parentScale;
  const circleCy = parentView.positionMm.y + circleCenter.y * parentScale;
  const circleR  = circleRadiusMm * parentScale;

  const handlePointerDownCenter = useCallback(
    (e: React.PointerEvent<SVGCircleElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const startRegion: Region = { kind: 'circle', center: { ...circleCenter }, radiusMm: circleRadiusMm };
      const svg = svgRef.current;
      const anchorSheet = screenToSheet(e.clientX, e.clientY, svg, sheetW, sheetH);
      const anchorLocal = sheetToParentLocal(anchorSheet, parentView);
      useToolModeStore.getState().editDragStart(detailView.id, 'center', startRegion, anchorLocal);
      startDrag(svg, sheetW, sheetH, parentView, rafPendingRef,
        (localPt) => {
          const live = useToolModeStore.getState().editDragMove(localPt);
          if (live) onUpdateLive(live);
        },
        () => useToolModeStore.getState().editDragEnd((prev, next) => onCommit(prev, next)),
      );
    },
    [circleCenter, circleRadiusMm, detailView.id, parentView, onUpdateLive, onCommit, svgRef, sheetW, sheetH],
  );

  const handlePointerDownRadius = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const startRegion: Region = { kind: 'circle', center: { ...circleCenter }, radiusMm: circleRadiusMm };
      const svg = svgRef.current;
      useToolModeStore.getState().editDragStart(detailView.id, 'radius', startRegion, { x: circleCx + circleR, y: circleCy });
      startDrag(svg, sheetW, sheetH, parentView, rafPendingRef,
        (localPt) => {
          const live = useToolModeStore.getState().editDragMove(localPt);
          if (live) onUpdateLive(live);
        },
        () => useToolModeStore.getState().editDragEnd((prev, next) => onCommit(prev, next)),
      );
    },
    [circleCenter, circleRadiusMm, circleCx, circleCy, circleR, detailView.id, parentView, onUpdateLive, onCommit, svgRef, sheetW, sheetH],
  );

  // ── Rect branch hooks — 4 corner handlers (must be top-level, unconditionally) ──
  // IMPORTANT: do NOT factor these into a factory that calls useCallback internally —
  // that would be a hooks-in-a-loop violation. Each is a separate top-level useCallback call.
  const sharedRectDeps = [rectCenter, rectWidthMm, rectHeightMm, detailView.id, parentView, onUpdateLive, onCommit, svgRef, sheetW, sheetH] as const;

  const handleNW = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const startRegion: Region = { kind: 'rect', center: { ...rectCenter }, widthMm: rectWidthMm, heightMm: rectHeightMm };
      const svg = svgRef.current;
      const cornerLocal = sheetToParentLocal({ x: sheetCx - hw, y: sheetCy - hh }, parentView);
      useToolModeStore.getState().editDragStart(detailView.id, 'corner-NW', startRegion, cornerLocal);
      startDrag(svg, sheetW, sheetH, parentView, rafPendingRef,
        (localPt) => { const live = useToolModeStore.getState().editDragMove(localPt); if (live) onUpdateLive(live); },
        () => useToolModeStore.getState().editDragEnd((prev, next) => onCommit(prev, next)),
      );
    },
    [...sharedRectDeps],
  );

  const handleNE = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const startRegion: Region = { kind: 'rect', center: { ...rectCenter }, widthMm: rectWidthMm, heightMm: rectHeightMm };
      const svg = svgRef.current;
      const cornerLocal = sheetToParentLocal({ x: sheetCx + hw, y: sheetCy - hh }, parentView);
      useToolModeStore.getState().editDragStart(detailView.id, 'corner-NE', startRegion, cornerLocal);
      startDrag(svg, sheetW, sheetH, parentView, rafPendingRef,
        (localPt) => { const live = useToolModeStore.getState().editDragMove(localPt); if (live) onUpdateLive(live); },
        () => useToolModeStore.getState().editDragEnd((prev, next) => onCommit(prev, next)),
      );
    },
    [...sharedRectDeps],
  );

  const handleSE = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const startRegion: Region = { kind: 'rect', center: { ...rectCenter }, widthMm: rectWidthMm, heightMm: rectHeightMm };
      const svg = svgRef.current;
      const cornerLocal = sheetToParentLocal({ x: sheetCx + hw, y: sheetCy + hh }, parentView);
      useToolModeStore.getState().editDragStart(detailView.id, 'corner-SE', startRegion, cornerLocal);
      startDrag(svg, sheetW, sheetH, parentView, rafPendingRef,
        (localPt) => { const live = useToolModeStore.getState().editDragMove(localPt); if (live) onUpdateLive(live); },
        () => useToolModeStore.getState().editDragEnd((prev, next) => onCommit(prev, next)),
      );
    },
    [...sharedRectDeps],
  );

  const handleSW = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const startRegion: Region = { kind: 'rect', center: { ...rectCenter }, widthMm: rectWidthMm, heightMm: rectHeightMm };
      const svg = svgRef.current;
      const cornerLocal = sheetToParentLocal({ x: sheetCx - hw, y: sheetCy + hh }, parentView);
      useToolModeStore.getState().editDragStart(detailView.id, 'corner-SW', startRegion, cornerLocal);
      startDrag(svg, sheetW, sheetH, parentView, rafPendingRef,
        (localPt) => { const live = useToolModeStore.getState().editDragMove(localPt); if (live) onUpdateLive(live); },
        () => useToolModeStore.getState().editDragEnd((prev, next) => onCommit(prev, next)),
      );
    },
    [...sharedRectDeps],
  );

  // ── Rect body drag (move center) ─────────────────────────────────────────
  const handlePointerDownBody = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const startRegion: Region = { kind: 'rect', center: { ...rectCenter }, widthMm: rectWidthMm, heightMm: rectHeightMm };
      const svg = svgRef.current;
      const anchorSheet = screenToSheet(e.clientX, e.clientY, svg, sheetW, sheetH);
      const anchorLocal = sheetToParentLocal(anchorSheet, parentView);
      useToolModeStore.getState().editDragStart(detailView.id, 'center', startRegion, anchorLocal);
      startDrag(svg, sheetW, sheetH, parentView, rafPendingRef,
        (localPt) => {
          const live = useToolModeStore.getState().editDragMove(localPt);
          if (live) onUpdateLive(live);
        },
        () => useToolModeStore.getState().editDragEnd((prev, next) => onCommit(prev, next)),
      );
    },
    [rectCenter, rectWidthMm, rectHeightMm, detailView.id, parentView, onUpdateLive, onCommit, svgRef, sheetW, sheetH],
  );

  // ── CIRCLE branch ─────────────────────────────────────────────────────────
  if (rp.kind === 'circle') {
    return (
      <g data-detail-edit-handles={detailView.id}>
        {/* Body circle — transparent fill, captures center drags */}
        <circle
          data-role="edit-center-handle"
          cx={circleCx}
          cy={circleCy}
          r={circleR}
          fill="rgba(0,120,255,0.08)"
          fillOpacity={0}
          stroke="rgba(0,120,255,0.6)"
          strokeWidth={0.5 / zoom}
          strokeDasharray={`${1.5 / zoom} ${0.8 / zoom}`}
          style={{ cursor: 'move' }}
          onPointerDown={handlePointerDownCenter}
        />
        {/* East-edge square handle — resizes radius */}
        <rect
          data-role="edit-radius-handle"
          x={circleCx + circleR - hs / 2}
          y={circleCy - hs / 2}
          width={hs}
          height={hs}
          fill="white"
          stroke="rgba(0,120,255,0.8)"
          strokeWidth={0.4 / zoom}
          style={{ cursor: 'ew-resize' }}
          onPointerDown={handlePointerDownRadius}
        />
      </g>
    );
  }

  // ── RECT branch ───────────────────────────────────────────────────────────
  const bodyX = sheetCx - hw;
  const bodyY = sheetCy - hh;
  const bodyW = rectWidthMm  * parentScale;
  const bodyH = rectHeightMm * parentScale;

  const corners = [
    { id: 'NW' as const, sx: sheetCx - hw, sy: sheetCy - hh, cursor: 'nw-resize', handler: handleNW },
    { id: 'NE' as const, sx: sheetCx + hw, sy: sheetCy - hh, cursor: 'ne-resize', handler: handleNE },
    { id: 'SE' as const, sx: sheetCx + hw, sy: sheetCy + hh, cursor: 'se-resize', handler: handleSE },
    { id: 'SW' as const, sx: sheetCx - hw, sy: sheetCy + hh, cursor: 'sw-resize', handler: handleSW },
  ] as const;

  return (
    <g data-detail-edit-handles={detailView.id}>
      {/* Body rect — transparent fill, dashed stroke, captures center drags */}
      <rect
        data-role="edit-center-handle"
        x={bodyX}
        y={bodyY}
        width={bodyW}
        height={bodyH}
        fill="rgba(0,120,255,0.08)"
        fillOpacity={0}
        stroke="rgba(0,120,255,0.6)"
        strokeWidth={0.5 / zoom}
        strokeDasharray={`${1.5 / zoom} ${0.8 / zoom}`}
        style={{ cursor: 'move' }}
        onPointerDown={handlePointerDownBody}
      />
      {/* 4 corner handles */}
      {corners.map(({ id, sx, sy, cursor, handler }) => (
        <rect
          key={id}
          data-role={`edit-corner-handle-${id}`}
          x={sx - hs / 2}
          y={sy - hs / 2}
          width={hs}
          height={hs}
          fill="white"
          stroke="rgba(0,120,255,0.8)"
          strokeWidth={0.4 / zoom}
          style={{ cursor }}
          onPointerDown={handler}
        />
      ))}
    </g>
  );
}
