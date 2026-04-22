import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './i18n';
import { registerSW } from 'virtual:pwa-register';
import { logPageView } from './lib/queryLogger';

// 自動更新 Service Worker
registerSW({ immediate: true });

// 記錄進站事件（裝置資訊＋地理位置由後端補充）
logPageView();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
