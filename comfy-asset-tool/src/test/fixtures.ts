import { newCharacter, newFragment, newLora, newProject, newRow, newScene, newGroup } from '../lib/model';
import type { Library, Project } from '../lib/types';

export const emptyLibrary = (): Library => ({ sets: [], myPresets: [] });

/**
 * 시험용 프로젝트
 * - 캐릭터 2명 (A는 캐릭터 로라 있음, B는 없음)
 * - 표정 그룹(구도 맞추기, 1024×1024) 장면 3개, 일상 그룹(독립 시드, 832×1216) 장면 2개
 * - 단독 로라 1개를 일상 D01에만 배정, 조각 1개를 표정 E02에 배정
 */
export function sampleProject(): Project {
  const p = newProject('시험');
  p.checkpoint = 'waiIllustriousSDXL_v170.safetensors';
  const a = newCharacter(0, {
    name: '헥스',
    fileId: 'hex',
    prompt: '1girl, purple hair, purple eyes, black dress',
    trigger: 'hexmaniac',
    loras: [{ file: 'hex_char.safetensors', strength: 0.8 }],
  });
  const b = newCharacter(1, { name: '라니', fileId: 'rani', prompt: '1girl, blue hair, school uniform' });
  p.characters.push(a, b);

  const expr = newGroup(0, {
    name: '표정',
    prompt: 'upper body, simple background, looking at viewer',
    seedMode: 'match',
  });
  const daily = newGroup(1, { name: '일상', prompt: 'cowboy shot, detailed background' });
  daily.settings.modes.generation = 'custom';
  daily.settings.values.generation = { width: 832, height: 1216 };
  p.groups.push(expr, daily);

  const frag = newFragment({ name: '리본', positive: 'hair ribbon', negative: 'hat' });
  const lora = newLora({ name: '배경로라', file: 'bg_detail.safetensors', strength: 0.6, trigger: 'detailed scenery' });
  p.elements.push(frag, lora);

  const e1 = newScene(expr.id, { code: 'E01', name: '기본', prompt: 'closed mouth' });
  const e2 = newScene(expr.id, { code: 'E02', name: '미소', prompt: 'smile', elements: [{ id: frag.id }] });
  const e3 = newScene(expr.id, { code: 'E03', name: '화남', prompt: 'angry', note: '눈썹 강조' });
  const d1 = newScene(daily.id, { code: 'D01', name: '산책', prompt: 'walking, park', elements: [{ id: lora.id, strength: 0.5 }] });
  const d2 = newScene(daily.id, { code: 'D02', name: '독서', prompt: 'reading, library' });
  p.scenes.push(e1, e2, e3, d1, d2);

  for (const c of [a, b]) for (const s of [e1, e2, e3, d1, d2]) p.rows.push(newRow(c.id, s.id));
  return p;
}

export function ids(p: Project) {
  const [a, b] = p.characters;
  const [e1, e2, e3, d1, d2] = p.scenes;
  const [expr, daily] = p.groups;
  return { a, b, e1, e2, e3, d1, d2, expr, daily };
}

export function row(p: Project, charId: string, sceneId: string) {
  return p.rows.find((r) => r.charId === charId && r.sceneId === sceneId)!;
}
