import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import { rename, exists } from '@tauri-apps/plugin-fs'
import { sceneFolder } from '@/lib/output-save'

export interface SceneImage {
    id: string
    url: string  // 파일 경로 (예전 데이터는 data:image/png;base64,... 일 수도 있다)
    timestamp: number
    isFavorite: boolean
    /** '고화질로 다시 그리기'로 만든 그림 (즐겨찾기 고화질로 버튼이 또 키우지 않게) */
    upscaled?: boolean
}

/** 씬 그림 묶음 고화질 작업 진행 상황 (화면을 나갔다 와도 보이게 저장소에 둔다) */
export interface HqBatchState {
    presetId: string
    sceneId: string
    done: number
    total: number
}

/** 겹치지 않는 id (같은 밀리초에 두 장이 들어와도 안전하게) */
export function newSceneUid(): string {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    } catch { /* 아래로 */ }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 고화질로 다시 그린 그림인지 (저장소 표시 또는 파일 이름으로) */
export function isUpscaledSceneImage(img: SceneImage): boolean {
    return !!img.upscaled || /(?:^|[\\/])NAIS_(?:SCENE_HQ|UPSCALE)_[^\\/]*$/i.test(img.url)
}

export interface SceneCard {
    id: string
    name: string
    scenePrompt: string
    /** 이 씬에만 더하는 부정 프롬프트 (NAIS2 Comfy 추가 항목. 메인 부정 프롬프트 뒤에 붙는다) */
    sceneNegative?: string
    queueCount: number  // Number of images to generate
    images: SceneImage[]  // Generated images for this scene
    width?: number
    height?: number
    createdAt: number
}

export interface ScenePreset {
    id: string
    name: string
    scenes: SceneCard[]
    createdAt: number
}

interface SceneState {
    presets: ScenePreset[]
    activePresetId: string | null

    // Actions - Presets
    addPreset: (name: string) => void
    deletePreset: (id: string) => void
    renamePreset: (id: string, name: string) => void
    reorderPresets: (oldIndex: number, newIndex: number) => void
    setActivePreset: (id: string) => void
    getActivePreset: () => ScenePreset | undefined

    // Actions - Scenes
    addScene: (presetId: string, name?: string) => void
    deleteScene: (presetId: string, sceneId: string) => void
    duplicateScene: (presetId: string, sceneId: string) => void
    renameScene: (presetId: string, sceneId: string, name: string) => Promise<void>
    updateScenePrompt: (presetId: string, sceneId: string, prompt: string) => void
    updateSceneNegative: (presetId: string, sceneId: string, negative: string) => void
    updateSceneSettings: (presetId: string, sceneId: string, settings: { width?: number, height?: number }) => void
    updateAllScenesResolution: (presetId: string, width: number, height: number) => void
    reorderScenes: (presetId: string, scenes: SceneCard[]) => void
    getScene: (presetId: string, sceneId: string) => SceneCard | undefined

    // Actions - Queue
    setQueueCount: (presetId: string, sceneId: string, count: number) => void
    incrementQueue: (presetId: string, sceneId: string, count?: number) => void
    decrementQueue: (presetId: string, sceneId: string) => void
    addAllToQueue: (presetId: string, count?: number) => void
    clearAllQueue: (presetId: string) => void
    getTotalQueueCount: (presetId: string) => number
    getQueuedScenes: (presetId: string) => SceneCard[]

    // Actions - Images
    /** 그림을 씬 맨 앞(최신)에 넣고 새 그림 id를 돌려준다 */
    addImageToScene: (presetId: string, sceneId: string, imageUrl: string, opts?: { isFavorite?: boolean; upscaled?: boolean }) => string
    /**
     * 고화질로 다시 그린 그림을 넣는다. 새 그림이 즐겨찾기가 되고 원본은 즐겨찾기만 풀린다
     * (ZIP 내보내기가 즐겨찾기를 고르므로 고화질 그림이 들어간다). 새 그림 id를 돌려준다.
     */
    addUpscaledImage: (presetId: string, sceneId: string, sourceImageId: string, imageUrl: string) => string
    toggleFavorite: (presetId: string, sceneId: string, imageId: string) => void
    deleteImage: (presetId: string, sceneId: string, imageId: string) => void
    deleteNonFavoriteImages: (presetId: string, sceneId: string) => { count: number; paths: string[] }
    clearAllFavorites: (presetId: string, sceneId: string) => number
    deleteAllImages: (presetId: string, sceneId: string) => { count: number; paths: string[] }
    getSceneThumbnail: (scene: SceneCard) => string | undefined

    // Actions - Generation
    decrementFirstQueuedScene: (presetId: string) => SceneCard | null

    // Generation Status
    isGenerating: boolean
    isCancelling: boolean  // True when cancel requested but API call still in progress
    setIsGenerating: (isGenerating: boolean) => void
    cancelSceneGeneration: () => void  // Request cancel (keeps button locked until API completes)
    generationSessionId: number  // Incremented on each new generation session to invalidate old ones
    startNewGenerationSession: () => number  // Returns new session ID

    // Streaming State
    streamingSceneId: string | null
    streamingImage: string | null
    streamingProgress: number
    setStreamingData: (sceneId: string | null, image: string | null, progress: number) => void
    
    // Memory cleanup - call when leaving scene mode to release streaming data
    clearRuntimeData: () => void

    // 고화질로 다시 그리기 (씬 상세 화면): 그림 id → 진행률 0~100
    upscaleProgress: Record<string, number>
    setUpscaleProgress: (imageId: string, progress: number | null) => void
    hqBatch: HqBatchState | null
    setHqBatch: (batch: HqBatchState | null) => void

    // History Refresh Trigger
    historyRefreshTrigger: number
    triggerHistoryRefresh: () => void

    // File Management
    /** 씬 JSON(NAIS2 형식 외 3가지)을 새 프리셋으로 불러온다. 씬이 하나도 없거나 형식을 모르면 false */
    importPreset: (json: unknown) => boolean
    validateSceneImages: (presetId: string, sceneId: string, validImageIds: string[]) => void

    // Multi-Select / Edit Mode
    isEditMode: boolean
    selectedSceneIds: string[]
    setEditMode: (isEdit: boolean) => void
    toggleSceneSelection: (sceneId: string, clearOthers?: boolean) => void
    selectSceneRange: (fromId: string, toId: string) => void
    selectAllScenes: () => void
    clearSelection: () => void
    deleteSelectedScenes: () => void
    moveSelectedScenesToPreset: (targetPresetId: string) => void
    updateSelectedScenesResolution: (width: number, height: number) => void
    lastSelectedSceneId: string | null
    setLastSelectedSceneId: (id: string | null) => void

    // Generation Progress
    completedCount: number
    totalQueuedCount: number
    setGenerationProgress: (completed: number, total: number) => void
    initGenerationProgress: () => void

    // Grid Layout
    gridColumns: number
    setGridColumns: (columns: number) => void
    thumbnailLayout: 'vertical' | 'horizontal'
    setThumbnailLayout: (layout: 'vertical' | 'horizontal') => void

    // Scroll Position (for returning from detail page)
    scrollPosition: number
    setScrollPosition: (position: number) => void
}

// ---------------------------------------------------------------------------
// 씬 JSON 불러오기 (원래 NAIS2가 읽던 네 가지 형식 그대로)
//   A. 배열 [{ scene_name, scene_prompt }]                 (scene_preset_export.json)
//   B. { name, scenes: { 키: { name, slots: [[{ prompt, enabled }]] } } }  (상호작용공유용.json)
//   C. { name, presets: { SDImageGenEasy: [{ name, frontPrompt, backPrompt }] } }
//   D. NAIS2 씬 프리셋 { name, scenes: [SceneCard] }
// 씬·그림 id는 언제나 새로 만든다 (같은 파일을 두 번 불러와도 겹치지 않게).

type JsonObject = Record<string, unknown>

function isJsonObject(v: unknown): v is JsonObject {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function jsonString(v: unknown, fallback = ''): string {
    return typeof v === 'string' ? v : fallback
}

function positiveNumber(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
}

function importedScene(name: string, scenePrompt: string, extra: Partial<SceneCard> = {}): SceneCard {
    return {
        id: newSceneUid(),
        name,
        scenePrompt,
        queueCount: 0,
        images: [],
        createdAt: Date.now(),
        ...extra,
    }
}

/** B 형식: 칸(slot)마다 켜진 항목을 하나씩 골라 만든 모든 조합 */
function slotCombinations(slots: unknown[]): string[] {
    if (slots.length === 0) return ['']
    const firstSlot = Array.isArray(slots[0]) ? slots[0] : []
    // enabled 필드가 없으면 기본적으로 활성화된 것으로 간주
    const enabledItems = firstSlot.filter((item): item is JsonObject => isJsonObject(item) && item.enabled !== false)
    const remainingPrompts = slotCombinations(slots.slice(1))

    if (enabledItems.length === 0) return remainingPrompts

    const results: string[] = []
    for (const item of enabledItems) {
        for (const nextPrompt of remainingPrompts) {
            const current = jsonString(item.prompt)
            results.push(nextPrompt ? `${current}, ${nextPrompt}` : current)
        }
    }
    return results
}

function importedImages(v: unknown): SceneImage[] {
    if (!Array.isArray(v)) return []
    const out: SceneImage[] = []
    for (const img of v) {
        if (!isJsonObject(img) || typeof img.url !== 'string' || !img.url) continue
        out.push({
            id: newSceneUid(),
            url: img.url,
            timestamp: typeof img.timestamp === 'number' ? img.timestamp : Date.now(),
            isFavorite: img.isFavorite === true,
            ...(img.upscaled === true ? { upscaled: true } : {}),
        })
    }
    return out
}

export function parseScenePresetJson(jsonContent: unknown): { name: string; scenes: SceneCard[] } | null {
    // Case A: Legacy Array Format (scene_preset_export.json)
    if (Array.isArray(jsonContent)) {
        return {
            name: `Legacy Import ${new Date().toLocaleDateString()}`,
            scenes: jsonContent.map((item) => {
                const o = isJsonObject(item) ? item : {}
                return importedScene(jsonString(o.scene_name, 'Untitled Scene') || 'Untitled Scene', jsonString(o.scene_prompt))
            }),
        }
    }
    if (!isJsonObject(jsonContent)) return null

    // Case B: Interaction Share Format (상호작용공유용.json)
    if (isJsonObject(jsonContent.scenes)) {
        const scenes: SceneCard[] = []
        for (const sceneData of Object.values(jsonContent.scenes)) {
            if (!isJsonObject(sceneData) || !Array.isArray(sceneData.slots)) continue
            const combinations = slotCombinations(sceneData.slots)
            combinations.forEach((fullPrompt, index) => {
                // If there are multiple variations, append index to name
                const suffix = combinations.length > 1 ? `_${index + 1}` : ''
                scenes.push(importedScene((jsonString(sceneData.name) || 'Untitled') + suffix, fullPrompt))
            })
        }
        return { name: jsonString(jsonContent.name) || 'Interaction Share', scenes }
    }

    // Case C: SDImageGenEasy Presets
    const presets = jsonContent.presets
    if (isJsonObject(presets) && presets.SDImageGenEasy) {
        const list = Array.isArray(presets.SDImageGenEasy) ? presets.SDImageGenEasy : []
        return {
            name: jsonString(jsonContent.name) || 'Interaction Share (Presets)',
            scenes: list.map((item) => {
                const o = isJsonObject(item) ? item : {}
                const promptParts = [jsonString(o.frontPrompt), jsonString(o.backPrompt)].filter(Boolean)
                return importedScene(jsonString(o.name) || 'Untitled', promptParts.join(', '))
            }),
        }
    }

    // Case D: Standard ScenePreset Format (NAIS2)
    if (Array.isArray(jsonContent.scenes)) {
        return {
            name: jsonString(jsonContent.name) || 'Use Preset',
            scenes: jsonContent.scenes.filter(isJsonObject).map((sc) => {
                const width = positiveNumber(sc.width)
                const height = positiveNumber(sc.height)
                return importedScene(jsonString(sc.name) || 'Untitled Scene', jsonString(sc.scenePrompt), {
                    images: importedImages(sc.images),
                    createdAt: typeof sc.createdAt === 'number' ? sc.createdAt : Date.now(),
                    ...(width && height ? { width, height } : {}),
                    ...(jsonString(sc.sceneNegative) ? { sceneNegative: jsonString(sc.sceneNegative) } : {}),
                })
            }),
        }
    }

    return null
}

const DEFAULT_PRESET_ID = 'scene-default'

const createDefaultPreset = (): ScenePreset => ({
    id: DEFAULT_PRESET_ID,
    name: '기본',
    scenes: [],
    createdAt: Date.now(),
})

export const useSceneStore = create<SceneState>()(
    persist(
        (set, get) => ({
            presets: [createDefaultPreset()],
            activePresetId: DEFAULT_PRESET_ID,

            // Preset Actions
            addPreset: (name) => {
                const newPreset: ScenePreset = {
                    id: Date.now().toString(),
                    name,
                    scenes: [],
                    createdAt: Date.now(),
                }
                set(state => ({
                    presets: [...state.presets, newPreset],
                    activePresetId: newPreset.id,
                }))
            },

            deletePreset: (id) => {
                if (id === DEFAULT_PRESET_ID) return
                const wasActive = get().activePresetId === id
                set(state => ({
                    presets: state.presets.filter(p => p.id !== id),
                    activePresetId: wasActive ? DEFAULT_PRESET_ID : state.activePresetId,
                }))
            },

            renamePreset: (id, name) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === id ? { ...p, name } : p
                    ),
                }))
            },

            reorderPresets: (oldIndex, newIndex) => {
                set(state => {
                    const newPresets = [...state.presets]
                    const [removed] = newPresets.splice(oldIndex, 1)
                    newPresets.splice(newIndex, 0, removed)
                    return { presets: newPresets }
                })
            },

            setActivePreset: (id) => set({ activePresetId: id }),

            getActivePreset: () => {
                return get().presets.find(p => p.id === get().activePresetId)
            },

            // Scene Actions
            addScene: (presetId, name) => {
                set(state => ({
                    presets: state.presets.map(p => {
                        if (p.id !== presetId) return p
                        const newScene: SceneCard = {
                            id: newSceneUid(),
                            name: name || `씬 ${p.scenes.length + 1}`,
                            scenePrompt: '',
                            queueCount: 0,
                            images: [],
                            createdAt: Date.now(),
                        }
                        return { ...p, scenes: [...p.scenes, newScene] }
                    }),
                }))
            },

            deleteScene: (presetId, sceneId) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? { ...p, scenes: p.scenes.filter(s => s.id !== sceneId) }
                            : p
                    ),
                }))
            },

            duplicateScene: (presetId, sceneId) => {
                set(state => ({
                    presets: state.presets.map(p => {
                        if (p.id !== presetId) return p
                        const scene = p.scenes.find(s => s.id === sceneId)
                        if (!scene) return p
                        const duplicated: SceneCard = {
                            ...scene,
                            id: newSceneUid(),
                            name: `${scene.name} (복사본)`,
                            queueCount: 0,
                            images: [],
                            createdAt: Date.now(),
                        }
                        const index = p.scenes.findIndex(s => s.id === sceneId)
                        const newScenes = [...p.scenes]
                        newScenes.splice(index + 1, 0, duplicated)
                        return { ...p, scenes: newScenes }
                    }),
                }))
            },

            renameScene: async (presetId, sceneId, name) => {
                const state = get()
                const preset = state.presets.find(p => p.id === presetId)
                const scene = preset?.scenes.find(s => s.id === sceneId)

                if (!scene || scene.name === name) return

                // 그림 폴더 이름도 같이 바꾼다 (저장할 때와 같은 규칙: lib/output-save 의 sceneFolder)
                try {
                    const oldFolderPath = await sceneFolder(preset?.name, scene.name)
                    const newFolderPath = await sceneFolder(preset?.name, name)

                    // 옛 폴더가 있고 새 폴더가 없을 때만 옮긴다
                    if (oldFolderPath !== newFolderPath && await exists(oldFolderPath) && !(await exists(newFolderPath))) {
                        await rename(oldFolderPath, newFolderPath)
                        const moved = (url: string) => url.startsWith(oldFolderPath) ? newFolderPath + url.slice(oldFolderPath.length) : url

                        set(state => ({
                            presets: state.presets.map(p =>
                                p.id === presetId
                                    ? {
                                        ...p,
                                        scenes: p.scenes.map(s =>
                                            s.id === sceneId
                                                ? { ...s, name, images: s.images.map(img => ({ ...img, url: moved(img.url) })) }
                                                : s
                                        ),
                                    }
                                    : p
                            ),
                        }))
                        return
                    }
                } catch (e) {
                    console.warn('Failed to rename scene folder:', e)
                }

                // 폴더를 못 옮기면 이름만 바꾼다 (그림은 원래 자리에 그대로 있다)
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s =>
                                    s.id === sceneId ? { ...s, name } : s
                                ),
                            }
                            : p
                    ),
                }))
            },

            updateSceneNegative: (presetId, sceneId, negative) => set((state) => ({
                presets: state.presets.map((preset) =>
                    preset.id === presetId
                        ? { ...preset, scenes: preset.scenes.map((scene) => (scene.id === sceneId ? { ...scene, sceneNegative: negative } : scene)) }
                        : preset
                ),
            })),

            updateScenePrompt: (presetId, sceneId, prompt) => set((state) => ({
                presets: state.presets.map((preset) =>
                    preset.id === presetId
                        ? {
                            ...preset,
                            scenes: preset.scenes.map((scene) =>
                                scene.id === sceneId ? { ...scene, scenePrompt: prompt } : scene
                            ),
                        }
                        : preset
                ),
            })),
            updateSceneSettings: (presetId, sceneId, settings) => set((state) => ({
                presets: state.presets.map((preset) =>
                    preset.id === presetId
                        ? {
                            ...preset,
                            scenes: preset.scenes.map((scene) =>
                                scene.id === sceneId ? { ...scene, ...settings } : scene
                            ),
                        }
                        : preset
                ),
            })),
            updateAllScenesResolution: (presetId, width, height) => set((state) => ({
                presets: state.presets.map((preset) =>
                    preset.id === presetId
                        ? {
                            ...preset,
                            scenes: preset.scenes.map((scene) => ({
                                ...scene,
                                width,
                                height
                            })),
                        }
                        : preset
                ),
            })),
            reorderScenes: (presetId, scenes) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId ? { ...p, scenes } : p
                    ),
                }))
            },

            getScene: (presetId, sceneId) => {
                const preset = get().presets.find(p => p.id === presetId)
                return preset?.scenes.find(s => s.id === sceneId)
            },

            // Queue Actions
            setQueueCount: (presetId, sceneId, count) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s =>
                                    s.id === sceneId ? { ...s, queueCount: Math.max(0, count) } : s
                                ),
                            }
                            : p
                    ),
                }))
            },

            incrementQueue: (presetId, sceneId, count = 1) => {
                const preset = get().presets.find(p => p.id === presetId)
                const scene = preset?.scenes.find(s => s.id === sceneId)
                if (scene) {
                    get().setQueueCount(presetId, sceneId, scene.queueCount + count)
                }
            },

            decrementQueue: (presetId, sceneId) => {
                const preset = get().presets.find(p => p.id === presetId)
                const scene = preset?.scenes.find(s => s.id === sceneId)
                if (scene && scene.queueCount > 0) {
                    get().setQueueCount(presetId, sceneId, scene.queueCount - 1)
                }
            },

            addAllToQueue: (presetId, count = 1) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s => ({ ...s, queueCount: s.queueCount + count })),
                            }
                            : p
                    ),
                }))
            },

            clearAllQueue: (presetId) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s => ({ ...s, queueCount: 0 })),
                            }
                            : p
                    ),
                }))
            },

            getTotalQueueCount: (presetId) => {
                const preset = get().presets.find(p => p.id === presetId)
                return preset?.scenes.reduce((sum, s) => sum + s.queueCount, 0) || 0
            },

            getQueuedScenes: (presetId) => {
                const preset = get().presets.find(p => p.id === presetId)
                return preset?.scenes.filter(s => s.queueCount > 0) || []
            },

            // Image Actions
            addImageToScene: (presetId, sceneId, imageUrl, opts) => {
                const now = Date.now()
                const newImage: SceneImage = {
                    id: newSceneUid(),
                    url: imageUrl,
                    timestamp: now,
                    isFavorite: !!opts?.isFavorite,
                    ...(opts?.upscaled ? { upscaled: true } : {}),
                }

                // MEMORY OPTIMIZATION: Increased limit for heavy users (was 100)
                const MAX_IMAGES_PER_SCENE = 2000

                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s => {
                                    if (s.id !== sceneId) return s

                                    // Add new image at the beginning (newest first)
                                    let updatedImages = [newImage, ...s.images]

                                    // If over limit, remove oldest non-favorites
                                    if (updatedImages.length > MAX_IMAGES_PER_SCENE) {
                                        const favorites = updatedImages.filter(img => img.isFavorite)
                                        const nonFavorites = updatedImages
                                            .filter(img => !img.isFavorite)
                                            .sort((a, b) => b.timestamp - a.timestamp)

                                        // Keep all favorites + newest non-favorites up to limit
                                        const keepCount = Math.max(0, MAX_IMAGES_PER_SCENE - favorites.length)
                                        updatedImages = [...favorites, ...nonFavorites.slice(0, keepCount)]
                                            .sort((a, b) => b.timestamp - a.timestamp)

                                        console.warn(`[SceneStore] Scene ${s.name}: Trimmed to ${updatedImages.length} images (limit: ${MAX_IMAGES_PER_SCENE})`)
                                    }

                                    return { ...s, images: updatedImages }
                                }),
                            }
                            : p
                    ),
                }))
                // HistoryPanel 은 'newImageGenerated' 이벤트로 바로 갱신된다 (lib/output-save)
                return newImage.id
            },

            addUpscaledImage: (presetId, sceneId, sourceImageId, imageUrl) => {
                const id = get().addImageToScene(presetId, sceneId, imageUrl, { isFavorite: true, upscaled: true })
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s =>
                                    s.id === sceneId
                                        ? { ...s, images: s.images.map(img => img.id === sourceImageId ? { ...img, isFavorite: false } : img) }
                                        : s
                                ),
                            }
                            : p
                    ),
                }))
                return id
            },

            toggleFavorite: (presetId, sceneId, imageId) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s =>
                                    s.id === sceneId
                                        ? {
                                            ...s,
                                            images: s.images.map(img =>
                                                img.id === imageId
                                                    ? { ...img, isFavorite: !img.isFavorite }
                                                    : img
                                            ),
                                        }
                                        : s
                                ),
                            }
                            : p
                    ),
                }))
            },

            deleteImage: (presetId, sceneId, imageId) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s =>
                                    s.id === sceneId
                                        ? { ...s, images: s.images.filter(img => img.id !== imageId) }
                                        : s
                                ),
                            }
                            : p
                    ),
                }))
            },

            deleteNonFavoriteImages: (presetId, sceneId) => {
                const preset = get().presets.find(p => p.id === presetId)
                const scene = preset?.scenes.find(s => s.id === sceneId)
                if (!scene) return { count: 0, paths: [] }
                
                const nonFavorites = scene.images.filter(img => !img.isFavorite)
                const nonFavoriteCount = nonFavorites.length
                // Collect file paths (non-base64 URLs) for deletion
                const filePaths = nonFavorites
                    .map(img => img.url)
                    .filter(url => !url.startsWith('data:'))
                
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s =>
                                    s.id === sceneId
                                        ? { ...s, images: s.images.filter(img => img.isFavorite) }
                                        : s
                                ),
                            }
                            : p
                    ),
                }))
                
                return { count: nonFavoriteCount, paths: filePaths }
            },

            clearAllFavorites: (presetId, sceneId) => {
                const preset = get().presets.find(p => p.id === presetId)
                const scene = preset?.scenes.find(s => s.id === sceneId)
                if (!scene) return 0
                
                const favoriteCount = scene.images.filter(img => img.isFavorite).length
                
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s =>
                                    s.id === sceneId
                                        ? {
                                            ...s,
                                            images: s.images.map(img => ({ ...img, isFavorite: false })),
                                        }
                                        : s
                                ),
                            }
                            : p
                    ),
                }))
                
                return favoriteCount
            },

            deleteAllImages: (presetId, sceneId) => {
                const preset = get().presets.find(p => p.id === presetId)
                const scene = preset?.scenes.find(s => s.id === sceneId)
                if (!scene) return { count: 0, paths: [] }
                
                const totalCount = scene.images.length
                const filePaths = scene.images
                    .map(img => img.url)
                    .filter(url => !url.startsWith('data:'))
                
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s =>
                                    s.id === sceneId
                                        ? { ...s, images: [] }
                                        : s
                                ),
                            }
                            : p
                    ),
                }))
                
                return { count: totalCount, paths: filePaths }
            },

            getSceneThumbnail: (scene) => {
                // Priority: favorite > newest
                const favorite = scene.images.find(img => img.isFavorite)
                if (favorite) return favorite.url
                if (scene.images.length > 0) return scene.images[0].url
                return undefined
            },

            // Generation Actions
            decrementFirstQueuedScene: (presetId) => {
                const preset = get().presets.find(p => p.id === presetId)
                if (!preset) return null

                const queuedScene = preset.scenes.find(s => s.queueCount > 0)
                if (!queuedScene) return null

                get().setQueueCount(presetId, queuedScene.id, queuedScene.queueCount - 1)
                return queuedScene
            },

            isGenerating: false,
            isCancelling: false,
            setIsGenerating: (isGenerating) => {
                // When stopping generation, increment session ID to invalidate any in-progress operations
                if (!isGenerating) {
                    set({ isGenerating: false, isCancelling: false, generationSessionId: Date.now() })
                } else {
                    set({ isGenerating: true, isCancelling: false })
                }
            },
            cancelSceneGeneration: () => {
                // 취소 요청: hooks/useSceneGeneration 이 isCancelling 을 보고 ComfyUI 작업을 바로 멈춘다.
                // 멈출 때까지 버튼은 '취소 중'으로 잠근다.
                if (!get().isGenerating) {
                    set({ isCancelling: false })
                    return
                }
                set({ isCancelling: true, generationSessionId: Date.now() })
            },
            generationSessionId: 0,
            startNewGenerationSession: () => {
                const newSessionId = Date.now()
                set({ generationSessionId: newSessionId, isGenerating: true, isCancelling: false })
                return newSessionId
            },

            streamingSceneId: null,
            streamingImage: null,
            streamingProgress: 0,
            setStreamingData: (sceneId, image, progress) => {
                const currentSceneId = get().streamingSceneId
                // If sceneId changed, reset image to prevent showing previous scene's image
                if (sceneId !== currentSceneId) {
                    set({
                        streamingSceneId: sceneId,
                        streamingImage: image,
                        streamingProgress: progress
                    })
                } else {
                    // Same scene - if image is null, keep existing (progress-only update)
                    set({
                        streamingSceneId: sceneId,
                        streamingImage: image ?? get().streamingImage,
                        streamingProgress: progress
                    })
                }
            },

            // Memory cleanup - release streaming data when leaving scene mode
            // This prevents OOM when switching between modes (Issue #6)
            clearRuntimeData: () => {
                console.log('[SceneStore] Clearing runtime data to free memory')
                set({
                    streamingSceneId: null,
                    streamingImage: null,
                    streamingProgress: 0
                })
            },

            upscaleProgress: {},
            setUpscaleProgress: (imageId, progress) => set(state => {
                const next = { ...state.upscaleProgress }
                if (progress === null) delete next[imageId]
                else next[imageId] = progress
                return { upscaleProgress: next }
            }),
            hqBatch: null,
            setHqBatch: (hqBatch) => set({ hqBatch }),

            // History Refresh Trigger
            historyRefreshTrigger: 0,
            triggerHistoryRefresh: () => set(state => ({ historyRefreshTrigger: state.historyRefreshTrigger + 1 })),

            // File Management Actions
            importPreset: (jsonContent) => {
                const parsed = parseScenePresetJson(jsonContent)
                if (!parsed) {
                    console.error('Unknown preset format', jsonContent)
                    return false
                }
                if (parsed.scenes.length === 0) {
                    console.warn('No scenes found in import')
                    return false
                }
                set(state => {
                    // 같은 파일을 두 번 불러와도 id가 겹치지 않게 프리셋 id도 새로 만든다
                    const newPreset: ScenePreset = {
                        id: newSceneUid(),
                        name: parsed.name,
                        scenes: parsed.scenes,
                        createdAt: Date.now(),
                    }

                    // Check for name collision
                    let nameSuffix = 1
                    while (state.presets.some(p => p.name === newPreset.name)) {
                        newPreset.name = `${parsed.name} (${nameSuffix++})`
                    }

                    return {
                        presets: [...state.presets, newPreset],
                        activePresetId: newPreset.id // Switch to imported preset
                    }
                })
                return true
            },

            validateSceneImages: (presetId, sceneId, validImageIds) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s =>
                                    s.id === sceneId
                                        ? { ...s, images: s.images.filter(img => validImageIds.includes(img.id)) }
                                        : s
                                )
                            }
                            : p
                    )
                }))
            },

            // Multi-Select / Edit Mode Implementation
            isEditMode: false,
            selectedSceneIds: [],
            lastSelectedSceneId: null,

            setEditMode: (isEdit) => set({
                isEditMode: isEdit,
                selectedSceneIds: isEdit ? [] : [],
                lastSelectedSceneId: null
            }),

            toggleSceneSelection: (sceneId, clearOthers = true) => set(state => {
                const isSelected = state.selectedSceneIds.includes(sceneId)
                let newSelection: string[]

                if (clearOthers) {
                    // Single click - toggle single selection
                    newSelection = isSelected ? [] : [sceneId]
                } else {
                    // Ctrl+click - toggle in multi-select
                    newSelection = isSelected
                        ? state.selectedSceneIds.filter(id => id !== sceneId)
                        : [...state.selectedSceneIds, sceneId]
                }

                return {
                    selectedSceneIds: newSelection,
                    lastSelectedSceneId: sceneId
                }
            }),

            selectSceneRange: (fromId, toId) => set(state => {
                const preset = state.presets.find(p => p.id === state.activePresetId)
                if (!preset) return state

                const fromIndex = preset.scenes.findIndex(s => s.id === fromId)
                const toIndex = preset.scenes.findIndex(s => s.id === toId)

                if (fromIndex === -1 || toIndex === -1) return state

                const start = Math.min(fromIndex, toIndex)
                const end = Math.max(fromIndex, toIndex)

                const rangeIds = preset.scenes.slice(start, end + 1).map(s => s.id)

                // Merge with existing selection
                const newSelection = [...new Set([...state.selectedSceneIds, ...rangeIds])]

                return {
                    selectedSceneIds: newSelection,
                    lastSelectedSceneId: toId
                }
            }),

            selectAllScenes: () => set(state => {
                const preset = state.presets.find(p => p.id === state.activePresetId)
                if (!preset) return state
                return { selectedSceneIds: preset.scenes.map(s => s.id) }
            }),

            clearSelection: () => set({ selectedSceneIds: [], lastSelectedSceneId: null }),

            setLastSelectedSceneId: (id) => set({ lastSelectedSceneId: id }),

            deleteSelectedScenes: () => set(state => {
                const preset = state.presets.find(p => p.id === state.activePresetId)
                if (!preset) return state

                return {
                    presets: state.presets.map(p =>
                        p.id === state.activePresetId
                            ? { ...p, scenes: p.scenes.filter(s => !state.selectedSceneIds.includes(s.id)) }
                            : p
                    ),
                    selectedSceneIds: [],
                    lastSelectedSceneId: null
                }
            }),

            moveSelectedScenesToPreset: (targetPresetId) => set(state => {
                const sourcePreset = state.presets.find(p => p.id === state.activePresetId)
                if (!sourcePreset || targetPresetId === state.activePresetId) return state

                const scenesToMove = sourcePreset.scenes.filter(s => state.selectedSceneIds.includes(s.id))
                if (scenesToMove.length === 0) return state

                return {
                    presets: state.presets.map(p => {
                        if (p.id === state.activePresetId) {
                            // Remove from source
                            return { ...p, scenes: p.scenes.filter(s => !state.selectedSceneIds.includes(s.id)) }
                        }
                        if (p.id === targetPresetId) {
                            // Add to target
                            return { ...p, scenes: [...p.scenes, ...scenesToMove] }
                        }
                        return p
                    }),
                    selectedSceneIds: [],
                    lastSelectedSceneId: null
                }
            }),

            updateSelectedScenesResolution: (width, height) => set(state => ({
                presets: state.presets.map(p =>
                    p.id === state.activePresetId
                        ? {
                            ...p,
                            scenes: p.scenes.map(s =>
                                state.selectedSceneIds.includes(s.id)
                                    ? { ...s, width, height }
                                    : s
                            )
                        }
                        : p
                )
            })),

            // Generation Progress Implementation
            completedCount: 0,
            totalQueuedCount: 0,

            setGenerationProgress: (completed, total) => set({
                completedCount: completed,
                totalQueuedCount: total
            }),

            initGenerationProgress: () => set(state => {
                const total = state.activePresetId ? state.presets.find(p => p.id === state.activePresetId)?.scenes.reduce((sum, s) => sum + s.queueCount, 0) || 0 : 0
                return {
                    completedCount: 0,
                    totalQueuedCount: total
                }
            }),

            // Grid Layout
            gridColumns: 4,
            setGridColumns: (columns) => set({ gridColumns: columns }),
            thumbnailLayout: 'vertical' as const,
            setThumbnailLayout: (layout) => set({ thumbnailLayout: layout }),

            // Scroll Position
            scrollPosition: 0,
            setScrollPosition: (position) => set({ scrollPosition: position }),
        }),
        {
            name: 'nais2-scenes',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => {
                // Images are stored as file paths, not base64 - storage is minimal per entry
                const MAX_IMAGES_PERSIST = 2000

                return {
                    presets: state.presets.map(p => ({
                        ...p,
                        scenes: p.scenes.map(s => {
                            // Fast path: skip expensive sorting if under limit
                            if (s.images.length <= MAX_IMAGES_PERSIST) {
                                return { ...s, queueCount: 0 }
                            }
                            // Over limit: keep favorites + newest non-favorites
                            const favorites = s.images.filter(img => img.isFavorite)
                            const nonFavorites = s.images
                                .filter(img => !img.isFavorite)
                                .sort((a, b) => b.timestamp - a.timestamp)
                            const keepCount = Math.max(0, MAX_IMAGES_PERSIST - favorites.length)
                            return {
                                ...s,
                                queueCount: 0,
                                images: [...favorites, ...nonFavorites.slice(0, keepCount)]
                                    .sort((a, b) => b.timestamp - a.timestamp)
                            }
                        })
                    })),
                    activePresetId: state.activePresetId,
                    gridColumns: state.gridColumns,
                    thumbnailLayout: state.thumbnailLayout,
                }
            },
            onRehydrateStorage: () => (state, error) => {
                if (error) {
                    console.error('[SceneStore] Hydration failed:', error)
                    return
                }
                
                if (state) {
                    // 복원 로그
                    const presetCount = state.presets?.length || 0
                    const totalScenes = state.presets?.reduce((sum, p) => sum + (p.scenes?.length || 0), 0) || 0
                    const totalImages = state.presets?.reduce((sum, p) => 
                        sum + p.scenes?.reduce((sSum, s) => sSum + (s.images?.length || 0), 0) || 0, 0) || 0
                    console.log(`[SceneStore] Hydrated: ${presetCount} presets, ${totalScenes} scenes, ${totalImages} images`)
                    
                    // MEMORY WARNING: Log if too many images
                    if (totalImages > 500) {
                        console.warn(`[SceneStore] Warning: ${totalImages} images loaded - consider clearing old images`)
                    }
                    
                    // 기본 프리셋 보장
                    if (!state.presets.find(p => p.id === DEFAULT_PRESET_ID)) {
                        console.log('[SceneStore] Adding default preset')
                        state.presets = [createDefaultPreset(), ...state.presets]
                    }
                    if (!state.activePresetId) {
                        state.activePresetId = DEFAULT_PRESET_ID
                    }
                    
                    // 씬 데이터 손실 경고
                    if (presetCount === 1 && totalScenes === 0) {
                        console.warn('[SceneStore] Warning: Only default preset with no scenes - possible data loss')
                    }
                }
            },
        }
    )
)
