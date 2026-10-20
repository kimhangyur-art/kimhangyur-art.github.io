// NAIS2의 생성 요청을 ComfyUI 작업으로 바꿔 실행하고, 결과 PNG에 NAIS2가 읽을 수 있는 메타데이터를 넣는다.
// (원래 services/novelai-api.ts 자리. 화면 쪽은 generateImage 하나만 부르면 된다.)
//
// 1. 프롬프트 정리: 캐릭터 프롬프트 합치기 → 품질 태그·UC 프리셋 글 붙이기 → NAI 문법을 ComfyUI 문법으로
// 2. ComfyUI 작업 만들기 (services/comfy/workflow.ts) → 등록 → WebSocket으로 진행률·미리보기 → 결과 받기
// 3. 결과 PNG에 'Comment'(NAI 형식 JSON + comfy 항목), 'Source'(체크포인트), 'nais2-params' 를 넣는다
//    → 기존 metadata-parser / MetadataDialog / 다시 생성이 그대로 동작한다.
import { useSettingsStore } from '@/stores/settings-store'
import { useComfyStore } from '@/stores/comfy-store'
import { ComfyError, ComfyInterrupted, runPrompt, uploadImage } from './comfy/client'
import { buildTxt2Img, buildUpscale, nodeTypes, roundTo8, type BuiltPrompt, type HiresMethod } from './comfy/workflow'
import { getFamily, normalizeSampler, normalizeScheduler, type FamilyId } from './comfy/families'
import { flattenLines, joinPrompt, naiToComfy } from './comfy/prompt-syntax'
import { embedTextChunks } from '@/lib/png-text'
import type { Nais2PromptParts } from '@/lib/nais2-png-meta'

export interface LoraEntry {
    id: string
    name: string
    enabled: boolean
    strengthModel: number
    strengthClip: number
}

export interface HiresSettings {
    enabled: boolean
    method: HiresMethod
    scale: number
    denoise: number
    steps: number
    upscaleModel: string
}

export const DEFAULT_HIRES: HiresSettings = {
    enabled: false,
    method: 'latent',
    scale: 1.5,
    denoise: 0.4,
    steps: 15,
    upscaleModel: '',
}

export interface CharacterPromptInput {
    prompt: string
    negative: string
    enabled: boolean
    position?: { x: number; y: number }
}

export interface GenerationParams {
    /** 합친 긍정 프롬프트 (NAI 문법 그대로 넣어도 된다) */
    prompt: string
    negative_prompt: string
    /** 체크포인트 파일 이름 */
    model: string
    modelFamily?: FamilyId | 'auto'
    width: number
    height: number
    steps: number
    cfg_scale: number
    /** 0보다 크면 RescaleCFG (v-pred 계열은 계열 기본값을 쓴다) */
    cfg_rescale?: number
    sampler: string
    scheduler: string
    seed: number
    clipSkip: number
    loras: LoraEntry[]
    hires?: HiresSettings | null
    characterPrompts?: CharacterPromptInput[]
    qualityToggle?: boolean
    ucPreset?: number
    promptParts?: Nais2PromptParts
    /** 변형 모드에서 무엇을 바꾼 그림인지 */
    variant?: { label: string; values: Record<string, string> }
}

export interface GenerateOptions {
    signal?: AbortSignal
    /** progress: 0~100, preview: 미리보기 이미지 data URL */
    onProgress?: (progress: number, preview?: string) => void
    onQueued?: (promptId: string) => void
}

export interface GenerateResult {
    success: boolean
    /** 메타데이터를 넣은 PNG (base64, data: 접두어 없음) */
    imageData?: string
    bytes?: Uint8Array
    error?: string
    interrupted?: boolean
    seed: number
    width?: number
    height?: number
    finalPrompt?: string
    finalNegative?: string
}

// ---------------------------------------------------------------------------
// 프롬프트 정리

/** UC 프리셋 번호: 0 = 강하게(권장), 1 = 가볍게, 4 = 없음 (2·3은 NAI 전용이라 0과 같게 본다) */
export const UC_PRESET_NONE = 4

export interface FinalPrompts {
    positive: string
    negative: string
    family: ReturnType<typeof getFamily>
}

export function finalizePrompts(p: Pick<GenerationParams, 'prompt' | 'negative_prompt' | 'model' | 'modelFamily' | 'characterPrompts' | 'qualityToggle' | 'ucPreset'>): FinalPrompts {
    const settings = useSettingsStore.getState()
    const family = getFamily(p.modelFamily, p.model)
    const chars = (p.characterPrompts ?? []).filter((c) => c.enabled)
    let positive = joinPrompt(flattenLines(p.prompt), ...chars.map((c) => flattenLines(c.prompt)))
    let negative = joinPrompt(flattenLines(p.negative_prompt), ...chars.map((c) => flattenLines(c.negative)))

    if (p.qualityToggle) {
        const tags = settings.qualityTagsCustom.trim() || family.qualityTags
        positive = family.qualityAtEnd ? joinPrompt(positive, tags) : joinPrompt(tags, positive)
    }
    const uc = p.ucPreset ?? 0
    if (uc !== UC_PRESET_NONE) {
        const preset = settings.negativePresetCustom.trim() || (uc === 1 ? family.negativeLight : family.negativeHeavy)
        negative = joinPrompt(preset, negative)
    }
    if (settings.naiSyntax) {
        positive = naiToComfy(positive)
        negative = naiToComfy(negative)
    }
    return { positive, negative, family }
}

// ---------------------------------------------------------------------------
// 메타데이터

function asciiJson(v: unknown): string {
    return JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
}

function base64FromBytes(bytes: Uint8Array): string {
    let s = ''
    const chunk = 32768
    for (let i = 0; i < bytes.length; i += chunk) {
        s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + chunk, bytes.length))))
    }
    return btoa(s)
}

export interface ComfyMetaExtra {
    checkpoint: string
    family: FamilyId
    loras: Array<{ name: string; strengthModel: number; strengthClip: number }>
    clipSkip: number
    hires: HiresSettings | null
    positive: string
    negative: string
    app: 'NAIS2 Comfy'
    upscaledFrom?: { scale: number; denoise: number; method: string }
    variant?: GenerationParams['variant']
}

function buildComment(p: GenerationParams, seed: number, fin: FinalPrompts, width: number, height: number, extra?: Partial<ComfyMetaExtra>) {
    const chars = (p.characterPrompts ?? []).filter((c) => c.enabled)
    const comfy: ComfyMetaExtra = {
        checkpoint: p.model,
        family: fin.family.id,
        loras: p.loras.filter((l) => l.enabled).map((l) => ({ name: l.name, strengthModel: l.strengthModel, strengthClip: l.strengthClip })),
        clipSkip: p.clipSkip,
        hires: p.hires?.enabled ? p.hires : null,
        positive: fin.positive,
        negative: fin.negative,
        app: 'NAIS2 Comfy',
        ...(p.variant ? { variant: p.variant } : {}),
        ...extra,
    }
    return {
        prompt: p.prompt,
        uc: p.negative_prompt,
        steps: p.steps,
        scale: p.cfg_scale,
        cfg_rescale: p.cfg_rescale ?? 0,
        seed,
        sampler: p.sampler,
        noise_schedule: p.scheduler,
        width,
        height,
        qualityToggle: !!p.qualityToggle,
        ucPreset: p.ucPreset ?? 0,
        v4_prompt: {
            caption: {
                base_caption: p.prompt,
                char_captions: chars.map((c) => ({ char_caption: c.prompt, centers: [c.position ?? { x: 0.5, y: 0.5 }] })),
            },
            use_coords: false,
            use_order: true,
        },
        v4_negative_prompt: {
            caption: {
                base_caption: p.negative_prompt,
                char_captions: chars.map((c) => ({ char_caption: c.negative, centers: [c.position ?? { x: 0.5, y: 0.5 }] })),
            },
        },
        comfy,
    }
}

function withMetadata(bytes: Uint8Array, p: GenerationParams, seed: number, fin: FinalPrompts, width: number, height: number, extra?: Partial<ComfyMetaExtra>): Uint8Array {
    const comment = buildComment(p, seed, fin, width, height, extra)
    const nais2 = { version: 1, qualityToggle: !!p.qualityToggle, ucPreset: p.ucPreset ?? 0, promptParts: p.promptParts }
    return embedTextChunks(bytes, [
        ['Comment', asciiJson(comment)],
        ['Source', p.model],
        ['Software', 'NAIS2 Comfy'],
        ['nais2-params', base64FromBytes(new TextEncoder().encode(JSON.stringify(nais2)))],
    ])
}

// ---------------------------------------------------------------------------
// 실행

function checkReady(p: GenerationParams): string | null {
    if (!p.model) return '체크포인트(모델)를 고르세요. 프롬프트 아래 [생성 설정](톱니바퀴)에서 고를 수 있습니다.'
    return null
}

function missingNodes(built: BuiltPrompt): string[] {
    const known = useComfyStore.getState().lists.nodeTypes
    if (!known.length) return []
    return nodeTypes(built.prompt).filter((t) => !known.includes(t))
}

function progressHandler(opts: GenerateOptions, stages: number) {
    let stage = 0
    let lastMax = 0
    let lastValue = 0
    let previewUrl: string | null = null
    return {
        onProgress: (e: { value: number; max: number }) => {
            // 고화질 단계가 있으면 KSampler가 두 번 돈다: 진행률을 단계별로 나눠 보여 준다
            if (e.value < lastValue || (lastMax && e.max !== lastMax && e.value <= 1)) stage = Math.min(stage + 1, stages - 1)
            lastMax = e.max
            lastValue = e.value
            const pct = ((stage + e.value / Math.max(1, e.max)) / stages) * 100
            opts.onProgress?.(Math.min(99, Math.round(pct)), previewUrl ?? undefined)
        },
        onPreview: (blob: Blob) => {
            const reader = new FileReader()
            reader.onload = () => {
                previewUrl = String(reader.result)
                const pct = ((stage + lastValue / Math.max(1, lastMax || 1)) / stages) * 100
                opts.onProgress?.(Math.min(99, Math.round(pct)), previewUrl)
            }
            reader.readAsDataURL(blob)
        },
    }
}

function fail(e: unknown, seed: number): GenerateResult {
    if (e instanceof ComfyInterrupted) return { success: false, interrupted: true, error: '중단했습니다', seed }
    if (e instanceof ComfyError) return { success: false, error: e.message, seed }
    return { success: false, error: (e as Error)?.message ?? String(e), seed }
}

/** 새로 그리기 (txt2img, 고화질 단계 포함 가능) */
export async function generateImage(params: GenerationParams, opts: GenerateOptions = {}): Promise<GenerateResult> {
    const seed = params.seed > 0 ? Math.floor(params.seed) : Math.floor(Math.random() * 4294967295)
    const p: GenerationParams = { ...params, seed, sampler: normalizeSampler(params.sampler), scheduler: normalizeScheduler(params.scheduler) }
    const notReady = checkReady(p)
    if (notReady) return { success: false, error: notReady, seed }
    try {
        const fin = finalizePrompts(p)
        const fam = fin.family
        const settings = useSettingsStore.getState()
        const hires = p.hires?.enabled && p.hires.scale > 1 ? p.hires : null
        const built = buildTxt2Img({
            checkpoint: p.model,
            loras: p.loras.filter((l) => l.enabled && l.name).map((l) => ({ name: l.name, strengthModel: l.strengthModel, strengthClip: l.strengthClip })),
            clipSkip: p.clipSkip,
            vpred: fam.vpred,
            zsnr: fam.zsnr,
            rescaleCfg: p.cfg_rescale && p.cfg_rescale > 0 ? p.cfg_rescale : fam.rescaleCfg,
            positive: fin.positive,
            negative: fin.negative,
            width: roundTo8(p.width),
            height: roundTo8(p.height),
            steps: p.steps,
            cfg: p.cfg_scale,
            sampler: p.sampler,
            scheduler: p.scheduler,
            seed,
            hires: hires ? { method: hires.method, scale: hires.scale, denoise: hires.denoise, steps: hires.steps, upscaleModel: hires.upscaleModel } : null,
            output: { mode: settings.comfyOutput, filenamePrefix: 'NAIS2Comfy/NAIS' },
        })
        const missing = missingNodes(built)
        if (missing.length) return { success: false, error: `ComfyUI에 없는 노드가 필요합니다: ${missing.join(', ')}`, seed }
        const prog = progressHandler(opts, hires ? 2 : 1)
        const r = await runPrompt(built.prompt, {
            outputNode: built.outputNode,
            signal: opts.signal,
            onQueued: opts.onQueued,
            onProgress: prog.onProgress,
            onPreview: prog.onPreview,
        })
        const bytes = withMetadata(r.bytes, p, seed, fin, built.width, built.height)
        opts.onProgress?.(100)
        return { success: true, bytes, imageData: base64FromBytes(bytes), seed, width: built.width, height: built.height, finalPrompt: fin.positive, finalNegative: fin.negative }
    } catch (e) {
        return fail(e, seed)
    }
}

export interface UpscaleOptions extends GenerateOptions {
    scale: number
    denoise: number
    method: 'pixel' | 'model'
    upscaleModel?: string
    /** 확대 단계 스텝 수 (없으면 생성 스텝의 절반 정도) */
    steps?: number
}

function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
    if (bytes.length < 24 || bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { width: dv.getUint32(16), height: dv.getUint32(20) }
}

async function imageSize(bytes: Uint8Array): Promise<{ width: number; height: number }> {
    const fromPng = pngSize(bytes)
    if (fromPng) return fromPng
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart]))
    const s = { width: bmp.width, height: bmp.height }
    bmp.close()
    return s
}

/**
 * 이미 있는 그림을 고화질로 다시 그리기. 시드를 몰라도 된다 (그림 자체에서 시작한다).
 * params 는 그림의 메타데이터(없으면 지금 설정)에서 만든 값.
 */
export async function upscaleImage(source: Uint8Array, params: GenerationParams, opts: UpscaleOptions): Promise<GenerateResult> {
    const seed = Math.floor(Math.random() * 4294967295)
    const p: GenerationParams = { ...params, seed, sampler: normalizeSampler(params.sampler), scheduler: normalizeScheduler(params.scheduler), hires: null }
    const notReady = checkReady(p)
    if (notReady) return { success: false, error: notReady, seed }
    try {
        const size = await imageSize(source)
        const name = await uploadImage(source, `upscale_${Date.now()}.png`)
        const fin = finalizePrompts(p)
        const fam = fin.family
        const settings = useSettingsStore.getState()
        const steps = Math.max(1, Math.round(opts.steps ?? Math.max(10, Math.round(p.steps * 0.6))))
        const built = buildUpscale({
            checkpoint: p.model,
            loras: p.loras.filter((l) => l.enabled && l.name).map((l) => ({ name: l.name, strengthModel: l.strengthModel, strengthClip: l.strengthClip })),
            clipSkip: p.clipSkip,
            vpred: fam.vpred,
            zsnr: fam.zsnr,
            rescaleCfg: p.cfg_rescale && p.cfg_rescale > 0 ? p.cfg_rescale : fam.rescaleCfg,
            positive: fin.positive,
            negative: fin.negative,
            steps,
            cfg: p.cfg_scale,
            sampler: p.sampler,
            scheduler: p.scheduler,
            seed,
            image: name,
            sourceWidth: size.width,
            sourceHeight: size.height,
            scale: opts.scale,
            denoise: opts.denoise,
            method: opts.method,
            upscaleModel: opts.upscaleModel,
            output: { mode: settings.comfyOutput, filenamePrefix: 'NAIS2Comfy/NAIS_UPSCALE' },
        })
        const missing = missingNodes(built)
        if (missing.length) return { success: false, error: `ComfyUI에 없는 노드가 필요합니다: ${missing.join(', ')}`, seed }
        const prog = progressHandler(opts, 1)
        const r = await runPrompt(built.prompt, {
            outputNode: built.outputNode,
            signal: opts.signal,
            onQueued: opts.onQueued,
            onProgress: prog.onProgress,
            onPreview: prog.onPreview,
        })
        const bytes = withMetadata(r.bytes, { ...p, steps }, seed, fin, built.width, built.height, {
            upscaledFrom: { scale: opts.scale, denoise: opts.denoise, method: opts.method },
        })
        opts.onProgress?.(100)
        return { success: true, bytes, imageData: base64FromBytes(bytes), seed, width: built.width, height: built.height, finalPrompt: fin.positive, finalNegative: fin.negative }
    } catch (e) {
        return fail(e, seed)
    }
}
