import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './styles/globals.css'
import './i18n'
import { cleanupLargeData, migrateFromLocalStorage, migrateIndexedDBKeys, ensureDbReady, isDbInitFailed, indexedDBStorage, exportAllData } from './lib/indexed-db'
import { connectLauncher } from './lib/launcher-link'
import { useComfyStore } from './stores/comfy-store'
import { pingComfy } from './services/comfy/client'

// 자동 백업 상수
const AUTO_BACKUP_KEY = 'nais2-auto-backup'
const AUTO_BACKUP_INTERVAL = 24 * 60 * 60 * 1000 // 24시간
const MAX_AUTO_BACKUPS = 3

// Hide splash screen when React is ready
const hideSplash = () => {
    const splash = document.getElementById('splash-screen')
    if (splash) {
        splash.classList.add('fade-out')
        setTimeout(() => splash.remove(), 500)
    }
}

// Show error message on splash screen
const showSplashError = (message: string) => {
    const splash = document.getElementById('splash-screen')
    if (splash) {
        const errorDiv = document.createElement('div')
        errorDiv.style.cssText = 'color: #ef4444; margin-top: 20px; padding: 10px; max-width: 400px; text-align: center;'
        errorDiv.textContent = message
        splash.appendChild(errorDiv)
    }
}

// 자동 백업 실행 (localStorage에 저장 - IndexedDB와 분리)
async function performAutoBackup() {
    try {
        const lastBackupStr = localStorage.getItem('nais2-last-auto-backup')
        const lastBackup = lastBackupStr ? parseInt(lastBackupStr, 10) : 0
        const now = Date.now()
        
        // 24시간이 지나지 않았으면 스킵
        if (now - lastBackup < AUTO_BACKUP_INTERVAL) {
            console.log('[AutoBackup] Skipping - last backup was less than 24h ago')
            return
        }
        
        console.log('[AutoBackup] Starting automatic backup...')
        const backup = await exportAllData()
        
        // 기존 자동 백업들 로드
        const existingBackupsStr = localStorage.getItem(AUTO_BACKUP_KEY)
        let backups: { timestamp: number, data: unknown }[] = []
        
        if (existingBackupsStr) {
            try {
                backups = JSON.parse(existingBackupsStr)
            } catch {
                backups = []
            }
        }
        
        // 새 백업 추가
        backups.unshift({ timestamp: now, data: backup })
        
        // 최대 3개만 유지
        if (backups.length > MAX_AUTO_BACKUPS) {
            backups = backups.slice(0, MAX_AUTO_BACKUPS)
        }
        
        // 저장 (localStorage 용량 제한 체크)
        const backupStr = JSON.stringify(backups)
        if (backupStr.length > 4 * 1024 * 1024) { // 4MB 제한
            console.warn('[AutoBackup] Backup too large, keeping only latest')
            backups = backups.slice(0, 1)
        }
        
        localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify(backups))
        localStorage.setItem('nais2-last-auto-backup', now.toString())
        
        console.log(`[AutoBackup] Complete - ${backups.length} backups stored`)
    } catch (err) {
        console.error('[AutoBackup] Failed:', err)
    }
}

// 데이터 무결성 체크 및 자동 복구
async function checkDataIntegrity(): Promise<boolean> {
    try {
        // 중요 스토어들의 데이터 확인
        const criticalStores = ['nais2-character-prompts', 'nais2-scenes', 'nais2-presets']
        let hasDataLoss = false
        
        for (const storeKey of criticalStores) {
            const data = await indexedDBStorage.getItem(storeKey)
            
            if (!data) {
                console.warn(`[Integrity] ${storeKey}: No data found`)
                continue
            }
            
            try {
                const parsed = JSON.parse(data)
                const state = parsed.state
                
                // character-prompts 체크
                if (storeKey === 'nais2-character-prompts') {
                    const presetCount = state?.presets?.length || 0
                    const charCount = state?.characters?.length || 0
                    
                    // 이전 기록과 비교
                    const prevStats = localStorage.getItem('nais2-integrity-character-prompts')
                    if (prevStats) {
                        const prev = JSON.parse(prevStats)
                        // 프리셋이 갑자기 절반 이하로 줄었으면 경고
                        if (prev.presets > 10 && presetCount < prev.presets * 0.5) {
                            console.error(`[Integrity] CHARACTER PROMPTS DATA LOSS DETECTED! Previous: ${prev.presets}, Current: ${presetCount}`)
                            hasDataLoss = true
                        }
                    }
                    
                    // 현재 통계 저장
                    localStorage.setItem('nais2-integrity-character-prompts', JSON.stringify({ presets: presetCount, characters: charCount }))
                }
                
                // scenes 체크
                if (storeKey === 'nais2-scenes') {
                    const presetCount = state?.presets?.length || 0
                    const totalScenes = state?.presets?.reduce((sum: number, p: { scenes?: unknown[] }) => sum + (p.scenes?.length || 0), 0) || 0
                    
                    const prevStats = localStorage.getItem('nais2-integrity-scenes')
                    if (prevStats) {
                        const prev = JSON.parse(prevStats)
                        if (prev.scenes > 10 && totalScenes < prev.scenes * 0.5) {
                            console.error(`[Integrity] SCENE DATA LOSS DETECTED! Previous: ${prev.scenes}, Current: ${totalScenes}`)
                            hasDataLoss = true
                        }
                    }
                    
                    localStorage.setItem('nais2-integrity-scenes', JSON.stringify({ presets: presetCount, scenes: totalScenes }))
                }
            } catch (parseErr) {
                console.error(`[Integrity] ${storeKey}: Parse error`, parseErr)
            }
        }
        
        // 데이터 손실 감지 시 자동 백업에서 복구 제안
        if (hasDataLoss) {
            console.error('[Integrity] DATA LOSS DETECTED! Check auto-backups in localStorage')
            
            // 자동 백업 존재 여부 확인
            const autoBackups = localStorage.getItem(AUTO_BACKUP_KEY)
            if (autoBackups) {
                try {
                    const backups = JSON.parse(autoBackups)
                    if (backups.length > 0) {
                        const latestBackup = new Date(backups[0].timestamp).toLocaleString()
                        console.log(`[Integrity] Auto-backup available from: ${latestBackup}`)
                        // 사용자에게 복구 옵션 제공은 Settings 페이지에서 수동으로
                    }
                } catch {
                    // 무시
                }
            }
        }
        
        return !hasDataLoss
    } catch (err) {
        console.error('[Integrity] Check failed:', err)
        return true // 에러 시에는 그냥 진행
    }
}

// ---------------------------------------------------------------------------
// ComfyUI 연결 확인
//   - 시작할 때: exe에 저장된 ComfyUI 주소를 읽고, 연결 확인 + 목록(체크포인트·LoRA…)을 받는다.
//   - 꺼져 있으면 15초마다, 연결돼 있으면 60초마다 다시 확인한다.
//     (연결된 동안에는 가벼운 상태 확인만 한다. 목록(/object_info)은 커서 매번 받지 않는다)
//   - 앱 창으로 돌아오면(focus) 목록까지 다시 받는다 (그사이 모델 파일을 넣었을 수 있으므로).
const COMFY_RECHECK_OFFLINE_MS = 15_000
const COMFY_RECHECK_ONLINE_MS = 60_000
const COMFY_FOCUS_MIN_GAP_MS = 10_000

let comfyWatchStarted = false

function startComfyWatch() {
    if (comfyWatchStarted) return
    comfyWatchStarted = true

    let timer: ReturnType<typeof setTimeout> | undefined
    let running = false
    let lastFullRefresh = 0

    const schedule = () => {
        if (timer) clearTimeout(timer)
        const online = useComfyStore.getState().status === 'online'
        timer = setTimeout(() => { void check(false) }, online ? COMFY_RECHECK_ONLINE_MS : COMFY_RECHECK_OFFLINE_MS)
    }

    const fullRefresh = async () => {
        lastFullRefresh = Date.now()
        await useComfyStore.getState().refresh()
    }

    const check = async (full: boolean) => {
        const state = useComfyStore.getState()
        // 다른 곳(설정 화면의 '연결 확인' 등)에서 이미 확인 중이면 끝난 뒤로 미룬다
        if (running || state.status === 'checking') {
            schedule()
            return
        }
        running = true
        try {
            if (full || state.status !== 'online') {
                await fullRefresh()
            } else {
                const st = await pingComfy()
                // 꺼졌으면 스토어가 상태와 오류 문구를 정리하도록 다시 확인을 맡긴다
                if (!st.ok) await fullRefresh()
            }
        } catch (err) {
            console.warn('[Comfy] Status check failed:', err)
        } finally {
            running = false
            schedule()
        }
    }

    // 다른 곳에서 확인해 상태가 바뀌면 다음 확인 시각을 그 상태에 맞춘다
    useComfyStore.subscribe((s, prev) => {
        if (s.status !== prev.status && (s.status === 'online' || s.status === 'offline') && !running) schedule()
    })

    window.addEventListener('focus', () => {
        if (Date.now() - lastFullRefresh < COMFY_FOCUS_MIN_GAP_MS) return
        void check(true)
    })

    void (async () => {
        try {
            await useComfyStore.getState().loadUrl()
        } catch (err) {
            console.warn('[Comfy] Could not read the saved ComfyUI address:', err)
        }
        await check(true)
    })()
}

// Start app only after migrations complete
async function startApp() {
    console.log('[Startup] Starting app initialization...')

    // exe(launcher)와 연결 유지 (창을 닫으면 exe도 끝난다)
    connectLauncher()
    
    // CRITICAL: Ensure IndexedDB is ready before any migration
    const dbReady = await ensureDbReady()
    if (!dbReady) {
        console.error('[Startup] IndexedDB initialization failed!')
        showSplashError('데이터베이스 초기화 실패. 앱이 정상 작동하지 않을 수 있습니다.')
        // 계속 진행하되, 데이터 저장이 안될 수 있음
    }
    
    // CRITICAL: Migration must complete BEFORE React renders
    // Otherwise Zustand stores will hydrate from empty IndexedDB
    
    if (!isDbInitFailed()) {
        // Step 1: Migrate renamed keys within IndexedDB (old name → new name)
        // This handles stores that were already using IndexedDB but had their names changed
        try {
            await migrateIndexedDBKeys([
                ['nais-library-storage', 'nais2-library'],  // Library items (was already IndexedDB)
            ])
            console.log('[Startup] IndexedDB key migration complete')
        } catch (err) {
            console.error('[Startup] IndexedDB key migration failed:', err)
        }

        // Step 2: Migrate localStorage to IndexedDB for ALL stores
        // Missing entries here will cause data loss on app restart/update!
        try {
            await migrateFromLocalStorage([
                'nais2-generation',        // Main mode prompts & settings (CRITICAL!)
                'nais2-character-prompts', // Character prompt presets (CRITICAL - 100+ presets)
                'nais2-presets',           // Generation presets
                'nais2-settings',          // App settings
                'nais2-scenes',            // Scene mode data (CRITICAL)
                'nais2-shortcuts',         // Keyboard shortcuts
                'nais2-theme',             // Theme settings
                'nais2-wildcards',         // Wildcard/Fragment data
                'nais2-layout',            // Layout preferences
                'nais2-library',           // Library items
                // (NAI 로그인·캐릭터 참조·스마트 툴·업데이트 저장소는 기능과 함께 없어졌다.
                //  'nais2-comfy'는 localStorage에 그대로 두는 저장소라 여기에 넣지 않는다)
            ])
            console.log('[Startup] LocalStorage migration complete')
        } catch (err) {
            console.error('[Startup] LocalStorage migration failed:', err)
        }
        
        // Step 3: 데이터 무결성 체크
        await checkDataIntegrity()

        // Step 4: 자동 백업 (비동기로 실행)
        performAutoBackup().catch(err => {
            console.warn('[Startup] Auto-backup failed:', err)
        })

        // Cleanup large wildcard data (non-critical, can be async)
        cleanupLargeData('nais2-wildcards', 100).then((cleaned) => {
            if (cleaned) {
                console.log('[Startup] Large wildcard data was cleaned up')
            }
        }).catch(err => {
            console.warn('[Startup] Wildcard cleanup failed:', err)
        })
    } else {
        console.warn('[Startup] Skipping migrations due to DB init failure')
    }
    
    console.log('[Startup] Initialization complete, rendering React app...')

    // NOW render React app
    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    )

    // ComfyUI 연결 확인 (처음 한 번 + 주기적으로)
    startComfyWatch()

    // Delay slightly to ensure app renders, then hide splash
    requestAnimationFrame(() => {
        requestAnimationFrame(hideSplash)
    })
}

// Start the app - DO NOT add any code after this that runs in parallel!
startApp().catch(err => {
    console.error('[Startup] Fatal error:', err)
    showSplashError(`시작 오류: ${err.message || '알 수 없는 오류'}`)
})
