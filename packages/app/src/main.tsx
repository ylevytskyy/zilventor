import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { register as registerPWA } from './pwa/registerSW';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
registerPWA();
