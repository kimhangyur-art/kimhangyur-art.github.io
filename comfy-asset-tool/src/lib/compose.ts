// 줄(캐릭터 × 장면) 하나의 최종 프롬프트와 로라 목록을 만든다.
//
// 긍정: 품질 태그 → 캐릭터(트리거 → 외형) → 그룹 공통 → 장면 → 조각(+로라 트리거)  (순서는 설정에서 바꿀 수 있다)
// 부정: 기본 네거티브 + 캐릭터 + 그룹 + 장면 + 조각의 부정

import { PROMPT_PART_LABELS } from './settingsSchema';
import { cleanPart, findParenPitfalls, flattenTags, joinParts } from './prompt';
import type { Resolved } from './settings';
import type { Character, Element, Issue, Project, PromptPart, Scene, SceneGroup, StandaloneLora } from './types';

export interface ComposedPart {
  key: PromptPart | 'defaultNegative' | 'charNeg' | 'groupNeg' | 'sceneNeg' | 'elementsNeg';
  label: string;
  text: string;
}

export interface RowLora {
  file: string;
  strength: number;
  clipStrength: number;
  /** 어디서 왔는지 설명 (예: "캐릭터", "장면 · 표정로라") */
  source: string;
}

export interface Composed {
  positive: string;
  negative: string;
  positiveParts: ComposedPart[];
  negativeParts: ComposedPart[];
  loras: RowLora[];
  issues: Issue[];
}

export function normalizeLoraFile(file: string): string {
  return file.trim().replace(/\\/g, '/').toLowerCase();
}

/** 그 장면에 실제로 쓰이는 요소들 (전체 적용 + 장면 배정), 요소 목록 순서대로 */
export function elementsForScene(project: Project, scene: Scene): Array<{ el: Element; strength: number | null; viaAll: boolean }> {
  const refs = new Map(scene.elements.map((r) => [r.id, r]));
  const out: Array<{ el: Element; strength: number | null; viaAll: boolean }> = [];
  for (const el of project.elements) {
    const ref = refs.get(el.id);
    if (ref) out.push({ el, strength: ref.strength ?? null, viaAll: false });
    else if (el.applyToAll) out.push({ el, strength: null, viaAll: true });
  }
  return out;
}

export function composeRow(
  project: Project,
  char: Character,
  scene: Scene,
  group: SceneGroup,
  resolved: Resolved,
): Composed {
  const issues: Issue[] = [];
  const pv = resolved.values.prompt;
  const used = elementsForScene(project, scene);
  const fragments = used.filter((u) => u.el.kind === 'fragment');
  const loraEls = used.filter((u) => u.el.kind === 'lora');

  // ---- 로라: 전체 → 캐릭터 → 장면 순. 같은 파일은 하나로 합치고, 더 구체적인 쪽(장면 > 캐릭터 > 전체) 값을 쓴다.
  type Cand = RowLora & { rank: number };
  const cands: Cand[] = [];
  for (const u of loraEls.filter((x) => x.viaAll)) {
    const l = u.el as StandaloneLora;
    cands.push(toCand(l.file, l.strength, l.clipStrength, `전체 · ${l.name}`, 0));
  }
  for (const l of char.loras) cands.push(toCand(l.file, l.strength, l.clipStrength, '캐릭터', 1));
  for (const u of loraEls.filter((x) => !x.viaAll)) {
    const l = u.el as StandaloneLora;
    const s = u.strength ?? l.strength;
    cands.push(toCand(l.file, s, u.strength != null ? null : l.clipStrength, `장면 · ${l.name}`, 2));
  }
  const merged = new Map<string, Cand[]>();
  for (const c of cands) {
    if (!c.file.trim()) {
      issues.push({ level: 'warn', message: `파일명이 비어 있는 로라를 건너뛰었습니다 (${c.source}).` });
      continue;
    }
    const k = normalizeLoraFile(c.file);
    if (!merged.has(k)) merged.set(k, []);
    merged.get(k)!.push(c);
  }
  const loras: RowLora[] = [];
  for (const list of merged.values()) {
    const pick = list.reduce((a, b) => (b.rank >= a.rank ? b : a));
    if (list.length > 1) {
      const desc = list.map((x) => `${x.source} ${x.strength}`).join(', ');
      issues.push({
        level: 'warn',
        message: `같은 로라가 여러 곳에서 지정되어 하나로 합쳤습니다: ${pick.file} (${desc}) → ${pick.strength} 사용`,
      });
    }
    loras.push({ file: pick.file, strength: pick.strength, clipStrength: pick.clipStrength, source: pick.source });
  }

  // ---- 긍정 프롬프트
  const loraTriggers = loraEls.map((u) => (u.el as StandaloneLora).trigger).filter((t) => t.trim());
  const partText: Record<PromptPart, string> = {
    quality: pv.qualityTags,
    character: joinParts([char.trigger, char.prompt]),
    group: group.prompt,
    scene: scene.prompt,
    elements: joinParts([...fragments.map((u) => (u.el.kind === 'fragment' ? u.el.positive : '')), ...loraTriggers]),
  };
  const order = normalizeOrder(pv.order);
  const positiveParts: ComposedPart[] = order.map((k) => ({
    key: k,
    label: PROMPT_PART_LABELS[k],
    text: cleanPart(partText[k]),
  }));
  const positive = joinParts(positiveParts.map((p) => p.text));

  // ---- 부정 프롬프트
  const negativeParts: ComposedPart[] = [
    { key: 'defaultNegative', label: '기본 네거티브', text: cleanPart(pv.defaultNegative) },
    { key: 'charNeg', label: '캐릭터', text: cleanPart(char.negative) },
    { key: 'groupNeg', label: '그룹', text: cleanPart(group.negative) },
    { key: 'sceneNeg', label: '장면', text: cleanPart(scene.negative) },
    {
      key: 'elementsNeg',
      label: '조각',
      text: joinParts(fragments.map((u) => (u.el.kind === 'fragment' ? u.el.negative : ''))),
    },
  ];
  const negative = joinParts(negativeParts.map((p) => p.text));

  issues.push(...duplicateIssues(positiveParts, '긍정'));
  issues.push(...duplicateIssues(negativeParts, '부정'));
  issues.push(...conflictIssues(positive, negative));
  for (const p of findParenPitfalls(positive)) {
    issues.push({
      level: 'info',
      message: `"${p.found}"의 괄호는 가중치로 읽힙니다. 작품 이름이라면 "${p.fix}"처럼 써야 합니다.`,
    });
  }
  if (!positive.trim()) issues.push({ level: 'warn', message: '긍정 프롬프트가 비어 있습니다.' });

  return { positive, negative, positiveParts, negativeParts, loras, issues };
}

function toCand(file: string, strength: number, clip: number | null | undefined, source: string, rank: number) {
  return {
    file: file.trim(),
    strength: num(strength, 1),
    clipStrength: clip == null ? num(strength, 1) : num(clip, 1),
    source,
    rank,
  };
}

function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

export function normalizeOrder(order: PromptPart[] | undefined): PromptPart[] {
  const all: PromptPart[] = ['quality', 'character', 'group', 'scene', 'elements'];
  const seen = new Set<PromptPart>();
  const out: PromptPart[] = [];
  for (const k of order ?? []) if (all.includes(k) && !seen.has(k)) (seen.add(k), out.push(k));
  for (const k of all) if (!seen.has(k)) out.push(k);
  return out;
}

function duplicateIssues(parts: ComposedPart[], side: string): Issue[] {
  const where = new Map<string, string[]>();
  for (const p of parts) {
    const tags = flattenTags(p.text);
    const local = new Set<string>();
    for (const t of tags) {
      if (local.has(t)) {
        // 같은 칸 안의 중복
        where.get(t)!.push(p.label);
        continue;
      }
      local.add(t);
      if (!where.has(t)) where.set(t, []);
      where.get(t)!.push(p.label);
    }
  }
  const out: Issue[] = [];
  for (const [tag, labels] of where) {
    if (labels.length > 1) {
      out.push({ level: 'warn', message: `${side} 프롬프트에 "${tag}"가 겹칩니다 (${labels.join(', ')}).` });
    }
  }
  return out;
}

function conflictIssues(positive: string, negative: string): Issue[] {
  const pos = new Set(flattenTags(positive));
  const both = [...new Set(flattenTags(negative))].filter((t) => pos.has(t));
  if (both.length === 0) return [];
  return [{ level: 'warn', message: `긍정과 부정에 같은 태그가 있습니다: ${both.join(', ')}` }];
}
