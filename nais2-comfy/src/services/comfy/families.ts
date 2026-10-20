// 체크포인트 계열별 권장값 (품질 태그, 기본 부정 프롬프트, 샘플러 등)
//
// NAI는 "품질 태그 추가"와 "UC 프리셋"을 서버에서 글로 바꿔 붙이지만, ComfyUI는 그런 기능이 없다.
// 그래서 같은 스위치를 켜면 이 표의 글을 프로그램이 직접 붙인다. 값과 출처는
// comfy-asset-tool/src/lib/presets.ts 와 같다 (각 모델 카드 기준, 2026-10 조사).

export type FamilyId = 'illustrious' | 'noobai-vpred' | 'noobai-eps' | 'animagine' | 'pony' | 'sdxl' | 'sd15-anime' | 'sd15'

export interface FamilyPreset {
    id: FamilyId
    label: string
    description: string
    detect: RegExp[]
    /** 품질 태그 (NAI '품질 태그 추가' 스위치를 켜면 붙인다) */
    qualityTags: string
    /** 품질 태그를 프롬프트 끝에 붙이는 계열 (Animagine 권장 방식) */
    qualityAtEnd: boolean
    /** UC 프리셋 '강하게' */
    negativeHeavy: string
    /** UC 프리셋 '가볍게' */
    negativeLight: string
    vpred: boolean
    zsnr: boolean
    rescaleCfg: number
    clipSkip: number
    steps: number
    cfg: number
    sampler: string
    scheduler: string
    width: number
    height: number
    hires: { scale: number; denoise: number; steps: number }
}

export const FAMILIES: FamilyPreset[] = [
    {
        id: 'noobai-vpred',
        label: 'NoobAI-XL V-Pred',
        description: 'v-prediction 모델. 샘플러는 euler, 스케줄러는 normal(karras 비권장).',
        detect: [/noob.*v-?pred|v-?pred.*noob/i, /v-?pred/i],
        qualityTags: 'masterpiece, best quality, newest, absurdres, highres',
        qualityAtEnd: false,
        negativeHeavy: 'worst quality, old, early, low quality, lowres, signature, username, logo, bad hands, mutated hands, mammal, anthro, furry, ambiguous form, feral, semi-anthro',
        negativeLight: 'worst quality, low quality, lowres, signature, username, logo',
        vpred: true,
        zsnr: true,
        rescaleCfg: 0.7,
        clipSkip: 2,
        steps: 28,
        cfg: 4.5,
        sampler: 'euler',
        scheduler: 'normal',
        width: 832,
        height: 1216,
        hires: { scale: 1.5, denoise: 0.35, steps: 15 },
    },
    {
        id: 'noobai-eps',
        label: 'NoobAI-XL (eps)',
        description: 'NoobAI-XL epsilon 계열. Illustrious 기반이며 CFG를 조금 낮게 쓴다.',
        detect: [/noob|nai-?xl/i],
        qualityTags: 'masterpiece, best quality, newest, absurdres, highres',
        qualityAtEnd: false,
        negativeHeavy: 'worst quality, old, early, low quality, lowres, signature, username, logo, bad hands, mutated hands, mammal, anthro, furry, ambiguous form, feral, semi-anthro',
        negativeLight: 'worst quality, low quality, lowres, signature, username, logo',
        vpred: false,
        zsnr: false,
        rescaleCfg: 0,
        clipSkip: 2,
        steps: 28,
        cfg: 5,
        sampler: 'euler_ancestral',
        scheduler: 'normal',
        width: 832,
        height: 1216,
        hires: { scale: 1.5, denoise: 0.4, steps: 15 },
    },
    {
        id: 'animagine',
        label: 'Animagine XL 4',
        description: '품질 태그를 프롬프트 끝에 붙이도록 권장하는 계열.',
        detect: [/animagine/i],
        qualityTags: 'masterpiece, high score, great score, absurdres',
        qualityAtEnd: true,
        negativeHeavy: 'lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry',
        negativeLight: 'lowres, worst quality, low quality, low score, bad score',
        vpred: false,
        zsnr: false,
        rescaleCfg: 0,
        clipSkip: 2,
        steps: 28,
        cfg: 5,
        sampler: 'euler_ancestral',
        scheduler: 'normal',
        width: 832,
        height: 1216,
        hires: { scale: 1.5, denoise: 0.4, steps: 15 },
    },
    {
        id: 'pony',
        label: 'Pony Diffusion V6 XL',
        description: 'score 태그를 쓰는 계열. CLIP skip 2가 꼭 필요하다.',
        detect: [/pony|pdxl|autismmix/i],
        qualityTags: 'score_9, score_8_up, score_7_up',
        qualityAtEnd: false,
        negativeHeavy: 'score_6, score_5, score_4, worst quality, low quality, bad anatomy, bad hands, signature, watermark',
        negativeLight: 'score_6, score_5, score_4',
        vpred: false,
        zsnr: false,
        rescaleCfg: 0,
        clipSkip: 2,
        steps: 25,
        cfg: 7,
        sampler: 'euler_ancestral',
        scheduler: 'normal',
        width: 832,
        height: 1216,
        hires: { scale: 1.5, denoise: 0.4, steps: 15 },
    },
    {
        id: 'illustrious',
        label: 'Illustrious XL (WAI 등)',
        description: 'Illustrious XL과 WAI-Illustrious 같은 파생 모델. 애니 그림체의 기본 선택.',
        detect: [/illustrious|illu|hassaku|prefect|obsession|nova[-_]?(anime|orange|cartoon|furry|3d|unreal)|ntr[-_]?mix|ilxl/i],
        qualityTags: 'masterpiece, best quality, amazing quality',
        qualityAtEnd: false,
        negativeHeavy: 'bad quality, worst quality, worst detail, lowres, bad anatomy, bad hands, jpeg artifacts, signature, watermark, sketch, censor',
        negativeLight: 'bad quality, worst quality, worst detail, lowres',
        vpred: false,
        zsnr: false,
        rescaleCfg: 0,
        clipSkip: 2,
        steps: 28,
        cfg: 5.5,
        sampler: 'euler_ancestral',
        scheduler: 'normal',
        width: 832,
        height: 1216,
        hires: { scale: 1.5, denoise: 0.4, steps: 15 },
    },
    {
        id: 'sdxl',
        label: 'SDXL 일반',
        description: 'SDXL 기본 모델과 실사·범용 병합 모델.',
        detect: [/sd_?xl|xl|juggernaut|realvis|zavychroma|playground/i],
        qualityTags: 'high quality, detailed',
        qualityAtEnd: false,
        negativeHeavy: 'lowres, worst quality, low quality, blurry, jpeg artifacts, watermark, signature, text, bad anatomy, bad hands',
        negativeLight: 'lowres, worst quality, low quality, blurry',
        vpred: false,
        zsnr: false,
        rescaleCfg: 0,
        clipSkip: 2,
        steps: 30,
        cfg: 6,
        sampler: 'dpmpp_2m',
        scheduler: 'karras',
        width: 832,
        height: 1216,
        hires: { scale: 1.5, denoise: 0.35, steps: 15 },
    },
    {
        id: 'sd15-anime',
        label: 'SD1.5 애니',
        description: 'NAI 계열 SD1.5 애니 모델(Anything, Counterfeit, MeinaMix 등). CLIP skip 2.',
        detect: [/anything|counterfeit|meina|abyss|orangemix|pastel-?mix|anylora|cetus|ghostmix|aom\d/i],
        qualityTags: 'masterpiece, best quality',
        qualityAtEnd: false,
        negativeHeavy: '(worst quality, low quality:1.4), lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, jpeg artifacts, signature, watermark, username, blurry',
        negativeLight: '(worst quality, low quality:1.4), lowres',
        vpred: false,
        zsnr: false,
        rescaleCfg: 0,
        clipSkip: 2,
        steps: 25,
        cfg: 7,
        sampler: 'dpmpp_2m',
        scheduler: 'karras',
        width: 512,
        height: 768,
        hires: { scale: 2, denoise: 0.45, steps: 15 },
    },
    {
        id: 'sd15',
        label: 'SD1.5 일반',
        description: 'SD1.5 기본·실사 모델. CLIP skip을 쓰지 않는다(1).',
        detect: [/sd[-_]?1[._-]?5|v1-5|realistic[-_]?vision|dreamshaper[-_]?\d|epicrealism|majicmix|chilloutmix|deliberate/i],
        qualityTags: 'best quality, high quality, detailed',
        qualityAtEnd: false,
        negativeHeavy: 'lowres, worst quality, low quality, blurry, jpeg artifacts, watermark, signature, text, bad anatomy, bad hands, extra fingers, missing fingers',
        negativeLight: 'lowres, worst quality, low quality, blurry',
        vpred: false,
        zsnr: false,
        rescaleCfg: 0,
        clipSkip: 1,
        steps: 25,
        cfg: 7,
        sampler: 'dpmpp_2m',
        scheduler: 'karras',
        width: 512,
        height: 768,
        hires: { scale: 2, denoise: 0.45, steps: 15 },
    },
]

export const FALLBACK_FAMILY: FamilyId = 'illustrious'

export function getFamily(id: FamilyId | 'auto' | undefined | null, checkpoint?: string): FamilyPreset {
    const resolved = !id || id === 'auto' ? detectFamily(checkpoint ?? '') ?? FALLBACK_FAMILY : id
    return FAMILIES.find((f) => f.id === resolved) ?? FAMILIES.find((f) => f.id === FALLBACK_FAMILY)!
}

/** 체크포인트 파일 이름으로 계열을 짐작한다. 못 정하면 null */
export function detectFamily(checkpoint: string): FamilyId | null {
    const name = checkpoint.split(/[\\/]/).pop() ?? checkpoint
    if (!name.trim()) return null
    for (const f of FAMILIES) if (f.detect.some((re) => re.test(name))) return f.id
    return null
}

/** NAI 샘플러·스케줄러 이름 → ComfyUI 이름 (예전 NAIS2 프리셋·메타데이터를 불러올 때) */
const SAMPLER_MAP: Record<string, string> = {
    k_euler: 'euler',
    k_euler_ancestral: 'euler_ancestral',
    k_dpmpp_2s_ancestral: 'dpmpp_2s_ancestral',
    k_dpmpp_2m: 'dpmpp_2m',
    k_dpmpp_2m_sde: 'dpmpp_2m_sde',
    k_dpmpp_sde: 'dpmpp_sde',
    k_dpm_2: 'dpm_2',
    k_dpm_2_ancestral: 'dpm_2_ancestral',
    k_lms: 'lms',
    k_heun: 'heun',
    ddim_v3: 'ddim',
    ddim: 'ddim',
    // A1111 표기
    'euler a': 'euler_ancestral',
    'dpm++ 2m': 'dpmpp_2m',
    'dpm++ 2m karras': 'dpmpp_2m',
    'dpm++ sde': 'dpmpp_sde',
    'dpm++ 2m sde': 'dpmpp_2m_sde',
    'dpm++ 2s a': 'dpmpp_2s_ancestral',
}

const SCHEDULER_MAP: Record<string, string> = {
    native: 'normal',
    polyexponential: 'exponential',
    karras: 'karras',
    exponential: 'exponential',
    automatic: 'normal',
}

export function normalizeSampler(name: string | undefined | null): string {
    if (!name) return 'euler_ancestral'
    const key = name.trim().toLowerCase()
    return SAMPLER_MAP[key] ?? name.trim()
}

export function normalizeScheduler(name: string | undefined | null): string {
    if (!name) return 'normal'
    const key = name.trim().toLowerCase()
    return SCHEDULER_MAP[key] ?? name.trim()
}

/** 오프라인일 때 보여 줄 기본 목록 (ComfyUI comfy/samplers.py 기준) */
export const DEFAULT_SAMPLERS = [
    'euler', 'euler_ancestral', 'heun', 'dpm_2', 'dpm_2_ancestral', 'lms', 'dpmpp_2s_ancestral',
    'dpmpp_sde', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_3m_sde', 'ddim', 'uni_pc', 'res_multistep',
]

export const DEFAULT_SCHEDULERS = ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform', 'beta', 'linear_quadratic', 'kl_optimal']
