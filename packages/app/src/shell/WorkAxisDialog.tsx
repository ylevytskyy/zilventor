import React from 'react';
import type { WorkAxisFeature, WorkPlaneRef, WorkPointRef } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type WorkAxisCommit = {
  source: WorkAxisFeature['source'];
  parameterExpressions: Record<string, { expression: string; unit: 'mm' | 'deg' }>;
};

export type WorkAxisDialogProps = {
  initialValues?: WorkAxisFeature | null;
  onCommit: (c: WorkAxisCommit) => void;
  onCancel: () => void;
};

type Mode = WorkAxisFeature['source']['mode'];

const ALL_MODES: ReadonlyArray<{ value: Mode; label: string }> = [
  { value: 'origin', label: 'Origin Axis' },
  { value: 'twoPoints', label: 'Two Points' },
  { value: 'twoPlanes', label: 'Two Planes (intersection)' },
  { value: 'normalToPlaneThroughPoint', label: 'Normal to Plane Through Point' },
  { value: 'cylindricalFace', label: 'Cylindrical Face' },
  { value: 'edge', label: 'Edge' },
];

const panel: React.CSSProperties = {
  position: 'fixed', top: 80, right: 20, background: '#1a1a1a',
  border: '1px solid #444', borderRadius: 6, padding: 12, width: 380,
  color: '#eee', zIndex: 50, fontSize: 12,
};
const row: React.CSSProperties = { display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' };
const label: React.CSSProperties = { width: 100, color: '#aaa' };
const input: React.CSSProperties = { flex: 1, background: '#0c0c0c', color: '#eee', border: '1px solid #444', padding: '2px 6px' };
const btn: React.CSSProperties = { background: '#2a2a2a', color: '#eee', border: '1px solid #444', padding: '4px 10px', cursor: 'pointer' };
const ok: React.CSSProperties = { ...btn, background: '#3b5a8a', borderColor: '#6a8ec4' };
const pickBtn: React.CSSProperties = { ...btn, padding: '2px 8px', fontSize: 11 };

const planeRef = (text: string): WorkPlaneRef => ({ source: 'workPlane', featureId: text.trim() || 'origin.XY' });
const pointRef = (text: string): WorkPointRef => ({ source: 'workPoint', featureId: text.trim() || 'origin.O' });

export function WorkAxisDialog({ initialValues, onCommit, onCancel }: WorkAxisDialogProps): React.ReactElement {
  const [mode, setMode] = React.useState<Mode>(initialValues?.source.mode ?? 'origin');
  const [originAxis, setOriginAxis] = React.useState<'X' | 'Y' | 'Z'>(
    initialValues?.source.mode === 'origin' ? initialValues.source.axis : 'X'
  );
  const [pointA, setPointA] = React.useState('origin.O');
  const [pointB, setPointB] = React.useState('origin.O');
  const [planeA, setPlaneA] = React.useState('origin.XY');
  const [planeB, setPlaneB] = React.useState('origin.YZ');
  const [face, setFace] = React.useState('');
  const [edgeText, setEdgeText] = React.useState('');

  const pickResult = useAppStore((s) => s.workFeaturePickResult);

  React.useEffect(() => {
    if (!initialValues) return;
    const s = initialValues.source;
    setMode(s.mode);
    if (s.mode === 'origin') setOriginAxis(s.axis);
  }, [initialValues]);

  React.useEffect(() => {
    if (!pickResult) return;
    const setters: Record<string, ((v: string) => void) | undefined> = {
      pointA: setPointA,
      pointB: setPointB,
      planeA: setPlaneA,
      planeB: setPlaneB,
    };
    const setter = setters[pickResult.role];
    if (!setter) return;
    let featureId: string | null = null;
    if (pickResult.hit.kind === 'workPlane' || pickResult.hit.kind === 'workAxis' || pickResult.hit.kind === 'workPoint') {
      featureId = pickResult.hit.featureId;
    }
    if (featureId) {
      setter(featureId);
      useAppStore.getState().clearWorkFeaturePick();
    }
  }, [pickResult]);

  const requestPick = (kind: 'plane' | 'axis' | 'point', role: string, pickMode: string) => {
    useAppStore.getState().requestWorkFeaturePick({ kind, role, mode: pickMode });
  };

  function handleOk(): void {
    const params: Record<string, { expression: string; unit: 'mm' | 'deg' }> = {};
    let source: WorkAxisFeature['source'];
    switch (mode) {
      case 'origin':
        source = { mode: 'origin', axis: originAxis };
        break;
      case 'twoPoints':
        source = { mode: 'twoPoints', pointA: pointRef(pointA), pointB: pointRef(pointB) };
        break;
      case 'twoPlanes':
        source = { mode: 'twoPlanes', planeA: planeRef(planeA), planeB: planeRef(planeB) };
        break;
      case 'normalToPlaneThroughPoint':
        source = { mode: 'normalToPlaneThroughPoint', plane: planeRef(planeA), point: pointRef(pointA) };
        break;
      case 'cylindricalFace':
        source = { mode: 'cylindricalFace', face: { featureId: face, role: 'side' } };
        break;
      case 'edge':
        // Stub edge name — interactive edge picker fills both faces in T14.
        source = { mode: 'edge', edge: { faceA: { featureId: edgeText, role: 'top' }, faceB: { featureId: edgeText, role: 'side' } } };
        break;
    }
    onCommit({ source, parameterExpressions: params });
  }

  return (
    <div style={panel} role="dialog" aria-label="Work Axis">
      <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>Work Axis</h3>
      <div style={row}>
        <label htmlFor="wa-mode" style={label}>Mode</label>
        <select id="wa-mode" aria-label="mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)} style={input}>
          {ALL_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      {mode === 'origin' && (
        <div style={row}>
          <label htmlFor="wa-origin" style={label}>Axis</label>
          <select id="wa-origin" aria-label="origin axis" value={originAxis} onChange={(e) => setOriginAxis(e.target.value as 'X' | 'Y' | 'Z')} style={input}>
            <option value="X">X</option>
            <option value="Y">Y</option>
            <option value="Z">Z</option>
          </select>
        </div>
      )}

      {(mode === 'twoPoints' || mode === 'normalToPlaneThroughPoint') && (
        <div style={row}>
          <label style={label}>Point A</label>
          <input aria-label="point A" value={pointA} onChange={(e) => setPointA(e.target.value)} style={input} />
          <button type="button" aria-label="Pick point A" style={pickBtn} onClick={() => requestPick('point', 'pointA', 'workPoint')}>Pick…</button>
        </div>
      )}
      {mode === 'twoPoints' && (
        <div style={row}>
          <label style={label}>Point B</label>
          <input aria-label="point B" value={pointB} onChange={(e) => setPointB(e.target.value)} style={input} />
          <button type="button" aria-label="Pick point B" style={pickBtn} onClick={() => requestPick('point', 'pointB', 'workPoint')}>Pick…</button>
        </div>
      )}

      {(mode === 'twoPlanes' || mode === 'normalToPlaneThroughPoint') && (
        <div style={row}>
          <label style={label}>Plane</label>
          <input aria-label="plane ref" value={planeA} onChange={(e) => setPlaneA(e.target.value)} style={input} />
          <button type="button" aria-label="Pick plane ref" style={pickBtn} onClick={() => requestPick('plane', 'planeA', 'workPlane')}>Pick…</button>
        </div>
      )}
      {mode === 'twoPlanes' && (
        <div style={row}>
          <label style={label}>Plane B</label>
          <input aria-label="plane B" value={planeB} onChange={(e) => setPlaneB(e.target.value)} style={input} />
          <button type="button" aria-label="Pick plane B" style={pickBtn} onClick={() => requestPick('plane', 'planeB', 'workPlane')}>Pick…</button>
        </div>
      )}

      {mode === 'cylindricalFace' && (
        <div style={row}><label style={label}>Face featureId</label><input aria-label="face featureId" value={face} onChange={(e) => setFace(e.target.value)} style={input} /></div>
      )}
      {mode === 'edge' && (
        <div style={row}><label style={label}>Edge featureId</label><input aria-label="edge featureId" value={edgeText} onChange={(e) => setEdgeText(e.target.value)} style={input} /></div>
      )}

      <div style={{ ...row, justifyContent: 'flex-end', marginTop: 12 }}>
        <button style={btn} onClick={onCancel}>Cancel</button>
        <button style={ok} onClick={handleOk}>OK</button>
      </div>
    </div>
  );
}
