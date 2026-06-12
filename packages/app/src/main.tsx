import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import App from './App';
import { register as registerPWA } from './pwa/registerSW';
import { isSupportedEnvironment } from './pwa/checkSupport';
import { UnsupportedSplash } from './pwa/UnsupportedSplash';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
if (!isSupportedEnvironment()) {
  root.render(<UnsupportedSplash />);
} else {
  root.render(<StrictMode><App /></StrictMode>);
  registerPWA();
}
