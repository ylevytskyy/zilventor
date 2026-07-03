import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NestSheet, PlacedPanel } from '@zilventor/shared';
import type { MaterialEntry } from '@zilventor/shared/src/material';
import type { GrainDirection } from '@zilventor/shared/src/panel-feature';
import { evaluatePlacement, type Rect } from '../commands/EditPlacedPanelCommand';

export type SheetSvgProps = {
  sheet: NestSheet;
  material: MaterialEntry | undefined;
  grainByRowKey: Map<string, GrainDirection>;
  onExportPng: (sheet: NestSheet) => void;
  editable?: boolean;
  selectedIndex?: number | null;
  onSelectPanel?: (index: number) => void;
  onDragEnd?: (panelArrayIndex: number, dx: number, dy: number) => void;
};

// Screen-pixel movement below this on pointerup is treated as a click, not a drag.
const CLICK_THRESHOLD_PX = 3;

type DragState = { panelArrayIndex: number; dx: number; dy: number; valid: boolean };

// jsdom gotcha: getBoundingClientRect() is all-zero in tests — fall back to raw
// clientX/clientY so unit tests can drive drags treating clientX/Y as sheet-mm.
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
    x: hasSize ? (clientX - rect.left) / (rect.width / sheetW) : clientX,
    y: hasSize ? (clientY - rect.top) / (rect.height / sheetH) : clientY,
  };
}

function makePanelPointerDownHandler(
  p: PlacedPanel,
  i: number,
  sheet: NestSheet,
  svgRef: React.RefObject<SVGSVGElement | null>,
  onSelectPanel: ((index: number) => void) | undefined,
  onDragEnd: ((panelArrayIndex: number, dx: number, dy: number) => void) | undefined,
  setDrag: (d: DragState | null) => void,
) {
  return (e: React.PointerEvent<SVGGElement>) => {
    e.stopPropagation();
    onSelectPanel?.(i);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const svg = svgRef.current;
    const sheetW = sheet.sheetLengthMm;
    const sheetH = sheet.sheetWidthMm;
    const anchor = screenToSheet(e.clientX, e.clientY, svg, sheetW, sheetH);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const panelStartX = p.x;
    const panelStartY = p.y;

    const handleMove = (ev: PointerEvent) => {
      const cur = screenToSheet(ev.clientX, ev.clientY, svg, sheetW, sheetH);
      const dx = cur.x - anchor.x;
      const dy = cur.y - anchor.y;
      const candidate: Rect = { x: panelStartX + dx, y: panelStartY + dy, length: p.length, width: p.width };
      setDrag({ panelArrayIndex: i, dx, dy, valid: evaluatePlacement(candidate, sheet, i).valid });
    };
    const handleUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      const movedPx = Math.max(Math.abs(ev.clientX - startClientX), Math.abs(ev.clientY - startClientY));
      if (movedPx >= CLICK_THRESHOLD_PX) {
        const cur = screenToSheet(ev.clientX, ev.clientY, svg, sheetW, sheetH);
        onDragEnd?.(i, cur.x - anchor.x, cur.y - anchor.y);
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };
}

export function SheetSvg({
  sheet, material, grainByRowKey, onExportPng, editable, selectedIndex, onSelectPanel, onDragEnd,
}: SheetSvgProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const ghostPanel = drag ? sheet.panels[drag.panelArrayIndex] : undefined;
  const fill = material?.color ?? '#dddddd';
  return (
    <div data-nesting-sheet={`${sheet.materialId}:${sheet.sheetIndex}`}>
      <div className="flex items-center justify-between text-xs mb-1">
        <span>
          {t('panel.sheet.sheetInfo', { index: sheet.sheetIndex, pct: sheet.utilizationPct })}
          {sheet.manuallyEdited && (
            <span aria-label={t('panel.sheet.manuallyEditedAriaLabel')} style={{ marginLeft: 6, color: '#b45309' }}>
              ⚠ {t('panel.sheet.manuallyEditedBadge')}
            </span>
          )}
        </span>
        <button
          type="button"
          aria-label={t('panel.sheet.exportPngAriaLabel', { index: sheet.sheetIndex })}
          onClick={() => onExportPng(sheet)}
        >
          {t('panel.sheet.exportPng')}
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${sheet.sheetLengthMm} ${sheet.sheetWidthMm}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: 'auto' }}
      >
        <rect x={0} y={0} width={sheet.sheetLengthMm} height={sheet.sheetWidthMm}
          fill="white" stroke="#888" strokeWidth={2} />
        {sheet.panels.map((p, i) => {
          const grain = grainByRowKey.get(p.rowKey) ?? 'none';
          const selected = editable && selectedIndex === i;
          return (
            <g
              key={i}
              data-nesting-panel={`${p.itemNumber}:${i}`}
              {...(editable
                ? {
                    onClick: () => onSelectPanel?.(i),
                    onPointerDown: makePanelPointerDownHandler(p, i, sheet, svgRef, onSelectPanel, onDragEnd, setDrag),
                    role: 'button',
                    tabIndex: 0,
                    'aria-label': t('panel.sheet.selectPanelAriaLabel', { itemNumber: p.itemNumber }),
                    style: { cursor: 'pointer' },
                  }
                : {})}
            >
              <rect x={p.x} y={p.y} width={p.length} height={p.width}
                fill={fill} stroke={selected ? '#0a84ff' : '#222'} strokeWidth={selected ? 3 : 1} />
              <text x={p.x + 8} y={p.y + 24} fontSize={20} fill="#222">#{p.itemNumber}</text>
              {p.length > 200 && (
                <text x={p.x + p.length / 2} y={p.y + p.width / 2}
                  textAnchor="middle" dominantBaseline="middle" fontSize={18} fill="#222">
                  {p.length}×{p.width}
                </text>
              )}
              {grain !== 'none' && (
                <path d={grainArrowPath(p, grain, p.rotated)} stroke="#222" strokeWidth={1.5} fill="none" />
              )}
              {p.mirrored && (
                <text
                  x={p.x + p.length - 4}
                  y={p.y + 16}
                  textAnchor="end"
                  fontSize={14}
                  fill="#a33"
                  aria-label={t('panel.sheet.mirroredMarkerAriaLabel', { itemNumber: p.itemNumber })}
                >
                  ⇄
                </text>
              )}
            </g>
          );
        })}
        {drag && ghostPanel && (
          <rect
            data-nesting-drag-ghost={`${ghostPanel.itemNumber}:${drag.panelArrayIndex}`}
            data-nesting-drag-valid={drag.valid}
            x={ghostPanel.x + drag.dx}
            y={ghostPanel.y + drag.dy}
            width={ghostPanel.length}
            height={ghostPanel.width}
            fill={drag.valid ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}
            stroke={drag.valid ? '#22c55e' : '#ef4444'}
            strokeWidth={2}
            strokeDasharray="6,4"
            pointerEvents="none"
          />
        )}
        {sheet.remnant && (
          <>
            <rect
              x={sheet.remnant.x} y={sheet.remnant.y}
              width={sheet.remnant.length} height={sheet.remnant.width}
              fill="none" stroke="#2a8" strokeWidth={2} strokeDasharray="8,4"
              data-nesting-remnant
            />
            <text x={sheet.remnant.x + 8} y={sheet.remnant.y + 24} fontSize={16} fill="#2a8">
              {t('panel.sheet.remnantLabel', { length: sheet.remnant.length, width: sheet.remnant.width })}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

function grainArrowPath(
  p: { x: number; y: number; length: number; width: number },
  grain: GrainDirection,
  rotated: boolean,
): string {
  // Grain along sheet length when grain='length' and not rotated, OR grain='width' and rotated.
  const alongLength = (grain === 'length' && !rotated) || (grain === 'width' && rotated);
  const cx = p.x + p.length / 2;
  const cy = p.y + p.width / 2;
  const half = Math.min(p.length, p.width) * 0.25;
  if (alongLength) {
    return `M${cx - half},${cy} L${cx + half},${cy} M${cx + half - 6},${cy - 6} L${cx + half},${cy} L${cx + half - 6},${cy + 6}`;
  }
  return `M${cx},${cy - half} L${cx},${cy + half} M${cx - 6},${cy + half - 6} L${cx},${cy + half} L${cx + 6},${cy + half - 6}`;
}
