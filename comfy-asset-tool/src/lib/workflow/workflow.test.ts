import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { seededRng } from '../ids';
import { planGeneration, type GenMode } from '../plan';
import type { Project } from '../types';
import { emptyLibrary, ids, row, sampleProject } from '../../test/fixtures';
import { isLink, toApiPrompt, type ApiPrompt } from './apiPrompt';
import { buildWorkflow, stageAvailable, type PostStage } from './generate';
import type { Workflow } from './graph';
import { groupOfNode, validateWorkflow } from './validate';

function build(p: Project, mode: GenMode, includeNonTarget = false, seed = 7) {
  const lib = emptyLibrary();
  const plan = planGeneration(p, lib, { mode, includeNonTarget });
  return { plan, ...buildWorkflow(p, lib, plan, { rng: seededRng(seed), now: new Date('2026-10-10T00:00:00Z') }) };
}

function nodesOf(wf: Workflow, type: string) {
  return wf.nodes.filter((n) => n.type === type);
}

/** KSampler가 실제로 받는 값 전체를 위로 따라가며 문자열로 만든다 (노드 id는 빼고, PrimitiveInt는 그 값으로) */
function signature(prompt: ApiPrompt, id: string): string {
  const n = prompt[id];
  if (!n) throw new Error(`노드 ${id} 없음`);
  if (n.class_type === 'PrimitiveInt') return JSON.stringify(n.inputs.value);
  const parts = Object.keys(n.inputs)
    .sort()
    .map((k) => {
      const v = n.inputs[k];
      if (isLink(v) && prompt[String(v[0])]?.class_type === 'PrimitiveInt') return `${k}=${signature(prompt, String(v[0]))}`;
      return `${k}=${isLink(v) ? `<${signature(prompt, String(v[0]))}#${v[1]}>` : JSON.stringify(v)}`;
    });
  return `${n.class_type}(${parts.join(',')})`;
}

describe('워크플로우 형식', () => {
  it('참고 샘플도 구조 검사를 통과한다 (실제로 열리는 형식을 이해하는지 확인)', () => {
    const sample = JSON.parse(readFileSync(new URL('../../../reference/hexmaniac_assets_workflow.json', import.meta.url), 'utf8'));
    expect(validateWorkflow(sample)).toEqual([]);
  });

  it.each(['draft', 'finalize'] as const)('%s: 링크가 맞고 노드·그룹이 겹치지 않으며 모든 노드가 그룹 안에 있다', (mode) => {
    const p = sampleProject();
    if (mode === 'finalize') for (const r of p.rows) Object.assign(r, { status: 'confirmed', seed: 1000 });
    const { workflow } = build(p, mode, true);
    expect(validateWorkflow(workflow, { checkOverlap: true })).toEqual([]);
    for (const n of workflow.nodes) expect(groupOfNode(workflow, n.id), n.title).not.toBeNull();
    expect(workflow.version).toBe(0.4);
    expect(workflow.last_node_id).toBe(Math.max(...workflow.nodes.map((n) => n.id)));
  });

  it('장면 그룹마다 ComfyUI 그룹을 만들고, 줄 제목은 "장면코드 장면이름 · 캐릭터"', () => {
    const p = sampleProject();
    const { workflow, rowNodes } = build(p, 'draft');
    expect(workflow.groups.map((g) => g.title.split(' · ')[0])).toEqual(['공통', '표정', '일상']);
    const { a, e1 } = ids(p);
    const pos = workflow.nodes.find((n) => n.id === rowNodes.get(`${a.id}|${e1.id}`)!.positive)!;
    expect(pos.title).toBe('E01 기본 · 헥스');
  });

  it('장면 주석은 Note 노드로 옆에 둔다', () => {
    const p = sampleProject();
    const { workflow } = build(p, 'draft');
    const notes = nodesOf(workflow, 'Note').filter((n) => String(n.widgets_values[0]).includes('눈썹 강조'));
    expect(notes).toHaveLength(2); // E03 × 캐릭터 2명
  });
});

describe('초안', () => {
  it('미정 줄만 넣고, 시드는 실행마다 바뀐다', () => {
    const p = sampleProject();
    const { a, b, d2 } = ids(p);
    Object.assign(row(p, a.id, d2.id), { status: 'confirmed', seed: 42 });
    const { workflow, plan } = build(p, 'draft');
    expect(plan.targets).toHaveLength(9);
    expect(nodesOf(workflow, 'SaveImage')).toHaveLength(9);
    // 독립 시드 그룹(일상)의 KSampler는 randomize
    const dailyB = workflow.nodes.find((n) => n.title === 'D02 독서 · 라니 · 샘플러')!;
    expect(dailyB.widgets_values[1]).toBe('randomize');
    expect(dailyB.inputs.find((i) => i.name === 'seed')).toBeUndefined();
    void b;
  });

  it('구도 맞추기 그룹은 같은 캐릭터 줄끼리 PrimitiveInt 시드 하나를 공유한다', () => {
    const p = sampleProject();
    const { a, e1, e2, e3 } = ids(p);
    const { workflow, rowNodes } = build(p, 'draft');
    const prims = nodesOf(workflow, 'PrimitiveInt');
    expect(prims).toHaveLength(2); // 표정 × 캐릭터 2명
    expect(prims.every((n) => n.widgets_values[1] === 'randomize')).toBe(true);
    const seedSources = [e1, e2, e3].map((s) => {
      const ks = workflow.nodes.find((n) => n.id === rowNodes.get(`${a.id}|${s.id}`)!.ksampler)!;
      const inp = ks.inputs.find((i) => i.name === 'seed')!;
      expect(inp.widget).toEqual({ name: 'seed' });
      return workflow.links.find((l) => l[0] === inp.link)![1];
    });
    expect(new Set(seedSources).size).toBe(1);
  });

  it('구도 맞추기 그룹이라도 시드를 고정한 줄은 그 값을 직접 쓴다', () => {
    const p = sampleProject();
    const { a, e2 } = ids(p);
    Object.assign(row(p, a.id, e2.id), { seed: 777, seedFrom: 'group' });
    const { workflow, rowNodes } = build(p, 'draft');
    const ks = workflow.nodes.find((n) => n.id === rowNodes.get(`${a.id}|${e2.id}`)!.ksampler)!;
    expect(ks.widgets_values.slice(0, 2)).toEqual([777, 'fixed']);
    expect(ks.inputs.find((i) => i.name === 'seed')).toBeUndefined();
  });

  it('대상이 아닌 줄은 기본으로 빼고, 옵션을 켜면 SaveImage만 mute해서 넣는다', () => {
    const p = sampleProject();
    const { a, d1 } = ids(p);
    Object.assign(row(p, a.id, d1.id), { status: 'confirmed', seed: 5 });
    p.scenes[2].enabled = false; // E03 끔
    const off = build(p, 'draft', false);
    expect(nodesOf(off.workflow, 'SaveImage')).toHaveLength(7);
    const on = build(p, 'draft', true);
    const saves = nodesOf(on.workflow, 'SaveImage');
    expect(saves).toHaveLength(10);
    expect(saves.filter((n) => n.mode === 2)).toHaveLength(3);
    expect(on.workflow.nodes.filter((n) => n.mode !== 0).every((n) => n.type === 'SaveImage')).toBe(true);
    // mute된 저장 노드는 실행 정보에서 빠진다
    const prompt = toApiPrompt(on.workflow);
    expect(Object.values(prompt).filter((n) => n.class_type === 'SaveImage')).toHaveLength(7);
  });
});

describe('노드 공유', () => {
  it('로라 조합별 체인(앞부분 공유), 체인마다 CLIP skip, 해상도별 latent, 로라 없으면 체크포인트에서 바로', () => {
    const p = sampleProject();
    const { b, e1 } = ids(p);
    const { workflow, rowNodes, stats } = build(p, 'draft');
    expect(nodesOf(workflow, 'CheckpointLoaderSimple')).toHaveLength(1);
    // A: [hex], A·D1: [hex, bg], B·D1: [bg], B: [] → LoraLoader 3개, 체인 끝 4개
    expect(stats.loraLoaders).toBe(3);
    expect(nodesOf(workflow, 'CLIPSetLastLayer')).toHaveLength(4);
    expect(nodesOf(workflow, 'CLIPSetLastLayer').every((n) => n.widgets_values[0] === -2)).toBe(true);
    expect(nodesOf(workflow, 'EmptyLatentImage').map((n) => n.widgets_values)).toEqual([
      [1024, 1024, 1],
      [832, 1216, 1],
    ]);
    const ckpt = nodesOf(workflow, 'CheckpointLoaderSimple')[0];
    const ks = workflow.nodes.find((n) => n.id === rowNodes.get(`${b.id}|${e1.id}`)!.ksampler)!;
    const modelLink = workflow.links.find((l) => l[0] === ks.inputs.find((i) => i.name === 'model')!.link)!;
    expect(modelLink[1]).toBe(ckpt.id);
  });

  it('같은 체인·같은 네거티브를 쓰는 줄은 네거티브 인코딩을 공유한다', () => {
    const p = sampleProject();
    const { b, e1, e3, e2 } = ids(p);
    const { rowNodes } = build(p, 'draft');
    const n1 = rowNodes.get(`${b.id}|${e1.id}`)!.negative;
    expect(rowNodes.get(`${b.id}|${e3.id}`)!.negative).toBe(n1);
    expect(rowNodes.get(`${b.id}|${e2.id}`)!.negative).not.toBe(n1); // 조각의 부정 "hat"이 붙는다
  });

  it('v-pred 모델은 ModelSamplingDiscrete와 RescaleCFG를 넣고 체인이 그 뒤에서 시작한다', () => {
    const p = sampleProject();
    p.checkpoint = 'noobaiXL_vPred10.safetensors';
    const { workflow } = build(p, 'draft');
    const msd = nodesOf(workflow, 'ModelSamplingDiscrete');
    expect(msd).toHaveLength(1);
    expect(msd[0].widgets_values).toEqual(['v_prediction', true]);
    const rc = nodesOf(workflow, 'RescaleCFG')[0];
    expect(rc.widgets_values).toEqual([0.7]);
    const loraModelSources = nodesOf(workflow, 'LoraLoader')
      .map((n) => workflow.links.find((l) => l[0] === n.inputs[0].link)![1])
      .filter((id) => !nodesOf(workflow, 'LoraLoader').some((x) => x.id === id));
    expect(new Set(loraModelSources)).toEqual(new Set([rc.id]));
  });
});

describe('마무리', () => {
  function confirmAll(p: Project) {
    p.rows.forEach((r, i) => Object.assign(r, { status: 'confirmed', seed: 1000 + i }));
  }

  it('확정 줄만 고정 시드로 넣고, 파일 이름에 마무리 표시를 붙인다', () => {
    const p = sampleProject();
    confirmAll(p);
    const { a, e1 } = ids(p);
    Object.assign(row(p, a.id, e1.id), { status: 'done' });
    const { workflow, plan } = build(p, 'finalize');
    expect(plan.targets).toHaveLength(9);
    const saves = nodesOf(workflow, 'SaveImage');
    expect(saves.every((n) => String(n.widgets_values[0]).endsWith('_final'))).toBe(true);
    expect(nodesOf(workflow, 'KSampler').every((n) => n.widgets_values[1] === 'fixed')).toBe(true);
    expect(nodesOf(workflow, 'PrimitiveInt')).toHaveLength(0);
  });

  it.each([
    ['pixel', ['VAEDecode', 'ImageScale', 'VAEEncode']],
    ['latent', ['LatentUpscaleBy']],
    ['model', ['VAEDecode', 'ImageUpscaleWithModel', 'ImageScale', 'VAEEncode']],
  ] as const)('고화질 단계(%s)는 기본 KSampler 뒤에만 붙는다', (method, between) => {
    const p = sampleProject();
    confirmAll(p);
    p.settings.modes.hires = 'custom';
    p.settings.values.hires = { method, upscaleModel: '4x-AnimeSharp.pth' };
    const { a, e1 } = ids(p);
    const { workflow, rowNodes } = build(p, 'finalize');
    const rn = rowNodes.get(`${a.id}|${e1.id}`)!;
    const prompt = toApiPrompt(workflow);
    const hires = prompt[String(rn.hiresKsampler)];
    expect(hires.inputs.denoise).toBeLessThan(1);
    // 고화질 KSampler의 latent를 거슬러 올라가면 between 노드들을 지나 기본 KSampler에 닿는다
    const chain: string[] = [];
    let cur = hires.inputs.latent_image as [string, number];
    while (prompt[cur[0]].class_type !== 'KSampler') {
      const n = prompt[cur[0]];
      chain.unshift(n.class_type);
      cur = (n.inputs.samples ?? n.inputs.pixels ?? n.inputs.image) as [string, number];
    }
    expect(cur[0]).toBe(String(rn.ksampler));
    expect(chain).toEqual(between);
    if (method === 'model') expect(nodesOf(workflow, 'UpscaleModelLoader')).toHaveLength(1);
  });

  it('후처리 단계 자리: 마무리에서만 디코드와 저장 사이에 끼운다', () => {
    const p = sampleProject();
    confirmAll(p);
    const lib = emptyLibrary();
    const stage: PostStage = {
      id: 'test',
      label: '시험',
      requiredNodes: ['ImageScale'],
      apply(gb, image, row) {
        const n = gb.add('ImageScale', { title: `${row.title} · 후처리`, widgets: { upscale_method: 'lanczos', width: 0, height: 0, crop: 'disabled' } });
        gb.connect(image, 0, n, 'image');
        return { output: n, nodes: [n] };
      },
    };
    expect(stageAvailable(stage, ['ImageScale'])).toBe(true);
    expect(stageAvailable(stage, undefined)).toBe(false);
    const fin = buildWorkflow(p, lib, planGeneration(p, lib, { mode: 'finalize' }), { postStages: [stage] });
    const prompt = toApiPrompt(fin.workflow);
    const save = Object.values(prompt).find((n) => n.class_type === 'SaveImage')!;
    expect(prompt[(save.inputs.images as [string, number])[0]]._meta?.title).toMatch(/후처리/);
    expect(validateWorkflow(fin.workflow, { checkOverlap: true })).toEqual([]);
    const draft = buildWorkflow(p, lib, planGeneration(p, lib, { mode: 'draft', includeNonTarget: true }), { postStages: [stage] });
    expect(draft.workflow.nodes.some((n) => n.title?.includes('후처리'))).toBe(false);
  });

  it('초안과 마무리의 기본 단계(프롬프트·해상도·steps·cfg·샘플러·스케줄러·시드)가 똑같다', () => {
    const p = sampleProject();
    for (const r of p.rows) Object.assign(r, { status: 'confirmed', seed: 31337 });
    const draft = build(p, 'draft', true, 1);
    const fin = build(p, 'finalize', false, 2);
    const dp = toApiPrompt(draft.workflow);
    const fp = toApiPrompt(fin.workflow);
    for (const r of p.rows) {
      const key = `${r.charId}|${r.sceneId}`;
      const d = signature(dp, String(draft.rowNodes.get(key)!.ksampler));
      const f = signature(fp, String(fin.rowNodes.get(key)!.ksampler));
      expect(f).toBe(d);
      expect(f).toContain('seed=31337');
    }
  });

  it('초안에서 뽑은 시드(공유 시드 포함)로 확정하면 마무리 기본 단계가 그 초안과 같다', () => {
    const p = sampleProject();
    const draft = build(p, 'draft', false, 99);
    const dp = toApiPrompt(draft.workflow);
    // 첫 실행에 쓰인 시드로 모든 줄을 확정
    for (const r of p.rows) {
      const key = `${r.charId}|${r.sceneId}`;
      Object.assign(r, { status: 'confirmed', seed: draft.rowNodes.get(key)!.seed });
    }
    const fin = build(p, 'finalize', false, 5);
    const fp = toApiPrompt(fin.workflow);
    for (const r of p.rows) {
      const key = `${r.charId}|${r.sceneId}`;
      expect(signature(fp, String(fin.rowNodes.get(key)!.ksampler))).toBe(signature(dp, String(draft.rowNodes.get(key)!.ksampler)));
    }
  });
});
