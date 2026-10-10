import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { analyzeDrop } from './confirm';
import { exportList, makeZip } from './exporter';
import { seededRng } from './ids';
import { planGeneration, rowNames } from './plan';
import { asciiJson, makePngWithText, readPngText } from './png';
import { asApiPrompt, traceSeed } from './seedTrace';
import { toApiPrompt } from './workflow/apiPrompt';
import { buildWorkflow } from './workflow/generate';
import type { Project } from './types';
import { emptyLibrary, ids, row, sampleProject } from '../test/fixtures';

function pngFor(p: Project, mode: 'draft' | 'finalize', seed = 3) {
  const lib = emptyLibrary();
  const plan = planGeneration(p, lib, { mode });
  const built = buildWorkflow(p, lib, plan, { rng: seededRng(seed) });
  const png = makePngWithText({ prompt: asciiJson(toApiPrompt(built.workflow)), workflow: asciiJson(built.workflow) });
  return { ...built, png };
}

describe('PNG 글자 정보', () => {
  it('tEXt로 넣은 prompt/workflow를 다시 읽는다 (한글은 \\u 이스케이프)', async () => {
    const png = makePngWithText({ prompt: asciiJson({ a: '헥스' }) });
    const t = await readPngText(png);
    expect(JSON.parse(t.prompt)).toEqual({ a: '헥스' });
  });

  it('PNG가 아니면 오류', async () => {
    await expect(readPngText(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).rejects.toThrow(/PNG/);
  });
});

describe('PNG 확정', () => {
  it('초안 PNG에서 줄을 찾고, 공유 PrimitiveInt를 따라가 시드를 읽는다', async () => {
    const p = sampleProject();
    const { a, e2 } = ids(p);
    const { png, rowNodes } = pngFor(p, 'draft');
    const texts = await readPngText(png);
    const r = analyzeDrop('hex_E02_00003_.png', texts, p, rowNames(p, emptyLibrary()));
    expect(r.key).toBe(`${a.id}|${e2.id}`);
    expect(r.stage).toBe('draft');
    expect(r.seedProblem).toBeNull();
    expect(r.seed).toBe(rowNodes.get(r.key!)!.seed);
    expect(r.trace!.seedPath).toHaveLength(2); // KSampler → PrimitiveInt
  });

  it('마무리 PNG는 고화질 KSampler가 아니라 기본 KSampler의 시드를 읽는다', async () => {
    const p = sampleProject();
    const { b, d1 } = ids(p);
    Object.assign(row(p, b.id, d1.id), { status: 'confirmed', seed: 123456789 });
    const { png } = pngFor(p, 'finalize');
    const texts = await readPngText(png);
    const r = analyzeDrop('rani_D01_final_00001_.png', texts, p, rowNames(p, emptyLibrary()));
    expect(r.stage).toBe('final');
    expect(r.trace!.hasHires).toBe(true);
    expect(r.seed).toBe(123456789);
    expect(r.issues.filter((i) => i.level === 'warn')).toEqual([]);
  });

  it('실행 정보가 없어도 파일 이름만으로 줄을 찾고, 이유를 알려 준다', () => {
    const p = sampleProject();
    const r = analyzeDrop('rani_E01_00002_.png', {}, p, rowNames(p, emptyLibrary()));
    expect(r.key).not.toBeNull();
    expect(r.seed).toBeNull();
    expect(r.seedProblem).toMatch(/실행 정보/);
  });

  it('줄을 못 찾으면 이유를 보여 준다', () => {
    const p = sampleProject();
    const r = analyzeDrop('ComfyUI_00001_.png', {}, p, rowNames(p, emptyLibrary()));
    expect(r.key).toBeNull();
    expect(r.reason).toMatch(/맞지 않습니다/);
  });

  it('파일 이름이 바뀌었어도 실행 정보에 저장 노드가 하나면 그것으로 찾는다', async () => {
    const p = sampleProject();
    const { a } = ids(p);
    // 미정 줄을 하나만 남긴다
    for (const r of p.rows) if (!(r.charId === a.id && r.sceneId === p.scenes[4].id)) Object.assign(r, { status: 'done', seed: 1 });
    const { png } = pngFor(p, 'draft');
    const r = analyzeDrop('my favorite.png', await readPngText(png), p, rowNames(p, emptyLibrary()));
    expect(r.key).toBe(`${a.id}|${p.scenes[4].id}`);
    expect(r.issues[0].message).toMatch(/실행 정보의 저장 경로/);
  });

  it('KSamplerAdvanced의 noise_seed, 여러 단계 연결도 따라간다', () => {
    const prompt = asApiPrompt({
      '1': { class_type: 'PrimitiveInt', inputs: { value: 55 } },
      '2': { class_type: 'SomeSeedNode', inputs: { seed: ['1', 0] } },
      '3': { class_type: 'KSamplerAdvanced', inputs: { noise_seed: ['2', 0], latent_image: ['4', 0] } },
      '4': { class_type: 'EmptyLatentImage', inputs: { width: 8, height: 8, batch_size: 1 } },
      '5': { class_type: 'VAEDecode', inputs: { samples: ['3', 0] } },
      '6': { class_type: 'SaveImage', inputs: { images: ['5', 0], filename_prefix: 'x' } },
    })!;
    const t = traceSeed(prompt, '6');
    expect(t.seed).toBe(55);
    expect(t.seedPath).toEqual(['3', '2', '1']);
  });
});

describe('내보내기', () => {
  it('완성 줄을 이름 규칙대로 바꿔 zip에 담는다', async () => {
    const p = sampleProject();
    const { a, e1, b } = ids(p);
    Object.assign(row(p, a.id, e1.id), { status: 'done', seed: 1, finalFile: 'hex_E01_final_00001_.png' });
    Object.assign(row(p, b.id, e1.id), { status: 'done', seed: 2 });
    const list = exportList(p, emptyLibrary(), new Set([`${a.id}|${e1.id}`]));
    expect(list.map((e) => [e.path, e.available])).toEqual([
      ['hex/E01.png', true],
      ['rani/E01.png', false],
    ]);
    const zipBlob = await makeZip([{ path: list[0].path, data: makePngWithText({}) }]);
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    expect(Object.keys(zip.files)).toContain('hex/E01.png');
  });

  it('내보내기 이름이 겹치면 번호를 붙인다', () => {
    const p = sampleProject();
    p.settings.values.output = { exportPattern: '{장면코드}.png' };
    for (const r of p.rows) Object.assign(r, { status: 'done' });
    const paths = exportList(p, emptyLibrary(), new Set()).map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain('E01_2.png');
  });
});
