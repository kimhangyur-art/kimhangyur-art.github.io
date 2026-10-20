import { describe, expect, it } from 'vitest'
import { textChunk } from './png-text'
import { parseComfyPromptGraph, parseNAIMetadata } from './metadata-parser'
import { buildTxt2Img } from '@/services/comfy/workflow'

/** IHDR(1x1) + 글 조각 + IEND 만 있는 작은 PNG (읽기 쪽은 CRC를 검사하지 않는다) */
function tinyPng(extra: Uint8Array[] = []): Uint8Array {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10]
    const ihdr = new Uint8Array([0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0, 0, 0, 0])
    const iend = new Uint8Array([0, 0, 0, 0, 73, 69, 78, 68, 0xae, 0x42, 0x60, 0x82])
    const parts = [new Uint8Array(sig), ihdr, ...extra, iend]
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let o = 0
    for (const p of parts) {
        out.set(p, o)
        o += p.length
    }
    return out
}

function b64(json: unknown): string {
    const bytes = new TextEncoder().encode(JSON.stringify(json))
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s)
}

// ComfyUI 기본 작업 + LoRA 2개 + CLIP skip 2 + 고화질 단계(latent) + 프롬프트 글을 다른 노드에서 받는 경우
const GRAPH = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'SDXL/waiIllustrious_v140.safetensors' } },
    '10': { class_type: 'LoraLoader', inputs: { model: ['4', 0], clip: ['4', 1], lora_name: 'style_a.safetensors', strength_model: 0.8, strength_clip: 0.6 } },
    '11': { class_type: 'LoraLoader', inputs: { model: ['10', 0], clip: ['10', 1], lora_name: 'chara_b.safetensors', strength_model: 1, strength_clip: 1 } },
    '12': { class_type: 'ModelSamplingDiscrete', inputs: { model: ['11', 0], sampling: 'eps', zsnr: false } },
    '13': { class_type: 'RescaleCFG', inputs: { model: ['12', 0], multiplier: 0.5 } },
    '14': { class_type: 'CLIPSetLastLayer', inputs: { clip: ['11', 1], stop_at_clip_layer: -2 } },
    '20': { class_type: 'PrimitiveString', inputs: { value: '1girl, solo, smile' } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: ['20', 0], clip: ['14', 0] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'lowres, worst quality', clip: ['14', 0] } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
    '3': {
        class_type: 'KSampler',
        inputs: {
            model: ['13', 0], seed: 123456789, steps: 28, cfg: 5.5, sampler_name: 'euler_ancestral', scheduler: 'karras',
            positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], denoise: 1,
        },
    },
    // 고화질 단계: 2차 샘플러가 앞에 와도(번호가 작아도) 1차를 골라야 한다
    '2': {
        class_type: 'KSampler',
        inputs: {
            model: ['13', 0], seed: 999, steps: 15, cfg: 5.5, sampler_name: 'euler', scheduler: 'normal',
            positive: ['6', 0], negative: ['7', 0], latent_image: ['30', 0], denoise: 0.4,
        },
    },
    '30': { class_type: 'LatentUpscaleBy', inputs: { samples: ['3', 0], upscale_method: 'nearest-exact', scale_by: 1.5 } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['2', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'ComfyUI' } },
}

describe('metadata-parser', () => {
    it('reads a ComfyUI API graph when there is no Comment chunk', async () => {
        const png = tinyPng([textChunk('prompt', JSON.stringify(GRAPH)), textChunk('workflow', '{"nodes":[]}')])
        const m = await parseNAIMetadata(png)
        expect(m).not.toBeNull()
        expect(m!.prompt).toBe('1girl, solo, smile')
        expect(m!.negativePrompt).toBe('lowres, worst quality')
        expect(m!.seed).toBe(123456789)
        expect(m!.steps).toBe(28)
        expect(m!.cfgScale).toBe(5.5)
        expect(m!.sampler).toBe('euler_ancestral')
        expect(m!.scheduler).toBe('karras')
        expect(m!.width).toBe(832)
        expect(m!.height).toBe(1216)
        expect(m!.checkpoint).toBe('SDXL/waiIllustrious_v140.safetensors')
        expect(m!.model).toBe('SDXL/waiIllustrious_v140.safetensors')
        expect(m!.clipSkip).toBe(2)
        expect(m!.cfgRescale).toBe(0.5)
        // 적용 순서대로 (체크포인트 쪽부터)
        expect(m!.loras).toEqual([
            { name: 'style_a.safetensors', strengthModel: 0.8, strengthClip: 0.6 },
            { name: 'chara_b.safetensors', strengthModel: 1, strengthClip: 1 },
        ])
        expect(m!.hires).toMatchObject({ enabled: true, method: 'latent', scale: 1.5, denoise: 0.4, steps: 15 })
        // 최종 글이므로 품질 태그·UC 프리셋은 끈 것으로
        expect(m!.qualityToggle).toBe(false)
        expect(m!.ucPreset).toBe(4)
        const comfy = (m!.raw as { comfy: Record<string, unknown> }).comfy
        expect(comfy.checkpoint).toBe('SDXL/waiIllustrious_v140.safetensors')
        expect(comfy.clipSkip).toBe(2)
        expect(comfy.loras).toHaveLength(2)
    })

    it('treats a graph without CLIPSetLastLayer as no CLIP skip and finds pixel hires', () => {
        const m = parseComfyPromptGraph({
            '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'noobai-vpred.safetensors' } },
            '2': { class_type: 'ModelSamplingDiscrete', inputs: { model: ['1', 0], sampling: 'v_prediction', zsnr: true } },
            '3': { class_type: 'CLIPTextEncode', inputs: { text: 'cat', clip: ['1', 1] } },
            '4': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['1', 1] } },
            '5': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
            '6': { class_type: 'KSamplerAdvanced', inputs: { model: ['2', 0], noise_seed: 42, steps: 20, cfg: 4, sampler_name: 'euler', scheduler: 'normal', positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0] } },
            '7': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['1', 2] } },
            '8': { class_type: 'UpscaleModelLoader', inputs: { model_name: '4x-UltraSharp.pth' } },
            '9': { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['8', 0], image: ['7', 0] } },
            '10': { class_type: 'ImageScale', inputs: { image: ['9', 0], upscale_method: 'lanczos', width: 2048, height: 2048, crop: 'disabled' } },
            '11': { class_type: 'VAEEncode', inputs: { pixels: ['10', 0], vae: ['1', 2] } },
            '12': { class_type: 'KSampler', inputs: { model: ['2', 0], seed: 1, steps: 12, cfg: 4, sampler_name: 'euler', scheduler: 'normal', positive: ['3', 0], negative: ['4', 0], latent_image: ['11', 0], denoise: 0.35 } },
        })
        expect(m).not.toBeNull()
        expect(m!.seed).toBe(42)
        expect(m!.clipSkip).toBe(1)
        expect(m!.loras).toEqual([])
        expect(m!.hires).toEqual({ enabled: true, method: 'model', scale: 2, denoise: 0.35, steps: 12, upscaleModel: '4x-UltraSharp.pth' })
        expect((m!.raw as { comfy: { family: string } }).comfy.family).toBe('noobai-vpred')
    })

    it('reads our own Comment JSON with the comfy object', async () => {
        const comment = {
            prompt: '1girl, {{blue eyes}}',
            uc: 'lowres',
            steps: 30,
            scale: 6,
            cfg_rescale: 0,
            seed: 777,
            sampler: 'dpmpp_2m',
            noise_schedule: 'karras',
            width: 896,
            height: 1152,
            qualityToggle: true,
            ucPreset: 1,
            v4_prompt: { caption: { base_caption: '1girl, {{blue eyes}}', char_captions: [] } },
            v4_negative_prompt: { caption: { base_caption: 'lowres', char_captions: [] } },
            comfy: {
                checkpoint: 'animagine-xl-4.0.safetensors',
                family: 'animagine',
                loras: [{ name: 'detail.safetensors', strengthModel: 0.7, strengthClip: 0.5 }],
                clipSkip: 2,
                hires: { enabled: true, method: 'pixel', scale: 1.5, denoise: 0.4, steps: 15, upscaleModel: '' },
                positive: 'masterpiece, 1girl, (blue eyes:1.1)',
                negative: 'lowres',
                app: 'NAIS2 Comfy',
                variant: { label: '머리색=blonde hair', values: { 머리색: 'blonde hair' } },
            },
        }
        const nais2 = { version: 1, qualityToggle: true, ucPreset: 1, promptParts: { base: '1girl', additional: '{{blue eyes}}', detail: '', negative: 'lowres' } }
        const png = tinyPng([
            textChunk('prompt', JSON.stringify(GRAPH)),
            textChunk('Comment', JSON.stringify(comment)),
            textChunk('Source', 'animagine-xl-4.0.safetensors'),
            textChunk('nais2-params', b64(nais2)),
        ])
        const m = await parseNAIMetadata(png)
        expect(m).not.toBeNull()
        // Comment 가 있으면 그래프보다 Comment 를 쓴다
        expect(m!.prompt).toBe('1girl, {{blue eyes}}')
        expect(m!.seed).toBe(777)
        expect(m!.checkpoint).toBe('animagine-xl-4.0.safetensors')
        expect(m!.model).toBe('animagine-xl-4.0.safetensors')
        expect(m!.loras).toEqual([{ name: 'detail.safetensors', strengthModel: 0.7, strengthClip: 0.5 }])
        expect(m!.clipSkip).toBe(2)
        expect(m!.hires).toMatchObject({ enabled: true, method: 'pixel', scale: 1.5 })
        expect(m!.variant).toEqual({ label: '머리색=blonde hair', values: { 머리색: 'blonde hair' } })
        expect(m!.qualityToggle).toBe(true)
        expect(m!.ucPreset).toBe(1)
        expect(m!.promptParts).toMatchObject({ base: '1girl', additional: '{{blue eyes}}', negative: 'lowres' })
    })

    it('honors nais2-params even without a Comment chunk', async () => {
        const nais2 = { version: 1, qualityToggle: false, ucPreset: 4, promptParts: { base: '1girl, solo', additional: 'school uniform', detail: '', negative: 'bad hands' } }
        const m = await parseNAIMetadata(tinyPng([textChunk('nais2-params', b64(nais2))]))
        expect(m).not.toBeNull()
        expect(m!.qualityToggle).toBe(false)
        expect(m!.ucPreset).toBe(4)
        expect(m!.promptParts).toMatchObject({ base: '1girl, solo', additional: 'school uniform', detail: '', negative: 'bad hands' })
        expect(m!.prompt).toBe('1girl, solo, school uniform')
        expect(m!.negativePrompt).toBe('bad hands')
    })

    it('reads back the graph our own workflow builder makes', () => {
        const built = buildTxt2Img({
            checkpoint: 'noobaiXL_vpred10.safetensors',
            loras: [{ name: 'a.safetensors', strengthModel: 0.9, strengthClip: 0.8 }, { name: 'b.safetensors', strengthModel: 0.5, strengthClip: 0.5 }],
            clipSkip: 2,
            vpred: true,
            zsnr: true,
            rescaleCfg: 0.7,
            positive: 'masterpiece, 1girl',
            negative: 'worst quality',
            width: 832,
            height: 1216,
            steps: 28,
            cfg: 4.5,
            sampler: 'euler',
            scheduler: 'normal',
            seed: 31337,
            hires: { method: 'latent', scale: 1.5, denoise: 0.35, steps: 15 },
            output: { mode: 'preview' },
        })
        const m = parseComfyPromptGraph(built.prompt)
        expect(m).toMatchObject({
            prompt: 'masterpiece, 1girl',
            negativePrompt: 'worst quality',
            checkpoint: 'noobaiXL_vpred10.safetensors',
            clipSkip: 2,
            seed: 31337,
            steps: 28,
            cfgScale: 4.5,
            cfgRescale: 0.7,
            width: 832,
            height: 1216,
        })
        expect(m!.loras!.map((l) => l.name)).toEqual(['a.safetensors', 'b.safetensors'])
        expect(m!.hires).toMatchObject({ method: 'latent', scale: 1.5, denoise: 0.35, steps: 15 })
        expect((m!.raw as { comfy: { family: string } }).comfy.family).toBe('noobai-vpred')
    })

    it('returns null for graphs without a sampler', () => {
        expect(parseComfyPromptGraph({ '1': { class_type: 'LoadImage', inputs: { image: 'a.png' } } })).toBeNull()
        expect(parseComfyPromptGraph(null)).toBeNull()
        expect(parseComfyPromptGraph([])).toBeNull()
    })
})
