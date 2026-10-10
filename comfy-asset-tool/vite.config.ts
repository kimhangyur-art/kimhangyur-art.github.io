/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // 상대 경로로 빌드해서 GitHub Pages 하위 폴더에서도 열 수 있게 한다.
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 800 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
