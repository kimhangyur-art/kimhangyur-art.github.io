import { useEffect, useState, type ReactNode } from 'react';
import { viewUrlFileName } from './lib/comfyApi';
import { processDroppedFiles, refreshFinals } from './store/actions';
import { saveProject } from './store/projectFile';
import { flushSave, useStore, type TabId } from './store/store';
import { CharactersScreen } from './ui/screens/CharactersScreen';
import { ConfirmScreen } from './ui/screens/ConfirmScreen';
import { ElementsScreen } from './ui/screens/ElementsScreen';
import { GenerateScreen } from './ui/screens/GenerateScreen';
import { ProgressScreen } from './ui/screens/ProgressScreen';
import { ScenesScreen } from './ui/screens/ScenesScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { StartScreen } from './ui/screens/StartScreen';
import { TableScreen } from './ui/screens/TableScreen';

const NAV: Array<{ section: string; items: Array<{ id: TabId; label: string; step?: number }> }> = [
  {
    section: '1 · 준비',
    items: [
      { id: 'characters', label: '캐릭터' },
      { id: 'scenes', label: '장면' },
      { id: 'elements', label: '요소' },
      { id: 'table', label: '표 보기' },
    ],
  },
  {
    section: '2 · 진행',
    items: [
      { id: 'generate', label: '생성', step: 1 },
      { id: 'confirm', label: '확정·내보내기', step: 2 },
      { id: 'progress', label: '진행 현황' },
    ],
  },
  { section: '3 · 설정', items: [{ id: 'settings', label: '설정' }] },
];

const SCREENS: Record<TabId, () => ReactNode> = {
  characters: () => <CharactersScreen />,
  scenes: () => <ScenesScreen />,
  elements: () => <ElementsScreen />,
  table: () => <TableScreen />,
  progress: () => <ProgressScreen />,
  settings: () => <SettingsScreen />,
  generate: () => <GenerateScreen />,
  confirm: () => <ConfirmScreen />,
};

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function App() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  const comfyState = useStore((s) => s.comfyStatus.state);
  const hasComfy = useStore((s) => !!s.comfy);
  const saveError = useStore((s) => s.saveError);
  const [dragging, setDragging] = useState(false);
  // 프로그램을 켤 때마다 처음 화면을 보여 준다 (같은 창에서 새로고침하면 다시 보이지 않음)
  const [showStart, setShowStart] = useState(() => {
    try {
      return sessionStorage.getItem('comfy-asset-tool.started') !== '1';
    } catch {
      return true;
    }
  });
  const closeStart = () => {
    try {
      sessionStorage.setItem('comfy-asset-tool.started', '1');
    } catch {
      /* 무시 */
    }
    setShowStart(false);
  };

  useEffect(() => {
    void refreshFinals();
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        useStore.getState().undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        useStore.getState().redo();
      } else if (k === 's') {
        e.preventDefault();
        void saveProject();
      }
    };
    const onUnload = () => flushSave();
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  // 어느 화면에서든 PNG를 끌어다 놓을 수 있다
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].some((t) => t === 'Files' || t === 'text/uri-list');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = async (e: DragEvent) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = [...e.dataTransfer.files];
      if (files.length) {
        useStore.getState().setTab('confirm');
        await processDroppedFiles(files);
        return;
      }
      // ComfyUI 화면에서 끌어 온 이미지 (/view?filename=...)
      const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      const name = uri ? viewUrlFileName(uri.split('\n')[0].trim()) : null;
      if (!name) return;
      try {
        const res = await fetch(uri.split('\n')[0].trim());
        const blob = await res.blob();
        useStore.getState().setTab('confirm');
        await processDroppedFiles([new File([blob], name, { type: 'image/png' })]);
      } catch {
        useStore.getState().toast('ComfyUI 화면의 이미지를 받아오지 못했습니다. --enable-cors-header로 실행했는지 확인하거나, 파일로 저장해 끌어다 놓으세요.', 'error');
      }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const counts: Partial<Record<TabId, string>> = {
    characters: String(project.characters.length),
    scenes: String(project.scenes.length),
    elements: String(project.elements.length),
    generate: `${project.rows.filter((r) => r.status === 'pending').length}`,
    progress: `${project.rows.filter((r) => r.status === 'done').length}/${project.rows.length}`,
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          캐릭터 에셋 공방<small>ComfyUI 보조</small>
        </span>
        <button className="btn ghost" onClick={() => setShowStart(true)} title="새 파일 만들기 · 파일 열기">
          처음 화면
        </button>
        <input
          className="project-name"
          value={project.name}
          title="작업 이름"
          onChange={(e) => update((d) => void (d.name = e.target.value), 'project-name')}
        />
        <span className="spacer" />
        {saveError && (
          <span className="badge warn" title={saveError}>
            자동 저장 실패
          </span>
        )}
        <span className={`badge ${comfyState === 'ok' ? 'ok' : comfyState === 'error' ? 'err' : ''}`} title="ComfyUI 연결 상태 (설정 화면)">
          ComfyUI {comfyState === 'ok' ? '연결됨' : comfyState === 'error' ? '연결 안 됨' : hasComfy ? '캐시' : '미연결'}
        </span>
        <button className="btn ghost" disabled={!canUndo} onClick={undo} title="실행 취소 (Ctrl+Z)">
          ↶ 실행 취소
        </button>
        <button className="btn ghost" disabled={!canRedo} onClick={redo} title="다시 실행 (Ctrl+Shift+Z)">
          ↷ 다시 실행
        </button>
        <button
          className="btn"
          title="작업을 파일로 저장 (Ctrl+S)"
          onClick={() => void saveProject()}
        >
          파일 저장
        </button>
      </header>
      <div className="body">
        <nav className="nav">
          {NAV.map((sec) => (
            <div key={sec.section}>
              <h4>{sec.section}</h4>
              {sec.items.map((it) => (
                <button
                  key={it.id}
                  className={tab === it.id && !showStart ? 'active' : ''}
                  onClick={() => {
                    setTab(it.id);
                    closeStart();
                  }}
                >
                  {it.step && <span className="step">{it.step}</span>}
                  {it.label}
                  {counts[it.id] && <span className="count">{counts[it.id]}</span>}
                </button>
              ))}
            </div>
          ))}
          <div className="small faint" style={{ padding: '18px 10px 0' }}>
            흐름: 준비 → 초안 생성 → PNG 확정 → (반복) → 마무리 생성 → 완성 PNG → zip
          </div>
        </nav>
        <main className="main">{showStart ? <StartScreen onClose={closeStart} /> : SCREENS[tab]()}</main>
      </div>
      {dragging && (
        <div className="drop-overlay">
          <div>PNG를 놓으면 확정/완성 처리합니다</div>
        </div>
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.level}`} onClick={() => dismiss(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
