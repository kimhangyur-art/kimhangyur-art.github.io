// 프롬프트 문법 다루기: 쉼표로 나눈 태그, (tag:1.2) 가중치, 중복 태그 찾기.
// ComfyUI의 가중치 문법을 따른다: (a:1.2) 는 1.2배, (a) 는 1.1배, \( \) 는 글자 그대로의 괄호.

export interface TagSegment {
  /** 원문에서의 위치 [start, end) — 앞뒤 공백 제외 */
  start: number;
  end: number;
  /** 원문 그대로 */
  raw: string;
  /** 가중치 괄호를 벗긴 안쪽 문구 */
  inner: string;
  weight: number;
  /** (a:1.2)처럼 숫자를 직접 쓴 가중치인지 */
  explicit: boolean;
}

/** 이스케이프되지 않은 괄호 깊이를 따라가며 최상위 쉼표/줄바꿈으로 나눈다. */
export function splitTopLevel(text: string): TagSegment[] {
  const out: TagSegment[] = [];
  let depth = 0;
  let segStart = 0;
  const flush = (end: number) => {
    let s = segStart;
    let e = end;
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e > s) out.push(parseSegment(text.slice(s, e), s, e));
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if ((c === ',' || c === '\n') && depth === 0) {
      flush(i);
      segStart = i + 1;
    }
  }
  flush(text.length);
  return out;
}

/** 첫 '(' 의 짝이 마지막 글자인지 */
function wrappedWhole(s: string): boolean {
  if (!s.startsWith('(') || !s.endsWith(')')) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0 && i !== s.length - 1) return false;
    }
  }
  return depth === 0;
}

/** 최상위(괄호 밖)의 마지막 ':' 위치 */
function lastTopColon(s: string): number {
  let depth = 0;
  let pos = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ':' && depth === 0) pos = i;
  }
  return pos;
}

function parseSegment(raw: string, start: number, end: number): TagSegment {
  let inner = raw;
  let weight = 1;
  let explicit = false;
  // (a) 중첩은 1.1배씩 곱한다. (a:1.2)는 그 값.
  for (let guard = 0; guard < 10 && wrappedWhole(inner); guard++) {
    const body = inner.slice(1, -1);
    const colon = lastTopColon(body);
    if (colon >= 0) {
      const num = body.slice(colon + 1).trim();
      if (/^-?\d+(\.\d+)?$|^-?\.\d+$/.test(num)) {
        weight *= parseFloat(num);
        explicit = true;
        inner = body.slice(0, colon).trim();
        continue;
      }
    }
    weight *= 1.1;
    inner = body.trim();
  }
  return { start, end, raw, inner, weight: round3(weight), explicit };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** 가중치를 붙여 다시 쓴다. 1이면 괄호를 뗀다. */
export function formatWeighted(inner: string, weight: number): string {
  const w = round3(weight);
  if (Math.abs(w - 1) < 1e-9) return inner;
  return `(${inner}:${trimNum(w)})`;
}

function trimNum(n: number): string {
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** 원문에서 한 조각의 가중치만 바꾼다 */
export function setSegmentWeight(text: string, seg: TagSegment, weight: number): string {
  return text.slice(0, seg.start) + formatWeighted(seg.inner, weight) + text.slice(seg.end);
}

/** 원문에서 한 조각을 지운다 (뒤따르는 쉼표도 함께) */
export function removeSegment(text: string, seg: TagSegment): string {
  let end = seg.end;
  const rest = text.slice(end);
  const m = /^\s*,\s*/.exec(rest);
  if (m) end += m[0].length;
  let start = seg.start;
  if (!m) {
    const before = text.slice(0, start);
    const mb = /,\s*$/.exec(before);
    if (mb) start -= mb[0].length;
  }
  return text.slice(0, start) + text.slice(end);
}

/** 중복 비교용으로 태그를 정규화한다: 소문자, 밑줄→공백, 이스케이프 제거, 공백 정리 */
export function normalizeTag(tag: string): string {
  return tag
    .replace(/\\([()])/g, '$1')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** 가중치 괄호 안의 여러 태그까지 펼쳐서 낱개 태그 목록을 만든다 */
export function flattenTags(text: string): string[] {
  const out: string[] = [];
  const walk = (t: string, depth: number) => {
    for (const seg of splitTopLevel(t)) {
      if (depth < 5 && seg.inner !== seg.raw && /,/.test(seg.inner)) walk(seg.inner, depth + 1);
      else {
        const n = normalizeTag(seg.inner);
        if (n) out.push(n);
      }
    }
  };
  walk(text, 0);
  return out;
}

/** 여러 줄·쉼표를 정리해 한 덩어리로 만든다 (안쪽 문구는 그대로 둔다) */
export function cleanPart(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trim().replace(/^,+|,+$/g, '').trim())
    .filter(Boolean)
    .join(', ');
}

export function joinParts(parts: string[]): string {
  return parts.map(cleanPart).filter(Boolean).join(', ');
}

/**
 * 괄호가 가중치로 읽히는 실수를 찾는다.
 * 예) "hex maniac (pokemon)" → ComfyUI는 (pokemon)을 1.1배 가중치로 읽는다. 작품 이름이면 \( \)로 써야 한다.
 */
export function findParenPitfalls(text: string): Array<{ found: string; fix: string }> {
  const out: Array<{ found: string; fix: string }> = [];
  const re = /([\p{L}\p{N}_][\p{L}\p{N}_ .'-]*?)\s+\(([\p{L}\p{N}_][\p{L}\p{N}_ .'-]*)\)/gu;
  for (const seg of splitTopLevel(text)) {
    const s = seg.raw;
    if (s.includes('\\(')) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const before = s[m.index - 1];
      if (before === '(') continue;
      out.push({ found: m[0], fix: `${m[1]} \\(${m[2]}\\)` });
    }
  }
  return out;
}

export function fixParenPitfalls(text: string): string {
  let out = text;
  for (const p of findParenPitfalls(text)) out = out.split(p.found).join(p.fix);
  return out;
}
