import React from 'react';
import { useTranslation } from 'react-i18next';
import type { FaceName, HoleFeature, HolePlacement, HoleProfile, HoleTermination, ParamOrLiteral } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { parseParamOrLiteral } from './parseParamOrLiteral';

export type { HoleFeature };

export type HoleDraftValue = {
  placementMode: 'fromSketch' | 'linear' | 'concentric';
  sketchId: string | null;
  placementFace: FaceName | null;
  refEdges: readonly (unknown | null)[];
  circularEdge: unknown | null;
  targetFace: FaceName | null;
  profileKind: 'simple' | 'counterbore' | 'countersink';
  diameter: string;
  cboreDiameter: string;
  cboreDepth: string;
  cskDiameter: string;
  cskAngle: string;
  termKind: 'distance' | 'throughAll' | 'toFace' | 'toNext';
  depth: string;
};

function paramOrLiteralToText(p: ParamOrLiteral | undefined): string {
  if (!p) return '';
  if (p.kind === 'param') return `=${p.paramName}`;
  return String(p.value);
}

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

type HoleDialogProps = {
  /**
   * Called whenever the dialog's form state changes and a preview could be
   * fired. The host (App.tsx) owns the debounce timer and calls
   * kernelClient.previewFeature, mirroring how RevolveDialog wires
   * `onDraftChange`.
   */
  onDraftChange?: (v: HoleDraftValue) => void;
  /**
   * When set, an error badge is rendered above the footer buttons describing
   * the most recent preview failure. Cleared by the host on commit/cancel.
   */
  previewError?: string | null;
  /**
   * Called when the user clicks OK. Receives the fully-constructed HoleFeature.
   * The host (App.tsx wrapper) dispatches AddHoleFeatureCommand and calls
   * resetHoleDialog() after the command resolves — the dialog does NOT mutate
   * the store directly.
   */
  onCommit?: (feature: HoleFeature) => void;
};

export function HoleDialog({ onDraftChange, previewError, onCommit }: HoleDialogProps = {}): JSX.Element | null {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.holeDialogOpen);
  const resetHoleDialog = useAppStore((s) => s.resetHoleDialog);

  // Profile section local state (T26 will seed from stored feature)
  const [profileKind, setProfileKind] = React.useState<'simple' | 'counterbore' | 'countersink'>('simple');
  const [diameter, setDiameter] = React.useState('5');
  const [cboreDiameter, setCboreDiameter] = React.useState('10');
  const [cboreDepth, setCboreDepth] = React.useState('3');
  const [cskDiameter, setCskDiameter] = React.useState('10');
  const [cskAngle, setCskAngle] = React.useState('82');

  // Termination section local state
  const [termKind, setTermKind] = React.useState<'distance' | 'throughAll' | 'toFace' | 'toNext'>('throughAll');
  const [depth, setDepth] = React.useState('10');

  const initial = useAppStore((s) => s.holeInitialValues);
  React.useEffect(() => {
    if (!initial) return;
    setProfileKind(initial.profile.kind);
    setDiameter(paramOrLiteralToText(initial.profile.diameter));
    if (initial.profile.kind === 'counterbore') {
      setCboreDiameter(paramOrLiteralToText(initial.profile.cboreDiameter));
      setCboreDepth(paramOrLiteralToText(initial.profile.cboreDepth));
    }
    if (initial.profile.kind === 'countersink') {
      setCskDiameter(paramOrLiteralToText(initial.profile.cskDiameter));
      setCskAngle(paramOrLiteralToText(initial.profile.cskAngle));
    }
    setTermKind(initial.termination.kind);
    if (initial.termination.kind === 'distance') {
      setDepth(paramOrLiteralToText(initial.termination.depth));
    }
  }, [initial]);

  const placementMode = useAppStore((s) => s.holePlacementMode);
  const setPlacementMode = (m: 'fromSketch' | 'linear' | 'concentric') =>
    useAppStore.setState((s) => ({ ...s, holePlacementMode: m }));

  const sketchId = useAppStore((s) => s.holeSketchId);
  const placementFace = useAppStore((s) => s.holePlacementFace);
  const refEdges = useAppStore((s) => s.holeRefEdges);
  const circularEdge = useAppStore((s) => s.holeCircularEdge);
  const targetFace = useAppStore((s) => s.holeTargetFace);

  // Fire onDraftChange whenever any form field that affects the feature
  // changes, mirroring how RevolveDialog fires its onDraftChange effect.
  // The host (App.tsx) owns the 150 ms debounce timer.
  React.useEffect(() => {
    if (!open || !onDraftChange) return;
    // atFace is a baked placement not shown in this dialog; normalise to 'fromSketch'.
    const draftPlacementMode: HoleDraftValue['placementMode'] =
      placementMode === 'atFace' ? 'fromSketch' : placementMode;
    onDraftChange({
      placementMode: draftPlacementMode,
      sketchId,
      placementFace,
      refEdges,
      circularEdge,
      targetFace,
      profileKind,
      diameter,
      cboreDiameter,
      cboreDepth,
      cskDiameter,
      cskAngle,
      termKind,
      depth,
    });
  }, [
    open, onDraftChange,
    placementMode, sketchId, placementFace, refEdges, circularEdge, targetFace,
    profileKind, diameter, cboreDiameter, cboreDepth, cskDiameter, cskAngle,
    termKind, depth,
  ]);

  const onOk = () => {
    const s = useAppStore.getState();

    const placement: HolePlacement = (() => {
      if (s.holePlacementMode === 'fromSketch') {
        return { kind: 'fromSketch', sketchId: s.holeSketchId ?? '' };
      }
      if (s.holePlacementMode === 'linear') {
        return {
          kind: 'linear',
          faceName: s.holePlacementFace ?? { featureId: '', role: '' },
          refEdge1: s.holeRefEdges[0] ?? { faceA: { featureId: '', role: '' }, faceB: { featureId: '', role: '' } },
          offset1: { kind: 'literal', value: 5 },
          refEdge2: s.holeRefEdges[1] ?? { faceA: { featureId: '', role: '' }, faceB: { featureId: '', role: '' } },
          offset2: { kind: 'literal', value: 5 },
        };
      }
      return {
        kind: 'concentric',
        faceName: s.holePlacementFace ?? { featureId: '', role: '' },
        circularEdgeName: s.holeCircularEdge ?? { faceA: { featureId: '', role: '' }, faceB: { featureId: '', role: '' } },
      };
    })();

    const profile: HoleProfile = (() => {
      if (profileKind === 'simple') return { kind: 'simple', diameter: parseParamOrLiteral(diameter) };
      if (profileKind === 'counterbore') return {
        kind: 'counterbore',
        diameter: parseParamOrLiteral(diameter),
        cboreDiameter: parseParamOrLiteral(cboreDiameter),
        cboreDepth: parseParamOrLiteral(cboreDepth),
      };
      return {
        kind: 'countersink',
        diameter: parseParamOrLiteral(diameter),
        cskDiameter: parseParamOrLiteral(cskDiameter),
        cskAngle: parseParamOrLiteral(cskAngle),
      };
    })();

    const termination: HoleTermination = (() => {
      if (termKind === 'distance') return { kind: 'distance', depth: parseParamOrLiteral(depth) };
      if (termKind === 'toFace') return { kind: 'toFace', targetFaceName: s.holeTargetFace ?? { featureId: '', role: '' } };
      if (termKind === 'toNext') return { kind: 'toNext' };
      return { kind: 'throughAll' };
    })();

    const id = s.editingHoleId ?? `H${Date.now()}`;
    const feature: HoleFeature = { id, kind: 'hole', placement, profile, termination, flipAxis: false };

    // Delegate to the host (App.tsx wrapper) which will dispatch
    // AddHoleFeatureCommand → kernel.addFeature + execute + setActivePart,
    // then call resetHoleDialog(). Do NOT mutate the store directly here.
    if (onCommit) {
      onCommit(feature);
    } else {
      // Fallback for tests that render HoleDialog standalone without a wrapper.
      const part = s.activePart;
      if (part) {
        if (s.editingHoleId) {
          s.setActivePart({
            ...part,
            featureTree: part.featureTree.map((f) => f.id === id ? feature : f),
          });
        } else {
          s.setActivePart({
            ...part,
            featureTree: [...part.featureTree, feature],
          });
        }
      }
      s.resetHoleDialog();
    }
  };

  if (!open) return null;


  return (
    <div role="dialog" aria-label={t('aria.hole')} style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('dialog.hole.title')}</div>

      <div style={sectionStyle}>
        <h2 style={sectionHeadingStyle}>{t('dialog.hole.placement')}</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {(['fromSketch', 'linear', 'concentric'] as const).map((m) => (
            <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
              <input
                type="radio"
                name="holePlacement"
                checked={placementMode === m}
                onChange={() => setPlacementMode(m)}
              />
              {m === 'fromSketch' ? t('dialog.hole.from_sketch') : m === 'linear' ? t('dialog.hole.linear') : t('dialog.hole.concentric')}
            </label>
          ))}
        </div>

        {placementMode === 'fromSketch' && (
          <button
            type="button"
            style={pickRowStyle}
            onClick={() => { /* T27 wires the SketchPickController activation */ }}
          >
            {sketchId ? `Sketch: ${sketchId}` : t('dialog.hole.pick_sketch')}
          </button>
        )}

        {placementMode === 'linear' && (
          <div style={{ display: 'grid', gap: 4 }}>
            <button type="button" style={pickRowStyle}>
              {placementFace ? `Face: ${placementFace}` : t('dialog.hole.pick_face')}
            </button>
            <div style={{ display: 'flex', gap: 4 }}>
              <button type="button" style={pickRowFlexStyle}>
                {refEdges[0] ? 'Edge 1 ✓' : t('dialog.hole.pick_edge_1')}
              </button>
              <input
                aria-label={t('aria.offset1')}
                type="text"
                defaultValue="5"
                style={offsetInputStyle}
              />
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button type="button" style={pickRowFlexStyle}>
                {refEdges[1] ? 'Edge 2 ✓' : t('dialog.hole.pick_edge_2')}
              </button>
              <input
                aria-label={t('aria.offset2')}
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
              {placementFace ? `Face: ${placementFace}` : t('dialog.hole.pick_face')}
            </button>
            <button type="button" style={pickRowStyle}>
              {circularEdge ? 'Circular edge ✓' : t('dialog.hole.pick_circular_edge')}
            </button>
          </div>
        )}
      </div>

      <section style={{ marginBottom: 12 }}>
        <h2 style={{ marginBottom: 6, fontSize: 12, fontWeight: 600 }}>{t('dialog.hole.profile.label')}</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {(['simple', 'counterbore', 'countersink'] as const).map((k) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
              <input
                type="radio"
                name="holeProfile"
                checked={profileKind === k}
                onChange={() => setProfileKind(k)}
              />
              {t('dialog.hole.profile.' + k)}
            </label>
          ))}
        </div>

        <div style={{ display: 'grid', gap: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span style={{ width: 80 }}>{t('dialog.hole.diameter')}</span>
            <input
              aria-label={t('aria.diameter')}
              type="text"
              value={diameter}
              onChange={(e) => setDiameter(e.target.value)}
              style={{ flex: 1, background: '#222', border: '1px solid #444', color: '#eee', padding: '4px 6px', fontSize: 11 }}
            />
          </label>
          {profileKind === 'counterbore' && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <span style={{ width: 80 }}>{t('dialog.hole.cbore_diameter')}</span>
                <input
                  aria-label={t('aria.cbore_diameter')}
                  type="text"
                  value={cboreDiameter}
                  onChange={(e) => setCboreDiameter(e.target.value)}
                  style={{ flex: 1, background: '#222', border: '1px solid #444', color: '#eee', padding: '4px 6px', fontSize: 11 }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <span style={{ width: 80 }}>{t('dialog.hole.cbore_depth')}</span>
                <input
                  aria-label={t('aria.cbore_depth')}
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
                <span style={{ width: 80 }}>{t('dialog.hole.csk_diameter')}</span>
                <input
                  aria-label={t('aria.csk_diameter')}
                  type="text"
                  value={cskDiameter}
                  onChange={(e) => setCskDiameter(e.target.value)}
                  style={{ flex: 1, background: '#222', border: '1px solid #444', color: '#eee', padding: '4px 6px', fontSize: 11 }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <span style={{ width: 80 }}>{t('dialog.hole.csk_angle')}</span>
                <input
                  aria-label={t('aria.csk_angle')}
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

      <section style={{ marginBottom: 12 }}>
        <h2 style={{ marginBottom: 6, fontSize: 12, fontWeight: 600 }}>{t('dialog.hole.termination')}</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, marginBottom: 4 }}>
          <span style={{ width: 80 }}>{t('dialog.hole.termination')}</span>
          <select
            aria-label={t('aria.termination')}
            value={termKind}
            onChange={(e) => setTermKind(e.target.value as 'distance' | 'throughAll' | 'toFace' | 'toNext')}
            style={{ flex: 1, background: '#222', border: '1px solid #444', color: '#eee', padding: '4px 6px', fontSize: 11 }}
          >
            <option value="distance">{t('dialog.hole.distance')}</option>
            <option value="throughAll">{t('dialog.hole.through_all')}</option>
            <option value="toFace">{t('dialog.hole.to_face')}</option>
            <option value="toNext">{t('dialog.hole.to_next')}</option>
          </select>
        </label>
        {termKind === 'distance' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span style={{ width: 80 }}>{t('dialog.hole.depth')}</span>
            <input
              aria-label={t('aria.depth')}
              type="text"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
              style={{ flex: 1, background: '#222', border: '1px solid #444', color: '#eee', padding: '4px 6px', fontSize: 11 }}
            />
          </label>
        )}
        {termKind === 'toFace' && (
          <button
            type="button"
            style={{ width: '100%', background: '#222', border: '1px solid #444', color: '#eee', padding: '4px 8px', fontSize: 11 }}
          >
            {t('dialog.hole.pick_target_face')}
          </button>
        )}
      </section>

      {previewError && (
        <div
          role="alert"
          style={{
            background: '#3a1a1a',
            border: '1px solid #6a3333',
            color: '#ffb3b3',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 11,
            marginBottom: 8,
          }}
        >
          Preview: {previewError}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" onClick={resetHoleDialog} style={btnStyle}>{t('common.cancel')}</button>
        <button type="button" onClick={onOk} style={okBtnStyle}>{t('common.ok')}</button>
      </div>
    </div>
  );
}
