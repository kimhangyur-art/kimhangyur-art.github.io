import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// Tauri 모듈 이름을 브라우저용 대체 모듈(src/shims)로 돌린다.
// 화면은 exe(launcher/)가 띄우는 로컬 주소에서 돌고, 파일·폴더 작업은 exe가 대신한다.
const shim = (name: string) => path.resolve(__dirname, `./src/shims/${name}.ts`)
const TAURI_SHIMS: Record<string, string> = {
    '@tauri-apps/api/core': shim('core'),
    '@tauri-apps/api/path': shim('path'),
    '@tauri-apps/api/window': shim('window'),
    '@tauri-apps/api/app': shim('app'),
    '@tauri-apps/plugin-fs': shim('fs'),
    '@tauri-apps/plugin-dialog': shim('dialog'),
    '@tauri-apps/plugin-shell': shim('shell'),
    '@tauri-apps/plugin-opener': shim('opener'),
    '@tauri-apps/plugin-process': shim('process'),
    '@tauri-apps/plugin-updater': shim('updater'),
    '@tauri-apps/plugin-deep-link': shim('deep-link'),
    '@tauri-apps/plugin-store': shim('store'),
}

// 개발 서버(npm run dev)에서는 실행 중인 exe(또는 go run)에 /__api, /comfy 요청을 넘긴다.
// exe를 NC_TOKEN=dev 로 띄우고 VITE_NC_TOKEN=dev 로 개발 서버를 띄우면 된다.
const launcher = process.env.NC_LAUNCHER ?? 'http://127.0.0.1:47900'

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            ...TAURI_SHIMS,
            '@': path.resolve(__dirname, './src'),
        },
    },
    build: {
        chunkSizeWarningLimit: 4000,
    },
    clearScreen: false,
    server: {
        port: 9090,
        strictPort: true,
        proxy: {
            '/__api': { target: launcher, changeOrigin: true },
            '/comfy': { target: launcher, changeOrigin: true, ws: true },
        },
    },
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
})
