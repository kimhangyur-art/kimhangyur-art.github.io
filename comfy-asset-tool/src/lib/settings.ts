// 설정 계층: 프리셋(또는 내 프리셋) → 전역 → 그룹 → 장면
// 각 값이 어느 단계에서 왔는지(origin)도 함께 돌려준다.

import {
  FALLBACK_FAMILY,
  detectFamily,
  getPreset,
  isStochasticSampler,
  type FamilyPreset,
} from './presets';
import { BUNDLES, OUTPUT_DEFAULTS, SEED_DEFAULTS, getBundle } from './settingsSchema';
import type {
  BundleKey,
  BundleValues,
  FamilyId,
  Issue,
  Library,
  MyPreset,
  Origin,
  Project,
  Scene,
  SceneGroup,
  SettingsLayer,
  SettingsLevel,
} from './types';

export interface ResolveContext {
  project: Project;
  library: Library;
  group?: SceneGroup | null;
  scene?: Scene | null;
}

export type OriginMap = { [K in BundleKey]: Record<string, Origin> };

export interface Resolved {
  family: FamilyId;
  familyGuessed: boolean;
  preset: FamilyPreset;
  myPreset: MyPreset | null;
  values: BundleValues;
  origins: OriginMap;
  /** 프리셋 값에 붙는 짧은 메모 (예: 구도 맞추기 권장 샘플러) */
  notes: Partial<Record<string, string>>;
}

export function emptyLayer(): SettingsLayer {
  return { modes: {}, values: {} };
}

export function effectiveFamily(project: Project): { family: FamilyId; guessed: boolean; detected: FamilyId | null } {
  const detected = detectFamily(project.checkpoint);
  if (project.family !== 'auto') return { family: project.family, guessed: false, detected };
  return { family: detected ?? FALLBACK_FAMILY, guessed: true, detected };
}

export function findMyPreset(library: Library, checkpoint: string): MyPreset | null {
  const name = normalizeCkpt(checkpoint);
  if (!name) return null;
  return library.myPresets.find((p) => normalizeCkpt(p.checkpoint) === name) ?? null;
}

function normalizeCkpt(s: string): string {
  return s.trim().replace(/\\/g, '/').toLowerCase();
}

/** 프리셋에서 바로 나오는 묶음 값 (계층 적용 전) */
export function presetBundleValues(preset: FamilyPreset): BundleValues {
  return {
    model: { ...preset.model },
    generation: { ...preset.generation },
    prompt: { ...preset.prompt, order: [...preset.prompt.order] },
    hires: { ...preset.hires },
    seed: { ...SEED_DEFAULTS },
    output: { ...OUTPUT_DEFAULTS },
  };
}

function layerFor(level: SettingsLevel, ctx: ResolveContext): SettingsLayer | null | undefined {
  if (level === 'global') return ctx.project.settings;
  if (level === 'group') return ctx.group?.settings;
  return ctx.scene?.settings;
}

/** 이 묶음이 그 단계에서 실제로 쓰이는지 (권장/상위 따르기면 무시) */
export function layerActive(layer: SettingsLayer | null | undefined, bundle: BundleKey): boolean {
  if (!layer) return false;
  if (getBundle(bundle).noPreset) return true;
  return layer.modes[bundle] === 'custom';
}

function fieldAllowed(bundle: BundleKey, key: string, level: SettingsLevel): boolean {
  const def = getBundle(bundle);
  if (!def.levels.includes(level)) return false;
  const fieldKey = key === 'width' || key === 'height' ? 'resolution' : key;
  const field = def.fields.find((x) => x.key === fieldKey);
  if (!field) return false;
  return !field.levels || field.levels.includes(level);
}

/** 어디까지의 계층을 적용할지: 'preset'이면 프리셋만, 'global'이면 전역까지 ... */
export type ResolveUpTo = 'preset' | SettingsLevel;

const LEVELS: SettingsLevel[] = ['global', 'group', 'scene'];

export function resolveSettings(ctx: ResolveContext, upTo: ResolveUpTo = 'scene'): Resolved {
  const { family, guessed } = effectiveFamily(ctx.project);
  const preset = getPreset(family);
  const myPreset = ctx.project.useMyPreset ? findMyPreset(ctx.library, ctx.project.checkpoint) : null;
  const values = presetBundleValues(preset);
  const notes: Partial<Record<string, string>> = {};
  const origins = {} as OriginMap;
  for (const b of BUNDLES) {
    origins[b.key] = {};
    for (const k of Object.keys(values[b.key])) origins[b.key][k] = 'preset';
  }

  // 구도 맞추기 그룹은 단계마다 노이즈를 넣지 않는 샘플러를 권장값으로 쓴다.
  if (ctx.group?.seedMode === 'match' && (upTo === 'group' || upTo === 'scene')) {
    if (isStochasticSampler(values.generation.sampler)) {
      values.generation.sampler = preset.matchComposition.sampler;
      values.generation.scheduler = preset.matchComposition.scheduler;
      notes['generation.sampler'] = '구도 맞추기 그룹 권장값';
      notes['generation.scheduler'] = '구도 맞추기 그룹 권장값';
    }
  }

  if (myPreset) {
    for (const [bundle, partial] of Object.entries(myPreset.values) as Array<[BundleKey, Record<string, unknown>]>) {
      overlay(values, origins, bundle, partial, 'mine', null);
    }
    // 내 프리셋이 샘플러를 정했더라도 구도 맞추기 그룹이면 다시 권장 샘플러로 바꾼다.
    if (ctx.group?.seedMode === 'match' && (upTo === 'group' || upTo === 'scene') && isStochasticSampler(values.generation.sampler)) {
      values.generation.sampler = preset.matchComposition.sampler;
      values.generation.scheduler = preset.matchComposition.scheduler;
      origins.generation.sampler = 'preset';
      origins.generation.scheduler = 'preset';
      notes['generation.sampler'] = '구도 맞추기 그룹 권장값';
      notes['generation.scheduler'] = '구도 맞추기 그룹 권장값';
    }
  }

  if (upTo !== 'preset') {
    const last = LEVELS.indexOf(upTo);
    for (let i = 0; i <= last; i++) {
      const level = LEVELS[i];
      const layer = layerFor(level, ctx);
      if (!layer) continue;
      for (const b of BUNDLES) {
        if (!layerActive(layer, b.key)) continue;
        const partial = layer.values[b.key] as Record<string, unknown> | undefined;
        if (partial) overlay(values, origins, b.key, partial, level, level);
      }
    }
  }

  return { family, familyGuessed: guessed, preset, myPreset, values, origins, notes };
}

function overlay(
  values: BundleValues,
  origins: OriginMap,
  bundle: BundleKey,
  partial: Record<string, unknown>,
  origin: Origin,
  level: SettingsLevel | null,
) {
  const target = values[bundle] as unknown as Record<string, unknown>;
  for (const [key, v] of Object.entries(partial)) {
    if (v === undefined) continue;
    if (!(key in target)) continue;
    if (level && !fieldAllowed(bundle, key, level)) continue;
    // 저장 경로 같은 글자 값은 빈 문자열이면 덮어쓰지 않은 것으로 본다.
    if (bundle === 'output' && typeof v === 'string' && v.trim() === '') continue;
    target[key] = Array.isArray(v) ? [...v] : v;
    origins[bundle][key] = origin;
  }
}

/** 그 단계에서 이 값을 직접 덮어쓰고 있는지 */
export function isOverridden(layer: SettingsLayer | null | undefined, bundle: BundleKey, key: string): boolean {
  if (!layer) return false;
  const partial = layer.values[bundle] as Record<string, unknown> | undefined;
  if (!partial) return false;
  if (key === 'resolution') return partial.width !== undefined || partial.height !== undefined;
  const v = partial[key];
  if (v === undefined) return false;
  if (bundle === 'output' && typeof v === 'string' && v.trim() === '') return false;
  return true;
}

// ---------------------------------------------------------------------------
// 경고

export interface FieldIssue extends Issue {
  bundle: BundleKey;
  field: string;
}

export function typicalRange(preset: FamilyPreset, bundle: BundleKey, key: string): [number, number] | undefined {
  const own = preset.ranges?.[key];
  if (own && bundle === 'generation') return own;
  return getBundle(bundle).fields.find((x) => x.key === key)?.typical;
}

export function isKnownResolution(preset: FamilyPreset, w: number, h: number): boolean {
  return preset.resolutions.some(([a, b]) => a === w && b === h);
}

/** 해석된 설정 값에 대한 경고 (막지 않는다) */
export function settingsIssues(resolved: Resolved, ctx: { group?: SceneGroup | null; finalize?: boolean }): FieldIssue[] {
  const out: FieldIssue[] = [];
  const { values, preset } = resolved;
  const push = (bundle: BundleKey, field: string, level: Issue['level'], message: string) =>
    out.push({ bundle, field, level, message });

  for (const b of BUNDLES) {
    for (const def of b.fields) {
      if (def.type !== 'int' && def.type !== 'float') continue;
      const v = (values[b.key] as unknown as Record<string, unknown>)[def.key];
      if (typeof v !== 'number') continue;
      if (b.key === 'model' && (def.key === 'rescaleCfg' || def.key === 'clipSkip')) {
        // 계열마다 맞는 값이 달라서 범위 경고 대신 아래에서 따로 본다.
      } else {
        const range = typicalRange(preset, b.key, def.key);
        if (range && (v < range[0] || v > range[1])) {
          if (!(b.key === 'generation' && def.key === 'batchSize')) {
            push(b.key, def.key, 'warn', `보통 범위(${fmtRange(range)})를 벗어났습니다.`);
          }
        }
      }
      if (!Number.isFinite(v)) push(b.key, def.key, 'error', '숫자가 아닙니다.');
    }
  }

  const g = values.generation;
  if (!isKnownResolution(preset, g.width, g.height)) {
    push('generation', 'resolution', 'warn', `${g.width}×${g.height}은(는) ${preset.label}이(가) 잘 다루는 크기 목록에 없습니다.`);
  }
  if (g.width % 8 !== 0 || g.height % 8 !== 0) {
    push('generation', 'resolution', 'warn', '가로·세로는 8의 배수여야 합니다. ComfyUI가 잘라 낼 수 있습니다.');
  }
  if (g.batchSize > 1) {
    push(
      'generation',
      'batchSize',
      'warn',
      '배치 2 이상: 두 번째 이후 이미지는 시드만으로 재현되지 않아 마무리에서 같은 그림이 나오지 않습니다. 반복 횟수로 후보를 늘리세요.',
    );
  }
  if (ctx.group?.seedMode === 'match' && isStochasticSampler(g.sampler)) {
    push(
      'generation',
      'sampler',
      'warn',
      `구도 맞추기 그룹인데 ${g.sampler}는 단계마다 노이즈를 넣는 샘플러라 효과가 약합니다. ${preset.matchComposition.sampler} 같은 샘플러를 권장합니다.`,
    );
  }
  const m = values.model;
  if (m.vpred && /karras/.test(g.scheduler)) {
    push('generation', 'scheduler', 'warn', 'v-pred 모델에는 karras 스케줄러가 잘 맞지 않습니다. normal을 권장합니다.');
  }
  if (preset.model.vpred && !m.vpred) {
    push('model', 'vpred', 'warn', `${preset.label}은(는) v-pred 모델입니다. 끄면 그림이 망가질 수 있습니다.`);
  }
  if (!preset.model.vpred && m.vpred) {
    push('model', 'vpred', 'warn', '일반(eps) 계열에서 v-pred를 켰습니다. 모델 설명을 확인하세요.');
  }
  if (!m.vpred && m.zsnr) push('model', 'zsnr', 'info', 'v-pred가 꺼져 있어 ZSNR은 쓰이지 않습니다.');
  if (m.clipSkip !== preset.model.clipSkip) {
    push('model', 'clipSkip', 'info', `${preset.label} 권장값은 ${preset.model.clipSkip}입니다.`);
  }

  const h = values.hires;
  if (h.method === 'latent' && h.denoise < 0.5) {
    push('hires', 'denoise', 'warn', 'latent 방식은 다시 그리는 강도를 0.5 이상 줘야 깨끗합니다.');
  }
  if (h.method === 'model' && !h.upscaleModel.trim()) {
    push('hires', 'upscaleModel', ctx.finalize ? 'error' : 'warn', 'model 방식에는 업스케일 모델 파일을 지정해야 합니다.');
  }
  return out;
}

function fmtRange([a, b]: [number, number]): string {
  return a === b ? `${a}` : `${a}~${b}`;
}

/** 고화질 단계에서 실제로 쓰는 값 (비워 둔 값은 기본 단계 값으로 채운다) */
export function effectiveHires(values: BundleValues) {
  const h = values.hires;
  const g = values.generation;
  const width = roundTo8(g.width * h.scale);
  const height = roundTo8(g.height * h.scale);
  return {
    ...h,
    cfg: h.cfg ?? g.cfg,
    sampler: h.sampler || g.sampler,
    scheduler: h.scheduler || g.scheduler,
    width,
    height,
  };
}

export function roundTo8(n: number): number {
  return Math.max(8, Math.round(n / 8) * 8);
}
