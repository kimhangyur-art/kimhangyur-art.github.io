// 씬 모드 예약(대기열)을 ComfyUI로 차례차례 그린다.
// App.tsx 에서 한 번만 붙인다. 씬 화면을 나가도 계속 돈다.
//
//   1. 씬 하나를 예약에서 빼고, 지금 화면의 프롬프트(기본 + 추가 + 씬 + 세부)로 생성 요청을 만든다 (lib/comfy-params)
//   2. ComfyUI /prompt 에 작업을 하나 보내고 WebSocket으로 진행률·미리보기를 받는다 (services/comfyui-api)
//   3. 결과를 NAIS_Scene/<프리셋>/<씬>/ 에 저장하고 씬 카드에 붙인다 (lib/output-save)
//
// 취소하면 지금 그리던 ComfyUI 작업도 바로 멈추고, 그 장의 예약은 되돌려 둔다 (다시 누르면 이어서 그린다).
// ComfyUI가 꺼져 있으면 예약을 남겨 둔 채 멈추고 고치는 방법을 알려 준다.
import { useEffect } from 'react'
import i18n from '@/i18n'
import { toast } from '@/components/ui/use-toast'
import { useSceneStore, type SceneCard } from '@/stores/scene-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useComfyStore } from '@/stores/comfy-store'
import { buildGenerationParams } from '@/lib/comfy-params'
import { saveOutputImage, bytesToBase64 } from '@/lib/output-save'
import { createThumbnail } from '@/lib/image-utils'
import { generateImage, type GenerateResult } from '@/services/comfyui-api'
import { interruptPrompt, pingComfy } from '@/services/comfy/client'

/** 연속으로 이만큼 실패하면 같은 오류가 반복되는 것으로 보고 멈춘다 */
const MAX_FAILS_IN_A_ROW = 3

// ---------------------------------------------------------------------------
// 모듈 하나에 하나만: 훅이 여러 번 붙어도 대기열은 한 줄로만 돈다

let runnerActive = false
let sessionAbort: AbortController | null = null

// 누가 cancelSceneGeneration() 을 부르든 (생성 버튼, 단축키 등) 지금 ComfyUI 작업을 바로 멈춘다.
// 도는 중에 다른 곳에서 setIsGenerating(false) 로 꺼도 마찬가지로 멈춘다.
useSceneStore.subscribe((state, prev) => {
    const cancelled = state.isCancelling && !prev.isCancelling
    const switchedOff = runnerActive && prev.isGenerating && !state.isGenerating
    if (cancelled || switchedOff) sessionAbort?.abort()
})

function tr(key: string, defaultValue: string, vars?: Record<string, unknown>): string {
    return String(i18n.t(key, { defaultValue, ...vars }))
}

function randomSeed(): number {
    return Math.floor(Math.random() * 4294967295)
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) return resolve()
        const timer = setTimeout(done, ms)
        function done() {
            clearTimeout(timer)
            signal.removeEventListener('abort', done)
            resolve()
        }
        signal.addEventListener('abort', done)
    })
}

type SceneOutcome =
    | { kind: 'ok' }
    | { kind: 'cancelled' }
    | { kind: 'offline' }
    | { kind: 'failed'; error: string }

type StopReason = 'done' | 'cancelled' | 'offline' | 'streak' | 'error' | 'conflict' | 'noCheckpoint' | 'noPreset'

interface RunSummary {
    reason: StopReason
    /** 마지막으로 따른 세션 (생성 중에 다시 시작하면 바뀐다) */
    sessionId: number
    ok: number
    failed: number
    lastError?: string
    conflictWith?: 'main' | 'variation'
}

/** 실패했을 때 ComfyUI가 아예 꺼진 것인지 확인한다 */
async function failureOutcome(error: string | undefined): Promise<SceneOutcome> {
    let reachable = false
    try {
        reachable = (await pingComfy()).ok
    } catch {
        reachable = false
    }
    if (!reachable) return { kind: 'offline' }
    return { kind: 'failed', error: error || tr('toast.unknownError', '알 수 없는 오류가 발생했습니다.') }
}

/** 결과를 씬 폴더에 저장하고 씬 카드·기록에 넣는다 */
async function keepSceneImage(presetId: string, scene: SceneCard, result: GenerateResult, prompt: string): Promise<void> {
    const st = useSceneStore.getState()
    const preset = st.presets.find(p => p.id === presetId)
    // 생성 중에 씬 이름을 바꿨을 수 있으니 지금 이름으로 저장한다
    const sceneName = preset?.scenes.find(s => s.id === scene.id)?.name ?? scene.name
    const image = result.bytes ?? result.imageData ?? ''
    const saved = await saveOutputImage(image, { kind: 'scene', presetName: preset?.name, sceneName })

    if (saved.saved) {
        useSceneStore.getState().addImageToScene(presetId, scene.id, saved.path)
    } else {
        toast({
            title: tr('comfy.scene.saveFailed', '그림을 씬 폴더에 저장하지 못했습니다'),
            description: tr('comfy.scene.saveFailedDesc', '대신 브라우저 다운로드로 받았습니다. 설정에서 저장 위치를 확인하세요. ({{error}})', { error: saved.error ?? '' }),
            variant: 'destructive',
        })
    }

    const b64 = result.imageData ?? (result.bytes ? bytesToBase64(result.bytes) : '')
    const thumbnail = b64 ? await createThumbnail(`data:image/png;base64,${b64}`) : undefined
    useGenerationStore.getState().addToHistory({
        id: `${Date.now()}-${scene.id}`,
        url: saved.path,
        thumbnail,
        prompt,
        seed: result.seed,
        timestamp: new Date(),
    })
}

/** 씬 한 장 그리기 */
async function generateScene(presetId: string, scene: SceneCard, signal: AbortSignal): Promise<SceneOutcome> {
    useSceneStore.getState().setStreamingData(scene.id, null, 0)
    try {
        // 시드: 메인 화면에서 시드를 고정했으면 그 값, 아니면 장마다 무작위
        const g = useGenerationStore.getState()
        let seed = g.seedLocked ? g.seed : randomSeed()
        if (!seed) seed = randomSeed()

        // 조각(와일드카드)은 장마다 새로 뽑는다. 씬 해상도가 없으면 메인 화면 해상도
        const params = await buildGenerationParams({
            scenePrompt: scene.scenePrompt,
            width: scene.width || undefined,
            height: scene.height || undefined,
            seed,
        })
        if (signal.aborted) return { kind: 'cancelled' }

        const showPreview = useSettingsStore.getState().useStreaming
        const result = await generateImage(params, {
            signal,
            onQueued: (promptId) => {
                useGenerationStore.getState().setCurrentPromptId(promptId)
                // 작업을 보내는 사이에 취소했으면 여기서 멈춘다
                if (signal.aborted) void interruptPrompt(promptId)
            },
            onProgress: (pct, preview) => {
                if (signal.aborted) return
                useSceneStore.getState().setStreamingData(scene.id, showPreview ? preview ?? null : null, pct / 100)
            },
        })

        // 취소를 누른 순간 마침 다 그렸으면 버리지 않고 저장한다
        if (result.success && (result.bytes || result.imageData)) {
            await keepSceneImage(presetId, scene, result, params.prompt)
            return { kind: 'ok' }
        }
        if (result.interrupted || signal.aborted) return { kind: 'cancelled' }
        return await failureOutcome(result.error)
    } catch (e) {
        if (signal.aborted) return { kind: 'cancelled' }
        console.error('[SceneGeneration] failed:', e)
        return await failureOutcome((e as Error)?.message ?? String(e))
    } finally {
        useSceneStore.getState().setStreamingData(null, null, 0)
        useGenerationStore.getState().setCurrentPromptId(null)
    }
}

/** 그리지 못한 장의 예약을 되돌린다 */
function restoreQueue(presetId: string, sceneId: string) {
    useSceneStore.getState().incrementQueue(presetId, sceneId, 1)
}

async function processQueue(startSession: number, abort: AbortController): Promise<RunSummary> {
    const sum: RunSummary = { reason: 'done', sessionId: startSession, ok: 0, failed: 0 }

    // 한 번에 한 모드만 ComfyUI에 일을 보낸다
    const busy = useGenerationStore.getState().generatingMode
    if (busy === 'main' || busy === 'variation') return { ...sum, reason: 'conflict', conflictWith: busy }

    const startPresetId = useSceneStore.getState().activePresetId
    if (!startPresetId) return { ...sum, reason: 'noPreset' }
    let presetId: string = startPresetId
    if (!useGenerationStore.getState().model) return { ...sum, reason: 'noCheckpoint' }

    useGenerationStore.getState().setGeneratingMode('scene')
    let processed = 0
    useSceneStore.getState().setGenerationProgress(0, useSceneStore.getState().getTotalQueueCount(presetId))

    // 시작하기 전에 ComfyUI가 켜져 있는지 본다 (꺼져 있으면 예약을 하나도 쓰지 않고 멈춘다)
    let reachable = false
    try {
        reachable = (await pingComfy()).ok
    } catch {
        reachable = false
    }
    if (!reachable) return { ...sum, reason: 'offline' }

    const failStreak: string[] = []
    for (;;) {
        const st = useSceneStore.getState()
        if (abort.signal.aborted || st.isCancelling || !st.isGenerating) return { ...sum, reason: 'cancelled' }
        if (st.generationSessionId !== sum.sessionId) {
            // 생성 중에 다시 시작했다: 같은 줄에서 이어서 그린다
            sum.sessionId = st.generationSessionId
            presetId = st.activePresetId ?? presetId
        }

        const scene = st.decrementFirstQueuedScene(presetId)
        if (!scene) return sum

        // 진행 표시 (생성 중에 예약을 더해도 맞게 남은 수로 다시 센다)
        useSceneStore.getState().setGenerationProgress(processed, processed + 1 + useSceneStore.getState().getTotalQueueCount(presetId))

        const outcome = await generateScene(presetId, scene, abort.signal)
        if (outcome.kind === 'cancelled') {
            restoreQueue(presetId, scene.id)
            return { ...sum, reason: 'cancelled' }
        }
        if (outcome.kind === 'offline') {
            restoreQueue(presetId, scene.id)
            return { ...sum, reason: 'offline' }
        }
        if (outcome.kind === 'ok') {
            sum.ok++
            failStreak.length = 0
        } else {
            sum.failed++
            sum.lastError = outcome.error
            failStreak.push(scene.id)
            if (failStreak.length >= MAX_FAILS_IN_A_ROW) {
                // 같은 문제로 계속 실패하는 것: 예약을 되돌려 두고 멈춘다
                failStreak.forEach(id => restoreQueue(presetId, id))
                return { ...sum, reason: 'streak' }
            }
            // 한 장 실패는 알리고 다음 씬으로 넘어간다
            toast({
                title: tr('comfy.scene.failedOne', '"{{name}}" 씬을 그리지 못했습니다', { name: scene.name }),
                description: tr('comfy.scene.failedOneDesc', '{{error}} · 다음 씬으로 넘어갑니다.', { error: outcome.error }),
                variant: 'destructive',
            })
        }

        processed++
        const remaining = useSceneStore.getState().getTotalQueueCount(presetId)
        useSceneStore.getState().setGenerationProgress(processed, processed + remaining)

        // 설정의 '생성 간격'만큼 쉰다 (남은 씬이 있을 때만, 취소하면 바로 끝난다)
        const { generationDelay } = useSettingsStore.getState()
        if (generationDelay > 0 && remaining > 0) await sleep(generationDelay, abort.signal)
    }
}

/** 끝났을 때 상태를 바로 정리한다 (효과가 다시 돌기를 기다리지 않는다: 취소 중에 멈춰 있던 문제) */
function finishRun(sum: RunSummary) {
    const st = useSceneStore.getState()
    st.setStreamingData(null, null, 0)
    st.setGenerationProgress(0, 0)
    st.setIsGenerating(false) // isCancelling 도 같이 풀린다
    const gen = useGenerationStore.getState()
    if (gen.generatingMode === 'scene') {
        gen.setGeneratingMode(null)
        gen.setCurrentPromptId(null)
    }

    const leftover = tr('comfy.scene.queueKept', '남은 예약은 그대로 있어서, 다시 누르면 이어서 그립니다.')
    switch (sum.reason) {
        case 'done':
            if (sum.ok === 0 && sum.failed === 0) break
            toast({
                title: tr('comfy.scene.doneTitle', '씬 생성 완료'),
                description: sum.failed > 0
                    ? tr('comfy.scene.doneDescWithFail', '{{ok}}장을 그렸고 {{failed}}장은 실패했습니다.', { ok: sum.ok, failed: sum.failed })
                    : tr('comfy.scene.doneDesc', '예약한 {{ok}}장을 모두 그렸습니다.', { ok: sum.ok }),
                variant: sum.failed > 0 ? 'default' : 'success',
            })
            break
        case 'cancelled':
            toast({
                title: tr('comfy.scene.cancelledTitle', '씬 생성을 멈췄습니다'),
                description: `${tr('comfy.scene.cancelledDesc', '그리던 그림은 ComfyUI에서 바로 멈췄습니다.')} ${leftover}`,
            })
            break
        case 'offline': {
            const url = useComfyStore.getState().url
            void useComfyStore.getState().refresh() // 연결 상태 표시도 '꺼짐'으로 바꾼다
            toast({
                title: tr('comfy.scene.offlineTitle', 'ComfyUI에 연결할 수 없어 씬 생성을 멈췄습니다'),
                description: `${tr('comfy.scene.offlineDesc', 'ComfyUI를 먼저 켜 주세요. 이미 켜져 있다면 설정 → ComfyUI에서 주소({{url}})가 맞는지 확인하세요.', { url })} ${leftover}`,
                variant: 'destructive',
            })
            break
        }
        case 'streak':
            toast({
                title: tr('comfy.scene.streakTitle', '연속으로 {{count}}장을 그리지 못해 씬 생성을 멈췄습니다', { count: MAX_FAILS_IN_A_ROW }),
                description: `${sum.lastError ?? ''} ${leftover}`.trim(),
                variant: 'destructive',
            })
            break
        case 'error':
            toast({
                title: tr('comfy.scene.errorTitle', '씬 생성 중 문제가 생겨 멈췄습니다'),
                description: `${sum.lastError ?? ''} ${leftover}`.trim(),
                variant: 'destructive',
            })
            break
        case 'conflict':
            toast({
                title: tr('common.error', '오류'),
                description: sum.conflictWith === 'variation'
                    ? tr('comfy.generate.busyVariation', '변형 모드에서 생성 중입니다. 끝나거나 취소한 뒤에 누르세요.')
                    : tr('comfy.generate.busyMain', '메인 화면에서 생성 중입니다. 끝나거나 취소한 뒤에 누르세요.'),
                variant: 'destructive',
            })
            break
        case 'noCheckpoint':
            toast({
                title: tr('comfy.noCheckpointTitle', '체크포인트를 고르세요'),
                description: tr('comfy.noCheckpointDesc', '프롬프트 아래 생성 설정(톱니바퀴)에서 ComfyUI 체크포인트를 고르세요.'),
                variant: 'destructive',
            })
            break
        case 'noPreset':
            break
    }
}

/** 씬 대기열을 돌린다. 이미 돌고 있으면 아무것도 하지 않는다 (돌고 있는 줄이 새 예약도 집어 간다). */
export async function runSceneQueue(sessionId: number): Promise<void> {
    if (runnerActive) return
    runnerActive = true
    const abort = new AbortController()
    sessionAbort = abort

    let sum: RunSummary
    try {
        sum = await processQueue(sessionId, abort)
    } catch (e) {
        // 예상 못 한 오류도 멈춘 채로 남지 않게 정리한다
        console.error('[SceneGeneration] queue error:', e)
        sum = { reason: 'error', sessionId, ok: 0, failed: 0, lastError: (e as Error)?.message ?? String(e) }
    }

    runnerActive = false
    if (sessionAbort === abort) sessionAbort = null

    // 마무리하는 사이에 새로 시작했으면 정리하지 않고 이어서 돈다
    const st = useSceneStore.getState()
    if (st.isGenerating && !st.isCancelling && st.generationSessionId !== sum.sessionId && sum.reason !== 'conflict') {
        void runSceneQueue(st.generationSessionId)
        return
    }
    finishRun(sum)
}

/** 씬 대기열이 지금 돌고 있는지 */
export function isSceneQueueRunning(): boolean {
    return runnerActive
}

/**
 * App.tsx 에서 한 번 붙인다. 씬 저장소의 isGenerating 이 켜지면 대기열을 돌린다.
 * (예전처럼 여러 곳에 붙어도 대기열은 하나만 돈다)
 */
export function useSceneGeneration() {
    const isGenerating = useSceneStore(s => s.isGenerating)
    const isCancelling = useSceneStore(s => s.isCancelling)
    const generationSessionId = useSceneStore(s => s.generationSessionId)

    useEffect(() => {
        if (!isGenerating) return
        if (isCancelling) {
            // 돌고 있는 작업이 없는데 '취소 중'에 걸려 있으면 바로 푼다
            if (!runnerActive) {
                useSceneStore.getState().setIsGenerating(false)
                const gen = useGenerationStore.getState()
                if (gen.generatingMode === 'scene') gen.setGeneratingMode(null)
            }
            return
        }
        void runSceneQueue(generationSessionId)
    }, [isGenerating, isCancelling, generationSessionId])

    return { isGenerating }
}
