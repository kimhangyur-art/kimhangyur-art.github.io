// 끌어다 놓은 PNG가 어느 줄의 이미지인지 찾고, 실행 정보에서 시드를 읽는다.
// 결과는 화면에 보여 주고(이유 포함), 적용은 스토어에서 한다.

import { listRows, rowTitle } from './model';
import { fileStem, nameMatcher } from './paths';
import { matchFileName } from './plan';
import { parseComfyJson } from './png';
import { asApiPrompt, saveNodes, traceSeed, type TraceResult } from './seedTrace';
import type { Issue, Project } from './types';
import type { ApiPrompt } from './workflow/apiPrompt';

export type Stage = 'draft' | 'final';

export interface DropAnalysis {
  fileName: string;
  /** 찾은 줄 (없으면 null) */
  key: string | null;
  stage: Stage | null;
  title: string | null;
  /** 줄을 못 찾은 이유 */
  reason: string | null;
  /** 이름이 여러 줄과 맞을 때 후보 */
  candidates: Array<{ key: string; stage: Stage }>;
  hasPrompt: boolean;
  seed: number | null;
  /** 시드를 못 읽은 이유 */
  seedProblem: string | null;
  trace: TraceResult | null;
  issues: Issue[];
  /** 프로젝트 ID가 다른 워크플로우에서 나온 이미지면 그 이름 */
  otherProject: string | null;
}

type Names = Map<string, { draft: string; final: string }>;

function lastSegment(prefix: string): string {
  return prefix.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? prefix;
}

/** 실행 정보의 저장 노드 중 이 줄·단계 이름과 맞는 것 */
function findSaveFor(prompt: ApiPrompt, name: string): string | null {
  const re = nameMatcher(name);
  const hits = saveNodes(prompt).filter((s) => re.test(lastSegment(s.prefix)));
  return hits.length ? hits[0].id : null;
}

export function analyzeDrop(
  fileName: string,
  texts: Record<string, string> | null,
  project: Project,
  names: Names,
  forced?: { key: string; stage?: Stage },
): DropAnalysis {
  const issues: Issue[] = [];
  const titles = new Map(listRows(project).map((r) => [r.key, rowTitle(r.scene, r.char)]));
  const prompt = asApiPrompt(parseComfyJson(texts?.prompt));
  const workflow = parseComfyJson(texts?.workflow) as { extra?: { assetTool?: { project?: string; projectName?: string; mode?: string } } } | null;
  const meta = workflow?.extra?.assetTool;
  const otherProject = meta?.project && meta.project !== project.id ? meta.projectName ?? meta.project : null;

  const result: DropAnalysis = {
    fileName,
    key: null,
    stage: null,
    title: null,
    reason: null,
    candidates: [],
    hasPrompt: !!prompt,
    seed: null,
    seedProblem: null,
    trace: null,
    issues,
    otherProject,
  };

  // ---- 1) 줄 찾기
  let match: { key: string; stage: Stage } | null = null;
  if (forced) {
    const n = names.get(forced.key);
    if (!n) {
      result.reason = '선택한 줄이 프로젝트에 없습니다.';
      return result;
    }
    let stage = forced.stage;
    if (!stage) {
      const byName = matchFileName(fileName, new Map([[forced.key, n]]));
      stage = byName[0]?.stage ?? (meta?.mode === 'finalize' ? 'final' : 'draft');
    }
    match = { key: forced.key, stage };
  } else {
    const cands = matchFileName(fileName, names);
    result.candidates = cands;
    if (cands.length === 1) match = cands[0];
    else if (cands.length > 1) {
      result.reason = `파일 이름이 여러 줄과 맞습니다: ${cands.map((c) => titles.get(c.key)).join(', ')}. 직접 골라 주세요.`;
      return result;
    } else if (prompt) {
      // 파일 이름이 바뀌었으면 실행 정보의 저장 노드 이름으로 찾아본다
      const saves = saveNodes(prompt);
      const found: Array<{ key: string; stage: Stage }> = [];
      for (const s of saves) {
        for (const m of matchFileName(lastSegment(s.prefix), names)) {
          if (!found.some((f) => f.key === m.key && f.stage === m.stage)) found.push(m);
        }
      }
      if (found.length === 1) {
        match = found[0];
        issues.push({ level: 'info', message: '파일 이름이 규칙과 달라 실행 정보의 저장 경로로 줄을 찾았습니다.' });
      } else if (found.length > 1) {
        result.candidates = found;
        result.reason = `파일 이름("${fileStem(fileName)}")이 어느 줄과도 맞지 않고, 실행 정보에는 여러 줄이 들어 있습니다. 직접 골라 주세요.`;
        return result;
      }
    }
    if (!match) {
      result.reason = `파일 이름("${fileStem(fileName)}")이 어느 줄의 저장 이름과도 맞지 않습니다.${
        otherProject ? ` 다른 프로젝트("${otherProject}")에서 만든 워크플로우의 이미지입니다.` : ''
      }`;
      return result;
    }
  }

  result.key = match.key;
  result.stage = match.stage;
  result.title = titles.get(match.key) ?? match.key;
  if (otherProject) issues.push({ level: 'warn', message: `다른 프로젝트("${otherProject}")에서 만든 워크플로우의 이미지입니다.` });

  // ---- 2) 시드 읽기
  if (!prompt) {
    result.seedProblem = 'PNG에 실행 정보(prompt)가 없습니다. 파일 이름으로만 처리하며, 시드는 직접 입력해야 합니다.';
    return result;
  }
  const n = names.get(match.key)!;
  const wanted = match.stage === 'final' ? n.final : n.draft;
  let saveId = findSaveFor(prompt, wanted);
  if (!saveId) {
    const saves = saveNodes(prompt);
    if (saves.length === 1) saveId = saves[0].id;
  }
  if (!saveId) {
    result.seedProblem = '실행 정보에서 이 줄의 저장 노드를 찾지 못했습니다. 시드는 직접 입력해야 합니다.';
    return result;
  }
  const trace = traceSeed(prompt, saveId);
  result.trace = trace;
  result.seed = trace.seed;
  result.seedProblem = trace.problem;
  if (match.stage === 'draft' && trace.hasHires) {
    issues.push({ level: 'warn', message: '파일 이름은 초안인데 실행 정보에는 고화질 단계가 있습니다.' });
  }
  if (match.stage === 'final' && !trace.hasHires) {
    issues.push({ level: 'warn', message: '마무리 이미지인데 실행 정보에 고화질 단계가 없습니다.' });
  }
  if (match.stage === 'final') {
    const row = project.rows.find((r) => `${r.charId}|${r.sceneId}` === match!.key);
    if (row?.seed != null && trace.seed != null && row.seed !== trace.seed) {
      issues.push({ level: 'warn', message: `확정한 시드(${row.seed})와 이 이미지의 시드(${trace.seed})가 다릅니다.` });
    }
    if (row && row.status === 'pending') {
      issues.push({ level: 'warn', message: '아직 확정하지 않은 줄의 마무리 이미지입니다.' });
    }
  }
  return result;
}
