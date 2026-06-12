import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import App from './App';
import { register as registerPWA } from './pwa/registerSW';
import { isSupportedEnvironment } from './pwa/checkSupport';
import { UnsupportedSplash } from './pwa/UnsupportedSplash';
import { ErrorBoundary } from './shell/ErrorBoundary';
import './styles.css';

// Request persistent storage so the browser doesn't evict OPFS design data
// under storage pressure. Best-effort: feature-detected, never throws.
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
  void navigator.storage.persist();
}

const root = createRoot(document.getElementById('root')!);
if (!isSupportedEnvironment()) {
  root.render(<UnsupportedSplash />);
} else {
  root.render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
  registerPWA();
}
