import { type FormEvent } from 'react';
import type { BooleanOperation, SweepOrientation } from '@zilventor/shared';

type Props = {
  profileSketchId: string | null;
  pathSketchId: string | null;
  orientationKind: 'path' | 'parallel' | 'guideRail';
  guideRailSketchId: string | null;
  operation: BooleanOperation;
  hasRunningBody?: boolean;
  previewError?: string | null;
  onCommit(value: { orientation: SweepOrientation; operation: BooleanOperation }): void;
  onCancel(): void;
  onPickProfile(): void;
  onPickPath(): void;
  onPickGuideRail(): void;
  onSetOrientation(kind: 'path' | 'parallel' | 'guideRail'): void;
  onSetOperation(op: BooleanOperation): void;
};

const panel: React.CSSProperties = {
  position: 'fixed', top: 80, right: 20, width: 360,
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6,
  padding: 12, color: '#eee', fontSize: 12, zIndex: 50,
};
const head: React.CSSProperties = { fontSize: 12, fontWeight: 600, marginBottom: 4 };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 };
const btn: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 8px', cursor: 'pointer', fontSize: 11,
};

export function SweepDialog(props: Props): JSX.Element {
  const canCommit =
    props.profileSketchId !== null
    && props.pathSketchId !== null
    && (props.orientationKind !== 'guideRail' || props.guideRailSketchId !== null);

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canCommit) return;
    const orientation: SweepOrientation =
      props.orientationKind === 'path' ? { kind: 'path' } :
      props.orientationKind === 'parallel' ? { kind: 'parallel' } :
      { kind: 'guideRail', guideRailSketchId: props.guideRailSketchId! };
    props.onCommit({ orientation, operation: props.operation });
  };

  return (
    <form role="dialog" aria-label="Sweep" onSubmit={handleSubmit} style={panel}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Sweep</div>

      <section style={{ marginBottom: 8 }}>
        <h2 style={head}>Profile</h2>
        <div style={row}>
          <button type="button" onClick={props.onPickProfile} style={btn}>
            {props.profileSketchId ? `Profile: ${props.profileSketchId}` : 'Pick profile'}
          </button>
        </div>
      </section>

      <section style={{ marginBottom: 8 }}>
        <h2 style={head}>Path</h2>
        <div style={row}>
          <button type="button" onClick={props.onPickPath} style={btn}>
            {props.pathSketchId ? `Path: ${props.pathSketchId}` : 'Pick path'}
          </button>
        </div>
      </section>

      <section style={{ marginBottom: 8 }}>
        <h2 style={head}>Orientation</h2>
        <div style={{ display: 'flex', gap: 12, marginBottom: 4 }}>
          {(['path', 'parallel', 'guideRail'] as const).map((k) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
              <input
                type="radio"
                name="sweepOrientation"
                checked={props.orientationKind === k}
                onChange={() => props.onSetOrientation(k)}
              />
              {k === 'path' ? 'Path' : k === 'parallel' ? 'Parallel' : 'Guide Rail'}
            </label>
          ))}
        </div>
        {props.orientationKind === 'guideRail' && (
          <button type="button" onClick={props.onPickGuideRail} style={btn}>
            {props.guideRailSketchId ? `Guide rail: ${props.guideRailSketchId}` : 'Pick guide rail'}
          </button>
        )}
      </section>

      <section style={{ marginBottom: 8 }}>
        <h2 style={head}>Operation</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          {(['new', 'join', 'cut'] as const).map((op) => (
            <label key={op} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
              <input
                type="radio"
                name="sweepOperation"
                checked={props.operation === op}
                disabled={op !== 'new' && !props.hasRunningBody}
                onChange={() => props.onSetOperation(op)}
              />
              {op[0]!.toUpperCase() + op.slice(1)}
            </label>
          ))}
        </div>
      </section>

      {props.previewError && (
        <div style={{ color: '#ff6b6b', marginBottom: 8 }}>{props.previewError}</div>
      )}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" onClick={props.onCancel} style={btn}>Cancel</button>
        <button type="submit" disabled={!canCommit} style={btn}>OK</button>
      </div>
    </form>
  );
}
