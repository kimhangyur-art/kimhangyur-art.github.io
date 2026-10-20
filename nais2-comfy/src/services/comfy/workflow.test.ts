import { describe, expect, it } from 'vitest'
import { buildTxt2Img, buildUpscale, type ApiPrompt, type Txt2ImgSpec } from './workflow'

// ComfyUI 노드 입력·출력 종류 (nodes.py 기준, 이 프로그램이 쓰는 것만)
const SCHEMA: Record<string, { inputs: Record<string, string>; outputs: string[] }> = {
    CheckpointLoaderSimple: { inputs: { ckpt_name: 'COMBO' }, outputs: ['MODEL', 'CLIP', 'VAE'] },
    LoraLoader: { inputs: { model: 'MODEL', clip: 'CLIP', lora_name: 'COMBO', strength_model: 'FLOAT', strength_clip: 'FLOAT' }, outputs: ['MODEL', 'CLIP'] },
    CLIPSetLastLayer: { inputs: { clip: 'CLIP', stop_at_clip_layer: 'INT' }, outputs: ['CLIP'] },
    CLIPTextEncode: { inputs: { text: 'STRING', clip: 'CLIP' }, outputs: ['CONDITIONING'] },
    EmptyLatentImage: { inputs: { width: 'INT', height: 'INT', batch_size: 'INT' }, outputs: ['LATENT'] },
    KSampler: {
        inputs: { model: 'MODEL', seed: 'INT', steps: 'INT', cfg: 'FLOAT', sampler_name: 'COMBO', scheduler: 'COMBO', positive: 'CONDITIONING', negative: 'CONDITIONING', latent_image: 'LATENT', denoise: 'FLOAT' },
        outputs: ['LATENT'],
    },
    VAEDecode: { inputs: { samples: 'LATENT', vae: 'VAE' }, outputs: ['IMAGE'] },
    VAEEncode: { inputs: { pixels: 'IMAGE', vae: 'VAE' }, outputs: ['LATENT'] },
    PreviewImage: { inputs: { images: 'IMAGE' }, outputs: [] },
    SaveImage: { inputs: { images: 'IMAGE', filename_prefix: 'STRING' }, outputs: [] },
    LoadImage: { inputs: { image: 'COMBO' }, outputs: ['IMAGE', 'MASK'] },
    ImageScale: { inputs: { image: 'IMAGE', upscale_method: 'COMBO', width: 'INT', height: 'INT', crop: 'COMBO' }, outputs: ['IMAGE'] },
    LatentUpscaleBy: { inputs: { samples: 'LATENT', upscale_method: 'COMBO', scale_by: 'FLOAT' }, outputs: ['LATENT'] },
    UpscaleModelLoader: { inputs: { model_name: 'COMBO' }, outputs: ['UPSCALE_MODEL'] },
    ImageUpscaleWithModel: { inputs: { upscale_model: 'UPSCALE_MODEL', image: 'IMAGE' }, outputs: ['IMAGE'] },
    ModelSamplingDiscrete: { inputs: { model: 'MODEL', sampling: 'COMBO', zsnr: 'BOOLEAN' }, outputs: ['MODEL'] },
    RescaleCFG: { inputs: { model: 'MODEL', multiplier: 'FLOAT' }, outputs: ['MODEL'] },
}

const LINK_TYPES = new Set(['MODEL', 'CLIP', 'VAE', 'CONDITIONING', 'LATENT', 'IMAGE', 'UPSCALE_MODEL', 'MASK'])

/** ComfyUI validate_prompt 처럼: 필수 입력, 연결 대상, 연결 종류를 확인한다 */
function validate(p: ApiPrompt): string[] {
    const errors: string[] = []
    for (const [id, node] of Object.entries(p)) {
        const def = SCHEMA[node.class_type]
        if (!def) {
            errors.push(`${id}: unknown ${node.class_type}`)
            continue
        }
        for (const [name, type] of Object.entries(def.inputs)) {
            const v = node.inputs[name]
            if (v === undefined) {
                errors.push(`${id}.${name} missing`)
                continue
            }
            if (LINK_TYPES.has(type)) {
                if (!Array.isArray(v)) {
                    errors.push(`${id}.${name} must be a link`)
                    continue
                }
                const src = p[v[0]]
                if (!src) {
                    errors.push(`${id}.${name} -> missing node ${v[0]}`)
                    continue
                }
                const out = SCHEMA[src.class_type]?.outputs[v[1]]
                if (out !== type) errors.push(`${id}.${name} wants ${type} got ${out}`)
            } else if (Array.isArray(v)) {
                errors.push(`${id}.${name} should be a value`)
            } else if ((type === 'INT' || type === 'FLOAT') && typeof v !== 'number') {
                errors.push(`${id}.${name} should be a number`)
            } else if (type === 'INT' && !Number.isInteger(v)) {
                errors.push(`${id}.${name} should be an integer`)
            }
        }
        for (const k of Object.keys(node.inputs)) if (!(k in def.inputs)) errors.push(`${id}: unexpected input ${k}`)
    }
    return errors
}

const base: Txt2ImgSpec = {
    checkpoint: 'waiIllustriousSDXL_v170.safetensors',
    loras: [],
    clipSkip: 2,
    vpred: false,
    zsnr: false,
    rescaleCfg: 0,
    positive: '1girl',
    negative: 'worst quality',
    width: 832,
    height: 1216,
    steps: 28,
    cfg: 5.5,
    sampler: 'euler_ancestral',
    scheduler: 'normal',
    seed: 1234,
    output: { mode: 'preview' },
}

const count = (p: ApiPrompt, t: string) => Object.values(p).filter((n) => n.class_type === t).length

describe('buildTxt2Img', () => {
    it('builds a valid minimal graph', () => {
        const b = buildTxt2Img(base)
        expect(validate(b.prompt)).toEqual([])
        expect(count(b.prompt, 'KSampler')).toBe(1)
        expect(count(b.prompt, 'CLIPSetLastLayer')).toBe(1)
        expect(b.prompt[b.outputNode].class_type).toBe('PreviewImage')
        expect([b.width, b.height]).toEqual([832, 1216])
    })
    it('chains LoRAs and v-pred nodes', () => {
        const b = buildTxt2Img({
            ...base,
            vpred: true,
            zsnr: true,
            rescaleCfg: 0.7,
            loras: [
                { name: 'a.safetensors', strengthModel: 0.8, strengthClip: 1 },
                { name: 'b.safetensors', strengthModel: 0.5, strengthClip: 0.5 },
            ],
        })
        expect(validate(b.prompt)).toEqual([])
        expect(count(b.prompt, 'LoraLoader')).toBe(2)
        expect(count(b.prompt, 'ModelSamplingDiscrete')).toBe(1)
        expect(count(b.prompt, 'RescaleCFG')).toBe(1)
        const ks = Object.values(b.prompt).find((n) => n.class_type === 'KSampler')!
        // KSampler 모델은 마지막 로라에서 온다
        const modelSrc = b.prompt[(ks.inputs.model as [string, number])[0]]
        expect(modelSrc.class_type).toBe('LoraLoader')
        expect(modelSrc.inputs.lora_name).toBe('b.safetensors')
    })
    it('adds a latent hires pass', () => {
        const b = buildTxt2Img({ ...base, hires: { method: 'latent', scale: 1.5, denoise: 0.4, steps: 15 } })
        expect(validate(b.prompt)).toEqual([])
        expect(count(b.prompt, 'KSampler')).toBe(2)
        expect(count(b.prompt, 'LatentUpscaleBy')).toBe(1)
        expect([b.width, b.height]).toEqual([1248, 1824])
        const second = Object.values(b.prompt).filter((n) => n.class_type === 'KSampler')[1]
        expect(second.inputs.denoise).toBe(0.4)
        expect(second.inputs.seed).toBe(1234)
    })
    it('adds a pixel / model hires pass', () => {
        const px = buildTxt2Img({ ...base, hires: { method: 'pixel', scale: 1.5, denoise: 0.4, steps: 15 } })
        expect(validate(px.prompt)).toEqual([])
        expect(count(px.prompt, 'ImageScale')).toBe(1)
        expect(count(px.prompt, 'VAEDecode')).toBe(2)
        const md = buildTxt2Img({ ...base, hires: { method: 'model', scale: 2, denoise: 0.35, steps: 12, upscaleModel: '4x.pth' } })
        expect(validate(md.prompt)).toEqual([])
        expect(count(md.prompt, 'ImageUpscaleWithModel')).toBe(1)
        expect([md.width, md.height]).toEqual([1664, 2432])
    })
    it('skips the hires pass at scale 1 and the CLIP node at clipSkip 0', () => {
        const b = buildTxt2Img({ ...base, clipSkip: 0, hires: { method: 'latent', scale: 1, denoise: 0.4, steps: 15 } })
        expect(count(b.prompt, 'KSampler')).toBe(1)
        expect(count(b.prompt, 'CLIPSetLastLayer')).toBe(0)
        expect(validate(b.prompt)).toEqual([])
    })
    it('uses SaveImage when asked', () => {
        const b = buildTxt2Img({ ...base, output: { mode: 'save', filenamePrefix: 'X/Y' } })
        expect(b.prompt[b.outputNode].class_type).toBe('SaveImage')
        expect(b.prompt[b.outputNode].inputs.filename_prefix).toBe('X/Y')
    })
    it('rounds sizes to multiples of 8 and clamps seeds', () => {
        const b = buildTxt2Img({ ...base, width: 835, height: 1219, seed: -5 })
        const lat = Object.values(b.prompt).find((n) => n.class_type === 'EmptyLatentImage')!
        expect([lat.inputs.width, lat.inputs.height]).toEqual([832, 1216])
        const ks = Object.values(b.prompt).find((n) => n.class_type === 'KSampler')!
        expect(ks.inputs.seed).toBe(0)
    })
})

describe('buildUpscale', () => {
    it('re-draws an uploaded image at a larger size', () => {
        const { output, ...rest } = base
        const b = buildUpscale({ ...rest, output, image: 'nais2-comfy/x.png', sourceWidth: 832, sourceHeight: 1216, scale: 1.5, denoise: 0.4, method: 'pixel' })
        expect(validate(b.prompt)).toEqual([])
        expect(count(b.prompt, 'LoadImage')).toBe(1)
        expect(count(b.prompt, 'EmptyLatentImage')).toBe(0)
        expect([b.width, b.height]).toEqual([1248, 1824])
        const ks = Object.values(b.prompt).find((n) => n.class_type === 'KSampler')!
        expect(ks.inputs.denoise).toBe(0.4)
    })
})
