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

const pickRowStyle: React.CSSProperties = {
  width: '100%',
  padding: '4px 8px',
  fontSize: 11,
  background: '#222',
  border: '1px solid #444',
  color: '#eee',
  cursor: 'pointer',
  textAlign: 'left',
};

const pickRowFlexStyle: React.CSSProperties = {
  flex: 1,
  padding: '4px 8px',
  fontSize: 11,
  background: '#222',
  border: '1px solid #444',
  color: '#eee',
  cursor: 'pointer',
  textAlign: 'left',
};

const offsetInputStyle: React.CSSProperties = {
  width: 56,
  background: '#222',
  border: '1px solid #444',
  color: '#eee',
  padding: '4px 6px',
  fontSize: 11,
};

export function HoleDialog(): JSX.Element | null {
  const open = useAppStore((s) => s.holeDialogOpen);
  const resetHoleDialog = useAppStore((s) => s.resetHoleDialog);

  // Profile section local state (T26 will seed from stored feature)
  const [profileKind, setProfileKind] = React.useState<'simple' | 'counterbore' | 'countersink'>('simple');
  const [diameter, setDiameter] = React.useState('5');
  const [cboreDiameter, setCboreDiameter] = React.useState('10');
  const [cboreDepth, setCboreDepth] = React.useState('3');
  const [cskDiameter, setCskDiameter] = React.useState('10');
  const [cskAngle, setCskAngle] = React.useState('82');

  const placementMode = useAppStore((s) => s.holePlacementMode);
  const setPlacementMode = (m: 'fromSketch' | 'linear' | 'concentric') =>
    useAppStore.setState((s) => ({ ...s, holePlacementMode: m }));

  const sketchId = useAppStore((s) => s.holeSketchId);
  const placementFace = useAppStore((s) => s.holePlacementFace);
  const refEdges = useAppStore((s) => s.holeRefEdges);
  const circularEdge = useAppStore((s) => s.holeCircularEdge);

  if (!open) return null;

  return (
    <div role="dialog" aria-label="Hole" style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Hole</div>

      <div style={sectionStyle}>
        <h2 style={sectionHeadingStyle}>Placement</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {(['fromSketch', 'linear', 'concentric'] as const).map((m) => (
            <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
              <input
                type="radio"
                name="holePlacement"
                checked={placementMode === m}
                onChange={() => setPlacementMode(m)}
              />
              {m === 'fromSketch' ? 'From Sketch' : m[0]!.toUpperCase() + m.slice(1)}
            </label>
          ))}
        </div>

        {placementMode === 'fromSketch' && (
          <button
            type="button"
            style={pickRowStyle}
            onClick={() => { /* T27 wires the SketchPickController activation */ }}
          >
            {sketchId ? `Sketch: ${sketchId}` : 'Pick sketch'}
          </button>
        )}

        {placementMode === 'linear' && (
          <div style={{ display: 'grid', gap: 4 }}>
            <button type="button" style={pickRowStyle}>
              {placementFace ? `Face: ${placementFace}` : 'Pick face'}
            </button>
            <div style={{ display: 'flex', gap: 4 }}>
              <button type="button" style={pickRowFlexStyle}>
                {refEdges[0] ? 'Edge 1 ✓' : 'Pick edge 1'}
              </button>
              <input
                aria-label="offset 1"
                type="text"
                defaultValue="5"
                style={offsetInputStyle}
              />
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button type="button" style={pickRowFlexStyle}>
                {refEdges[1] ? 'Edge 2 ✓' : 'Pick edge 2'}
              </button>
              <input
                aria-label="offset 2"
                type="text"
                defaultValue="5"
                style={offsetInputStyle}
              />
            </div>
          </div>
        )}

        {placementMode === 'concentric' && (
          <div style={{ display: 'grid', gap: 4 }}>
            <button type="button" style={pickRowStyle}>
              {placementFace ? `Face: ${placementFace}` : 'Pick face'}
            </button>
            <button type="button" style={pickRowStyle}>
              {circularEdge ? 'Circular edge ✓' : 'Pick circular edge'}
            </button>
          </div>
        )}
      </div>

      <section style={{ marginBottom: 12 }}>
        <h2 style={{ marginBottom: 6, fontSize: 12, fontWeight: 600 }}>Profile</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {(['simple', 'counterbore', 'countersink'] as const).map((k) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
              <input
                type="radio"
                name="holeProfile"
                checked={profileKind === k}
                onChange={() => setProfileKind(k)}
              />
              {k[0]!.toUpperCase() + k.slice(1)}
            </label>
          ))}
        </div>

        <div style={{ display: 'grid', gap: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span style={{ width: 80 }}>Diameter</span>
            <input
              aria-label="Diameter"
              type="text"
              value={diameter}
              onChange={(e) => setDiameter(e.target.value)}
              style={{ flex: 1, background: '#222', border: '1px solid #444', color: '#eee', padding: '4px 6px', fontSize: 11 }}
            />
          </label>
          {profileKind === 'counterbore' && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <span style={{ width: 80 }}>CBORE Ø</span>
                <input
                  aria-label="CBORE Ø"
                  type="text"
                  value={cboreDiameter}
                  onChange={(e) => setCboreDiameter(e.target.value)}
                  style={{ flex: 1, background: '#222', border: '1px solid #444', color: '#eee', padding: '4px 6px', fontSize: 11 }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <span style={{ width: 80 }}>CBORE depth</span>
                <input
                  aria-label="CBORE depth"
                  type="text"
                  value={cboreDepth}
                  onChange={(e) => setCboreDepth(e.target.value)}
                  style={{ flex: 1, background: '#222', border: '1px solid #444', color: '#eee', padding: '4px 6px', fontSize: 11 }}
                />
              </label>
            </>
          )}
          {profileKind === 'countersink' && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <span style={{ width: 80 }}>CSK Ø</span>
                <input
                  aria-label="CSK Ø"
                  type="text"
                  value={cskDiameter}
                  onChange={(e) => setCskDiameter(e.target.value)}
                  style={{ flex: 1, background: '#222', border: '1px solid #444', color: '#eee', padding: '4px 6px', fontSize: 11 }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <span style={{ width: 80 }}>CSK angle</span>
                <input
                  aria-label="CSK angle"
                  type="text"
                  value={cskAngle}
                  onChange={(e) => setCskAngle(e.target.value)}
                  style={{ flex: 1, background: '#222', border: '1px solid #444', color: '#eee', padding: '4px 6px', fontSize: 11 }}
                />
              </label>
            </>
          )}
        </div>
      </section>

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
