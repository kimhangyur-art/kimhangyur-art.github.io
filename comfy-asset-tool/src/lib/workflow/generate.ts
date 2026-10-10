// 계획(Plan)으로 ComfyUI 워크플로우 JSON을 만든다.
//
// 구조 원칙
// - 기본 노드만 쓴다. 값은 각 노드에 직접 넣는다(공통 Primitive로 묶지 않는다).
//   예외: 구도 맞추기 그룹의 시드 공유(PrimitiveInt 하나를 같은 그룹·캐릭터의 KSampler들이 함께 쓴다).
// - 같은 입력을 쓰는 노드는 공유한다: 로라 조합별 LoraLoader 체인(앞부분이 같으면 앞부분도 공유),
//   체인 끝마다 CLIP skip 하나, (체인, 네거티브 문구)마다 네거티브 인코딩 하나, 해상도별 latent 하나.
//   로라가 없으면 체크포인트에서 바로 연결한다.
// - 초안과 마무리는 기본 단계(프롬프트, 해상도, steps, cfg, 샘플러, 스케줄러, 시드)를 똑같이 만들고,
//   마무리는 그 KSampler 뒤에 고화질 단계만 덧붙인다.
// - 대상이 아닌 줄을 넣을 때는 SaveImage만 mute한다 (ComfyUI가 계산하지 않고, Ctrl+M으로 다시 켤 수 있다).

import { normalizeLoraFile, type RowLora } from '../compose';
import { nodeColors } from '../color';
import { randomSeed, uuid, type Rng } from '../ids';
import type { Plan, PlannedRow } from '../plan';
import { effectiveHires, resolveSettings } from '../settings';
import type { Library, Project, SceneGroup } from '../types';
import { GraphBuilder, MODE_ALWAYS, MODE_MUTED, TITLE_H, nodeRect, type WfNode, type Workflow } from './graph';

/**
 * 나중에 붙일 후처리 단계 자리 (예: FaceDetailer 얼굴 보정, 배경 제거 같은 커스텀 노드).
 * 지금은 하나도 없다. 단계를 만들 때는 nodeDefs.ts의 NODE_DEFS에 그 노드 정의를 더하고,
 * requiredNodes를 ComfyUI 연결로 받은 nodeTypes와 비교해(stageAvailable) 설치됐을 때만 켠다.
 * 마무리의 마지막 디코드와 저장 사이에 끼워 넣으므로 기본 단계(초안과 같아야 하는 부분)는 건드리지 않는다.
 */
export interface PostStage {
  id: string;
  label: string;
  requiredNodes: string[];
  /** 디코드한 이미지 노드(IMAGE 출력)를 받아 새 IMAGE 출력 노드와 만든 노드들을 돌려준다 */
  apply(gb: GraphBuilder, image: WfNode, row: PlannedRow): { output: WfNode; nodes: WfNode[] };
}

export function stageAvailable(stage: PostStage, nodeTypes: string[] | undefined): boolean {
  return !!nodeTypes && stage.requiredNodes.every((n) => nodeTypes.includes(n));
}

export interface BuildOptions {
  rng?: Rng;
  now?: Date;
  /** 마무리에서 디코드 뒤에 붙일 후처리 단계 (기본 없음) */
  postStages?: PostStage[];
}

export interface RowNodes {
  positive: number;
  negative: number;
  ksampler: number;
  hiresKsampler?: number;
  decode: number;
  save: number;
  seedPrimitive?: number;
  /** 워크플로우에 처음 들어간 시드 값 */
  seed: number;
}

export interface BuildStats {
  nodes: number;
  links: number;
  rows: number;
  targets: number;
  loraLoaders: number;
  loraChains: number;
  latents: number;
  sharedNegatives: number;
  sharedSeeds: number;
}

export interface BuildResult {
  workflow: Workflow;
  rowNodes: Map<string, RowNodes>;
  stats: BuildStats;
}

const GAP_X = 50;
const GAP_Y = 40;
const SECTION_GAP = 80;
const COL_GAP = 140;
const LINE_GAP = 70;
const GROUP_GAP = 160;
const GROUP_PAD = 30;
const GROUP_TITLE = 56;

interface TrieNode {
  key: string;
  depth: number;
  lora?: RowLora;
  node?: WfNode;
  children: Map<string, TrieNode>;
  clipSkip?: WfNode;
  label: string;
}

interface StripCell {
  node: WfNode;
}

interface RowBuild {
  row: PlannedRow;
  columns: StripCell[][];
  width: number;
  nodes: RowNodes;
}

function baseName(file: string): string {
  const b = file.split(/[\\/]/).pop() ?? file;
  return b.replace(/\.(safetensors|ckpt|pt|pth|bin)$/i, '');
}

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(Math.round(n * 1000) / 1000);
}

function placeAt(node: WfNode, x: number, visTop: number): number {
  node.pos = [Math.round(x), Math.round(visTop + TITLE_H)];
  return visTop + TITLE_H + node.size[1];
}

function noteSize(text: string, width = 320): [number, number] {
  const perLine = Math.max(14, Math.floor(width / 13));
  const lines = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return [width, Math.min(520, Math.max(80, 30 + lines * 18))];
}

export function buildWorkflow(project: Project, library: Library, plan: Plan, opts: BuildOptions = {}): BuildResult {
  const rng = opts.rng;
  const now = opts.now ?? new Date();
  const gb = new GraphBuilder();
  const global = resolveSettings({ project, library }, 'global');
  const model = global.values.model;
  const seedControl = global.values.seed.control;
  const finalize = plan.mode === 'finalize';
  const rows = plan.included;

  // ---- 공통: 체크포인트와 모델 패치 ------------------------------------------------
  const ckpt = gb.add('CheckpointLoaderSimple', {
    title: '체크포인트',
    widgets: { ckpt_name: project.checkpoint },
  });
  let modelSrc: WfNode = ckpt;
  const modelPatches: WfNode[] = [];
  if (model.vpred) {
    const msd = gb.add('ModelSamplingDiscrete', {
      title: 'v-pred 설정',
      widgets: { sampling: 'v_prediction', zsnr: model.zsnr },
    });
    gb.connect(modelSrc, 0, msd, 'model');
    modelSrc = msd;
    modelPatches.push(msd);
  }
  if (model.rescaleCfg > 0) {
    const rc = gb.add('RescaleCFG', { title: 'CFG 재조정', widgets: { multiplier: model.rescaleCfg } });
    gb.connect(modelSrc, 0, rc, 'model');
    modelSrc = rc;
    modelPatches.push(rc);
  }

  // ---- 로라 체인 (앞부분이 같으면 공유하는 트리) -----------------------------------
  const root: TrieNode = { key: '', depth: 0, children: new Map(), label: '로라 없음' };
  const rowEnd = new Map<string, TrieNode>();
  let loraLoaders = 0;
  for (const r of rows) {
    let cur = root;
    for (const l of r.composed.loras) {
      const k = `${normalizeLoraFile(l.file)}@${l.strength}@${l.clipStrength}`;
      let child = cur.children.get(k);
      if (!child) {
        const name = baseName(l.file);
        const strength = l.clipStrength === l.strength ? fmt(l.strength) : `${fmt(l.strength)}/${fmt(l.clipStrength)}`;
        const node = gb.add('LoraLoader', {
          title: `로라 · ${name} ${strength}`,
          widgets: { lora_name: l.file, strength_model: l.strength, strength_clip: l.clipStrength },
        });
        gb.connect(cur.node ?? modelSrc, 0, node, 'model');
        gb.connect(cur.node ?? ckpt, 1, node, 'clip');
        loraLoaders++;
        child = {
          key: k,
          depth: cur.depth + 1,
          lora: l,
          node,
          children: new Map(),
          label: cur === root ? `${name} ${strength}` : `${cur.label} + ${name} ${strength}`,
        };
        cur.children.set(k, child);
      }
      cur = child;
    }
    rowEnd.set(r.key, cur);
  }
  const clipSkipLabel = `CLIP skip ${-model.clipSkip}`;
  const ends = new Set(rowEnd.values());
  for (const end of ends) {
    end.clipSkip = gb.add('CLIPSetLastLayer', {
      title: `${clipSkipLabel} · ${end.label}`,
      widgets: { stop_at_clip_layer: model.clipSkip },
    });
    gb.connect(end.node ?? ckpt, 1, end.clipSkip, 'clip');
  }
  const modelOf = (end: TrieNode) => end.node ?? modelSrc;

  // ---- 네거티브 인코딩: (체인, 문구)마다 하나. 두 줄 이상이 쓰면 공통 영역에 둔다 -----
  const negKey = (r: PlannedRow) => `${rowEnd.get(r.key)!.clipSkip!.id}::${r.composed.negative}`;
  const negCount = new Map<string, number>();
  for (const r of rows) negCount.set(negKey(r), (negCount.get(negKey(r)) ?? 0) + 1);
  const sharedNeg = new Map<string, WfNode>();
  let negIndex = 0;
  for (const r of rows) {
    const k = negKey(r);
    if ((negCount.get(k) ?? 0) < 2 || sharedNeg.has(k)) continue;
    negIndex++;
    const end = rowEnd.get(r.key)!;
    const node = gb.add('CLIPTextEncode', {
      title: `네거티브 ${negIndex} · ${end.label} (${negCount.get(k)}줄)`,
      widgets: { text: r.composed.negative },
      size: [420, 140],
    });
    gb.connect(end.clipSkip!, 0, node, 'clip');
    sharedNeg.set(k, node);
  }

  // ---- 해상도별 latent ---------------------------------------------------------
  const latents = new Map<string, WfNode>();
  for (const r of rows) {
    const g = r.settings.values.generation;
    const k = `${g.width}x${g.height}x${g.batchSize}`;
    if (latents.has(k)) continue;
    latents.set(
      k,
      gb.add('EmptyLatentImage', {
        title: `크기 ${g.width}×${g.height}${g.batchSize > 1 ? ` · 배치 ${g.batchSize}` : ''}`,
        widgets: { width: g.width, height: g.height, batch_size: g.batchSize },
      }),
    );
  }

  // ---- 업스케일 모델 (마무리 · model 방식) ------------------------------------------
  const upscalers = new Map<string, WfNode>();
  if (finalize) {
    for (const r of rows) {
      const h = r.settings.values.hires;
      if (h.method !== 'model' || !h.upscaleModel.trim() || upscalers.has(h.upscaleModel)) continue;
      upscalers.set(
        h.upscaleModel,
        gb.add('UpscaleModelLoader', { title: `업스케일 모델 · ${baseName(h.upscaleModel)}`, widgets: { model_name: h.upscaleModel } }),
      );
    }
  }

  // ---- 구도 맞추기: 그룹·캐릭터마다 시드 하나 --------------------------------------
  const sharedSeeds = new Map<string, { node: WfNode; value: number }>();
  for (const r of rows) {
    if (r.seed.kind !== 'shared' || sharedSeeds.has(r.seed.key)) continue;
    const value = randomSeed(rng);
    const node = gb.add('PrimitiveInt', {
      title: `시드 공유 · ${r.group.name} · ${r.char.name}`,
      widgets: { value, 'value:control': seedControl },
      ...nodeColors(r.char.color),
    });
    sharedSeeds.set(r.seed.key, { node, value });
  }

  // ---- 줄마다 노드 만들기 -------------------------------------------------------
  const vae = ckpt;
  const builds: RowBuild[] = [];
  for (const r of rows) {
    const end = rowEnd.get(r.key)!;
    const g = r.settings.values.generation;
    const colors = nodeColors(r.char.color);
    const cols: StripCell[][] = [];
    const add = (type: string, title: string, widgets: Record<string, unknown>, extra: Partial<Parameters<GraphBuilder['add']>[1]> = {}) =>
      gb.add(type, { title, widgets, ...colors, ...extra });

    const pos = add('CLIPTextEncode', r.title, { text: r.composed.positive });
    gb.connect(end.clipSkip!, 0, pos, 'clip');
    let neg = sharedNeg.get(negKey(r));
    const col0: StripCell[] = [{ node: pos }];
    if (!neg) {
      neg = add('CLIPTextEncode', `${r.title} · 네거티브`, { text: r.composed.negative }, { size: [420, 140] });
      gb.connect(end.clipSkip!, 0, neg, 'clip');
      col0.push({ node: neg });
    }
    cols.push(col0);

    // 시드: 고정이면 그 값, 공유면 PrimitiveInt에 연결, 아니면 무작위 + 실행마다 바꾸기
    let seedValue: number;
    let control: string;
    const shared = r.seed.kind === 'shared' ? sharedSeeds.get(r.seed.key) : undefined;
    if (r.seed.kind === 'fixed') {
      seedValue = r.seed.value;
      control = 'fixed';
    } else if (shared) {
      seedValue = shared.value;
      control = 'fixed';
    } else {
      seedValue = randomSeed(rng);
      control = seedControl;
    }

    const ks = add('KSampler', `${r.title} · 샘플러`, {
      seed: seedValue,
      'seed:control': control,
      steps: g.steps,
      cfg: g.cfg,
      sampler_name: g.sampler,
      scheduler: g.scheduler,
      denoise: 1,
    });
    gb.connect(modelOf(end), 0, ks, 'model');
    gb.connect(pos, 0, ks, 'positive');
    gb.connect(neg, 0, ks, 'negative');
    gb.connect(latents.get(`${g.width}x${g.height}x${g.batchSize}`)!, 0, ks, 'latent_image');
    if (shared) gb.connect(shared.node, 0, ks, 'seed');
    cols.push([{ node: ks }]);

    let last: WfNode = ks;
    let hiresKs: WfNode | undefined;
    if (finalize) {
      const eh = effectiveHires(r.settings.values);
      let latentIn: WfNode;
      const method = eh.method === 'model' && !upscalers.has(eh.upscaleModel) ? 'pixel' : eh.method;
      if (method === 'latent') {
        const up = add('LatentUpscaleBy', `${r.title} · 확대`, { upscale_method: eh.latentMethod, scale_by: eh.scale });
        gb.connect(ks, 0, up, 'samples');
        cols.push([{ node: up }]);
        latentIn = up;
      } else {
        const stack: StripCell[] = [];
        const dec1 = add('VAEDecode', `${r.title} · 디코드(확대 전)`, {});
        gb.connect(ks, 0, dec1, 'samples');
        gb.connect(vae, 2, dec1, 'vae');
        stack.push({ node: dec1 });
        let img: WfNode = dec1;
        if (method === 'model') {
          const um = add('ImageUpscaleWithModel', `${r.title} · 모델 확대`, {});
          gb.connect(upscalers.get(eh.upscaleModel)!, 0, um, 'upscale_model');
          gb.connect(dec1, 0, um, 'image');
          stack.push({ node: um });
          img = um;
        }
        const sc = add('ImageScale', `${r.title} · 크기 맞추기 ${eh.width}×${eh.height}`, {
          upscale_method: eh.pixelMethod,
          width: eh.width,
          height: eh.height,
          crop: 'disabled',
        });
        gb.connect(img, 0, sc, 'image');
        stack.push({ node: sc });
        cols.push(stack);
        const enc = add('VAEEncode', `${r.title} · 인코드`, {});
        gb.connect(sc, 0, enc, 'pixels');
        gb.connect(vae, 2, enc, 'vae');
        cols.push([{ node: enc }]);
        latentIn = enc;
      }
      hiresKs = add('KSampler', `${r.title} · 고화질 샘플러`, {
        seed: seedValue,
        'seed:control': control,
        steps: eh.steps,
        cfg: eh.cfg,
        sampler_name: eh.sampler,
        scheduler: eh.scheduler,
        denoise: eh.denoise,
      });
      gb.connect(modelOf(end), 0, hiresKs, 'model');
      gb.connect(pos, 0, hiresKs, 'positive');
      gb.connect(neg, 0, hiresKs, 'negative');
      gb.connect(latentIn, 0, hiresKs, 'latent_image');
      cols.push([{ node: hiresKs }]);
      last = hiresKs;
    }

    const dec = add('VAEDecode', `${r.title} · 디코드`, {});
    gb.connect(last, 0, dec, 'samples');
    gb.connect(vae, 2, dec, 'vae');
    cols.push([{ node: dec }]);

    let image: WfNode = dec;
    if (finalize) {
      for (const stage of opts.postStages ?? []) {
        const out = stage.apply(gb, image, r);
        cols.push(out.nodes.map((node) => ({ node })));
        image = out.output;
      }
    }

    const saveTitle = r.target ? `${r.title} · 저장` : `${r.title} · 저장 (꺼짐: ${r.skipReason})`;
    const save = add('SaveImage', saveTitle, { filename_prefix: r.savePrefix }, { mode: r.target ? MODE_ALWAYS : MODE_MUTED });
    gb.connect(image, 0, save, 'images');
    cols.push([{ node: save }]);

    const noteText = rowNoteText(r);
    if (noteText) {
      const note = gb.add('Note', { title: `${r.title} · 메모`, widgets: { text: noteText }, size: noteSize(noteText, 300) });
      cols.push([{ node: note }]);
    }

    const width = cols.reduce((w, c) => w + Math.max(...c.map((x) => x.node.size[0])), 0) + GAP_X * (cols.length - 1);
    builds.push({
      row: r,
      columns: cols,
      width,
      nodes: {
        positive: pos.id,
        negative: neg.id,
        ksampler: ks.id,
        hiresKsampler: hiresKs?.id,
        decode: dec.id,
        save: save.id,
        seedPrimitive: shared?.node.id,
        seed: seedValue,
      },
    });
  }

  // ---- 사용법 메모 ---------------------------------------------------------------
  const usage = gb.add('Note', { title: '사용법', widgets: { text: usageText(project, plan, now) } });
  usage.size = noteSize(usage.widgets_values[0] as string, 560);

  // ---- 배치: 공통 영역 ------------------------------------------------------------
  const commonNodes: WfNode[] = [];
  let y = 0;
  y = placeAt(usage, 0, y) + SECTION_GAP;
  commonNodes.push(usage);

  let x = 0;
  let rowBottom = y;
  for (const n of [ckpt, ...modelPatches, ...upscalers.values()]) {
    rowBottom = Math.max(rowBottom, placeAt(n, x, y));
    x += n.size[0] + GAP_X;
    commonNodes.push(n);
  }
  y = rowBottom + SECTION_GAP;

  // 로라 트리: 깊이별 열, 줄마다 한 노드. 체인 끝의 CLIP skip은 맨 오른쪽 열에.
  const lines: TrieNode[] = [];
  const maxDepth = { v: 0 };
  const walk = (t: TrieNode) => {
    if (t !== root) lines.push(t);
    maxDepth.v = Math.max(maxDepth.v, t.depth);
    for (const c of t.children.values()) walk(c);
  };
  walk(root);
  if (root.clipSkip) lines.unshift(root);
  const loraW = 340;
  const lineH = 126 + TITLE_H + GAP_Y;
  const clipX = maxDepth.v * (loraW + GAP_X);
  lines.forEach((t, i) => {
    const ly = y + i * lineH;
    if (t.node) {
      placeAt(t.node, (t.depth - 1) * (loraW + GAP_X), ly);
      commonNodes.push(t.node);
    }
    if (t.clipSkip) {
      placeAt(t.clipSkip, clipX, ly);
      commonNodes.push(t.clipSkip);
    }
  });
  if (lines.length) y += lines.length * lineH - GAP_Y + SECTION_GAP;

  // 공유 네거티브와 latent: 4개씩 줄을 바꿔 놓는다
  const grid = (list: WfNode[], perRow: number) => {
    if (!list.length) return;
    const w = Math.max(...list.map((n) => n.size[0]));
    let bottom = y;
    let lineTop = y;
    list.forEach((n, i) => {
      if (i > 0 && i % perRow === 0) lineTop = bottom + GAP_Y;
      bottom = Math.max(bottom, placeAt(n, (i % perRow) * (w + GAP_X), lineTop));
      commonNodes.push(n);
    });
    y = bottom + SECTION_GAP;
  };
  grid([...sharedNeg.values()], 3);
  grid([...latents.values()], 4);

  const commonRect = boundsOf(commonNodes);
  gb.addGroup('공통 · 모델 / 로라 / 네거티브 / 크기', groupBounds(commonRect), '#444466');

  // ---- 배치: 장면 그룹 ------------------------------------------------------------
  const startX = commonRect[0] + commonRect[2] + COL_GAP + GROUP_PAD * 2;
  const stripW = Math.max(800, ...builds.map((b) => b.width));
  let gy = 0;
  const byKey = new Map(builds.map((b) => [b.row.key, b]));
  for (const group of project.groups) {
    const groupRows = builds.filter((b) => b.row.group.id === group.id);
    if (!groupRows.length) continue;
    const chars = project.characters.filter((c) => groupRows.some((b) => b.row.char.id === c.id));
    const scenes = project.scenes.filter((s) => s.groupId === group.id && groupRows.some((b) => b.row.scene.id === s.id));
    const members: WfNode[] = [];
    const colX = (ci: number) => startX + ci * (stripW + COL_GAP);
    let cy = gy;

    if (group.note.trim()) {
      const note = gb.add('Note', { title: `${group.name} · 그룹 메모`, widgets: { text: group.note } });
      note.size = noteSize(group.note, 600);
      cy = placeAt(note, startX, cy) + GAP_Y;
      members.push(note);
    }

    // 열 머리: 시드 공유 노드, 캐릭터 메모
    let headBottom = cy;
    chars.forEach((c, ci) => {
      let hx = colX(ci);
      const seed = sharedSeeds.get(`${group.id}|${c.id}`);
      if (seed) {
        headBottom = Math.max(headBottom, placeAt(seed.node, hx, cy));
        members.push(seed.node);
        hx += seed.node.size[0] + GAP_X;
      }
      if (c.note.trim()) {
        const note = gb.add('Note', { title: `${c.name} · 캐릭터 메모`, widgets: { text: c.note }, ...nodeColors(c.color) });
        note.size = noteSize(c.note, 420);
        headBottom = Math.max(headBottom, placeAt(note, hx, cy));
        members.push(note);
      }
    });
    if (headBottom > cy) cy = headBottom + GAP_Y;

    for (const s of scenes) {
      let lineBottom = cy;
      chars.forEach((c, ci) => {
        const b = byKey.get(`${c.id}|${s.id}`);
        if (!b) return;
        let cx = colX(ci);
        for (const col of b.columns) {
          let ty = cy;
          let w = 0;
          for (const cell of col) {
            ty = placeAt(cell.node, cx, ty) + GAP_Y;
            w = Math.max(w, cell.node.size[0]);
            members.push(cell.node);
          }
          lineBottom = Math.max(lineBottom, ty - GAP_Y);
          cx += w + GAP_X;
        }
      });
      cy = lineBottom + LINE_GAP;
    }

    const rect = boundsOf(members);
    gb.addGroup(groupTitle(group, groupRows.map((b) => b.row)), groupBounds(rect), group.color || '#3f789e');
    gy = rect[1] + rect[3] + GROUP_GAP + GROUP_TITLE;
  }

  const workflow = gb.build(uuid(), {
    ds: { scale: 0.45, offset: [80, 120] },
    assetTool: {
      tool: 'comfy-asset-tool',
      format: 1,
      mode: plan.mode,
      project: project.id,
      projectName: project.name,
      generatedAt: now.toISOString(),
      rows: rows.length,
      targets: plan.targets.length,
    },
  });

  return {
    workflow,
    rowNodes: new Map(builds.map((b) => [b.row.key, b.nodes])),
    stats: {
      nodes: workflow.nodes.length,
      links: workflow.links.length,
      rows: rows.length,
      targets: rows.filter((r) => r.target).length,
      loraLoaders,
      loraChains: ends.size,
      latents: latents.size,
      sharedNegatives: sharedNeg.size,
      sharedSeeds: sharedSeeds.size,
    },
  };
}

function boundsOf(nodes: WfNode[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    const [x, y, w, h] = nodeRect(n);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  }
  if (!Number.isFinite(x0)) return [0, 0, 100, 100];
  return [x0, y0, x1 - x0, y1 - y0];
}

/** 노드 사각형을 감싸는 그룹 테두리 (제목 자리 포함) */
function groupBounds([x, y, w, h]: [number, number, number, number]): [number, number, number, number] {
  return [x - GROUP_PAD, y - GROUP_PAD - GROUP_TITLE, w + GROUP_PAD * 2, h + GROUP_PAD * 2 + GROUP_TITLE];
}

function groupTitle(group: SceneGroup, rows: PlannedRow[]): string {
  const sizes = [...new Set(rows.map((r) => `${r.settings.values.generation.width}×${r.settings.values.generation.height}`))];
  const size = sizes.length === 1 ? sizes[0] : '여러 크기';
  const targets = rows.filter((r) => r.target).length;
  const seed = group.seedMode === 'match' ? ' · 구도 맞추기' : '';
  return `${group.name} · ${size} · ${targets}장${rows.length > targets ? ` (+꺼짐 ${rows.length - targets})` : ''}${seed}`;
}

function rowNoteText(r: PlannedRow): string {
  const parts: string[] = [];
  if (r.scene.note.trim()) parts.push(`장면 메모: ${r.scene.note.trim()}`);
  if (r.row.memo.trim()) parts.push(`줄 메모: ${r.row.memo.trim()}`);
  return parts.join('\n\n');
}

function usageText(project: Project, plan: Plan, now: Date): string {
  const t = plan.targets.length;
  const stamp = now.toLocaleString('ko-KR', { hour12: false });
  const lines =
    plan.mode === 'draft'
      ? [
          `[초안] ${project.name} · ${stamp}`,
          `미정 줄 ${t}개를 담았습니다. 실행할 때마다 줄마다 한 장씩 저장됩니다.`,
          '· 후보를 늘리려면 실행 버튼의 반복 횟수(Batch count)를 올리세요. 시드는 실행마다 바뀝니다.',
          '· 마음에 드는 PNG를 도구의 [확정·내보내기] 화면에 끌어다 놓으면 그 줄의 시드가 고정됩니다.',
          '· "시드 공유" 노드가 있는 그룹은 구도 맞추기 그룹입니다. 같은 캐릭터의 줄이 시드 하나를 함께 씁니다.',
        ]
      : [
          `[마무리] ${project.name} · ${stamp}`,
          `확정 줄 ${t}개를 고정 시드로 다시 그리고 고화질 단계를 더했습니다. 한 번만 실행하면 됩니다.`,
          '· 결과 PNG를 도구의 [확정·내보내기] 화면에 끌어다 놓으면 "완성"이 되고 내보내기 목록에 올라갑니다.',
        ];
  lines.push(
    '· 프롬프트와 설정은 도구에서 고치세요. 여기서 고친 내용은 도구로 돌아가지 않습니다.',
    '· 이름에 "(꺼짐: …)"이 붙은 저장 노드는 대상이 아닌 줄입니다. Ctrl+M으로 다시 켤 수 있습니다.',
  );
  return lines.join('\n');
}
