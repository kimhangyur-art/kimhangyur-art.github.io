// 워크플로우를 만들기 전에 줄마다 쓸 값(설정·프롬프트·경로·시드)을 정리한다.
// 생성 화면의 미리보기와 워크플로우 생성이 같은 결과를 쓴다.

import { composeRow, type Composed } from './compose';
import { listRows, rowTitle, type RowInfo } from './model';
import { fileStem, hasComfyTokens, nameKey, nameMatcher, resolvePattern, withFinalMarker } from './paths';
import { resolveSettings, settingsIssues, type Resolved } from './settings';
import type { Issue, Library, Project, RowStatus } from './types';

export type GenMode = 'draft' | 'finalize';

export type SeedPlan =
  | { kind: 'random' }
  | { kind: 'fixed'; value: number }
  /** 구도 맞추기: 같은 그룹·캐릭터의 줄이 PrimitiveInt 하나를 함께 쓴다 */
  | { kind: 'shared'; key: string };

export interface PlannedRow extends RowInfo {
  title: string;
  target: boolean;
  /** 대상이 아닌 이유 (꺼진 장면, 이미 확정 등) */
  skipReason: string | null;
  settings: Resolved;
  composed: Composed;
  /** 이번 모드에서 쓰는 filename_prefix */
  savePrefix: string;
  /** 초안·마무리 파일 이름 (끌어다 놓을 때 줄 찾기에 쓴다) */
  draftName: string;
  finalName: string;
  seed: SeedPlan;
  issues: Issue[];
}

export interface Plan {
  mode: GenMode;
  rows: PlannedRow[];
  /** 워크플로우에 실제로 들어가는 줄 (대상 + 옵션이 켜졌으면 대상 아닌 줄) */
  included: PlannedRow[];
  targets: PlannedRow[];
  issues: Issue[];
  blocked: boolean;
}

export function statusLabel(s: RowStatus): string {
  return s === 'pending' ? '미정' : s === 'confirmed' ? '확정' : '완성';
}

export function isTarget(mode: GenMode, info: RowInfo): { target: boolean; reason: string | null } {
  if (!info.scene.enabled) return { target: false, reason: '꺼진 장면' };
  if (mode === 'draft') {
    if (info.row.status === 'pending') return { target: true, reason: null };
    return { target: false, reason: `이미 ${statusLabel(info.row.status)}` };
  }
  if (info.row.status === 'confirmed') return { target: true, reason: null };
  if (info.row.status === 'done') return { target: false, reason: '이미 완성' };
  return { target: false, reason: '아직 확정 전' };
}

export interface NameEntry {
  key: string;
  stage: 'draft' | 'final';
  fileName: string;
}

/** 프로젝트의 모든 줄에 대해 초안·마무리 파일 이름을 만든다 */
export function rowNames(project: Project, library: Library): Map<string, { draft: string; final: string; draftPrefix: string; finalPrefix: string; issues: Issue[] }> {
  const out = new Map<string, { draft: string; final: string; draftPrefix: string; finalPrefix: string; issues: Issue[] }>();
  for (const info of listRows(project)) {
    const settings = resolveSettings({ project, library, group: info.group, scene: info.scene });
    const out1 = resolvePattern(settings.values.output.savePattern, info);
    const marker = settings.values.output.finalMarker;
    const finalPrefix = withFinalMarker(out1.prefix, marker);
    out.set(info.key, {
      draft: out1.fileName,
      final: out1.fileName + marker,
      draftPrefix: out1.prefix,
      finalPrefix,
      issues: out1.issues,
    });
  }
  return out;
}

/** 파일 이름이 줄마다 고유한지 검사한다. 겹치면 오류(생성을 막는다). */
export function uniquenessIssues(names: Map<string, { draft: string; final: string }>, titles: Map<string, string>): Issue[] {
  const seen = new Map<string, NameEntry[]>();
  for (const [key, n] of names) {
    for (const stage of ['draft', 'final'] as const) {
      const fileName = stage === 'draft' ? n.draft : n.final;
      if (!fileName) continue;
      const k = nameKey(fileName);
      if (!seen.has(k)) seen.set(k, []);
      seen.get(k)!.push({ key, stage, fileName });
    }
  }
  const issues: Issue[] = [];
  for (const list of seen.values()) {
    if (list.length < 2) continue;
    const who = list
      .map((e) => `${titles.get(e.key) ?? e.key}${e.stage === 'final' ? '(마무리)' : ''}`)
      .join(', ');
    issues.push({
      level: 'error',
      message: `파일 이름 "${list[0].fileName}"이(가) 여러 줄에서 겹칩니다: ${who}. 저장 경로의 마지막 부분에 {캐릭터}와 {장면코드}를 넣으세요.`,
    });
  }
  // %토큰%이 있으면 다른 줄의 이름과 맞을 수도 있다 → 경고만
  const all = [...names.entries()];
  for (const [key, n] of all) {
    if (!hasComfyTokens(n.draft)) continue;
    const re = nameMatcher(n.draft);
    for (const [k2, n2] of all) {
      if (k2 === key) continue;
      if (!hasComfyTokens(n2.draft) && (re.test(n2.draft) || re.test(n2.final))) {
        issues.push({
          level: 'warn',
          message: `"${n.draft}"의 %토큰% 때문에 다른 줄(${titles.get(k2) ?? k2})과 헷갈릴 수 있습니다.`,
        });
      }
    }
  }
  return issues;
}

export interface PlanOptions {
  mode: GenMode;
  includeNonTarget?: boolean;
}

export function planGeneration(project: Project, library: Library, opts: PlanOptions): Plan {
  const mode = opts.mode;
  const includeNonTarget = opts.includeNonTarget ?? project.generate.includeNonTarget;
  const issues: Issue[] = [];
  const names = rowNames(project, library);
  const infos = listRows(project);
  const titles = new Map(infos.map((i) => [i.key, rowTitle(i.scene, i.char)]));

  if (!project.checkpoint.trim()) issues.push({ level: 'error', message: '체크포인트 파일을 정하세요 (설정 화면).' });

  const rows: PlannedRow[] = infos.map((info) => {
    const settings = resolveSettings({ project, library, group: info.group, scene: info.scene });
    const composed = composeRow(project, info.char, info.scene, info.group, settings);
    const n = names.get(info.key)!;
    const { target, reason } = isTarget(mode, info);
    const rowIssues: Issue[] = [...n.issues, ...composed.issues];
    for (const fi of settingsIssues(settings, { group: info.group, finalize: mode === 'finalize' })) {
      rowIssues.push({ level: fi.level, message: fi.message });
    }
    let seed: SeedPlan;
    if (info.row.seed != null) seed = { kind: 'fixed', value: info.row.seed };
    else if (mode === 'draft' && target && info.group.seedMode === 'match') {
      seed = { kind: 'shared', key: `${info.group.id}|${info.char.id}` };
    } else seed = { kind: 'random' };
    if (mode === 'finalize' && target && info.row.seed == null) {
      rowIssues.push({
        level: 'warn',
        message: '고정 시드가 없습니다. 마무리에서 확정한 그림과 다른 그림이 나옵니다. 실행 정보가 있는 PNG를 다시 끌어다 놓거나 시드를 직접 입력하세요.',
      });
    }
    return {
      ...info,
      title: titles.get(info.key)!,
      target,
      skipReason: reason,
      settings,
      composed,
      savePrefix: mode === 'draft' ? n.draftPrefix : n.finalPrefix,
      draftName: n.draft,
      finalName: n.final,
      seed,
      issues: rowIssues,
    };
  });

  issues.push(...uniquenessIssues(names, titles));

  const targets = rows.filter((r) => r.target);
  const included = rows.filter((r) => r.target || includeNonTarget);
  if (targets.length === 0) {
    issues.push({
      level: 'warn',
      message: mode === 'draft' ? '초안으로 뽑을 미정 줄이 없습니다.' : '마무리할 확정 줄이 없습니다.',
    });
  }
  for (const r of included) {
    for (const i of r.issues) if (i.level === 'error' && r.target) issues.push({ ...i, message: `${r.title}: ${i.message}`, ref: r.key });
  }
  const blocked = issues.some((i) => i.level === 'error');
  return { mode, rows, included, targets, issues, blocked };
}

/** 끌어다 놓은 파일 이름으로 줄과 단계(초안/마무리)를 찾는다 */
export function matchFileName(
  fileName: string,
  names: Map<string, { draft: string; final: string }>,
): Array<{ key: string; stage: 'draft' | 'final' }> {
  const stem = fileStem(fileName);
  const out: Array<{ key: string; stage: 'draft' | 'final' }> = [];
  for (const [key, n] of names) {
    if (n.final && nameMatcher(n.final).test(stem)) out.push({ key, stage: 'final' });
    else if (n.draft && nameMatcher(n.draft).test(stem)) out.push({ key, stage: 'draft' });
  }
  if (out.length > 1) {
    // 토큰 없이 정확히 같은 이름이 있으면 그것을 고른다
    const exact = out.filter(({ key, stage }) => {
      const n = names.get(key)!;
      return (stage === 'final' ? n.final : n.draft).toLowerCase() === stem.toLowerCase();
    });
    if (exact.length === 1) return exact;
  }
  return out;
}
