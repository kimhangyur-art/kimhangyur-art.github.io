// 도구의 프로젝트 데이터 구조.
// 프로젝트 파일(JSON)이 원본이고, ComfyUI 워크플로우는 매번 여기서 만들어 내는 결과물이다.

export type ID = string;

/** 줄(캐릭터 × 장면)의 상태: 미정 / 확정 / 완성 */
export type RowStatus = 'pending' | 'confirmed' | 'done';

export interface LoraUse {
  file: string;
  strength: number;
  /** CLIP 쪽 강도. 비우면(null) strength와 같다. */
  clipStrength?: number | null;
}

export interface Character {
  id: ID;
  name: string;
  /** 파일 이름에 쓰는 ID ({캐릭터} 토큰) */
  fileId: string;
  /** 외형 프롬프트 */
  prompt: string;
  negative: string;
  trigger: string;
  loras: LoraUse[];
  note: string;
  color: string;
}

/** 프롬프트 조각: 의상, 소품, 배경 같은 재사용 문구 */
export interface Fragment {
  id: ID;
  kind: 'fragment';
  name: string;
  category: string;
  positive: string;
  negative: string;
  note: string;
  applyToAll: boolean;
}

/** 단독 로라: 장면별로 배정하거나 전체에 적용한다 */
export interface StandaloneLora {
  id: ID;
  kind: 'lora';
  name: string;
  file: string;
  strength: number;
  clipStrength?: number | null;
  trigger: string;
  note: string;
  applyToAll: boolean;
}

export type Element = Fragment | StandaloneLora;

/** 장면에 배정된 요소. 로라는 장면별 강도를 따로 가질 수 있다. */
export interface ElementRef {
  id: ID;
  /** 로라 강도 덮어쓰기. null이면 요소의 기본 강도 */
  strength?: number | null;
}

export type SeedMode = 'independent' | 'match';

export interface SceneGroup {
  id: ID;
  name: string;
  prompt: string;
  negative: string;
  note: string;
  color: string;
  /** independent: 줄마다 독립 시드, match: 구도 맞추기(같은 캐릭터끼리 시드 공유) */
  seedMode: SeedMode;
  settings: SettingsLayer;
  /** 라이브러리 세트에서 만들어졌으면 그 세트 ID */
  fromSetId?: ID | null;
}

export interface Scene {
  id: ID;
  /** 장면 코드(자유 문자열). 파일 이름 {장면코드} 토큰 */
  code: string;
  name: string;
  groupId: ID;
  prompt: string;
  negative: string;
  elements: ElementRef[];
  settings: SettingsLayer;
  enabled: boolean;
  note: string;
}

export interface Row {
  charId: ID;
  sceneId: ID;
  status: RowStatus;
  /** 고정 시드. null이면 실행마다 새로 뽑는다. */
  seed: number | null;
  seedFrom?: 'png' | 'group' | 'manual' | null;
  /** 작게 줄인 썸네일 (data URL) */
  thumb: string | null;
  memo: string;
  confirmedFile?: string | null;
  finalFile?: string | null;
  updatedAt?: number;
}

// ---------------------------------------------------------------------------
// 설정

export type BundleKey = 'model' | 'generation' | 'prompt' | 'hires' | 'seed' | 'output';

export type PromptPart = 'quality' | 'character' | 'group' | 'scene' | 'elements';

export interface ModelValues {
  /** CLIPSetLastLayer 값 (-1 = 건너뛰지 않음, -2 = CLIP skip 2) */
  clipSkip: number;
  /** v-prediction 모델이면 ModelSamplingDiscrete 노드를 넣는다 */
  vpred: boolean;
  zsnr: boolean;
  /** 0이면 RescaleCFG 노드를 넣지 않는다 */
  rescaleCfg: number;
}

export interface GenerationValues {
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  batchSize: number;
}

export interface PromptValues {
  qualityTags: string;
  defaultNegative: string;
  order: PromptPart[];
}

export type HiresMethod = 'latent' | 'pixel' | 'model';

export interface HiresValues {
  method: HiresMethod;
  scale: number;
  denoise: number;
  steps: number;
  /** null이면 기본 단계와 같은 값 */
  cfg: number | null;
  /** 빈 문자열이면 기본 단계와 같은 값 */
  sampler: string;
  scheduler: string;
  upscaleModel: string;
  latentMethod: string;
  pixelMethod: string;
}

export interface SeedValues {
  control: 'randomize' | 'increment';
}

export interface OutputValues {
  savePattern: string;
  finalMarker: string;
  exportPattern: string;
}

export interface BundleValues {
  model: ModelValues;
  generation: GenerationValues;
  prompt: PromptValues;
  hires: HiresValues;
  seed: SeedValues;
  output: OutputValues;
}

export type BundleMode = 'inherit' | 'custom';

/** 한 단계(전역/그룹/장면)의 설정. 모드가 custom인 묶음에서만 값이 쓰인다. */
export interface SettingsLayer {
  modes: Partial<Record<BundleKey, BundleMode>>;
  values: { [K in BundleKey]?: Partial<BundleValues[K]> };
}

export type SettingsLevel = 'global' | 'group' | 'scene';

/** 값이 어디서 왔는지 */
export type Origin = 'preset' | 'mine' | 'global' | 'group' | 'scene';

export type FamilyId =
  | 'illustrious'
  | 'noobai-eps'
  | 'noobai-vpred'
  | 'pony'
  | 'animagine'
  | 'sdxl'
  | 'sd15-anime'
  | 'sd15';

export interface GenerateOptions {
  /** 대상이 아닌 줄도 SaveImage만 mute해서 넣을지 */
  includeNonTarget: boolean;
}

export interface Project {
  version: 1;
  id: ID;
  name: string;
  checkpoint: string;
  /** 'auto'면 체크포인트 파일명으로 추정 */
  family: FamilyId | 'auto';
  /** 체크포인트에 저장된 "내 프리셋"이 있으면 권장값 대신 쓴다 */
  useMyPreset: boolean;
  characters: Character[];
  elements: Element[];
  groups: SceneGroup[];
  scenes: Scene[];
  rows: Row[];
  settings: SettingsLayer;
  generate: GenerateOptions;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// 라이브러리 (프로젝트 밖에 따로 저장)

export type AspectHint = 'square' | 'portrait' | 'landscape';

export interface SceneSetTemplate {
  code: string;
  name: string;
  prompt: string;
  negative: string;
  note: string;
}

export interface SceneSet {
  id: ID;
  name: string;
  note: string;
  builtin?: boolean;
  group: {
    name: string;
    prompt: string;
    negative: string;
    note: string;
    color: string;
    seedMode: SeedMode;
    /** 적용할 때 현재 프리셋의 해상도 목록에서 이 비율의 크기를 골라 넣는다 */
    aspect?: AspectHint | null;
    settings?: SettingsLayer;
  };
  scenes: SceneSetTemplate[];
}

export interface MyPreset {
  id: ID;
  checkpoint: string;
  name: string;
  values: { [K in 'model' | 'generation' | 'prompt' | 'hires']?: Partial<BundleValues[K]> };
  savedAt: number;
}

export interface Library {
  sets: SceneSet[];
  myPresets: MyPreset[];
}

// ---------------------------------------------------------------------------
// 공통 경고

export type IssueLevel = 'error' | 'warn' | 'info';

export interface Issue {
  level: IssueLevel;
  message: string;
  /** 관련 줄 키 등 */
  ref?: string;
}
