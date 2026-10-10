// 작업 파일 저장·열기. 한 번 저장하거나 연 파일은 기억해 두었다가 [파일 저장] 때 같은 파일에 덮어쓴다.

import { PROJECT_FILE, jsonBlob, openFile, safeFileName, saveFile, writeHandle, type FileHandle } from '../lib/download';
import { normalizeProject } from '../lib/model';
import { refreshFinals } from './actions';
import { flushSave, useStore } from './store';

let current: { projectId: string; handle: FileHandle } | null = null;

export async function saveProject(opts: { saveAs?: boolean } = {}): Promise<boolean> {
  const { project, toast } = useStore.getState();
  flushSave();
  try {
    if (!opts.saveAs && current && current.projectId === project.id) {
      await writeHandle(current.handle, jsonBlob(project));
      toast(`저장했습니다: ${current.handle.name}`, 'ok');
      return true;
    }
    const r = await saveFile({ ...PROJECT_FILE, suggestedName: `${safeFileName(project.name)}.json` }, () => jsonBlob(project));
    if (r.status === 'cancelled') return false;
    if (r.status === 'saved') current = { projectId: project.id, handle: r.handle };
    toast(r.status === 'saved' ? `저장했습니다: ${r.name}` : `다운로드 폴더에 저장했습니다: ${r.name}`, 'ok');
    return true;
  } catch (e) {
    toast(`저장하지 못했습니다: ${(e as Error).message}`, 'error');
    return false;
  }
}

export async function openProject(): Promise<boolean> {
  const { toast, replaceProject } = useStore.getState();
  const picked = await openFile(PROJECT_FILE);
  if (!picked) return false;
  try {
    const p = normalizeProject(JSON.parse(await picked.file.text()));
    replaceProject(p);
    current = picked.handle ? { projectId: p.id, handle: picked.handle } : null;
    void refreshFinals();
    toast(`"${p.name}"을(를) 열었습니다.`, 'ok');
    return true;
  } catch (e) {
    toast(`파일을 열지 못했습니다: ${(e as Error).message}`, 'error');
    return false;
  }
}

/** 새 파일을 만들면 기억해 둔 파일을 잊는다 */
export function forgetProjectFile() {
  current = null;
}
