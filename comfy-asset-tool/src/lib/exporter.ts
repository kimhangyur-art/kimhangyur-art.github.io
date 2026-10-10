// 완성 이미지를 내보내기 이름 규칙대로 바꿔 zip으로 묶는다.
// 목적: ComfyUI가 붙이는 _00001_ 같은 번호를 떼고 {캐릭터}/{장면코드}.png 처럼 정리.

import JSZip from 'jszip';
import { listRows, rowTitle } from './model';
import { resolvePattern } from './paths';
import { resolveSettings } from './settings';
import type { Library, Project } from './types';

export interface ExportEntry {
  key: string;
  title: string;
  /** zip 안의 경로 */
  path: string;
  available: boolean;
  sourceName: string | null;
}

export function exportPath(pattern: string, ctx: Parameters<typeof resolvePattern>[1]): string {
  const p = resolvePattern(pattern, ctx).prefix.replace(/%[^%]*%/g, '');
  return /\.png$/i.test(p) ? p : `${p}.png`;
}

/** 완성된 줄의 내보내기 목록. 이름이 겹치면 뒤에 _2, _3을 붙인다. */
export function exportList(project: Project, library: Library, available: Set<string>): ExportEntry[] {
  const out: ExportEntry[] = [];
  const used = new Map<string, number>();
  for (const info of listRows(project)) {
    if (info.row.status !== 'done') continue;
    const settings = resolveSettings({ project, library, group: info.group, scene: info.scene });
    let path = exportPath(settings.values.output.exportPattern, info);
    const k = path.toLowerCase();
    const n = (used.get(k) ?? 0) + 1;
    used.set(k, n);
    if (n > 1) path = path.replace(/\.png$/i, `_${n}.png`);
    out.push({
      key: info.key,
      title: rowTitle(info.scene, info.char),
      path,
      available: available.has(info.key),
      sourceName: info.row.finalFile ?? null,
    });
  }
  return out;
}

export async function makeZip(files: Array<{ path: string; data: Blob | Uint8Array }>): Promise<Blob> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.path, f.data);
  // PNG는 이미 압축돼 있어서 다시 압축하지 않는다(빠르다).
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}
