import { useState } from 'react';
import { remainingCount, rowKey } from '../../lib/model';
import { sanitizeSegment } from '../../lib/paths';
import type { Character } from '../../lib/types';
import {
  addCharacter,
  allSets,
  applySet,
  deleteCharacter,
  duplicateCharacter,
  move,
  setAssigned,
  startExample,
} from '../../store/actions';
import { useStore } from '../../store/store';
import { ColorInput, Field, TextArea, TextInput } from '../common';
import { LoraListEditor } from '../LoraListEditor';
import { PromptEditor } from '../PromptEditor';
import { SceneChecklist } from '../SceneChecklist';

export function CharactersScreen() {
  const project = useStore((s) => s.project);
  const selId = useStore((s) => s.sel.charId);
  const select = useStore((s) => s.select);
  const update = useStore((s) => s.update);
  const char = project.characters.find((c) => c.id === selId) ?? project.characters[0];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>캐릭터</h2>
          <p>캐릭터를 등록하고 장면을 배정합니다. 캐릭터 × 장면 하나가 "줄"이고, 줄마다 이미지 한 장을 만듭니다.</p>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={addCharacter}>
            + 캐릭터
          </button>
        </div>
      </div>

      {project.characters.length === 0 ? (
        <Onboarding />
      ) : (
        <div className="split">
          <div className="panel">
            <ul className="list">
              {project.characters.map((c, i) => {
                const n = remainingCount(project, c.id);
                return (
                  <li key={c.id} className={`list-item ${char?.id === c.id ? 'active' : ''}`} onClick={() => select({ charId: c.id })}>
                    <span className="dot" style={{ background: c.color }} />
                    <div style={{ minWidth: 0 }}>
                      <div className="title ellipsis">{c.name || '(이름 없음)'}</div>
                      <div className="sub mono">{c.fileId}</div>
                    </div>
                    <div className="meta">
                      <span className="badge" title="남은 장수 (미정 + 확정)">
                        남음 {n.pending + n.confirmed}
                      </span>
                      <button
                        className="btn small ghost"
                        title="위로"
                        disabled={i === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          update((d) => move(d.characters, i, -1));
                        }}
                      >
                        ▲
                      </button>
                      <button
                        className="btn small ghost"
                        title="아래로"
                        disabled={i === project.characters.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          update((d) => move(d.characters, i, 1));
                        }}
                      >
                        ▼
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          {char && <CharacterEditor key={char.id} char={char} />}
        </div>
      )}
    </div>
  );
}

function Onboarding() {
  return (
    <div className="panel">
      <div className="panel-body">
        <div className="callout accent">
          <strong>처음이라면 이렇게 시작하세요</strong>
          <ol>
            <li>
              [설정]에서 체크포인트 파일명을 정합니다. 계열(Illustrious, Pony 등)에 맞는 권장값이 자동으로 들어갑니다.
            </li>
            <li>캐릭터를 추가하고 외형 프롬프트를 적습니다.</li>
            <li>캐릭터 편집에서 [세트 적용]으로 표정 세트 같은 장면 묶음을 통째로 배정합니다.</li>
            <li>[생성]에서 초안 워크플로우 JSON을 저장해 ComfyUI에서 엽니다.</li>
          </ol>
        </div>
        <div className="btn-row" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={addCharacter}>
            + 첫 캐릭터 추가
          </button>
          <button className="btn" onClick={startExample}>
            예시 프로젝트로 시작 (캐릭터 1명 + 표정 세트)
          </button>
        </div>
      </div>
    </div>
  );
}

function CharacterEditor({ char }: { char: Character }) {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const [setId, setSetId] = useState('');
  const sets = allSets();
  const set = (patch: Partial<Character>, field: string) =>
    update((d) => {
      const c = d.characters.find((x) => x.id === char.id);
      if (c) Object.assign(c, patch);
    }, `char:${char.id}:${field}`);
  const assigned = new Set(project.rows.filter((r) => r.charId === char.id).map((r) => r.sceneId));
  const fileIdClash = project.characters.some((c) => c.id !== char.id && c.fileId === char.fileId);
  const n = remainingCount(project, char.id);

  return (
    <div>
      <div className="panel">
        <div className="panel-head">
          <span className="dot" style={{ background: char.color }} />
          <h3>{char.name || '(이름 없음)'}</h3>
          <span className="small muted">
            미정 {n.pending} · 확정 {n.confirmed} · 완성 {n.done}
            {n.off ? ` · 꺼짐 ${n.off}` : ''}
          </span>
          <div className="actions">
            <button className="btn small" onClick={() => duplicateCharacter(char.id)}>
              복제
            </button>
            <button
              className="btn small danger"
              onClick={() => {
                if (confirm(`"${char.name}"과(와) 배정된 줄 ${assigned.size}개를 지웁니다. (실행 취소 가능)`)) deleteCharacter(char.id);
              }}
            >
              삭제
            </button>
          </div>
        </div>
        <div className="panel-body">
          <Field label="이름">
            <TextInput value={char.name} onChange={(v) => set({ name: v }, 'name')} />
            <ColorInput value={char.color} onChange={(v) => set({ color: v }, 'color')} />
          </Field>
          <Field
            label="파일 이름용 ID"
            help="저장 경로의 {캐릭터} 자리에 들어갑니다. 영문·숫자를 권장합니다."
            extra={
              <>
                {fileIdClash && <div className="inline-err">다른 캐릭터와 ID가 같습니다. 파일 이름이 겹칩니다.</div>}
                {char.fileId && sanitizeSegment(char.fileId) !== char.fileId && (
                  <div className="inline-warn">파일 이름에 못 쓰는 글자는 "_"로 바뀝니다: {sanitizeSegment(char.fileId)}</div>
                )}
              </>
            }
          >
            <TextInput mono value={char.fileId} onChange={(v) => set({ fileId: v }, 'fileId')} />
          </Field>
          <Field label="트리거 워드" help="캐릭터 로라의 트리거 워드. 외형 프롬프트 앞에 붙습니다.">
            <TextInput mono value={char.trigger} onChange={(v) => set({ trigger: v }, 'trigger')} />
          </Field>
          <Field label="외형 프롬프트" help="모든 장면에 들어가는 캐릭터 묘사. 태그를 누르면 가중치를 조절할 수 있습니다.">
            <PromptEditor value={char.prompt} onChange={(v) => set({ prompt: v }, 'prompt')} placeholder="1girl, solo, long hair, ..." />
          </Field>
          <Field label="네거티브">
            <PromptEditor negative value={char.negative} rows={2} onChange={(v) => set({ negative: v }, 'negative')} />
          </Field>
          <Field label="캐릭터 로라" help="이 캐릭터의 모든 줄에 걸리는 로라. 강도 1이 기본, 보통 0.6~1.">
            <LoraListEditor loras={char.loras} onChange={(l) => set({ loras: l }, 'loras')} />
          </Field>
          <Field label="주석" help="워크플로우에 Note 노드로 들어갑니다.">
            <TextArea value={char.note} rows={2} onChange={(v) => set({ note: v }, 'note')} />
          </Field>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>장면 배정</h3>
          <span className="small muted">{assigned.size}개 배정</span>
          <div className="actions">
            <select className="select" style={{ width: 220 }} value={setId} onChange={(e) => setSetId(e.target.value)}>
              <option value="">세트 고르기…</option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.builtin ? '[기본] ' : '[내 세트] '}
                  {s.name}
                </option>
              ))}
            </select>
            <button
              className="btn primary small"
              disabled={!setId}
              onClick={() => {
                const s = sets.find((x) => x.id === setId);
                if (s) applySet(s, [char.id]);
              }}
            >
              세트 적용
            </button>
          </div>
        </div>
        <div className="panel-body">
          <p className="small muted" style={{ marginTop: 0 }}>
            세트를 적용하면 프로젝트에 그 세트의 그룹이 없을 때 새로 만들고, 장면을 모두 배정합니다.
          </p>
          <SceneChecklist
            isChecked={(s) => assigned.has(s.id)}
            onToggle={(ids, on) => setAssigned(char.id, ids, on)}
            extra={(s, on) => {
              if (!on) return null;
              const r = project.rows.find((x) => rowKey(x.charId, x.sceneId) === rowKey(char.id, s.id));
              return r && r.status !== 'pending' ? <span className={`badge st-${r.status}`}>{r.status === 'done' ? '완성' : '확정'}</span> : null;
            }}
          />
        </div>
      </div>
    </div>
  );
}
