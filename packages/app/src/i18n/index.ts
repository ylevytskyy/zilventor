import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import uk from './locales/uk.json';

// Module-level i18n init: fire-and-forget — the app renders with fallback 'en'
// while the async init completes; errors here would be non-recoverable startup failures.
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      uk: { translation: uk },
    },
    supportedLngs: ['en', 'uk'],
    fallbackLng: 'en',
    load: 'languageOnly', // uk-UA -> uk; unsupported -> fallback 'en'
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
    interpolation: { escapeValue: false },
    returnNull: false,
  });

export default i18n;
