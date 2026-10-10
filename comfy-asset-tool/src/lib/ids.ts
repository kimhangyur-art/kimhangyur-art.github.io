export function newId(prefix = ''): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const s = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
  return prefix ? `${prefix}_${s}` : s;
}

export function uuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 0 ~ 2^50 사이 시드. JS 숫자로 정확히 다룰 수 있고 ComfyUI 화면의 무작위 범위와도 맞다. */
export const SEED_MAX = 2 ** 50;

export type Rng = () => number;

export function randomSeed(rng?: Rng): number {
  if (rng) return Math.floor(rng() * SEED_MAX);
  const b = new Uint32Array(2);
  globalThis.crypto.getRandomValues(b);
  return (b[0] % 2 ** 18) * 2 ** 32 + b[1];
}

/** 테스트용으로 같은 순서를 내는 난수 */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 2 ** 32;
  };
}
