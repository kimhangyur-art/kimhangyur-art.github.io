// PNG의 실행 정보(API prompt)에서 저장 노드 → 디코드 → KSampler를 거꾸로 따라가 실제 시드를 읽는다.
// 시드가 다른 노드(PrimitiveInt 등)에서 연결돼 있으면 그 노드까지 따라간다.
// 마무리 이미지는 KSampler가 둘(기본 + 고화질)이라, 맨 앞(빈 latent에서 시작하는) KSampler의 시드를 쓴다.

import { isLink, type ApiPrompt } from './workflow/apiPrompt';

export function asApiPrompt(v: unknown): ApiPrompt | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length === 0) return null;
  for (const [, n] of entries) {
    if (!n || typeof n !== 'object' || typeof (n as { class_type?: unknown }).class_type !== 'string') return null;
  }
  return v as ApiPrompt;
}

export interface SaveNodeInfo {
  id: string;
  prefix: string;
  title?: string;
}

/** filename_prefix를 가진 저장 노드들 */
export function saveNodes(prompt: ApiPrompt): SaveNodeInfo[] {
  const out: SaveNodeInfo[] = [];
  for (const [id, n] of Object.entries(prompt)) {
    const p = n.inputs?.filename_prefix;
    if (typeof p === 'string' && (n.class_type === 'SaveImage' || /save/i.test(n.class_type))) {
      out.push({ id, prefix: p, title: n._meta?.title });
    }
  }
  return out;
}

const SEED_KEYS = ['seed', 'noise_seed'];

function isSampler(n: ApiNode | undefined): boolean {
  if (!n) return false;
  if (/KSampler|SamplerCustom/.test(n.class_type)) return true;
  return SEED_KEYS.some((k) => k in (n.inputs ?? {})) && ('latent_image' in (n.inputs ?? {}) || 'latent' in (n.inputs ?? {}));
}

type ApiNode = ApiPrompt[string];

export interface TraceResult {
  /** 맨 앞 KSampler (기본 단계) */
  baseSampler: string | null;
  samplers: string[];
  seed: number | null;
  /** 시드를 어디서 읽었는지 (노드 id 경로) */
  seedPath: string[];
  /** KSampler가 둘 이상이면 고화질 단계가 있는 이미지 */
  hasHires: boolean;
  problem: string | null;
}

/** 저장 노드에서 거꾸로 따라가 KSampler와 시드를 찾는다 */
export function traceSeed(prompt: ApiPrompt, saveId: string): TraceResult {
  const samplers: string[] = [];
  const seen = new Set<string>();
  const stack = [saveId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = prompt[id];
    if (!n) continue;
    if (id !== saveId && isSampler(n)) samplers.push(id);
    for (const [k, v] of Object.entries(n.inputs ?? {})) {
      // 샘플러의 시드 연결은 아래에서 따로 따라간다
      if (isSampler(n) && SEED_KEYS.includes(k)) continue;
      if (isLink(v)) stack.push(String(v[0]));
    }
  }
  if (samplers.length === 0) {
    return { baseSampler: null, samplers, seed: null, seedPath: [], hasHires: false, problem: '실행 정보에서 이 이미지의 KSampler를 찾지 못했습니다.' };
  }
  // 기본 단계 = latent 입력을 거슬러 올라가도 다른 샘플러가 나오지 않는 샘플러
  const upstreamSamplers = (sid: string): number => {
    let count = 0;
    const s2 = new Set<string>();
    const st: string[] = [];
    const n = prompt[sid];
    for (const [k, v] of Object.entries(n.inputs ?? {})) if ((k === 'latent_image' || k === 'latent') && isLink(v)) st.push(String(v[0]));
    while (st.length) {
      const id = st.pop()!;
      if (s2.has(id)) continue;
      s2.add(id);
      const m = prompt[id];
      if (!m) continue;
      if (isSampler(m)) count++;
      for (const [k, v] of Object.entries(m.inputs ?? {})) {
        if (isSampler(m) && SEED_KEYS.includes(k)) continue;
        if (isLink(v)) st.push(String(v[0]));
      }
    }
    return count;
  };
  const base = samplers.find((s) => upstreamSamplers(s) === 0) ?? samplers[samplers.length - 1];
  const { value, path, problem } = readSeed(prompt, base);
  return { baseSampler: base, samplers, seed: value, seedPath: path, hasHires: samplers.length > 1, problem };
}

/** 샘플러의 seed 입력을 읽는다. 연결돼 있으면 따라간다. */
export function readSeed(prompt: ApiPrompt, samplerId: string): { value: number | null; path: string[]; problem: string | null } {
  const path = [samplerId];
  const n = prompt[samplerId];
  const key = SEED_KEYS.find((k) => k in (n?.inputs ?? {}));
  if (!n || !key) return { value: null, path, problem: 'KSampler에 seed 값이 없습니다.' };
  let v: unknown = n.inputs[key];
  for (let depth = 0; depth < 12 && isLink(v); depth++) {
    const id = String(v[0]);
    path.push(id);
    const src = prompt[id];
    if (!src) return { value: null, path, problem: `시드를 보내는 노드 ${id}가 실행 정보에 없습니다.` };
    const ins = src.inputs ?? {};
    const k = ['value', 'seed', 'noise_seed', 'int', 'number', 'Value'].find((x) => x in ins) ?? Object.keys(ins)[0];
    if (k === undefined) return { value: null, path, problem: `${src.class_type} 노드에서 시드 값을 읽지 못했습니다.` };
    v = ins[k];
  }
  const num = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof num !== 'number' || !Number.isFinite(num)) {
    return { value: null, path, problem: '시드가 숫자가 아닙니다.' };
  }
  if (!Number.isSafeInteger(num)) {
    return { value: num, path, problem: '시드가 너무 커서 정확히 읽지 못했을 수 있습니다 (2^53 초과).' };
  }
  return { value: num, path, problem: null };
}
