// ComfyUI API 형식 작업(프롬프트) 만들기. 기본 노드만 쓴다.
//
// 기본 생성:
//   CheckpointLoaderSimple → (v-pred면 ModelSamplingDiscrete, RescaleCFG) → LoraLoader … → CLIPSetLastLayer
//   → CLIPTextEncode(긍정/부정) → EmptyLatentImage → KSampler → [고화질 단계] → VAEDecode → PreviewImage|SaveImage
// 고화질 단계(hires fix): ComfyUI_examples/2_pass_txt2img 구조
//   latent: LatentUpscaleBy → KSampler(denoise)
//   pixel : VAEDecode → ImageScaleBy → VAEEncode → KSampler(denoise)
//   model : VAEDecode → ImageUpscaleWithModel → ImageScale(목표 크기) → VAEEncode → KSampler(denoise)
// 이미 있는 그림 고화질로 다시 그리기 (시드 없이):
//   LoadImage → (모델 확대) → ImageScale(목표 크기) → VAEEncode → KSampler(denoise) → VAEDecode → 출력

export type Link = [string, number]
export type InputValue = string | number | boolean | Link
export interface ApiNode {
    class_type: string
    inputs: Record<string, InputValue>
    _meta?: { title: string }
}
export type ApiPrompt = Record<string, ApiNode>

export interface LoraSpec {
    name: string
    strengthModel: number
    strengthClip: number
}

export type HiresMethod = 'latent' | 'pixel' | 'model'

export interface HiresSpec {
    method: HiresMethod
    /** 몇 배로 키울지 (1.5 = 1.5배) */
    scale: number
    denoise: number
    steps: number
    upscaleModel?: string
    /** 비우면 기본 단계와 같은 값 */
    sampler?: string
    scheduler?: string
    cfg?: number | null
}

export interface ModelSpec {
    checkpoint: string
    loras: LoraSpec[]
    /** 1 = 마지막 층(건너뛰지 않음), 2 = CLIP skip 2 … 0이면 노드를 넣지 않는다 */
    clipSkip: number
    vpred: boolean
    zsnr: boolean
    /** 0이면 RescaleCFG를 넣지 않는다 */
    rescaleCfg: number
}

export interface SamplingSpec {
    positive: string
    negative: string
    steps: number
    cfg: number
    sampler: string
    scheduler: string
    seed: number
}

export interface OutputSpec {
    /** preview: ComfyUI 임시 폴더(출력 폴더에 쌓이지 않음) / save: ComfyUI output 폴더에도 저장 */
    mode: 'preview' | 'save'
    filenamePrefix?: string
}

export interface Txt2ImgSpec extends ModelSpec, SamplingSpec {
    width: number
    height: number
    hires?: HiresSpec | null
    output: OutputSpec
}

export interface UpscaleSpec extends ModelSpec, SamplingSpec {
    /** ComfyUI input 폴더에 올린 이미지 이름 (uploadImage 결과) */
    image: string
    /** 원본 크기 */
    sourceWidth: number
    sourceHeight: number
    scale: number
    denoise: number
    method: 'pixel' | 'model'
    upscaleModel?: string
    output: OutputSpec
}

export const roundTo8 = (n: number) => Math.max(64, Math.round(n / 8) * 8)

/** 노드에 1부터 차례로 번호를 붙여 가며 만든다 */
class Builder {
    nodes: ApiPrompt = {}
    private n = 0
    add(class_type: string, inputs: Record<string, InputValue>, title?: string): string {
        const id = String(++this.n)
        this.nodes[id] = { class_type, inputs, ...(title ? { _meta: { title } } : {}) }
        return id
    }
}

interface ModelChain {
    model: Link
    clip: Link
    vae: Link
}

function buildModel(b: Builder, spec: ModelSpec): ModelChain {
    const ckpt = b.add('CheckpointLoaderSimple', { ckpt_name: spec.checkpoint }, '체크포인트')
    let model: Link = [ckpt, 0]
    let clip: Link = [ckpt, 1]
    const vae: Link = [ckpt, 2]
    if (spec.vpred) {
        const ms = b.add('ModelSamplingDiscrete', { model, sampling: 'v_prediction', zsnr: spec.zsnr }, 'v-prediction')
        model = [ms, 0]
    }
    if (spec.rescaleCfg > 0) {
        const rc = b.add('RescaleCFG', { model, multiplier: spec.rescaleCfg }, 'CFG 보정')
        model = [rc, 0]
    }
    for (const l of spec.loras) {
        const id = b.add('LoraLoader', {
            model,
            clip,
            lora_name: l.name,
            strength_model: l.strengthModel,
            strength_clip: l.strengthClip,
        }, `로라 ${l.name}`)
        model = [id, 0]
        clip = [id, 1]
    }
    if (spec.clipSkip > 0) {
        const cs = b.add('CLIPSetLastLayer', { clip, stop_at_clip_layer: -Math.round(spec.clipSkip) }, `CLIP skip ${spec.clipSkip}`)
        clip = [cs, 0]
    }
    return { model, clip, vae }
}

function encode(b: Builder, chain: ModelChain, s: SamplingSpec): { pos: Link; neg: Link } {
    const pos = b.add('CLIPTextEncode', { text: s.positive, clip: chain.clip }, '긍정 프롬프트')
    const neg = b.add('CLIPTextEncode', { text: s.negative, clip: chain.clip }, '부정 프롬프트')
    return { pos: [pos, 0], neg: [neg, 0] }
}

function output(b: Builder, image: Link, out: OutputSpec): string {
    if (out.mode === 'save') {
        return b.add('SaveImage', { images: image, filename_prefix: out.filenamePrefix || 'NAIS2Comfy/NAIS' }, '저장')
    }
    return b.add('PreviewImage', { images: image }, '결과')
}

function clampSeed(seed: number): number {
    if (!Number.isFinite(seed) || seed < 0) return 0
    return Math.floor(seed)
}

export interface BuiltPrompt {
    prompt: ApiPrompt
    outputNode: string
    /** 결과 그림 크기 */
    width: number
    height: number
}

export function buildTxt2Img(spec: Txt2ImgSpec): BuiltPrompt {
    const b = new Builder()
    const chain = buildModel(b, spec)
    const { pos, neg } = encode(b, chain, spec)
    const width = roundTo8(spec.width)
    const height = roundTo8(spec.height)
    const latent = b.add('EmptyLatentImage', { width, height, batch_size: 1 }, '빈 그림')
    const seed = clampSeed(spec.seed)
    const base = b.add('KSampler', {
        model: chain.model,
        seed,
        steps: spec.steps,
        cfg: spec.cfg,
        sampler_name: spec.sampler,
        scheduler: spec.scheduler,
        positive: pos,
        negative: neg,
        latent_image: [latent, 0],
        denoise: 1,
    }, '생성')

    let finalLatent: Link = [base, 0]
    let outW = width
    let outH = height
    const h = spec.hires
    if (h && h.scale > 1) {
        outW = roundTo8(width * h.scale)
        outH = roundTo8(height * h.scale)
        let upLatent: Link
        if (h.method === 'latent') {
            const up = b.add('LatentUpscaleBy', { samples: finalLatent, upscale_method: 'nearest-exact', scale_by: h.scale }, '고화질: 확대(latent)')
            upLatent = [up, 0]
            outW = roundTo8(Math.round((width / 8) * h.scale) * 8)
            outH = roundTo8(Math.round((height / 8) * h.scale) * 8)
        } else {
            const dec = b.add('VAEDecode', { samples: finalLatent, vae: chain.vae }, '고화질: 1차 그림')
            let img: Link = [dec, 0]
            if (h.method === 'model' && h.upscaleModel) {
                const loader = b.add('UpscaleModelLoader', { model_name: h.upscaleModel }, '업스케일 모델')
                const upm = b.add('ImageUpscaleWithModel', { upscale_model: [loader, 0], image: img }, '고화질: 모델 확대')
                img = [upm, 0]
            }
            const sc = b.add('ImageScale', { image: img, upscale_method: 'lanczos', width: outW, height: outH, crop: 'disabled' }, '고화질: 크기 맞추기')
            const enc = b.add('VAEEncode', { pixels: [sc, 0], vae: chain.vae }, '고화질: 인코드')
            upLatent = [enc, 0]
        }
        const second = b.add('KSampler', {
            model: chain.model,
            seed,
            steps: Math.max(1, Math.round(h.steps)),
            cfg: h.cfg ?? spec.cfg,
            sampler_name: h.sampler || spec.sampler,
            scheduler: h.scheduler || spec.scheduler,
            positive: pos,
            negative: neg,
            latent_image: upLatent,
            denoise: h.denoise,
        }, '고화질: 다듬기')
        finalLatent = [second, 0]
    }
    const decode = b.add('VAEDecode', { samples: finalLatent, vae: chain.vae }, '디코드')
    const out = output(b, [decode, 0], spec.output)
    return { prompt: b.nodes, outputNode: out, width: outW, height: outH }
}

export function buildUpscale(spec: UpscaleSpec): BuiltPrompt {
    const b = new Builder()
    const chain = buildModel(b, spec)
    const { pos, neg } = encode(b, chain, spec)
    const outW = roundTo8(spec.sourceWidth * spec.scale)
    const outH = roundTo8(spec.sourceHeight * spec.scale)
    const load = b.add('LoadImage', { image: spec.image }, '원본 그림')
    let img: Link = [load, 0]
    if (spec.method === 'model' && spec.upscaleModel) {
        const loader = b.add('UpscaleModelLoader', { model_name: spec.upscaleModel }, '업스케일 모델')
        const upm = b.add('ImageUpscaleWithModel', { upscale_model: [loader, 0], image: img }, '모델 확대')
        img = [upm, 0]
    }
    const sc = b.add('ImageScale', { image: img, upscale_method: 'lanczos', width: outW, height: outH, crop: 'disabled' }, '크기 맞추기')
    const enc = b.add('VAEEncode', { pixels: [sc, 0], vae: chain.vae }, '인코드')
    const ks = b.add('KSampler', {
        model: chain.model,
        seed: clampSeed(spec.seed),
        steps: spec.steps,
        cfg: spec.cfg,
        sampler_name: spec.sampler,
        scheduler: spec.scheduler,
        positive: pos,
        negative: neg,
        latent_image: [enc, 0],
        denoise: spec.denoise,
    }, '다듬기')
    const decode = b.add('VAEDecode', { samples: [ks, 0], vae: chain.vae }, '디코드')
    const out = output(b, [decode, 0], spec.output)
    return { prompt: b.nodes, outputNode: out, width: outW, height: outH }
}

/** 작업에 쓰인 노드 종류 (ComfyUI에 설치돼 있는지 확인용) */
export function nodeTypes(p: ApiPrompt): string[] {
    return [...new Set(Object.values(p).map((n) => n.class_type))]
}
