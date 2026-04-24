import { useEffect, useState, type FormEvent } from 'react';

export type ProfileRef = { sketchId: string; closedProfileCount: number };
export type AxisRef = { primitiveId: string };
export type RevolveDirection = 'normal' | 'symmetric' | 'flipped';
export type RevolveOperation = 'new' | 'join' | 'cut';

export type RevolveDialogValue = {
  name: string;
  expression: string;
  direction: RevolveDirection;
  operation: RevolveOperation;
};

type Props = {
  profile: ProfileRef | null;
  axis: AxisRef | null;
  hasRunningBody: boolean;
  initialName?: string;
  initialExpression?: string;
  onCommit(v: RevolveDialogValue): void;
  onApply(v: RevolveDialogValue): void;
  onCancel(): void;
  onPickProfile(): void;
  onPickAxis(): void;
  /**
   * Fires whenever the dialog's internal form state changes, guarded by
   * profile + axis being set. Used by the host to schedule a debounced
   * live preview via `previewFeature`.
   */
  onDraftChange?: (v: RevolveDialogValue) => void;
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

const sectionLabelStyle: React.CSSProperties = {
  display: 'block',
  fontWeight: 600,
  marginBottom: 4,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: '#222',
  color: '#eee',
  border: '1px solid #333',
  padding: '4px 6px',
};

const pickBtnStyle: React.CSSProperties = {
  background: '#2a2a2a',
  color: '#eee',
  border: '1px solid #444',
  padding: '4px 8px',
  cursor: 'pointer',
};

const toggleBtnStyle = (pressed: boolean, disabled: boolean): React.CSSProperties => ({
  background: pressed ? '#3b5a8a' : '#2a2a2a',
  color: disabled ? '#777' : '#eee',
  border: pressed ? '1px solid #6a8ec4' : '1px solid #444',
  padding: '4px 10px',
  cursor: disabled ? 'not-allowed' : 'pointer',
  flex: 1,
});

export function RevolveDialog({
  profile,
  axis,
  hasRunningBody,
  initialName = 'angle0',
  initialExpression = '360',
  onCommit,
  onApply,
  onCancel,
  onPickProfile,
  onPickAxis,
  onDraftChange,
}: Props): JSX.Element {
  const [name, setName] = useState(initialName);
  const [expression, setExpression] = useState(initialExpression);
  const [direction, setDirection] = useState<RevolveDirection>('normal');
  const [operation, setOperation] = useState<RevolveOperation>(hasRunningBody ? 'join' : 'new');

  const canCommit = !!profile && !!axis && expression.trim().length > 0;

  const value = (): RevolveDialogValue => ({ name, expression, direction, operation });

  // Fire onDraftChange whenever the user-editable state changes, but only
  // once profile + axis are both set — otherwise buildRevolveFeature on the
  // host side can't produce a valid scratch feature.
  useEffect(() => {
    if (!profile || !axis) return;
    onDraftChange?.({ name, expression, direction, operation });
  }, [name, expression, direction, operation, profile, axis, onDraftChange]);

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canCommit) return;
    onCommit(value());
  };

  const handleApply = (): void => {
    if (!canCommit) return;
    onApply(value());
  };

  return (
    <form
      role="dialog"
      aria-label="Revolve"
      onSubmit={handleSubmit}
      style={panelStyle}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Revolve</div>

      <div style={{ marginBottom: 10 }}>
        <span style={sectionLabelStyle}>Profile</span>
        <div style={rowStyle}>
          <button type="button" style={pickBtnStyle} onClick={onPickProfile}>
            {profile ? 'Change' : 'Pick'}
          </button>
          <span style={{ color: profile ? '#eee' : '#888' }}>
            {profile
              ? `${profile.sketchId} (${profile.closedProfileCount} closed loop${profile.closedProfileCount === 1 ? '' : 's'})`
              : 'None selected'}
          </span>
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <span style={sectionLabelStyle}>Axis</span>
        <div style={rowStyle}>
          <button type="button" style={pickBtnStyle} onClick={onPickAxis}>
            {axis ? 'Change' : 'Pick'}
          </button>
          <span style={{ color: axis ? '#eee' : '#888' }}>
            {axis ? axis.primitiveId : 'None selected'}
          </span>
        </div>
      </div>

      <label style={{ display: 'block', marginBottom: 8 }}>
        Name
        <input
          aria-label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ ...inputStyle, marginTop: 2, width: '100%' }}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 8 }}>
        Angle
        <input
          aria-label="Angle"
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          style={{ ...inputStyle, marginTop: 2, width: '100%' }}
        />
        <span style={{ fontSize: 11, color: '#888', marginLeft: 4 }}>deg</span>
      </label>

      <div style={{ marginBottom: 10 }}>
        <span style={sectionLabelStyle}>Direction</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            aria-pressed={direction === 'flipped'}
            style={toggleBtnStyle(direction === 'flipped', false)}
            onClick={() => setDirection('flipped')}
          >
            Flipped
          </button>
          <button
            type="button"
            aria-pressed={direction === 'symmetric'}
            style={toggleBtnStyle(direction === 'symmetric', false)}
            onClick={() => setDirection('symmetric')}
          >
            Symmetric
          </button>
          <button
            type="button"
            aria-pressed={direction === 'normal'}
            style={toggleBtnStyle(direction === 'normal', false)}
            onClick={() => setDirection('normal')}
          >
            Normal
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <span style={sectionLabelStyle}>Operation</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            aria-pressed={operation === 'new'}
            style={toggleBtnStyle(operation === 'new', false)}
            onClick={() => setOperation('new')}
          >
            New
          </button>
          <button
            type="button"
            aria-pressed={operation === 'join'}
            disabled={!hasRunningBody}
            style={toggleBtnStyle(operation === 'join', !hasRunningBody)}
            onClick={() => setOperation('join')}
          >
            Join
          </button>
          <button
            type="button"
            aria-pressed={operation === 'cut'}
            disabled={!hasRunningBody}
            style={toggleBtnStyle(operation === 'cut', !hasRunningBody)}
            onClick={() => setOperation('cut')}
          >
            Cut
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" onClick={handleApply} disabled={!canCommit}>Apply</button>
        <button type="submit" disabled={!canCommit}>OK</button>
      </div>
    </form>
  );
}
