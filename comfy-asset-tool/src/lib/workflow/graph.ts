// ComfyUI 워크플로우(JSON, version 0.4) 만들기
// 형식: nodes[] + links[[id, 출발 노드, 출발 슬롯, 도착 노드, 도착 슬롯, 타입]] + groups[]
// 위젯을 입력으로 바꿔 연결할 때는 inputs에 {name, type, widget: {name}, link}를 넣는다.

import { NODE_DEFS, widgetValues } from './nodeDefs';

export interface WfInput {
  name: string;
  type: string;
  link: number | null;
  widget?: { name: string };
}

export interface WfOutput {
  name: string;
  type: string;
  links: number[];
  slot_index?: number;
}

export interface WfNode {
  id: number;
  type: string;
  pos: [number, number];
  size: [number, number];
  flags: Record<string, unknown>;
  order: number;
  mode: number;
  inputs: WfInput[];
  outputs: WfOutput[];
  properties: Record<string, unknown>;
  widgets_values: unknown[];
  title?: string;
  color?: string;
  bgcolor?: string;
}

export type WfLink = [number, number, number, number, number, string];

export interface WfGroup {
  id: number;
  title: string;
  bounding: [number, number, number, number];
  color: string;
  font_size: number;
  flags: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  revision: number;
  last_node_id: number;
  last_link_id: number;
  nodes: WfNode[];
  links: WfLink[];
  groups: WfGroup[];
  config: Record<string, unknown>;
  extra: Record<string, unknown>;
  version: number;
}

/** ComfyUI 노드 모드: 0 = 실행, 2 = mute(계산하지 않음), 4 = bypass */
export const MODE_ALWAYS = 0;
export const MODE_MUTED = 2;

/** 노드 제목 막대 높이. pos는 본문 왼쪽 위라서 제목은 그 위에 그려진다. */
export const TITLE_H = 30;

export interface AddOptions {
  title?: string;
  widgets?: Record<string, unknown>;
  size?: [number, number];
  color?: string;
  bgcolor?: string;
  mode?: number;
  collapsed?: boolean;
}

export class GraphBuilder {
  nodes: WfNode[] = [];
  links: WfLink[] = [];
  groups: WfGroup[] = [];
  private nextNode = 1;
  private nextLink = 1;
  private nextGroup = 1;
  private byId = new Map<number, WfNode>();

  add(type: string, opts: AddOptions = {}): WfNode {
    const def = NODE_DEFS[type];
    if (!def) throw new Error(`알 수 없는 노드: ${type}`);
    const node: WfNode = {
      id: this.nextNode++,
      type,
      pos: [0, 0],
      size: opts.size ?? [...def.size],
      flags: opts.collapsed ? { collapsed: true } : {},
      order: 0,
      mode: opts.mode ?? MODE_ALWAYS,
      inputs: def.inputs.map(([name, t]) => ({ name, type: t, link: null })),
      outputs: def.outputs.map(([name, t], i) => ({ name, type: t, links: [], slot_index: i })),
      properties: def.virtual ? {} : { 'Node name for S&R': type },
      widgets_values: widgetValues(type, opts.widgets ?? {}),
    };
    if (opts.title) node.title = opts.title;
    if (opts.color) node.color = opts.color;
    if (opts.bgcolor) node.bgcolor = opts.bgcolor;
    this.nodes.push(node);
    this.byId.set(node.id, node);
    return node;
  }

  get(id: number): WfNode {
    const n = this.byId.get(id);
    if (!n) throw new Error(`노드 ${id} 없음`);
    return n;
  }

  /** from의 출력 슬롯을 to의 입력(또는 위젯)에 연결한다 */
  connect(from: WfNode, outSlot: number, to: WfNode, inputName: string): number {
    const out = from.outputs[outSlot];
    if (!out) throw new Error(`${from.type}에 출력 ${outSlot}이 없습니다.`);
    let idx = to.inputs.findIndex((i) => i.name === inputName);
    const def = NODE_DEFS[to.type];
    if (idx < 0) {
      if (!def.widgets.includes(inputName)) throw new Error(`${to.type}에 입력 ${inputName}이 없습니다.`);
      const t = def.widgetTypes?.[inputName] ?? out.type;
      to.inputs.push({ name: inputName, type: t, widget: { name: inputName }, link: null });
      idx = to.inputs.length - 1;
    }
    const input = to.inputs[idx];
    if (input.type !== out.type) throw new Error(`타입이 맞지 않습니다: ${out.type} → ${to.type}.${inputName}(${input.type})`);
    if (input.link != null) throw new Error(`${to.type}.${inputName}은 이미 연결되어 있습니다.`);
    const id = this.nextLink++;
    input.link = id;
    out.links.push(id);
    this.links.push([id, from.id, outSlot, to.id, idx, out.type]);
    return id;
  }

  addGroup(title: string, bounding: [number, number, number, number], color: string, fontSize = 24): WfGroup {
    const g: WfGroup = { id: this.nextGroup++, title, bounding, color, font_size: fontSize, flags: {} };
    this.groups.push(g);
    return g;
  }

  /** 실행 순서(order) 계산: 연결을 따라 위상 정렬 */
  private computeOrder() {
    const indeg = new Map<number, number>();
    const next = new Map<number, number[]>();
    for (const n of this.nodes) {
      indeg.set(n.id, 0);
      next.set(n.id, []);
    }
    for (const [, from, , to] of this.links) {
      indeg.set(to, (indeg.get(to) ?? 0) + 1);
      next.get(from)!.push(to);
    }
    const queue = this.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
    let order = 0;
    const seen = new Set<number>();
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      this.get(id).order = order++;
      for (const t of next.get(id)!) {
        indeg.set(t, indeg.get(t)! - 1);
        if (indeg.get(t) === 0) queue.push(t);
      }
    }
    for (const n of this.nodes) if (!seen.has(n.id)) n.order = order++;
  }

  build(id: string, extra: Record<string, unknown>): Workflow {
    this.computeOrder();
    return {
      id,
      revision: 0,
      last_node_id: this.nextNode - 1,
      last_link_id: this.nextLink - 1,
      nodes: this.nodes,
      links: this.links,
      groups: this.groups,
      config: {},
      extra,
      version: 0.4,
    };
  }
}

/** 노드가 화면에서 차지하는 사각형 (제목 막대 포함) */
export function nodeRect(n: Pick<WfNode, 'pos' | 'size'>): [number, number, number, number] {
  return [n.pos[0], n.pos[1] - TITLE_H, n.size[0], n.size[1] + TITLE_H];
}
