// 장면 체크 목록: 그룹 단위로 한 번에 체크하거나 장면을 하나씩 체크한다.

import type { ReactNode } from 'react';
import { sceneLabel } from '../lib/model';
import type { Scene } from '../lib/types';
import { useStore } from '../store/store';
import { Check, Empty } from './common';

export function SceneChecklist({
  isChecked,
  onToggle,
  extra,
  emptyText = '장면이 없습니다. [장면] 화면에서 그룹과 장면을 만들거나 세트를 적용하세요.',
}: {
  isChecked: (s: Scene) => boolean;
  onToggle: (sceneIds: string[], on: boolean) => void;
  extra?: (s: Scene, checked: boolean) => ReactNode;
  emptyText?: string;
}) {
  const project = useStore((s) => s.project);
  if (!project.groups.length) return <Empty>{emptyText}</Empty>;
  return (
    <div className="check-groups">
      {project.groups.map((g) => {
        const scenes = project.scenes.filter((s) => s.groupId === g.id);
        const n = scenes.filter(isChecked).length;
        return (
          <div className="check-group" key={g.id}>
            <div className="check-group-head">
              <Check
                checked={scenes.length > 0 && n === scenes.length}
                indeterminate={n > 0 && n < scenes.length}
                disabled={!scenes.length}
                onChange={(on) => onToggle(scenes.map((s) => s.id), on)}
                label={
                  <>
                    <span className="dot" style={{ background: g.color }} /> {g.name}
                  </>
                }
              />
              <span className="faint small">
                {n}/{scenes.length}
              </span>
            </div>
            {scenes.length > 0 ? (
              <div className="check-items">
                {scenes.map((s) => {
                  const on = isChecked(s);
                  return (
                    <div className="check-item" key={s.id}>
                      <label title={s.prompt}>
                        <input type="checkbox" checked={on} onChange={(e) => onToggle([s.id], e.target.checked)} />
                        <span className={`ellipsis ${s.enabled ? '' : 'faint'}`}>
                          {sceneLabel(s) || '(이름 없음)'}
                          {!s.enabled && ' (꺼짐)'}
                        </span>
                      </label>
                      {extra?.(s, on)}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="faint small" style={{ padding: '6px 10px' }}>
                장면 없음
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
