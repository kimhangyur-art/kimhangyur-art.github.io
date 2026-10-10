// 프로젝트 데이터를 만들고 찾는 도우미

import { newId } from './ids';
import { emptyLayer } from './settings';
import type {
  Character,
  Element,
  Fragment,
  Project,
  Row,
  Scene,
  SceneGroup,
  SettingsLayer,
  StandaloneLora,
} from './types';

export const CHARACTER_COLORS = [
  '#e07a5f',
  '#3d85c6',
  '#81b29a',
  '#c77dff',
  '#f2cc8f',
  '#ef476f',
  '#06aed5',
  '#8d6e63',
];

export const GROUP_COLORS = ['#3f789e', '#88aa77', '#b06634', '#a1309b', '#8a8a3a', '#4a7a7a', '#7a5a9e'];

export function rowKey(charId: string, sceneId: string): string {
  return `${charId}|${sceneId}`;
}

export function newProject(name = '새 프로젝트'): Project {
  const now = Date.now();
  return {
    version: 1,
    id: newId('prj'),
    name,
    checkpoint: '',
    family: 'auto',
    useMyPreset: true,
    characters: [],
    elements: [],
    groups: [],
    scenes: [],
    rows: [],
    settings: emptyLayer(),
    generate: { includeNonTarget: false },
    createdAt: now,
    updatedAt: now,
  };
}

export function newCharacter(index: number, partial: Partial<Character> = {}): Character {
  return {
    id: newId('chr'),
    name: `캐릭터 ${index + 1}`,
    fileId: `char${index + 1}`,
    prompt: '',
    negative: '',
    trigger: '',
    loras: [],
    note: '',
    color: CHARACTER_COLORS[index % CHARACTER_COLORS.length],
    ...partial,
  };
}

export function newFragment(partial: Partial<Fragment> = {}): Fragment {
  return {
    id: newId('frg'),
    kind: 'fragment',
    name: '새 조각',
    category: '',
    positive: '',
    negative: '',
    note: '',
    applyToAll: false,
    ...partial,
  };
}

export function newLora(partial: Partial<StandaloneLora> = {}): StandaloneLora {
  return {
    id: newId('lra'),
    kind: 'lora',
    name: '새 로라',
    file: '',
    strength: 1,
    clipStrength: null,
    trigger: '',
    note: '',
    applyToAll: false,
    ...partial,
  };
}

export function newGroup(index: number, partial: Partial<SceneGroup> = {}): SceneGroup {
  return {
    id: newId('grp'),
    name: `그룹 ${index + 1}`,
    prompt: '',
    negative: '',
    note: '',
    color: GROUP_COLORS[index % GROUP_COLORS.length],
    seedMode: 'independent',
    settings: emptyLayer(),
    fromSetId: null,
    ...partial,
  };
}

export function newScene(groupId: string, partial: Partial<Scene> = {}): Scene {
  return {
    id: newId('scn'),
    code: '',
    name: '새 장면',
    groupId,
    prompt: '',
    negative: '',
    elements: [],
    settings: emptyLayer(),
    enabled: true,
    note: '',
    ...partial,
  };
}

export function newRow(charId: string, sceneId: string): Row {
  return {
    charId,
    sceneId,
    status: 'pending',
    seed: null,
    seedFrom: null,
    thumb: null,
    memo: '',
    confirmedFile: null,
    finalFile: null,
  };
}

// ---------------------------------------------------------------------------
// 찾기

export interface Index {
  chars: Map<string, Character>;
  scenes: Map<string, Scene>;
  groups: Map<string, SceneGroup>;
  elements: Map<string, Element>;
  rows: Map<string, Row>;
}

export function indexProject(p: Project): Index {
  return {
    chars: new Map(p.characters.map((c) => [c.id, c])),
    scenes: new Map(p.scenes.map((s) => [s.id, s])),
    groups: new Map(p.groups.map((g) => [g.id, g])),
    elements: new Map(p.elements.map((e) => [e.id, e])),
    rows: new Map(p.rows.map((r) => [rowKey(r.charId, r.sceneId), r])),
  };
}

/** 그룹 순서 → 그룹 안 장면 순서로 정렬한 장면 목록 */
export function orderedScenes(p: Project): Scene[] {
  const out: Scene[] = [];
  for (const g of p.groups) for (const s of p.scenes) if (s.groupId === g.id) out.push(s);
  return out;
}

export function scenesOfGroup(p: Project, groupId: string): Scene[] {
  return p.scenes.filter((s) => s.groupId === groupId);
}

/** 화면과 워크플로우에서 쓰는 줄 제목: "장면코드 장면이름 · 캐릭터" */
export function rowTitle(scene: Scene, char: Character): string {
  const head = [scene.code, scene.name].filter((x) => x && x.trim()).join(' ');
  return `${head} · ${char.name}`;
}

export function sceneLabel(scene: Scene): string {
  return [scene.code, scene.name].filter((x) => x && x.trim()).join(' ');
}

export interface RowInfo {
  key: string;
  row: Row;
  char: Character;
  scene: Scene;
  group: SceneGroup;
}

/** 배정된 줄 전부 (캐릭터·장면·그룹이 모두 있는 것만), 그룹 → 장면 → 캐릭터 순 */
export function listRows(p: Project): RowInfo[] {
  const idx = indexProject(p);
  const out: RowInfo[] = [];
  const charOrder = new Map(p.characters.map((c, i) => [c.id, i]));
  for (const scene of orderedScenes(p)) {
    const group = idx.groups.get(scene.groupId)!;
    const rows = p.rows
      .filter((r) => r.sceneId === scene.id && idx.chars.has(r.charId))
      .sort((a, b) => (charOrder.get(a.charId)! - charOrder.get(b.charId)!));
    for (const row of rows) {
      out.push({ key: rowKey(row.charId, row.sceneId), row, char: idx.chars.get(row.charId)!, scene, group });
    }
  }
  return out;
}

export function remainingCount(p: Project, charId: string): { pending: number; confirmed: number; done: number; off: number } {
  const idx = indexProject(p);
  const c = { pending: 0, confirmed: 0, done: 0, off: 0 };
  for (const r of p.rows) {
    if (r.charId !== charId) continue;
    const s = idx.scenes.get(r.sceneId);
    if (!s || !idx.groups.has(s.groupId)) continue;
    if (!s.enabled) {
      c.off++;
      continue;
    }
    c[r.status]++;
  }
  return c;
}

// ---------------------------------------------------------------------------
// 불러온 프로젝트 정리 (빠진 필드 채우기)

function layer(x: unknown): SettingsLayer {
  const l = (x ?? {}) as Partial<SettingsLayer>;
  return { modes: { ...(l.modes ?? {}) }, values: { ...(l.values ?? {}) } };
}

export function normalizeProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new Error('프로젝트 파일 형식이 아닙니다.');
  const r = raw as Partial<Project> & Record<string, unknown>;
  if (!Array.isArray(r.characters) || !Array.isArray(r.scenes) || !Array.isArray(r.groups)) {
    throw new Error('프로젝트 파일에 캐릭터·장면 목록이 없습니다.');
  }
  const base = newProject(typeof r.name === 'string' ? r.name : '불러온 프로젝트');
  const groups = (r.groups as SceneGroup[]).map((g, i) => ({ ...newGroup(i), ...g, settings: layer(g.settings) }));
  const groupIds = new Set(groups.map((g) => g.id));
  const scenes = (r.scenes as Scene[])
    .filter((s) => groupIds.has(s.groupId))
    .map((s) => ({
      ...newScene(s.groupId),
      ...s,
      elements: Array.isArray(s.elements) ? s.elements : [],
      settings: layer(s.settings),
    }));
  const characters = (r.characters as Character[]).map((c, i) => ({
    ...newCharacter(i),
    ...c,
    loras: Array.isArray(c.loras) ? c.loras : [],
  }));
  const elements = ((r.elements ?? []) as Element[]).map((e) =>
    e.kind === 'lora' ? { ...newLora(), ...e } : { ...newFragment(), ...(e as Fragment) },
  );
  const sceneIds = new Set(scenes.map((s) => s.id));
  const charIds = new Set(characters.map((c) => c.id));
  const seen = new Set<string>();
  const rows = ((r.rows ?? []) as Row[])
    .filter((row) => sceneIds.has(row.sceneId) && charIds.has(row.charId))
    .filter((row) => {
      const k = rowKey(row.charId, row.sceneId);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((row) => ({ ...newRow(row.charId, row.sceneId), ...row }));
  return {
    ...base,
    ...r,
    version: 1,
    characters,
    elements,
    groups,
    scenes,
    rows,
    settings: layer(r.settings),
    generate: { includeNonTarget: false, ...((r.generate as object) ?? {}) },
  } as Project;
}
