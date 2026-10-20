import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useState, useEffect, useCallback, memo } from 'react'
import { Button } from '@/components/ui/button'
import { ResolutionSelector, Resolution } from '@/components/ui/ResolutionSelector'
import {
    ChevronLeft,
    Check,
    Play,
    Image as ImageIcon,
    FolderOpen,
    Minus,
    Plus,
    X,
    Pencil,
    Star,
    Trash2,
    CheckSquare,
    Square,
    Maximize2,
    Loader2,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { AutocompleteTextarea } from "@/components/ui/AutocompleteTextarea";
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import i18n from '@/i18n'
import { useSceneStore, SceneImage, isUpscaledSceneImage } from '@/stores/scene-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useGenerationStore } from '@/stores/generation-store'
import { Command } from '@tauri-apps/plugin-shell'
import { MetadataDialog } from '@/components/metadata/MetadataDialog'
import { SceneImageContextMenu } from '@/components/scene/SceneImageContextMenu'
import { dirname } from '@tauri-apps/api/path'
import { convertFileSrc } from '@tauri-apps/api/core'
import { exists, readFile, remove } from '@tauri-apps/plugin-fs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/components/ui/use-toast'
import { ToastAction } from '@/components/ui/toast'
import { upscaleExisting, type UpscaleOutcome } from '@/lib/comfy-params'
import { bytesToBase64, sceneFolder } from '@/lib/output-save'
import { pingComfy } from '@/services/comfy/client'

// ---------------------------------------------------------------------------
// 고화질로 다시 그리기 (씬 그림)
// 시드를 몰라도 그림 자체에서 시작해 크게 다시 그린다 (lib/comfy-params 의 upscaleExisting).
// 결과는 같은 씬 폴더에 새 파일로 저장되고, 고화질 그림이 즐겨찾기를 이어받는다
// (원본은 즐겨찾기만 풀리고 그대로 남는다) → ZIP 내보내기가 고화질 그림을 고른다.
// 화면을 나갔다 와도 계속 돌고 진행 상황이 보이도록 상태는 씬 저장소, 멈춤 신호는 이 모듈에 둔다.

interface SceneRef {
    presetId: string
    sceneId: string
}

/** '즐겨찾기 고화질로' 묶음 작업을 멈추는 신호 */
let hqBatchAbort: AbortController | null = null

/** 진행 알림을 작업이 끝날 때까지 띄워 둔다 (기본은 5초 뒤 닫힘) */
const KEEP_TOAST_OPEN = { duration: 24 * 60 * 60 * 1000 }

function tr(key: string, defaultValue: string, vars?: Record<string, unknown>): string {
    return String(i18n.t(key, { defaultValue, ...vars }))
}

function findScene(ref: SceneRef) {
    const preset = useSceneStore.getState().presets.find(p => p.id === ref.presetId)
    return { preset, scene: preset?.scenes.find(s => s.id === ref.sceneId) }
}

function imageSource(image: SceneImage): { path?: string; dataUrl?: string } {
    return image.url.startsWith('data:') ? { dataUrl: image.url } : { path: image.url }
}

async function imageDataUrl(image: SceneImage): Promise<string> {
    if (image.url.startsWith('data:')) return image.url
    const data = await readFile(image.url)
    return `data:image/png;base64,${bytesToBase64(data)}`
}

/** 그림 한 장을 고화질로 다시 그려 씬에 넣는다 */
async function upscaleSceneImage(ref: SceneRef, image: SceneImage, signal?: AbortSignal): Promise<UpscaleOutcome> {
    const store = useSceneStore.getState()
    store.setUpscaleProgress(image.id, 0)
    try {
        const { preset, scene } = findScene(ref)
        const r = await upscaleExisting(
            { ...imageSource(image), sceneContext: { presetName: preset?.name ?? '', sceneName: scene?.name ?? '' } },
            { signal, onProgress: (p) => useSceneStore.getState().setUpscaleProgress(image.id, p) },
        )
        if (r.success && r.saved?.saved) {
            useSceneStore.getState().addUpscaledImage(ref.presetId, ref.sceneId, image.id, r.saved.path)
        } else if (r.success && r.saved && !r.saved.saved) {
            // 파일로 못 써서 내려받기로 대신한 경우: 씬에는 넣지 못한다
            return { ...r, success: false, error: tr('comfy.scene.upscaleNotSaved', '씬 폴더에 저장하지 못해 브라우저 다운로드로 받았습니다. ({{error}})', { error: r.saved.error ?? '' }) }
        }
        return r
    } finally {
        useSceneStore.getState().setUpscaleProgress(image.id, null)
    }
}

function upscaleSettingsText(): string {
    const { upscaleScale, upscaleDenoise } = useSettingsStore.getState()
    return tr('comfy.scene.upscaleSettings', '{{scale}}배, 다듬기 강도 {{denoise}}', { scale: upscaleScale, denoise: upscaleDenoise })
}

/** 오른쪽 클릭 메뉴의 '고화질로 다시 그리기' */
async function upscaleOne(ref: SceneRef, image: SceneImage) {
    if (useSceneStore.getState().upscaleProgress[image.id] !== undefined) return
    toast({
        title: tr('comfy.upscale.startTitle', '고화질로 다시 그리는 중…'),
        description: tr('comfy.scene.upscaleStartDesc', '{{settings}} · 다 되면 이 씬에 새 그림으로 들어가고, 원본은 그대로 남습니다.', { settings: upscaleSettingsText() }),
    })
    try {
        const r = await upscaleSceneImage(ref, image)
        if (r.success) {
            toast({
                title: tr('comfy.scene.upscaleDoneTitle', '고화질로 다시 그렸습니다'),
                description: tr('comfy.scene.upscaleDoneDesc', '고화질 그림이 즐겨찾기를 이어받았습니다. ZIP으로 내보내면 이 그림이 들어갑니다. (원본은 즐겨찾기만 풀리고 그대로 있습니다)'),
                variant: 'success',
            })
        } else if (r.interrupted) {
            toast({ title: tr('comfy.upscale.stopped', '고화질로 다시 그리기를 멈췄습니다') })
        } else {
            toast({ title: tr('comfy.upscale.failed', '고화질로 다시 그리지 못했습니다'), description: r.error, variant: 'destructive' })
        }
    } catch (e) {
        console.error('Scene upscale failed:', e)
        toast({ title: tr('comfy.upscale.failed', '고화질로 다시 그리지 못했습니다'), description: (e as Error)?.message, variant: 'destructive' })
    }
}

/** 아직 고화질이 아닌 즐겨찾기 그림 */
function favoritesToUpscale(images: SceneImage[]): SceneImage[] {
    return images.filter(img => img.isFavorite && !isUpscaledSceneImage(img))
}

/** 툴바의 '즐겨찾기 고화질로': 즐겨찾기를 하나씩 차례로 고화질로 다시 그린다 */
async function upscaleFavorites(ref: SceneRef) {
    if (useSceneStore.getState().hqBatch) return
    const targets = favoritesToUpscale(findScene(ref).scene?.images ?? [])
    if (targets.length === 0) return

    const abort = new AbortController()
    hqBatchAbort = abort
    const total = targets.length
    const store = useSceneStore.getState()
    store.setHqBatch({ ...ref, done: 0, total })

    const stopAction = (
        <ToastAction altText={tr('comfy.scene.hqBatchStopAlt', '고화질 작업 멈추기')} onClick={() => abort.abort()}>
            {tr('comfy.scene.stop', '멈추기')}
        </ToastAction>
    )
    const progressBody = (done: number, pct: number) => ({
        ...KEEP_TOAST_OPEN,
        title: tr('comfy.scene.hqBatchRunning', '즐겨찾기를 고화질로 다시 그리는 중 ({{done}}/{{total}})', { done: Math.min(done + 1, total), total }),
        description: `${tr('comfy.scene.hqBatchRunningDesc', '하나씩 차례로 그립니다 ({{settings}}). 다 되면 고화질 그림이 즐겨찾기를 이어받습니다.', { settings: upscaleSettingsText() })}${pct > 0 ? ` · ${pct}%` : ''}`,
        action: stopAction,
    })
    const progressToast = toast(progressBody(0, 0))

    let ok = 0
    let failed = 0
    let lastError = ''
    let stopped = false
    let offline = false
    try {
        for (let i = 0; i < targets.length; i++) {
            if (abort.signal.aborted) {
                stopped = true
                break
            }
            // 그 사이에 지웠거나 즐겨찾기를 풀었으면 건너뛴다
            const current = findScene(ref).scene?.images.find(img => img.id === targets[i].id)
            if (current && current.isFavorite) {
                let lastPct = -1
                const unwatch = useSceneStore.subscribe((s) => {
                    const pct = s.upscaleProgress[current.id]
                    if (pct === undefined || pct - lastPct < 5) return
                    lastPct = pct
                    progressToast.update({ id: progressToast.id, ...progressBody(i, pct) })
                })
                try {
                    const r = await upscaleSceneImage(ref, current, abort.signal)
                    if (r.success) {
                        ok++
                    } else if (r.interrupted || abort.signal.aborted) {
                        stopped = true
                        break
                    } else {
                        failed++
                        lastError = r.error ?? ''
                        // ComfyUI가 꺼졌으면 나머지도 안 되므로 멈춘다
                        const ping = await pingComfy().catch(() => ({ ok: false }))
                        if (!ping.ok) {
                            offline = true
                            break
                        }
                    }
                } finally {
                    unwatch()
                }
            }
            useSceneStore.getState().setHqBatch({ ...ref, done: i + 1, total })
            if (i + 1 < total) progressToast.update({ id: progressToast.id, ...progressBody(i + 1, 0) })
        }
    } catch (e) {
        failed++
        lastError = (e as Error)?.message ?? String(e)
    } finally {
        hqBatchAbort = null
        useSceneStore.getState().setHqBatch(null)
        progressToast.dismiss()
    }

    if (offline) {
        toast({
            title: tr('comfy.scene.hqBatchOffline', 'ComfyUI에 연결할 수 없어 고화질 작업을 멈췄습니다'),
            description: tr('comfy.scene.hqBatchOfflineDesc', 'ComfyUI를 켜거나 설정 → ComfyUI에서 주소를 확인한 뒤 다시 누르세요. 이미 끝난 {{ok}}장은 그대로 있습니다.', { ok }),
            variant: 'destructive',
        })
    } else if (stopped) {
        toast({
            title: tr('comfy.upscale.stopped', '고화질로 다시 그리기를 멈췄습니다'),
            description: tr('comfy.scene.hqBatchStoppedDesc', '{{ok}}장은 고화질로 바뀌었습니다. 다시 누르면 남은 즐겨찾기만 이어서 그립니다.', { ok }),
        })
    } else {
        toast({
            title: tr('comfy.scene.hqBatchDoneTitle', '즐겨찾기 {{ok}}장을 고화질로 다시 그렸습니다', { ok }),
            description: failed > 0
                ? tr('comfy.scene.hqBatchDoneFail', '{{failed}}장은 실패했습니다: {{error}}', { failed, error: lastError })
                : tr('comfy.scene.upscaleDoneDescMany', '고화질 그림이 즐겨찾기를 이어받았습니다. ZIP으로 내보내면 고화질 그림이 들어갑니다.'),
            variant: failed > 0 ? 'destructive' : 'success',
        })
    }
}

export default function SceneDetail() {
    const { id: sceneId } = useParams()
    const { t } = useTranslation()
    const activePresetId = useSceneStore(state => state.activePresetId)

    // Use reactive selector for scene - this ensures component re-renders when scene.images changes
    const scene = useSceneStore(state => {
        const preset = state.presets.find(p => p.id === state.activePresetId)
        return preset?.scenes.find(s => s.id === sceneId)
    })

    // 동작은 하나씩 골라 구독한다 (저장소 전체를 구독하면 진행률이 바뀔 때마다 화면 전체를 다시 그린다)
    const renameScene = useSceneStore(s => s.renameScene)
    const deleteImage = useSceneStore(s => s.deleteImage)
    const deleteNonFavoriteImages = useSceneStore(s => s.deleteNonFavoriteImages)
    const incrementQueue = useSceneStore(s => s.incrementQueue)
    const decrementQueue = useSceneStore(s => s.decrementQueue)
    const validateSceneImages = useSceneStore(s => s.validateSceneImages)
    const updateSceneSettings = useSceneStore(s => s.updateSceneSettings)
    // 씬 생성 대기열은 App.tsx 의 useSceneGeneration() 하나가 돌린다
    const promptFontSize = useSettingsStore(s => s.promptFontSize)
    const globalResolution = useGenerationStore(s => s.selectedResolution)
    const upscaleProgress = useSceneStore(s => s.upscaleProgress)
    const hqBatch = useSceneStore(s => s.hqBatch)

    // --- Resolution Logic ---
    // 씬 해상도를 정하지 않았으면 메인 화면 해상도로 그린다 (그 값을 보여 준다)
    const currentWidth = scene?.width || globalResolution.width
    const currentHeight = scene?.height || globalResolution.height

    // Handler for ResolutionSelector
    const handleResolutionChange = (resolution: Resolution) => {
        if (activePresetId && sceneId) {
            updateSceneSettings(activePresetId, sceneId, { width: resolution.width, height: resolution.height })
        }
    }

    // Current resolution value for ResolutionSelector
    const currentResolution: Resolution = {
        label: `${currentWidth} × ${currentHeight}`,
        width: currentWidth,
        height: currentHeight
    }

    const [editName, setEditName] = useState(scene?.name || '')
    // Dialog states
    const [metadataDialogOpen, setMetadataDialogOpen] = useState(false)
    const [selectedImageForMetadata, setSelectedImageForMetadata] = useState<string | undefined>()
    const [isEditingName, setIsEditingName] = useState(false)
    const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
    const [viewerImageSrc, setViewerImageSrc] = useState<string | null>(null)
    const [viewerImage, setViewerImage] = useState<SceneImage | null>(null)  // Current image object for context menu
    const streamingSceneId = useSceneStore(s => s.streamingSceneId)
    const streamingImage = useSceneStore(s => s.streamingSceneId === sceneId ? s.streamingImage : null)
    const streamingProgress = useSceneStore(s => s.streamingSceneId === sceneId ? s.streamingProgress : 0)
    const thumbnailLayout = useSceneStore(s => s.thumbnailLayout)

    // Edit mode state
    const [isEditMode, setIsEditMode] = useState(false)
    const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set())

    // Auto-save prompt logic - hooks must be before conditional return
    const updateScenePrompt = useSceneStore(state => state.updateScenePrompt)
    const [localPrompt, setLocalPrompt] = useState(scene?.scenePrompt || '')
    const updateSceneNegative = useSceneStore(state => state.updateSceneNegative)
    const [localNegative, setLocalNegative] = useState(scene?.sceneNegative || '')

    const nav = useNavigate()

    // ESC key handler for closing viewer or navigating back
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || e.defaultPrevented) return
            // 창(메타데이터)이 열려 있거나 글을 고치는 중이면 그쪽만 닫는다
            if (metadataDialogOpen) return
            const tag = (e.target as HTMLElement | null)?.tagName
            if (tag === 'INPUT' || tag === 'TEXTAREA') return
            if (viewerImageSrc) {
                setViewerImageSrc(null)
                setViewerImage(null)
            } else {
                // Navigate back to scene list
                nav('/scenes')
            }
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [viewerImageSrc, metadataDialogOpen, nav])

    // Memory cleanup on unmount - release streaming data when leaving scene detail
    // This prevents OOM when switching between modes (Issue #6)
    useEffect(() => {
        return () => {
            useSceneStore.getState().clearRuntimeData()
        }
    }, [])

    useEffect(() => {
        if (scene) {
            setEditName(scene.name)
        }
    }, [scene?.name])

    // Sync local prompt when scene ID changes
    useEffect(() => {
        if (scene) {
            setLocalPrompt(scene.scenePrompt)
            setLocalNegative(scene.sceneNegative || '')
        }
    }, [scene?.id])

    // 씬 부정 프롬프트: 잠깐 멈추면 저장, 화면을 떠날 때도 저장
    useEffect(() => {
        if (!scene || !activePresetId) return
        if (localNegative === (scene.sceneNegative || '')) return
        const timer = setTimeout(() => updateSceneNegative(activePresetId, scene.id, localNegative), 800)
        return () => {
            clearTimeout(timer)
            const current = useSceneStore.getState().presets.find(p => p.id === activePresetId)?.scenes.find(s => s.id === scene.id)
            if (current && localNegative !== (current.sceneNegative || '')) updateSceneNegative(activePresetId, scene.id, localNegative)
        }
    }, [localNegative, scene, activePresetId, updateSceneNegative])

    // Debounced save of prompt to store + save on unmount
    useEffect(() => {
        if (!scene || !activePresetId) return
        if (localPrompt === scene.scenePrompt) return

        const timer = setTimeout(() => {
            updateScenePrompt(activePresetId, scene.id, localPrompt)
        }, 1000)

        return () => {
            clearTimeout(timer)
            // Save immediately on unmount if changed
            const currentScene = useSceneStore.getState().presets
                .find(p => p.id === activePresetId)?.scenes
                .find(s => s.id === scene.id)
            if (currentScene && localPrompt !== currentScene.scenePrompt) {
                updateScenePrompt(activePresetId, scene.id, localPrompt)
            }
        }
    }, [localPrompt, scene, activePresetId, updateScenePrompt])

    // Auto-validate images on mount - MUST be before conditional return to maintain hook order
    useEffect(() => {
        if (!scene || !activePresetId || !validateSceneImages) return

        const validateImages = async () => {
            if (scene.images.length === 0) return

            const validImageIds: string[] = []
            let hasChanges = false

            for (const img of scene.images) {
                try {
                    // Check if url is a file path
                    if (!img.url.startsWith('data:')) {
                        if (await exists(img.url)) {
                            validImageIds.push(img.id)
                        } else {
                            hasChanges = true
                        }
                    } else {
                        // Keep base64 images
                        validImageIds.push(img.id)
                    }
                } catch {
                    // If check fails, assume valid to be safe
                    validImageIds.push(img.id)
                }
            }

            // Only update if changes needed
            if (hasChanges && validImageIds.length !== scene.images.length) {
                validateSceneImages(activePresetId, scene.id, validImageIds)
            }
        }

        validateImages()
    }, [scene?.id, activePresetId, validateSceneImages])

    // 그림 카드에 넘기는 동작 (바뀌지 않게 해서 카드가 필요할 때만 다시 그려지게)
    const toggleSelect = useCallback((imageId: string) => {
        setSelectedImageIds(prev => {
            const next = new Set(prev)
            if (next.has(imageId)) next.delete(imageId)
            else next.add(imageId)
            return next
        })
    }, [])

    const openViewer = useCallback((image: SceneImage, src: string) => {
        setViewerImageSrc(src)
        setViewerImage(image)
    }, [])

    const openMetadata = useCallback(async (image: SceneImage) => {
        try {
            setSelectedImageForMetadata(await imageDataUrl(image))
            setMetadataDialogOpen(true)
        } catch (e) {
            console.error("Failed to load metadata image", e)
        }
    }, [])

    const handleBack = () => {
        // Save prompt immediately before leaving
        if (scene && activePresetId && localPrompt !== scene.scenePrompt) {
            updateScenePrompt(activePresetId, scene.id, localPrompt)
        }
        nav('/scenes')
    }

    if (!scene || !activePresetId) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
                <p>{t('scene.notFound', '씬을 찾을 수 없습니다')}</p>
                <Button onClick={handleBack} variant="outline">
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    {t('common.back', '돌아가기')}
                </Button>
            </div>
        )
    }

    const sceneRef: SceneRef = { presetId: activePresetId, sceneId: scene.id }

    const handleSaveName = () => {
        if (editName.trim()) {
            renameScene(activePresetId, scene.id, editName.trim())
        }
        setIsEditingName(false)
    }

    const handleGenerate = () => {
        if (!activePresetId || !scene) return

        // 한 번에 한 모드만 ComfyUI에 일을 보낸다
        const busy = useGenerationStore.getState().generatingMode
        if (busy === 'main' || busy === 'variation') {
            toast({
                title: t('common.error', '오류'),
                description: busy === 'main'
                    ? t('comfy.generate.busyMain', '메인 화면에서 생성 중입니다. 끝나거나 취소한 뒤에 누르세요.')
                    : t('comfy.generate.busyVariation', '변형 모드에서 생성 중입니다. 끝나거나 취소한 뒤에 누르세요.'),
                variant: 'destructive',
            })
            return
        }

        // If queue count is 0, set it to 1 for single generation
        // Otherwise, use the existing queue count without incrementing
        const added = scene.queueCount === 0
        if (added) {
            incrementQueue(activePresetId, scene.id)
        }

        const st = useSceneStore.getState()
        if (st.isGenerating) {
            // 이미 씬 생성이 돌고 있으면 새로 시작하지 않는다: 도는 줄이 이 예약도 집어 간다
            toast({
                description: st.isCancelling
                    ? t('comfy.scene.queuedWhileCancelling', '지금 멈추는 중이라 예약만 해 두었습니다. 멈춘 뒤 다시 누르세요.')
                    : added
                        ? t('comfy.scene.queuedWhileRunning', '예약에 넣었습니다. 지금 그리는 차례가 끝나면 이어서 그립니다.')
                        : t('comfy.scene.alreadyQueued', '이미 {{count}}장 예약되어 있습니다. 차례가 오면 그립니다.', { count: scene.queueCount }),
            })
            return
        }

        // Start a new generation session to properly track and allow cancellation
        st.startNewGenerationSession()
    }

    const handleOpenFolder = async () => {
        try {
            if (!scene) return
            // 저장할 때와 같은 규칙으로 폴더를 찾는다 (lib/output-save)
            const currentPreset = useSceneStore.getState().presets.find(p => p.id === activePresetId)
            const folderPath = await sceneFolder(currentPreset?.name, scene.name)
            const presetPath = await dirname(folderPath)
            const naisPath = await dirname(presetPath)

            // 씬 폴더가 아직 없으면 프리셋 폴더 → NAIS_Scene 폴더 순으로 연다
            for (const p of [folderPath, presetPath, naisPath]) {
                if (await exists(p)) {
                    await Command.create('explorer', [p]).execute()
                    return
                }
            }
            toast({ description: t('comfy.scene.noFolderYet', '아직 이 씬으로 저장한 그림이 없어서 열 폴더가 없습니다.') })
        } catch (error) {
            console.error("Failed to open folder:", error)
            toast({ title: t('comfy.scene.openFolderFailed', '폴더를 열지 못했습니다'), description: String(error), variant: 'destructive' })
        }
    }

    const isStreaming = streamingSceneId === scene.id

    const sortedImages = showFavoritesOnly
        ? scene.images.filter(img => img.isFavorite)
        : scene.images

    // '즐겨찾기 고화질로' 버튼
    const hqTargets = favoritesToUpscale(scene.images).length
    const hqRunningHere = !!hqBatch && hqBatch.presetId === activePresetId && hqBatch.sceneId === scene.id
    const hqRunningElsewhere = !!hqBatch && !hqRunningHere
    const hqTooltip = (
        <span className="block max-w-[280px] whitespace-normal leading-relaxed">
            <span className="block font-semibold">{t('comfy.scene.hqBatchTipTitle', '즐겨찾기한 그림을 모두 고화질로')}</span>
            {t('comfy.scene.hqBatchTip', '시드를 몰라도 그림 자체에서 시작해 크게 다시 그립니다. 크기·세기는 설정 → ComfyUI에서')}
            <span className="block mt-1 text-white/70">
                {hqRunningElsewhere
                    ? t('comfy.scene.hqBatchElsewhere', '다른 씬에서 고화질 작업을 하는 중입니다. 끝난 뒤에 누르세요.')
                    : t('comfy.scene.hqBatchTipNote', '다 되면 고화질 그림이 즐겨찾기를 이어받아 ZIP 내보내기에 들어갑니다. 이미 고화질인 그림은 건너뜁니다.')}
            </span>
        </span>
    )

    return (
        <div className="flex flex-col h-full gap-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Tip content={t('actions.openFolder', '생성된 이미지 폴더 열기')}>
                        <Button variant="ghost" size="icon" className="rounded-xl" onClick={handleOpenFolder}>
                            <FolderOpen className="h-5 w-5 text-muted-foreground" />
                        </Button>
                    </Tip>
                    <Tip content={t('actions.back', '씬 목록으로 돌아가기')}>
                        <Button variant="ghost" size="icon" className="rounded-xl" onClick={handleBack}>
                            <ChevronLeft className="h-5 w-5" />
                        </Button>
                    </Tip>
                    <div>
                        {isEditingName ? (
                            <div className="flex items-center gap-2">
                                <Input
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    className="text-2xl font-bold h-9 w-64 rounded-lg"
                                    autoFocus
                                    onBlur={handleSaveName}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSaveName()
                                        if (e.key === 'Escape') setIsEditingName(false)
                                    }}
                                />
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={handleSaveName}>
                                    <Check className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => setIsEditingName(false)}>
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2">
                                <h1 className="text-2xl font-bold">{scene.name}</h1>
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg opacity-50 hover:opacity-100" onClick={() => setIsEditingName(true)}>
                                    <Pencil className="h-4 w-4" />
                                </Button>
                            </div>
                        )}
                        <p className="text-muted-foreground text-sm">{t('scene.editPrompt')}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {/* Resolution Settings */}
                    <Tip content={scene.width && scene.height
                        ? t('comfy.scene.resolutionOwn', '이 씬만 이 크기로 그립니다')
                        : t('comfy.scene.resolutionGlobal', '따로 정하지 않아 메인 화면의 해상도로 그립니다. 바꾸면 이 씬만 그 크기로 그립니다')}>
                        <div className="w-[220px]">
                            <ResolutionSelector
                                value={currentResolution}
                                onChange={handleResolutionChange}
                            />
                        </div>
                    </Tip>

                    <div className="w-px h-8 bg-border mx-2" />

                    {/* Queue Controls */}
                    <Tip content={t('comfy.scene.queueTip', '예약 수: 씬 생성 버튼을 누르면 이만큼 그립니다')}>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-muted/50">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => decrementQueue(activePresetId, scene.id)}
                                disabled={scene.queueCount === 0}
                            >
                                <Minus className="h-3 w-3" />
                            </Button>
                            <span className="text-sm font-medium w-8 text-center">{scene.queueCount}</span>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => incrementQueue(activePresetId, scene.id)}
                            >
                                <Plus className="h-3 w-3" />
                            </Button>
                        </div>
                    </Tip>

                    <Tip content={t('comfy.scene.generateTip', '이 씬을 예약 수만큼 그립니다 (예약이 0이면 1장)')}>
                        <Button size="sm" className="rounded-xl" onClick={handleGenerate}>
                            {isStreaming
                                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                : <Play className="mr-2 h-4 w-4" />}
                            {t('generate.button')}
                        </Button>
                    </Tip>
                </div>
            </div >

            {/* Scene Prompt - Clean Style like PromptPanel */}
            < div className="flex flex-col min-h-[140px] shrink-0" >
                <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-2">
                    {t('scene.scenePrompt')}
                    <span className="font-normal opacity-70">{t('scene.promptHint', '이 프롬프트는 기본 + 추가 + 씬 + 세부 순서로 조합됩니다.')}</span>
                </label>
                <AutocompleteTextarea
                    placeholder=""
                    className="flex-1 min-h-0 resize-none rounded-xl"
                    style={{ fontSize: `${promptFontSize}px` }}
                    value={localPrompt}
                    onChange={(e) => setLocalPrompt(e.target.value)}
                />
                <label className="text-xs font-medium text-muted-foreground mt-2 mb-1 flex items-center gap-2">
                    {t('comfy.scene.negative', '씬 부정 프롬프트')}
                    <span className="font-normal opacity-70">{t('comfy.scene.negativeHint', '이 씬에서만 빼고 싶은 것. 메인 부정 프롬프트 뒤에 붙습니다.')}</span>
                </label>
                <AutocompleteTextarea
                    placeholder={t('comfy.scene.negativePlaceholder', '예: sweat, blush')}
                    className="min-h-[56px] h-[56px] resize-none rounded-xl"
                    style={{ fontSize: `${promptFontSize}px` }}
                    value={localNegative}
                    onChange={(e) => setLocalNegative(e.target.value)}
                />
            </div >

            {/* Generated Images - Large Section */}
            < Card glass className="flex-1 overflow-hidden flex flex-col mt-2" >
                <CardHeader className="py-3 flex-row items-center justify-between shrink-0">
                    <CardTitle className="text-sm flex items-center gap-2">
                        {t('scene.generatedImages')}
                        <span className="text-muted-foreground font-normal">({scene.images.length})</span>
                        {isEditMode && selectedImageIds.size > 0 && (
                            <span className="text-primary font-medium ml-2">
                                {t('scene.selectedCount', '{{count}}개 선택됨', { count: selectedImageIds.size })}
                            </span>
                        )}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                        {isEditMode ? (
                            <>
                                {/* Select All / Deselect All */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 rounded-lg gap-1"
                                    onClick={() => {
                                        if (selectedImageIds.size === scene.images.length) {
                                            setSelectedImageIds(new Set())
                                        } else {
                                            setSelectedImageIds(new Set(scene.images.map(img => img.id)))
                                        }
                                    }}
                                >
                                    {selectedImageIds.size === scene.images.length ? (
                                        <Square className="h-3 w-3" />
                                    ) : (
                                        <CheckSquare className="h-3 w-3" />
                                    )}
                                    {selectedImageIds.size === scene.images.length ? t('scene.deselectAll', '선택 해제') : t('scene.selectAll', '전체 선택')}
                                </Button>
                                {/* Delete Selected */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 rounded-lg gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                                    onClick={async () => {
                                        if (activePresetId && sceneId && selectedImageIds.size > 0) {
                                            for (const imgId of selectedImageIds) {
                                                const img = scene.images.find(i => i.id === imgId)
                                                if (img && !img.url.startsWith('data:')) {
                                                    try { await remove(img.url) } catch (e) { console.warn('Delete failed:', e) }
                                                }
                                                deleteImage(activePresetId, scene.id, imgId)
                                            }
                                            toast({ description: t('scene.deletedSelected', '{{count}}개 이미지 삭제됨', { count: selectedImageIds.size }) })
                                            setSelectedImageIds(new Set())
                                        }
                                    }}
                                    disabled={selectedImageIds.size === 0}
                                >
                                    <Trash2 className="h-3 w-3" />
                                    {t('scene.deleteSelected', '선택 삭제')}
                                </Button>
                                {/* Exit Edit Mode */}
                                <Button
                                    variant="default"
                                    size="sm"
                                    className="h-7 rounded-lg gap-1"
                                    onClick={() => {
                                        setIsEditMode(false)
                                        setSelectedImageIds(new Set())
                                    }}
                                >
                                    <Check className="h-3 w-3" />
                                    {t('scene.exitEditMode', '편집 종료')}
                                </Button>
                            </>
                        ) : (
                            <>
                                {/* Edit Mode Button */}
                                <Tip content={t('scene.editMode', '편집 모드')}>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 rounded-lg gap-1"
                                        onClick={() => setIsEditMode(true)}
                                    >
                                        <Pencil className="h-3 w-3" />
                                    </Button>
                                </Tip>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 rounded-lg gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                                    onClick={async () => {
                                        if (activePresetId && sceneId) {
                                            const { count, paths } = deleteNonFavoriteImages(activePresetId, sceneId)
                                            // Delete actual files
                                            for (const filePath of paths) {
                                                try {
                                                    await remove(filePath)
                                                } catch (e) {
                                                    console.warn('Failed to delete file:', filePath, e)
                                                }
                                            }
                                            if (count > 0) {
                                                toast({ description: t('scene.deletedNonFavorites', '{{count}}개 이미지 삭제됨', { count }) })
                                            }
                                        }
                                    }}
                                    disabled={scene.images.filter(img => !img.isFavorite).length === 0}
                                >
                                    <Trash2 className="h-3 w-3" />
                                    {t('scene.deleteNonFavorites', '즐겨찾기 제외 삭제')}
                                </Button>
                                {/* 즐겨찾기 고화질로: 시드 없이 즐겨찾기를 차례로 크게 다시 그린다 (돌고 있으면 멈추기) */}
                                <Tip content={hqTooltip} side="bottom">
                                    <span className="inline-flex">
                                        {hqRunningHere ? (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 rounded-lg gap-1 border-primary/50 text-primary"
                                                onClick={() => hqBatchAbort?.abort()}
                                            >
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                                {t('comfy.scene.hqBatchStop', '멈추기 ({{done}}/{{total}})', { done: hqBatch?.done ?? 0, total: hqBatch?.total ?? 0 })}
                                            </Button>
                                        ) : (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 rounded-lg gap-1"
                                                onClick={() => void upscaleFavorites(sceneRef)}
                                                disabled={hqTargets === 0 || hqRunningElsewhere}
                                            >
                                                <Maximize2 className="h-3 w-3" />
                                                {t('comfy.scene.hqBatch', '즐겨찾기 고화질로 ({{count}}장)', { count: hqTargets })}
                                            </Button>
                                        )}
                                    </span>
                                </Tip>
                                <Button
                                    variant={showFavoritesOnly ? "default" : "outline"}
                                    size="sm"
                                    className="h-7 rounded-lg gap-1"
                                    onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                                >
                                    <Star className={`h-3 w-3 ${showFavoritesOnly ? 'fill-current' : ''}`} />
                                    {t('scene.favoritesOnly', '즐겨찾기')}
                                </Button>
                            </>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto custom-scrollbar p-4">
                    {sortedImages.length === 0 && !isStreaming ? (
                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
                            <ImageIcon className="h-16 w-16 mb-4 stroke-1" />
                            <p>{t('scene.noImages', '생성된 이미지가 없습니다')}</p>
                        </div>
                    ) : (
                        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                            {/* Streaming Card Slot (미리보기를 끈 경우에도 진행률을 보여 준다) */}
                            {isStreaming && (
                                <div className={cn("rounded-xl overflow-hidden bg-muted/30 relative border border-primary/50 shadow-[0_0_15px_rgba(59,130,246,0.5)]", thumbnailLayout === 'vertical' ? "aspect-[2/3]" : "aspect-[3/2]")}>
                                    {streamingImage ? (
                                        <img src={streamingImage} alt="Generating..." className="w-full h-full object-cover animate-pulse opacity-80" />
                                    ) : (
                                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
                                            <Loader2 className="h-8 w-8 animate-spin" />
                                            <span className="text-xs">
                                                {t('comfy.scene.drawing', 'ComfyUI에서 그리는 중… {{pct}}%', { pct: Math.round(streamingProgress * 100) })}
                                            </span>
                                        </div>
                                    )}
                                    <div className="absolute inset-x-0 bottom-0 h-1 bg-gray-500/50">
                                        <div className="h-full bg-white transition-all duration-300 shadow-[0_0_8px_rgba(255,255,255,0.8)]" style={{ width: `${streamingProgress * 100}%` }} />
                                    </div>
                                </div>
                            )}

                            {sortedImages.map((image) => (
                                <SceneImageCard
                                    key={image.id}
                                    image={image}
                                    presetId={activePresetId}
                                    sceneId={scene.id}
                                    thumbnailLayout={thumbnailLayout}
                                    isEditMode={isEditMode}
                                    isSelected={selectedImageIds.has(image.id)}
                                    upscaleProgress={upscaleProgress[image.id]}
                                    onSelect={toggleSelect}
                                    onLoadMetadata={openMetadata}
                                    onImageClick={openViewer}
                                />
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card >

            <MetadataDialog
                open={metadataDialogOpen}
                onOpenChange={(open) => {
                    setMetadataDialogOpen(open)
                    if (!open) setSelectedImageForMetadata(undefined)
                }}
                initialImage={selectedImageForMetadata}
            />

            {/* Full-Screen Image Viewer Overlay with Context Menu */}
            {viewerImageSrc && viewerImage && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center cursor-pointer"
                    onClick={() => {
                        setViewerImageSrc(null)
                        setViewerImage(null)
                    }}
                >
                    <SceneImageContextMenu
                        image={viewerImage}
                        onDelete={() => {
                            if (activePresetId && scene) {
                                deleteImage(activePresetId, scene.id, viewerImage.id)
                            }
                            setViewerImageSrc(null)
                            setViewerImage(null)
                        }}
                        onLoadMetadata={() => void openMetadata(viewerImage)}
                        onUpscale={() => void upscaleOne(sceneRef, viewerImage)}
                        upscaling={upscaleProgress[viewerImage.id] !== undefined}
                    >
                        <img
                            src={viewerImageSrc}
                            alt="Full view"
                            className="max-w-[90vw] max-h-[90vh] object-contain cursor-default"
                            onClick={(e) => e.stopPropagation()}
                            onContextMenu={(e) => e.stopPropagation()}
                        />
                    </SceneImageContextMenu>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-4 right-4 text-white bg-black/50 hover:bg-black/70 rounded-lg h-10 w-10"
                        onClick={() => {
                            setViewerImageSrc(null)
                            setViewerImage(null)
                        }}
                    >
                        <X className="h-6 w-6" />
                    </Button>
                </div>
            )}
        </div >
    )
}

interface SceneImageCardProps {
    image: SceneImage
    presetId: string
    sceneId: string
    thumbnailLayout: 'vertical' | 'horizontal'
    isEditMode?: boolean
    isSelected?: boolean
    /** 고화질로 다시 그리는 중이면 0~100 */
    upscaleProgress?: number
    onSelect: (imageId: string) => void
    onLoadMetadata: (image: SceneImage) => void
    onImageClick: (image: SceneImage, imgSrc: string) => void
}

const SceneImageCard = memo(function SceneImageCard({
    image,
    presetId,
    sceneId,
    thumbnailLayout,
    isEditMode,
    isSelected,
    upscaleProgress,
    onSelect,
    onLoadMetadata,
    onImageClick,
}: SceneImageCardProps) {
    const { t } = useTranslation()
    // 파일 경로는 convertFileSrc 로 바로 보여 준다 (exe 의 /__api/file 을 거친다)
    const imgSrc = !image.url ? '' : image.url.startsWith('data:') ? image.url : convertFileSrc(image.url)
    const upscaling = upscaleProgress !== undefined
    const isHq = isUpscaledSceneImage(image)

    const onDelete = () => useSceneStore.getState().deleteImage(presetId, sceneId, image.id)
    const onToggleFavorite = () => useSceneStore.getState().toggleFavorite(presetId, sceneId, image.id)
    const onUpscale = () => void upscaleOne({ presetId, sceneId }, image)

    return (
        <SceneImageContextMenu
            image={image}
            onDelete={onDelete}
            onLoadMetadata={() => onLoadMetadata(image)}
            onUpscale={onUpscale}
            upscaling={upscaling}
        >
            <div
                className={cn(
                    "relative group rounded-xl overflow-hidden bg-muted/30 border-2 transition-all duration-300 shadow-sm cursor-pointer",
                    thumbnailLayout === 'vertical' ? "aspect-[2/3]" : "aspect-[3/2]",
                    isEditMode && isSelected
                        ? "border-orange-500 ring-2 ring-orange-500/50"
                        : image.isFavorite
                            ? "border-yellow-500 ring-2 ring-yellow-500/30"
                            : "border-border/50 hover:border-primary/50"
                )}
                onClick={() => {
                    if (isEditMode) {
                        onSelect(image.id)
                    } else if (imgSrc) {
                        onImageClick(image, imgSrc)
                    }
                }}
            >
                {/* Image */}
                {imgSrc && (
                    <img
                        src={imgSrc}
                        alt="Scene Image"
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                    />
                )}

                {/* 고화질로 다시 그린 그림 표시 */}
                {isHq && (
                    <div
                        className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/60 text-[10px] font-bold text-white tracking-wide pointer-events-none"
                        title={t('comfy.scene.hqBadge', '고화질로 다시 그린 그림')}
                    >
                        HQ
                    </div>
                )}

                {/* 고화질로 다시 그리는 중 */}
                {upscaling && (
                    <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2 text-white pointer-events-none">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span className="text-xs font-medium">
                            {t('comfy.upscale.running', '고화질로 다시 그리는 중…')}{upscaleProgress > 0 ? ` ${upscaleProgress}%` : ''}
                        </span>
                        <div className="absolute inset-x-0 bottom-0 h-1 bg-gray-500/50">
                            <div className="h-full bg-white transition-all duration-300" style={{ width: `${upscaleProgress}%` }} />
                        </div>
                    </div>
                )}

                {/* Edit mode selection overlay */}
                {isEditMode && (
                    <div className={cn(
                        "absolute top-2 left-2 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all",
                        isSelected
                            ? "bg-orange-500 border-orange-500"
                            : "bg-black/50 border-white/50"
                    )}>
                        {isSelected && <Check className="h-4 w-4 text-white" />}
                    </div>
                )}

                {/* Overlay (hide in edit mode) */}
                {!isEditMode && (
                    <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-between p-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); onToggleFavorite() }}
                        >
                            <Star className={cn("h-3.5 w-3.5", image.isFavorite && "fill-current")} />
                        </Button>
                    </div>
                )}

                <div className="absolute inset-0 rounded-xl border border-transparent group-hover:border-primary/50 pointer-events-none" />
            </div>
        </SceneImageContextMenu>
    )
})
