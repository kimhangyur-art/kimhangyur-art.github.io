// ComfyUI 연결 (선택 기능): /object_info에서 체크포인트·로라·샘플러·스케줄러·업스케일 모델 목록을 받는다.
// 브라우저에서 다른 주소로 요청하려면 ComfyUI를 --enable-cors-header 옵션으로 실행해야 한다.

export const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188';

export interface ComfyLists {
  url: string;
  fetchedAt: number;
  checkpoints: string[];
  loras: string[];
  samplers: string[];
  schedulers: string[];
  upscaleModels: string[];
  /** 설치된 노드 종류 (나중에 커스텀 노드 기능을 켤 때 확인용) */
  nodeTypes: string[];
}

/** 입력 정의에서 선택지 목록을 꺼낸다. 옛 형식 [[...], {}] 과 새 형식 ["COMBO", {options: [...]}] 둘 다. */
export function comboOptions(spec: unknown): string[] {
  if (!Array.isArray(spec)) return [];
  if (Array.isArray(spec[0])) return spec[0].filter((x): x is string => typeof x === 'string');
  if (spec[0] === 'COMBO' && spec[1] && typeof spec[1] === 'object') {
    const opts = (spec[1] as { options?: unknown }).options;
    if (Array.isArray(opts)) return opts.filter((x): x is string => typeof x === 'string');
  }
  return [];
}

type ObjectInfo = Record<string, { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } }>;

function opt(info: ObjectInfo, node: string, input: string): string[] {
  const n = info[node]?.input;
  return comboOptions(n?.required?.[input] ?? n?.optional?.[input]);
}

export function parseObjectInfo(url: string, info: ObjectInfo): ComfyLists {
  return {
    url,
    fetchedAt: Date.now(),
    checkpoints: opt(info, 'CheckpointLoaderSimple', 'ckpt_name'),
    loras: opt(info, 'LoraLoader', 'lora_name'),
    samplers: opt(info, 'KSampler', 'sampler_name'),
    schedulers: opt(info, 'KSampler', 'scheduler'),
    upscaleModels: opt(info, 'UpscaleModelLoader', 'model_name'),
    nodeTypes: Object.keys(info),
  };
}

export function normalizeUrl(url: string): string {
  let u = url.trim() || DEFAULT_COMFY_URL;
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u.replace(/\/+$/, '');
}

export async function fetchComfyLists(url: string, signal?: AbortSignal): Promise<ComfyLists> {
  const base = normalizeUrl(url);
  let res: Response;
  try {
    res = await fetch(`${base}/object_info`, { signal });
  } catch {
    throw new Error(
      `ComfyUI(${base})에 연결하지 못했습니다. ComfyUI가 켜져 있는지, --enable-cors-header 옵션으로 실행했는지 확인하세요.`,
    );
  }
  if (!res.ok) throw new Error(`ComfyUI 응답 오류: ${res.status} ${res.statusText}`);
  const info = (await res.json()) as ObjectInfo;
  return parseObjectInfo(base, info);
}

/** ComfyUI 화면에서 끌어 온 이미지 주소(/view?filename=...)면 파일 이름을 돌려준다 */
export function viewUrlFileName(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/\/view$/.test(u.pathname)) return null;
    return u.searchParams.get('filename');
  } catch {
    return null;
  }
}
