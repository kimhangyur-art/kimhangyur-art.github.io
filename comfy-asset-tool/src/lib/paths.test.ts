import { describe, expect, it } from 'vitest';
import { fileStem, nameMatcher, resolvePattern, sanitizeSegment } from './paths';
import { matchFileName, planGeneration, rowNames } from './plan';
import { emptyLibrary, ids, sampleProject } from '../test/fixtures';

const ctx = { char: { fileId: 'hex', name: '헥스' }, scene: { code: 'E01', name: '기본' }, group: { name: '표정' } };

describe('저장 경로', () => {
  it('토큰을 바꾸고 ComfyUI 토큰은 그대로 둔다', () => {
    const r = resolvePattern('%date:yyyy-MM-dd%/{캐릭터}/{그룹}/{캐릭터}_{장면코드}_{장면이름}', ctx);
    expect(r.prefix).toBe('%date:yyyy-MM-dd%/hex/표정/hex_E01_기본');
    expect(r.fileName).toBe('hex_E01_기본');
    expect(r.issues).toHaveLength(0);
  });

  it('파일 이름에 못 쓰는 글자는 바꾸고 ..은 막는다', () => {
    expect(sanitizeSegment('a/b:c?')).toBe('a_b_c_');
    expect(resolvePattern('../{캐릭터}', ctx).issues[0].level).toBe('error');
    expect(resolvePattern('{없는토큰}/x', ctx).issues[0].level).toBe('warn');
  });

  it('ComfyUI 번호와 확장자를 뗀다', () => {
    expect(fileStem('hex_E01_00003_.png')).toBe('hex_E01');
    expect(fileStem('hex_E01_final_00012_.png')).toBe('hex_E01_final');
    expect(fileStem('C:\\out\\hex_E01_00003_ (1).png')).toBe('hex_E01');
  });

  it('%date% 토큰이 든 이름도 맞춘다', () => {
    expect(nameMatcher('hex_%date:MMdd%_E01').test('hex_1010_E01')).toBe(true);
    expect(nameMatcher('hex_%date:MMdd%_E01').test('hex_1010_E02')).toBe(false);
  });
});

describe('파일 이름 고유성', () => {
  it('기본 규칙이면 줄마다 고유하다', () => {
    const p = sampleProject();
    const plan = planGeneration(p, emptyLibrary(), { mode: 'draft' });
    expect(plan.blocked).toBe(false);
  });

  it('파일 이름이 겹치면 경고하고 생성을 막는다', () => {
    const p = sampleProject();
    p.settings.values.output = { savePattern: '{캐릭터}/{장면코드}' }; // 캐릭터가 폴더에만 있어서 파일 이름이 겹친다
    const plan = planGeneration(p, emptyLibrary(), { mode: 'draft' });
    expect(plan.blocked).toBe(true);
    expect(plan.issues.find((i) => i.level === 'error')?.message).toMatch(/겹칩니다/);
  });

  it('파일 이름으로 줄과 단계를 찾는다', () => {
    const p = sampleProject();
    const { a, e2 } = ids(p);
    const names = rowNames(p, emptyLibrary());
    expect(matchFileName('hex_E02_00001_.png', names)).toEqual([{ key: `${a.id}|${e2.id}`, stage: 'draft' }]);
    expect(matchFileName('hex_E02_final_00004_.png', names)).toEqual([{ key: `${a.id}|${e2.id}`, stage: 'final' }]);
    expect(matchFileName('ComfyUI_00001_.png', names)).toEqual([]);
  });
});
