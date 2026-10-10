// 장면 상세: 캐릭터별 최종 긍정/부정 프롬프트, 로라, 주요 설정(값의 출처), 저장 경로 미리보기

import { useState } from 'react';
import { composeRow } from '../lib/compose';
import { rowKey } from '../lib/model';
import { resolvePattern, withFinalMarker } from '../lib/paths';
import { resolveSettings, settingsIssues } from '../lib/settings';
import type { Character, Scene, SceneGroup } from '../lib/types';
import { useStore } from '../store/store';
import { IssueList, OriginBadge, StatusBadge } from './common';

export function ScenePreview({ scene, group }: { scene: Scene; group: SceneGroup }) {
  const project = useStore((s) => s.project);
  const assignedIds = new Set(project.rows.filter((r) => r.sceneId === scene.id).map((r) => r.charId));
  const assigned = project.characters.filter((c) => assignedIds.has(c.id));
  const others = project.characters.filter((c) => !assignedIds.has(c.id));
  const [showOthers, setShowOthers] = useState(false);
  if (!project.characters.length) return <div className="faint small">캐릭터가 없습니다.</div>;
  return (
    <div>
      {assigned.length === 0 && <div className="faint small">이 장면을 배정한 캐릭터가 없습니다.</div>}
      {assigned.map((c) => (
        <CharPreview key={c.id} char={c} scene={scene} group={group} />
      ))}
      {others.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button className="btn small ghost" onClick={() => setShowOthers(!showOthers)}>
            {showOthers ? '배정 안 된 캐릭터 숨기기' : `배정 안 된 캐릭터 ${others.length}명도 미리보기`}
          </button>
          {showOthers && others.map((c) => <CharPreview key={c.id} char={c} scene={scene} group={group} unassigned />)}
        </div>
      )}
    </div>
  );
}

function CharPreview({ char, scene, group, unassigned }: { char: Character; scene: Scene; group: SceneGroup; unassigned?: boolean }) {
  const project = useStore((s) => s.project);
  const library = useStore((s) => s.library);
  const r = resolveSettings({ project, library, group, scene });
  const c = composeRow(project, char, scene, group, r);
  const row = project.rows.find((x) => rowKey(x.charId, x.sceneId) === rowKey(char.id, scene.id));
  const path = resolvePattern(r.values.output.savePattern, { char, scene, group });
  const g = r.values.generation;
  const o = r.origins.generation;
  const issues = [...c.issues, ...path.issues, ...settingsIssues(r, { group }).map((i) => ({ level: i.level, message: i.message }))];
  return (
    <div className="preview">
      <div className="preview-head">
        <span className="dot" style={{ background: char.color }} />
        {char.name}
        {row ? <StatusBadge status={row.status} seeded={row.seed != null} /> : <span className="badge">배정 안 됨</span>}
        {row?.seed != null && <span className="badge mono">시드 {row.seed}</span>}
        {unassigned && <span className="faint small">(미리보기만)</span>}
      </div>
      <div className="preview-body">
        <div className="prompt-out pos">
          {c.positiveParts
            .filter((p) => p.text)
            .map((p, i, arr) => (
              <span key={p.key}>
                <span className="part-label">[{p.label}]</span>
                <span className="part">{p.text}</span>
                {i < arr.length - 1 ? ', ' : ''}
              </span>
            ))}
        </div>
        <div className="prompt-out neg">
          {c.negativeParts
            .filter((p) => p.text)
            .map((p, i, arr) => (
              <span key={p.key}>
                <span className="part-label">[{p.label}]</span>
                <span className="part">{p.text}</span>
                {i < arr.length - 1 ? ', ' : ''}
              </span>
            ))}
          {!c.negative && <span className="faint">(네거티브 없음)</span>}
        </div>
        <div className="row wrap small">
          <span className="muted">로라:</span>
          {c.loras.length === 0 && <span className="faint">없음 (체크포인트에서 바로 연결)</span>}
          {c.loras.map((l) => (
            <span className="badge mono" key={l.file} title={l.source}>
              {l.file} {l.strength}
              {l.clipStrength !== l.strength ? `/${l.clipStrength}` : ''}
            </span>
          ))}
        </div>
        <div className="row wrap small">
          <span className="muted">설정:</span>
          <span className="mono">
            {g.width}×{g.height}
          </span>
          <OriginBadge origin={o.width} />
          <span className="mono">steps {g.steps}</span>
          <OriginBadge origin={o.steps} />
          <span className="mono">cfg {g.cfg}</span>
          <OriginBadge origin={o.cfg} />
          <span className="mono">{g.sampler}</span>
          <OriginBadge origin={o.sampler} note={r.notes['generation.sampler']} />
          <span className="mono">{g.scheduler}</span>
          <OriginBadge origin={o.scheduler} />
        </div>
        <div className="small">
          <span className="muted">저장: </span>
          <span className="mono">output/{path.prefix}_00001_.png</span>
          <span className="faint"> · 마무리 </span>
          <span className="mono">{withFinalMarker(path.fileName, r.values.output.finalMarker)}_00001_.png</span>
        </div>
        <IssueList issues={issues} limit={4} />
      </div>
    </div>
  );
}
