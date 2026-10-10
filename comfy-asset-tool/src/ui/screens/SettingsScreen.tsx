import { useState } from 'react';
import { DEFAULT_COMFY_URL } from '../../lib/comfyApi';
import { jsonBlob, pickFiles, saveFile, stamp } from '../../lib/download';
import { PRESETS, getPreset } from '../../lib/presets';
import { effectiveFamily, findMyPreset } from '../../lib/settings';
import type { FamilyId, Library } from '../../lib/types';
import { connectComfy, deleteMyPreset, saveMyPreset, startExample, startNewProject } from '../../store/actions';
import { openProject, saveProject } from '../../store/projectFile';
import { useStore } from '../../store/store';
import { Check, Combo, Field, TextInput } from '../common';
import { SettingsEditor } from '../SettingsEditor';

export function SettingsScreen() {
  const project = useStore((s) => s.project);
  const library = useStore((s) => s.library);
  const update = useStore((s) => s.update);
  const comfy = useStore((s) => s.comfy);
  const fam = effectiveFamily(project);
  const preset = getPreset(fam.family);
  const mine = findMyPreset(library, project.checkpoint);
  const [showPreset, setShowPreset] = useState<FamilyId | null>(null);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>설정</h2>
          <p>
            설정 묶음마다 [권장]/[커스텀]을 고릅니다. 권장이면 체크포인트 계열의 프리셋 값을 그대로 쓰고(회색), 커스텀이면 직접 고칩니다. 그룹·장면에서 다시 덮어쓸 수
            있습니다.
          </p>
        </div>
      </div>

      <div className="split wide-left">
        <div className="stack">
          <div className="panel">
            <div className="panel-head">
              <h3>모델</h3>
            </div>
            <div className="panel-body">
              <Field label="체크포인트" help="ComfyUI models/checkpoints 폴더 기준 파일명. 파일명으로 계열을 추정해 권장값을 고릅니다.">
                <Combo
                  value={project.checkpoint}
                  options={comfy?.checkpoints ?? []}
                  placeholder="예: waiIllustriousSDXL_v170.safetensors"
                  onChange={(v) => update((d) => void (d.checkpoint = v), 'ckpt')}
                />
              </Field>
              <Field
                label="계열"
                help={
                  project.family === 'auto'
                    ? fam.detected
                      ? `파일명으로 "${getPreset(fam.detected).label}"(으)로 추정했습니다. 틀렸으면 직접 고르세요.`
                      : `파일명으로 계열을 정하지 못해 "${preset.label}"을(를) 씁니다. 맞는 계열을 직접 고르세요.`
                    : '직접 고른 계열입니다.'
                }
              >
                <select
                  className="select"
                  value={project.family}
                  onChange={(e) => update((d) => void (d.family = e.target.value as FamilyId | 'auto'))}
                >
                  <option value="auto">자동 ({preset.label})</option>
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <button className="btn small ghost" onClick={() => setShowPreset(showPreset ? null : fam.family)}>
                  {showPreset ? '프리셋 닫기' : '프리셋 값 보기'}
                </button>
              </Field>
              <div className="callout small">{preset.description}</div>
              {showPreset && <PresetTable id={showPreset} onChange={setShowPreset} />}
              <Field
                label="내 프리셋"
                help="커스텀 설정을 이 체크포인트의 권장값으로 저장합니다. 이 체크포인트를 고르면 계열 프리셋 대신 쓰입니다."
              >
                <div style={{ display: 'grid', gap: 6, flex: 1 }}>
                  {mine ? (
                    <div className="row wrap">
                      <span className="badge origin-mine">저장됨 · {new Date(mine.savedAt).toLocaleString('ko-KR')}</span>
                      <Check checked={project.useMyPreset} onChange={(v) => update((d) => void (d.useMyPreset = v))} label="권장값 대신 쓰기" />
                    </div>
                  ) : (
                    <span className="faint small">이 체크포인트의 내 프리셋이 없습니다.</span>
                  )}
                  <div className="btn-row">
                    <button className="btn small" disabled={!project.checkpoint.trim()} onClick={saveMyPreset}>
                      지금 설정을 내 프리셋으로 저장
                    </button>
                  </div>
                  {library.myPresets.length > 0 && (
                    <details>
                      <summary>저장된 내 프리셋 {library.myPresets.length}개</summary>
                      <ul className="list" style={{ padding: 0 }}>
                        {library.myPresets.map((m) => (
                          <li key={m.id} className="list-item" style={{ cursor: 'default' }}>
                            <span className="mono ellipsis">{m.checkpoint}</span>
                            <span className="meta">
                              <button
                                className="btn small ghost"
                                onClick={() => update((d) => void (d.checkpoint = m.checkpoint))}
                                title="이 체크포인트로 바꾸기"
                              >
                                쓰기
                              </button>
                              <button className="btn small ghost danger" onClick={() => confirm('이 내 프리셋을 지울까요?') && deleteMyPreset(m.id)}>
                                삭제
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              </Field>
            </div>
          </div>

          <ComfyPanel />
          <ProjectPanel />
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>전역 설정</h3>
            <span className="small muted">모든 줄의 기본값. 그룹·장면에서 덮어쓸 수 있습니다.</span>
          </div>
          <div className="panel-body">
            <SettingsEditor target={{ level: 'global' }} layer={project.settings} />
            <div className="bundle">
              <div className="bundle-head">
                <h4>생성 옵션</h4>
              </div>
              <div className="bundle-body">
                <Field
                  label="대상 아닌 줄도 넣기"
                  help="이미 확정·완성됐거나 꺼진 줄도 워크플로우에 넣되 SaveImage만 mute합니다. ComfyUI가 계산하지 않고, 필요하면 Ctrl+M으로 다시 켤 수 있습니다. 기본은 넣지 않음."
                >
                  <Check
                    checked={project.generate.includeNonTarget}
                    onChange={(v) => update((d) => void (d.generate.includeNonTarget = v))}
                    label="넣기 (저장 노드 꺼 둠)"
                  />
                </Field>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PresetTable({ id, onChange }: { id: FamilyId; onChange: (id: FamilyId) => void }) {
  const p = getPreset(id);
  const rows: Array<[string, string]> = [
    ['해상도 목록', p.resolutions.map(([w, h]) => `${w}×${h}`).join(', ')],
    ['기본 해상도', `${p.generation.width}×${p.generation.height}`],
    ['steps / cfg', `${p.generation.steps} / ${p.generation.cfg}`],
    ['샘플러 / 스케줄러', `${p.generation.sampler} / ${p.generation.scheduler}`],
    ['구도 맞추기 샘플러', `${p.matchComposition.sampler} / ${p.matchComposition.scheduler}`],
    ['CLIP skip', String(p.model.clipSkip)],
    ['v-pred / zsnr', `${p.model.vpred ? '켬' : '끔'} / ${p.model.zsnr ? '켬' : '끔'}`],
    ['RescaleCFG', p.model.rescaleCfg ? String(p.model.rescaleCfg) : '없음'],
    ['품질 태그', p.prompt.qualityTags || '없음'],
    ['기본 네거티브', p.prompt.defaultNegative || '없음'],
    ['조합 순서', p.prompt.order.join(' → ')],
    ['고화질 단계', `${p.hires.method} ×${p.hires.scale}, denoise ${p.hires.denoise}, ${p.hires.steps} steps`],
  ];
  return (
    <div className="callout" style={{ margin: '8px 0' }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <select className="select" style={{ maxWidth: 240 }} value={id} onChange={(e) => onChange(e.target.value as FamilyId)}>
          {PRESETS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
      </div>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <F2 key={k} k={k} v={v} />
        ))}
      </dl>
      <div className="small" style={{ marginTop: 8 }}>
        출처:{' '}
        {p.sources.map((s, i) => (
          <span key={s}>
            {i > 0 && ', '}
            <a href={s} target="_blank" rel="noreferrer">
              {new URL(s).hostname}
            </a>
          </span>
        ))}
      </div>
      <div className="small faint" style={{ marginTop: 4 }}>
        프리셋은 src/lib/presets.ts 파일 하나에 모여 있어 쉽게 고칠 수 있습니다.
      </div>
    </div>
  );
}

function F2({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

function ComfyPanel() {
  const url = useStore((s) => s.comfyUrl);
  const comfy = useStore((s) => s.comfy);
  const status = useStore((s) => s.comfyStatus);
  const [text, setText] = useState(url);
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>ComfyUI 연결 (선택)</h3>
        {status.state === 'ok' && <span className="badge ok">연결됨</span>}
        {status.state === 'error' && <span className="badge err">연결 안 됨</span>}
        {status.state !== 'ok' && comfy && <span className="badge">캐시된 목록 사용 중</span>}
      </div>
      <div className="panel-body">
        <p className="small muted" style={{ marginTop: 0 }}>
          연결하면 체크포인트·로라·샘플러·스케줄러·업스케일 모델 목록을 드롭다운으로 고를 수 있습니다. 연결이 안 돼도 직접 입력해서 쓸 수 있습니다.
        </p>
        <div className="row">
          <TextInput mono value={text} placeholder={DEFAULT_COMFY_URL} onChange={setText} />
          <button className="btn primary" disabled={status.state === 'loading'} onClick={() => connectComfy(text)}>
            {status.state === 'loading' ? '연결 중…' : '목록 받기'}
          </button>
        </div>
        {status.message && <div className={status.state === 'error' ? 'inline-err' : 'small muted'} style={{ marginTop: 6 }}>{status.message}</div>}
        <div className="callout small" style={{ marginTop: 10 }}>
          <strong>연결하려면 ComfyUI를 --enable-cors-header 옵션으로 실행해야 합니다.</strong>
          <ul>
            <li>
              직접 실행: <span className="mono">python main.py --enable-cors-header</span>
            </li>
            <li>
              Windows 포터블: <span className="mono">run_nvidia_gpu.bat</span> 끝에 <span className="mono">--enable-cors-header</span>를 붙입니다.
            </li>
            <li>
              Desktop 앱: 설정 → 서버 설정에서 CORS 헤더 항목을 켭니다 (버전에 따라 이름이 다를 수 있습니다).
            </li>
          </ul>
        </div>
        {comfy && (
          <div className="small muted" style={{ marginTop: 8 }}>
            캐시: {comfy.url} · {new Date(comfy.fetchedAt).toLocaleString('ko-KR')} · 체크포인트 {comfy.checkpoints.length} · 로라 {comfy.loras.length} · 업스케일{' '}
            {comfy.upscaleModels.length} · 노드 {comfy.nodeTypes.length}
            <button className="btn small ghost" onClick={() => useStore.setState({ comfy: null, comfyStatus: { state: 'idle' } })}>
              캐시 지우기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectPanel() {
  const library = useStore((s) => s.library);
  const toast = useStore((s) => s.toast);
  const saveError = useStore((s) => s.saveError);
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>파일 · 라이브러리</h3>
      </div>
      <div className="panel-body">
        <p className="small muted" style={{ marginTop: 0 }}>
          작업은 자동으로 저장됩니다. 다른 컴퓨터로 옮기거나 보관하려면 파일로 저장하세요. 완성 이미지 원본은 이 브라우저에만 보관되므로 zip으로 내려받아 두세요.
        </p>
        {saveError && <div className="issue warn">{saveError}</div>}
        <div className="btn-row">
          <button className="btn" onClick={() => void saveProject()}>
            파일 저장
          </button>
          <button className="btn" onClick={() => void saveProject({ saveAs: true })}>
            다른 이름으로 저장
          </button>
          <button className="btn" onClick={() => void openProject()}>
            파일 열기
          </button>
          <button className="btn" onClick={startNewProject}>
            새 파일
          </button>
          <button className="btn ghost" onClick={() => confirm('지금 프로젝트를 예시 프로젝트로 바꿉니다. (실행 취소 가능)') && startExample()}>
            예시 프로젝트
          </button>
        </div>
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button
            className="btn small"
            onClick={() =>
              void saveFile(
                { description: '라이브러리 파일', mime: 'application/json', ext: '.json', suggestedName: `asset-tool-library-${stamp()}.json` },
                () => jsonBlob(library),
              )
            }
          >
            라이브러리(내 세트·내 프리셋) 내보내기
          </button>
          <button
            className="btn small"
            onClick={async () => {
              const [f] = await pickFiles('.json,application/json');
              if (!f) return;
              try {
                const lib = JSON.parse(await f.text()) as Partial<Library>;
                useStore.getState().updateLibrary((l) => {
                  for (const s of lib.sets ?? []) if (!l.sets.some((x) => x.id === s.id)) l.sets.push(s);
                  for (const m of lib.myPresets ?? []) if (!l.myPresets.some((x) => x.id === m.id)) l.myPresets.push(m);
                });
                toast('라이브러리를 합쳤습니다.', 'ok');
              } catch (e) {
                toast(`읽지 못했습니다: ${(e as Error).message}`, 'error');
              }
            }}
          >
            라이브러리 가져오기
          </button>
        </div>
      </div>
    </div>
  );
}
