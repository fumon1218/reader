import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyTheme } from './settings';
import './index.css';

applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// 오프라인에서도 앱이 열리도록 서비스워커 등록 (배포 빌드에서만)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}

// 브라우저가 저장소를 임의로 지우지 않도록 요청 (조용히 실패해도 괜찮음)
navigator.storage?.persist?.().catch(() => undefined);
