// 진행 현황: 캐릭터 × 장면 격자. 상태별 색과 확정 이미지 썸네일, 캐릭터마다 남은 장수.

import { Fragment as F } from 'react';
import { indexProject, remainingCount, rowKey, rowTitle } from '../../lib/model';
import { setAssigned, setRowMemo, setRowSeed, unconfirmRow, undoDone, unlockSeed } from '../../store/actions';
import { useStore } from '../../store/store';
import { Empty, NumInput, StatusBadge, TextArea } from '../common';

export function ProgressScreen() {
  const project = useStore((s) => s.project);
  const cellKey = useStore((s) => s.sel.cellKey);
  const select = useStore((s) => s.select);
  const idx = indexProject(project);
  const groups = project.groups.map((g) => ({ g, scenes: project.scenes.filter((s) => s.groupId === g.id) })).filter((x) => x.scenes.length);

  if (!project.characters.length || !project.scenes.length) {
    return (
      <div className="page">
        <div className="page-head">
          <h2>진행 현황</h2>
        </div>
        <div className="panel">
          <Empty>캐릭터와 장면을 먼저 만드세요.</Empty>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-head">
        <div>
          <h2>진행 현황</h2>
          <p>칸을 누르면 시드·메모를 보고 확정을 풀 수 있습니다. 점선 칸은 배정하지 않은 장면입니다.</p>
        </div>
        <div className="legend actions">
          <span>
            <span className="sw" style={{ background: 'var(--st-pending)' }} />
            미정
          </span>
          <span>
            <span className="sw" style={{ background: 'var(--st-seeded)' }} />
            미정 · 시드 고정
          </span>
          <span>
            <span className="sw" style={{ background: 'var(--st-confirmed)' }} />
            확정
          </span>
          <span>
            <span className="sw" style={{ background: 'var(--st-done)' }} />
            완성
          </span>
        </div>
      </div>

      <div className="char-progress">
        {project.characters.map((c) => {
          const n = remainingCount(project, c.id);
          const total = n.pending + n.confirmed + n.done;
          const pct = (x: number) => (total ? `${(x / total) * 100}%` : '0');
          return (
            <div className="char-card" key={c.id}>
              <div className="row">
                <span className="dot" style={{ background: c.color }} />
                <b>{c.name}</b>
                <span className="right small">
                  남은 장수 <b>{n.pending + n.confirmed}</b> / {total}
                </span>
              </div>
              <div className="small muted">
                미정 {n.pending} · 확정 {n.confirmed} · 완성 {n.done}
                {n.off ? ` · 꺼짐 ${n.off}` : ''}
              </div>
              <div className="bar">
                <span style={{ width: pct(n.done), background: 'var(--st-done)' }} />
                <span style={{ width: pct(n.confirmed), background: 'var(--st-confirmed)' }} />
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 14, alignItems: 'start' }}>
        <div className="table-wrap">
          <table className="matrix progress-grid">
            <thead>
              <tr>
                <th className="rowhead" rowSpan={2}>
                  캐릭터 \ 장면
                </th>
                {groups.map(({ g, scenes }) => (
                  <th key={g.id} colSpan={scenes.length} style={{ borderBottom: `3px solid ${g.color}` }}>
                    {g.name}
                    {g.seedMode === 'match' && <span className="faint small"> · 구도 맞추기</span>}
                  </th>
                ))}
              </tr>
              <tr>
                {groups.map(({ g, scenes }) => (
                  <F key={g.id}>
                    {scenes.map((s) => (
                      <th key={s.id} className="scene-col" title={s.prompt}>
                        {s.code}
                        <span className="nm">{s.name}</span>
                      </th>
                    ))}
                  </F>
                ))}
              </tr>
            </thead>
            <tbody>
              {project.characters.map((c) => (
                <tr key={c.id}>
                  <td className="rowhead">
                    <span className="dot" style={{ background: c.color }} /> {c.name}
                  </td>
                  {groups.map(({ g, scenes }) => (
                    <F key={g.id}>
                      {scenes.map((s) => {
                        const k = rowKey(c.id, s.id);
                        const r = idx.rows.get(k);
                        const st = !r ? 'unassigned' : r.status === 'pending' && r.seed != null ? 'st-seeded' : `st-${r.status}`;
                        return (
                          <td key={s.id} className="cell" onClick={() => select({ cellKey: k })}>
                            <div className={`cell-box ${st} ${s.enabled ? '' : 'off'} ${cellKey === k ? 'selected' : ''}`} title={rowTitle(s, c)}>
                              {r?.thumb ? <img src={r.thumb} alt="" /> : <span>{!r ? '+' : r.status === 'pending' ? '미정' : ''}</span>}
                              {r && r.status !== 'pending' && <span className="tag">{r.status === 'done' ? '완성' : '확정'}</span>}
                              {r?.seed != null && <span className="pin" title={`시드 ${r.seed}`}>📌</span>}
                            </div>
                          </td>
                        );
                      })}
                    </F>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CellDetail cellKey={cellKey} />
      </div>
    </div>
  );
}

function CellDetail({ cellKey }: { cellKey: string | null }) {
  const project = useStore((s) => s.project);
  const finals = useStore((s) => s.finals);
  const setTab = useStore((s) => s.setTab);
  const select = useStore((s) => s.select);
  if (!cellKey) {
    return (
      <div className="panel sticky">
        <Empty>칸을 고르세요.</Empty>
      </div>
    );
  }
  const [charId, sceneId] = cellKey.split('|');
  const idx = indexProject(project);
  const c = idx.chars.get(charId);
  const s = idx.scenes.get(sceneId);
  if (!c || !s) return null;
  const g = idx.groups.get(s.groupId);
  const r = idx.rows.get(cellKey);
  return (
    <div className="panel sticky">
      <div className="panel-head">
        <h3 className="ellipsis">{rowTitle(s, c)}</h3>
      </div>
      <div className="panel-body">
        {!r ? (
          <>
            <p className="muted small">이 캐릭터에 배정하지 않은 장면입니다.</p>
            <button className="btn primary" onClick={() => setAssigned(c.id, [s.id], true)}>
              배정하기
            </button>
          </>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="row wrap">
              <StatusBadge status={r.status} seeded={r.seed != null} />
              {!s.enabled && <span className="badge">꺼진 장면</span>}
              {g?.seedMode === 'match' && <span className="badge">구도 맞추기</span>}
              {r.status === 'done' && <span className={`badge ${finals.has(cellKey) ? 'ok' : 'warn'}`}>{finals.has(cellKey) ? '파일 있음' : '파일 없음'}</span>}
            </div>
            {r.thumb && <img className="thumb-large" src={r.thumb} alt="" />}
            {(r.confirmedFile || r.finalFile) && (
              <div className="small mono muted">
                {r.confirmedFile && <div>초안: {r.confirmedFile}</div>}
                {r.finalFile && <div>마무리: {r.finalFile}</div>}
              </div>
            )}
            <div>
              <div className="small muted">
                시드{' '}
                {r.seedFrom === 'png'
                  ? '(PNG에서 읽음)'
                  : r.seedFrom === 'group'
                    ? '(그룹 시드 적용)'
                    : r.seedFrom === 'manual'
                      ? '(직접 입력)'
                      : ''}
              </div>
              <div className="row">
                <NumInput value={r.seed} nullable step={1} min={0} placeholder="없음 (실행마다 무작위)" onChange={(n) => setRowSeed(cellKey, n)} className="wide" />
              </div>
              {r.status !== 'pending' && r.seed == null && (
                <div className="inline-warn">고정 시드가 없어 마무리에서 같은 그림이 나오지 않습니다. 시드를 입력하거나 실행 정보가 있는 PNG를 다시 끌어다 놓으세요.</div>
              )}
              {r.status === 'pending' && r.seed != null && (
                <div className="small muted">시드가 고정된 미정 줄입니다. 초안을 다시 실행해도 같은 그림이 나옵니다. 다시 뽑으려면 고정을 푸세요.</div>
              )}
            </div>
            <div>
              <div className="small muted">메모 (워크플로우의 Note에 들어갑니다)</div>
              <TextArea value={r.memo} rows={2} onChange={(v) => setRowMemo(cellKey, v)} />
            </div>
            <div className="btn-row">
              {r.status === 'pending' && r.seed != null && (
                <button className="btn" onClick={() => unlockSeed(cellKey)}>
                  시드 고정 풀기
                </button>
              )}
              {r.status === 'confirmed' && (
                <>
                  <button className="btn" onClick={() => unconfirmRow(cellKey, false)} title="미정으로 돌리고 시드도 풀어 다시 뽑습니다">
                    확정 해제 (다시 뽑기)
                  </button>
                  <button className="btn" onClick={() => unconfirmRow(cellKey, true)} title="미정으로 돌리되 시드는 남겨 프롬프트만 고쳐 볼 때">
                    확정만 해제 (시드 유지)
                  </button>
                </>
              )}
              {r.status === 'done' && (
                <>
                  <button className="btn" onClick={() => undoDone(cellKey)}>
                    완성 취소 (확정으로)
                  </button>
                  <button className="btn" onClick={() => unconfirmRow(cellKey, false)}>
                    확정까지 해제
                  </button>
                </>
              )}
              <button
                className="btn ghost"
                onClick={() => {
                  select({ sceneId: s.id, groupId: null });
                  setTab('scenes');
                }}
              >
                장면 상세 보기
              </button>
              <button className="btn ghost danger" onClick={() => setAssigned(c.id, [s.id], false)}>
                배정 해제
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
