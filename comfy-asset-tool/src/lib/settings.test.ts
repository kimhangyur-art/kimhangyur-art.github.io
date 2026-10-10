import { describe, expect, it } from 'vitest';
import { detectFamily, getPreset, resolutionForAspect } from './presets';
import { resolveSettings, settingsIssues } from './settings';
import { emptyLibrary, ids, sampleProject } from '../test/fixtures';

describe('체크포인트 계열 추정', () => {
  it.each([
    ['waiIllustriousSDXL_v170.safetensors', 'illustrious'],
    ['noobaiXLNAIXL_vPred10Version.safetensors', 'noobai-vpred'],
    ['NoobAI-XL-v1.1.safetensors', 'noobai-eps'],
    ['ponyDiffusionV6XL_v6StartWithThisOne.safetensors', 'pony'],
    ['animagine-xl-4.0.safetensors', 'animagine'],
    ['sd_xl_base_1.0.safetensors', 'sdxl'],
    ['counterfeitV30_v30.safetensors', 'sd15-anime'],
    ['v1-5-pruned-emaonly.safetensors', 'sd15'],
  ])('%s → %s', (file, family) => {
    expect(detectFamily(file)).toBe(family);
  });

  it('모르는 이름은 null', () => {
    expect(detectFamily('mystery_model.safetensors')).toBeNull();
  });

  it('비율 힌트로 해상도를 고른다', () => {
    const p = getPreset('illustrious');
    expect(resolutionForAspect(p, 'square')).toEqual([1024, 1024]);
    expect(resolutionForAspect(p, 'portrait')).toEqual([832, 1216]);
    expect(resolutionForAspect(getPreset('sd15'), 'portrait')[1]).toBeGreaterThan(512);
  });
});

describe('설정 계층', () => {
  it('권장 모드면 프리셋 값을 그대로 쓴다', () => {
    const p = sampleProject();
    p.settings.values.generation = { cfg: 9 };
    // 모드가 custom이 아니면 값이 있어도 무시
    const r = resolveSettings({ project: p, library: emptyLibrary() });
    expect(r.family).toBe('illustrious');
    expect(r.values.generation.cfg).toBe(getPreset('illustrious').generation.cfg);
    expect(r.origins.generation.cfg).toBe('preset');
  });

  it('프리셋 → 전역 → 그룹 → 장면 순으로 덮어쓰고 출처를 기록한다', () => {
    const p = sampleProject();
    const { daily, d1 } = ids(p);
    p.settings.modes.generation = 'custom';
    p.settings.values.generation = { cfg: 6.5, steps: 30 };
    d1.settings.modes.generation = 'custom';
    d1.settings.values.generation = { steps: 22 };
    const r = resolveSettings({ project: p, library: emptyLibrary(), group: daily, scene: d1 });
    expect(r.values.generation.cfg).toBe(6.5);
    expect(r.origins.generation.cfg).toBe('global');
    expect(r.values.generation.width).toBe(832);
    expect(r.origins.generation.width).toBe('group');
    expect(r.values.generation.steps).toBe(22);
    expect(r.origins.generation.steps).toBe('scene');
    expect(r.origins.generation.sampler).toBe('preset');
  });

  it('구도 맞추기 그룹은 ancestral 대신 권장 샘플러를 쓴다', () => {
    const p = sampleProject();
    const { expr, e1, daily, d1 } = ids(p);
    const lib = emptyLibrary();
    expect(resolveSettings({ project: p, library: lib, group: daily, scene: d1 }).values.generation.sampler).toBe('euler_ancestral');
    const r = resolveSettings({ project: p, library: lib, group: expr, scene: e1 });
    expect(r.values.generation.sampler).toBe('euler');
    expect(r.notes['generation.sampler']).toMatch(/구도 맞추기/);
  });

  it('구도 맞추기 그룹에서 직접 ancestral을 고르면 경고한다', () => {
    const p = sampleProject();
    const { expr, e1 } = ids(p);
    expr.settings.modes.generation = 'custom';
    expr.settings.values.generation = { sampler: 'euler_ancestral' };
    const r = resolveSettings({ project: p, library: emptyLibrary(), group: expr, scene: e1 });
    const issues = settingsIssues(r, { group: expr });
    expect(issues.some((i) => i.field === 'sampler' && /구도 맞추기/.test(i.message))).toBe(true);
  });

  it('내 프리셋이 있으면 권장값 대신 쓴다', () => {
    const p = sampleProject();
    const lib = emptyLibrary();
    lib.myPresets.push({ id: 'm', checkpoint: p.checkpoint, name: '내 것', values: { generation: { cfg: 4.2 } }, savedAt: 0 });
    const r = resolveSettings({ project: p, library: lib });
    expect(r.values.generation.cfg).toBe(4.2);
    expect(r.origins.generation.cfg).toBe('mine');
    p.useMyPreset = false;
    expect(resolveSettings({ project: p, library: lib }).values.generation.cfg).toBe(getPreset('illustrious').generation.cfg);
  });

  it('범위 밖 값과 목록 밖 해상도, 배치 2 이상은 막지 않고 경고한다', () => {
    const p = sampleProject();
    p.settings.modes.generation = 'custom';
    p.settings.values.generation = { cfg: 12, width: 1000, height: 1000, batchSize: 2 };
    const r = resolveSettings({ project: p, library: emptyLibrary() });
    const issues = settingsIssues(r, {});
    expect(issues.find((i) => i.field === 'cfg')?.level).toBe('warn');
    expect(issues.find((i) => i.field === 'resolution')?.level).toBe('warn');
    expect(issues.find((i) => i.field === 'batchSize')?.message).toMatch(/재현/);
    expect(issues.every((i) => i.level !== 'error')).toBe(true);
  });

  it('v-pred 계열 프리셋은 ModelSamplingDiscrete 설정과 RescaleCFG를 켠다', () => {
    const p = sampleProject();
    p.checkpoint = 'noobaiXL_vpred10.safetensors';
    const r = resolveSettings({ project: p, library: emptyLibrary() });
    expect(r.values.model).toMatchObject({ vpred: true, zsnr: true, rescaleCfg: 0.7 });
    expect(r.values.generation.sampler).toBe('euler');
  });
});
