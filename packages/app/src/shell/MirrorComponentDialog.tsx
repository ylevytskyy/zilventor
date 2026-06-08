import { useState, type FormEvent } from 'react';
import type { MirrorPlane } from '@zilventor/shared';

export type MirrorComponentDialogValue = {
  sourceComponentId: string;
  plane: MirrorPlane;
};

type ComponentSummary = {
  id: string;
  label: string;
};

type Props = {
  components: ComponentSummary[];
  onCommit(v: MirrorComponentDialogValue): void;
  onCancel(): void;
};

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 80,
  right: 20,
  background: '#1a1a1a',
  border: '1px solid #444',
  borderRadius: 6,
  padding: 12,
  width: 320,
  color: '#eee',
  zIndex: 50,
  fontSize: 12,
};
const labelStyle: React.CSSProperties = { display: 'block', fontWeight: 600, marginBottom: 4 };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 };
const inputStyle: React.CSSProperties = {
  flex: 1,
  background: '#222',
  color: '#eee',
  border: '1px solid #333',
  padding: '4px 6px',
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a',
  color: '#eee',
  border: '1px solid #444',
  padding: '4px 10px',
  cursor: 'pointer',
};

export function MirrorComponentDialog({
  components,
  onCommit,
  onCancel,
}: Props): JSX.Element {
  const [sourceComponentId, setSourceComponentId] = useState(components[0]?.id ?? '');
  const [plane, setPlane] = useState<MirrorPlane>('yz');

  const canCommit = sourceComponentId !== '';

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canCommit) return;
    onCommit({ sourceComponentId, plane });
  };

  return (
    <form role="dialog" aria-label="Mirror Component" onSubmit={handleSubmit} style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Mirror Component</div>

      <div style={rowStyle}>
        <label style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }}>Source</label>
        <select
          aria-label="Source component"
          value={sourceComponentId}
          onChange={(e) => setSourceComponentId(e.target.value)}
          style={inputStyle}
        >
          {components.length === 0 && <option value="">(no components)</option>}
          {components.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>

      <div style={rowStyle}>
        <span style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }}>Plane</span>
        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {(['yz', 'xz', 'xy'] as MirrorPlane[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlane(p)}
              style={{
                ...btnStyle,
                flex: 1,
                background: plane === p ? '#3b5a8a' : '#2a2a2a',
                borderColor: plane === p ? '#6a8ec4' : '#444',
              }}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div style={{ color: '#888', fontSize: 11, marginBottom: 8 }}>
        YZ mirrors across x=0; XZ across y=0; XY across z=0.
      </div>

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={btnStyle}>Cancel</button>
        <button type="submit" disabled={!canCommit} style={btnStyle}>OK</button>
      </div>
    </form>
  );
}
