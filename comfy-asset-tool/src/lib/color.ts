function parse(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
}

/** a를 b 쪽으로 t만큼 섞는다 (t=0이면 a) */
export function mix(a: string, b: string, t: number): string {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return a;
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** ComfyUI 노드 색: 제목 막대(color)와 본문(bgcolor)을 어둡게 섞어 흰 글자가 읽히게 한다 */
export function nodeColors(hex: string): { color: string; bgcolor: string } {
  if (!parse(hex)) return { color: '#222', bgcolor: '#353535' };
  return { color: mix(hex, '#1a1a1a', 0.55), bgcolor: mix(hex, '#353535', 0.72) };
}

export function isHexColor(s: string): boolean {
  return parse(s) !== null;
}
