// 파일 저장·열기.
// Edge·Chrome에서는 Windows의 "다른 이름으로 저장 / 열기" 창을 쓴다(File System Access API).
// 그 기능이 없는 브라우저에서는 다운로드 폴더로 내려받고, 파일 고르기 창으로 연다.

export interface SaveTarget {
  /** 저장 창에 미리 적어 둘 이름 */
  suggestedName: string;
  /** 저장 창의 파일 종류 설명 */
  description: string;
  mime: string;
  ext: string;
}

export type SaveResult = { status: 'saved'; name: string; handle: FileHandle } | { status: 'downloaded'; name: string } | { status: 'cancelled' };

/** File System Access API에서 쓰는 만큼만 적은 타입 */
export interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  queryPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
}

type PickerWindow = Window & {
  showSaveFilePicker?: (o: unknown) => Promise<FileHandle>;
  showOpenFilePicker?: (o: unknown) => Promise<FileHandle[]>;
};

export function hasFilePicker(): boolean {
  return typeof (window as PickerWindow).showSaveFilePicker === 'function';
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

/** 저장 창을 먼저 띄우고(누른 직후여야 열린다), 그다음 내용을 만들어 쓴다 */
export async function saveFile(target: SaveTarget, produce: () => Blob | Promise<Blob>): Promise<SaveResult> {
  const w = window as PickerWindow;
  if (w.showSaveFilePicker) {
    let handle: FileHandle | null = null;
    try {
      handle = await w.showSaveFilePicker({
        suggestedName: target.suggestedName,
        types: [{ description: target.description, accept: { [target.mime]: [target.ext] } }],
      });
    } catch (e) {
      if (isAbort(e)) return { status: 'cancelled' };
      handle = null; // 저장 창을 못 띄우면 내려받기로
    }
    if (handle) {
      await writeHandle(handle, await produce());
      return { status: 'saved', name: handle.name, handle };
    }
  }
  const blob = await produce();
  downloadBlob(blob, target.suggestedName);
  return { status: 'downloaded', name: target.suggestedName };
}

/** 이미 정해 둔 파일에 덮어쓴다 */
export async function writeHandle(handle: FileHandle, blob: Blob): Promise<void> {
  if (handle.queryPermission && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    const p = await handle.requestPermission?.({ mode: 'readwrite' });
    if (p !== 'granted') throw new Error('파일에 쓸 권한이 없습니다.');
  }
  const ws = await handle.createWritable();
  await ws.write(blob);
  await ws.close();
}

/** 파일 열기 창. 가능하면 다시 저장할 수 있게 파일 핸들도 돌려준다. */
export async function openFile(accept: { description: string; mime: string; ext: string }): Promise<{ file: File; handle: FileHandle | null } | null> {
  const w = window as PickerWindow;
  if (w.showOpenFilePicker) {
    try {
      const [h] = await w.showOpenFilePicker({ types: [{ description: accept.description, accept: { [accept.mime]: [accept.ext] } }] });
      return h ? { file: await h.getFile(), handle: h } : null;
    } catch (e) {
      if (isAbort(e)) return null;
    }
  }
  const [file] = await pickFiles(`${accept.ext},${accept.mime}`);
  return file ? { file, handle: null } : null;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function jsonBlob(data: unknown): Blob {
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(input.files ? [...input.files] : []);
    input.click();
  });
}

export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'project';
}

export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export const PROJECT_FILE = { description: '캐릭터 에셋 공방 작업 파일', mime: 'application/json', ext: '.json' };
export const WORKFLOW_FILE = { description: 'ComfyUI 워크플로우 (JSON)', mime: 'application/json', ext: '.json' };
export const ZIP_FILE = { description: 'zip 압축 파일', mime: 'application/zip', ext: '.zip' };
