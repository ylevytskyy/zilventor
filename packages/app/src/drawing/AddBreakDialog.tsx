// packages/app/src/drawing/AddBreakDialog.tsx
import { useTranslation } from 'react-i18next';

type AddBreakDialogProps = {
  open: boolean;
  onConfirm: (axis: 'x' | 'y') => void;
  onCancel: () => void;
};

export function AddBreakDialog({ open, onConfirm, onCancel }: AddBreakDialogProps) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-break-dialog-title"
      style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'white', border: '1px solid #ccc',
        borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        padding: 16, zIndex: 2000, width: 260,
      }}
    >
      <div id="add-break-dialog-title" style={{ fontWeight: 600, marginBottom: 12 }}>
        {t('dialog.addBreak.title')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          aria-label={t('dialog.addBreak.horizontalBreak')}
          onClick={() => onConfirm('x')}
          style={{ padding: '6px 12px', cursor: 'pointer' }}
        >
          {t('dialog.addBreak.horizontalBreak')}
        </button>
        <button
          type="button"
          aria-label={t('dialog.addBreak.verticalBreak')}
          onClick={() => onConfirm('y')}
          style={{ padding: '6px 12px', cursor: 'pointer' }}
        >
          {t('dialog.addBreak.verticalBreak')}
        </button>
      </div>
      <button
        type="button"
        aria-label={t('common.cancel')}
        onClick={onCancel}
        style={{ padding: '4px 10px', cursor: 'pointer', float: 'right' }}
      >
        {t('common.cancel')}
      </button>
    </div>
  );
}
