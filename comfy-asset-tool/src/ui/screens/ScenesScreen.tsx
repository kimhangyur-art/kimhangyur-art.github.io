import { useState } from 'react';
import { elementsForScene } from '../../lib/compose';
import { sceneLabel } from '../../lib/model';
import type { Scene, SceneGroup, SceneSet } from '../../lib/types';
import {
  addGroup,
  addScene,
  allSets,
  applySet,
  deleteGroup,
  deleteScenes,
  deleteSet,
  duplicateGroup,
  duplicateScenes,
  duplicateSet,
  move,
  moveScene,
  moveScenesToGroup,
  saveGroupAsSet,
  setElementOnScenes,
  setSceneLoraStrength,
  updateSetFromGroup,
} from '../../store/actions';
import { useStore } from '../../store/store';
import { Check, ColorInput, Empty, Field, Modal, NumInput, Seg, TextArea, TextInput } from '../common';
import { PromptEditor } from '../PromptEditor';
import { ScenePreview } from '../ScenePreview';
import { SettingsEditor } from '../SettingsEditor';
import { ensureSetGroup } from '../../lib/sets';

export function ScenesScreen() {
  const project = useStore((s) => s.project);
  const sel = useStore((s) => s.sel);
  const select = useStore((s) => s.select);
  const update = useStore((s) => s.update);
  const [libOpen, setLibOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const bulk = new Set(sel.bulk);
  const group = project.groups.find((g) => g.id === sel.groupId);
  const scene = project.scenes.find((s) => s.id === sel.sceneId);
  const toggleBulk = (id: string, on: boolean) => select({ bulk: on ? [...sel.bulk, id] : sel.bulk.filter((x) => x !== id) });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>장면</h2>
          <p>장면 그룹(예: 표정, 상황)과 장면을 관리합니다. 그룹의 공통 프롬프트는 그 그룹의 모든 장면에 붙습니다.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setLibOpen(true)}>
            세트 라이브러리
          </button>
          <button className="btn primary" onClick={addGroup}>
            + 그룹
          </button>
        </div>
      </div>
      <div className="split">
        <div className="panel">
          {project.groups.length === 0 && (
            <Empty>
              그룹이 없습니다.
              <br />
              <button className="btn small" style={{ marginTop: 8 }} onClick={() => setLibOpen(true)}>
                세트 라이브러리에서 가져오기
              </button>
            </Empty>
          )}
          <div style={{ padding: 6 }}>
            {project.groups.map((g, gi) => {
              const scenes = project.scenes.filter((s) => s.groupId === g.id);
              const isCollapsed = collapsed.has(g.id);
              const nBulk = scenes.filter((s) => bulk.has(s.id)).length;
              return (
                <div className="list-group" key={g.id}>
                  <div className={`list-group-head ${group?.id === g.id && !scene ? 'active' : ''}`} onClick={() => select({ groupId: g.id, sceneId: null })}>
                    <button
                      className="btn small ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        const n = new Set(collapsed);
                        if (n.has(g.id)) n.delete(g.id);
                        else n.add(g.id);
                        setCollapsed(n);
                      }}
                    >
                      {isCollapsed ? '▸' : '▾'}
                    </button>
                    <span onClick={(e) => e.stopPropagation()}>
                      <Check
                        checked={scenes.length > 0 && nBulk === scenes.length}
                        indeterminate={nBulk > 0 && nBulk < scenes.length}
                        title="이 그룹 장면 모두 고르기 (일괄 편집)"
                        onChange={(on) =>
                          select({ bulk: on ? [...new Set([...sel.bulk, ...scenes.map((s) => s.id)])] : sel.bulk.filter((x) => !scenes.some((s) => s.id === x)) })
                        }
                      />
                    </span>
                    <span className="dot" style={{ background: g.color }} />
                    <span className="ellipsis">{g.name}</span>
                    {g.seedMode === 'match' && <span className="badge" title="구도 맞추기">구도</span>}
                    <span className="right row" style={{ gap: 2 }}>
                      <span className="faint small">{scenes.length}</span>
                      <button
                        className="btn small ghost"
                        disabled={gi === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          update((d) => move(d.groups, gi, -1));
                        }}
                      >
                        ▲
                      </button>
                      <button
                        className="btn small ghost"
                        disabled={gi === project.groups.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          update((d) => move(d.groups, gi, 1));
                        }}
                      >
                        ▼
                      </button>
                    </span>
                  </div>
                  {!isCollapsed && (
                    <ul className="list" style={{ padding: '0 0 0 6px' }}>
                      {scenes.map((s, si) => (
                        <li
                          key={s.id}
                          className={`list-item ${scene?.id === s.id ? 'active' : ''} ${s.enabled ? '' : 'off'}`}
                          onClick={() => select({ sceneId: s.id, groupId: null })}
                        >
                          <span onClick={(e) => e.stopPropagation()}>
                            <Check checked={bulk.has(s.id)} onChange={(on) => toggleBulk(s.id, on)} title="일괄 편집에 넣기" />
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div className="title ellipsis">
                              <span className="mono">{s.code}</span> {s.name}
                            </div>
                            <div className="sub ellipsis">{s.prompt || '(장면 프롬프트 없음)'}</div>
                          </div>
                          <span className="meta">
                            <button
                              className="btn small ghost"
                              title={s.enabled ? '끄기' : '켜기'}
                              onClick={(e) => {
                                e.stopPropagation();
                                update((d) => {
                                  const x = d.scenes.find((y) => y.id === s.id);
                                  if (x) x.enabled = !x.enabled;
                                });
                              }}
                            >
                              {s.enabled ? '●' : '○'}
                            </button>
                            <button
                              className="btn small ghost"
                              disabled={si === 0}
                              onClick={(e) => {
                                e.stopPropagation();
                                moveScene(s.id, -1);
                              }}
                            >
                              ▲
                            </button>
                            <button
                              className="btn small ghost"
                              disabled={si === scenes.length - 1}
                              onClick={(e) => {
                                e.stopPropagation();
                                moveScene(s.id, 1);
                              }}
                            >
                              ▼
                            </button>
                          </span>
                        </li>
                      ))}
                      <li>
                        <button className="btn small ghost" style={{ marginLeft: 18 }} onClick={() => addScene(g.id)}>
                          + 장면
                        </button>
                      </li>
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div>
          {sel.bulk.length > 0 && <BulkEditor ids={sel.bulk} />}
          {scene ? (
            <SceneEditor key={scene.id} scene={scene} />
          ) : group ? (
            <GroupEditor key={group.id} group={group} />
          ) : (
            sel.bulk.length === 0 && (
              <div className="panel">
                <Empty>왼쪽에서 그룹이나 장면을 고르세요. 체크하면 여러 장면을 한 번에 고칠 수 있습니다.</Empty>
              </div>
            )
          )}
        </div>
      </div>
      {libOpen && <SetLibraryModal onClose={() => setLibOpen(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function GroupEditor({ group }: { group: SceneGroup }) {
  const project = useStore((s) => s.project);
  const library = useStore((s) => s.library);
  const update = useStore((s) => s.update);
  const set = (patch: Partial<SceneGroup>, f: string) =>
    update((d) => {
      const g = d.groups.find((x) => x.id === group.id);
      if (g) Object.assign(g, patch);
    }, `group:${group.id}:${f}`);
  const scenes = project.scenes.filter((s) => s.groupId === group.id);
  const fromUserSet = group.fromSetId && library.sets.some((s) => s.id === group.fromSetId);
  return (
    <div>
      <div className="panel">
        <div className="panel-head">
          <span className="dot" style={{ background: group.color }} />
          <h3>그룹 · {group.name}</h3>
          <div className="actions">
            <button className="btn small" onClick={() => addScene(group.id)}>
              + 장면
            </button>
            <button className="btn small" onClick={() => duplicateGroup(group.id)}>
              복제
            </button>
            <button className="btn small" onClick={() => saveGroupAsSet(group.id)}>
              세트로 저장
            </button>
            {fromUserSet && (
              <button className="btn small" onClick={() => updateSetFromGroup(group.id)} title="이 그룹을 만든 내 세트를 지금 내용으로 갱신">
                세트 갱신
              </button>
            )}
            <button
              className="btn small danger"
              onClick={() => confirm(`그룹 "${group.name}"과 장면 ${scenes.length}개, 그 줄들을 지웁니다. (실행 취소 가능)`) && deleteGroup(group.id)}
            >
              삭제
            </button>
          </div>
        </div>
        <div className="panel-body">
          <Field label="이름" help="저장 경로의 {그룹} 자리에 들어갑니다.">
            <TextInput value={group.name} onChange={(v) => set({ name: v }, 'name')} />
            <ColorInput value={group.color} onChange={(v) => set({ color: v }, 'color')} />
          </Field>
          <Field label="공통 프롬프트" help='이 그룹의 모든 장면에 붙습니다. 예) 표정 그룹의 "upper body, simple background, looking at viewer"'>
            <PromptEditor value={group.prompt} onChange={(v) => set({ prompt: v }, 'prompt')} />
          </Field>
          <Field label="공통 네거티브">
            <PromptEditor negative rows={2} value={group.negative} onChange={(v) => set({ negative: v }, 'negative')} />
          </Field>
          <Field
            label="시드 방식"
            help={
              <>
                <b>구도 맞추기</b>: 같은 그룹·같은 캐릭터의 줄들이 시드 하나를 함께 씁니다. 표정 세트처럼 구도는 두고 표정만 바꾸고 싶을 때 씁니다.
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  <li>해상도가 같고 프롬프트가 비슷할 때 효과가 있습니다.</li>
                  <li>
                    ancestral·sde 계열처럼 단계마다 노이즈를 넣는 샘플러에서는 효과가 약합니다. 그래서 이 옵션을 켠 그룹에는 다른 샘플러(예: euler)를 권장값으로 씁니다.
                  </li>
                  <li>한 줄을 확정하면 그 시드를 그룹의 나머지 미정 줄에 적용할지 묻습니다.</li>
                  <li>시드를 고정한 장면은 다시 실행해도 같은 그림이 나옵니다. 마음에 안 드는 장면은 [진행 현황]에서 개별로 고정을 풀어 다시 뽑습니다.</li>
                </ul>
              </>
            }
          >
            <Seg
              value={group.seedMode}
              options={[
                { value: 'independent', label: '줄마다 독립 (기본)' },
                { value: 'match', label: '구도 맞추기' },
              ]}
              onChange={(v) => set({ seedMode: v }, 'seedMode')}
            />
          </Field>
          <Field label="주석" help="워크플로우에서 그룹 맨 위에 Note 노드로 들어갑니다.">
            <TextArea value={group.note} rows={2} onChange={(v) => set({ note: v }, 'note')} />
          </Field>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <h3>그룹 설정</h3>
          <span className="small muted">전역 설정 위에 이 그룹에서만 덮어씁니다.</span>
        </div>
        <div className="panel-body">
          <SettingsEditor target={{ level: 'group', id: group.id }} layer={group.settings} group={group} collapseInherited />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SceneEditor({ scene }: { scene: Scene }) {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const group = project.groups.find((g) => g.id === scene.groupId)!;
  const [addId, setAddId] = useState('');
  const set = (patch: Partial<Scene>, f: string) =>
    update((d) => {
      const x = d.scenes.find((y) => y.id === scene.id);
      if (x) Object.assign(x, patch);
    }, `scene:${scene.id}:${f}`);
  const codeClash = project.scenes.some((s) => s.id !== scene.id && s.code === scene.code && scene.code);
  const used = elementsForScene(project, scene);
  const notAssigned = project.elements.filter((e) => !scene.elements.some((r) => r.id === e.id));
  return (
    <div>
      <div className="panel">
        <div className="panel-head">
          <h3>
            장면 상세 · <span className="mono">{scene.code}</span> {scene.name}
          </h3>
          <div className="actions">
            <Check checked={scene.enabled} onChange={(v) => set({ enabled: v }, 'enabled')} label="켜기" title="끄면 생성 대상에서 빠집니다" />
            <button className="btn small" onClick={() => duplicateScenes([scene.id])}>
              복제
            </button>
            <button className="btn small danger" onClick={() => confirm(`장면 "${sceneLabel(scene)}"과 그 줄들을 지웁니다. (실행 취소 가능)`) && deleteScenes([scene.id])}>
              삭제
            </button>
          </div>
        </div>
        <div className="panel-body">
          <div className="grid2">
            <Field label="코드" help="{장면코드}. 자유 문자열" extra={codeClash && <div className="inline-warn">다른 장면과 코드가 같습니다.</div>}>
              <TextInput mono value={scene.code} onChange={(v) => set({ code: v }, 'code')} />
            </Field>
            <Field label="이름" help="{장면이름}">
              <TextInput value={scene.name} onChange={(v) => set({ name: v }, 'name')} />
            </Field>
          </div>
          <Field label="그룹">
            <select className="select" value={scene.groupId} onChange={(e) => moveScenesToGroup([scene.id], e.target.value)}>
              {project.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="장면 프롬프트" help={`그룹 공통 프롬프트("${group.prompt || '없음'}") 뒤에 붙습니다. 같은 문구를 장면마다 반복하지 말고 그룹 공통에 두세요.`}>
            <PromptEditor value={scene.prompt} onChange={(v) => set({ prompt: v }, 'prompt')} />
          </Field>
          <Field label="장면 네거티브">
            <PromptEditor negative rows={2} value={scene.negative} onChange={(v) => set({ negative: v }, 'negative')} />
          </Field>
          <Field label="배정된 요소" help="조각은 프롬프트 끝에, 로라는 이 장면의 로라 체인에 들어갑니다. [요소]·[표 보기] 화면에서도 배정할 수 있습니다.">
            <div style={{ display: 'grid', gap: 4, flex: 1 }}>
              {used.length === 0 && <span className="faint small">없음</span>}
              {used.map(({ el, strength, viaAll }) => (
                <div className="row wrap" key={el.id}>
                  <span className="badge">{el.kind === 'lora' ? '로라' : '조각'}</span>
                  <span>{el.name}</span>
                  {viaAll && <span className="badge">전체 적용</span>}
                  {el.kind === 'lora' && !viaAll && (
                    <>
                      <span className="small muted">강도</span>
                      <NumInput value={strength} nullable placeholder={String(el.strength)} step={0.05} onChange={(n) => setSceneLoraStrength(scene.id, el.id, n)} />
                    </>
                  )}
                  {!viaAll && (
                    <button className="btn small ghost danger" onClick={() => setElementOnScenes(el.id, [scene.id], false)}>
                      빼기
                    </button>
                  )}
                </div>
              ))}
              {notAssigned.length > 0 && (
                <div className="row">
                  <select className="select" style={{ maxWidth: 260 }} value={addId} onChange={(e) => setAddId(e.target.value)}>
                    <option value="">요소 더하기…</option>
                    {notAssigned.map((e) => (
                      <option key={e.id} value={e.id}>
                        [{e.kind === 'lora' ? '로라' : '조각'}] {e.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn small"
                    disabled={!addId}
                    onClick={() => {
                      setElementOnScenes(addId, [scene.id], true);
                      setAddId('');
                    }}
                  >
                    배정
                  </button>
                </div>
              )}
            </div>
          </Field>
          <Field label="주석" help="워크플로우에서 이 장면의 줄 옆에 Note 노드로 들어갑니다.">
            <TextArea value={scene.note} rows={2} onChange={(v) => set({ note: v }, 'note')} />
          </Field>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>캐릭터별 최종 프롬프트 미리보기</h3>
        </div>
        <div className="panel-body">
          <ScenePreview scene={scene} group={group} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>장면 설정</h3>
          <span className="small muted">그룹 설정 위에 이 장면에서만 덮어씁니다. 저장 경로 덮어쓰기도 여기서.</span>
        </div>
        <div className="panel-body">
          <SettingsEditor target={{ level: 'scene', id: scene.id }} layer={scene.settings} group={group} scene={scene} collapseInherited />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function BulkEditor({ ids }: { ids: string[] }) {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const select = useStore((s) => s.select);
  const [groupId, setGroupId] = useState('');
  const [elId, setElId] = useState('');
  const [append, setAppend] = useState('');
  const idset = new Set(ids);
  const scenes = project.scenes.filter((s) => idset.has(s.id));
  const setAll = (fn: (s: Scene) => void) =>
    update((d) => {
      for (const s of d.scenes) if (idset.has(s.id)) fn(s);
    });
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head">
        <h3>일괄 편집 · 장면 {scenes.length}개</h3>
        <div className="actions">
          <button className="btn small ghost" onClick={() => select({ bulk: [] })}>
            선택 해제
          </button>
        </div>
      </div>
      <div className="panel-body">
        <div className="small muted" style={{ marginBottom: 8 }}>
          {scenes.map((s) => sceneLabel(s)).join(', ')}
        </div>
        <div className="btn-row">
          <button className="btn small" onClick={() => setAll((s) => void (s.enabled = true))}>
            모두 켜기
          </button>
          <button className="btn small" onClick={() => setAll((s) => void (s.enabled = false))}>
            모두 끄기
          </button>
          <button className="btn small" onClick={() => duplicateScenes(ids)}>
            복제
          </button>
          <button className="btn small danger" onClick={() => confirm(`장면 ${ids.length}개와 그 줄들을 지웁니다. (실행 취소 가능)`) && deleteScenes(ids)}>
            삭제
          </button>
        </div>
        <div className="btn-row" style={{ marginTop: 8 }}>
          <select className="select" style={{ width: 180 }} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">그룹 옮기기…</option>
            {project.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button className="btn small" disabled={!groupId} onClick={() => moveScenesToGroup(ids, groupId)}>
            옮기기
          </button>
          <select className="select" style={{ width: 200 }} value={elId} onChange={(e) => setElId(e.target.value)}>
            <option value="">요소…</option>
            {project.elements.map((e) => (
              <option key={e.id} value={e.id}>
                [{e.kind === 'lora' ? '로라' : '조각'}] {e.name}
              </option>
            ))}
          </select>
          <button className="btn small" disabled={!elId} onClick={() => setElementOnScenes(elId, ids, true)}>
            배정
          </button>
          <button className="btn small" disabled={!elId} onClick={() => setElementOnScenes(elId, ids, false)}>
            해제
          </button>
        </div>
        <div className="btn-row" style={{ marginTop: 8 }}>
          <input className="input mono" style={{ width: 280 }} placeholder="장면 프롬프트 뒤에 붙일 문구" value={append} onChange={(e) => setAppend(e.target.value)} />
          <button
            className="btn small"
            disabled={!append.trim()}
            onClick={() => {
              setAll((s) => void (s.prompt = s.prompt.trim() ? `${s.prompt.trim().replace(/,$/, '')}, ${append.trim()}` : append.trim()));
              setAppend('');
            }}
          >
            뒤에 붙이기
          </button>
          <button
            className="btn small"
            title="선택한 장면의 설정 덮어쓰기를 모두 지워 그룹 설정을 따르게 합니다"
            onClick={() =>
              setAll((s) => {
                s.settings = { modes: {}, values: {} };
              })
            }
          >
            설정 덮어쓰기 지우기
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SetLibraryModal({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const updateLibrary = useStore((s) => s.updateLibrary);
  const update = useStore((s) => s.update);
  const [selId, setSelId] = useState<string>(allSets()[0]?.id ?? '');
  const [chars, setChars] = useState<Set<string>>(new Set());
  const sets = allSets();
  const set = sets.find((s) => s.id === selId);
  const inProject = (s: SceneSet) => project.groups.some((g) => g.fromSetId === s.id);
  return (
    <Modal title="장면 세트 라이브러리" onClose={onClose} wide>
      <div className="split">
        <ul className="list" style={{ padding: 0 }}>
          {sets.map((s) => (
            <li key={s.id} className={`list-item ${s.id === selId ? 'active' : ''}`} onClick={() => setSelId(s.id)}>
              <span className="dot" style={{ background: s.group.color }} />
              <div style={{ minWidth: 0 }}>
                <div className="title ellipsis">{s.name}</div>
                <div className="sub">
                  {s.builtin ? '기본 제공' : '내 세트'} · 장면 {s.scenes.length}
                  {inProject(s) ? ' · 프로젝트에 있음' : ''}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {set && (
          <div>
            <div className="row wrap" style={{ marginBottom: 8 }}>
              {set.builtin ? (
                <h3 style={{ margin: 0 }}>{set.name}</h3>
              ) : (
                <input
                  className="input"
                  style={{ maxWidth: 280, fontWeight: 600 }}
                  value={set.name}
                  onChange={(e) => updateLibrary((l) => void (l.sets.find((x) => x.id === set.id)!.name = e.target.value))}
                />
              )}
              <span className="right btn-row">
                <button className="btn small" onClick={() => duplicateSet(set)}>
                  복제해 내 세트로
                </button>
                {!set.builtin && (
                  <button className="btn small danger" onClick={() => confirm(`세트 "${set.name}"을(를) 지웁니다.`) && deleteSet(set.id)}>
                    삭제
                  </button>
                )}
              </span>
            </div>
            <p className="small muted">{set.note}</p>
            <div className="callout small">
              그룹 <b>{set.group.name}</b> · 공통 프롬프트 <span className="mono">{set.group.prompt || '없음'}</span> ·{' '}
              {set.group.seedMode === 'match' ? '구도 맞추기' : '줄마다 독립 시드'}
              {set.group.aspect ? ` · ${set.group.aspect === 'square' ? '정사각' : set.group.aspect === 'portrait' ? '세로' : '가로'} 해상도` : ''}
            </div>
            <table className="plain" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>코드</th>
                  <th>이름</th>
                  <th>장면 프롬프트</th>
                </tr>
              </thead>
              <tbody>
                {set.scenes.map((s, i) => (
                  <tr key={i}>
                    <td className="mono">{s.code}</td>
                    <td>{s.name}</td>
                    <td className="mono">{s.prompt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="section" style={{ marginTop: 14 }}>
              <h4>캐릭터에 적용</h4>
              {project.characters.length === 0 && <div className="faint small">캐릭터가 없습니다. 그룹만 추가할 수 있습니다.</div>}
              <div className="row wrap">
                {project.characters.map((c) => (
                  <Check
                    key={c.id}
                    checked={chars.has(c.id)}
                    onChange={(on) => {
                      const n = new Set(chars);
                      if (on) n.add(c.id);
                      else n.delete(c.id);
                      setChars(n);
                    }}
                    label={c.name}
                  />
                ))}
              </div>
              <div className="btn-row" style={{ marginTop: 10 }}>
                <button className="btn primary" disabled={chars.size === 0} onClick={() => applySet(set, [...chars])}>
                  고른 캐릭터에 적용
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    update((d) => void ensureSetGroup(d, set));
                    onClose();
                  }}
                >
                  {inProject(set) ? '프로젝트에 이미 있음' : '그룹만 프로젝트에 추가'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
