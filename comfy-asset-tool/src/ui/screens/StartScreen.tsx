// 처음 화면: 새 파일 만들기 / 파일 열기 / 이어서 작업 + 사용 순서 안내

import { useState } from 'react';
import { newProject } from '../../lib/model';
import { refreshFinals, startExample } from '../../store/actions';
import { openProject, saveProject } from '../../store/projectFile';
import { useStore } from '../../store/store';

export function StartScreen({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const replaceProject = useStore((s) => s.replaceProject);
  const setTab = useStore((s) => s.setTab);
  const [name, setName] = useState('새 작업');
  const [askSave, setAskSave] = useState(false);
  const hasWork = project.characters.length > 0 || project.scenes.length > 0;

  const create = async (saveFirst: boolean) => {
    if (saveFirst && !(await saveProject())) return;
    const p = newProject(name.trim() || '새 작업');
    p.checkpoint = project.checkpoint;
    p.family = project.family;
    replaceProject(p);
    void refreshFinals();
    setTab('characters');
    onClose();
  };

  const open = async () => {
    if (await openProject()) onClose();
  };

  return (
    <div className="start">
      <div className="start-inner">
        <h1>캐릭터 에셋 공방</h1>
        <p className="muted">
          캐릭터별 표정·상황 이미지를 ComfyUI로 한꺼번에 뽑기 위한 프로그램입니다. 여기서 캐릭터와 장면을 만들고 <b>ComfyUI용 JSON</b>으로 내보내면, ComfyUI에서는 열고
          실행만 하면 됩니다.
        </p>

        <div className="start-cards">
          <div className="start-card primary">
            <h3>새 파일 만들기</h3>
            <p className="small muted">빈 작업에서 시작합니다.</p>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="작업 이름" />
            {askSave ? (
              <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                <div className="small">지금 작업("{project.name}")을 파일로 저장해 두지 않으면 사라집니다.</div>
                <button className="btn primary" onClick={() => void create(true)}>
                  지금 작업 저장하고 새로 만들기
                </button>
                <button className="btn" onClick={() => void create(false)}>
                  저장하지 않고 새로 만들기
                </button>
              </div>
            ) : (
              <button className="btn primary big" style={{ marginTop: 8 }} onClick={() => (hasWork ? setAskSave(true) : void create(false))}>
                만들기
              </button>
            )}
          </div>

          <div className="start-card">
            <h3>파일 열기</h3>
            <p className="small muted">[파일 저장]으로 저장해 둔 작업 파일(.json)을 엽니다.</p>
            <button className="btn big" onClick={open}>
              파일 고르기…
            </button>
          </div>

          {hasWork && (
            <div className="start-card">
              <h3>이어서 작업</h3>
              <p className="small muted">
                <b>{project.name}</b> · 캐릭터 {project.characters.length} · 장면 {project.scenes.length}
                <br />
                마지막 수정 {new Date(project.updatedAt).toLocaleString('ko-KR')}
              </p>
              <button className="btn big" onClick={onClose}>
                이어서 하기
              </button>
            </div>
          )}

          <div className="start-card">
            <h3>예시로 둘러보기</h3>
            <p className="small muted">캐릭터 1명과 표정 12종이 들어 있는 예시로 시작합니다.</p>
            <button
              className="btn big"
              onClick={() => {
                if (hasWork && !confirm('지금 작업 대신 예시를 엽니다. 지금 작업은 파일로 저장해 두지 않으면 사라집니다.')) return;
                startExample();
                onClose();
              }}
            >
              예시 열기
            </button>
          </div>
        </div>

        <div className="callout" style={{ marginTop: 22 }}>
          <strong>사용 순서</strong>
          <ol>
            <li>
              <b>설정</b>: 체크포인트(모델) 파일 이름을 적습니다. ComfyUI의 <span className="mono">models/checkpoints</span> 폴더에 있는 파일 이름입니다. 모델 종류에 맞는 권장
              설정이 자동으로 들어갑니다.
            </li>
            <li>
              <b>캐릭터</b>: 캐릭터를 추가하고 생김새를 영어 태그로 적습니다. [세트 적용]을 누르면 표정 12종 같은 장면 묶음이 한 번에 들어갑니다.
            </li>
            <li>
              <b>장면 · 요소</b>: 장면을 더하거나 고치고, 의상·배경 같은 반복 문구(조각), 장면별 세부 설정, 주석을 답니다.
            </li>
            <li>
              <b>생성</b>: [ComfyUI용 JSON 내보내기]를 누릅니다. 받은 JSON 파일을 ComfyUI 창에 끌어다 놓고 실행(Run / Queue) 버튼을 누르면 장면마다 이미지가 저장됩니다.
            </li>
            <li>
              <b>(선택) 확정 · 마무리</b>: 마음에 드는 PNG를 이 프로그램에 끌어다 놓으면 그 그림이 고정됩니다. 다 고르면 [생성 → 마무리]로 같은 그림을 고화질로 다시 뽑고,
              [확정·내보내기]에서 이름을 정리해 zip으로 받습니다.
            </li>
          </ol>
          <div className="small faint" style={{ marginTop: 6 }}>
            작업은 자동으로 저장됩니다. 보관하거나 다른 컴퓨터로 옮기려면 위쪽의 [파일 저장]을 쓰세요.
          </div>
        </div>
      </div>
    </div>
  );
}
