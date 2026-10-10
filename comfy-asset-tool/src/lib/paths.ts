// 저장 경로·파일 이름 규칙
//
// - SaveImage의 filename_prefix에 실제 경로를 쓴다 (ComfyUI output 폴더 기준).
// - 패턴 토큰: {캐릭터} {장면코드} {장면이름} {그룹}  (영문 별칭 {char} {code} {scene} {group})
// - %date:yyyy-MM-dd% 같은 ComfyUI 토큰은 그대로 둔다.
// - ComfyUI는 "<prefix>_00001_.png"로 저장한다 (folder_paths.get_save_image_path, SaveImage).
// - 끌어다 놓을 때 파일 이름으로 줄을 찾으므로 경로의 마지막 부분이 줄마다 달라야 한다.

import type { Character, Issue, Scene, SceneGroup } from './types';

export interface PathContext {
  char: Pick<Character, 'fileId' | 'name'>;
  scene: Pick<Scene, 'code' | 'name'>;
  group: Pick<SceneGroup, 'name'>;
}

const TOKENS: Record<string, (c: PathContext) => string> = {
  캐릭터: (c) => c.char.fileId || c.char.name,
  char: (c) => c.char.fileId || c.char.name,
  장면코드: (c) => c.scene.code || c.scene.name,
  code: (c) => c.scene.code || c.scene.name,
  장면이름: (c) => c.scene.name || c.scene.code,
  scene: (c) => c.scene.name || c.scene.code,
  그룹: (c) => c.group.name,
  group: (c) => c.group.name,
};

export const TOKEN_HELP = '{캐릭터} {장면코드} {장면이름} {그룹}';

/** 파일·폴더 이름에 쓸 수 없는 글자를 바꾼다 */
export function sanitizeSegment(s: string): string {
  const out = s
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/%/g, '_')
    .trim()
    .replace(/[. ]+$/g, '');
  return out || '_';
}

export interface ResolvedPath {
  /** 토큰을 바꾼 전체 경로 (SaveImage filename_prefix) */
  prefix: string;
  /** 마지막 부분 (파일 이름) */
  fileName: string;
  issues: Issue[];
}

/** 패턴의 {토큰}을 바꾸고 경로 모양을 정리한다. ComfyUI의 %...% 토큰은 건드리지 않는다. */
export function resolvePattern(pattern: string, ctx: PathContext): ResolvedPath {
  const issues: Issue[] = [];
  let p = pattern.replace(/\\/g, '/');
  p = p.replace(/\{([^{}]+)\}/g, (m, name: string) => {
    const fn = TOKENS[name.trim()];
    if (!fn) {
      issues.push({ level: 'warn', message: `알 수 없는 토큰 ${m}은(는) 글자 그대로 들어갑니다.` });
      return sanitizeSegment(m);
    }
    return sanitizeSegment(fn(ctx));
  });
  const parts = p
    .split('/')
    .map((x) => x.trim())
    .filter((x) => x !== '' && x !== '.');
  if (parts.some((x) => x === '..')) {
    issues.push({ level: 'error', message: '경로에 ".."를 쓸 수 없습니다. ComfyUI는 output 폴더 밖에 저장하지 않습니다.' });
  }
  // 경로 조각에 남은 금지 글자 (단, %토큰% 안의 ':'은 허용)
  for (const part of parts) {
    const bare = part.replace(/%[^%]*%/g, '');
    if (/[:*?"<>|]/.test(bare)) issues.push({ level: 'warn', message: `"${part}"에 파일 이름에 쓸 수 없는 글자가 있습니다.` });
  }
  if (parts.length === 0) {
    issues.push({ level: 'error', message: '저장 경로가 비어 있습니다.' });
    return { prefix: '', fileName: '', issues };
  }
  const prefix = parts.join('/');
  return { prefix, fileName: parts[parts.length - 1], issues };
}

export function withFinalMarker(prefix: string, marker: string): string {
  return prefix + marker;
}

// ---------------------------------------------------------------------------
// 끌어다 놓은 파일 이름 → 줄 찾기

/** ComfyUI가 붙이는 _00001_ 번호, 확장자, 브라우저가 붙이는 " (1)"을 뗀 이름 */
export function fileStem(fileName: string): string {
  let s = fileName.split(/[\\/]/).pop() ?? fileName;
  s = s.replace(/\.(png|webp|jpe?g)$/i, '');
  s = s.replace(/\s*\(\d+\)$/, '');
  s = s.replace(/_\d{5,}_?$/, '');
  return s.trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 파일 이름 규칙(ComfyUI %토큰% 포함)을 정규식으로 바꾼다 */
export function nameMatcher(fileName: string): RegExp {
  const pieces = fileName.split(/(%[^%]+%)/g);
  const body = pieces.map((x) => (/^%[^%]+%$/.test(x) ? '.+?' : escapeRe(x))).join('');
  return new RegExp(`^${body}$`, 'i');
}

/** 같은지 비교할 때 쓰는 이름 (토큰은 하나의 자리표시로) */
export function nameKey(fileName: string): string {
  return fileName.replace(/%[^%]+%/g, '\u0000').toLowerCase();
}

export function hasComfyTokens(s: string): boolean {
  return /%[^%]+%/.test(s);
}
