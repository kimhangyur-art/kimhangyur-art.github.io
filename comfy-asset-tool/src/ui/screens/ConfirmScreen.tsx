import { useEffect, useMemo, useState } from 'react';
import { ZIP_FILE, pickFiles, safeFileName, saveFile, stamp } from '../../lib/download';
import { exportList, makeZip } from '../../lib/exporter';
import { listRows, rowTitle } from '../../lib/model';
import { resolveSettings } from '../../lib/settings';
import { answerQuestion, assignDropManually, processDroppedFiles, setSettingValue, unconfirmRow, undoDone } from '../../store/actions';
import { fileKey, getFile } from '../../store/blobStore';
import { useStore, type DropItem } from '../../store/store';
import { Empty, IssueList, TextInput } from '../common';

export function ConfirmScreen() {
  const drops = useStore((s) => s.drops);
  const questions = useStore((s) => s.questions);
  const [over, setOver] = useState(false);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>확정 · 내보내기</h2>
          <p>
            ComfyUI가 저장한 PNG를 끌어다 놓으면 파일 이름으로 줄을 찾고, PNG의 실행 정보에서 시드를 읽어 고정합니다. 초안 이미지는 "확정", 마무리 이미지는 "완성"이 됩니다.
            (어느 화면에서든 끌어다 놓을 수 있습니다.)
          </p>
        </div>
      </div>

      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onClick={async () => {
          const files = await pickFiles('image/png', true);
          if (files.length) void processDroppedFiles(files);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={() => setOver(false)}
      >
        <strong>여기에 PNG를 끌어다 놓으세요 (여러 장 가능)</strong>
        또는 눌러서 파일 고르기 · 초안 이름 예) hex_E01_00003_.png · 마무리 이름 예) hex_E01_final_00001_.png
      </div>

      {questions.length > 0 && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="panel-head">
            <h3>구도 맞추기 시드 적용</h3>
          </div>
          <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
            {questions.map((q) => (
              <QuestionCard key={q.id} id={q.id} />
            ))}
          </div>
        </div>
      )}

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <h3>처리 결과</h3>
          <div className="actions">
            {drops.length > 0 && (
              <button className="btn small ghost" onClick={() => useStore.setState({ drops: [] })}>
                목록 비우기
              </button>
            )}
          </div>
        </div>
        {drops.length === 0 ? <Empty>아직 끌어다 놓은 파일이 없습니다.</Empty> : drops.map((d) => <DropResult key={d.id} item={d} />)}
      </div>

      <ExportPanel />
    </div>
  );
}

function QuestionCard({ id }: { id: string }) {
  const q = useStore((s) => s.questions.find((x) => x.id === id));
  const project = useStore((s) => s.project);
  if (!q) return null;
  const g = project.groups.find((x) => x.id === q.groupId);
  const c = project.characters.find((x) => x.id === q.charId);
  return (
    <div className="callout accent">
      <div>
        <b>{q.sourceTitle}</b>을(를) 시드 <span className="mono">{q.seed}</span>로 확정했습니다. 구도 맞추기 그룹 <b>{g?.name}</b>의 {c?.name} 미정 줄 {q.keys.length}개에도 이
        시드를 적용할까요?
      </div>
      <div className="small muted" style={{ margin: '4px 0 8px' }}>
        적용하면 그 줄들은 시드가 고정되어 초안을 다시 실행해도 같은 구도로 나옵니다. 마음에 안 드는 장면은 [진행 현황]에서 개별로 고정을 풀어 다시 뽑으세요.
      </div>
      <div className="btn-row">
        <button className="btn primary small" onClick={() => answerQuestion(q.id, true)}>
          그룹 전체에 적용
        </button>
        <button className="btn small" onClick={() => answerQuestion(q.id, false)}>
          이 줄만
        </button>
      </div>
    </div>
  );
}

function useObjectUrl(file: File): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

function DropResult({ item }: { item: DropItem }) {
  const project = useStore((s) => s.project);
  const a = item.analysis;
  const url = useObjectUrl(item.file);
  const [choice, setChoice] = useState(a.candidates[0] ? `${a.candidates[0].key}::${a.candidates[0].stage}` : '');
  const rows = useMemo(() => listRows(project), [project]);
  const outcome = {
    confirmed: <span className="badge st-confirmed">확정</span>,
    done: <span className="badge st-done">완성</span>,
    failed: <span className="badge err">실패</span>,
    'needs-choice': <span className="badge warn">줄을 골라 주세요</span>,
  }[item.outcome];
  const applied = item.outcome === 'confirmed' || item.outcome === 'done';
  return (
    <div className="drop-result">
      {url ? <img className="thumb" src={url} alt="" /> : <div className="thumb" />}
      <div style={{ minWidth: 0 }}>
        <div className="row wrap">
          {outcome}
          <span className="mono ellipsis">{a.fileName}</span>
        </div>
        {a.title && (
          <div className="small">
            → <b>{a.title}</b> ({a.stage === 'final' ? '마무리 이미지' : '초안 이미지'})
            {a.seed != null && (
              <>
                {' '}
                · 시드 <span className="mono">{a.seed}</span>
                {a.trace && a.trace.seedPath.length > 1 && <span className="faint"> (연결된 노드에서 읽음)</span>}
              </>
            )}
          </div>
        )}
        {a.reason && <div className="inline-warn">{a.reason}</div>}
        {a.seedProblem && <div className="inline-warn">{a.seedProblem}</div>}
        {item.note && <div className="small muted">{item.note}</div>}
        <IssueList issues={a.issues} />
        {!applied && (
          <div className="row wrap" style={{ marginTop: 6 }}>
            <select className="select" style={{ maxWidth: 360 }} value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">줄 직접 고르기…</option>
              {rows.map((r) => (
                <optgroup key={r.key} label={rowTitle(r.scene, r.char)}>
                  <option value={`${r.key}::draft`}>{rowTitle(r.scene, r.char)} · 초안(확정)</option>
                  <option value={`${r.key}::final`}>{rowTitle(r.scene, r.char)} · 마무리(완성)</option>
                </optgroup>
              ))}
            </select>
            <button
              className="btn small primary"
              disabled={!choice}
              onClick={() => {
                const [key, stage] = choice.split('::');
                void assignDropManually(item.id, key, stage as 'draft' | 'final');
              }}
            >
              이 줄에 적용
            </button>
          </div>
        )}
      </div>
      <div className="btn-row">
        {applied && a.key && item.outcome === 'confirmed' && (
          <button className="btn small ghost" onClick={() => unconfirmRow(a.key!, false)}>
            확정 해제
          </button>
        )}
        {applied && a.key && item.outcome === 'done' && (
          <button className="btn small ghost" onClick={() => undoDone(a.key!)}>
            완성 취소
          </button>
        )}
      </div>
    </div>
  );
}

function ExportPanel() {
  const project = useStore((s) => s.project);
  const library = useStore((s) => s.library);
  const finals = useStore((s) => s.finals);
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const list = exportList(project, library, finals);
  const ready = list.filter((e) => e.available);
  const pattern = resolveSettings({ project, library }, 'global').values.output.exportPattern;
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>내보내기</h3>
        <span className="small muted">
          완성 {list.length}장 · 파일 있음 {ready.length}장
        </span>
        <div className="actions">
          <button
            className="btn primary"
            disabled={!ready.length || busy}
            onClick={async () => {
              setBusy(true);
              try {
                let count = 0;
                const r = await saveFile({ ...ZIP_FILE, suggestedName: `${safeFileName(project.name)}_assets_${stamp()}.zip` }, async () => {
                  const files: Array<{ path: string; data: Blob }> = [];
                  for (const e of ready) {
                    const f = await getFile(fileKey(project.id, e.key));
                    if (f) files.push({ path: e.path, data: f.blob });
                  }
                  count = files.length;
                  return makeZip(files);
                });
                if (r.status !== 'cancelled') toast(`${count}장을 zip으로 저장했습니다: ${r.name}`, 'ok');
              } catch (e) {
                toast(`zip을 만들지 못했습니다: ${(e as Error).message}`, 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '만드는 중…' : `zip 내려받기 (${ready.length}장)`}
          </button>
        </div>
      </div>
      <div className="panel-body">
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="small muted nowrap">이름 규칙</span>
          <TextInput mono value={pattern} onChange={(v) => setSettingValue({ level: 'global' }, 'output', { exportPattern: v })} />
        </div>
        <div className="small faint" style={{ marginBottom: 8 }}>
          토큰: {'{캐릭터} {장면코드} {장면이름} {그룹}'} · ComfyUI가 붙인 _00001_ 번호는 떼고 이 규칙대로 이름을 바꿉니다. 완성 이미지 원본은 이 브라우저(IndexedDB)에만
          보관되므로, 다른 브라우저에서는 마무리 PNG를 다시 끌어다 놓아야 합니다.
        </div>
        {list.length === 0 ? (
          <Empty>완성된 줄이 없습니다. 마무리 워크플로우로 만든 PNG를 끌어다 놓으세요.</Empty>
        ) : (
          <table className="plain">
            <thead>
              <tr>
                <th>줄</th>
                <th>zip 안 이름</th>
                <th>원본 파일</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.key} className={e.available ? '' : 'skip'}>
                  <td>{e.title}</td>
                  <td className="mono">{e.path}</td>
                  <td className="mono">{e.sourceName ?? '-'}</td>
                  <td>{e.available ? <span className="badge ok">있음</span> : <span className="badge warn">다시 끌어다 놓기 필요</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
