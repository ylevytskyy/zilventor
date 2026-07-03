import React from 'react';
import { useTranslation } from 'react-i18next';
import { layoutTenonsAlongJoint } from '@zilventor/shared';
import type { TenonMortiseCreateInput } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 300, color: '#eee', fontSize: 12,
};
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6,
};
const fieldStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444', fontSize: 11,
  padding: '2px 4px', width: 120,
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };
const radioLabelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4 };
const previewStyle: React.CSSProperties = { fontSize: 10, color: '#aaa', marginBottom: 6 };
const warningStyle: React.CSSProperties = { color: '#e0a030', marginTop: 2 };

export function TenonMortiseDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const dialog = useAppStore((s) => s.tenonMortiseDialog);
  const setDialog = useAppStore((s) => s.setTenonMortiseDialog);

  const [width, setWidth] = React.useState('8');
  const [depth, setDepth] = React.useState('12');
  const [count, setCount] = React.useState('1');
  const [spacing, setSpacing] = React.useState('32');
  const [fitClearance, setFitClearance] = React.useState('0.1');
  const [position, setPosition] = React.useState('');

  // Auto-layout mode (P11): 'manual' preserves today's literal count/spacing path
  // byte-identical; 'auto' derives count/spacing from the joint's real edge length.
  const [layoutMode, setLayoutMode] = React.useState<'manual' | 'auto'>('manual');
  const [autoSubMode, setAutoSubMode] = React.useState<'count' | 'pitch'>('count');
  const [targetCount, setTargetCount] = React.useState('3');
  const [targetPitch, setTargetPitch] = React.useState('32');
  const [minEndMargin, setMinEndMargin] = React.useState('');

  // Reset defaults each time the dialog opens.
  React.useEffect(() => {
    if (dialog) {
      setWidth('8');
      setDepth('12');
      setCount('1');
      setSpacing('32');
      setFitClearance('0.1');
      setPosition('');
      setLayoutMode('manual');
      setAutoSubMode('count');
      setTargetCount('3');
      setTargetPitch('32');
      setMinEndMargin('');
    }
  }, [dialog]);

  if (!dialog) return null;

  const widthNum = Number(width);
  const autoValue = Number(autoSubMode === 'count' ? targetCount : targetPitch);
  const marginNum = minEndMargin !== '' ? Number(minEndMargin) : undefined;
  const preview =
    layoutMode === 'auto' && dialog.jointLength !== null &&
    !Number.isNaN(widthNum) && widthNum > 0 && !Number.isNaN(autoValue) && autoValue > 0
      ? layoutTenonsAlongJoint(dialog.jointLength, {
          mode: autoSubMode,
          value: autoValue,
          width: widthNum,
          ...(marginNum !== undefined && !Number.isNaN(marginNum) ? { minEndMargin: marginNum } : {}),
        })
      : null;

  const handleOk = (): void => {
    if (layoutMode === 'auto') {
      const payload: TenonMortiseCreateInput = {
        width: widthNum,
        depth: Number(depth),
        fitClearance: Number(fitClearance),
        ...(position !== '' ? { position: Number(position) } : {}),
        layout: {
          mode: autoSubMode,
          value: autoValue,
          ...(marginNum !== undefined && !Number.isNaN(marginNum) ? { minEndMargin: marginNum } : {}),
        },
      };
      void dialog.onSubmit(payload);
      setDialog(null);
      return;
    }
    const params: { width: number; depth: number; count: number; spacing: number; fitClearance: number; position?: number } = {
      width: widthNum,
      depth: Number(depth),
      count: Number(count),
      spacing: Number(spacing),
      fitClearance: Number(fitClearance),
    };
    if (position !== '') params.position = Number(position);
    void dialog.onSubmit(params);
    setDialog(null);
  };

  const handleCancel = (): void => {
    dialog.onCancel();
    setDialog(null);
  };

  const numRow = (
    id: string,
    labelKey: string,
    value: string,
    set: (v: string) => void,
  ): JSX.Element => (
    <div style={rowStyle}>
      <label htmlFor={id}>{t(labelKey)}</label>
      <input
        id={id}
        aria-label={t(labelKey)}
        style={fieldStyle}
        type="number"
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </div>
  );

  return (
    <div
      style={overlayStyle}
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleCancel(); }}
    >
      <div
        data-testid="tenon-mortise-dialog"
        style={panelStyle}
        role="dialog"
        aria-label={t('aria.tenonMortise')}
        onKeyDown={(e) => { if (e.key === 'Escape') handleCancel(); }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('dialog.tenonMortise.title')}</div>

        <div style={rowStyle}>
          <span>{t('dialog.tenonMortise.panelA')}</span>
          <span style={{ fontSize: 10, color: '#aaa' }}>{dialog.panelPathA}</span>
        </div>
        <div style={rowStyle}>
          <span>{t('dialog.tenonMortise.panelB')}</span>
          <span style={{ fontSize: 10, color: '#aaa' }}>{dialog.panelPathB}</span>
        </div>

        {numRow('tenon-mortise-width', 'dialog.tenonMortise.width', width, setWidth)}
        {numRow('tenon-mortise-depth', 'dialog.tenonMortise.depth', depth, setDepth)}

        <div style={rowStyle}>
          <span>{t('dialog.tenonMortise.layoutMode')}</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <label style={radioLabelStyle}>
              <input
                type="radio"
                name="tenonMortiseLayoutMode"
                aria-label={t('dialog.tenonMortise.manual')}
                checked={layoutMode === 'manual'}
                onChange={() => setLayoutMode('manual')}
              />
              {t('dialog.tenonMortise.manual')}
            </label>
            <label style={radioLabelStyle}>
              <input
                type="radio"
                name="tenonMortiseLayoutMode"
                aria-label={t('dialog.tenonMortise.auto')}
                checked={layoutMode === 'auto'}
                onChange={() => setLayoutMode('auto')}
              />
              {t('dialog.tenonMortise.auto')}
            </label>
          </div>
        </div>

        {layoutMode === 'manual' && (
          <>
            {numRow('tenon-mortise-count', 'dialog.tenonMortise.count', count, setCount)}
            {numRow('tenon-mortise-spacing', 'dialog.tenonMortise.spacing', spacing, setSpacing)}
          </>
        )}

        {layoutMode === 'auto' && (
          <>
            <div style={rowStyle}>
              <div style={{ display: 'flex', gap: 10 }}>
                <label style={radioLabelStyle}>
                  <input
                    type="radio"
                    name="tenonMortiseAutoSubMode"
                    aria-label={t('dialog.tenonMortise.byCount')}
                    checked={autoSubMode === 'count'}
                    onChange={() => setAutoSubMode('count')}
                  />
                  {t('dialog.tenonMortise.byCount')}
                </label>
                <label style={radioLabelStyle}>
                  <input
                    type="radio"
                    name="tenonMortiseAutoSubMode"
                    aria-label={t('dialog.tenonMortise.byPitch')}
                    checked={autoSubMode === 'pitch'}
                    onChange={() => setAutoSubMode('pitch')}
                  />
                  {t('dialog.tenonMortise.byPitch')}
                </label>
              </div>
            </div>
            {autoSubMode === 'count'
              ? numRow('tenon-mortise-targetCount', 'dialog.tenonMortise.targetCount', targetCount, setTargetCount)
              : numRow('tenon-mortise-targetPitch', 'dialog.tenonMortise.targetPitch', targetPitch, setTargetPitch)}
            {numRow('tenon-mortise-minEndMargin', 'dialog.tenonMortise.minEndMargin', minEndMargin, setMinEndMargin)}
            <div data-testid="tenon-mortise-preview" style={previewStyle}>
              {preview
                ? `${t('dialog.tenonMortise.count')}: ${preview.count}, ${t('dialog.tenonMortise.spacing')}: ${preview.spacing.toFixed(1)}mm`
                : t('dialog.tenonMortise.noPreview')}
              {preview?.clamped && <div style={warningStyle}>{t('dialog.tenonMortise.clampedWarning')}</div>}
            </div>
          </>
        )}

        {numRow('tenon-mortise-fitClearance', 'dialog.tenonMortise.fitClearance', fitClearance, setFitClearance)}
        {numRow('tenon-mortise-position', 'dialog.tenonMortise.position', position, setPosition)}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} onClick={handleCancel}>{t('common.cancel')}</button>
          <button style={okBtnStyle} onClick={handleOk}>{t('common.ok')}</button>
        </div>
      </div>
    </div>
  );
}
