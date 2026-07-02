import { useTranslation } from 'react-i18next';
import type { NestSheet } from '@zilventor/shared';
import type { MaterialEntry } from '@zilventor/shared/src/material';
import type { GrainDirection } from '@zilventor/shared/src/panel-feature';

export type SheetSvgProps = {
  sheet: NestSheet;
  material: MaterialEntry | undefined;
  grainByRowKey: Map<string, GrainDirection>;
  onExportPng: (sheet: NestSheet) => void;
  editable?: boolean;
  selectedIndex?: number | null;
  onSelectPanel?: (index: number) => void;
};

export function SheetSvg({
  sheet, material, grainByRowKey, onExportPng, editable, selectedIndex, onSelectPanel,
}: SheetSvgProps) {
  const { t } = useTranslation();
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
