// ============================================================================
// 체크포인트 계열별 권장 프리셋
//
// 이 파일 하나만 고치면 권장값이 바뀐다. 값은 각 계열의 모델 설명(모델 카드)과
// 커뮤니티에서 널리 쓰이는 값을 참고해 정했고, 항목마다 출처를 주석으로 남겼다.
// (조사일: 2026-10. 모델 카드가 바뀌면 여기도 맞춰 고친다.)
//
// 공통 참고
// - ComfyUI 노드 입력 이름·선택지: ComfyUI 소스 nodes.py, comfy/samplers.py,
//   comfy_extras/nodes_model_advanced.py (github.com/comfyanonymous/ComfyUI)
// - SDXL 계열 해상도 목록: SDXL 학습 버킷(가로×세로가 약 1024², 64의 배수).
//   AWS Marketplace의 SDXL 1.0 안내에 실린 최적 해상도 목록과 같다.
// - 고화질 단계(hires fix) 구조: ComfyUI_examples/2_pass_txt2img
//   (기본 생성 → 확대 → denoise 0.5 전후로 한 번 더 샘플링)
// - ComfyUI에서 SDXL CLIP은 기본이 끝에서 두 번째 층(-2)이라 CLIP skip 2와 같다
//   (comfy/sdxl_clip.py). SD1.5는 기본이 마지막 층(-1).
// ============================================================================

import type {
  FamilyId,
  GenerationValues,
  HiresValues,
  ModelValues,
  PromptPart,
  PromptValues,
} from './types';

export interface FamilyPreset {
  id: FamilyId;
  label: string;
  /** 화면에 보여 줄 한두 줄 설명 */
  description: string;
  /** 체크포인트 파일명 추정용 패턴 (위에서부터 먼저 맞는 계열을 고른다) */
  detect: RegExp[];
  /** 모델이 잘 다루는 해상도 [가로, 세로] */
  resolutions: Array<[number, number]>;
  model: ModelValues;
  generation: GenerationValues;
  prompt: PromptValues;
  hires: HiresValues;
  /** 구도 맞추기를 켠 그룹에서 권장값으로 쓰는 샘플러 (단계마다 노이즈를 넣지 않는 것) */
  matchComposition: { sampler: string; scheduler: string };
  /** 계열별 "보통 범위" (없으면 settingsSchema의 기본 범위) */
  ranges?: Partial<Record<string, [number, number]>>;
  sources: string[];
}

export const DEFAULT_ORDER: PromptPart[] = ['quality', 'character', 'group', 'scene', 'elements'];

const SDXL_RESOLUTIONS: Array<[number, number]> = [
  [1024, 1024],
  [896, 1152],
  [1152, 896],
  [832, 1216],
  [1216, 832],
  [768, 1344],
  [1344, 768],
  [640, 1536],
  [1536, 640],
];

const SD15_RESOLUTIONS: Array<[number, number]> = [
  [512, 512],
  [512, 768],
  [768, 512],
  [512, 704],
  [704, 512],
  [448, 640],
  [640, 448],
];

/** SDXL 계열 공통 고화질 단계: lanczos로 1.5배 키운 뒤 denoise 0.4로 다시 다듬는다. */
const SDXL_HIRES: HiresValues = {
  method: 'pixel',
  scale: 1.5,
  denoise: 0.4,
  steps: 20,
  cfg: null,
  sampler: '',
  scheduler: '',
  upscaleModel: '',
  latentMethod: 'nearest-exact',
  pixelMethod: 'lanczos',
};

export const PRESETS: FamilyPreset[] = [
  // --------------------------------------------------------------------------
  {
    id: 'noobai-vpred',
    label: 'NoobAI-XL V-Pred',
    description:
      'v-prediction 모델. ModelSamplingDiscrete(v_prediction, zsnr) 노드가 필요하고, 샘플러는 euler를 쓴다.',
    detect: [/noob.*v-?pred|v-?pred.*noob/i, /v-?pred/i],
    resolutions: SDXL_RESOLUTIONS,
    // 출처: NoobAI-XL V-Pred 1.0 모델 카드(Laxhar, huggingface.co/Laxhar/noobai-XL-Vpred-1.0)와
    //       미러(tusiart.com/models/809953668913885914): CFG 4~5, 28~35 steps, Euler,
    //       "V prediction does not support the Karras series" — 그래서 scheduler는 normal.
    // v_pred/ztsnr 키가 들어 있는 원본 파일은 ComfyUI가 자동 인식하지만(comfy/supported_models.py),
    // 병합 모델은 키가 빠진 경우가 많아 노드로 명시한다.
    // RescaleCFG 0.7: zsnr 논문(Lin et al. 2023, arXiv:2305.08891) 권장값이자 ComfyUI RescaleCFG 기본값.
    model: { clipSkip: -2, vpred: true, zsnr: true, rescaleCfg: 0.7 },
    generation: {
      width: 1024,
      height: 1024,
      steps: 28,
      cfg: 4.5,
      sampler: 'euler',
      scheduler: 'normal',
      batchSize: 1,
    },
    prompt: {
      // 출처: NoobAI-XL 모델 카드 권장 접두어 "masterpiece, best quality, newest, absurdres, highres"
      qualityTags: 'masterpiece, best quality, newest, absurdres, highres',
      // 출처: NoobAI-XL 모델 카드 권장 네거티브 (nsfw는 필요하면 직접 넣는다)
      defaultNegative:
        'worst quality, old, early, low quality, lowres, signature, username, logo, bad hands, mutated hands, mammal, anthro, furry, ambiguous form, feral, semi-anthro',
      order: DEFAULT_ORDER,
    },
    hires: { ...SDXL_HIRES, denoise: 0.35 },
    matchComposition: { sampler: 'euler', scheduler: 'normal' },
    ranges: { cfg: [3.5, 5.5] },
    sources: [
      'https://huggingface.co/Laxhar/noobai-XL-Vpred-1.0',
      'https://tusiart.com/models/809953668913885914',
      'https://arxiv.org/abs/2305.08891',
    ],
  },
  // --------------------------------------------------------------------------
  {
    id: 'noobai-eps',
    label: 'NoobAI-XL (eps)',
    description: 'NoobAI-XL epsilon 계열. Illustrious 기반이며 CFG를 조금 낮게 쓴다.',
    detect: [/noob|nai-?xl/i],
    resolutions: SDXL_RESOLUTIONS,
    model: { clipSkip: -2, vpred: false, zsnr: false, rescaleCfg: 0 },
    // 출처: NoobAI-XL 모델 카드/미러(tusiart.com/models/809953668913885914): CFG 4~5, 28~35 steps.
    //       eps 버전은 Euler a를 쓰는 경우가 많다(anifusion.ai/models/noobai-xl-epsilon-1-1).
    generation: {
      width: 1024,
      height: 1024,
      steps: 28,
      cfg: 5,
      sampler: 'euler_ancestral',
      scheduler: 'normal',
      batchSize: 1,
    },
    prompt: {
      qualityTags: 'masterpiece, best quality, newest, absurdres, highres',
      defaultNegative:
        'worst quality, old, early, low quality, lowres, signature, username, logo, bad hands, mutated hands, mammal, anthro, furry, ambiguous form, feral, semi-anthro',
      order: DEFAULT_ORDER,
    },
    hires: SDXL_HIRES,
    matchComposition: { sampler: 'euler', scheduler: 'normal' },
    ranges: { cfg: [4, 6] },
    sources: [
      'https://huggingface.co/Laxhar/noobai-XL-1.1',
      'https://tusiart.com/models/809953668913885914',
      'https://anifusion.ai/models/noobai-xl-epsilon-1-1/',
    ],
  },
  // --------------------------------------------------------------------------
  {
    id: 'animagine',
    label: 'Animagine XL 4',
    description: '품질 태그를 프롬프트 끝에 붙이도록 권장하는 계열.',
    detect: [/animagine/i],
    // 출처: Animagine XL 4.0 모델 카드(huggingface.co/cagliostrolab/animagine-xl-4.0)
    //       권장 해상도 목록 = SDXL 버킷, CFG 4~7(5 권장), 25~28 steps(28 권장), Euler Ancestral.
    resolutions: SDXL_RESOLUTIONS,
    model: { clipSkip: -2, vpred: false, zsnr: false, rescaleCfg: 0 },
    generation: {
      width: 1024,
      height: 1024,
      steps: 28,
      cfg: 5,
      sampler: 'euler_ancestral',
      scheduler: 'normal',
      batchSize: 1,
    },
    prompt: {
      // 출처: 모델 카드 "add masterpiece, high score, great score, absurdres at the end of the prompt"
      qualityTags: 'masterpiece, high score, great score, absurdres',
      // 출처: 모델 카드 권장 네거티브
      defaultNegative:
        'lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry',
      order: ['character', 'group', 'scene', 'elements', 'quality'],
    },
    hires: SDXL_HIRES,
    matchComposition: { sampler: 'euler', scheduler: 'normal' },
    ranges: { cfg: [4, 7] },
    sources: [
      'https://huggingface.co/cagliostrolab/animagine-xl-4.0',
      'https://replicate.com/aisha-ai-official/animagine-xl-4.0/readme',
    ],
  },
  // --------------------------------------------------------------------------
  {
    id: 'pony',
    label: 'Pony Diffusion V6 XL',
    description: 'score 태그를 쓰는 계열. CLIP skip 2가 꼭 필요하다.',
    detect: [/pony|pdxl|autismmix/i],
    resolutions: SDXL_RESOLUTIONS,
    // 출처: Pony Diffusion V6 XL 모델 카드: "Euler a, 25 steps, 1024px", "clip skip 2 필수"
    //       (tusiart.com/models/743168645196239543 미러). CFG는 공식 값이 없어 커뮤니티 범위 6~7.
    model: { clipSkip: -2, vpred: false, zsnr: false, rescaleCfg: 0 },
    generation: {
      width: 1024,
      height: 1024,
      steps: 25,
      cfg: 7,
      sampler: 'euler_ancestral',
      scheduler: 'normal',
      batchSize: 1,
    },
    prompt: {
      // 출처: 공식 템플릿의 앞부분 score_9, score_8_up, score_7_up (stable-diffusion-art.com/pony-diffusion-v6-xl)
      //       애니 그림체면 source_anime 를 더하는 경우가 많다.
      qualityTags: 'score_9, score_8_up, score_7_up',
      // 출처: 커뮤니티에서 널리 쓰는 score 네거티브 + 흔한 결함 태그
      defaultNegative:
        'score_6, score_5, score_4, worst quality, low quality, bad anatomy, bad hands, signature, watermark',
      order: DEFAULT_ORDER,
    },
    hires: SDXL_HIRES,
    matchComposition: { sampler: 'euler', scheduler: 'normal' },
    ranges: { cfg: [5, 8] },
    sources: [
      'https://huggingface.co/Proger33/Pony_Diffusion_V6_XL',
      'https://tusiart.com/models/743168645196239543',
      'https://stable-diffusion-art.com/pony-diffusion-v6-xl',
    ],
  },
  // --------------------------------------------------------------------------
  {
    id: 'illustrious',
    label: 'Illustrious XL (WAI 등)',
    description: 'Illustrious XL과 WAI-Illustrious 같은 파생 모델. 애니 그림체의 기본 선택.',
    detect: [
      /illustrious|illu|hassaku|prefect|obsession|nova[-_]?(anime|orange|cartoon|furry|3d|unreal)|ntr[-_]?mix|ilxl/i,
    ],
    // 출처: Illustrious XL 모델 카드(OnomaAI)와 가이드(tensor.art/articles/831123524065191393):
    //       Euler a, 20~28 steps, CFG 5~7.5(중간 5.5 전후), clip skip 2, 1024 기준 SDXL 해상도.
    //       WAI-Illustrious(civitai) 설명: Euler a, CFG 5~7, 25~40 steps.
    //       v1.0 이상은 1536까지 다루지만, 파생 모델 다수가 v0.1 기반이라 목록은 SDXL 버킷으로 둔다.
    resolutions: SDXL_RESOLUTIONS,
    model: { clipSkip: -2, vpred: false, zsnr: false, rescaleCfg: 0 },
    generation: {
      width: 1024,
      height: 1024,
      steps: 28,
      cfg: 5.5,
      sampler: 'euler_ancestral',
      scheduler: 'normal',
      batchSize: 1,
    },
    prompt: {
      // 출처: WAI-Illustrious 설명의 권장 문구 "masterpiece,best quality,amazing quality"
      qualityTags: 'masterpiece, best quality, amazing quality',
      // 출처: WAI-Illustrious 권장 네거티브 "bad quality,worst quality,worst detail,sketch,censor"
      //       + Illustrious 가이드에서 흔히 쓰는 lowres, bad anatomy, bad hands, jpeg artifacts, watermark, signature
      defaultNegative:
        'bad quality, worst quality, worst detail, lowres, bad anatomy, bad hands, jpeg artifacts, signature, watermark, sketch, censor',
      order: DEFAULT_ORDER,
    },
    hires: SDXL_HIRES,
    matchComposition: { sampler: 'euler', scheduler: 'normal' },
    ranges: { cfg: [4.5, 7.5] },
    sources: [
      'https://huggingface.co/OnomaAIResearch/Illustrious-xl-early-release-v0',
      'https://tensor.art/articles/831123524065191393',
      'https://civarchive.com/shakker/models/0f204323a06f40e18f8ffc5b1813df5a/versions/252b5d5666e9454380f4d87a5f238185',
    ],
  },
  // --------------------------------------------------------------------------
  {
    id: 'sdxl',
    label: 'SDXL 일반',
    description: 'SDXL 기본 모델과 실사·범용 병합 모델.',
    detect: [/sd_?xl|xl|juggernaut|realvis|zavychroma|playground/i],
    // 출처: Diffusers SDXL 문서(1024×1024 권장, guidance 5.0 기본), SDXL 학습 버킷.
    //       DPM++ 2M Karras, 25~35 steps, CFG 5~8은 범용 SDXL 병합 모델 설명에서 가장 흔한 조합.
    resolutions: SDXL_RESOLUTIONS,
    model: { clipSkip: -2, vpred: false, zsnr: false, rescaleCfg: 0 },
    generation: {
      width: 1024,
      height: 1024,
      steps: 30,
      cfg: 6,
      sampler: 'dpmpp_2m',
      scheduler: 'karras',
      batchSize: 1,
    },
    prompt: {
      qualityTags: 'high quality, detailed',
      defaultNegative:
        'lowres, worst quality, low quality, blurry, jpeg artifacts, watermark, signature, text, bad anatomy, bad hands',
      order: DEFAULT_ORDER,
    },
    hires: { ...SDXL_HIRES, denoise: 0.35 },
    matchComposition: { sampler: 'dpmpp_2m', scheduler: 'karras' },
    ranges: { cfg: [4, 8] },
    sources: [
      'https://huggingface.co/docs/diffusers/api/pipelines/stable_diffusion/stable_diffusion_xl',
      'https://aws.amazon.com/marketplace/pp/prodview-pe7wqwehghdtm',
    ],
  },
  // --------------------------------------------------------------------------
  {
    id: 'sd15-anime',
    label: 'SD1.5 애니',
    description: 'NAI 계열 SD1.5 애니 모델(Anything, Counterfeit, MeinaMix 등). CLIP skip 2.',
    detect: [/anything|counterfeit|meina|abyss|orangemix|pastel-?mix|anylora|cetus|ghostmix|aom\d/i],
    // 출처: NAI 파생 SD1.5 애니 모델 설명들(Counterfeit 등): CLIP skip 2, CFG 7~8, DPM++ 2M Karras 20 steps 전후,
    //       hires fix 2배 + denoise 0.2~0.6. 공식 모델 카드가 따로 없는 계열이라 커뮤니티 공통값을 쓴다.
    resolutions: SD15_RESOLUTIONS,
    model: { clipSkip: -2, vpred: false, zsnr: false, rescaleCfg: 0 },
    generation: {
      width: 512,
      height: 768,
      steps: 25,
      cfg: 7,
      sampler: 'dpmpp_2m',
      scheduler: 'karras',
      batchSize: 1,
    },
    prompt: {
      qualityTags: 'masterpiece, best quality',
      defaultNegative:
        '(worst quality, low quality:1.4), lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, jpeg artifacts, signature, watermark, username, blurry',
      order: DEFAULT_ORDER,
    },
    hires: { ...SDXL_HIRES, scale: 2, denoise: 0.45, steps: 15 },
    matchComposition: { sampler: 'dpmpp_2m', scheduler: 'karras' },
    ranges: { cfg: [5, 9] },
    sources: [
      'https://civarchive.com/models/4468/',
      'https://www.promptlayer.com/models/counterfeit-v25',
    ],
  },
  // --------------------------------------------------------------------------
  {
    id: 'sd15',
    label: 'SD1.5 일반',
    description: 'SD1.5 기본·실사 모델. CLIP skip을 쓰지 않는다(-1).',
    detect: [
      /sd[-_]?1[._-]?5|v1-5|realistic[-_]?vision|dreamshaper[-_]?\d|epicrealism|majicmix|chilloutmix|deliberate/i,
    ],
    // 출처: Stable Diffusion v1.5 모델 카드(512×512로 학습), Replicate 사용 가이드(20 steps부터 시작),
    //       호스팅 기본값(guidance 7.5, 25 steps). 샘플러는 범용 SD1.5 병합 모델에서 흔한 DPM++ 2M Karras.
    resolutions: SD15_RESOLUTIONS,
    model: { clipSkip: -1, vpred: false, zsnr: false, rescaleCfg: 0 },
    generation: {
      width: 512,
      height: 768,
      steps: 25,
      cfg: 7,
      sampler: 'dpmpp_2m',
      scheduler: 'karras',
      batchSize: 1,
    },
    prompt: {
      qualityTags: 'best quality, high quality, detailed',
      defaultNegative:
        'lowres, worst quality, low quality, blurry, jpeg artifacts, watermark, signature, text, bad anatomy, bad hands, extra fingers, missing fingers',
      order: DEFAULT_ORDER,
    },
    hires: { ...SDXL_HIRES, scale: 2, denoise: 0.45, steps: 15 },
    matchComposition: { sampler: 'dpmpp_2m', scheduler: 'karras' },
    ranges: { cfg: [5, 9] },
    sources: [
      'https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5',
      'https://replicate.com/guides/stable-diffusion/how-to-use',
      'https://deepinfra.com/runwayml/stable-diffusion-v1-5',
    ],
  },
];

/** 파일명으로 계열을 못 정할 때 쓰는 계열 */
export const FALLBACK_FAMILY: FamilyId = 'sdxl';

export function getPreset(id: FamilyId): FamilyPreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS.find((p) => p.id === FALLBACK_FAMILY)!;
}

/** 체크포인트 파일명으로 계열을 추정한다. 못 정하면 null */
export function detectFamily(checkpoint: string): FamilyId | null {
  const name = checkpoint.split(/[\\/]/).pop() ?? checkpoint;
  if (!name.trim()) return null;
  for (const p of PRESETS) {
    if (p.detect.some((re) => re.test(name))) return p.id;
  }
  return null;
}

/** 실행마다 노이즈를 새로 넣는(구도 맞추기 효과가 약한) 샘플러인지 */
export function isStochasticSampler(sampler: string): boolean {
  return /ancestral|_sde|sde_|^ddpm$|^lcm$|er_sde|sa_solver|seeds_/.test(sampler);
}

/** 오프라인일 때 드롭다운에 보여 줄 기본 목록 (ComfyUI comfy/samplers.py 기준) */
export const DEFAULT_SAMPLERS = [
  'euler',
  'euler_ancestral',
  'heun',
  'dpm_2',
  'dpm_2_ancestral',
  'lms',
  'dpmpp_2s_ancestral',
  'dpmpp_sde',
  'dpmpp_2m',
  'dpmpp_2m_sde',
  'dpmpp_3m_sde',
  'ddim',
  'uni_pc',
  'res_multistep',
];

export const DEFAULT_SCHEDULERS = [
  'normal',
  'karras',
  'exponential',
  'sgm_uniform',
  'simple',
  'ddim_uniform',
  'beta',
  'linear_quadratic',
  'kl_optimal',
];

export const LATENT_UPSCALE_METHODS = ['nearest-exact', 'bilinear', 'area', 'bicubic', 'bislerp'];
export const PIXEL_UPSCALE_METHODS = ['nearest-exact', 'bilinear', 'area', 'bicubic', 'lanczos'];

export function aspectOf(w: number, h: number): 'square' | 'portrait' | 'landscape' {
  if (w === h) return 'square';
  return h > w ? 'portrait' : 'landscape';
}

/** 비율 힌트에 맞는 해상도를 프리셋 목록에서 고른다 (세로/가로는 1:1에 가장 가까운 것 다음 크기) */
export function resolutionForAspect(
  preset: FamilyPreset,
  aspect: 'square' | 'portrait' | 'landscape',
): [number, number] {
  const list = preset.resolutions.filter(([w, h]) => aspectOf(w, h) === aspect);
  if (list.length === 0) return preset.resolutions[0];
  // 정사각형에 가장 가까운 것 중 두 번째(예: SDXL 세로 → 832×1216)를 기본으로 쓴다.
  const sorted = [...list].sort((a, b) => ratio(a) - ratio(b));
  return sorted[Math.min(1, sorted.length - 1)];
}

function ratio([w, h]: [number, number]): number {
  return Math.max(w, h) / Math.min(w, h);
}
