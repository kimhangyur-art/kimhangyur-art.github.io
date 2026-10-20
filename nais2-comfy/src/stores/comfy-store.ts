// ComfyUI 연결 상태와 목록(체크포인트·로라·샘플러·스케줄러·업스케일 모델)
// 목록은 받아 올 때마다 저장해 두어, ComfyUI가 꺼져 있어도 화면에 보여 줄 수 있다.
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { comboOptions, fetchObjectInfo, getComfyTarget, pingComfy, setComfyTarget, type ComfyStatus } from '@/services/comfy/client'
import { DEFAULT_SAMPLERS, DEFAULT_SCHEDULERS } from '@/services/comfy/families'
import { hasLauncher } from '@/shims/server'

export interface ComfyLists {
    checkpoints: string[]
    loras: string[]
    samplers: string[]
    schedulers: string[]
    upscaleModels: string[]
    nodeTypes: string[]
}

const EMPTY_LISTS: ComfyLists = {
    checkpoints: [],
    loras: [],
    samplers: DEFAULT_SAMPLERS,
    schedulers: DEFAULT_SCHEDULERS,
    upscaleModels: [],
    nodeTypes: [],
}

interface ComfyState {
    url: string
    status: 'unknown' | 'checking' | 'online' | 'offline'
    version: string
    device: string
    error: string
    lists: ComfyLists
    listsFetchedAt: number | null

    /** 서버 상태 확인 + 목록 새로 받기 */
    refresh: () => Promise<boolean>
    loadUrl: () => Promise<void>
    setUrl: (url: string) => Promise<void>
}

export const useComfyStore = create<ComfyState>()(
    persist(
        (set, get) => ({
            url: 'http://127.0.0.1:8188',
            status: 'unknown',
            version: '',
            device: '',
            error: '',
            lists: EMPTY_LISTS,
            listsFetchedAt: null,

            refresh: async () => {
                set({ status: 'checking' })
                const st: ComfyStatus = await pingComfy()
                if (!st.ok) {
                    set({ status: 'offline', error: st.error ?? '', ...(st.url ? { url: st.url } : {}) })
                    return false
                }
                set({ status: 'online', error: '', version: st.version ?? '', device: st.device ?? '', ...(st.url ? { url: st.url } : {}) })
                try {
                    const info = await fetchObjectInfo()
                    const ks = info.KSampler?.input?.required ?? {}
                    const lists: ComfyLists = {
                        checkpoints: comboOptions(info.CheckpointLoaderSimple?.input?.required?.ckpt_name),
                        loras: comboOptions(info.LoraLoader?.input?.required?.lora_name),
                        samplers: comboOptions(ks.sampler_name).length ? comboOptions(ks.sampler_name) : DEFAULT_SAMPLERS,
                        schedulers: comboOptions(ks.scheduler).length ? comboOptions(ks.scheduler) : DEFAULT_SCHEDULERS,
                        upscaleModels: comboOptions(info.UpscaleModelLoader?.input?.required?.model_name),
                        nodeTypes: Object.keys(info),
                    }
                    set({ lists, listsFetchedAt: Date.now() })
                } catch (e) {
                    set({ error: (e as Error).message })
                }
                return get().status === 'online'
            },

            loadUrl: async () => {
                if (!hasLauncher()) return
                try {
                    set({ url: await getComfyTarget() })
                } catch { /* exe 없이 연 경우 */ }
            },

            setUrl: async (url: string) => {
                const saved = await setComfyTarget(url)
                set({ url: saved, status: 'unknown' })
                await get().refresh()
            },
        }),
        {
            name: 'nais2-comfy',
            storage: createJSONStorage(() => localStorage),
            partialize: (s) => ({ url: s.url, lists: s.lists, listsFetchedAt: s.listsFetchedAt }),
        },
    ),
)
