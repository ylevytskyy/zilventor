import React from 'react';
import { useAppStore } from '../store/useAppStore';

/**
 * Hole dialog. Skeleton scaffold — sections are populated by Tasks 21–23:
 *   - Placement section (T21)
 *   - Profile section  (T22)
 *   - Termination section + OK commit handler (T23)
 *
 * Cancel always closes via resetHoleDialog. OK is currently a no-op until T23.
 */

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 80,
  right: 20,
  background: '#1a1a1a',
  border: '1px solid #444',
  borderRadius: 6,
  padding: 12,
  width: 360,
  color: '#eee',
  zIndex: 50,
  fontSize: 12,
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 12,
};

const sectionHeadingStyle: React.CSSProperties = {
  display: 'block',
  fontWeight: 600,
  marginBottom: 4,
  fontSize: 12,
};

const btnStyle: React.CSSProperties = {
  background: '#2a2a2a',
  color: '#eee',
  border: '1px solid #444',
  padding: '4px 10px',
  cursor: 'pointer',
};

const okBtnStyle: React.CSSProperties = {
  background: '#3b5a8a',
  color: '#eee',
  border: '1px solid #6a8ec4',
  padding: '4px 10px',
  cursor: 'pointer',
};

export function HoleDialog(): JSX.Element | null {
  const open = useAppStore((s) => s.holeDialogOpen);
  const resetHoleDialog = useAppStore((s) => s.resetHoleDialog);

  if (!open) return null;

  return (
    <div role="dialog" aria-label="Hole" style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Hole</div>

      <div style={sectionStyle}>
        <h2 style={sectionHeadingStyle}>Placement</h2>
        {/* T21 */}
      </div>

      <div style={sectionStyle}>
        <h2 style={sectionHeadingStyle}>Profile</h2>
        {/* T22 */}
      </div>

      <div style={sectionStyle}>
        <h2 style={sectionHeadingStyle}>Termination</h2>
        {/* T23 */}
      </div>

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" onClick={resetHoleDialog} style={btnStyle}>Cancel</button>
        <button type="button" style={okBtnStyle}>OK</button>
      </div>
    </div>
  );
}
