// 앱 상태: 프로젝트(실행 취소/다시 실행 대상), 라이브러리, ComfyUI 연결, 화면 상태.
// 프로젝트·라이브러리·연결 캐시는 localStorage에 자동 저장한다.

import { produce } from 'immer';
import { create } from 'zustand';
import type { ComfyLists } from '../lib/comfyApi';
import { DEFAULT_COMFY_URL } from '../lib/comfyApi';
import type { DropAnalysis } from '../lib/confirm';
import { newProject, normalizeProject } from '../lib/model';
import type { Library, Project } from '../lib/types';

export type TabId = 'characters' | 'scenes' | 'elements' | 'table' | 'progress' | 'settings' | 'generate' | 'confirm';

export interface DropItem {
  id: string;
  file: File;
  analysis: DropAnalysis;
  /** 적용 결과: 확정/완성/실패/선택 필요 */
  outcome: 'confirmed' | 'done' | 'failed' | 'needs-choice';
  note?: string;
  at: number;
}

export interface SeedQuestion {
  id: string;
  groupId: string;
  charId: string;
  seed: number;
  /** 시드를 적용할 미정 줄 키 */
  keys: string[];
  sourceTitle: string;
}

export interface Toast {
  id: number;
  level: 'info' | 'warn' | 'error' | 'ok';
  text: string;
}

export interface Selection {
  charId: string | null;
  groupId: string | null;
  sceneId: string | null;
  elementId: string | null;
  cellKey: string | null;
  /** 장면 화면에서 여러 개 고른 장면 */
  bulk: string[];
}

interface State {
  project: Project;
  library: Library;
  past: Project[];
  future: Project[];
  lastCoalesce: { key: string | null; at: number };
  tab: TabId;
  sel: Selection;
  comfyUrl: string;
  comfy: ComfyLists | null;
  comfyStatus: { state: 'idle' | 'loading' | 'ok' | 'error'; message?: string };
  /** 완성 이미지 파일이 있는 줄 키 */
  finals: Set<string>;
  drops: DropItem[];
  questions: SeedQuestion[];
  toasts: Toast[];
  saveError: string | null;

  update: (fn: (draft: Project) => void, coalesce?: string) => void;
  replaceProject: (p: Project) => void;
  undo: () => void;
  redo: () => void;
  updateLibrary: (fn: (draft: Library) => void) => void;
  setTab: (t: TabId) => void;
  select: (s: Partial<Selection>) => void;
  toast: (text: string, level?: Toast['level']) => void;
  dismissToast: (id: number) => void;
}

const KEYS = {
  project: 'comfy-asset-tool.project',
  library: 'comfy-asset-tool.library',
  comfy: 'comfy-asset-tool.comfy',
  ui: 'comfy-asset-tool.ui',
};

const HISTORY_LIMIT = 100;
const COALESCE_MS = 1200;

function readJson<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function initialProject(): Project {
  const raw = readJson<unknown>(KEYS.project);
  if (raw) {
    try {
      return normalizeProject(raw);
    } catch {
      /* 깨진 자동 저장은 무시 */
    }
  }
  return newProject();
}

function initialLibrary(): Library {
  const raw = readJson<Partial<Library>>(KEYS.library);
  return { sets: Array.isArray(raw?.sets) ? raw!.sets : [], myPresets: Array.isArray(raw?.myPresets) ? raw!.myPresets : [] };
}

const savedComfy = readJson<{ url?: string; lists?: ComfyLists }>(KEYS.comfy);
const savedUi = readJson<{ tab?: TabId }>(KEYS.ui);

let toastSeq = 1;

export const useStore = create<State>()((set, get) => ({
  project: initialProject(),
  library: initialLibrary(),
  past: [],
  future: [],
  lastCoalesce: { key: null, at: 0 },
  tab: savedUi?.tab ?? 'characters',
  sel: { charId: null, groupId: null, sceneId: null, elementId: null, cellKey: null, bulk: [] },
  comfyUrl: savedComfy?.url ?? DEFAULT_COMFY_URL,
  comfy: savedComfy?.lists ?? null,
  comfyStatus: { state: 'idle' },
  finals: new Set(),
  drops: [],
  questions: [],
  toasts: [],
  saveError: null,

  update: (fn, coalesce) => {
    const s = get();
    const changed = produce(s.project, fn);
    if (changed === s.project) return;
    const next = produce(changed, (d) => {
      d.updatedAt = Date.now();
    });
    const now = Date.now();
    const merge = coalesce && s.lastCoalesce.key === coalesce && now - s.lastCoalesce.at < COALESCE_MS;
    set({
      project: next,
      past: merge ? s.past : [...s.past.slice(-(HISTORY_LIMIT - 1)), s.project],
      future: [],
      lastCoalesce: { key: coalesce ?? null, at: now },
    });
  },

  replaceProject: (p) => {
    const s = get();
    set({
      project: p,
      past: [...s.past.slice(-(HISTORY_LIMIT - 1)), s.project],
      future: [],
      lastCoalesce: { key: null, at: 0 },
      sel: { charId: null, groupId: null, sceneId: null, elementId: null, cellKey: null, bulk: [] },
      drops: [],
      questions: [],
    });
  },

  undo: () => {
    const s = get();
    if (!s.past.length) return;
    const prev = s.past[s.past.length - 1];
    set({ project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future], lastCoalesce: { key: null, at: 0 } });
  },

  redo: () => {
    const s = get();
    if (!s.future.length) return;
    const [next, ...rest] = s.future;
    set({ project: next, past: [...s.past, s.project], future: rest, lastCoalesce: { key: null, at: 0 } });
  },

  updateLibrary: (fn) => set((s) => ({ library: produce(s.library, fn) })),
  setTab: (t) => set({ tab: t }),
  select: (sel) => set((s) => ({ sel: { ...s.sel, ...sel } })),
  toast: (text, level = 'info') => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, level, text }] }));
    setTimeout(() => get().dismissToast(id), level === 'error' ? 8000 : 4500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// ---------------------------------------------------------------------------
// 자동 저장

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function write(key: string, value: unknown): string | null {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return null;
  } catch (e) {
    const quota = e instanceof DOMException && /quota/i.test(e.name + e.message);
    return quota
      ? '브라우저 저장 공간이 가득 차 자동 저장하지 못했습니다. [프로젝트 저장]으로 파일에 저장하세요 (썸네일이 많으면 커집니다).'
      : '자동 저장에 실패했습니다.';
  }
}

useStore.subscribe((s, prev) => {
  if (s.project !== prev.project) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const err = write(KEYS.project, useStore.getState().project);
      if (err !== useStore.getState().saveError) useStore.setState({ saveError: err });
    }, 400);
  }
  if (s.library !== prev.library) write(KEYS.library, s.library);
  if (s.comfy !== prev.comfy || s.comfyUrl !== prev.comfyUrl) write(KEYS.comfy, { url: s.comfyUrl, lists: s.comfy });
  if (s.tab !== prev.tab) write(KEYS.ui, { tab: s.tab });
});

/** 지금 상태를 바로 저장 (창을 닫기 전) */
export function flushSave() {
  if (saveTimer) clearTimeout(saveTimer);
  write(KEYS.project, useStore.getState().project);
}

export const useProject = () => useStore((s) => s.project);
export const useLibrary = () => useStore((s) => s.library);
