// 워크플로우(화면용 JSON) → 실행 정보(API prompt) 변환.
// ComfyUI 화면이 실행할 때 서버로 보내고 PNG의 "prompt"에 저장하는 형식과 같다:
//   { "<노드 id>": { class_type, inputs: { 위젯 값 또는 [출발 노드 id, 슬롯] }, _meta: { title } } }
// mute(2)·bypass(4) 노드와 Note는 빠진다. 테스트에서 "ComfyUI가 실제로 받는 값"을 확인하는 데 쓴다.

import { CONTROL, NODE_DEFS } from './nodeDefs';
import type { Workflow } from './graph';

export interface ApiNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

export type ApiPrompt = Record<string, ApiNode>;

export function toApiPrompt(wf: Workflow): ApiPrompt {
  const linkById = new Map(wf.links.map((l) => [l[0], l]));
  const out: ApiPrompt = {};
  for (const n of wf.nodes) {
    const def = NODE_DEFS[n.type];
    if (!def || def.virtual) continue;
    if (n.mode === 2 || n.mode === 4) continue;
    const inputs: Record<string, unknown> = {};
    let wi = 0;
    for (const w of def.widgets) {
      const v = n.widgets_values[wi++];
      if (w === CONTROL) continue;
      inputs[w] = v;
    }
    for (const inp of n.inputs) {
      if (inp.link == null) continue;
      const l = linkById.get(inp.link);
      if (!l) continue;
      inputs[inp.name] = [String(l[1]), l[2]];
    }
    out[String(n.id)] = { class_type: n.type, inputs, _meta: { title: n.title ?? n.type } };
  }
  return out;
}

/** 출력 노드에서 거꾸로 따라가 실제로 계산되는 노드만 남긴다 (ComfyUI 실행과 같은 범위) */
export function executedNodes(prompt: ApiPrompt, outputTypes = ['SaveImage']): Set<string> {
  const keep = new Set<string>();
  const visit = (id: string) => {
    if (keep.has(id) || !prompt[id]) return;
    keep.add(id);
    for (const v of Object.values(prompt[id].inputs)) if (isLink(v)) visit(String(v[0]));
  };
  for (const [id, n] of Object.entries(prompt)) if (outputTypes.includes(n.class_type)) visit(id);
  return keep;
}

export function isLink(v: unknown): v is [string | number, number] {
  return Array.isArray(v) && v.length === 2 && (typeof v[0] === 'string' || typeof v[0] === 'number') && typeof v[1] === 'number';
}
