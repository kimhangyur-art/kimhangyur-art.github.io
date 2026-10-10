// 프로젝트를 바꾸는 동작 모음. 모두 실행 취소할 수 있다.

import { analyzeDrop, type DropAnalysis, type Stage } from '../lib/confirm';
import { fetchComfyLists } from '../lib/comfyApi';
import { newId } from '../lib/ids';
import {
  indexProject,
  newCharacter,
  newFragment,
  newGroup,
  newLora,
  newProject,
  newRow,
  newScene,
  rowKey,
  rowTitle,
} from '../lib/model';
import { rowNames } from '../lib/plan';
import { readPngText } from '../lib/png';
import { assignGroupToCharacter, BUILTIN_SETS, ensureSetGroup, groupToSet } from '../lib/sets';
import { emptyLayer, resolveSettings } from '../lib/settings';
import { makeThumbnail } from '../lib/thumbnail';
import type { BundleKey, BundleMode, Element, Project, SceneSet, SettingsLayer } from '../lib/types';
import { deleteFile, fileKey, listKeys, putFile } from './blobStore';
import { useStore, type DropItem } from './store';

const S = () => useStore.getState();
const update = (fn: (d: Project) => void, coalesce?: string) => S().update(fn, coalesce);

export function move<T>(list: T[], index: number, delta: number) {
  const j = index + delta;
  if (index < 0 || j < 0 || j >= list.length) return;
  const [x] = list.splice(index, 1);
  list.splice(j, 0, x);
}

function uniqueText(existing: string[], base: string): string {
  const set = new Set(existing);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}_${i}`)) return `${base}_${i}`;
}

// ---------------------------------------------------------------------------
// 캐릭터

export function addCharacter(): string {
  const p = S().project;
  const c = newCharacter(p.characters.length, {
    fileId: uniqueText(p.characters.map((x) => x.fileId), `char${p.characters.length + 1}`),
  });
  update((d) => void d.characters.push(c));
  S().select({ charId: c.id });
  return c.id;
}

export function duplicateCharacter(id: string) {
  const p = S().project;
  const src = p.characters.find((c) => c.id === id);
  if (!src) return;
  const copy = {
    ...structuredClone(src),
    id: newId('chr'),
    name: `${src.name} 복사`,
    fileId: uniqueText(p.characters.map((x) => x.fileId), `${src.fileId}_copy`),
  };
  update((d) => {
    d.characters.splice(d.characters.findIndex((c) => c.id === id) + 1, 0, copy);
    // 장면 배정도 복사 (상태는 미정으로)
    for (const r of d.rows.filter((r) => r.charId === id)) d.rows.push(newRow(copy.id, r.sceneId));
  });
  S().select({ charId: copy.id });
}

export function deleteCharacter(id: string) {
  update((d) => {
    d.characters = d.characters.filter((c) => c.id !== id);
    d.rows = d.rows.filter((r) => r.charId !== id);
  });
  if (S().sel.charId === id) S().select({ charId: null });
}

// ---------------------------------------------------------------------------
// 배정 (캐릭터 × 장면 = 줄)

export function setAssigned(charId: string, sceneIds: string[], on: boolean) {
  const p = S().project;
  if (!on) {
    const keys = new Set(sceneIds.map((s) => rowKey(charId, s)));
    const progressed = p.rows.filter((r) => keys.has(rowKey(r.charId, r.sceneId)) && r.status !== 'pending');
    if (progressed.length && !confirm(`확정·완성된 줄 ${progressed.length}개의 배정을 해제합니다. 계속할까요? (실행 취소 가능)`)) return;
  }
  update((d) => {
    const have = new Set(d.rows.map((r) => rowKey(r.charId, r.sceneId)));
    if (on) {
      for (const s of sceneIds) if (!have.has(rowKey(charId, s))) d.rows.push(newRow(charId, s));
    } else {
      const drop = new Set(sceneIds);
      d.rows = d.rows.filter((r) => !(r.charId === charId && drop.has(r.sceneId)));
    }
  });
}

/** 세트를 캐릭터들에게 통째로 적용한다 (프로젝트에 없으면 그룹과 장면을 만든다) */
export function applySet(set: SceneSet, charIds: string[]) {
  let groupId = '';
  let added = 0;
  update((d) => {
    const g = ensureSetGroup(d, set);
    groupId = g.id;
    for (const c of charIds) added += assignGroupToCharacter(d, g.id, c);
  });
  S().toast(`"${set.name}" 적용: 새 줄 ${added}개`, 'ok');
  return groupId;
}

export function allSets(): SceneSet[] {
  return [...BUILTIN_SETS, ...S().library.sets];
}

export function saveGroupAsSet(groupId: string) {
  const p = S().project;
  const g = p.groups.find((x) => x.id === groupId);
  if (!g) return;
  const name = prompt('세트 이름', g.name);
  if (!name) return;
  const set = groupToSet(p, groupId, name);
  S().updateLibrary((l) => void l.sets.push(set));
  update((d) => {
    const dg = d.groups.find((x) => x.id === groupId);
    if (dg) dg.fromSetId = set.id;
  });
  S().toast(`내 세트 "${name}"로 저장했습니다.`, 'ok');
}

export function updateSetFromGroup(groupId: string) {
  const p = S().project;
  const g = p.groups.find((x) => x.id === groupId);
  if (!g?.fromSetId) return;
  const idx = S().library.sets.findIndex((s) => s.id === g.fromSetId);
  if (idx < 0) return;
  const fresh = groupToSet(p, groupId, S().library.sets[idx].name);
  S().updateLibrary((l) => void (l.sets[idx] = { ...fresh, id: l.sets[idx].id }));
  S().toast('세트를 지금 그룹 내용으로 갱신했습니다.', 'ok');
}

export function duplicateSet(set: SceneSet) {
  const copy: SceneSet = { ...structuredClone(set), id: newId('set'), name: `${set.name} 복사`, builtin: false };
  S().updateLibrary((l) => void l.sets.push(copy));
}

export function deleteSet(id: string) {
  S().updateLibrary((l) => {
    l.sets = l.sets.filter((s) => s.id !== id);
  });
}

// ---------------------------------------------------------------------------
// 그룹·장면

export function addGroup(): string {
  const g = newGroup(S().project.groups.length);
  update((d) => void d.groups.push(g));
  S().select({ groupId: g.id, sceneId: null, bulk: [] });
  return g.id;
}

export function addScene(groupId: string): string {
  const p = S().project;
  const inGroup = p.scenes.filter((s) => s.groupId === groupId);
  const s = newScene(groupId, {
    code: uniqueText(p.scenes.map((x) => x.code), `S${String(p.scenes.length + 1).padStart(2, '0')}`),
  });
  update((d) => {
    const last = d.scenes.map((x) => x.groupId).lastIndexOf(groupId);
    d.scenes.splice(last + 1, 0, s);
    // 이 그룹을 쓰던 캐릭터에게는 새 장면도 배정
    const users = new Set(d.rows.filter((r) => inGroup.some((x) => x.id === r.sceneId)).map((r) => r.charId));
    for (const c of users) d.rows.push(newRow(c, s.id));
  });
  S().select({ sceneId: s.id, groupId: null, bulk: [] });
  return s.id;
}

export function duplicateScenes(ids: string[]) {
  const p = S().project;
  const codes = p.scenes.map((x) => x.code);
  update((d) => {
    for (const id of ids) {
      const i = d.scenes.findIndex((s) => s.id === id);
      if (i < 0) continue;
      const src = d.scenes[i];
      const code = uniqueText(codes, `${src.code || 'S'}_copy`);
      codes.push(code);
      const copy = { ...structuredClone(src), id: newId('scn'), code, name: `${src.name} 복사` };
      d.scenes.splice(i + 1, 0, copy);
      for (const r of d.rows.filter((r) => r.sceneId === id)) d.rows.push(newRow(r.charId, copy.id));
    }
  });
}

export function deleteScenes(ids: string[]) {
  const drop = new Set(ids);
  update((d) => {
    d.scenes = d.scenes.filter((s) => !drop.has(s.id));
    d.rows = d.rows.filter((r) => !drop.has(r.sceneId));
  });
  S().select({ sceneId: null, bulk: [] });
}

export function duplicateGroup(groupId: string) {
  const p = S().project;
  const g = p.groups.find((x) => x.id === groupId);
  if (!g) return;
  const ng = { ...structuredClone(g), id: newId('grp'), name: `${g.name} 복사`, fromSetId: null };
  const codes = p.scenes.map((x) => x.code);
  update((d) => {
    d.groups.splice(d.groups.findIndex((x) => x.id === groupId) + 1, 0, ng);
    for (const s of p.scenes.filter((x) => x.groupId === groupId)) {
      const code = uniqueText(codes, `${s.code}_copy`);
      codes.push(code);
      d.scenes.push({ ...structuredClone(s), id: newId('scn'), groupId: ng.id, code });
    }
  });
  S().select({ groupId: ng.id, sceneId: null });
}

export function deleteGroup(groupId: string) {
  const p = S().project;
  const sceneIds = new Set(p.scenes.filter((s) => s.groupId === groupId).map((s) => s.id));
  update((d) => {
    d.groups = d.groups.filter((g) => g.id !== groupId);
    d.scenes = d.scenes.filter((s) => s.groupId !== groupId);
    d.rows = d.rows.filter((r) => !sceneIds.has(r.sceneId));
  });
  S().select({ groupId: null, sceneId: null, bulk: [] });
}

/** 장면을 같은 그룹 안에서 위아래로 옮긴다 */
export function moveScene(sceneId: string, delta: number) {
  update((d) => {
    const s = d.scenes.find((x) => x.id === sceneId);
    if (!s) return;
    const same = d.scenes.map((x, i) => [x, i] as const).filter(([x]) => x.groupId === s.groupId);
    const pos = same.findIndex(([x]) => x.id === sceneId);
    const other = same[pos + delta];
    if (!other) return;
    const i = same[pos][1];
    const j = other[1];
    [d.scenes[i], d.scenes[j]] = [d.scenes[j], d.scenes[i]];
  });
}

export function moveScenesToGroup(ids: string[], groupId: string) {
  const set = new Set(ids);
  update((d) => {
    const moving = d.scenes.filter((s) => set.has(s.id));
    d.scenes = d.scenes.filter((s) => !set.has(s.id));
    for (const s of moving) s.groupId = groupId;
    const last = d.scenes.map((x) => x.groupId).lastIndexOf(groupId);
    d.scenes.splice(last + 1, 0, ...moving);
  });
}

// ---------------------------------------------------------------------------
// 요소

export function addElement(kind: Element['kind']): string {
  const el = kind === 'lora' ? newLora() : newFragment();
  update((d) => void d.elements.push(el));
  S().select({ elementId: el.id });
  return el.id;
}

export function duplicateElement(id: string) {
  const el = S().project.elements.find((e) => e.id === id);
  if (!el) return;
  const copy = { ...structuredClone(el), id: newId(el.kind === 'lora' ? 'lra' : 'frg'), name: `${el.name} 복사` };
  update((d) => {
    d.elements.splice(d.elements.findIndex((e) => e.id === id) + 1, 0, copy);
    for (const s of d.scenes) {
      const ref = s.elements.find((r) => r.id === id);
      if (ref) s.elements.push({ ...ref, id: copy.id });
    }
  });
  S().select({ elementId: copy.id });
}

export function deleteElement(id: string) {
  update((d) => {
    d.elements = d.elements.filter((e) => e.id !== id);
    for (const s of d.scenes) s.elements = s.elements.filter((r) => r.id !== id);
  });
  if (S().sel.elementId === id) S().select({ elementId: null });
}

export function setElementOnScenes(elementId: string, sceneIds: string[], on: boolean) {
  const ids = new Set(sceneIds);
  update((d) => {
    for (const s of d.scenes) {
      if (!ids.has(s.id)) continue;
      const has = s.elements.some((r) => r.id === elementId);
      if (on && !has) s.elements.push({ id: elementId, strength: null });
      if (!on && has) s.elements = s.elements.filter((r) => r.id !== elementId);
    }
  });
}

export function setSceneLoraStrength(sceneId: string, elementId: string, strength: number | null) {
  update((d) => {
    const s = d.scenes.find((x) => x.id === sceneId);
    const ref = s?.elements.find((r) => r.id === elementId);
    if (ref) ref.strength = strength;
  }, `strength:${sceneId}:${elementId}`);
}

// ---------------------------------------------------------------------------
// 설정

export type LayerTarget = { level: 'global' } | { level: 'group'; id: string } | { level: 'scene'; id: string };

function layerOf(d: Project, t: LayerTarget): SettingsLayer | null {
  if (t.level === 'global') return d.settings;
  if (t.level === 'group') return d.groups.find((g) => g.id === t.id)?.settings ?? null;
  return d.scenes.find((s) => s.id === t.id)?.settings ?? null;
}

export function setBundleMode(t: LayerTarget, bundle: BundleKey, mode: BundleMode) {
  update((d) => {
    const l = layerOf(d, t);
    if (l) l.modes[bundle] = mode;
  });
}

export function setSettingValue(t: LayerTarget, bundle: BundleKey, values: Record<string, unknown>) {
  update((d) => {
    const l = layerOf(d, t);
    if (!l) return;
    const cur = (l.values[bundle] ?? {}) as Record<string, unknown>;
    l.values[bundle] = { ...cur, ...values } as never;
  }, `setting:${t.level}:${'id' in t ? t.id : ''}:${bundle}:${Object.keys(values).join(',')}`);
}

export function resetSettingValue(t: LayerTarget, bundle: BundleKey, keys: string[]) {
  update((d) => {
    const l = layerOf(d, t);
    const cur = l?.values[bundle] as Record<string, unknown> | undefined;
    if (!cur) return;
    for (const k of keys) delete cur[k];
  });
}

export function resetBundle(t: LayerTarget, bundle: BundleKey) {
  update((d) => {
    const l = layerOf(d, t);
    if (l) delete l.values[bundle];
  });
}

/** 지금 전역 커스텀 값을 이 체크포인트의 "내 프리셋"으로 저장한다 */
export function saveMyPreset() {
  const { project, library } = S();
  if (!project.checkpoint.trim()) {
    S().toast('먼저 체크포인트를 정하세요.', 'warn');
    return;
  }
  const r = resolveSettings({ project, library }, 'global');
  const values = {
    model: { ...r.values.model },
    generation: { ...r.values.generation },
    prompt: { ...r.values.prompt, order: [...r.values.prompt.order] },
    hires: { ...r.values.hires },
  };
  const existing = library.myPresets.find((m) => m.checkpoint.toLowerCase() === project.checkpoint.toLowerCase());
  S().updateLibrary((l) => {
    const rec = { id: existing?.id ?? newId('myp'), checkpoint: project.checkpoint, name: project.checkpoint, values, savedAt: Date.now() };
    if (existing) l.myPresets[l.myPresets.findIndex((m) => m.id === existing.id)] = rec;
    else l.myPresets.push(rec);
  });
  // 전역 값은 이제 내 프리셋에 들어 있으므로 [권장]으로 돌린다
  update((d) => {
    d.useMyPreset = true;
    for (const b of ['model', 'generation', 'prompt', 'hires'] as const) {
      delete d.settings.values[b];
      d.settings.modes[b] = 'inherit';
    }
  });
  S().toast('내 프리셋으로 저장했습니다. 이 체크포인트를 고르면 권장값 대신 쓰입니다.', 'ok');
}

export function deleteMyPreset(id: string) {
  S().updateLibrary((l) => {
    l.myPresets = l.myPresets.filter((m) => m.id !== id);
  });
}

// ---------------------------------------------------------------------------
// 줄 상태

function rowOf(d: Project, key: string) {
  return d.rows.find((r) => rowKey(r.charId, r.sceneId) === key);
}

export function unconfirmRow(key: string, keepSeed: boolean) {
  update((d) => {
    const r = rowOf(d, key);
    if (!r) return;
    r.status = 'pending';
    r.thumb = null;
    r.confirmedFile = null;
    r.finalFile = null;
    if (!keepSeed) {
      r.seed = null;
      r.seedFrom = null;
    }
  });
  removeFinal(key);
}

export function unlockSeed(key: string) {
  update((d) => {
    const r = rowOf(d, key);
    if (r && r.status === 'pending') {
      r.seed = null;
      r.seedFrom = null;
    }
  });
}

export function setRowSeed(key: string, seed: number | null) {
  update((d) => {
    const r = rowOf(d, key);
    if (!r) return;
    r.seed = seed;
    r.seedFrom = seed == null ? null : 'manual';
  }, `seed:${key}`);
}

export function setRowMemo(key: string, memo: string) {
  update((d) => {
    const r = rowOf(d, key);
    if (r) r.memo = memo;
  }, `memo:${key}`);
}

/** 완성 상태를 확정으로 되돌린다 (마무리를 다시 하고 싶을 때) */
export function undoDone(key: string) {
  update((d) => {
    const r = rowOf(d, key);
    if (r && r.status === 'done') {
      r.status = 'confirmed';
      r.finalFile = null;
    }
  });
  removeFinal(key);
}

function removeFinal(key: string) {
  const s = S();
  if (!s.finals.has(key)) return;
  const next = new Set(s.finals);
  next.delete(key);
  useStore.setState({ finals: next });
  void deleteFile(fileKey(s.project.id, key));
}

export async function refreshFinals() {
  const { project } = S();
  const prefix = `${project.id}::`;
  const keys = await listKeys(prefix);
  useStore.setState({ finals: new Set(keys.map((k) => k.slice(prefix.length))) });
}

// ---------------------------------------------------------------------------
// PNG 끌어다 놓기

let dropSeq = 1;

export async function processDroppedFiles(files: File[]) {
  const pngs = files.filter((f) => /\.png$/i.test(f.name) || f.type === 'image/png');
  const others = files.length - pngs.length;
  if (others) S().toast(`PNG가 아닌 파일 ${others}개는 건너뛰었습니다.`, 'warn');
  let ok = 0;
  for (const file of pngs) {
    let texts: Record<string, string> | null = null;
    try {
      texts = await readPngText(await file.arrayBuffer());
    } catch (e) {
      pushDrop(file, failedAnalysis(file.name, (e as Error).message), 'failed');
      continue;
    }
    const { project, library } = S();
    const analysis = analyzeDrop(file.name, texts, project, rowNames(project, library));
    if (await applyAnalysis(file, analysis)) ok++;
  }
  if (pngs.length) S().toast(`PNG ${pngs.length}장 처리: 적용 ${ok}장`, ok === pngs.length ? 'ok' : 'warn');
}

function failedAnalysis(fileName: string, reason: string): DropAnalysis {
  return {
    fileName,
    key: null,
    stage: null,
    title: null,
    reason,
    candidates: [],
    hasPrompt: false,
    seed: null,
    seedProblem: null,
    trace: null,
    issues: [],
    otherProject: null,
  };
}

function pushDrop(file: File, analysis: DropAnalysis, outcome: DropItem['outcome'], note?: string, replaceId?: string) {
  const item: DropItem = { id: replaceId ?? `d${dropSeq++}`, file, analysis, outcome, note, at: Date.now() };
  useStore.setState((s) => ({
    drops: replaceId ? s.drops.map((x) => (x.id === replaceId ? item : x)) : [item, ...s.drops].slice(0, 200),
  }));
}

/** 줄을 못 찾은 파일을 직접 고른 줄에 적용한다 */
export async function assignDropManually(dropId: string, key: string, stage: Stage) {
  const item = S().drops.find((d) => d.id === dropId);
  if (!item) return;
  let texts: Record<string, string> | null = null;
  try {
    texts = await readPngText(await item.file.arrayBuffer());
  } catch {
    texts = null;
  }
  const { project, library } = S();
  const analysis = analyzeDrop(item.file.name, texts, project, rowNames(project, library), { key, stage });
  await applyAnalysis(item.file, analysis, dropId);
}

async function applyAnalysis(file: File, a: DropAnalysis, replaceId?: string): Promise<boolean> {
  if (!a.key || !a.stage) {
    pushDrop(file, a, a.candidates.length || a.reason ? 'needs-choice' : 'failed', undefined, replaceId);
    return false;
  }
  const key = a.key;
  const thumb = await makeThumbnail(file);
  const { project } = S();
  const idx = indexProject(project);
  const prev = idx.rows.get(key);
  if (!prev) {
    pushDrop(file, { ...a, reason: '줄이 더 이상 없습니다.' }, 'failed', undefined, replaceId);
    return false;
  }
  let note: string | undefined;
  if (a.stage === 'draft') {
    if (prev.status === 'done') note = '완성된 줄이었는데 확정으로 되돌렸습니다.';
    else if (prev.status === 'confirmed' && prev.seed != null && a.seed != null && prev.seed !== a.seed) note = `이전 확정(시드 ${prev.seed})을 바꿨습니다.`;
    update((d) => {
      const r = rowOf(d, key)!;
      r.status = 'confirmed';
      if (a.seed != null) {
        r.seed = a.seed;
        r.seedFrom = 'png';
      }
      r.thumb = thumb;
      r.confirmedFile = file.name;
      r.finalFile = null;
    });
    if (prev.status === 'done') removeFinal(key);
    queueGroupQuestion(key, a.seed);
    pushDrop(file, a, 'confirmed', note, replaceId);
  } else {
    update((d) => {
      const r = rowOf(d, key)!;
      r.status = 'done';
      if (r.seed == null && a.seed != null) {
        r.seed = a.seed;
        r.seedFrom = 'png';
      }
      if (thumb) r.thumb = thumb;
      r.finalFile = file.name;
    });
    await putFile(fileKey(project.id, key), file.name, file);
    useStore.setState((s) => ({ finals: new Set([...s.finals, key]) }));
    pushDrop(file, a, 'done', note, replaceId);
  }
  return true;
}

/** 구도 맞추기 그룹의 줄을 확정하면, 그 시드를 같은 그룹·캐릭터의 다른 미정 줄에도 적용할지 묻는다 */
function queueGroupQuestion(key: string, seed: number | null) {
  if (seed == null) return;
  const { project } = S();
  const idx = indexProject(project);
  const row = idx.rows.get(key);
  const scene = row && idx.scenes.get(row.sceneId);
  const group = scene && idx.groups.get(scene.groupId);
  const char = row && idx.chars.get(row.charId);
  if (!row || !scene || !group || !char || group.seedMode !== 'match') return;
  const keys = project.rows
    .filter((r) => r.charId === row.charId && r.status === 'pending' && r.seed !== seed)
    .filter((r) => idx.scenes.get(r.sceneId)?.groupId === group.id)
    .map((r) => rowKey(r.charId, r.sceneId));
  if (!keys.length) return;
  useStore.setState((s) => ({
    questions: [
      ...s.questions.filter((q) => !(q.groupId === group.id && q.charId === char.id)),
      { id: `q${dropSeq++}`, groupId: group.id, charId: char.id, seed, keys, sourceTitle: rowTitle(scene, char) },
    ],
  }));
}

export function answerQuestion(id: string, apply: boolean) {
  const q = S().questions.find((x) => x.id === id);
  useStore.setState((s) => ({ questions: s.questions.filter((x) => x.id !== id) }));
  if (!q || !apply) return;
  const keys = new Set(q.keys);
  update((d) => {
    for (const r of d.rows) {
      if (keys.has(rowKey(r.charId, r.sceneId)) && r.status === 'pending') {
        r.seed = q.seed;
        r.seedFrom = 'group';
      }
    }
  });
  S().toast(`시드 ${q.seed}을(를) 미정 줄 ${q.keys.length}개에 적용했습니다.`, 'ok');
}

// ---------------------------------------------------------------------------
// ComfyUI 연결

export async function connectComfy(url?: string) {
  const u = url ?? S().comfyUrl;
  useStore.setState({ comfyStatus: { state: 'loading' }, comfyUrl: u });
  try {
    const lists = await fetchComfyLists(u);
    useStore.setState({ comfy: lists, comfyStatus: { state: 'ok', message: `${new Date(lists.fetchedAt).toLocaleTimeString('ko-KR')}에 받아옴` } });
    S().toast(`ComfyUI 목록을 받았습니다: 체크포인트 ${lists.checkpoints.length}, 로라 ${lists.loras.length}`, 'ok');
  } catch (e) {
    useStore.setState({ comfyStatus: { state: 'error', message: (e as Error).message } });
  }
}

// ---------------------------------------------------------------------------
// 프로젝트

export function startNewProject() {
  if (!confirm('새 파일을 시작할까요? 지금 작업은 실행 취소로 되돌릴 수 있지만, [파일 저장]으로 저장해 두는 것을 권장합니다.')) return;
  const keep = S().project;
  const p = newProject();
  p.checkpoint = keep.checkpoint;
  p.family = keep.family;
  S().replaceProject(p);
  void refreshFinals();
}

/** 처음 쓰는 사람을 위한 예시: 캐릭터 1명 + 표정 세트 */
export function startExample() {
  const p = newProject('예시 프로젝트');
  const keep = S().project;
  p.checkpoint = keep.checkpoint || 'waiIllustriousSDXL_v170.safetensors';
  p.family = keep.family;
  const c = newCharacter(0, {
    name: '예시 캐릭터',
    fileId: 'sample',
    prompt: '1girl, solo, long hair, purple hair, purple eyes, black dress',
    note: '외형 프롬프트를 내 캐릭터로 바꿔 쓰세요.',
  });
  p.characters.push(c);
  const g = ensureSetGroup(p, BUILTIN_SETS[0]);
  assignGroupToCharacter(p, g.id, c.id);
  S().replaceProject(p);
  S().select({ charId: c.id });
  void refreshFinals();
}

export function resetLayer(): SettingsLayer {
  return emptyLayer();
}
