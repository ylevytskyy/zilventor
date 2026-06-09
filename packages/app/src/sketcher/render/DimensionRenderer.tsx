import { useState, useRef, useEffect, type ReactNode } from 'react';
import type { DimensionConstraint, SketchPrimitive } from '@zilventor/shared';
import { useAppStore } from '../../store/useAppStore';

type Props = {
  primitives: SketchPrimitive[];
  dimensions: DimensionConstraint[];
  parameterValues: Map<string, number>;
  worldToScreen(x: number, y: number): { x: number; y: number };
  /** Called when user double-clicks any dimension glyph. Caller decides literal vs param. */
  onEditDimension?: (dimId: string) => void;
  /** If set, the dimension with this id shows an inline editor. */
  editingDimId?: string;
  /** The initial string value to seed the inline editor (angle in degrees, others as-is). */
  editingDimInitialValue?: string;
  /** Called when the editor commits (Enter or blur). Caller validates + dispatches. */
  onEditCommit?: (dimId: string, rawValue: string) => void;
  /** Called when the editor is cancelled (Escape). */
  onEditCancel?: () => void;
};

const OFFSET_PX = 20;
const ARC_RADIUS_PX = 40;

export function DimensionRenderer({ primitives, dimensions, parameterValues, worldToScreen, onEditDimension, editingDimId, editingDimInitialValue, onEditCommit, onEditCancel }: Props) {
  const byId = new Map(primitives.map((p) => [p.id, p]));
  const highlightedIds = useAppStore((s) => s.highlightedConstraintIds);
  const highlightedSet = new Set(highlightedIds);
  return (
    <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} width="100%" height="100%">
      {dimensions.map((d) => (
        <DimensionGlyph
          key={d.id}
          d={d}
          byId={byId}
          parameterValues={parameterValues}
          worldToScreen={worldToScreen}
          highlighted={highlightedSet.has(d.id)}
          onEditDimension={onEditDimension}
          isEditing={editingDimId === d.id}
          editingInitialValue={editingDimInitialValue ?? ''}
          onEditCommit={onEditCommit}
          onEditCancel={onEditCancel}
        />
      ))}
    </svg>
  );
}

function resolveValue(d: DimensionConstraint, params: Map<string, number>): number {
  if (d.value.kind === 'literal') return d.value.value;
  return params.get(d.value.paramName) ?? 0;
}

function format(val: number, kind: DimensionConstraint['kind']): string {
  const n = val.toFixed(2);
  if (kind === 'dim-angle') return `${n}°`;
  if (kind === 'dim-radius') return `R ${n}`;
  if (kind === 'dim-diameter') return `⌀ ${n}`;
  return n;
}

function DimensionGlyph({
  d, byId, parameterValues, worldToScreen, highlighted,
  onEditDimension, isEditing, editingInitialValue, onEditCommit, onEditCancel
}: {
  d: DimensionConstraint;
  byId: Map<string, SketchPrimitive>;
  parameterValues: Map<string, number>;
  worldToScreen: (x: number, y: number) => { x: number; y: number };
  highlighted: boolean;
  onEditDimension?: (dimId: string) => void;
  isEditing: boolean;
  editingInitialValue: string;
  onEditCommit?: (dimId: string, rawValue: string) => void;
  onEditCancel?: () => void;
}) {
  const lineColor = highlighted ? '#c23a3a' : '#e8c36a';
  const labelColor = highlighted ? '#ff9a9a' : '#e8c36a';
  const value = resolveValue(d, parameterValues);
  const text = format(value, d.kind);

  let els: ReactNode = null;
  let labelAt: { x: number; y: number } = { x: 0, y: 0 };

  if (d.kind === 'dim-length') {
    const p = byId.get(d.line);
    if (!p || p.kind !== 'line') return null;
    const s = worldToScreen(p.x1, p.y1), e = worldToScreen(p.x2, p.y2);
    const dx = e.x - s.x, dy = e.y - s.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const sOff = { x: s.x + nx * OFFSET_PX, y: s.y + ny * OFFSET_PX };
    const eOff = { x: e.x + nx * OFFSET_PX, y: e.y + ny * OFFSET_PX };
    labelAt = { x: (sOff.x + eOff.x) / 2, y: (sOff.y + eOff.y) / 2 };
    els = (
      <>
        <line x1={s.x} y1={s.y} x2={sOff.x} y2={sOff.y} stroke="#888" strokeWidth={1} />
        <line x1={e.x} y1={e.y} x2={eOff.x} y2={eOff.y} stroke="#888" strokeWidth={1} />
        <line x1={sOff.x} y1={sOff.y} x2={eOff.x} y2={eOff.y} stroke={lineColor} strokeWidth={1} />
        <Arrow at={sOff} toward={eOff} color={lineColor} />
        <Arrow at={eOff} toward={sOff} color={lineColor} />
      </>
    );
  } else if (d.kind === 'dim-distance') {
    const resolvePoint = (ref: typeof d.a): { x: number; y: number } | null => {
      const p = byId.get(ref.primitiveId);
      if (!p) return null;
      if (p.kind === 'line') return ref.anchor === 'start' ? { x: p.x1, y: p.y1 } : { x: p.x2, y: p.y2 };
      if (p.kind === 'circle' || p.kind === 'arc') return { x: p.cx, y: p.cy };
      return null;
    };
    const a = resolvePoint(d.a); const b = resolvePoint(d.b);
    if (!a || !b) return null;
    const s = worldToScreen(a.x, a.y), e = worldToScreen(b.x, b.y);
    const dx = e.x - s.x, dy = e.y - s.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const sOff = { x: s.x + nx * OFFSET_PX, y: s.y + ny * OFFSET_PX };
    const eOff = { x: e.x + nx * OFFSET_PX, y: e.y + ny * OFFSET_PX };
    labelAt = { x: (sOff.x + eOff.x) / 2, y: (sOff.y + eOff.y) / 2 };
    els = (
      <>
        <line x1={s.x} y1={s.y} x2={sOff.x} y2={sOff.y} stroke="#888" strokeWidth={1} />
        <line x1={e.x} y1={e.y} x2={eOff.x} y2={eOff.y} stroke="#888" strokeWidth={1} />
        <line x1={sOff.x} y1={sOff.y} x2={eOff.x} y2={eOff.y} stroke={lineColor} strokeWidth={1} />
        <Arrow at={sOff} toward={eOff} color={lineColor} />
        <Arrow at={eOff} toward={sOff} color={lineColor} />
      </>
    );
  } else if (d.kind === 'dim-angle') {
    const l1 = byId.get(d.line1), l2 = byId.get(d.line2);
    if (!l1 || l1.kind !== 'line' || !l2 || l2.kind !== 'line') return null;
    const p1 = worldToScreen(l1.x1, l1.y1);
    labelAt = { x: p1.x + ARC_RADIUS_PX, y: p1.y };
    els = null;
  } else if (d.kind === 'dim-radius' || d.kind === 'dim-diameter') {
    const p = byId.get(d.circle);
    if (!p || (p.kind !== 'circle' && p.kind !== 'arc')) return null;
    const c = worldToScreen(p.cx, p.cy);
    const rim = worldToScreen(p.cx + p.r, p.cy);
    labelAt = { x: (c.x + rim.x) / 2, y: c.y };
    els = (
      <>
        <line x1={c.x} y1={c.y} x2={rim.x} y2={rim.y} stroke={lineColor} strokeWidth={1} />
        <Arrow at={rim} toward={c} color={lineColor} />
      </>
    );
  } else if (d.kind === 'dim-point-line-distance') {
    const pointPrim = byId.get(d.point.primitiveId);
    const linePrim = byId.get(d.line);
    if (!pointPrim || !linePrim || linePrim.kind !== 'line') return null;
    const p = pointPrim.kind === 'line'
      ? (d.point.anchor === 'start' ? { x: pointPrim.x1, y: pointPrim.y1 } : { x: pointPrim.x2, y: pointPrim.y2 })
      : { x: (pointPrim as { cx: number }).cx, y: (pointPrim as { cy: number }).cy };
    const s = worldToScreen(p.x, p.y);
    labelAt = { x: s.x, y: s.y - OFFSET_PX };
  }

  return (
    <g
      data-testid="dimension-glyph"
      style={{ pointerEvents: 'auto' }}
      onDoubleClick={(e) => { e.stopPropagation(); onEditDimension?.(d.id); }}
    >
      {els}
      {isEditing ? (
        <foreignObject x={labelAt.x - 28} y={labelAt.y - 10} width={56} height={22}>
          <InlineDimEditor
            dimId={d.id}
            initialValue={editingInitialValue}
            onCommit={(raw) => onEditCommit?.(d.id, raw)}
            onCancel={() => onEditCancel?.()}
          />
        </foreignObject>
      ) : (
        <>
          <rect x={labelAt.x - 24} y={labelAt.y - 8} width={48} height={16} fill="#1a1a1a" opacity={0.9} />
          <text x={labelAt.x} y={labelAt.y + 4} fill={labelColor} fontSize={11} fontFamily="ui-monospace, monospace" textAnchor="middle">
            {text}
          </text>
        </>
      )}
    </g>
  );
}

function InlineDimEditor({
  dimId, initialValue, onCommit, onCancel
}: {
  dimId: string;
  initialValue: string;
  onCommit(raw: string): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(initialValue);
  const committedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (!committedRef.current) {
          committedRef.current = true;
          onCommit(value);
        }
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); committedRef.current = true; onCommit(value); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
      style={{
        width: '100%', height: '100%', fontSize: 11,
        fontFamily: 'ui-monospace, monospace',
        background: '#222', color: '#e8c36a',
        border: '1px solid #555', padding: '0 2px',
        boxSizing: 'border-box'
      }}
      data-testid={`dim-inline-input-${dimId}`}
    />
  );
}

function Arrow({ at, toward, color = '#e8c36a' }: { at: { x: number; y: number }; toward: { x: number; y: number }; color?: string }) {
  const dx = toward.x - at.x, dy = toward.y - at.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const tip = at;
  const back = { x: tip.x - ux * 8, y: tip.y - uy * 8 };
  const left = { x: back.x - uy * 4, y: back.y + ux * 4 };
  const right = { x: back.x + uy * 4, y: back.y - ux * 4 };
  return <polygon points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`} fill={color} />;
}
