import { useState } from 'react';
import type { Element, Fragment, StandaloneLora } from '../../lib/types';
import { addElement, deleteElement, duplicateElement, move, setElementOnScenes, setSceneLoraStrength } from '../../store/actions';
import { useStore } from '../../store/store';
import { Check, Combo, Empty, Field, NumInput, TextArea, TextInput } from '../common';
import { PromptEditor } from '../PromptEditor';
import { SceneChecklist } from '../SceneChecklist';
import { useComfyOptions } from '../SettingsEditor';

export function ElementsScreen() {
  const project = useStore((s) => s.project);
  const selId = useStore((s) => s.sel.elementId);
  const select = useStore((s) => s.select);
  const update = useStore((s) => s.update);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'fragment' | 'lora'>('all');
  const el = project.elements.find((e) => e.id === selId);
  const query = q.trim().toLowerCase();
  const shown = project.elements.filter(
    (e) =>
      (kind === 'all' || e.kind === kind) &&
      (!query ||
        [e.name, e.note, e.kind === 'fragment' ? `${e.positive} ${e.negative} ${e.category}` : `${e.file} ${e.trigger}`]
          .join(' ')
          .toLowerCase()
          .includes(query)),
  );
  const usage = (id: string) => project.scenes.filter((s) => s.elements.some((r) => r.id === id)).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>요소</h2>
          <p>프롬프트 조각(의상·소품·배경 같은 재사용 문구)과 단독 로라. 요소를 누르면 적용할 장면을 체크할 수 있습니다.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => addElement('fragment')}>
            + 조각
          </button>
          <button className="btn" onClick={() => addElement('lora')}>
            + 로라
          </button>
        </div>
      </div>
      <div className="split">
        <div className="panel">
          <input className="input search" placeholder="검색 (이름, 문구, 파일명)" value={q} onChange={(e) => setQ(e.target.value)} />
          <div style={{ padding: '6px 8px 0' }}>
            <span className="seg">
              {(['all', 'fragment', 'lora'] as const).map((k) => (
                <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                  {k === 'all' ? '전체' : k === 'fragment' ? '조각' : '로라'}
                </button>
              ))}
            </span>
          </div>
          {project.elements.length === 0 ? (
            <Empty>요소가 없습니다. 여러 장면에 반복해서 넣는 문구는 조각으로 만들어 두면 편합니다.</Empty>
          ) : (
            <ul className="list">
              {shown.map((e) => {
                const i = project.elements.indexOf(e);
                return (
                  <li key={e.id} className={`list-item ${el?.id === e.id ? 'active' : ''}`} onClick={() => select({ elementId: e.id })}>
                    <span className="badge">{e.kind === 'lora' ? '로라' : e.category || '조각'}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="title ellipsis">{e.name}</div>
                      <div className="sub ellipsis mono">{e.kind === 'lora' ? `${e.file || '(파일 없음)'} · ${e.strength}` : e.positive || '(문구 없음)'}</div>
                    </div>
                    <span className="meta">
                      <span className="faint small">{e.applyToAll ? '전체' : `${usage(e.id)}장면`}</span>
                      <button
                        className="btn small ghost"
                        disabled={i === 0}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          update((d) => move(d.elements, i, -1));
                        }}
                      >
                        ▲
                      </button>
                      <button
                        className="btn small ghost"
                        disabled={i === project.elements.length - 1}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          update((d) => move(d.elements, i, 1));
                        }}
                      >
                        ▼
                      </button>
                    </span>
                  </li>
                );
              })}
              {shown.length === 0 && <li className="faint small" style={{ padding: 10 }}>맞는 요소가 없습니다.</li>}
            </ul>
          )}
          <div className="small faint" style={{ padding: '0 12px 10px' }}>
            목록 순서가 프롬프트에 붙는 순서입니다.
          </div>
        </div>
        {el ? <ElementEditor key={el.id} el={el} /> : <div className="panel"><Empty>왼쪽에서 요소를 고르세요.</Empty></div>}
      </div>
    </div>
  );
}

function ElementEditor({ el }: { el: Element }) {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const opts = useComfyOptions();
  const set = (patch: Partial<Fragment> | Partial<StandaloneLora>, f: string) =>
    update((d) => {
      const x = d.elements.find((y) => y.id === el.id);
      if (x) Object.assign(x, patch);
    }, `el:${el.id}:${f}`);
  const assigned = new Map(project.scenes.flatMap((s) => s.elements.filter((r) => r.id === el.id).map((r) => [s.id, r] as const)));
  return (
    <div>
      <div className="panel">
        <div className="panel-head">
          <span className="badge">{el.kind === 'lora' ? '로라' : '조각'}</span>
          <h3>{el.name}</h3>
          <div className="actions">
            <button className="btn small" onClick={() => duplicateElement(el.id)}>
              복제
            </button>
            <button className="btn small danger" onClick={() => confirm(`"${el.name}"을(를) 지우고 모든 장면에서 뺍니다. (실행 취소 가능)`) && deleteElement(el.id)}>
              삭제
            </button>
          </div>
        </div>
        <div className="panel-body">
          <Field label="이름">
            <TextInput value={el.name} onChange={(v) => set({ name: v }, 'name')} />
          </Field>
          {el.kind === 'fragment' ? (
            <>
              <Field label="분류" help="의상, 소품, 배경 등. 목록에서 찾기 쉽게 붙이는 이름입니다.">
                <Combo mono={false} value={el.category} options={['의상', '소품', '배경', '포즈', '조명', '그림체']} onChange={(v) => set({ category: v }, 'category')} />
              </Field>
              <Field label="긍정 문구">
                <PromptEditor value={el.positive} onChange={(v) => set({ positive: v }, 'positive')} />
              </Field>
              <Field label="부정 문구">
                <PromptEditor negative rows={2} value={el.negative} onChange={(v) => set({ negative: v }, 'negative')} />
              </Field>
            </>
          ) : (
            <>
              <Field label="파일명" help="ComfyUI models/loras 폴더 기준 파일명.">
                <Combo value={el.file} options={opts.loras} placeholder="예: detail_tweaker.safetensors" onChange={(v) => set({ file: v }, 'file')} />
              </Field>
              <Field label="기본 강도" help="모델에 얼마나 강하게 걸지. 올리면 효과가 세지지만 그림이 무너지기 쉽다. 보통 0.4~1. 장면마다 따로 정할 수 있다.">
                <NumInput value={el.strength} step={0.05} onChange={(n) => n != null && set({ strength: n }, 'strength')} />
                <span className="small muted">CLIP 강도</span>
                <NumInput value={el.clipStrength ?? null} nullable placeholder="같음" step={0.05} onChange={(n) => set({ clipStrength: n }, 'clip')} />
              </Field>
              <Field label="트리거 워드" help="이 로라를 쓰는 장면의 프롬프트(조각 자리)에 붙습니다.">
                <TextInput mono value={el.trigger} onChange={(v) => set({ trigger: v }, 'trigger')} />
              </Field>
            </>
          )}
          <Field label="전체에 적용" help="켜면 모든 장면에 들어갑니다. 아래 체크와 관계없이 적용됩니다.">
            <Check checked={el.applyToAll} onChange={(v) => set({ applyToAll: v }, 'all')} label="모든 장면" />
          </Field>
          <Field label="주석">
            <TextArea value={el.note} rows={2} onChange={(v) => set({ note: v }, 'note')} />
          </Field>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <h3>적용할 장면</h3>
          <span className="small muted">{el.applyToAll ? '전체 적용 중 (체크는 장면별 강도용)' : `${assigned.size}개 장면`}</span>
        </div>
        <div className="panel-body">
          <SceneChecklist
            isChecked={(s) => assigned.has(s.id)}
            onToggle={(ids, on) => setElementOnScenes(el.id, ids, on)}
            extra={(s, on) =>
              el.kind === 'lora' && on ? (
                <NumInput
                  value={assigned.get(s.id)?.strength ?? null}
                  nullable
                  placeholder={String(el.strength)}
                  step={0.05}
                  title="이 장면에서의 강도 (비우면 기본 강도)"
                  onChange={(n) => setSceneLoraStrength(s.id, el.id, n)}
                />
              ) : null
            }
          />
        </div>
      </div>
    </div>
  );
}
