import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { useGenerationStore, type GenerationPresetFields } from './generation-store'
import { indexedDBStorage } from '@/lib/indexed-db'
import { DEFAULT_HIRES, UC_PRESET_NONE } from '@/services/comfyui-api'
import { getFamily, normalizeSampler, normalizeScheduler } from '@/services/comfy/families'

export const DEFAULT_PRESET_ID = 'default'

/** 프리셋 = 프롬프트 + ComfyUI 생성 설정 (generation-store 의 GenerationPresetFields 와 같은 칸) */
export interface Preset extends Required<GenerationPresetFields> {
    id: string
    name: string
    createdAt: number
    isDefault?: boolean // Cannot be deleted
}

type PresetFields = Required<GenerationPresetFields>

const DEFAULT_RESOLUTION = { label: 'Portrait', width: 832, height: 1216 }

/** 빈 프리셋 값 (체크포인트는 비워 두면 불러올 때 지금 체크포인트를 그대로 쓴다) */
function defaultPresetFields(): PresetFields {
    return {
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
        cfgRescale: 0,
        sampler: 'euler_ancestral',
        scheduler: 'normal',
        qualityToggle: true,
        ucPreset: 0,
        selectedResolution: { ...DEFAULT_RESOLUTION },
    }
}

const createDefaultPreset = (): Preset => ({
    ...defaultPresetFields(),
    id: DEFAULT_PRESET_ID,
    name: '기본',
    createdAt: 0,
    isDefault: true,
})

/** 지금 생성 설정을 프리셋 칸으로 옮긴다 */
function fieldsFromGenerationStore(): PresetFields {
    const g = useGenerationStore.getState()
    return {
        basePrompt: g.basePrompt,
        additionalPrompt: g.additionalPrompt,
        detailPrompt: g.detailPrompt,
        negativePrompt: g.negativePrompt,
        model: g.model,
        modelFamily: g.modelFamily,
        loras: g.loras.map((l) => ({ ...l })),
        clipSkip: g.clipSkip,
        hires: { ...g.hires },
        steps: g.steps,
        cfgScale: g.cfgScale,
        cfgRescale: g.cfgRescale,
        sampler: g.sampler,
        scheduler: g.scheduler,
        qualityToggle: g.qualityToggle,
        ucPreset: g.ucPreset,
        selectedResolution: g.selectedResolution,
    }
}

/** UC 프리셋: 0 강하게 / 1 가볍게 / 4 없음. 예전 NAI 값(2 Furry, 3 Human 등)은 0으로 */
function normalizeUc(v: unknown): number {
    return v === 1 || v === UC_PRESET_NONE ? v : 0
}

function num(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** 예전 NAIS2(NAI) 프리셋 → ComfyUI 프리셋. 여러 번 돌려도 결과가 같다 */
type LegacyPreset = Partial<Preset> & { smea?: unknown; smeaDyn?: unknown; variety?: unknown }
export function migratePreset(raw: LegacyPreset): Preset {
    const d = defaultPresetFields()
    // NAI 전용 칸(SMEA, Variety+)은 버린다
    const p: LegacyPreset = { ...raw }
    delete p.smea
    delete p.smeaDyn
    delete p.variety
    const model = typeof p.model === 'string' && !/^nai-diffusion/.test(p.model) ? p.model : ''
    const res = p.selectedResolution
    return {
        ...d,
        ...p,
        id: p.id ?? Date.now().toString(),
        name: p.name ?? '',
        createdAt: num(p.createdAt, 0),
        basePrompt: p.basePrompt ?? '',
        additionalPrompt: p.additionalPrompt ?? '',
        detailPrompt: p.detailPrompt ?? '',
        negativePrompt: p.negativePrompt ?? '',
        model,
        modelFamily: p.modelFamily ?? 'auto',
        loras: Array.isArray(p.loras) ? p.loras : [],
        clipSkip: num(p.clipSkip, d.clipSkip),
        hires: { ...DEFAULT_HIRES, ...(p.hires ?? {}) },
        steps: num(p.steps, d.steps),
        cfgScale: num(p.cfgScale, d.cfgScale),
        cfgRescale: num(p.cfgRescale, d.cfgRescale),
        sampler: normalizeSampler(p.sampler),
        scheduler: normalizeScheduler(p.scheduler),
        qualityToggle: p.qualityToggle ?? true,
        ucPreset: normalizeUc(p.ucPreset),
        selectedResolution: res && typeof res.width === 'number' && typeof res.height === 'number' ? res : { ...DEFAULT_RESOLUTION },
    }
}

interface PresetState {
    presets: Preset[]
    activePresetId: string

    // Actions
    addPreset: (name: string) => void
    duplicatePreset: (id: string) => void
    deletePreset: (id: string) => void
    syncFromGenerationStore: () => void
    loadPreset: (id: string) => void
    renamePreset: (id: string, name: string) => void
    reorderPresets: (oldIndex: number, newIndex: number) => void
    getActivePreset: () => Preset | undefined
}

export const usePresetStore = create<PresetState>()(
    persist(
        (set, get) => ({
            presets: [createDefaultPreset()],
            activePresetId: DEFAULT_PRESET_ID,

            addPreset: (name) => {
                // First sync current state to active preset
                get().syncFromGenerationStore()

                // 새 프리셋: 프롬프트·LoRA는 비우고, 체크포인트는 지금 것을 그대로 두고 그 계열 권장값으로 시작한다
                // (체크포인트를 비우면 바로 생성할 때 "체크포인트를 고르세요"가 떠서 헷갈린다)
                const g = useGenerationStore.getState()
                const family = getFamily(g.modelFamily, g.model)
                const fields: PresetFields = {
                    ...defaultPresetFields(),
                    model: g.model,
                    modelFamily: g.modelFamily,
                    clipSkip: family.clipSkip,
                    steps: family.steps,
                    cfgScale: family.cfg,
                    sampler: family.sampler,
                    scheduler: family.scheduler,
                    hires: { ...DEFAULT_HIRES, scale: family.hires.scale, denoise: family.hires.denoise, steps: family.hires.steps },
                    selectedResolution: g.selectedResolution,
                }

                const newPreset: Preset = {
                    ...fields,
                    id: Date.now().toString(),
                    name,
                    createdAt: Date.now(),
                }

                set(state => ({
                    presets: [...state.presets, newPreset],
                    activePresetId: newPreset.id
                }))

                // Apply blank preset to generation store (single batch update)
                withPresetLoading(() => useGenerationStore.getState().applyPreset(newPreset))
            },

            duplicatePreset: (id) => {
                // First sync current state to active preset
                get().syncFromGenerationStore()

                const source = get().presets.find(p => p.id === id)
                if (!source) return

                const newPreset: Preset = {
                    ...source,
                    loras: source.loras.map(l => ({ ...l })),
                    hires: { ...source.hires },
                    id: Date.now().toString(),
                    name: `${source.isDefault ? '기본' : source.name} (복사)`,
                    createdAt: Date.now(),
                    isDefault: undefined,
                }

                set(state => ({
                    presets: [...state.presets, newPreset],
                    activePresetId: newPreset.id
                }))

                // Apply duplicated preset to generation store
                withPresetLoading(() => useGenerationStore.getState().applyPreset(newPreset))
            },

            deletePreset: (id) => {
                // Cannot delete default preset
                const preset = get().presets.find(p => p.id === id)
                if (preset?.isDefault) return

                const wasActive = get().activePresetId === id

                set(state => ({
                    presets: state.presets.filter(p => p.id !== id),
                    activePresetId: wasActive ? DEFAULT_PRESET_ID : state.activePresetId
                }))

                // If deleted active, load default
                if (wasActive) {
                    get().loadPreset(DEFAULT_PRESET_ID)
                }
            },

            // Sync current generation-store values to active preset
            syncFromGenerationStore: () => {
                const activeId = get().activePresetId
                if (!activeId) return

                const fields = fieldsFromGenerationStore()

                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === activeId ? { ...p, ...fields } : p
                    )
                }))
            },

            loadPreset: (id) => {
                // First sync current state before switching
                if (get().activePresetId !== id) {
                    get().syncFromGenerationStore()
                }

                const preset = get().presets.find(p => p.id === id)
                if (!preset) return

                // Set active preset
                set({ activePresetId: id })

                // Load preset values into generation store (single batch update)
                withPresetLoading(() => useGenerationStore.getState().applyPreset(preset))
            },

            renamePreset: (id, name) => {
                // Cannot rename default preset
                const preset = get().presets.find(p => p.id === id)
                if (preset?.isDefault) return

                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === id ? { ...p, name } : p
                    )
                }))
            },

            reorderPresets: (oldIndex, newIndex) => {
                // Don't allow reordering if involving the default preset at index 0
                if (oldIndex === 0 || newIndex === 0) return

                set(state => {
                    const newPresets = [...state.presets]
                    const [removed] = newPresets.splice(oldIndex, 1)
                    newPresets.splice(newIndex, 0, removed)
                    return { presets: newPresets }
                })
            },

            getActivePreset: () => {
                return get().presets.find(p => p.id === get().activePresetId)
            },
        }),
        {
            name: 'nais2-presets',
            storage: createJSONStorage(() => indexedDBStorage),
            // Ensure default preset exists and migrate old (NAI) presets to ComfyUI fields
            onRehydrateStorage: () => (state) => {
                if (!state) return
                const list = Array.isArray(state.presets) ? (state.presets as LegacyPreset[]) : []
                state.presets = list.map(migratePreset)
                if (!state.presets.find(p => p.id === DEFAULT_PRESET_ID)) {
                    state.presets = [createDefaultPreset(), ...state.presets]
                }
                if (!state.activePresetId || !state.presets.some(p => p.id === state.activePresetId)) {
                    state.activePresetId = DEFAULT_PRESET_ID
                }
            }
        }
    )
)

// ============================================
// Debounced Auto-Sync: generation-store → active preset
// ============================================

let syncTimeout: ReturnType<typeof setTimeout> | null = null
let isLoadingPreset = false
let loadingTimer: ReturnType<typeof setTimeout> | null = null

/** 프리셋을 불러오는 동안 생긴 변경은 다시 프리셋에 쓰지 않는다 */
function withPresetLoading(fn: () => void) {
    isLoadingPreset = true
    if (syncTimeout) {
        clearTimeout(syncTimeout)
        syncTimeout = null
    }
    try {
        fn()
    } finally {
        if (loadingTimer) clearTimeout(loadingTimer)
        loadingTimer = setTimeout(() => {
            isLoadingPreset = false
        }, 100)
    }
}

const fieldsToWatch = [
    'basePrompt', 'additionalPrompt', 'detailPrompt', 'negativePrompt',
    'model', 'modelFamily', 'loras', 'clipSkip', 'hires',
    'steps', 'cfgScale', 'cfgRescale', 'sampler', 'scheduler',
    'qualityToggle', 'ucPreset', 'selectedResolution',
] as const satisfies ReadonlyArray<keyof GenerationPresetFields>

// Subscribe to generation-store changes
useGenerationStore.subscribe((state, prevState) => {
    if (isLoadingPreset) return

    const hasChange = fieldsToWatch.some(field => state[field] !== prevState[field])
    if (!hasChange) return

    if (syncTimeout) clearTimeout(syncTimeout)
    syncTimeout = setTimeout(() => {
        syncTimeout = null
        usePresetStore.getState().syncFromGenerationStore()
    }, 500)
})
