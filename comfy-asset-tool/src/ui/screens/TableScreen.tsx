// 표 보기: 행은 요소(캐릭터·조각·로라), 열은 장면(그룹별로 묶음). 체크로 배정하고 로라 강도는 칸에 바로 입력한다.

import { Fragment as F } from 'react';
import type { Element, Scene } from '../../lib/types';
import { setAssigned, setElementOnScenes, setSceneLoraStrength } from '../../store/actions';
import { useStore } from '../../store/store';
import { Check, Empty, NumInput } from '../common';

export function TableScreen() {
  const project = useStore((s) => s.project);
  const groups = project.groups.map((g) => ({ g, scenes: project.scenes.filter((s) => s.groupId === g.id) }));
  const assigned = new Set(project.rows.map((r) => `${r.charId}|${r.sceneId}`));
  const totalCols = groups.reduce((n, x) => n + x.scenes.length + 1, 0);
  const fragments = project.elements.filter((e) => e.kind === 'fragment');
  const loras = project.elements.filter((e) => e.kind === 'lora');

  if (!project.scenes.length) {
    return (
      <div className="page">
        <div className="page-head">
          <h2>표 보기</h2>
        </div>
        <div className="panel">
          <Empty>장면이 없습니다. [장면] 화면에서 그룹과 장면을 만드세요.</Empty>
        </div>
      </div>
    );
  }

  const elementRow = (el: Element) => {
    const has = (s: Scene) => s.elements.some((r) => r.id === el.id);
    return (
      <tr key={el.id} className={el.applyToAll ? 'global' : ''}>
        <td className="rowhead">
          <div className="ellipsis" title={el.kind === 'lora' ? el.file : el.positive}>
            {el.name}
            {el.kind === 'lora' && <span className="faint small"> · {el.strength}</span>}
          </div>
          {el.applyToAll && <span className="badge">전체 적용</span>}
        </td>
        {groups.map(({ g, scenes }) => {
          const n = scenes.filter(has).length;
          return (
            <F key={g.id}>
              <td className="group-cell">
                <Check
                  checked={scenes.length > 0 && n === scenes.length}
                  indeterminate={n > 0 && n < scenes.length}
                  disabled={!scenes.length}
                  title={`${g.name} 전체`}
                  onChange={(on) => setElementOnScenes(el.id, scenes.map((s) => s.id), on)}
                />
              </td>
              {scenes.map((s) => {
                const on = has(s);
                const ref = s.elements.find((r) => r.id === el.id);
                return (
                  <td key={s.id} className={on ? 'on' : ''}>
                    <div className="row" style={{ gap: 3, justifyContent: 'center' }}>
                      <Check checked={on} onChange={(v) => setElementOnScenes(el.id, [s.id], v)} />
                      {el.kind === 'lora' && on && (
                        <NumInput
                          value={ref?.strength ?? null}
                          nullable
                          placeholder={String(el.strength)}
                          step={0.05}
                          title="이 장면의 로라 강도 (비우면 기본 강도)"
                          onChange={(v) => setSceneLoraStrength(s.id, el.id, v)}
                        />
                      )}
                    </div>
                  </td>
                );
              })}
            </F>
          );
        })}
      </tr>
    );
  };

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-head">
        <div>
          <h2>표 보기</h2>
          <p>칸을 체크해 배정합니다. 그룹 칸은 그 그룹 장면 전체를 한 번에 체크합니다. 로라 칸의 숫자는 그 장면의 강도(비우면 기본 강도)입니다.</p>
        </div>
      </div>
      <div className="table-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th className="rowhead" rowSpan={2}>
                요소 \ 장면
              </th>
              {groups.map(({ g, scenes }) => (
                <th key={g.id} colSpan={scenes.length + 1} style={{ borderBottom: `3px solid ${g.color}` }}>
                  {g.name}
                </th>
              ))}
            </tr>
            <tr>
              {groups.map(({ g, scenes }) => (
                <F key={g.id}>
                  <th className="group-cell small">그룹</th>
                  {scenes.map((s) => (
                    <th key={s.id} className="scene-col" title={`${s.code} ${s.name}\n${s.prompt}`} style={s.enabled ? undefined : { opacity: 0.45 }}>
                      {s.code || '—'}
                      <span className="nm">{s.name}</span>
                    </th>
                  ))}
                </F>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="section-row">
              <td colSpan={totalCols + 1}>캐릭터 (장면 배정)</td>
            </tr>
            {project.characters.map((c) => (
              <tr key={c.id}>
                <td className="rowhead">
                  <span className="dot" style={{ background: c.color }} /> {c.name}
                </td>
                {groups.map(({ g, scenes }) => {
                  const n = scenes.filter((s) => assigned.has(`${c.id}|${s.id}`)).length;
                  return (
                    <F key={g.id}>
                      <td className="group-cell">
                        <Check
                          checked={scenes.length > 0 && n === scenes.length}
                          indeterminate={n > 0 && n < scenes.length}
                          disabled={!scenes.length}
                          onChange={(on) => setAssigned(c.id, scenes.map((s) => s.id), on)}
                        />
                      </td>
                      {scenes.map((s) => {
                        const on = assigned.has(`${c.id}|${s.id}`);
                        return (
                          <td key={s.id} className={on ? 'on' : ''}>
                            <Check checked={on} onChange={(v) => setAssigned(c.id, [s.id], v)} />
                          </td>
                        );
                      })}
                    </F>
                  );
                })}
              </tr>
            ))}
            {project.characters.length === 0 && (
              <tr>
                <td className="rowhead faint">캐릭터 없음</td>
                <td colSpan={totalCols} />
              </tr>
            )}
            <tr className="section-row">
              <td colSpan={totalCols + 1}>프롬프트 조각</td>
            </tr>
            {fragments.map(elementRow)}
            {fragments.length === 0 && (
              <tr>
                <td className="rowhead faint">조각 없음</td>
                <td colSpan={totalCols} />
              </tr>
            )}
            <tr className="section-row">
              <td colSpan={totalCols + 1}>로라</td>
            </tr>
            {loras.map(elementRow)}
            {loras.length === 0 && (
              <tr>
                <td className="rowhead faint">로라 없음</td>
                <td colSpan={totalCols} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
