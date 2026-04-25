import React from 'react';
import type { WorkPointFeature, WorkAxisRef, WorkPlaneRef } from '@zilventor/shared';

export type WorkPointCommit = {
  source: WorkPointFeature['source'];
  parameterExpressions: Record<string, { expression: string; unit: 'mm' | 'deg' }>;
};

export type WorkPointDialogProps = {
  initialValues?: WorkPointFeature | null;
  onCommit: (c: WorkPointCommit) => void;
  onCancel: () => void;
};

type Mode = WorkPointFeature['source']['mode'];

const ALL_MODES: ReadonlyArray<{ value: Mode; label: string }> = [
  { value: 'origin', label: 'Origin (0, 0, 0)' },
  { value: 'vertex', label: 'Vertex' },
  { value: 'midpointOfEdge', label: 'Midpoint of Edge' },
  { value: 'centerOfArc', label: 'Center of Arc' },
  { value: 'axisIntersectsPlane', label: 'Axis ∩ Plane' },
  { value: 'threePlanes', label: 'Three Planes (intersection)' },
];

const panel: React.CSSProperties = {
  position: 'fixed', top: 80, right: 20, background: '#1a1a1a',
  border: '1px solid #444', borderRadius: 6, padding: 12, width: 360,
  color: '#eee', zIndex: 50, fontSize: 12,
};
const row: React.CSSProperties = { display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' };
const label: React.CSSProperties = { width: 100, color: '#aaa' };
const input: React.CSSProperties = { flex: 1, background: '#0c0c0c', color: '#eee', border: '1px solid #444', padding: '2px 6px' };
const btn: React.CSSProperties = { background: '#2a2a2a', color: '#eee', border: '1px solid #444', padding: '4px 10px', cursor: 'pointer' };
const ok: React.CSSProperties = { ...btn, background: '#3b5a8a', borderColor: '#6a8ec4' };

const planeRef = (text: string): WorkPlaneRef => ({ source: 'workPlane', featureId: text.trim() || 'origin.XY' });
const axisRef = (text: string): WorkAxisRef => ({ source: 'workAxis', featureId: text.trim() || 'origin.X' });

export function WorkPointDialog({ initialValues, onCommit, onCancel }: WorkPointDialogProps): React.ReactElement {
  const [mode, setMode] = React.useState<Mode>(initialValues?.source.mode ?? 'origin');
  const [edgeText, setEdgeText] = React.useState('');
  const [face, setFace] = React.useState('');
  const [end, setEnd] = React.useState<'start' | 'end'>('start');
  const [axis, setAxis] = React.useState('origin.X');
  const [planeA, setPlaneA] = React.useState('origin.XY');
  const [planeB, setPlaneB] = React.useState('origin.YZ');
  const [planeC, setPlaneC] = React.useState('origin.XZ');

  React.useEffect(() => {
    if (!initialValues) return;
    setMode(initialValues.source.mode);
  }, [initialValues]);

  function handleOk(): void {
    const params: Record<string, { expression: string; unit: 'mm' | 'deg' }> = {};
    let source: WorkPointFeature['source'];
    switch (mode) {
      case 'origin':
        source = { mode: 'origin' };
        break;
      case 'vertex':
        source = { mode: 'vertex', edge: { faceA: { featureId: edgeText, role: 'top' }, faceB: { featureId: edgeText, role: 'side' } }, end };
        break;
      case 'midpointOfEdge':
        source = { mode: 'midpointOfEdge', edge: { faceA: { featureId: edgeText, role: 'top' }, faceB: { featureId: edgeText, role: 'side' } } };
        break;
      case 'centerOfArc':
        source = { mode: 'centerOfArc', face: { featureId: face, role: 'side' } };
        break;
      case 'axisIntersectsPlane':
        source = { mode: 'axisIntersectsPlane', axis: axisRef(axis), plane: planeRef(planeA) };
        break;
      case 'threePlanes':
        source = { mode: 'threePlanes', planes: [planeRef(planeA), planeRef(planeB), planeRef(planeC)] };
        break;
    }
    onCommit({ source, parameterExpressions: params });
  }

  return (
    <div style={panel} role="dialog" aria-label="Work Point">
      <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>Work Point</h3>
      <div style={row}>
        <label htmlFor="wpt-mode" style={label}>Mode</label>
        <select id="wpt-mode" aria-label="mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)} style={input}>
          {ALL_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      {(mode === 'vertex' || mode === 'midpointOfEdge') && (
        <div style={row}><label style={label}>Edge featureId</label><input aria-label="edge featureId" value={edgeText} onChange={(e) => setEdgeText(e.target.value)} style={input} /></div>
      )}
      {mode === 'vertex' && (
        <div style={row}>
          <label style={label}>End</label>
          <select aria-label="end" value={end} onChange={(e) => setEnd(e.target.value as 'start' | 'end')} style={input}>
            <option value="start">start</option>
            <option value="end">end</option>
          </select>
        </div>
      )}

      {mode === 'centerOfArc' && (
        <div style={row}><label style={label}>Face featureId</label><input aria-label="face featureId" value={face} onChange={(e) => setFace(e.target.value)} style={input} /></div>
      )}

      {mode === 'axisIntersectsPlane' && (
        <>
          <div style={row}><label style={label}>Axis</label><input aria-label="axis ref" value={axis} onChange={(e) => setAxis(e.target.value)} style={input} /></div>
          <div style={row}><label style={label}>Plane</label><input aria-label="plane ref" value={planeA} onChange={(e) => setPlaneA(e.target.value)} style={input} /></div>
        </>
      )}

      {mode === 'threePlanes' && (
        <>
          <div style={row}><label style={label}>Plane A</label><input aria-label="plane A" value={planeA} onChange={(e) => setPlaneA(e.target.value)} style={input} /></div>
          <div style={row}><label style={label}>Plane B</label><input aria-label="plane B" value={planeB} onChange={(e) => setPlaneB(e.target.value)} style={input} /></div>
          <div style={row}><label style={label}>Plane C</label><input aria-label="plane C" value={planeC} onChange={(e) => setPlaneC(e.target.value)} style={input} /></div>
        </>
      )}

      <div style={{ ...row, justifyContent: 'flex-end', marginTop: 12 }}>
        <button style={btn} onClick={onCancel}>Cancel</button>
        <button style={ok} onClick={handleOk}>OK</button>
      </div>
    </div>
  );
}
