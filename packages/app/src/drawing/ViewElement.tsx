// packages/app/src/drawing/ViewElement.tsx
import type { DrawingView } from '@zilventor/shared';

export type ViewElementProps = {
  view: DrawingView;
  isStale: boolean;
  onRegenerate: (viewId: string) => void;
};

function pointsAttr(pts: ReadonlyArray<readonly [number, number]>): string {
  return pts.map(([x, y]) => `${x},${y}`).join(' ');
}

export function ViewElement({ view, isStale, onRegenerate }: ViewElementProps) {
  const { positionMm, scale } = view;
  const scaleFactor = scale.numerator / scale.denominator;
  const proj = view.projection;

  return (
    <g
      data-view-id={view.id}
      transform={`translate(${positionMm.x}, ${positionMm.y}) scale(${scaleFactor})`}
    >
      {/* Visible edges */}
      <g data-edge-group="visible">
        {proj?.visibleEdges.map((e) => (
          <polyline
            key={e.id}
            data-edge-id={e.id}
            data-view-id={view.id}
            points={pointsAttr(e.points)}
            stroke="#111111"
            strokeWidth="0.35"
            fill="none"
          />
        ))}
      </g>

      {/* Hidden edges */}
      {view.showHidden && (
        <g data-edge-group="hidden">
          {proj?.hiddenEdges.map((e) => (
            <polyline
              key={e.id}
              data-edge-id={e.id}
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
