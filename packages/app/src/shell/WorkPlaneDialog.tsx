import React from 'react';
import type { WorkPlaneFeature, WorkPlaneRef, WorkAxisRef, WorkPointRef, ParamOrLiteral } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type WorkPlaneCommit = {
  source: WorkPlaneFeature['source'];
  parameterExpressions: Record<string, { expression: string; unit: 'mm' | 'deg' }>;
};

export type WorkPlaneDialogProps = {
  initialValues?: WorkPlaneFeature | null;
  onCommit: (c: WorkPlaneCommit) => void;
  onCancel: () => void;
};

type Mode = WorkPlaneFeature['source']['mode'];

const ALL_MODES: ReadonlyArray<{ value: Mode; label: string }> = [
  { value: 'origin', label: 'Origin Plane' },
  { value: 'offsetFromPlane', label: 'Offset from Plane' },
  { value: 'threePoints', label: 'Three Points' },
  { value: 'midplane', label: 'Midplane between Two' },
  { value: 'axisPerpendicularToPlane', label: 'Axis Perpendicular to Plane' },
  { value: 'axisAtAngleToPlane', label: 'Axis at Angle to Plane' },
  { value: 'tangentToSurfaceParallelToPlane', label: 'Tangent to Surface Parallel to Plane' },
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

function planeRefFromText(text: string): WorkPlaneRef {
  return { source: 'workPlane', featureId: text.trim() || 'origin.XY' };
}
function axisRefFromText(text: string): WorkAxisRef {
  return { source: 'workAxis', featureId: text.trim() || 'origin.X' };
}
function pointRefFromText(text: string): WorkPointRef {
  return { source: 'workPoint', featureId: text.trim() || 'origin.O' };
}

function refToText(ref: WorkPlaneRef | WorkAxisRef | WorkPointRef | undefined, fallback: string): string {
  if (!ref) return fallback;
  if ('featureId' in ref) return ref.featureId;
  return fallback;
}

function paramOrLiteral(text: string, unit: 'mm' | 'deg'): { value: ParamOrLiteral; param?: { name: string; expression: string; unit: 'mm' | 'deg' } } {
  const trimmed = text.trim();
  if (trimmed.startsWith('=')) {
    const name = trimmed.slice(1).trim();
    return { value: { kind: 'param', paramName: name }, param: { name, expression: name, unit } };
  }
  const v = Number(trimmed);
  return { value: { kind: 'literal', value: Number.isFinite(v) ? v : 0 } };
}

export function WorkPlaneDialog({ initialValues, onCommit, onCancel }: WorkPlaneDialogProps): React.ReactElement {
  const [mode, setMode] = React.useState<Mode>(initialValues?.source.mode ?? 'origin');
  const [originPlane, setOriginPlane] = React.useState<'XY' | 'YZ' | 'XZ'>(
    initialValues?.source.mode === 'origin' ? initialValues.source.plane : 'XY'
  );
  const [planeA, setPlaneA] = React.useState('origin.XY');
  const [planeB, setPlaneB] = React.useState('origin.YZ');
  const [pointA, setPointA] = React.useState('origin.O');
  const [pointB, setPointB] = React.useState('origin.O');
  const [pointC, setPointC] = React.useState('origin.O');
  const [axis, setAxis] = React.useState('origin.X');
  const [face, setFace] = React.useState('');
  const [offset, setOffset] = React.useState('10');
  const [angle, setAngle] = React.useState('45');

  const pickResult = useAppStore((s) => s.workFeaturePickResult);

  React.useEffect(() => {
    if (!initialValues) return;
    const s = initialValues.source;
    setMode(s.mode);
    if (s.mode === 'origin') setOriginPlane(s.plane);
    if (s.mode === 'offsetFromPlane') {
      setPlaneA(refToText(s.plane, 'origin.XY'));
      setOffset(s.offset.kind === 'literal' ? String(s.offset.value) : `=${s.offset.paramName}`);
    }
    if (s.mode === 'midplane') {
      setPlaneA(refToText(s.planeA, 'origin.XY'));
      setPlaneB(refToText(s.planeB, 'origin.YZ'));
    }
  }, [initialValues]);

  // Apply work-feature pick results to the matching local input. Only consume
  // results whose role matches one of this dialog's roles; leave others alone.
  React.useEffect(() => {
    if (!pickResult) return;
    const setters: Record<string, ((v: string) => void) | undefined> = {
      planeA: setPlaneA,
      planeB: setPlaneB,
      pointA: setPointA,
      pointB: setPointB,
      pointC: setPointC,
      axis: setAxis,
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
    let source: WorkPlaneFeature['source'];
    switch (mode) {
      case 'origin':
        source = { mode: 'origin', plane: originPlane };
        break;
      case 'offsetFromPlane': {
        const off = paramOrLiteral(offset, 'mm');
        if (off.param) params[off.param.name] = { expression: off.param.expression, unit: off.param.unit };
        source = { mode: 'offsetFromPlane', plane: planeRefFromText(planeA), offset: off.value };
        break;
      }
      case 'threePoints':
        source = { mode: 'threePoints', points: [pointRefFromText(pointA), pointRefFromText(pointB), pointRefFromText(pointC)] };
        break;
      case 'midplane':
        source = { mode: 'midplane', planeA: planeRefFromText(planeA), planeB: planeRefFromText(planeB) };
        break;
      case 'axisPerpendicularToPlane':
        source = { mode: 'axisPerpendicularToPlane', axis: axisRefFromText(axis), plane: planeRefFromText(planeA) };
        break;
      case 'axisAtAngleToPlane': {
        const ang = paramOrLiteral(angle, 'deg');
        if (ang.param) params[ang.param.name] = { expression: ang.param.expression, unit: ang.param.unit };
        source = { mode: 'axisAtAngleToPlane', axis: axisRefFromText(axis), plane: planeRefFromText(planeA), angle: ang.value };
        break;
      }
      case 'tangentToSurfaceParallelToPlane':
        source = { mode: 'tangentToSurfaceParallelToPlane', face: { featureId: face, role: 'side' }, plane: planeRefFromText(planeA) };
        break;
    }
    onCommit({ source, parameterExpressions: params });
  }

  return (
    <div style={panel} role="dialog" aria-label="Work Plane">
      <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>Work Plane</h3>
      <div style={row}>
        <label htmlFor="wp-mode" style={label}>Mode</label>
        <select
          id="wp-mode"
          aria-label="mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
          style={input}
        >
          {ALL_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      {mode === 'origin' && (
        <div style={row}>
          <label htmlFor="wp-origin" style={label}>Plane</label>
          <select id="wp-origin" aria-label="origin plane" value={originPlane} onChange={(e) => setOriginPlane(e.target.value as 'XY' | 'YZ' | 'XZ')} style={input}>
            <option value="XY">XY</option>
            <option value="YZ">YZ</option>
            <option value="XZ">XZ</option>
          </select>
        </div>
      )}

      {(mode === 'offsetFromPlane' || mode === 'tangentToSurfaceParallelToPlane' || mode === 'axisPerpendicularToPlane' || mode === 'axisAtAngleToPlane') && (
        <div style={row}>
          <label style={label}>Plane ref</label>
          <input aria-label="plane ref" value={planeA} onChange={(e) => setPlaneA(e.target.value)} style={input} />
          <button type="button" aria-label="Pick plane ref" style={pickBtn} onClick={() => requestPick('plane', 'planeA', 'workPlane')}>Pick…</button>
        </div>
      )}

      {mode === 'midplane' && (
        <>
          <div style={row}>
            <label style={label}>Plane A</label>
            <input aria-label="plane A" value={planeA} onChange={(e) => setPlaneA(e.target.value)} style={input} />
            <button type="button" aria-label="Pick plane A" style={pickBtn} onClick={() => requestPick('plane', 'planeA', 'workPlane')}>Pick…</button>
          </div>
          <div style={row}>
            <label style={label}>Plane B</label>
            <input aria-label="plane B" value={planeB} onChange={(e) => setPlaneB(e.target.value)} style={input} />
            <button type="button" aria-label="Pick plane B" style={pickBtn} onClick={() => requestPick('plane', 'planeB', 'workPlane')}>Pick…</button>
          </div>
        </>
      )}

      {(mode === 'axisPerpendicularToPlane' || mode === 'axisAtAngleToPlane') && (
        <div style={row}>
          <label style={label}>Axis ref</label>
          <input aria-label="axis ref" value={axis} onChange={(e) => setAxis(e.target.value)} style={input} />
          <button type="button" aria-label="Pick axis ref" style={pickBtn} onClick={() => requestPick('axis', 'axis', 'workAxis')}>Pick…</button>
        </div>
      )}

      {mode === 'tangentToSurfaceParallelToPlane' && (
        <div style={row}><label style={label}>Face featureId</label><input aria-label="face featureId" value={face} onChange={(e) => setFace(e.target.value)} style={input} /></div>
      )}

      {mode === 'threePoints' && (
        <>
          <div style={row}>
            <label style={label}>Point A</label>
            <input aria-label="point A" value={pointA} onChange={(e) => setPointA(e.target.value)} style={input} />
            <button type="button" aria-label="Pick point A" style={pickBtn} onClick={() => requestPick('point', 'pointA', 'workPoint')}>Pick…</button>
          </div>
          <div style={row}>
            <label style={label}>Point B</label>
            <input aria-label="point B" value={pointB} onChange={(e) => setPointB(e.target.value)} style={input} />
            <button type="button" aria-label="Pick point B" style={pickBtn} onClick={() => requestPick('point', 'pointB', 'workPoint')}>Pick…</button>
          </div>
          <div style={row}>
            <label style={label}>Point C</label>
            <input aria-label="point C" value={pointC} onChange={(e) => setPointC(e.target.value)} style={input} />
            <button type="button" aria-label="Pick point C" style={pickBtn} onClick={() => requestPick('point', 'pointC', 'workPoint')}>Pick…</button>
          </div>
        </>
      )}

      {mode === 'offsetFromPlane' && (
        <div style={row}><label style={label}>Offset (mm)</label><input aria-label="offset" value={offset} onChange={(e) => setOffset(e.target.value)} style={input} /></div>
      )}
      {mode === 'axisAtAngleToPlane' && (
        <div style={row}><label style={label}>Angle (deg)</label><input aria-label="angle" value={angle} onChange={(e) => setAngle(e.target.value)} style={input} /></div>
      )}

      <div style={{ ...row, justifyContent: 'flex-end', marginTop: 12 }}>
        <button style={btn} onClick={onCancel}>Cancel</button>
        <button style={ok} onClick={handleOk}>OK</button>
      </div>
    </div>
  );
}
