import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 상대 경로(base './')라서 GitHub Pages 하위 경로나 Vercel 어디에 올려도 동작합니다.
// API 키는 코드/번들에 들어가지 않습니다. 앱 설정 화면에서 기기에만 저장합니다.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 3000, host: '0.0.0.0' },
});
