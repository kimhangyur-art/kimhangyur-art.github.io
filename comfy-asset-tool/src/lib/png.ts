// PNG 안의 글자 정보(tEXt / zTXt / iTXt) 읽기.
// ComfyUI의 SaveImage는 "prompt"(실행 정보)와 "workflow"(화면 JSON)를 tEXt로 넣는다.

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  return SIGNATURE.every((b, i) => bytes[i] === b);
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return s;
}

const utf8 = new TextDecoder('utf-8');

/** PNG의 글자 정보를 { 키: 값 } 으로 돌려준다. PNG가 아니면 오류. */
export async function readPngText(buffer: ArrayBuffer | Uint8Array): Promise<Record<string, string>> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!isPng(bytes)) throw new Error('PNG 파일이 아닙니다.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Record<string, string> = {};
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos);
    const type = latin1(bytes.subarray(pos + 4, pos + 8));
    const start = pos + 8;
    const end = start + len;
    if (end > bytes.length) break;
    const data = bytes.subarray(start, end);
    try {
      if (type === 'tEXt') {
        const z = data.indexOf(0);
        if (z > 0) out[latin1(data.subarray(0, z))] = latin1(data.subarray(z + 1));
      } else if (type === 'zTXt') {
        const z = data.indexOf(0);
        if (z > 0) out[latin1(data.subarray(0, z))] = latin1(await inflate(data.subarray(z + 2)));
      } else if (type === 'iTXt') {
        const z = data.indexOf(0);
        if (z > 0) {
          const key = latin1(data.subarray(0, z));
          const compressed = data[z + 1] === 1;
          let p = z + 3;
          const langEnd = data.indexOf(0, p);
          p = langEnd + 1;
          const transEnd = data.indexOf(0, p);
          p = transEnd + 1;
          const text = data.subarray(p);
          out[key] = utf8.decode(compressed ? await inflate(text) : text);
        }
      } else if (type === 'IEND') break;
    } catch {
      // 깨진 글자 정보는 건너뛴다
    }
    pos = end + 4; // CRC
  }
  return out;
}

/** ComfyUI가 넣은 JSON을 읽는다. Python json.dumps가 쓰는 NaN/Infinity도 받아 준다. */
export function parseComfyJson(text: string | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(text.replace(/\bNaN\b/g, 'null').replace(/-?\bInfinity\b/g, 'null'));
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// 테스트·예시용: 글자 정보를 넣은 작은 PNG 만들기

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function latin1Bytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

/** 1×1 PNG에 tEXt 정보를 넣어 만든다 (ComfyUI처럼 ASCII JSON을 넣는다고 가정) */
export function makePngWithText(texts: Record<string, string>): Uint8Array {
  const ihdr = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  // 1×1 RGB 픽셀 하나를 deflate(stored)로 담은 IDAT
  const idat = new Uint8Array([0x78, 0x01, 0x01, 0x04, 0x00, 0xfb, 0xff, 0x00, 0xff, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00]);
  const parts: Uint8Array[] = [new Uint8Array(SIGNATURE), chunk('IHDR', ihdr)];
  for (const [k, v] of Object.entries(texts)) {
    const kb = latin1Bytes(k);
    const vb = latin1Bytes(v);
    const data = new Uint8Array(kb.length + 1 + vb.length);
    data.set(kb, 0);
    data.set(vb, kb.length + 1);
    parts.push(chunk('tEXt', data));
  }
  parts.push(chunk('IDAT', idat), chunk('IEND', new Uint8Array()));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** JSON.stringify를 Python json.dumps(ensure_ascii=True)처럼 ASCII로 만든다 */
export function asciiJson(v: unknown): string {
  return JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
