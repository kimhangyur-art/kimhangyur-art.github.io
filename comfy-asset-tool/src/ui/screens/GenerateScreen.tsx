import { useMemo, useState } from 'react';
import { downloadJson, safeFileName, stamp } from '../../lib/download';
import { planGeneration, type GenMode, type PlannedRow } from '../../lib/plan';
import { buildWorkflow, type BuildStats } from '../../lib/workflow/generate';
import type { Issue } from '../../lib/types';
import { useStore } from '../../store/store';
import { Check, IssueList, Seg, StatusBadge } from '../common';

export function GenerateScreen() {
  const project = useStore((s) => s.project);
  const library = useStore((s) => s.library);
  const update = useStore((s) => s.update);
  const toast = useStore((s) => s.toast);
  const [mode, setMode] = useState<GenMode>('draft');
  const [showAll, setShowAll] = useState(false);
  const [lastStats, setLastStats] = useState<BuildStats | null>(null);
  const includeNonTarget = project.generate.includeNonTarget;
  const plan = useMemo(() => planGeneration(project, library, { mode, includeNonTarget }), [project, library, mode, includeNonTarget]);
  const rows = showAll ? plan.rows : plan.included;
  const rowWarnings = groupIssues(plan.included.filter((r) => r.target));
  const byGroup = new Map<string, number>();
  for (const r of plan.targets) byGroup.set(r.group.name, (byGroup.get(r.group.name) ?? 0) + 1);

  const generate = () => {
    try {
      const { workflow, stats } = buildWorkflow(project, library, plan);
      downloadJson(workflow, `${safeFileName(project.name)}_${mode === 'draft' ? '초안' : '마무리'}_${stamp()}.json`);
      setLastStats(stats);
      toast(`워크플로우를 저장했습니다: ${stats.targets}장, 노드 ${stats.nodes}개`, 'ok');
    } catch (e) {
      toast(`만들지 못했습니다: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>생성</h2>
          <p>대상 줄을 모두 담은 ComfyUI 워크플로우 JSON 하나를 만듭니다. ComfyUI 화면에 끌어다 놓거나 [불러오기]로 엽니다.</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-body">
          <div className="row wrap" style={{ gap: 14 }}>
            <Seg
              value={mode}
              options={[
                { value: 'draft', label: '초안', title: '미정 줄만, 실행마다 시드가 바뀜' },
                { value: 'finalize', label: '마무리', title: '확정 줄만, 고정 시드 + 고화질 단계' },
              ]}
              onChange={setMode}
            />
            <Check
              checked={includeNonTarget}
              onChange={(v) => update((d) => void (d.generate.includeNonTarget = v))}
              label="대상 아닌 줄도 넣기 (저장 노드 mute)"
              title="확정·완성·꺼진 줄도 넣되 SaveImage만 꺼 둡니다. ComfyUI가 계산하지 않고, Ctrl+M으로 다시 켤 수 있습니다."
            />
            <span className="right">
              <button className="btn primary big" disabled={plan.blocked || plan.targets.length === 0} onClick={generate}>
                워크플로우 JSON 저장
              </button>
            </span>
          </div>
          <div className="callout small" style={{ marginTop: 12 }}>
            {mode === 'draft' ? (
              <>
                <strong>초안</strong>: 아직 확정하지 않은 줄만 넣습니다. 고화질 단계는 없고, 시드는 실행할 때마다 바뀝니다. ComfyUI 실행 버튼의 반복 횟수(Batch count)를
                올려 후보를 여러 장 뽑은 뒤, 마음에 드는 PNG를 [확정·내보내기]에 끌어다 놓으세요.
              </>
            ) : (
              <>
                <strong>마무리</strong>: 확정한 줄만 고정 시드로 다시 그리고 고화질 단계를 덧붙입니다. 기본 단계는 초안과 똑같아서 확정한 그림이 그대로 커집니다. 한 번만
                실행하면 됩니다. 결과 PNG를 끌어다 놓으면 "완성"이 됩니다.
              </>
            )}
          </div>
          <div className="stat-row" style={{ marginTop: 12 }}>
            <div className="stat">
              <div className="v">{plan.targets.length}</div>
              <div className="k">실행 1회에 생성될 장수</div>
            </div>
            {[...byGroup].map(([g, n]) => (
              <div className="stat" key={g}>
                <div className="v">{n}</div>
                <div className="k">{g}</div>
              </div>
            ))}
            {includeNonTarget && plan.included.length > plan.targets.length && (
              <div className="stat">
                <div className="v">{plan.included.length - plan.targets.length}</div>
                <div className="k">꺼 둔 줄 (mute)</div>
              </div>
            )}
            {lastStats && (
              <div className="stat">
                <div className="v">{lastStats.nodes}</div>
                <div className="k">
                  마지막 노드 수 (로라 체인 {lastStats.loraChains}, 공유 네거티브 {lastStats.sharedNegatives})
                </div>
              </div>
            )}
          </div>
          <IssueList issues={plan.issues} />
          {rowWarnings.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary>줄별 경고 {rowWarnings.length}개 (생성은 막지 않음)</summary>
              <IssueList issues={rowWarnings} />
            </details>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>줄 목록과 저장 경로</h3>
          <div className="actions">
            <Check checked={showAll} onChange={setShowAll} label="대상 아닌 줄도 보기" />
          </div>
        </div>
        <div style={{ overflow: 'auto', maxHeight: '60vh' }}>
          <table className="plain">
            <thead>
              <tr>
                <th>줄</th>
                <th>상태</th>
                <th>시드</th>
                <th>크기 · 샘플러</th>
                <th>저장 경로 (output 폴더 기준)</th>
                <th>경고</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <PlanRow key={r.key} r={r} />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="faint">
                    {mode === 'draft' ? '미정 줄이 없습니다.' : '확정 줄이 없습니다.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PlanRow({ r }: { r: PlannedRow }) {
  const g = r.settings.values.generation;
  const warns = r.issues.filter((i) => i.level !== 'info');
  const seed =
    r.seed.kind === 'fixed' ? `고정 ${r.seed.value}` : r.seed.kind === 'shared' ? '그룹 공유 (실행마다 바뀜)' : '실행마다 바뀜';
  return (
    <tr className={r.target ? '' : 'skip'}>
      <td>
        <span className="dot" style={{ background: r.char.color }} /> {r.title}
        {!r.target && <div className="small faint">빠짐: {r.skipReason}</div>}
      </td>
      <td>
        <StatusBadge status={r.row.status} seeded={r.row.seed != null} />
      </td>
      <td className="small">{seed}</td>
      <td className="mono">
        {g.width}×{g.height} · {g.sampler}
      </td>
      <td className="mono">{r.savePrefix}_00001_.png</td>
      <td>{warns.length > 0 && <span className="badge warn" title={warns.map((w) => w.message).join('\n')}>{warns.length}</span>}</td>
    </tr>
  );
}

/** 같은 경고는 하나로 묶고 어느 줄에서 났는지 붙인다 */
function groupIssues(rows: PlannedRow[]): Issue[] {
  const map = new Map<string, { issue: Issue; titles: string[] }>();
  for (const r of rows) {
    for (const i of r.issues) {
      if (i.level === 'info') continue;
      const k = `${i.level}:${i.message}`;
      if (!map.has(k)) map.set(k, { issue: i, titles: [] });
      map.get(k)!.titles.push(r.title);
    }
  }
  return [...map.values()].map(({ issue, titles }) => ({
    ...issue,
    message: `${issue.message} — ${titles.slice(0, 3).join(', ')}${titles.length > 3 ? ` 외 ${titles.length - 3}줄` : ''}`,
  }));
}
