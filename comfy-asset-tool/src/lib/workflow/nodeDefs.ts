// 워크플로우에 쓰는 ComfyUI 기본 노드의 입력·출력·위젯 순서.
// ComfyUI 소스(nodes.py, comfy_extras/*)의 INPUT_TYPES 순서를 그대로 따른다.
// widgets_values는 화면 위젯 순서이고, seed처럼 control_after_generate가 있는 값은 바로 뒤에 제어 값이 붙는다.

export const CONTROL = '__control_after_generate__';

export interface NodeDef {
  /** 연결 입력 [이름, 타입] */
  inputs: Array<[string, string]>;
  /** 위젯 이름 (widgets_values 순서). CONTROL은 앞 위젯의 실행 후 제어 값 */
  widgets: string[];
  /** 위젯을 입력으로 바꿔 연결할 때의 타입 */
  widgetTypes?: Record<string, string>;
  outputs: Array<[string, string]>;
  /** 실행되지 않는 노드 (Note) */
  virtual?: boolean;
  size: [number, number];
}

export const NODE_DEFS: Record<string, NodeDef> = {
  CheckpointLoaderSimple: {
    inputs: [],
    widgets: ['ckpt_name'],
    outputs: [
      ['MODEL', 'MODEL'],
      ['CLIP', 'CLIP'],
      ['VAE', 'VAE'],
    ],
    size: [340, 98],
  },
  ModelSamplingDiscrete: {
    inputs: [['model', 'MODEL']],
    widgets: ['sampling', 'zsnr'],
    outputs: [['MODEL', 'MODEL']],
    size: [300, 82],
  },
  RescaleCFG: {
    inputs: [['model', 'MODEL']],
    widgets: ['multiplier'],
    outputs: [['MODEL', 'MODEL']],
    size: [300, 58],
  },
  LoraLoader: {
    inputs: [
      ['model', 'MODEL'],
      ['clip', 'CLIP'],
    ],
    widgets: ['lora_name', 'strength_model', 'strength_clip'],
    outputs: [
      ['MODEL', 'MODEL'],
      ['CLIP', 'CLIP'],
    ],
    size: [340, 126],
  },
  CLIPSetLastLayer: {
    inputs: [['clip', 'CLIP']],
    widgets: ['stop_at_clip_layer'],
    outputs: [['CLIP', 'CLIP']],
    size: [300, 58],
  },
  CLIPTextEncode: {
    inputs: [['clip', 'CLIP']],
    widgets: ['text'],
    outputs: [['CONDITIONING', 'CONDITIONING']],
    size: [420, 180],
  },
  EmptyLatentImage: {
    inputs: [],
    widgets: ['width', 'height', 'batch_size'],
    outputs: [['LATENT', 'LATENT']],
    size: [300, 106],
  },
  KSampler: {
    inputs: [
      ['model', 'MODEL'],
      ['positive', 'CONDITIONING'],
      ['negative', 'CONDITIONING'],
      ['latent_image', 'LATENT'],
    ],
    widgets: ['seed', CONTROL, 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
    widgetTypes: { seed: 'INT' },
    outputs: [['LATENT', 'LATENT']],
    size: [320, 262],
  },
  VAEDecode: {
    inputs: [
      ['samples', 'LATENT'],
      ['vae', 'VAE'],
    ],
    widgets: [],
    outputs: [['IMAGE', 'IMAGE']],
    size: [210, 46],
  },
  VAEEncode: {
    inputs: [
      ['pixels', 'IMAGE'],
      ['vae', 'VAE'],
    ],
    widgets: [],
    outputs: [['LATENT', 'LATENT']],
    size: [210, 46],
  },
  SaveImage: {
    inputs: [['images', 'IMAGE']],
    widgets: ['filename_prefix'],
    outputs: [],
    size: [320, 330],
  },
  LatentUpscaleBy: {
    inputs: [['samples', 'LATENT']],
    widgets: ['upscale_method', 'scale_by'],
    outputs: [['LATENT', 'LATENT']],
    size: [300, 82],
  },
  ImageScale: {
    inputs: [['image', 'IMAGE']],
    widgets: ['upscale_method', 'width', 'height', 'crop'],
    outputs: [['IMAGE', 'IMAGE']],
    size: [300, 130],
  },
  UpscaleModelLoader: {
    inputs: [],
    widgets: ['model_name'],
    outputs: [['UPSCALE_MODEL', 'UPSCALE_MODEL']],
    size: [320, 58],
  },
  ImageUpscaleWithModel: {
    inputs: [
      ['upscale_model', 'UPSCALE_MODEL'],
      ['image', 'IMAGE'],
    ],
    widgets: [],
    outputs: [['IMAGE', 'IMAGE']],
    size: [260, 46],
  },
  PrimitiveInt: {
    inputs: [],
    widgets: ['value', CONTROL],
    outputs: [['INT', 'INT']],
    size: [300, 82],
  },
  Note: {
    inputs: [],
    widgets: ['text'],
    outputs: [],
    virtual: true,
    size: [320, 160],
  },
};

/** 위젯 이름 → 값 객체를 widgets_values 배열로 바꾼다 */
export function widgetValues(type: string, values: Record<string, unknown>): unknown[] {
  const def = NODE_DEFS[type];
  if (!def) throw new Error(`알 수 없는 노드: ${type}`);
  const out: unknown[] = [];
  for (let i = 0; i < def.widgets.length; i++) {
    const w = def.widgets[i];
    if (w === CONTROL) {
      const owner = def.widgets[i - 1];
      out.push(values[`${owner}:control`] ?? 'fixed');
      continue;
    }
    if (!(w in values)) throw new Error(`${type} 노드에 ${w} 값이 없습니다.`);
    out.push(values[w]);
  }
  return out;
}
