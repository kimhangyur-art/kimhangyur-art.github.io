// 설정 옵션마다 붙는 이름과 쉬운 설명.
// 설명 형식: 무엇을 하는지 → 올리거나 내리면 어떻게 되는지 → 보통 범위

import type { BundleKey, SettingsLevel } from './types';

export type FieldType =
  | 'int'
  | 'float'
  | 'text'
  | 'textarea'
  | 'bool'
  | 'select'
  | 'resolution'
  | 'order'
  | 'combo';

/** 드롭다운 목록을 어디서 가져올지 (combo: 목록 + 직접 입력) */
export type OptionSource =
  | 'samplers'
  | 'samplersOrSame'
  | 'schedulers'
  | 'schedulersOrSame'
  | 'upscaleModels'
  | 'latentMethods'
  | 'pixelMethods'
  | 'hiresMethods'
  | 'seedControls';

export interface FieldDef {
  bundle: BundleKey;
  key: string;
  label: string;
  /** 한두 줄 쉬운 설명 */
  help: string;
  type: FieldType;
  /** 보통 범위. 벗어나면 막지 않고 경고만 한다. */
  typical?: [number, number];
  /** 입력 가능한 한계 (ComfyUI 노드의 min/max) */
  min?: number;
  max?: number;
  step?: number;
  options?: OptionSource;
  /** 이 값을 바꿀 수 있는 단계. 없으면 모든 단계 */
  levels?: SettingsLevel[];
  /** 비워 둘 수 있음 (null/빈 문자열 = 기본 단계와 같음) */
  nullable?: boolean;
}

export interface BundleDef {
  key: BundleKey;
  label: string;
  help: string;
  /** 권장/커스텀 구분 없이 항상 직접 고치는 묶음 */
  noPreset?: boolean;
  levels: SettingsLevel[];
  fields: FieldDef[];
}

const f = (bundle: BundleKey, key: string, rest: Omit<FieldDef, 'bundle' | 'key'>): FieldDef => ({
  bundle,
  key,
  ...rest,
});

export const BUNDLES: BundleDef[] = [
  {
    key: 'model',
    label: '모델 설정',
    help: '체크포인트에 딸린 설정. 모든 줄에 같이 쓰인다.',
    levels: ['global'],
    fields: [
      f('model', 'clipSkip', {
        label: 'CLIP skip',
        help: '프롬프트를 해석할 때 CLIP의 마지막 층을 몇 개 건너뛸지. -2(=CLIP skip 2)는 애니 계열 대부분의 권장값이고, -1은 건너뛰지 않는다. 바꾸면 그림체가 눈에 띄게 달라진다. 보통 -2 또는 -1.',
        type: 'int',
        typical: [-2, -1],
        min: -24,
        max: -1,
        step: 1,
      }),
      f('model', 'vpred', {
        label: 'v-prediction 모드',
        help: 'v-pred로 학습한 모델(예: NoobAI V-Pred)에 꼭 필요하다. 켜면 ModelSamplingDiscrete 노드를 넣는다. 일반(eps) 모델에서 켜면 그림이 망가지니 모델 설명에 v-pred라고 적힌 경우에만 켠다.',
        type: 'bool',
      }),
      f('model', 'zsnr', {
        label: 'ZSNR',
        help: 'v-pred 모델에 함께 쓰는 노이즈 일정 보정. 학습 때 zsnr을 쓴 모델에서 켜면 아주 어둡거나 밝은 그림이 잘 나온다. v-pred를 켤 때만 쓰이고, 보통 함께 켠다.',
        type: 'bool',
      }),
      f('model', 'rescaleCfg', {
        label: 'CFG 재조정 (RescaleCFG)',
        help: 'CFG 때문에 색이 타거나 너무 진해지는 것을 눌러 준다. 높이면 색이 차분해지고, 0이면 노드를 넣지 않는다. v-pred 모델은 보통 0.7, 일반 모델은 0.',
        type: 'float',
        typical: [0, 0.8],
        min: 0,
        max: 1,
        step: 0.05,
      }),
    ],
  },
  {
    key: 'generation',
    label: '생성 설정',
    help: '기본 단계(초안과 마무리가 똑같이 쓰는 단계)의 값.',
    levels: ['global', 'group', 'scene'],
    fields: [
      f('generation', 'resolution', {
        label: '해상도',
        help: '이미지 크기(가로×세로). 모델이 학습한 크기에서 벗어나면 몸이 늘어나거나 인물이 둘로 나뉘기 쉽다. 목록에서 고르는 것을 권장하고, 목록 밖 값은 경고만 한다.',
        type: 'resolution',
      }),
      f('generation', 'steps', {
        label: '스텝 수',
        help: '그림을 다듬는 횟수. 올리면 세부가 조금 나아지지만 느려지고, 일정 이상은 차이가 거의 없다. 너무 낮으면 덜 그려진 느낌이 난다. 보통 20~35.',
        type: 'int',
        typical: [20, 35],
        min: 1,
        max: 10000,
        step: 1,
      }),
      f('generation', 'cfg', {
        label: 'CFG',
        help: '프롬프트를 얼마나 강하게 따를지. 높이면 충실해지지만 색이 진하고 딱딱해진다. 낮추면 자연스럽지만 프롬프트를 덜 따른다. 보통 4~7.',
        type: 'float',
        typical: [4, 7],
        min: 0,
        max: 100,
        step: 0.5,
      }),
      f('generation', 'sampler', {
        label: '샘플러',
        help: '노이즈를 걷어 내는 계산 방식. 그림체와 선명도가 조금씩 달라진다. 이름에 ancestral·sde가 붙은 것은 단계마다 노이즈를 새로 넣어서, 구도 맞추기 효과가 약하다. 보통 euler_ancestral, euler, dpmpp_2m.',
        type: 'combo',
        options: 'samplers',
      }),
      f('generation', 'scheduler', {
        label: '스케줄러',
        help: '단계별로 노이즈를 얼마나 빨리 줄일지 정하는 곡선. 결과 차이는 크지 않은 편이다. 보통 normal 또는 karras (v-pred 모델에는 karras를 피한다).',
        type: 'combo',
        options: 'schedulers',
      }),
      f('generation', 'batchSize', {
        label: '배치 수',
        help: '한 번 실행에 함께 그리는 장수. 1을 권장한다. 배치로 뽑은 두 번째 이후 이미지는 시드만으로 따로 재현하기 어려워서, 확정해도 마무리에서 같은 그림이 나오지 않는다. 후보를 늘리려면 ComfyUI 실행 버튼의 반복 횟수(Batch count)를 올린다. 권장 1.',
        type: 'int',
        typical: [1, 1],
        min: 1,
        max: 64,
        step: 1,
      }),
    ],
  },
  {
    key: 'prompt',
    label: '프롬프트 설정',
    help: '모든 줄에 붙는 품질 태그·기본 네거티브와 조합 순서.',
    levels: ['global', 'group', 'scene'],
    fields: [
      f('prompt', 'qualityTags', {
        label: '품질 태그',
        help: '모든 줄에 붙는 품질 문구. 모델마다 학습한 문구가 달라서 계열에 맞는 것을 쓰는 게 좋다. 늘린다고 계속 좋아지지는 않는다. 비우면 붙이지 않는다.',
        type: 'textarea',
      }),
      f('prompt', 'defaultNegative', {
        label: '기본 네거티브',
        help: '모든 줄의 네거티브 맨 앞에 붙는 문구. 늘리면 흔한 결함을 더 피하지만, 너무 길면 하나하나의 효과가 흐려진다.',
        type: 'textarea',
      }),
      f('prompt', 'order', {
        label: '조합 순서',
        help: '최종 프롬프트에 이어 붙이는 순서. 앞쪽 문구가 조금 더 강하게 반영된다. 보통 품질 태그 → 캐릭터 → 그룹 공통 → 장면 → 조각.',
        type: 'order',
        levels: ['global', 'group'],
      }),
    ],
  },
  {
    key: 'hires',
    label: '고화질 단계',
    help: '마무리에서만 덧붙는 단계. 기본 단계 그림을 키운 뒤 한 번 더 다듬는다. 초안에는 들어가지 않는다.',
    levels: ['global', 'group', 'scene'],
    fields: [
      f('hires', 'method', {
        label: '확대 방식',
        help: 'pixel: 모델 없이 lanczos로 키운다(무난, 권장). latent: 가장 빠르지만 다시 그리는 강도를 0.5 이상 줘야 깨끗하다. model: 업스케일 모델로 키워 가장 선명하지만 모델 파일이 필요하다.',
        type: 'select',
        options: 'hiresMethods',
      }),
      f('hires', 'scale', {
        label: '배율',
        help: '기본 해상도의 몇 배로 키울지. 올리면 크고 세밀해지지만 메모리와 시간이 크게 는다. 보통 1.5~2.',
        type: 'float',
        typical: [1.25, 2],
        min: 1,
        max: 4,
        step: 0.05,
      }),
      f('hires', 'denoise', {
        label: '다시 그리는 강도 (denoise)',
        help: '키운 그림을 얼마나 새로 그릴지. 올리면 세부가 많이 생기지만 원래 그림과 달라지고, 내리면 원본에 가깝지만 흐릿함이 남는다. 보통 0.3~0.5 (latent 방식은 0.5~0.6).',
        type: 'float',
        typical: [0.3, 0.6],
        min: 0.01,
        max: 1,
        step: 0.05,
      }),
      f('hires', 'steps', {
        label: '고화질 스텝 수',
        help: '두 번째 단계에서 다듬는 횟수. 올리면 조금 더 깔끔하지만 느려진다. 보통 15~25.',
        type: 'int',
        typical: [10, 30],
        min: 1,
        max: 1000,
        step: 1,
      }),
      f('hires', 'cfg', {
        label: '고화질 CFG',
        help: '두 번째 단계의 CFG. 비우면 기본 단계와 같은 값을 쓴다. 보통 비워 둔다.',
        type: 'float',
        typical: [3, 8],
        min: 0,
        max: 100,
        step: 0.5,
        nullable: true,
      }),
      f('hires', 'sampler', {
        label: '고화질 샘플러',
        help: '두 번째 단계의 샘플러. 비우면 기본 단계와 같다.',
        type: 'combo',
        options: 'samplersOrSame',
        nullable: true,
      }),
      f('hires', 'scheduler', {
        label: '고화질 스케줄러',
        help: '두 번째 단계의 스케줄러. 비우면 기본 단계와 같다.',
        type: 'combo',
        options: 'schedulersOrSame',
        nullable: true,
      }),
      f('hires', 'upscaleModel', {
        label: '업스케일 모델',
        help: 'model 방식에서 쓸 파일(ComfyUI models/upscale_models 폴더). 애니 그림에는 4x-AnimeSharp, RealESRGAN_x4plus_anime_6B 등이 흔하다.',
        type: 'combo',
        options: 'upscaleModels',
      }),
      f('hires', 'latentMethod', {
        label: 'latent 보간',
        help: 'latent 방식에서 키울 때 쓰는 보간. 결과 차이는 작다. 보통 nearest-exact 또는 bislerp.',
        type: 'select',
        options: 'latentMethods',
      }),
      f('hires', 'pixelMethod', {
        label: '픽셀 보간',
        help: 'pixel·model 방식에서 크기를 맞출 때 쓰는 보간. lanczos가 가장 선명하다.',
        type: 'select',
        options: 'pixelMethods',
      }),
    ],
  },
  {
    key: 'seed',
    label: '시드',
    help: '초안에서 실행할 때마다 시드를 어떻게 바꿀지.',
    levels: ['global'],
    fields: [
      f('seed', 'control', {
        label: '실행마다 시드 바꾸기',
        help: 'randomize: 실행할 때마다 무작위로 바꾼다(권장). increment: 1씩 늘린다. 어느 쪽이든 후보의 다양성은 같고, 확정한 줄은 고정된다.',
        type: 'select',
        options: 'seedControls',
      }),
    ],
  },
  {
    key: 'output',
    label: '저장·내보내기',
    help: '저장 경로와 내보내기 이름 규칙.',
    noPreset: true,
    levels: ['global', 'group', 'scene'],
    fields: [
      f('output', 'savePattern', {
        label: '저장 경로',
        help: 'ComfyUI output 폴더 기준 경로. {캐릭터} {장면코드} {장면이름} {그룹} 토큰과 %date:yyyy-MM-dd% 같은 ComfyUI 토큰을 쓸 수 있다. 마지막 부분(파일 이름)은 줄마다 달라야 한다 — 끌어다 놓을 때 파일 이름으로 줄을 찾기 때문.',
        type: 'text',
      }),
      f('output', 'finalMarker', {
        label: '마무리 표시',
        help: '마무리 이미지 파일 이름 끝에 붙는 표시. 끌어다 놓을 때 초안과 구분하는 데 쓴다.',
        type: 'text',
        levels: ['global'],
      }),
      f('output', 'exportPattern', {
        label: '내보내기 이름',
        help: 'zip 안의 파일 경로. ComfyUI가 붙이는 _00001_ 같은 번호를 떼고 이 규칙대로 바꾼다. 예) {캐릭터}/{장면코드}.png',
        type: 'text',
        levels: ['global'],
      }),
    ],
  },
];

export function getBundle(key: BundleKey): BundleDef {
  return BUNDLES.find((b) => b.key === key)!;
}

export function getField(bundle: BundleKey, key: string): FieldDef | undefined {
  return getBundle(bundle).fields.find((x) => x.key === key);
}

/** 저장·내보내기 묶음의 기본값 (프리셋과 관계없음) */
export const OUTPUT_DEFAULTS = {
  savePattern: '{캐릭터}/{캐릭터}_{장면코드}',
  finalMarker: '_final',
  exportPattern: '{캐릭터}/{장면코드}.png',
};

export const SEED_DEFAULTS = { control: 'randomize' as const };

export const PROMPT_PART_LABELS: Record<string, string> = {
  quality: '품질 태그',
  character: '캐릭터 (트리거 워드 → 외형)',
  group: '그룹 공통',
  scene: '장면',
  elements: '조각 · 로라 트리거',
};

export const ORIGIN_LABELS: Record<string, string> = {
  preset: '프리셋',
  mine: '내 프리셋',
  global: '전역',
  group: '그룹',
  scene: '장면',
};

export const HIRES_METHOD_LABELS: Record<string, string> = {
  pixel: 'pixel (lanczos 확대, 권장)',
  latent: 'latent (가장 빠름)',
  model: 'model (업스케일 모델)',
};

export const SEED_CONTROL_LABELS: Record<string, string> = {
  randomize: 'randomize (무작위, 권장)',
  increment: 'increment (1씩 증가)',
};
