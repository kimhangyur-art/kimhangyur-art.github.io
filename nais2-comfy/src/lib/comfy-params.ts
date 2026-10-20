// 지금 화면의 설정(프롬프트·생성 설정·캐릭터 프롬프트)으로 생성 요청을 만든다.
// 메인 생성, 씬 모드, 변형 모드, 다시 생성, 고화질로 다시 그리기가 모두 이 함수들을 쓴다.
import { useGenerationStore } from '@/stores/generation-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useSettingsStore } from '@/stores/settings-store'
import { processWildcards } from '@/lib/fragment-processor'
import { joinPrompt, removeComments } from '@/services/comfy/prompt-syntax'
import { normalizeSampler, normalizeScheduler, type FamilyId } from '@/services/comfy/families'
import { roundTo8 } from '@/services/comfy/workflow'
import { generateImage, upscaleImage, type GenerateOptions, type GenerateResult, type GenerationParams, type HiresSettings, type LoraEntry } from '@/services/comfyui-api'
import { parseMetadataFromBase64, type NAIMetadata } from '@/lib/metadata-parser'
import { saveOutputImage, bytesToBase64, type SaveResult } from '@/lib/output-save'
import { readFile } from '@tauri-apps/plugin-fs'

export interface PromptOverrides {
    /** 씬 프롬프트 (추가 프롬프트와 세부 프롬프트 사이에 들어간다, 원래 NAIS2 씬 모드 순서) */
    scenePrompt?: string
    /** 변형 모드: 합친 긍정 프롬프트를 마지막에 바꾼다 */
    transformPositive?: (prompt: string) => string
}

export interface BuildOptions extends PromptOverrides {
    width?: number
    height?: number
    seed?: number
    /** 고화질 단계를 이번만 켜거나 끈다 */
    hires?: HiresSettings | null
}

/** 프롬프트 칸들을 합치고 조각(와일드카드)을 푼다. 부를 때마다 와일드카드를 새로 뽑는다. */
export async function buildGenerationParams(opts: BuildOptions = {}): Promise<GenerationParams> {
    const g = useGenerationStore.getState()
    const parts = [removeComments(g.basePrompt), removeComments(g.additionalPrompt), removeComments(opts.scenePrompt ?? ''), removeComments(g.detailPrompt)]
    let prompt = await processWildcards(joinPrompt(...parts))
    if (opts.transformPositive) prompt = opts.transformPositive(prompt)
    const negative = await processWildcards(removeComments(g.negativePrompt))

    const { characters } = useCharacterPromptStore.getState()
    const characterPrompts = await Promise.all(
        characters
            .filter((c) => c.enabled)
            .map(async (c) => ({
                prompt: await processWildcards(removeComments(c.prompt)),
                negative: await processWildcards(removeComments(c.negative)),
                enabled: true,
                position: c.position,
            })),
    )

    return {
        prompt,
        negative_prompt: negative,
        model: g.model,
        modelFamily: g.modelFamily,
        width: roundTo8(opts.width ?? g.selectedResolution.width),
        height: roundTo8(opts.height ?? g.selectedResolution.height),
        steps: g.steps,
        cfg_scale: g.cfgScale,
        cfg_rescale: g.cfgRescale,
        sampler: g.sampler,
        scheduler: g.scheduler,
        seed: opts.seed ?? g.seed,
        clipSkip: g.clipSkip,
        loras: g.loras,
        hires: opts.hires !== undefined ? opts.hires : g.hires,
        characterPrompts,
        qualityToggle: g.qualityToggle,
        ucPreset: g.ucPreset,
        promptParts: {
            base: g.basePrompt,
            additional: g.additionalPrompt,
            detail: g.detailPrompt,
            negative: g.negativePrompt,
        },
    }
}

interface ComfyMetaShape {
    checkpoint?: string
    family?: FamilyId
    loras?: Array<{ name: string; strengthModel: number; strengthClip: number }>
    clipSkip?: number
    hires?: HiresSettings | null
}

/**
 * 그림 메타데이터로 생성 요청을 만든다 (다시 생성, 고화질로 다시 그리기).
 * 없는 값은 지금 설정에서 채운다. NAI 그림이면 체크포인트·로라는 지금 설정을 쓴다.
 */
export function paramsFromMetadata(meta: NAIMetadata | null): GenerationParams {
    const g = useGenerationStore.getState()
    const comfy = ((meta?.raw as Record<string, unknown> | undefined)?.comfy ?? null) as ComfyMetaShape | null
    const chars = meta?.v4_prompt?.caption?.char_captions ?? []
    const charNeg = meta?.v4_negative_prompt?.caption?.char_captions ?? []
    const loras: LoraEntry[] = comfy?.loras
        ? comfy.loras.map((l, i) => ({ id: `meta-${i}`, name: l.name, enabled: true, strengthModel: l.strengthModel, strengthClip: l.strengthClip }))
        : g.loras
    // 우리 그림이면 v4 base_caption 이 합치기 전 프롬프트, prompt 도 같다
    const prompt = meta?.v4_prompt?.caption?.base_caption ?? meta?.prompt ?? joinPrompt(g.basePrompt, g.additionalPrompt, g.detailPrompt)
    return {
        prompt,
        negative_prompt: meta?.negativePrompt ?? g.negativePrompt,
        model: comfy?.checkpoint || g.model,
        modelFamily: comfy?.family ?? g.modelFamily,
        width: meta?.width ?? g.selectedResolution.width,
        height: meta?.height ?? g.selectedResolution.height,
        steps: meta?.steps ?? g.steps,
        cfg_scale: meta?.cfgScale ?? g.cfgScale,
        cfg_rescale: meta?.cfgRescale ?? g.cfgRescale,
        sampler: normalizeSampler(meta?.sampler ?? g.sampler),
        scheduler: normalizeScheduler(meta?.scheduler ?? g.scheduler),
        seed: meta?.seed ?? 0,
        clipSkip: comfy?.clipSkip ?? g.clipSkip,
        loras,
        hires: comfy?.hires ?? null,
        characterPrompts: chars.map((c, i) => ({ prompt: c.char_caption, negative: charNeg[i]?.char_caption ?? '', enabled: true, position: c.centers?.[0] })),
        // 이미 붙어 있는 품질 태그·UC를 또 붙이지 않게, 메타데이터에 적힌 대로만
        qualityToggle: meta?.qualityToggle ?? false,
        ucPreset: meta?.ucPreset ?? 4,
        promptParts: meta?.promptParts,
    }
}

export async function readImageBytes(source: { path?: string; dataUrl?: string; bytes?: Uint8Array }): Promise<Uint8Array> {
    if (source.bytes) return source.bytes
    if (source.dataUrl) {
        const b64 = source.dataUrl.replace(/^data:[^,]+,/, '')
        const bin = atob(b64)
        const out = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
        return out
    }
    if (source.path && !source.path.startsWith('memory://')) return readFile(source.path)
    throw new Error('그림을 읽지 못했습니다')
}

export async function metadataOf(bytes: Uint8Array): Promise<NAIMetadata | null> {
    try {
        return await parseMetadataFromBase64(bytesToBase64(bytes))
    } catch {
        return null
    }
}

export interface UpscaleRequest {
    path?: string
    dataUrl?: string
    bytes?: Uint8Array
    /** 씬 그림이면 씬 폴더에 저장 */
    sceneContext?: { presetName: string; sceneName: string }
    scale?: number
    denoise?: number
    useCurrentSettings?: boolean
}

export interface UpscaleOutcome extends GenerateResult {
    saved?: SaveResult
}

let activeUpscales = 0
const upscaleWatchers = new Set<(n: number) => void>()
export function onUpscaleCount(fn: (n: number) => void): () => void {
    upscaleWatchers.add(fn)
    fn(activeUpscales)
    return () => upscaleWatchers.delete(fn)
}

/** 이미 있는 그림을 고화질로 다시 그려 원본 옆에 저장한다 (시드 고정 없이) */
export async function upscaleExisting(req: UpscaleRequest, opts: GenerateOptions = {}): Promise<UpscaleOutcome> {
    activeUpscales++
    upscaleWatchers.forEach((f) => f(activeUpscales))
    try {
        const bytes = await readImageBytes(req)
        const meta = req.useCurrentSettings ? null : await metadataOf(bytes)
        const params = req.useCurrentSettings ? await buildGenerationParams({ hires: null }) : paramsFromMetadata(meta)
        const s = useSettingsStore.getState()
        const r = await upscaleImage(bytes, params, {
            ...opts,
            scale: req.scale ?? s.upscaleScale,
            denoise: req.denoise ?? s.upscaleDenoise,
            method: s.upscaleMethod,
            upscaleModel: s.upscaleModel,
        })
        if (!r.success || !r.bytes) return r
        const saved = req.sceneContext
            ? await saveOutputImage(r.bytes, { kind: 'scene', presetName: req.sceneContext.presetName, sceneName: req.sceneContext.sceneName })
            : await saveOutputImage(r.bytes, { kind: 'upscale', sourcePath: req.path })
        return { ...r, saved }
    } finally {
        activeUpscales--
        upscaleWatchers.forEach((f) => f(activeUpscales))
    }
}

/** 메타데이터로 새 시드 다시 생성 (MainMode·HistoryPanel의 '다시 생성') */
export async function regenerateFromImage(source: { path?: string; dataUrl?: string; bytes?: Uint8Array }, opts: GenerateOptions = {}): Promise<UpscaleOutcome> {
    const bytes = await readImageBytes(source)
    const meta = await metadataOf(bytes)
    if (!meta) return { success: false, error: '이 그림에서 생성 정보를 찾지 못했습니다', seed: 0 }
    const params = { ...paramsFromMetadata(meta), seed: 0 }
    const r = await generateImage(params, opts)
    if (!r.success || !r.bytes) return r
    const saved = await saveOutputImage(r.bytes, { kind: 'main' })
    return { ...r, saved }
}
