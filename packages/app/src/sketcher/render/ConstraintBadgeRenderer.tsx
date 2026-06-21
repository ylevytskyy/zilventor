import type { SketchConstraint, SketchPrimitive } from '@zilventor/shared';
import { useAppStore } from '../../store/useAppStore';
import { RemoveConstraintCommand } from '../../commands/RemoveConstraintCommand';

const GLYPH: Record<SketchConstraint['kind'], string> = {
  coincident: '●', horizontal: '—', vertical: '|', parallel: '∥',
  perpendicular: '⊥', tangent: '⌒', equal: '=', symmetric: '⇄',
  'dim-length': '', 'dim-distance': '', 'dim-angle': '',
  'dim-radius': '', 'dim-diameter': '', 'dim-point-line-distance': '',
};

type WorldToScreen = (x: number, y: number) => { x: number; y: number };

type Props = {
  primitives: SketchPrimitive[];
  constraints: SketchConstraint[];
  worldToScreen: WorldToScreen;
};

export function ConstraintBadgeRenderer({ primitives, constraints, worldToScreen }: Props) {
  const primsById = new Map(primitives.map((p) => [p.id, p]));
  const highlightedIds = useAppStore((s) => s.highlightedConstraintIds);
  const highlightedSet = new Set(highlightedIds);

  return (
    <div className="constraint-badges" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {constraints.map((c) => {
        const worldPos = anchorWorldPos(c, primsById);
        if (!worldPos) return null;
        const { x, y } = worldToScreen(worldPos.x, worldPos.y);
        const highlighted = highlightedSet.has(c.id);
        return (
          <button key={c.id}
            data-testid="constraint-badge"
            title={c.kind}
            style={{
              position: 'absolute', left: `${x}px`, top: `${y}px`,
              transform: 'translate(-50%, -50%)', pointerEvents: 'auto',
              width: 18, height: 18, borderRadius: 3,
              background: highlighted ? '#c23a3a' : '#2a7aa8', color: '#fff',
              fontFamily: 'ui-monospace, monospace', fontSize: 11, fontWeight: 700,
              border: 'none', cursor: 'pointer'
            }}
            onClick={(ev) => {
              ev.stopPropagation();
              const activeSketchId = useAppStore.getState().activeSketchId;
              if (!activeSketchId) return;
              void new RemoveConstraintCommand(activeSketchId, c).apply();
            }}>
            {GLYPH[c.kind]}
          </button>
        );
      })}
    </div>
  );
}

function anchorWorldPos(c: SketchConstraint, prims: Map<string, SketchPrimitive>): { x: number; y: number } | null {
  const midOfLine = (id: string) => {
    const p = prims.get(id);
    if (!p || p.kind !== 'line') return null;
    return { x: (p.x1 + p.x2) / 2, y: (p.y1 + p.y2) / 2 };
  };
  const pointAt = (ref: { primitiveId: string; anchor: string }): { x: number; y: number } | null => {
    const p = prims.get(ref.primitiveId);
    if (!p) return null;
    if (p.kind === 'line')      return ref.anchor === 'start' ? { x: p.x1, y: p.y1 } : { x: p.x2, y: p.y2 };
    if (p.kind === 'circle')    return { x: p.cx, y: p.cy };
    if (p.kind === 'arc')       return { x: p.cx, y: p.cy };
    if (p.kind === 'ellipse')   return { x: p.cx, y: p.cy };
    if (p.kind === 'rectangle') {
      switch (ref.anchor) {
        case 'bl': return { x: p.x,         y: p.y };
        case 'br': return { x: p.x + p.w,   y: p.y };
        case 'tr': return { x: p.x + p.w,   y: p.y + p.h };
        case 'tl': return { x: p.x,         y: p.y + p.h };
      }
    }
    return null;
  };
  switch (c.kind) {
    case 'horizontal':
    case 'vertical':       return midOfLine(c.line);
    case 'parallel':
    case 'perpendicular':  return midOfLine(c.line1);
    case 'equal':          return midOfLine(c.a) ?? midOfLine(c.b);
    case 'tangent':        return midOfLine(c.line);
    case 'coincident':     return pointAt(c.a);
    case 'symmetric':      return pointAt(c.a);
    case 'dim-length':
    case 'dim-distance':
    case 'dim-angle':
    case 'dim-radius':
    case 'dim-diameter':
    case 'dim-point-line-distance':
      // Dimensions have their own renderer (Task 14); this file only handles geometric-constraint badges.
      return null;
  }
}
