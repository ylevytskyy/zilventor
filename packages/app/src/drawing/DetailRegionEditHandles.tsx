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
  // DrawingCanvas captures sheetId + detailViewId in its closure when it builds this
  // callback, so the overlay only needs to pass the live region up. (See Task 3.2.)
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
  const { center, radiusMm } = detailView.regionParent;

  // Sheet-space callout circle (matches DetailRegionOverlay transform)
  const cx = parentView.positionMm.x + center.x * parentScale;
  const cy = parentView.positionMm.y + center.y * parentScale;
  const r  = radiusMm * parentScale;

  // Handle size in sheet-mm (constant screen size across zoom levels)
  const hs = HANDLE_SIZE_MM / zoom;

  // RAF-throttle ref
  const rafPendingRef = useRef(false);

  const handlePointerDownCenter = useCallback(
    (e: React.PointerEvent<SVGCircleElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);

      const startRegion: Region = { center: { ...center }, radiusMm };
      const svg = svgRef.current;
      const anchorSheet = screenToSheet(e.clientX, e.clientY, svg, sheetW, sheetH);
      const anchorLocal = sheetToParentLocal(anchorSheet, parentView);

      useToolModeStore.getState().editDragStart(detailView.id, 'center', startRegion, anchorLocal);

      const onPointerMove = (ev: PointerEvent) => {
        if (rafPendingRef.current) return;
        rafPendingRef.current = true;
        requestAnimationFrame(() => {
          rafPendingRef.current = false;
          const sheetPt = screenToSheet(ev.clientX, ev.clientY, svg, sheetW, sheetH);
          const localPt = sheetToParentLocal(sheetPt, parentView);
          const liveRegion = useToolModeStore.getState().editDragMove(localPt);
          if (liveRegion) {
            onUpdateLive(liveRegion);
          }
        });
      };

      const onPointerUp = () => {
        useToolModeStore.getState().editDragEnd((prev, next) => {
          onCommit(prev, next);
        });
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [center, radiusMm, detailView.id, parentView, onUpdateLive, onCommit, svgRef, sheetW, sheetH],
  );

  const handlePointerDownRadius = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      e.stopPropagation(); // prevent body circle from also capturing
      e.currentTarget.setPointerCapture(e.pointerId);

      const startRegion: Region = { center: { ...center }, radiusMm };
      const svg = svgRef.current;

      useToolModeStore.getState().editDragStart(detailView.id, 'radius', startRegion, { x: cx + r, y: cy });

      const onPointerMove = (ev: PointerEvent) => {
        if (rafPendingRef.current) return;
        rafPendingRef.current = true;
        requestAnimationFrame(() => {
          rafPendingRef.current = false;
          const sheetPt = screenToSheet(ev.clientX, ev.clientY, svg, sheetW, sheetH);
          const localPt = sheetToParentLocal(sheetPt, parentView);
          const liveRegion = useToolModeStore.getState().editDragMove(localPt);
          if (liveRegion) {
            onUpdateLive(liveRegion);
          }
        });
      };

      const onPointerUp = () => {
        useToolModeStore.getState().editDragEnd((prev, next) => {
          onCommit(prev, next);
        });
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [center, radiusMm, cx, cy, r, detailView.id, parentView, onUpdateLive, onCommit, svgRef, sheetW, sheetH],
  );

  return (
    <g data-detail-edit-handles={detailView.id}>
      {/* Body circle — transparent fill, captures center drags */}
      <circle
        data-role="edit-center-handle"
        cx={cx}
        cy={cy}
        r={r}
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
        x={cx + r - hs / 2}
        y={cy - hs / 2}
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
