import { describe, expect, it } from 'vitest';
import { composeRow } from './compose';
import { findParenPitfalls, fixParenPitfalls, flattenTags, removeSegment, setSegmentWeight, splitTopLevel } from './prompt';
import { resolveSettings } from './settings';
import { emptyLibrary, ids, sampleProject } from '../test/fixtures';

describe('가중치 문법', () => {
  it('쉼표로 나누되 괄호 안 쉼표는 나누지 않는다', () => {
    const segs = splitTopLevel('masterpiece, (smile, closed mouth:1.3), ((blush)), hex maniac \\(pokemon\\)');
    expect(segs.map((s) => s.inner)).toEqual(['masterpiece', 'smile, closed mouth', 'blush', 'hex maniac \\(pokemon\\)']);
    expect(segs.map((s) => s.weight)).toEqual([1, 1.3, 1.21, 1]);
    expect(segs[1].explicit).toBe(true);
  });

  it('가중치를 바꾸고, 1이면 괄호를 뗀다', () => {
    const text = 'a, (b:1.2), c';
    const segs = splitTopLevel(text);
    expect(setSegmentWeight(text, segs[1], 1.45)).toBe('a, (b:1.45), c');
    expect(setSegmentWeight(text, segs[1], 1)).toBe('a, b, c');
    expect(setSegmentWeight(text, segs[2], 0.8)).toBe('a, (b:1.2), (c:0.8)');
    expect(removeSegment(text, segs[0])).toBe('(b:1.2), c');
    expect(removeSegment(text, segs[2])).toBe('a, (b:1.2)');
  });

  it('중복 비교용 태그 펼치기', () => {
    expect(flattenTags('Long_Hair, (smile, long hair:1.2)')).toEqual(['long hair', 'smile', 'long hair']);
  });

  it('작품 이름 괄호가 가중치로 읽히는 실수를 찾는다', () => {
    expect(findParenPitfalls('hex maniac (pokemon), (smile:1.2)')).toHaveLength(1);
    expect(fixParenPitfalls('hex maniac (pokemon)')).toBe('hex maniac \\(pokemon\\)');
    expect(findParenPitfalls('hex maniac \\(pokemon\\)')).toHaveLength(0);
  });
});

describe('프롬프트 조합', () => {
  it('품질 → 캐릭터(트리거 → 외형) → 그룹 → 장면 → 조각 순서', () => {
    const p = sampleProject();
    const { a, e2, expr } = ids(p);
    const r = resolveSettings({ project: p, library: emptyLibrary(), group: expr, scene: e2 });
    const c = composeRow(p, a, e2, expr, r);
    expect(c.positive).toBe(
      'masterpiece, best quality, amazing quality, hexmaniac, 1girl, purple hair, purple eyes, black dress, upper body, simple background, looking at viewer, smile, hair ribbon',
    );
    expect(c.negative.startsWith(r.values.prompt.defaultNegative)).toBe(true);
    expect(c.negative.endsWith('hat')).toBe(true);
  });

  it('순서를 바꿀 수 있다', () => {
    const p = sampleProject();
    const { b, e1, expr } = ids(p);
    p.settings.modes.prompt = 'custom';
    p.settings.values.prompt = { order: ['scene', 'character', 'quality', 'group', 'elements'] };
    const r = resolveSettings({ project: p, library: emptyLibrary(), group: expr, scene: e1 });
    expect(composeRow(p, b, e1, expr, r).positive.startsWith('closed mouth, 1girl')).toBe(true);
  });

  it('중복 태그를 경고한다', () => {
    const p = sampleProject();
    const { a, e1, expr } = ids(p);
    e1.prompt = 'closed mouth, looking at viewer';
    const r = resolveSettings({ project: p, library: emptyLibrary(), group: expr, scene: e1 });
    const c = composeRow(p, a, e1, expr, r);
    expect(c.issues.some((i) => /looking at viewer/.test(i.message))).toBe(true);
  });

  it('같은 로라가 겹치면 하나로 합치고, 더 구체적인 쪽 강도를 쓰며 경고한다', () => {
    const p = sampleProject();
    const { a, d1, daily } = ids(p);
    const lora = p.elements.find((e) => e.kind === 'lora')!;
    if (lora.kind === 'lora') {
      lora.applyToAll = true;
      lora.file = 'hex_char.safetensors';
    }
    const r = resolveSettings({ project: p, library: emptyLibrary(), group: daily, scene: d1 });
    const c = composeRow(p, a, d1, daily, r);
    expect(c.loras).toHaveLength(1);
    expect(c.loras[0].strength).toBe(0.5); // 장면 배정 강도가 이긴다
    expect(c.issues.some((i) => /하나로 합쳤습니다/.test(i.message))).toBe(true);
  });

  it('로라 트리거 워드는 조각 자리에 들어간다', () => {
    const p = sampleProject();
    const { b, d1, daily } = ids(p);
    const r = resolveSettings({ project: p, library: emptyLibrary(), group: daily, scene: d1 });
    const c = composeRow(p, b, d1, daily, r);
    expect(c.positive.endsWith('walking, park, detailed scenery')).toBe(true);
    expect(c.loras.map((l) => [l.file, l.strength])).toEqual([['bg_detail.safetensors', 0.5]]);
  });
});
