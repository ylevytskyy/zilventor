// packages/app/src/drawing/ViewElement.tsx
import type { DrawingView, SectionView, DetailView } from '@zilventor/shared';

export type ViewElementProps = {
  view: DrawingView;
  isStale: boolean;
  onRegenerate: (viewId: string) => void;
  /** Sheet zoom factor (default 1). Controls hatch stroke-width in mm. */
  sheetZoom?: number;
};

function pointsAttr(pts: ReadonlyArray<readonly [number, number]>): string {
  return pts.map(([x, y]) => `${x},${y}`).join(' ');
}

export function ViewElement({ view, isStale, onRegenerate, sheetZoom = 1 }: ViewElementProps) {
  const { positionMm, scale } = view;
  const scaleFactor = scale.numerator / scale.denominator;
  const proj = view.projection;

  // Section views never show hidden edges per ANSI convention
  const showHidden = view.kind !== 'section' && view.showHidden;

  return (
    <g
      data-view-id={view.id}
      transform={`translate(${positionMm.x}, ${positionMm.y}) scale(${scaleFactor})`}
    >
      {/* Visible edges */}
      <g data-edge-group="visible">
        {proj?.visibleEdges.map((e) => {
          if (e.kind === 'break') {
            return (
              <polyline
                key={e.id}
                data-edge-id={e.id}
                data-view-id={view.id}
                data-role="break-symbol"
                points={pointsAttr(e.points)}
                stroke="#111111"
                strokeWidth="0.5"
                fill="none"
              />
            );
          }
          return (
            <polyline
              key={e.id}
              data-edge-id={e.id}
              data-view-id={view.id}
              points={pointsAttr(e.points)}
              stroke="#111111"
              strokeWidth="0.35"
              fill="none"
            />
          );
        })}
      </g>

      {/* Hidden edges — suppressed for section views */}
      {showHidden && (
        <g data-edge-group="hidden">
          {proj?.hiddenEdges.map((e) => (
            <polyline
              key={e.id}
              data-edge-id={e.id}
              data-edge-kind="hidden"
              data-view-id={view.id}
              points={pointsAttr(e.points)}
              stroke="#111111"
              strokeWidth="0.18"
              strokeDasharray="2 1"
              fill="none"
            />
          ))}
        </g>
      )}

      {/* Section view hatch + caption */}
      {view.kind === 'section' && (
        <>
          {(view as SectionView).hatchSegments.map((seg, i) => (
            <line
              key={i}
              x1={seg.p0.x} y1={seg.p0.y}
              x2={seg.p1.x} y2={seg.p1.y}
              stroke="black"
              strokeWidth={0.25 / sheetZoom}
              data-role="hatch"
              data-material={seg.materialId}
            />
          ))}
          {proj && (
            <text
              x={(proj.bbox.minX + proj.bbox.maxX) / 2}
              y={proj.bbox.maxY + 5 / sheetZoom}
              textAnchor="middle"
              fontSize={4 / sheetZoom}
              fontFamily="sans-serif"
            >
              {`SECTION ${(view as SectionView).label}-${(view as SectionView).label}`}
            </text>
          )}
        </>
      )}

      {/* Detail view border + caption */}
      {view.kind === 'detail' && (() => {
        const dv = view as DetailView;
        const rp = dv.regionParent;
        const border =
          rp.kind === 'circle' ? (
            <circle
              cx={0}
              cy={0}
              r={rp.radiusMm}
              fill="none"
              stroke="black"
              strokeWidth={0.35}
              data-role="detail-border"
            />
          ) : (
            <rect
              x={-rp.widthMm / 2}
              y={-rp.heightMm / 2}
              width={rp.widthMm}
              height={rp.heightMm}
              fill="none"
              stroke="black"
              strokeWidth={0.35}
              data-role="detail-border"
            />
          );
        return (
          <>
            {border}
            {/* Caption: "DETAIL A" + scale ratio on second line */}
            {proj && (
              <text
                x={(proj.bbox.minX + proj.bbox.maxX) / 2}
                y={proj.bbox.maxY + 5 / sheetZoom}
                textAnchor="middle"
                fontSize={4 / sheetZoom}
                fontFamily="sans-serif"
                data-role="detail-caption"
              >
                {`DETAIL ${dv.label}`}
                <tspan
                  x={(proj.bbox.minX + proj.bbox.maxX) / 2}
                  dy={5 / sheetZoom}
                  fontSize={3.5 / sheetZoom}
                >
                  {`${view.scale.numerator}:${view.scale.denominator}`}
                </tspan>
              </text>
            )}
          </>
        );
      })()}

      {/* Stale banner: 16×16 mm warning marker, top-left of view (in view-local coords) */}
      {isStale && (
        <g
          data-stale-marker
          onClick={() => onRegenerate(view.id)}
          style={{ cursor: 'pointer' }}
        >
          <rect x={0} y={-16} width={16} height={16} fill="#fef08a" stroke="#ca8a04" strokeWidth={0.5} rx={1} />
          <text x={8} y={-4} textAnchor="middle" fontSize={10} fill="#92400e">⚠</text>
        </g>
      )}
    </g>
  );
}
