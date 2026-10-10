// 장면 세트 라이브러리: 기본 제공 세트와 내가 만든 세트.
// 세트 하나 = 장면 그룹 하나 + 장면들. 새 캐릭터에 세트를 통째로 적용할 수 있다.

import { newId } from './ids';
import { newGroup, newRow, newScene, rowKey } from './model';
import { getPreset, resolutionForAspect } from './presets';
import { effectiveFamily, emptyLayer } from './settings';
import type { Project, SceneGroup, SceneSet } from './types';

const t = (code: string, name: string, prompt: string, note = '', negative = '') => ({ code, name, prompt, negative, note });

export const BUILTIN_SETS: SceneSet[] = [
  {
    id: 'builtin-expressions',
    name: '표정 세트 (12종)',
    note: '상반신 정면 표정 모음. 구도 맞추기를 켜 두어 같은 캐릭터의 표정끼리 구도가 비슷하게 나온다.',
    builtin: true,
    group: {
      name: '표정',
      prompt: 'upper body, simple background, white background, looking at viewer',
      negative: '',
      note: '',
      color: '#88aa77',
      seedMode: 'match',
      aspect: 'square',
    },
    scenes: [
      t('E01', '기본', 'closed mouth, expressionless'),
      t('E02', '미소', 'smile, closed mouth'),
      t('E03', '웃음', 'laughing, open mouth, smile, closed eyes'),
      t('E04', '화남', 'angry, v-shaped eyebrows, frown, clenched teeth'),
      t('E05', '슬픔', 'sad, frown, tearing up'),
      t('E06', '울음', 'crying, tears, streaming tears, open mouth'),
      t('E07', '놀람', 'surprised, wide-eyed, open mouth'),
      t('E08', '부끄러움', 'blush, embarrassed, nose blush, wavy mouth'),
      t('E09', '불쾌', 'annoyed, frown, half-closed eyes'),
      t('E10', '생각', 'thinking, hand on own chin, looking up'),
      t('E11', '의기양양', 'smug, smirk, half-closed eyes'),
      t('E12', '윙크', 'one eye closed, smile'),
    ],
  },
  {
    id: 'builtin-daily',
    name: '상황 세트: 일상 (8종)',
    note: '일상 장면 예시. 장면마다 배경이 달라 구도 맞추기는 끄고 쓴다.',
    builtin: true,
    group: {
      name: '일상',
      prompt: 'cowboy shot, detailed background',
      negative: '',
      note: '',
      color: '#b06634',
      seedMode: 'independent',
      aspect: 'portrait',
    },
    scenes: [
      t('D01', '인사', 'waving, smile, standing, outdoors'),
      t('D02', '앉기', 'sitting, chair, indoors, room'),
      t('D03', '독서', 'reading, holding book, sitting, library'),
      t('D04', '식사', 'eating, holding spoon, table, food, restaurant'),
      t('D05', '걷기', 'walking, street, city, day'),
      t('D06', '잠', 'sleeping, lying, bed, closed eyes, bedroom', '전신이 눕는 장면이라 가로 해상도로 바꿔도 좋다.'),
      t('D07', '전화', 'holding phone, talking on phone, indoors'),
      t('D08', '요리', 'cooking, apron, kitchen'),
    ],
  },
  {
    id: 'builtin-events',
    name: '상황 세트: 이벤트 (6종)',
    note: '이벤트·반응 장면 예시.',
    builtin: true,
    group: {
      name: '이벤트',
      prompt: 'cowboy shot',
      negative: '',
      note: '',
      color: '#a1309b',
      seedMode: 'independent',
      aspect: 'portrait',
    },
    scenes: [
      t('V01', '선물', 'holding gift, gift box, smile, blush, looking at viewer'),
      t('V02', '승리', 'v, smile, one eye closed, looking at viewer'),
      t('V03', '전투 준비', 'fighting stance, serious, determined'),
      t('V04', '피곤', 'tired, sweat, slouching'),
      t('V05', '비', 'rain, holding umbrella, outdoors, wet'),
      t('V06', '손 내밀기', 'reaching towards viewer, outstretched hand, smile'),
    ],
  },
  {
    id: 'builtin-turnaround',
    name: '포즈 세트: 전신 (4종)',
    note: '캐릭터 시트용 전신 포즈.',
    builtin: true,
    group: {
      name: '전신',
      prompt: 'full body, standing, simple background, white background',
      negative: 'cropped',
      note: '',
      color: '#3f789e',
      seedMode: 'independent',
      aspect: 'portrait',
    },
    scenes: [
      t('P01', '정면', 'straight-on, arms at sides, looking at viewer'),
      t('P02', '옆모습', 'from side, profile'),
      t('P03', '뒷모습', 'from behind'),
      t('P04', '포즈', 'hand on own hip, contrapposto, smile'),
    ],
  },
];

/** 세트에서 그룹과 장면을 만든다 (프로젝트에 이미 그 세트로 만든 그룹이 있으면 그것을 쓴다) */
export function ensureSetGroup(project: Project, set: SceneSet): SceneGroup {
  const existing = project.groups.find((g) => g.fromSetId === set.id);
  if (existing) return existing;
  const { family } = effectiveFamily(project);
  const preset = getPreset(family);
  const settings = set.group.settings ? structuredClone(set.group.settings) : emptyLayer();
  if (set.group.aspect) {
    const [width, height] = resolutionForAspect(preset, set.group.aspect);
    settings.modes.generation = 'custom';
    settings.values.generation = { ...(settings.values.generation ?? {}), width, height };
  }
  const group = newGroup(project.groups.length, {
    name: uniqueGroupName(project, set.group.name),
    prompt: set.group.prompt,
    negative: set.group.negative,
    note: set.group.note,
    color: set.group.color,
    seedMode: set.group.seedMode,
    settings,
    fromSetId: set.id,
  });
  project.groups.push(group);
  for (const s of set.scenes) {
    project.scenes.push(
      newScene(group.id, { code: s.code, name: s.name, prompt: s.prompt, negative: s.negative, note: s.note }),
    );
  }
  return group;
}

function uniqueGroupName(project: Project, name: string): string {
  const names = new Set(project.groups.map((g) => g.name));
  if (!names.has(name)) return name;
  for (let i = 2; ; i++) if (!names.has(`${name} ${i}`)) return `${name} ${i}`;
}

/** 캐릭터에 그룹의 장면을 모두 배정한다 (꺼진 장면도 줄은 만든다). 새로 배정한 장면 수를 돌려준다. */
export function assignGroupToCharacter(project: Project, groupId: string, charId: string): number {
  const have = new Set(project.rows.map((r) => rowKey(r.charId, r.sceneId)));
  let added = 0;
  for (const s of project.scenes) {
    if (s.groupId !== groupId) continue;
    if (have.has(rowKey(charId, s.id))) continue;
    project.rows.push(newRow(charId, s.id));
    added++;
  }
  return added;
}

/** 프로젝트의 그룹을 세트로 저장한다 */
export function groupToSet(project: Project, groupId: string, name?: string): SceneSet {
  const g = project.groups.find((x) => x.id === groupId);
  if (!g) throw new Error('그룹이 없습니다.');
  return {
    id: newId('set'),
    name: name ?? g.name,
    note: g.note,
    group: {
      name: g.name,
      prompt: g.prompt,
      negative: g.negative,
      note: g.note,
      color: g.color,
      seedMode: g.seedMode,
      aspect: null,
      settings: structuredClone(g.settings),
    },
    scenes: project.scenes
      .filter((s) => s.groupId === groupId)
      .map((s) => ({ code: s.code, name: s.name, prompt: s.prompt, negative: s.negative, note: s.note })),
  };
}
