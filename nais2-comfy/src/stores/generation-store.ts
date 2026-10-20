import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import { useSettingsStore } from './settings-store'
import { generateImage, DEFAULT_HIRES, type HiresSettings, type LoraEntry } from '@/services/comfyui-api'
import { getFamily, normalizeSampler, normalizeScheduler, type FamilyId } from '@/services/comfy/families'
import { buildGenerationParams } from '@/lib/comfy-params'
import { saveOutputImage } from '@/lib/output-save'
import { createThumbnail } from '@/lib/image-utils'
import i18n from '@/i18n'
import { toast } from '@/components/ui/use-toast'

interface Resolution {
    label: string
    width: number
    height: number
}

interface HistoryItem {
    id: string
    url: string // Base64 or Blob URL
    thumbnail?: string
    prompt: string
    seed: number
    timestamp: Date
}

export type { HiresSettings, LoraEntry }

/** 생성 설정 묶음 (프리셋 저장·불러오기에 쓴다) */
export interface GenerationPresetFields {
    basePrompt: string
    additionalPrompt: string
    detailPrompt: string
    negativePrompt: string
    model: string
    modelFamily?: FamilyId | 'auto'
    loras?: LoraEntry[]
    clipSkip?: number
    hires?: HiresSettings
    steps: number
    cfgScale: number
    cfgRescale: number
    sampler: string
    scheduler: string
    qualityToggle?: boolean
    ucPreset?: number
    selectedResolution: Resolution
}

let loraSeq = 0
export function newLoraId(): string {
    loraSeq += 1
    return `lora-${Date.now().toString(36)}-${loraSeq}`
}

interface GenerationState {
    // Prompt fields
    basePrompt: string
    additionalPrompt: string
    detailPrompt: string
    negativePrompt: string

    // Model selection (ComfyUI 체크포인트 파일 이름)
    model: string
    /** 체크포인트 계열 (auto = 파일 이름으로 짐작). 품질 태그·UC 프리셋 글, v-pred 여부를 정한다 */
    modelFamily: FamilyId | 'auto'
    loras: LoraEntry[]
    /** 1 = 건너뛰지 않음, 2 = CLIP skip 2 */
    clipSkip: number
    hires: HiresSettings

    // Generation settings
    steps: number
    cfgScale: number
    cfgRescale: number
    sampler: string
    scheduler: string

    seed: number
    previewSeed: number | null
    seedLocked: boolean
    selectedResolution: Resolution

    // Quality settings
    qualityToggle: boolean
    ucPreset: number

    // Batch generation
    batchCount: number
    currentBatch: number

    // Timing
    lastGenerationTime: number | null  // ms
    estimatedTime: number | null

    // State
    isGenerating: boolean // Deprecated in favor of generatingMode check? Or keep for local main mode state?
    generatingMode: 'main' | 'scene' | 'variation' | null
    /** 지금 ComfyUI에서 돌고 있는 작업 번호 (중단할 때 쓴다) */
    currentPromptId: string | null
    isCancelled: boolean
    previewImage: string | null
    history: HistoryItem[]

    // AbortController for cancellation
    abortController: AbortController | null

    // Generation session ID (to handle race conditions on cancel/restart)
    generationSessionId: number

    // Streaming progress (0-100)
    streamProgress: number

    // Actions
    setBasePrompt: (prompt: string) => void
    setAdditionalPrompt: (prompt: string) => void
    setDetailPrompt: (prompt: string) => void
    setNegativePrompt: (prompt: string) => void

    setModel: (model: string) => void
    setModelFamily: (family: FamilyId | 'auto') => void
    setLoras: (loras: LoraEntry[]) => void
    addLora: (name?: string) => void
    updateLora: (id: string, patch: Partial<LoraEntry>) => void
    removeLora: (id: string) => void
    setClipSkip: (v: number) => void
    setHires: (patch: Partial<HiresSettings>) => void
    /** 체크포인트 계열 권장값(스텝·CFG·샘플러·스케줄러·CLIP skip·고화질 값)으로 맞춘다 */
    applyFamilyDefaults: () => void
    setSteps: (steps: number) => void
    setCfgScale: (v: number) => void
    setCfgRescale: (v: number) => void
    setSampler: (v: string) => void
    setScheduler: (v: string) => void

    setSeed: (seed: number) => void
    setPreviewSeed: (seed: number | null) => void
    setSeedLocked: (locked: boolean) => void
    setSelectedResolution: (resolution: Resolution) => void
    setQualityToggle: (v: boolean) => void
    setUcPreset: (v: number) => void

    setBatchCount: (count: number) => void

    // Batch update for preset loading (avoids multiple IndexedDB writes)
    applyPreset: (preset: GenerationPresetFields) => void

    generate: () => Promise<void>
    cancelGeneration: () => void
    addToHistory: (item: HistoryItem) => void
    clearHistory: () => void
    setPreviewImage: (url: string | null) => void
    setIsGenerating: (v: boolean) => void // Only for Main Mode use ideally
    setGeneratingMode: (mode: 'main' | 'scene' | 'variation' | null) => void
    setCurrentPromptId: (id: string | null) => void
    setStreamProgress: (progress: number) => void
    
    // Memory cleanup - call when leaving main mode to release large Base64 data
    clearRuntimeData: () => void
}

export const useGenerationStore = create<GenerationState>()(
    persist(
        (set, get) => ({
            // Initial state
            basePrompt: '',
            additionalPrompt: '',
            detailPrompt: '',
            negativePrompt: '',

            model: '',
            modelFamily: 'auto',
            loras: [],
            clipSkip: 2,
            hires: { ...DEFAULT_HIRES },

            steps: 28,
            cfgScale: 5.5,
            cfgRescale: 0.0,
            sampler: 'euler_ancestral',
            scheduler: 'normal',

            seed: Math.floor(Math.random() * 4294967295),
            previewSeed: null,
            seedLocked: false,
            selectedResolution: { label: 'Portrait', width: 832, height: 1216 },

            qualityToggle: true,
            ucPreset: 0,

            batchCount: 1,
            currentBatch: 0,

            lastGenerationTime: null,
            estimatedTime: null,

            isGenerating: false,
            generatingMode: null,
            currentPromptId: null,
            isCancelled: false,
            previewImage: null,
            history: [],
            abortController: null,
            generationSessionId: 0,
            streamProgress: 0,

            // Actions
            setBasePrompt: (prompt) => set({ basePrompt: prompt }),
            setAdditionalPrompt: (prompt) => set({ additionalPrompt: prompt }),
            setDetailPrompt: (prompt) => set({ detailPrompt: prompt }),
            setNegativePrompt: (prompt) => set({ negativePrompt: prompt }),

            setModel: (model) => set({ model }),
            setModelFamily: (modelFamily) => set({ modelFamily }),
            setLoras: (loras) => set({ loras }),
            addLora: (name = '') => set((state) => ({
                loras: [...state.loras, { id: newLoraId(), name, enabled: true, strengthModel: 1, strengthClip: 1 }],
            })),
            updateLora: (id, patch) => set((state) => ({
                loras: state.loras.map((l) => (l.id === id ? { ...l, ...patch } : l)),
            })),
            removeLora: (id) => set((state) => ({ loras: state.loras.filter((l) => l.id !== id) })),
            setClipSkip: (clipSkip) => set({ clipSkip: Math.max(1, Math.min(12, Math.round(clipSkip))) }),
            setHires: (patch) => set((state) => ({ hires: { ...state.hires, ...patch } })),
            applyFamilyDefaults: () => {
                const { modelFamily, model, hires } = get()
                const f = getFamily(modelFamily, model)
                set({
                    steps: f.steps,
                    cfgScale: f.cfg,
                    sampler: f.sampler,
                    scheduler: f.scheduler,
                    clipSkip: f.clipSkip,
                    cfgRescale: 0,
                    hires: { ...hires, scale: f.hires.scale, denoise: f.hires.denoise, steps: f.hires.steps },
                })
            },
            setSteps: (steps) => set({ steps }),
            setCfgScale: (cfgScale) => set({ cfgScale }),
            setCfgRescale: (cfgRescale) => set({ cfgRescale }),
            setSampler: (sampler) => set({ sampler }),

            // Batch update - single IndexedDB write instead of 16 separate writes
            applyPreset: (preset) => set({
                basePrompt: preset.basePrompt,
                additionalPrompt: preset.additionalPrompt,
                detailPrompt: preset.detailPrompt,
                negativePrompt: preset.negativePrompt,
                // 예전 NAIS2 프리셋의 NAI 모델 이름은 체크포인트가 아니므로 지금 체크포인트를 둔다
                model: preset.model && !/^nai-diffusion/.test(preset.model) ? preset.model : get().model,
                modelFamily: preset.modelFamily ?? get().modelFamily,
                loras: preset.loras ?? get().loras,
                clipSkip: preset.clipSkip ?? get().clipSkip,
                hires: preset.hires ? { ...DEFAULT_HIRES, ...preset.hires } : get().hires,
                steps: preset.steps,
                cfgScale: preset.cfgScale,
                cfgRescale: preset.cfgRescale ?? 0,
                sampler: normalizeSampler(preset.sampler),
                scheduler: normalizeScheduler(preset.scheduler),
                qualityToggle: preset.qualityToggle ?? true,
                ucPreset: preset.ucPreset ?? 0,
                selectedResolution: preset.selectedResolution,
            }),
            setScheduler: (scheduler) => set({ scheduler }),

            setSeed: (seed) => set({ seed }),
            setPreviewSeed: (previewSeed) => set({ previewSeed }),
            setSeedLocked: (locked) => set({ seedLocked: locked }),
            setSelectedResolution: (resolution) => set({ selectedResolution: resolution }),
            setQualityToggle: (qualityToggle) => set({ qualityToggle }),
            setUcPreset: (ucPreset) => set({ ucPreset }),

            setBatchCount: (count) => set({ batchCount: count }),

            // Memory cleanup - release large runtime data (previewImage, sourceImage, mask)
            // Call this when leaving main mode to prevent OOM
            clearRuntimeData: () => {
                console.log('[GenerationStore] Clearing runtime data to free memory')
                set({
                    previewImage: null,
                    streamProgress: 0
                })
            },

            cancelGeneration: () => {
                const { abortController, seedLocked } = get()
                // ComfyUI 작업도 멈춘다 (signal → /queue 삭제 + /interrupt)
                if (abortController) {
                    abortController.abort()
                }
                const newSeed = seedLocked ? undefined : Math.floor(Math.random() * 4294967295)
                set({
                    isCancelled: true,
                    currentBatch: 0,
                    ...(newSeed !== undefined && { seed: newSeed })
                })
                toast({
                    title: i18n.t('toast.generationCancelled.title'),
                    description: i18n.t('toast.generationCancelled.desc'),
                })
            },

            generate: async () => {
                const { batchCount, lastGenerationTime } = get()

                // 씬·변형 모드가 돌고 있으면 기다린다
                const busy = get().generatingMode
                if (busy === 'scene' || busy === 'variation') {
                    toast({
                        title: i18n.t('common.error'),
                        description: busy === 'scene'
                            ? i18n.t('generate.conflictScene', '씬 모드에서 생성 중입니다.')
                            : i18n.t('generate.conflictVariation', '변형 모드에서 생성 중입니다.'),
                        variant: 'destructive',
                    })
                    return
                }
                if (!get().model) {
                    toast({
                        title: i18n.t('comfy.noCheckpointTitle', '체크포인트를 고르세요'),
                        description: i18n.t('comfy.noCheckpointDesc', '프롬프트 아래 생성 설정(톱니바퀴)에서 ComfyUI 체크포인트를 고르세요.'),
                        variant: 'destructive',
                    })
                    return
                }

                const abortController = new AbortController()
                const sessionId = Date.now()

                set({
                    isGenerating: true,
                    generatingMode: 'main',
                    isCancelled: false,
                    abortController,
                    generationSessionId: sessionId,
                    estimatedTime: lastGenerationTime ? lastGenerationTime * batchCount : null,
                    previewImage: null,
                    streamProgress: 0,
                })

                let completed = 0
                try {
                    for (let i = 0; i < batchCount; i++) {
                        if (get().isCancelled || get().generationSessionId !== sessionId) break

                        set({ currentBatch: i + 1 })
                        const startTime = Date.now()

                        // 이번 장의 시드: 0이면 무작위. 고정하지 않았으면 바로 다음 시드로 바꿔 둔다
                        let currentSeed = get().seed
                        if (currentSeed === 0) currentSeed = Math.floor(Math.random() * 4294967295)
                        if (!get().seedLocked) set({ seed: Math.floor(Math.random() * 4294967295) })

                        // 조각(와일드카드)은 장마다 새로 뽑는다
                        const params = await buildGenerationParams({ seed: currentSeed })
                        const { useStreaming } = useSettingsStore.getState()

                        set({ streamProgress: 0 })
                        const result = await generateImage(params, {
                            signal: abortController.signal,
                            onQueued: (id) => set({ currentPromptId: id }),
                            onProgress: (progress, preview) => {
                                if (get().generationSessionId !== sessionId) return
                                if (preview && useStreaming) set({ streamProgress: progress, previewImage: preview })
                                else set({ streamProgress: progress })
                            },
                        })
                        set({ streamProgress: 0, currentPromptId: null })

                        if (get().isCancelled || get().generationSessionId !== sessionId || result.interrupted) break

                        set({ lastGenerationTime: Date.now() - startTime })

                        if (result.success && result.imageData) {
                            const imageUrl = `data:image/png;base64,${result.imageData}`
                            set({ previewImage: imageUrl })

                            const thumbnail = await createThumbnail(imageUrl)
                            const historyItem: HistoryItem = {
                                id: Date.now().toString(),
                                url: thumbnail,
                                prompt: params.prompt,
                                seed: result.seed,
                                timestamp: new Date(),
                            }
                            // 저장 + 오른쪽 기록 패널에 알림 (자동 저장을 끄면 기록 패널에만)
                            await saveOutputImage(result.bytes ?? result.imageData, { kind: 'main' })
                            set(state => ({ history: [historyItem, ...state.history].slice(0, 20) }))
                            completed++

                            const { generationDelay } = useSettingsStore.getState()
                            if (i < batchCount - 1 && generationDelay > 0) {
                                await new Promise(resolve => setTimeout(resolve, generationDelay))
                            }
                        } else {
                            toast({
                                title: i18n.t('toast.generationFailed.title'),
                                description: result.error || i18n.t('toast.unknownError'),
                                variant: 'destructive',
                            })
                            break
                        }
                    }

                    if (!get().isCancelled && batchCount > 1 && completed === batchCount) {
                        toast({
                            title: i18n.t('toast.batchComplete.title'),
                            description: i18n.t('toast.batchComplete.desc', { count: batchCount }),
                            variant: 'success',
                        })
                    }
                } catch (error) {
                    if (get().isCancelled) {
                        return
                    }
                    console.error('Generation failed:', error)
                    toast({
                        title: i18n.t('toast.errorOccurred.title'),
                        description: (error as Error)?.message || i18n.t('toast.errorOccurred.desc'),
                        variant: 'destructive',
                    })
                } finally {
                    if (get().generationSessionId === sessionId) {
                        set({ isGenerating: false, generatingMode: null, currentBatch: 0, abortController: null, currentPromptId: null })
                    }
                }
            },

            addToHistory: (item) => set(state => ({
                history: [item, ...state.history].slice(0, 20)
            })),

            clearHistory: () => set({ history: [] }),

            setPreviewImage: (url) => set({ previewImage: url }),
            setIsGenerating: (v) => set({ isGenerating: v, generatingMode: v ? 'main' : null }),
            setGeneratingMode: (mode) => set({ generatingMode: mode }),
            setCurrentPromptId: (currentPromptId) => set({ currentPromptId }),
            setStreamProgress: (progress) => set({ streamProgress: progress }),
        }),
        {
            name: 'nais2-generation',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => ({
                // Prompts
                basePrompt: state.basePrompt,
                additionalPrompt: state.additionalPrompt,
                detailPrompt: state.detailPrompt,
                negativePrompt: state.negativePrompt,
                // Model & Parameters
                model: state.model,
                modelFamily: state.modelFamily,
                loras: state.loras,
                clipSkip: state.clipSkip,
                hires: state.hires,
                steps: state.steps,
                cfgScale: state.cfgScale,
                cfgRescale: state.cfgRescale,
                sampler: state.sampler,
                scheduler: state.scheduler,
                qualityToggle: state.qualityToggle,
                ucPreset: state.ucPreset,
                // Seed - only save if locked
                ...(state.seedLocked ? { seed: state.seed } : {}),
                seedLocked: state.seedLocked,
                selectedResolution: state.selectedResolution,
                // Batch
                batchCount: state.batchCount,
                // Timing (for estimated time)
                lastGenerationTime: state.lastGenerationTime,
                // History - limit to 20 items to prevent memory issues
                history: state.history.slice(0, 20),
            }),
            onRehydrateStorage: () => (state, error) => {
                if (error) {
                    console.error('[GenerationStore] Hydration failed:', error)
                    return
                }
                // Trim history to 20 items on load to prevent OOM
                if (state && state.history && state.history.length > 20) {
                    console.log(`[GenerationStore] Trimming history from ${state.history.length} to 20 items`)
                    state.history = state.history.slice(0, 20)
                }
                if (state) {
                    // 예전 NAIS2(NAI) 값이 남아 있으면 ComfyUI 이름으로 바꾼다
                    state.sampler = normalizeSampler(state.sampler)
                    state.scheduler = normalizeScheduler(state.scheduler)
                    if (/^nai-diffusion/.test(state.model ?? '')) state.model = ''
                    state.hires = { ...DEFAULT_HIRES, ...(state.hires ?? {}) }
                    state.loras = Array.isArray(state.loras) ? state.loras : []
                    console.log('[GenerationStore] Hydrated successfully')
                }
            },
        }
    )
)
