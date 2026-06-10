import React from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const ALL_MODES: ReadonlyArray<{ value: Mode; label: string }> = [
    { value: 'origin', label: t('dialog.workPlane.modeOrigin') },
    { value: 'offsetFromPlane', label: t('dialog.workPlane.modeOffset') },
    { value: 'threePoints', label: t('dialog.workPlane.modeThreePoints') },
    { value: 'midplane', label: t('dialog.workPlane.modeMidplane') },
    { value: 'axisPerpendicularToPlane', label: t('dialog.workPlane.modeAxisPerp') },
    { value: 'axisAtAngleToPlane', label: t('dialog.workPlane.modeAxisAngle') },
    { value: 'tangentToSurfaceParallelToPlane', label: t('dialog.workPlane.modeTangent') },
  ];
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
    <div style={panel} role="dialog" aria-label={t('dialog.workPlane.ariaLabel')}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>{t('dialog.workPlane.title')}</h3>
      <div style={row}>
        <label htmlFor="wp-mode" style={label}>{t('common.mode')}</label>
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
          <label htmlFor="wp-origin" style={label}>{t('dialog.workPlane.plane')}</label>
          <select id="wp-origin" aria-label={t('dialog.workPlane.originPlaneAria')} value={originPlane} onChange={(e) => setOriginPlane(e.target.value as 'XY' | 'YZ' | 'XZ')} style={input}>
            <option value="XY">XY</option>
            <option value="YZ">YZ</option>
            <option value="XZ">XZ</option>
          </select>
        </div>
      )}

      {(mode === 'offsetFromPlane' || mode === 'tangentToSurfaceParallelToPlane' || mode === 'axisPerpendicularToPlane' || mode === 'axisAtAngleToPlane') && (
        <div style={row}>
          <label style={label}>{t('common.planeRef')}</label>
          <input aria-label={t('common.planeRefAria')} value={planeA} onChange={(e) => setPlaneA(e.target.value)} style={input} />
          <button type="button" aria-label={t('common.pickPlaneRef')} style={pickBtn} onClick={() => requestPick('plane', 'planeA', 'workPlane')}>{t('common.pick_ellipsis')}</button>
        </div>
      )}

      {mode === 'midplane' && (
        <>
          <div style={row}>
            <label style={label}>{t('common.planeA')}</label>
            <input aria-label={t('common.planeAAria')} value={planeA} onChange={(e) => setPlaneA(e.target.value)} style={input} />
            <button type="button" aria-label={t('common.pickPlaneA')} style={pickBtn} onClick={() => requestPick('plane', 'planeA', 'workPlane')}>{t('common.pick_ellipsis')}</button>
          </div>
          <div style={row}>
            <label style={label}>{t('common.planeB')}</label>
            <input aria-label={t('common.planeBRefAria')} value={planeB} onChange={(e) => setPlaneB(e.target.value)} style={input} />
            <button type="button" aria-label={t('common.pickPlaneB')} style={pickBtn} onClick={() => requestPick('plane', 'planeB', 'workPlane')}>{t('common.pick_ellipsis')}</button>
          </div>
        </>
      )}

      {(mode === 'axisPerpendicularToPlane' || mode === 'axisAtAngleToPlane') && (
        <div style={row}>
          <label style={label}>{t('common.axisRef')}</label>
          <input aria-label={t('common.axisRefAria')} value={axis} onChange={(e) => setAxis(e.target.value)} style={input} />
          <button type="button" aria-label={t('common.pickAxisRef')} style={pickBtn} onClick={() => requestPick('axis', 'axis', 'workAxis')}>{t('common.pick_ellipsis')}</button>
        </div>
      )}

      {mode === 'tangentToSurfaceParallelToPlane' && (
        <div style={row}><label style={label}>{t('common.faceFeatureId')}</label><input aria-label={t('common.faceFeatureIdAria')} value={face} onChange={(e) => setFace(e.target.value)} style={input} /></div>
      )}

      {mode === 'threePoints' && (
        <>
          <div style={row}>
            <label style={label}>{t('common.pointA')}</label>
            <input aria-label={t('common.pointAAria')} value={pointA} onChange={(e) => setPointA(e.target.value)} style={input} />
            <button type="button" aria-label={t('common.pickPointA')} style={pickBtn} onClick={() => requestPick('point', 'pointA', 'workPoint')}>{t('common.pick_ellipsis')}</button>
          </div>
          <div style={row}>
            <label style={label}>{t('common.pointB')}</label>
            <input aria-label={t('common.pointBAria')} value={pointB} onChange={(e) => setPointB(e.target.value)} style={input} />
            <button type="button" aria-label={t('common.pickPointB')} style={pickBtn} onClick={() => requestPick('point', 'pointB', 'workPoint')}>{t('common.pick_ellipsis')}</button>
          </div>
          <div style={row}>
            <label style={label}>{t('common.pointC')}</label>
            <input aria-label={t('common.pointCAria')} value={pointC} onChange={(e) => setPointC(e.target.value)} style={input} />
            <button type="button" aria-label={t('common.pickPointC')} style={pickBtn} onClick={() => requestPick('point', 'pointC', 'workPoint')}>{t('common.pick_ellipsis')}</button>
          </div>
        </>
      )}

      {mode === 'offsetFromPlane' && (
        <div style={row}><label style={label}>{t('dialog.workPlane.offset')}</label><input aria-label={t('dialog.workPlane.offsetAria')} value={offset} onChange={(e) => setOffset(e.target.value)} style={input} /></div>
      )}
      {mode === 'axisAtAngleToPlane' && (
        <div style={row}><label style={label}>{t('dialog.workPlane.angle')}</label><input aria-label={t('dialog.workPlane.angleAria')} value={angle} onChange={(e) => setAngle(e.target.value)} style={input} /></div>
      )}

      <div style={{ ...row, justifyContent: 'flex-end', marginTop: 12 }}>
        <button style={btn} onClick={onCancel}>{t('common.cancel')}</button>
        <button style={ok} onClick={handleOk}>{t('common.ok')}</button>
      </div>
    </div>
  );
}
