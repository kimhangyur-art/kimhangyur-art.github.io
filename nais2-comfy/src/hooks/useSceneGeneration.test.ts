import { describe, expect, it, beforeEach, vi } from 'vitest'

// ComfyUI·파일 저장·화면 알림은 가짜로 바꾼다
const generateImage = vi.fn()
const pingComfy = vi.fn()
const interruptPrompt = vi.fn()
const saveOutputImage = vi.fn()
const toast = vi.fn()
const comfyRefresh = vi.fn()

vi.mock('@/services/comfyui-api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/services/comfyui-api')>()),
    generateImage: (...a: unknown[]) => generateImage(...a),
}))
vi.mock('@/services/comfy/client', () => ({
    pingComfy: (...a: unknown[]) => pingComfy(...a),
    interruptPrompt: (...a: unknown[]) => interruptPrompt(...a),
}))
vi.mock('@/lib/comfy-params', () => ({
    buildGenerationParams: async (o: { scenePrompt?: string; seed?: number; width?: number; height?: number }) => ({ prompt: `base, ${o.scenePrompt}`, seed: o.seed, width: o.width, height: o.height }),
}))
vi.mock('@/lib/output-save', () => ({
    saveOutputImage: (...a: unknown[]) => saveOutputImage(...a),
    bytesToBase64: () => 'AAAA',
    sceneFolder: async (p: string, s: string) => `/pics/NAIS_Scene/${p}/${s}`,
}))
vi.mock('@/lib/image-utils', () => ({ createThumbnail: async () => 'data:image/jpeg;base64,x' }))
vi.mock('@/components/ui/use-toast', () => ({ toast: (...a: unknown[]) => toast(...a) }))
vi.mock('@/stores/comfy-store', () => ({ useComfyStore: { getState: () => ({ url: 'http://127.0.0.1:8188', refresh: comfyRefresh }) } }))
vi.mock('@/i18n', () => ({ default: { t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key } }))

const { runSceneQueue } = await import('./useSceneGeneration')
const { useSceneStore } = await import('@/stores/scene-store')
const { useGenerationStore } = await import('@/stores/generation-store')

const PRESET = 'scene-default'

function setup(queue: Record<string, number>) {
    useSceneStore.setState({
        presets: [{
            id: PRESET,
            name: '기본',
            createdAt: 0,
            scenes: Object.entries(queue).map(([name, n]) => ({ id: name, name, scenePrompt: name, queueCount: n, images: [], createdAt: 0 })),
        }],
        activePresetId: PRESET,
        isGenerating: false,
        isCancelling: false,
    })
    useGenerationStore.setState({ model: 'test.safetensors', generatingMode: null, seedLocked: false })
}

const sceneOf = (id: string) => useSceneStore.getState().presets[0].scenes.find(s => s.id === id)!
const ok = { success: true, bytes: new Uint8Array([1]), imageData: 'AAAA', seed: 7 }
const toastTitles = () => toast.mock.calls.map(c => (c[0] as { title?: string }).title)

beforeEach(() => {
    vi.clearAllMocks()
    pingComfy.mockResolvedValue({ ok: true })
    let n = 0
    saveOutputImage.mockImplementation(async () => ({ path: `/pics/NAIS_Scene/기본/x/NAIS_SCENE_${++n}.png`, saved: true }))
})

describe('씬 대기열 (ComfyUI)', () => {
    it('예약한 씬을 차례로 그려 씬에 붙이고 끝나면 상태를 푼다', async () => {
        setup({ a: 2, b: 1 })
        generateImage.mockResolvedValue(ok)
        const id = useSceneStore.getState().startNewGenerationSession()
        await runSceneQueue(id)

        expect(generateImage).toHaveBeenCalledTimes(3)
        expect(saveOutputImage).toHaveBeenCalledWith(expect.anything(), { kind: 'scene', presetName: '기본', sceneName: 'a' })
        expect(sceneOf('a').images).toHaveLength(2)
        expect(sceneOf('b').images).toHaveLength(1)
        expect(sceneOf('a').queueCount + sceneOf('b').queueCount).toBe(0)
        expect(useSceneStore.getState().isGenerating).toBe(false)
        expect(useGenerationStore.getState().generatingMode).toBeNull()
        expect(toastTitles()).toContain('씬 생성 완료')
    })

    it('취소하면 ComfyUI 작업을 멈추고(신호), 그 장의 예약을 되돌리고, 바로 상태를 푼다', async () => {
        setup({ a: 3 })
        let signal: AbortSignal | undefined
        generateImage.mockImplementation((_p: unknown, opts: { signal: AbortSignal }) => {
            signal = opts.signal
            return new Promise(resolve => opts.signal.addEventListener('abort', () => resolve({ success: false, interrupted: true, seed: 0 })))
        })
        const id = useSceneStore.getState().startNewGenerationSession()
        const run = runSceneQueue(id)
        await vi.waitFor(() => expect(generateImage).toHaveBeenCalledTimes(1))
        expect(useGenerationStore.getState().generatingMode).toBe('scene')
        expect(sceneOf('a').queueCount).toBe(2)

        useSceneStore.getState().cancelSceneGeneration()
        expect(signal?.aborted).toBe(true)
        await run

        expect(sceneOf('a').queueCount).toBe(3)
        expect(sceneOf('a').images).toHaveLength(0)
        expect(useSceneStore.getState().isGenerating).toBe(false)
        expect(useSceneStore.getState().isCancelling).toBe(false)
        expect(useGenerationStore.getState().generatingMode).toBeNull()
    })

    it('작업을 보내는 사이에 취소했으면 받은 작업 번호로 멈춘다', async () => {
        setup({ a: 1 })
        generateImage.mockImplementation(async (_p: unknown, opts: { signal: AbortSignal; onQueued: (id: string) => void }) => {
            useSceneStore.getState().cancelSceneGeneration()
            opts.onQueued('pid-1')
            return { success: false, interrupted: true, seed: 0 }
        })
        const id = useSceneStore.getState().startNewGenerationSession()
        await runSceneQueue(id)
        expect(interruptPrompt).toHaveBeenCalledWith('pid-1')
        expect(sceneOf('a').queueCount).toBe(1)
    })

    it('ComfyUI가 꺼져 있으면 예약을 쓰지 않고 멈추고 고치는 방법을 알린다', async () => {
        setup({ a: 2 })
        pingComfy.mockResolvedValue({ ok: false })
        const id = useSceneStore.getState().startNewGenerationSession()
        await runSceneQueue(id)
        expect(generateImage).not.toHaveBeenCalled()
        expect(sceneOf('a').queueCount).toBe(2)
        expect(useSceneStore.getState().isGenerating).toBe(false)
        expect(toastTitles()).toContain('ComfyUI에 연결할 수 없어 씬 생성을 멈췄습니다')
    })

    it('그리는 중에 ComfyUI가 꺼지면 그 장의 예약을 되돌리고 멈춘다', async () => {
        setup({ a: 3 })
        pingComfy.mockResolvedValueOnce({ ok: true }).mockResolvedValue({ ok: false })
        generateImage.mockResolvedValueOnce(ok).mockResolvedValue({ success: false, error: 'ComfyUI에 연결하지 못했습니다', seed: 0 })
        const id = useSceneStore.getState().startNewGenerationSession()
        await runSceneQueue(id)
        expect(generateImage).toHaveBeenCalledTimes(2)
        expect(sceneOf('a').images).toHaveLength(1)
        expect(sceneOf('a').queueCount).toBe(2)
        expect(useSceneStore.getState().isGenerating).toBe(false)
    })

    it('한 장 실패는 알리고 다음 씬으로 넘어간다', async () => {
        setup({ a: 1, b: 1 })
        generateImage.mockResolvedValueOnce({ success: false, error: 'CUDA out of memory', seed: 0 }).mockResolvedValue(ok)
        const id = useSceneStore.getState().startNewGenerationSession()
        await runSceneQueue(id)
        expect(generateImage).toHaveBeenCalledTimes(2)
        expect(sceneOf('a').images).toHaveLength(0)
        expect(sceneOf('b').images).toHaveLength(1)
        expect(toastTitles()).toContain('"{{name}}" 씬을 그리지 못했습니다')
        expect(useSceneStore.getState().isGenerating).toBe(false)
    })

    it('같은 오류로 연속 3장 실패하면 예약을 되돌리고 멈춘다', async () => {
        setup({ a: 5 })
        generateImage.mockResolvedValue({ success: false, error: 'ComfyUI에 없는 노드가 필요합니다: X', seed: 0 })
        const id = useSceneStore.getState().startNewGenerationSession()
        await runSceneQueue(id)
        expect(generateImage).toHaveBeenCalledTimes(3)
        expect(sceneOf('a').queueCount).toBe(5)
        expect(useSceneStore.getState().isGenerating).toBe(false)
    })

    it('메인 생성 중이면 시작하지 않는다', async () => {
        setup({ a: 1 })
        useGenerationStore.setState({ generatingMode: 'main' })
        const id = useSceneStore.getState().startNewGenerationSession()
        await runSceneQueue(id)
        expect(generateImage).not.toHaveBeenCalled()
        expect(useSceneStore.getState().isGenerating).toBe(false)
        expect(useGenerationStore.getState().generatingMode).toBe('main')
    })

    it('한 번에 한 줄만 돈다 (두 번 불러도 같은 그림을 두 번 그리지 않는다)', async () => {
        setup({ a: 2 })
        generateImage.mockResolvedValue(ok)
        const id = useSceneStore.getState().startNewGenerationSession()
        await Promise.all([runSceneQueue(id), runSceneQueue(id)])
        expect(generateImage).toHaveBeenCalledTimes(2)
        expect(sceneOf('a').images).toHaveLength(2)
    })

    it('씬 해상도를 정했으면 그 크기, 아니면 메인 해상도(undefined로 넘김)', async () => {
        setup({ a: 1, b: 1 })
        useSceneStore.setState(s => ({ presets: s.presets.map(p => ({ ...p, scenes: p.scenes.map(sc => sc.id === 'a' ? { ...sc, width: 1216, height: 832 } : sc) })) }))
        generateImage.mockResolvedValue(ok)
        const id = useSceneStore.getState().startNewGenerationSession()
        await runSceneQueue(id)
        const [a, b] = generateImage.mock.calls.map(c => c[0] as { prompt: string; seed: number; width?: number; height?: number })
        expect(a).toMatchObject({ prompt: 'base, a', width: 1216, height: 832 })
        expect(a.seed).toBeGreaterThan(0)
        expect(b.width).toBeUndefined()
    })

    it('시드를 고정했으면 그 시드로 그린다', async () => {
        setup({ a: 1 })
        useGenerationStore.setState({ seedLocked: true, seed: 12345 })
        generateImage.mockResolvedValue(ok)
        const id = useSceneStore.getState().startNewGenerationSession()
        await runSceneQueue(id)
        expect((generateImage.mock.calls[0][0] as { seed: number }).seed).toBe(12345)
    })
})
