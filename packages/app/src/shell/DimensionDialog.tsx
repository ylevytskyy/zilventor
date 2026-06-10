import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  initialName: string;
  initialExpression: string;
  unit: 'mm' | 'deg';
  cursor: { x: number; y: number };
  onCommit(v: { name: string; expression: string }): void;
  onCancel(): void;
};

export function DimensionDialog({ initialName, initialExpression, unit, cursor, onCommit, onCancel }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [expression, setExpression] = useState(initialExpression);

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    onCommit({ name, expression });
  };

  return (
    <form
      role="dialog"
      aria-label={t('aria.edit_dimension')}
      onSubmit={handleSubmit}
      style={{
        position: 'absolute',
        left: cursor.x + 20, top: cursor.y + 20,
        background: '#1a1a1a', border: '1px solid #444', borderRadius: 6,
        padding: 12, width: 260, color: '#eee',
        zIndex: 50
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('dialog.dimension.title')}</div>
      <label style={{ display: 'block', marginBottom: 6 }}>
        {t('dialog.dimension.name')}
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: '100%', marginTop: 2, background: '#222', color: '#eee', border: '1px solid #333', padding: '4px 6px' }}
        />
      </label>
      <label style={{ display: 'block', marginBottom: 8 }}>
        {t('dialog.dimension.value')}
        <input
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          style={{ width: '100%', marginTop: 2, background: '#222', color: '#eee', border: '1px solid #333', padding: '4px 6px' }}
        />
        <span style={{ fontSize: 11, color: '#888', marginLeft: 4 }}>{unit}</span>
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
        <button type="submit">{t('common.ok')}</button>
      </div>
    </form>
  );
}
