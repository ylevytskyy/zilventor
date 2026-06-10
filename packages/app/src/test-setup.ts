import '@testing-library/jest-dom';
// Install the localStorage shim FIRST (own module → evaluates before the i18n
// import below, which reads localStorage via its LanguageDetector at init).
import './test-localstorage-shim';
// Initialize i18next for the test environment so components rendered in tests
// resolve `t('key')` to their English values (default language) instead of the
// raw key. Without this, every text-based query (getByText('OK'), etc.) breaks.
import './i18n';
