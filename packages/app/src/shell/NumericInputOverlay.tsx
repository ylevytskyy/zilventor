import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  visible: boolean;
  fieldCount: number;
  position: { x: number; y: number };
  onCommit(values: number[]): void;
  onCancel(): void;
};

/**
 * Floating numeric input that appears during sketch drawing.
 * When `fieldCount === 1`, a single input collects a scalar (length, radius).
 * When `fieldCount === 2`, two inputs collect paired values (width + height).
 * Enter commits; Escape cancels; Tab moves between fields.
 */
export default function NumericInputOverlay({ visible, fieldCount, position, onCommit, onCancel }: Props) {
  const { t } = useTranslation();
  const [values, setValues] = useState<string[]>(() => Array(Math.max(fieldCount, 1)).fill(''));
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible && fieldCount > 0) {
      setValues(Array(fieldCount).fill(''));
      queueMicrotask(() => firstRef.current?.focus());
    }
  }, [visible, fieldCount]);

  if (!visible || fieldCount === 0) return null;

  const submit = () => {
    const parsed = values.map((v) => Number(v));
    if (parsed.some((n) => !Number.isFinite(n))) return;
    onCommit(parsed);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Tab' && idx < fieldCount - 1) {
      e.preventDefault();
      const next = document.querySelectorAll<HTMLInputElement>('[data-numeric-input]').item(idx + 1);
      next?.focus();
    }
  };

  return (
    <div
      className="absolute bg-shell-panel border border-shell-border rounded shadow-xl px-2 py-1 flex gap-1 z-40"
      style={{ left: position.x, top: position.y }}
    >
      {Array.from({ length: fieldCount }).map((_, i) => (
        <input
          key={i}
          ref={i === 0 ? firstRef : undefined}
          data-numeric-input
          type="text"
          value={values[i] ?? ''}
          onChange={(e) => setValues((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
          onKeyDown={(e) => handleKey(e, i)}
          className="bg-shell text-white px-2 py-0.5 text-xs w-20 outline-none focus:ring-1 focus:ring-ribbon-accent"
          placeholder={fieldCount === 2 ? (i === 0 ? t('overlay.numeric.widthPlaceholder') : t('overlay.numeric.heightPlaceholder')) : ''}
          aria-label={fieldCount === 2 ? (i === 0 ? t('overlay.numeric.numericWidth') : t('overlay.numeric.numericHeight')) : t('overlay.numeric.numericValue')}
        />
      ))}
    </div>
  );
}
