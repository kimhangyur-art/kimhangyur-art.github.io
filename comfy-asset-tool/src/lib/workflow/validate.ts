// 워크플로우 JSON 구조 검사: 노드·links가 서로 맞는지, 위젯 개수가 맞는지, 필수 입력이 연결됐는지.
// 참고 샘플(reference/hexmaniac_assets_workflow.json)도 통과해야 한다 — 실제로 열리는 형식을 이해하는지 확인용.

import { CONTROL, NODE_DEFS } from './nodeDefs';
import { nodeRect, type Workflow } from './graph';

export function validateWorkflow(wf: Workflow, opts: { checkOverlap?: boolean } = {}): string[] {
  const errors: string[] = [];
  const nodes = new Map<number, Workflow['nodes'][number]>();
  for (const n of wf.nodes) {
    if (nodes.has(n.id)) errors.push(`노드 id ${n.id} 중복`);
    nodes.set(n.id, n);
    if (n.id > wf.last_node_id) errors.push(`노드 id ${n.id} > last_node_id ${wf.last_node_id}`);
  }
  const links = new Map<number, Workflow['links'][number]>();
  for (const l of wf.links) {
    const [id, from, fromSlot, to, toSlot, type] = l;
    if (links.has(id)) errors.push(`link ${id} 중복`);
    links.set(id, l);
    if (id > wf.last_link_id) errors.push(`link ${id} > last_link_id`);
    const a = nodes.get(from);
    const b = nodes.get(to);
    if (!a || !b) {
      errors.push(`link ${id}: 없는 노드`);
      continue;
    }
    const out = a.outputs[fromSlot];
    if (!out) errors.push(`link ${id}: ${a.type}에 출력 ${fromSlot} 없음`);
    else {
      if (!out.links?.includes(id)) errors.push(`link ${id}: ${a.type} 출력에 기록 없음`);
      if (out.type !== type && type !== '*') errors.push(`link ${id}: 출력 타입 ${out.type} ≠ ${type}`);
    }
    const inp = b.inputs[toSlot];
    if (!inp) errors.push(`link ${id}: ${b.type}에 입력 ${toSlot} 없음`);
    else {
      if (inp.link !== id) errors.push(`link ${id}: ${b.type}.${inp.name}.link = ${inp.link}`);
      if (inp.type !== type && inp.type !== '*' && type !== '*') errors.push(`link ${id}: 입력 타입 ${inp.type} ≠ ${type}`);
    }
  }
  for (const n of wf.nodes) {
    for (const inp of n.inputs) {
      if (inp.link != null && !links.has(inp.link)) errors.push(`${n.type}#${n.id}.${inp.name}: 없는 link ${inp.link}`);
    }
    for (const out of n.outputs) {
      for (const lid of out.links ?? []) {
        const l = links.get(lid);
        if (!l || l[1] !== n.id) errors.push(`${n.type}#${n.id} 출력 ${out.name}: link ${lid} 불일치`);
      }
    }
    const def = NODE_DEFS[n.type];
    if (!def) continue;
    if (n.widgets_values.length !== def.widgets.length) {
      errors.push(`${n.type}#${n.id}: 위젯 값 ${n.widgets_values.length}개 (기대 ${def.widgets.length})`);
    }
    def.widgets.forEach((w, i) => {
      if (w === CONTROL && !['fixed', 'randomize', 'increment', 'decrement'].includes(String(n.widgets_values[i]))) {
        errors.push(`${n.type}#${n.id}: 시드 제어 값 ${n.widgets_values[i]}`);
      }
    });
    if (!def.virtual) {
      for (const [name] of def.inputs) {
        const inp = n.inputs.find((i) => i.name === name);
        if (!inp || inp.link == null) errors.push(`${n.type}#${n.id}: 입력 ${name} 미연결`);
      }
    }
  }
  if (opts.checkOverlap) {
    const rects = wf.nodes.map((n) => ({ n, r: nodeRect(n) }));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        if (overlap(rects[i].r, rects[j].r)) {
          errors.push(`노드 겹침: ${rects[i].n.title ?? rects[i].n.type} / ${rects[j].n.title ?? rects[j].n.type}`);
        }
      }
    }
    // 그룹끼리 겹치지 않아야 한다
    for (let i = 0; i < wf.groups.length; i++) {
      for (let j = i + 1; j < wf.groups.length; j++) {
        if (overlap(wf.groups[i].bounding, wf.groups[j].bounding)) errors.push(`그룹 겹침: ${wf.groups[i].title} / ${wf.groups[j].title}`);
      }
    }
  }
  return errors;
}

function overlap(a: number[], b: number[]): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

/** 노드가 어느 그룹 안에 들어 있는지 (제목 막대까지 완전히 들어간 경우) */
export function groupOfNode(wf: Workflow, nodeId: number): string | null {
  const n = wf.nodes.find((x) => x.id === nodeId);
  if (!n) return null;
  const [x, y, w, h] = nodeRect(n);
  for (const g of wf.groups) {
    const [gx, gy, gw, gh] = g.bounding;
    if (x >= gx && y >= gy && x + w <= gx + gw && y + h <= gy + gh) return g.title;
  }
  return null;
}
