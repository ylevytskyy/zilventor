import { useTranslation } from 'react-i18next';

const LANGS: { code: 'en' | 'uk'; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'uk', label: 'УК' },
];

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const active = i18n.language?.startsWith('uk') ? 'uk' : 'en';
  return (
    <div role="group" aria-label="Language" style={{ display: 'flex', gap: 4 }}>
      {LANGS.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          aria-pressed={active === code}
          onClick={() => i18n.changeLanguage(code)}
          style={{
            padding: '2px 6px',
            fontSize: 12,
            fontWeight: active === code ? 700 : 400,
            opacity: active === code ? 1 : 0.6,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
